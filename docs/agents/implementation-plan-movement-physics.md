# Implementation Plan: Movement, Collision & Terrain Destruction

Derived from a design review against Worms Armageddon, Hedgewars and GunBound/OpenBound.
Domain terms are defined in the root `CONTEXT.md`. Decisions are recorded in
`docs/adr/0002-terrain-representation.md` and `docs/adr/0003-chassis-relative-aim.md`.

## Why this work exists

Movement today is a teleport with no collision. `GameRoom.updatePhysics` advances `player.x` by
5px per frame with **no horizontal collision test at all**, then un-embeds with
`while (grounded) y -= 1` capped at 60 iterations — so a character can be lifted 60px in one
frame. There is no step-up rule, no steep-slope rule, no body, and no splash damage: a shell
landing one pixel from a character deals zero. Craters are drawn as opaque sky-coloured circles
over the terrain rather than erased from it.

## Constants (single source of truth)

All of these live in `shared/src/types.ts` unless stated. Values marked **TUNE** are expected to
move during playtest and must not be inlined anywhere.

| Name | Value | Notes |
|---|---|---|
| `PLAYER_WIDTH` | 24 | AABB. **TUNE** — see below; width drives both the climb limit and the crest hover |
| `PLAYER_HEIGHT` | 36 | AABB; `player.y` is the **feet** (bottom edge), unchanged from today |
| `MAX_CLIMB_ANGLE_DEG` | 75 | **TUNE** — steepest walkable slope. The knob to turn when climbing feels wrong |
| `CLIMB_LIMIT` | 45 | **DERIVED** from the angle: `HALF_WIDTH * tan(angle)`. Never tune directly |
| `STEP_LIMIT` | 20 | **TUNE** — step-DOWN only, plus the settle snap |
| `LIP_MAX_THICKNESS` | 28 | thickest roof an explosion may leave over an unusable space |
| `SLIVER_MAX_GAP` | 3 | air gaps this thin are filled, not opened |
| `FOOT_SAMPLES` | 5 | ground probes across the foot line |
| `TURN_FREE` | — | turning is never charged to the budget; see Phase 3 |
| `MOVE_BUDGET` | 250 | **TUNE** — pixels per turn |
| `WALK_SPEED` | 120 | **TUNE** — px/sec |
| `GRAVITY` | 0.4 | existing; unchanged |
| `TERMINAL_VELOCITY` | 12 | **TUNE** — px/frame, both axes |
| `TURN_TIME_MS` | 30000 | turn passes on expiry |
| `TILT_OFFSET_X` | 12 | half track length for the tilt secant |
| `TILT_WINDOW_Y` | 25 | vertical search window for the tilt secant |
| `AIM_MIN_DEG` | -20 | chassis-relative |
| `AIM_MAX_DEG` | 90 | chassis-relative |
| `AIRBORNE_CLIMB_MAX` | 5 | graduated climb steps when airborne |
| `AIRBORNE_CLIMB_DAMP` | [0.96, 0.93, 0.90, 0.87, 0.84] | speed multiplier per climb px |
| `WALL_ELASTICITY` | 0.4 | **TUNE** — airborne bounce off a true wall |

Per-weapon, in `WeaponConfigAdapter` (see Phase 5): `craterRadius`, `splashRadius`, `maxDamage`,
`knockbackScale`.

## Phase 1 — Terrain foundation

**Files:** `shared/src/terrain.ts`, `server/src/rooms/GameRoom.ts` (init only),
`client/src/adapters/RendererAdapter.ts`, `client/public/maps/*.png`

1. **PNG → mask.** Add a map loader. Server rasterises a PNG's alpha into the existing
   `Uint8Array` mask on room create, replacing `initializeTerrainPlatform()`'s single rectangle.
   Solid iff alpha > 0. Author 2–3 maps at 2000×1200 with real hills, a plateau and an overhang.
2. **Wire format.** `terrainSync` gains a `mapId`; ops continue to carry destruction since load.
   The client loads the same PNG. Server mask and client texture must come from one file.
3. **Client erase path.** Replace `redrawTerrain()`'s sky-circle op-replay
   (`RendererAdapter.ts:55-75`, currently O(all ops) per explosion) with a persistent
   `RenderTexture`: draw the map PNG once, then erase each crater with a destination-out blend.
   O(1) per crater and correct against any background.
4. **Despeckle.** After each crater, over the dirty region only, clear any solid pixel with fewer
   than 4 of its 8 neighbours solid. Removes the 1–3px filaments explosions leave. Mask and
   texture both. Do **not** generalise this into island detection — detached terrain hangs
   (ADR 0002).

**Done when:** a map loads from PNG, craters visibly erase rather than overpaint, and rims are
clean.

## Phase 2 — Character body and terrain probes

**Files:** new `shared/src/characterPhysics.ts`, tests alongside

Pure functions over a mask. No Colyseus, no rendering. This module is the foundation for Phases
3, 4 and 6 and must land before them.

```
isSolid(mask, mapWidth, mapHeight, x, y) -> boolean   // integer floor, out-of-bounds = false
testCollisionX(mask, body, dir) -> boolean      // leading vertical edge, scanned top to bottom
testCollisionY(mask, body, dir) -> boolean      // leading horizontal edge
```

The scan is a **line at the leading edge, inset 1px at each end** — the inset is what stops a body
catching on its own corner when sliding along a wall. Never a full mask-vs-mask overlap.

```
pushOutOfWall(mask, body) -> void
```
Resolve a body embedded in terrain (possible when a rect op is drawn over it). Probe 1px to each
side; eject toward whichever side is free. **If both or neither are blocked the body is genuinely
wedged — bail out rather than teleport it.**

```
footGroundHeight(mask, body) -> number | null   // FOOT_SAMPLES probes, highest ground wins
computeTilt(mask, x, y) -> radians              // Phase 6 consumes this
```

**Done when:** unit tests cover a flat floor, a 1px lip, a vertical wall, a ceiling, an
out-of-bounds edge, and a body buried in solid rock.

## Phase 3 — Locomotion (the risk phase)

**Files:** `shared/src/characterPhysics.ts`, `server/src/rooms/GameRoom.ts`

`walkStep(mask, body, dir) -> 'moved' | 'blocked' | 'fell'`, one pixel per call:

```
climbed = 0
while testCollisionX(dir) and climbed < STEP_LIMIT:
    if testCollisionY(-1): break            # ceiling — cannot lift
    y -= 1; climbed += 1
if testCollisionX(dir):
    y += climbed                            # undo the ENTIRE lift
    return 'blocked'                        # x unchanged

x += dir                                    # commit exactly 1px

dropped = 0
while not testCollisionY(+1) and dropped < STEP_LIMIT:
    y += 1; dropped += 1
if dropped == STEP_LIMIT and not testCollisionY(+1):
    y -= STEP_LIMIT; vy = 0; airborne = true
    return 'fell'
return 'moved'
```

The ceiling check and the full undo are both load-bearing. Omitting the undo is what produces the
current 60px hover bug.

Integration in `GameRoom`:
- Call `walkStep` `round(WALK_SPEED * dt)` times per frame, one pixel each, stopping early on
  `'blocked'` or `'fell'`.
- Decrement `movementBudget` by 1 **only on `'moved'`**. `'blocked'` costs nothing.
- On `'blocked'`, broadcast an `unableToMove` cue once per blocked run, not per frame.
- `walkStep` returns `'fell'` with the drop already undone, but knows nothing about velocity —
  **the integrator must set `vy = 0` and `airborne = true` itself** on that result.
- On settling after a fall: snap down at most `STEP_LIMIT`, zero velocity, **preserve the sign of
  facing** — a character must not silently turn around when it lands.
- Add `movementBudget` and `turnDeadline` to `Player`/`GameState`. Reset budget on turn start.
  Firing ends the turn and forfeits the remainder.
- Turn timer: on `TURN_TIME_MS` expiry the turn passes with no shot. This is **separate** from the
  existing 30s inactivity sweep, which deletes the player — do not conflate them.

**Body width is the load-bearing constant, and it is not obvious why.** An axis-aligned box probes
half its width ahead, so on a gradient `g` it must lift `HALF_WIDTH * g` to advance one pixel — the
widest climbable slope is `atan(STEP_LIMIT / HALF_WIDTH)`, *not* the near-vertical figure the
"per 1px" framing suggests. The same half-width sets how far the body hovers past a crest before it
falls. Grounding on the highest terrain under the foot line is what lets a wide box climb at all
(it pre-lifts the body onto the slope) and is simultaneously what causes the hover — the two cannot
both be tuned away. Narrowing the foot line relative to the body was tried and rejected: it trades
the hover for a lag between the leading edge clearing a lip and the body mounting it. Narrowing the
BODY fixes both at once, which is why it went 40 → 24 (Hedgewars uses 18). Phase 6's chassis tilt is
what finally makes the residual hover read as correct rather than broken.

**Turning is free.** Facing is set whenever a direction is held on your turn, with no reference to
the Movement Budget. Spending your last step walking away from an opponent must never leave you
unable to turn round and shoot them — facing is an aiming concern, not a movement one.

**⚠️ This is where the design can fail.** `craterRadius` 50 against `STEP_LIMIT` 12 means a single
crater rim is usually unclimbable. That is the intended "trapped in the pit you dug" mechanic, but
these two numbers are coupled and only playtesting can tell whether the result is tactical or
infuriating. **Phases 1–3 must be playable before Phase 4 starts.**

## Phase 4 — Airborne physics

**Files:** `shared/src/characterPhysics.ts`, `server/src/rooms/GameRoom.ts`

Separate from walking; the rules genuinely differ.

- Gravity per frame, clamped to `TERMINAL_VELOCITY` on both axes.
- Blocked horizontal move while airborne does **not** hard stop. Try lifting 1..`AIRBORNE_CLIMB_MAX`
  px, applying `AIRBORNE_CLIMB_DAMP[n-1]` to `vx` at each step. Only if all fail, bounce:
  `vx = -WALL_ELASTICITY * vx`. Below a small threshold, stop and settle.
- Landing: clear airborne, snap down ≤ `STEP_LIMIT`, zero velocity, preserve facing.
- **No fall damage.** Deliberate — see `CONTEXT.md`, Kill Boundary.
- Crossing the Kill Boundary (existing map-bounds test) kills instantly. This is the only lethal
  consequence of falling.
- A character whose ground is destroyed becomes airborne on the next frame via the existing
  ground probe. No special case needed.

## Phase 5 — Weapons, splash and knockback

**Files:** `shared/src/adapters/WeaponConfigAdapter.ts`, `server/src/rooms/GameRoom.ts`

Today `destroyTerrain` hardcodes radius 50 and a direct hit is a flat `health -= 20` — the weapon
is ignored entirely, and a near miss does nothing.

1. Add `craterRadius`, `splashRadius`, `maxDamage`, `knockbackScale` to `WeaponSpec`. Keep
   `splashRadius` **independent** of `craterRadius`: crater radius is constrained by the step-up
   rule (Phase 3), and damage tuning must not be dragged along by terrain tuning.
2. On impact, damage every character within `splashRadius`:
   ```
   dmg = (2*R + 4) - distance          # linear falloff
   dmg = min(dmg / 2, R)               # saturates at R
   ```
3. Knockback proportional to **damage dealt**, direction **radially normalised**:
   ```
   impulse = knockbackScale * dmg
   vx += impulse * (dx / dist); vy += impulse * (dy / dist)
   ```
   Hedgewars uses axis-separable `sign(dx)`/`sign(dy)`, which gives a target at 45° a √2× larger
   impulse than one directly overhead. That is an artifact, not a design; normalise instead.
4. Set the character airborne on any nonzero impulse.
5. Keep the existing projectile ray-march — sub-stepping by Chebyshev pixel count with early-out
   is already correct.

## Phase 6 — Chassis tilt and chassis-relative aim

**Files:** `shared/src/characterPhysics.ts`, `client/src/adapters/RendererAdapter.ts`,
`client/src/adapters/InputAdapter.ts`, `client/src/scenes/GameScene.ts`

**Tilt** is a two-sample secant, not a gradient — a per-pixel Sobel over a mask is
single-pixel-noise sensitive, this is not:

```
for each of x - TILT_OFFSET_X and x + TILT_OFFSET_X:
    scan h from -TILT_WINDOW_Y to +TILT_WINDOW_Y for the surface height
    if the column never hits solid (a hole), MIRROR THE OTHER TRACK'S SURFACE  # hole fallback
tilt = atan2(rightSample.y - leftSample.y, TILT_OFFSET_X * 2)
if airborne: tilt = 0
```

**Hole fallback, corrected.** An earlier draft said to "scan the other direction" — that is dead
code, because the primary scan already covers the whole window, so reversing it over the same range
finds nothing. (It was a mis-transcription of OpenBound, whose fallback handles a column that is
entirely *solid* — a buried track with no air-to-solid transition — not one that is entirely air.)
The implemented behaviour is: **a track that finds no ground mirrors the other track's surface**, so
a track hanging over a crater reads as level. If neither track finds ground, tilt is 0. The rejected
alternative — extending the scan below the window — finds the crater floor tens of pixels down and
produces exactly the garbage angle the fallback exists to prevent.

The `TILT_WINDOW_Y` of 25 is deliberately double `STEP_LIMIT`: tilt and locomotion use different
budgets, so a character tilts smoothly across terrain it could never walk over. The hole fallback
stops the body flipping to a garbage angle when one track overhangs a crater.

**Aim** (ADR 0003):
- Store aim as a chassis-relative angle, clamped to `[AIM_MIN_DEG, AIM_MAX_DEG]`.
- World angle = `tilt + chassisAim`, adjusted for facing. This is what physics fires and what the
  aim line draws.
- On tilt change, **preserve the chassis-relative angle** and re-clamp. The world direction moves
  with the chassis; that is the mechanic, not a bug.
- HUD shows the chassis-relative angle.
- **Rework `GameScene.fire()`.** It currently does `facing === 1 ? angle : 180 - angle`, a
  world-absolute flip with no chassis frame. A facing flip and a chassis rotation agree on level
  ground and disagree everywhere else — this will fail quietly if left alone.
- The aim line is now the **only** world-frame feedback in the game (ADR 0003). It must be visible
  throughout aiming, not only while charging power.

## Phase 7 — Netcode polish

**Files:** `client/src/adapters/RendererAdapter.ts`

`RendererAdapter.ts:105` assigns `sprite.x = player.x` directly at a 20Hz patch rate. This is a
large share of why movement reads as ugly, independent of any physics work.

- **Remote characters:** buffer ~2 patches and render at an interpolated, delayed position.
- **Own character:** no delay. Exponential smoothing toward the server position only. A local
  character lagging its own input is exactly the artifact we are removing.
- Keep the 50ms patch rate. At `WALK_SPEED` 120px/s that is ~6px between patches — trivially
  smooth once interpolated.

## Sequencing

```
Phase 1 (terrain)  ─┐
Phase 5 (weapons)  ─┼─ independent file sets, may run in parallel
Phase 7 (netcode)  ─┘
Phase 2 (body)      ─── must land before 3, 4, 6
  └─ Phase 3 (locomotion)  ─── PLAYTEST GATE
       └─ Phase 4 (airborne)
       └─ Phase 6 (tilt & aim)
```

Phases 2, 3 and 4 all rewrite the same player-update loop in `GameRoom.updatePhysics` and cannot
be parallelised against each other.

## Reference algorithms

- Hedgewars `MakeHedgehogsStep`, `moveHedgehogOutOfWall`, `TestCollisionX/Y`, `doMakeExplosion`,
  `Despeckle` — https://github.com/hedgewars/hw
- Worms Armageddon walking and fall damage — https://worms2d.info/Worm_Walking,
  https://worms2d.info/Fall_damage
- OpenBound (GunBound clone) movement, tilt secant, erosion —
  https://github.com/WickedPeanuts/OpenBound

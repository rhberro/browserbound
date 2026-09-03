# Implementation Plan: Point-Contact Movement (GunBound parity)

Supersedes the locomotion, airborne and body-geometry parts of
`implementation-plan-movement-physics.md`. That document's terrain, weapon, tilt and netcode
phases still stand — this one replaces how a character *touches the ground*.

Source of truth for the target behaviour: **rodrigobmg/OpenBound** (GPL, C#/MonoGame),
specifically `GameComponents/MobileAction/Motion/Movement.cs`, `LocalMovement.cs`,
`RemoteMovement.cs`, `GameComponents/Level/Topography.cs` and `Common/Parameter.cs`.

Two other sources were evaluated and rejected as movement references:
- `jeffreyim.wordpress.com/2010/10/06/mechanics-of-gunbound` — a hobbyist regression of
  *ballistics only*, in "monitor proportions". Self-admittedly incomplete on movement, slopes
  and terrain. Useful at most as a sanity check on projectiles, which is not what is broken.
- `jglim/gunbound-server` — protocol, auth, lobby and rooms. "Game session is partially
  implemented"; no physics whatsoever.

## Why this work exists

Movement reads as clanky, and every specific complaint traces to one root cause: **we sweep a
24×36 AABB against the terrain mask where GunBound probes a single pixel.**

In OpenBound, `Topography.CheckCollision(Vector2)` reads one cell of a `bool[][]` built from
`alpha > 0`. A mobile's `Position` *is* its ground-contact pixel. The per-mobile `CollisionOffset`
(18–30) exists solely for projectile-vs-mobile hit tests and never touches terrain.

Everything `characterPhysics.ts` documents as a hard-won fix is a cost of having a box:

| Our machinery | Exists only because of the box |
|---|---|
| `tooSteepToClimb` + `surfaceNear` secant | a box needs lookahead to tell a slope from a step |
| `ceilingBlocked` (trailing-half-only) | a box has shoulders that catch on the face it is climbing |
| `pushOutOfWall` / `isEmbedded` | a box on a slope always has its uphill flank inside terrain |
| `footGroundHeight` (5 probes, highest wins) | a box straddles gaps and must choose a foot |
| the 1px insets that must agree across four functions | a box has corners |
| `CLIMB_LIMIT` 45 vs `STEP_LIMIT` 20 vs `MAX_CLIMB_ANGLE_DEG` 75 | one box question split three ways |

GunBound has none of these because there is nothing to catch. It has **one** number: a ±6px
vertical window.

Two open review findings are artifacts of exactly this machinery and are **resolved by deletion**
— do not fix them separately:

- `tooSteepToClimb` samples only at a fixed 36px ahead, so a walk is refused a full body-width
  before any face taller than ~90px. Reproduced: flat ground, wall at x=200, body stops at x=164
  with 24px of clear walkable floor left, broadcasting `unableToMove` while standing in the open.
- `surfaceNear` scans *upward* first and returns the top of the first solid run, so a roof 45px
  above a walkable floor (a crater blown into a hillside — very common) is measured as "the
  surface". Same terrain: 120px traversed without the roof, 26px with it.

Four secondary causes, all fixed here:

3. **Gait is 2× too fast with no wind-up.** 250px at 120 px/s starting instantly, vs. GunBound's
   ~100 steps at ~60 px/s after a 100ms hesitation. Instant-start double-speed reads as slidey.
4. **Sub-pixel jitter.** `WALK_SPEED/1000 * 16ms = 1.92 px/tick`, so the server emits
   2,2,2,1,2,2,2,1… px steps under 50ms patch quantization. Literally clank.
5. **The air model is invented.** `WALL_ELASTICITY` bounces, `AIRBORNE_CLIMB_DAMP` climbs walls
   mid-fall. GunBound falls straight down, full stop. A knocked-back character ping-ponging off a
   wall is our most visibly non-GunBound behaviour.
6. **Falling has no hang.** GunBound waits 50ms before gravity engages, which is what makes ground
   collapsing under a mobile read as a beat rather than a snap.

## What does *not* change

Stated up front, because it bounds the blast radius:

- **`player.y` keeps its meaning.** It is already "the pixel the character stands on" (the feet).
  Only the *probe* changes, from a 5-sample foot line to a single column. This is **not** a schema
  or protocol change. Positions will differ slightly on slopes (the character now follows the
  surface exactly instead of riding the highest ground under a 24px foot line) but nothing that
  reads `player.y` needs to be reinterpreted.
- **`pointInBody` is correct and stays untouched.** It is OpenBound's `CollisionOffset` — the
  drawn body, used for projectile hits only. The comment explaining why the old radius-20 circle
  was wrong at both ends is still right.
- **`computeTilt` is already OpenBound's algorithm**, down to the constants: our
  `TILT_OFFSET_X = 12` / `TILT_WINDOW_Y = 25` are `TankMovementRotationCalculationOffsetX/Y`
  verbatim, including zeroing tilt while falling and compensating the crosshair by chassis
  rotation. Leave it alone.
- `PLAYER_WIDTH` / `PLAYER_HEIGHT` survive as **drawn-body** dimensions: sprite geometry, the
  health-bar offset, `pointInBody`, and `collapseLips`' headroom test. They stop being physics.
- Terrain representation, the ops log, `collapseLips`, weapons, splash, the turn loop and the
  Shot Clock are all out of scope.

## Constants

Everything below is a named constant in `shared/src/types.ts`. GunBound's values are the starting
point; every one marked **TUNE** is expected to move in playtest, and the point of naming them is
that changing the feel never means changing the algorithm.

| Constant | Value | Source | Notes |
|---|---|---|---|
| `STEP_UP_LIMIT` | 6 | `TankMovementMaxYStepping` | **TUNE**. Replaces `CLIMB_LIMIT`, `MAX_CLIMB_ANGLE_DEG`, `MAX_CLIMB_GRADIENT` |
| `STEP_DOWN_LIMIT` | 6 | `TankMovementMinYStepping` | **TUNE**. Replaces `STEP_LIMIT` |
| (step size) | 1 px | `TankMovementSpeed` | not a constant: `surfaceAhead` reads one column, so a longer stride would step past it |
| `WALK_WINDUP_MS` | 100 | `TankMovementSidewaysDelay` | **TUNE**. Hesitation before the first step |
| `MOVE_STEPS` | 100 | `MaximumStepsPerTurn` (90–100) | **TUNE**. Replaces `MOVE_BUDGET = 250`. Unit is now **steps** |
| `KNOCKBACK_SHOVE_SCALE` | 1 | ours | **TUNE**. Pixels of shove per point of `knockbackScale * damage` |
| `FALL_DELAY_MS` | 50 | `TankMovementGravityDelay` | **TUNE** |
| `FALL_INITIAL_SPEED` | 3 | `TankMovementInitialGravity` | px/tick |
| `FALL_ACCEL` | 0.15 | `TankMovementGravityFactor` | px/tick² |
| `WIND_DRIFT_SCALE` | 0.5 | `windForceAccumulator + wForce.X / 45`, **re-derived** | **TUNE**. OpenBound's divisor is in its own force units; ported literally it made drift unreachable |
| `EJECT_UP_LIMIT` | 32 | — | bound on the "terrain drawn over me" scan |
| `TERMINAL_VELOCITY` | 12 | ours | kept as a safety clamp; GunBound has none |
| `PLAYER_WIDTH` / `PLAYER_HEIGHT` | 24 / 36 | ours | **drawn body only** from here on |
| `TILT_OFFSET_X` / `TILT_WINDOW_Y` | 12 / 25 | `RotationCalculationOffsetX/Y` | unchanged |

**Deleted:** `CLIMB_LIMIT`, `STEP_LIMIT`, `MAX_CLIMB_ANGLE_DEG`, `MAX_CLIMB_GRADIENT`,
`FOOT_SAMPLES`, `AIRBORNE_CLIMB_MAX`, `AIRBORNE_CLIMB_DAMP`, `WALL_ELASTICITY`, `MOVE_BUDGET`,
`WALK_SPEED`.

Note the sim tick: ours is 16ms (62.5Hz) against GunBound's 60fps. 1px/tick therefore gives
62.5 px/s against their 60 px/s — a 4% difference, and worth taking in exchange for integer
steps and the deletion of `walkCarry`.

---

## Phase 1 — Rewrite `shared/src/characterPhysics.ts`

The heart of the change. Pure functions over the mask, as today.

**Delete:** `testCollisionX`, `testCollisionY`, `isEmbedded`, `pushOutOfWall`, `footGroundHeight`,
`settle`, `ceilingBlocked`, `surfaceNear`, `tooSteepToClimb`, `airborneHorizontal`.

**Keep unchanged:** `isSolid`, `computeTilt`, `trackSurface`, `pointInBody`, the `Body` interface.

**New surface:**

```ts
/** The surface the character would stand on one pixel in `dir`, or null if refused. */
surfaceAhead(mask, mapW, mapH, x, y, dir): number | null

/** Free pixels directly below (x, y), up to `max`. 0 means grounded. */
groundDistance(mask, mapW, mapH, x, y, max): number

/** Lift a contact point out of terrain drawn over it. Bounded by EJECT_UP_LIMIT. */
ejectUp(mask, mapW, mapH, body): void

/** One step. 'moved' | 'blocked' | 'fell'. */
walkStep(mask, mapW, mapH, body, dir): WalkResult
```

### `surfaceAhead` — the whole algorithm

Transliterated from `Movement.MoveSideways`:

```
col = x + dir
seenEmpty = false
for (probeY = y - STEP_UP_LIMIT; probeY <= y + STEP_DOWN_LIMIT; probeY++):
    solid = isSolid(col, probeY)
    if solid and seenEmpty: return probeY      # the surface
    if not solid: seenEmpty = true
return null                                     # cliff, or a wall taller than the window
```

Two outcomes to distinguish for the caller, exactly as OpenBound does:

- **A wall.** The window never went empty (`seenEmpty` false at the end) → the move is refused.
  This is the `unableToMove` bark.
- **A cliff.** The window went empty and never came back → OpenBound advances x and drops y by
  `MinYStepping`, letting gravity take over on the next frame. So `walkStep` returns `'fell'`
  after committing `x += dir; y += STEP_DOWN_LIMIT`.

Distinguish them by returning `null` plus a `seenEmpty` flag, or by returning a small tagged
result. Do **not** collapse them — a cliff is a fall, a wall is a refusal, and they sound and
cost differently.

### `walkStep`

```
s = surfaceAhead(mask, x, y, dir)
if s is 'wall':  return 'blocked'          # nothing mutated
if s is 'cliff': x += dir; y += STEP_DOWN_LIMIT; return 'fell'
x += dir; y = s; return 'moved'
```

That is the entire locomotion model. No climb loop, no undo, no ceiling test, no secant.

The steepest walkable continuous slope becomes `atan(6/1)` ≈ 80.5° up and 6px down per step —
and unlike the old model, that number is *actually* what characters achieve, because there is no
half-width lookahead standing between the advertised limit and the observed one.

### `ejectUp`

Replaces 60 lines of `pushOutOfWall` with:

```
if not isSolid(x, y): return
for lift in 1..EJECT_UP_LIMIT:
    if not isSolid(x, y - lift): y -= lift; return
# still buried: leave it, gravity and the next terrain op will sort it out
```

### Acceptance

- A character walks the full length of every generated map without a `'blocked'` on open ground.
- Standing next to a wall, the character reaches the pixel adjacent to it before refusing.
- A tunnel/overhang above a walkable floor does not affect walking at all.

---

## Phase 2 — Gait: wind-up, integer steps, step budget

In `GameRoom.ts`, the grounded branch of the physics loop.

- **Delete `walkCarry`** and `WALK_PX_PER_MS`. One `walkStep` per tick, `WALK_STEP_PX = 1`.
- **Add a per-player wind-up accumulator.** `+= SIMULATION_INTERVAL_MS` each tick a direction is
  held; a step is only taken once it exceeds `WALK_WINDUP_MS`. **Reset to 0 when the direction
  goes to 0 or reverses** — and only then. This is the detail that makes it feel right: in
  OpenBound `sidewaysDelayTimer` is *never reset after a successful step*, so it is a one-time
  hesitation on key-down followed by a steady crawl, not a per-step delay. Getting this backwards
  yields a 10 px/s character.
- **`movementBudget` is now a step count.** `MOVE_STEPS = 100`, decremented by 1 per `'moved'`.
  Keep the schema field name; document that its unit changed. `'blocked'` still costs nothing.
- Turning remains free and ungated, as today.

Client: `movementBudgetMax` in `ui/signals.ts` switches from `MOVE_BUDGET` to `MOVE_STEPS`. The
bar and the numeric readout are already proportional, so no UI work beyond the import.

### Acceptance

- Tapping a direction key for <100ms moves the character zero pixels and spends zero budget.
- Holding it produces exactly one pixel per tick with no 2,2,2,1 pattern anywhere in the trace.
- A full turn of unobstructed walking covers exactly `MOVE_STEPS` pixels.

---

## Phase 3 — Falling: straight down, with a hang

Replaces the airborne branch entirely.

- **Grounded test** becomes `groundDistance(x, y, 1) === 0`.
- **Hang.** A `fallDelay` accumulator per player, `+= SIMULATION_INTERVAL_MS`; gravity does
  nothing until it passes `FALL_DELAY_MS`. Reset to 0 the moment the character is grounded.
- **Gravity.** `vy` starts at `FALL_INITIAL_SPEED` (3) on the first falling tick and gains
  `FALL_ACCEL` (0.15) per tick, clamped to `TERMINAL_VELOCITY`.
- **Move by `min(vy, groundDistance(x, y, vy))`.** This *cannot* overshoot into terrain, which is
  why OpenBound needs no settle step and no per-pixel descent loop. Landing is exact. Delete the
  `while (remainingVy > 0)` loop and the `settle` call.
- **Landing** clears `airborne`, zeroes `vy` and `fallDelay`, and preserves facing (as today).

**Delete:** `airborneVxCarry` and every reference, `airborneHorizontal`, the graduated climb, the
bounce.

### Lateral motion in the air — the one deliberate divergence

Two forces want to move a falling character sideways, and they are not the same:

1. **Wind.** OpenBound's, adopted as-is: accumulate `windAccel.x / WIND_DRIFT_DIVISOR` into a
   per-player accumulator, clamp to ±1, apply the whole-pixel part, and zero the accumulator on
   wall contact. Drive it from the *same* wind acceleration `PhysicsAdapter` gives projectiles so
   there is one source of truth for what the wind is doing.

2. **Knockback.** We have `knockbackImpulse`; OpenBound's client movement models nothing like it.
   **Kept, but stripped of the bounce and rebuilt as a positional shove.** As implemented (see
   ADR 0004): horizontal only, and applied by walking the character with `walkStep` while it is
   grounded rather than storing `vx` it has no way to spend. Only a character already airborne
   carries it as velocity, sharing one sub-pixel accumulator with the wind. On hitting a solid
   pixel both forces stop — no reflection, no climb.

   The door left open: `KNOCKBACK_SHOVE_SCALE` tunes how far a shove carries, and
   `knockbackScale` → 0 across the weapon table reduces us to exact GunBound behaviour without
   touching physics code.

### Acceptance

- Ground destroyed under a character produces a visible ~50ms beat, then a fall.
- A character falling beside a wall never bounces off it and never climbs it.
- A landing puts the character exactly on the surface with no visible settle correction.

---

## Phase 4 — Tests

`shared/src/__tests__/characterPhysics.test.ts` is heavily AABB-specific and mostly gets replaced.

**Delete:** the `testCollisionX`, `testCollisionY`, `isEmbedded`, `footGroundHeight`, `settle`,
`airborneHorizontal` and `pushOutOfWall` suites, plus the `makeMask` foot-line inset helpers.

**Keep as-is:** `pointInBody` and `computeTilt` suites.

**New:**
- `surfaceAhead`: flat, rising 1..6, rising 7 (refused), falling 1..6, cliff, wall, overhang above
  a walkable floor (the old finding #2 shape), wall approach reaching the adjacent pixel (finding
  #3 shape).
- `walkStep`: the three outcomes, and that `'blocked'` mutates nothing.
- `groundDistance`: grounded, exact landing, no overshoot at high `vy`.
- `ejectUp`: buried, partially buried, unburied, unbudgeable.
- A slope-traversal test across 0..85° that walks a fixed span. **Fix the existing test's bug
  while rewriting it:** `slope()` clamps with `Math.max(1, …)`, so above ~63° the slope hits the
  top of the map inside the walked range and 35–40 of the 100 asserted steps are taken on a flat
  plateau at y=1. Start the slope lower or shorten the run so the assertion means something.
- Gait tests over `GameRoom`'s tick: wind-up, integer stepping, budget-as-steps.

---

## Phase 5 — Documentation

- **New ADR `docs/adr/0004-point-contact-terrain.md`**: terrain contact is a point, the drawn body
  is a box, and the two are deliberately different. Record the consequence honestly — the sprite
  is visually wider than its collision, so it clips into steep faces it stands beside. GunBound
  accepts this and it reads fine because the tilt sells the contact. Cross-reference ADR 0002
  (terrain lives on the server) and ADR 0003 (chassis-relative aim).
- **`CONTEXT.md` §"Character Physics & Terrain"**: rewrite **Character Body** (split into
  Contact Point vs. Drawn Body), replace **Climb Angle** / **Step-Up Limit** / **Step-Down Limit**
  with a single **Step Window**, update **Blocked Move** (wall vs. cliff are now distinct
  outcomes) and **Movement Budget** (unit is steps).
- **`docs/agents/implementation-plan-movement-physics.md`**: add a header marking Phases 2–4
  superseded by this document. Do not delete it — its terrain, weapon and tilt phases are still
  the live reference, and its post-mortems explain why the box model was tried.

---

## Deferred — remote gait replay

Recorded here so it is not re-derived later, explicitly **not** in this change.

OpenBound never interpolates remote mobiles. `RemoteMovement` queues target positions and replays
*the same `MoveSideways` gait* toward them, with identical physics; a remote tank's motion is the
real walk driven to a target, not a lerp between samples. That is why GunBound characters never
appear to slide.

Our `PlayerMotion` lerps remote players and exponentially smooths the local one (40ms half-life).
Once movement is integer 1px/tick, a 20Hz-patched lerp is genuinely smooth, and the local
smoothing has much less error to chase. **Do the cheap thing first:** reassess the local half-life
after Phase 2 and probably lower it. Only pursue gait replay if remote characters still read as
sliding — it is a substantially larger change and it trades interpolation error for divergence
error.

## Sequencing

Phase 1 is the risk. Phases 2 and 3 both depend on it and are independent of each other. Phase 4
tracks 1–3. Phase 5 last, once the constants have settled.

```
Phase 1 (characterPhysics rewrite)
   ├─ Phase 2 (gait)      ─┐
   └─ Phase 3 (falling)   ─┴─ Phase 4 (tests) ─ Phase 5 (docs)
```

Land as one change, per the decision to do the rework in a single pass rather than hotfixing the
two review findings first — they are deleted by Phase 1 and fixing them separately would be work
thrown away.

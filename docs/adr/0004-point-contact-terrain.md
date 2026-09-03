# ADR 0004: Terrain contact is a point; the body is only drawn

## Status

Accepted — 2026-09-03

## Context

A character has to touch the ground somehow, and there are two ways to ask the terrain mask where
the ground is.

- **A swept box.** The character is an axis-aligned rectangle; walking means testing that
  rectangle's leading edge against the mask and resolving whatever it hits. This is the Hedgewars
  model, and it is what we built.
- **A contact point.** The character's position *is* the pixel it stands on. Walking means reading
  one column of the mask. This is GunBound's model — `Topography.CheckCollision(Vector2)` reads
  exactly one cell — and its per-mobile `CollisionOffset` (18–30) exists solely for
  projectile-vs-mobile hit tests and never touches terrain.

Movement read as clanky, and the specific complaints all had the same shape: characters refused to
walk on ground that was plainly walkable, stalled at invisible barriers, and ping-ponged off walls
when knocked into the air.

Tracing each one led to the same place. A box does not have a surface under it; it has a *foot
line*, so it needs several probes and a rule for which one wins. A box on any incline has its
uphill flank inside the terrain, so it needs an eject routine — which then fights the walk step for
the same pixel and pins characters to the bottoms of hills. A box has shoulders that catch on the
face it is climbing, so its ceiling probe has to span only the trailing half. A box cannot tell a
5px pebble from an 80° cliff with a single lift budget, so it needs a lookahead secant — which
reads a fixed distance ahead and therefore refuses to walk a full body-width before any tall face,
and reads a roof as the surface when the column ahead is a tunnel.

None of these were bugs in the box code. Each was a correct fix for a real artifact, and each
artifact was a consequence of the box. By the end there were three separate climb limits
(`CLIMB_LIMIT` 45, `STEP_LIMIT` 20, `MAX_CLIMB_ANGLE_DEG` 75) whose interaction nobody could
predict, and the angle characters actually achieved bore no relation to the one advertised.

## Decision

**Terrain contact is a single point.** `player.(x, y)` is the pixel the character stands on: `y` is
the topmost solid row of the ground beneath it, so "grounded" is "the pixel at `(x, y)` is solid".

**The box survives only as the drawn body.** `PLAYER_WIDTH` and `PLAYER_HEIGHT` describe what the
character is rendered as and what a projectile is tested against (`pointInBody`), plus the headroom
test that decides whether a space under a crater roof is worth standing in. They are not physics.

Locomotion collapses to one pair of numbers, the **Step Window**: scan the column one pixel ahead
from `STEP_UP_LIMIT` above the feet to `STEP_DOWN_LIMIT` below, and take the first solid pixel that
follows an empty one. Three outcomes, all meaningful:

- a **surface** — move onto it;
- a **wall** (the column never went empty) — refuse, and bark `unableToMove`;
- a **cliff** (the column went empty and never came back) — advance anyway, drop by the window, and
  let gravity take it.

`STEP_UP_LIMIT` is therefore also the climb angle, and for the first time it is the angle
characters achieve: there is no half-width lookahead standing between the advertised limit and the
observed one.

Falling follows: straight down at `min(vy, distanceToGround)`, which cannot overshoot into terrain,
so landing is exact and there is no settle step.

## Consequences

**The sprite is wider than its collision.** A character standing beside a steep face clips into it,
because nothing stops the drawn box from overlapping terrain the contact point is clear of. This is
accepted. GunBound has the same property and it reads fine, because the chassis tilt sells the
contact — the eye takes the angle of the body as the statement about where the ground is, and the
few pixels of overlap never register.

**Deleted:** `testCollisionX`, `testCollisionY`, `isEmbedded`, `pushOutOfWall`, `footGroundHeight`,
`settle`, `ceilingBlocked`, `surfaceNear`, `tooSteepToClimb`, `airborneHorizontal`, and with them
`CLIMB_LIMIT`, `STEP_LIMIT`, `MAX_CLIMB_ANGLE_DEG`, `MAX_CLIMB_GRADIENT`, `FOOT_SAMPLES`,
`AIRBORNE_CLIMB_MAX`, `AIRBORNE_CLIMB_DAMP` and `WALL_ELASTICITY`. Two known movement bugs — the
invisible barrier a body-width from any wall, and overhangs blocking walkable floor — were fixed by
this deletion rather than separately, because both were artifacts of machinery that no longer
exists.

**Knockback is our one deliberate divergence.** GunBound has no lateral velocity in the air at all;
only wind pushes a falling mobile, as a sub-pixel accumulator clamped to ±1 and spent a whole pixel
at a time. We keep knockback, because it is tuned into every weapon's `knockbackScale` and is a
real part of how our weapons read, but a knocked-back character that meets a wall **stops** against
it rather than reflecting. Setting every `knockbackScale` to 0 would reduce us to exact GunBound
behaviour without touching physics code.

**Positions shift slightly on slopes.** A character now follows the surface of its own column
exactly, rather than riding the highest ground under a 24px foot line. `player.y` keeps its meaning
— it was already the feet — so this is not a schema or protocol change, and nothing that reads
`player.y` needed reinterpreting.

**Chassis tilt was already right.** `computeTilt` is GunBound's `UpdateAngle` down to the constants
(`TILT_OFFSET_X` 12, `TILT_WINDOW_Y` 25), including zeroing tilt while falling. It was the one part
of character physics that never asked a question about a box, and it needed no change. See
ADR 0003 for what tilt then does to aim.

Terrain itself is unaffected: it still lives on the server as a per-pixel mask replayed to clients
as an ops log (ADR 0002), and this decision only changes how a character reads it.

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
It is an ORIENTED box, leaning with the chassis — see the amendment below.

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
only wind pushes a falling mobile, as a sub-pixel accumulator spent a whole pixel at a time. We
keep knockback, because it is tuned into every weapon's `knockbackScale` and is a real part of how
our weapons read.

It is a **positional shove**, not stored velocity, and horizontal only. Vertical is easy: nothing
moves a character upward, so an upward impulse would be discarded by the next tick's fall, and
taking only the horizontal component says that plainly. Positional is the less obvious half — a
grounded character has no way to *spend* velocity, because the integrator only moves `vx` on the
airborne path, so an impulse handed to someone still standing sits unspent until something else
knocks them loose and then fires late. That is the common case rather than the edge one: splash
reaches further than the crater does, so most targets take damage while keeping their footing.

So a shove walks, using the same `walkStep` a player's own movement does. It follows slopes, stops
dead against a wall, and pushes a character clean off a ledge into a fall, with no special case for
any of them. A character already in the air has nothing to walk on, so there it stays velocity and
the airborne path spends it — sharing one sub-pixel accumulator with the wind, because truncating
each force separately loses its remainder every tick and drops a small shove entirely.

Setting every `knockbackScale` to 0 would reduce us to exact GunBound behaviour without touching
physics code.

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

## Amendment — the drawn body is oriented, not axis-aligned

Accepted — 2026-09-03, superseding this ADR's original "axis-aligned regardless of tilt".

The first version of this decision kept the drawn body axis-aligned and argued that "the collision
test must agree with the box, not the drawing." That argument was inherited from the swept-box era
and does not survive the decision above.

While the box was also the physics body, axis-alignment bought something real: an oriented box has
to be swept against the terrain mask, which is materially harder than an AABB. Once terrain contact
became a point, the box was left with exactly one job — being the thing players aim at — and for
that job the only question is whether the hit target agrees with the picture. A static box does not.
The chassis is drawn rotated by `player.tilt`, so at 10° of tilt the drawn head is already 6px
outside a level box, and at 20° it is 11.6px, most of a half-width. Characters were shot in a box
their sprite had visibly left, and shots that visibly struck the head passed through it.

So `pointInBody` rotates the query point by minus the tilt about the contact point and runs the same
box test in the body's own frame. This costs six lines and two trig calls, and it is free at the
edges: the pivot already matches (PixiJS rotates the chassis about the container origin, which *is*
`player.y`), `tilt` is already synchronized, and tilt is zero while airborne, so the test degenerates
to the old one exactly.

The one hazard considered and dismissed: at high tilt the box's lower corner dips below the contact
point, into the ground. Nothing can hit it, because the projectile ray-march tests terrain before
players and stops at the first solid pixel.

This also converges with GunBound, whose `CollisionBox` is likewise an oriented rectangle that
rotates with the mobile and likewise never touches terrain.

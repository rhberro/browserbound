# BrowserBound Domain Model

## Overview

BrowserBound is a turn-based multiplayer artillery game. Players aim projectiles at each other across destructible terrain, with wind as a strategic element that changes each round.

## Core Concepts

### Projectile

A **Projectile** is a physical object fired by a player with an initial velocity. It is affected by gravity and wind each frame, moves in a parabolic arc, and collides with terrain or players.

- **Position**: `(x, y)` — current location in world space
- **Velocity**: `(vx, vy)` — horizontal and vertical speed. Server-side only: the client
  interpolates positions rather than predicting motion, so velocity is never synchronized.
- **Lifetime**: From fire until it hits terrain, goes out of bounds, hits an opponent, or reaches
  the Projectile Lifetime backstop

Projectiles travel as **synchronized state**, like every other moving thing. Appearing in that state
is the shot being fired and leaving it is the shot being over. The impact itself stays a message,
because it is an event rather than continuous state.

### Shot Clock

The **Shot Clock** is the single timeline every part of a shot is shown on: its flight, its
explosion, the crater it leaves, any death it causes, and its own disappearance.

It exists because those two halves arrive differently. A position is state, delivered at the patch
rate, so it is played back slightly behind live in order to have a sample on each side to interpolate
between. An impact is a message, true the moment it arrives. Shown on their own clocks, both are
correct and neither agrees with the other: the drawn projectile is a delay's worth of flight short of
the ground when its explosion goes off ahead of it. The fix is not better positions — it is one
clock, with the delay paid once by the whole shot.

The client cannot simply drop the delay and draw shots live, because terrain lives only on the server
(ADR 0002): a client predicting the flight itself has nothing to stop the projectile and would sail
it through the ground. What it can do is close the gap at the end — the impact message carries the
exact point of contact, which becomes the flight's final position, so the projectile arrives rather
than stopping wherever the last patch left it.

### Wind

**Wind** is an environmental force that affects all active projectiles. It has:
- **Magnitude**: How strong the wind is (force applied each frame)
- **Direction**: Angle in radians (0 to 2π); wind pushes in this direction
- **Duration**: How many rounds the current wind persists (random: 5–10 rounds, where 1 round = all players take one turn)

When wind duration expires (after the specified number of complete rounds), a new wind spawns immediately with random magnitude and direction.

Wind is applied as a **force**: each frame, wind velocity is added to projectile velocity:
```
vx += wind.magnitude * cos(wind.angle)
vy += wind.magnitude * sin(wind.angle)
```

### PhysicsAdapter

**PhysicsAdapter** is the single module responsible for advancing projectile positions each frame. It is **stateless**—it owns only the velocity math, not the state of wind or projectiles.

**Interface**:
- `createProjectile(angle, power) → {vx, vy}` — Convert player aim (angle in radians, power 0–100) to initial velocity
- `updateAllProjectiles(projectiles[], wind) → void` — Advance all projectiles one frame given current wind (modifies in-place)

**What PhysicsAdapter owns** (behind the seam):
- Gravity calculation: `vy += GRAVITY` each frame
- Wind force application: `vx += wx, vy += wy`
- Velocity-to-position integration: `x += vx, y += vy`

**What PhysicsAdapter does NOT own**:
- Terrain collision detection
- Projectile lifecycle (when to remove a dead projectile)
- Wind state or persistence
- Message broadcasting to clients

### WindManager

**WindManager** tracks the current wind state and persists across rounds. It owns:
- Current wind magnitude and direction
- Rounds remaining in current wind cycle (not affected by frame rate)
- Generates new random wind when duration expires

**Interface**:
- `getCurrentWind() → {magnitude, direction, framesRemaining}` — Returns current wind (framesRemaining represents rounds, not frames)
- `generateNewWind() → WindState` — Creates a new wind (called by GameRoom when round duration expires)

### Game Loop Sequence

Each server frame:

1. **PhysicsAdapter.updateAllProjectiles(projectiles, wind)** — Advance each projectile position and velocity given current wind
2. **GameRoom checks collisions** — For each projectile, test if it hit terrain, went out of bounds, or hit a player
3. **GameRoom removes dead projectiles** — Removes projectiles that collided or left bounds
4. **Publish state** — Positions, wind and turn state reach clients as synchronized state, not as
   per-frame broadcasts. Messages are reserved for events: impacts, terrain ops, match end.

**At round boundaries** (after all players have taken one turn):

5. **Check wind expiration** — Increment round counter
6. **If wind duration expired** — Generate new wind and reset counter

### Seam Boundaries

**Physics seam**: PhysicsAdapter is the boundary between "pure math" and "game logic". It encapsulates velocity calculations; everything else (terrain, collisions, lifecycle) is GameRoom's job.

This separation enables:
- Testing PhysicsAdapter in isolation (inject gravity and wind, verify trajectories)
- Reusing PhysicsAdapter on client for UI hints (e.g., aiming preview) without duplicating collision logic
- Swapping wind models without changing GameRoom

### Constants

- **GRAVITY**: Downward acceleration (pixels/frame²)
- **WIND_INTEGRATION**: Scaling factor for how strongly wind affects projectiles
- **MAP_WIDTH, MAP_HEIGHT**: World bounds (pixels)
- **WIND_DURATION_MIN, WIND_DURATION_MAX**: Rounds (5–10)
- **RECONNECT_WINDOW_SECONDS**: How long a dropped player keeps their character and turn
- **PROJECTILE_MAX_LIFETIME_FRAMES**: Backstop after which an unresolved projectile is retired

## Why This Design

**Stateless PhysicsAdapter** means GameRoom owns all state (projectiles, wind, turn state). PhysicsAdapter is a pure function receiver—same inputs always produce same outputs. This makes it:
- Deterministic (testable, predictable)
- Reusable (client and server use same logic)
- Shallow to understand (read one module, understand all velocity math)

**Separate WindManager** keeps wind logic out of GameRoom's already-complex turn and collision handling. Wind is a self-contained concept: "spawn, persist for N frames, die and spawn new."

## Related Decisions

- [[ADR-0001-physics-adapter]] — Why PhysicsAdapter is stateless and where it sits in the game loop
- [[server/CONTEXT.md]] — Server-specific: GameRoom's role in managing turn state, collision detection
- [[client/CONTEXT.md]] — Client-specific: rendering projectiles, UI wind display

## Character Physics & Terrain

### Terrain Mask

The **Terrain Mask** is the authoritative record of which pixels of the world are solid. It is
authored as an image: a pixel is solid unless it is transparent. The server holds the mask and
answers every solidity question from it; the client holds a visual copy so what a player sees and
what the server collides against come from the same source.

The mask changes only by **Terrain Ops** — a rectangle added, or a circle erased. Ops are the only
thing sent over the wire, so a client that joins late can replay them to reach the current mask.

### Detached Terrain

**Detached Terrain** is any part of the mask no longer connected to the rest of it, produced when
explosions cut a bridge. Detached terrain **hangs in place**. It does not fall, collapse, or settle.

Distinct from **speckle**: single pixels and hairline filaments left along a crater's edge, which
are removed because they are visual noise, not because they are detached.

### Collapsed Lip

A **Collapsed Lip** is a thin roof an explosion left over a space too short to stand in. Because a
character can neither climb it nor pass beneath it, such a roof is removed and the space opened to
the sky.

A roof is only collapsed when it is *both* thin *and* over an unusable space. A thick roof, or a
thin roof with room to walk under it, is a cave and survives — caves are the reason terrain is
recorded per pixel at all.

### Character Body

The **Character Body** is the rectangle the simulation moves: a fixed width and height, centred
horizontally on the character's position and standing *on* it — the position is the **feet**, not
the centre. Everything that asks "where is this character?" asks about this box: walking, wall
tests, ground finding, and projectile hits.

Projectiles are tested against it directly. A shot at head height therefore registers, and a shot
passing below the feet, inside the ground, does not. It was previously a circle centred on the feet,
which got both of those backwards.

The body is **axis-aligned regardless of Chassis Tilt**. Tilt is what the character is drawn at and
what its shot obeys; it does not rotate the box the physics moves, and the collision test must agree
with the box, not the drawing.

### Climb Angle

The **Climb Angle** is the steepest continuous slope a character can walk up. It is the game's
definition of "too steep".

It is measured, not inferred: the surface under the feet against the surface one body width further
along, taken in the direction of travel. The run length is what makes the measurement mean anything,
because it is the only thing that tells a slope from a step — a ledge rises by a fixed amount however
far you measure, while an incline's rise grows with the run.

### Step-Up Limit

The **Step-Up Limit** is the tallest single obstacle a character can lift itself over in one pixel of
travel: a ledge, a crater lip, a pebble.

It is deliberately *not* the Climb Angle, and the two cannot be collapsed into one number. On a
continuous slope a body only ever rises by the gradient per pixel travelled — a few pixels, even on a
steep hill — so a Step-Up Limit generous enough to clear a ledge waves cliffs through, and one tight
enough to refuse a cliff forbids stepping over a pebble. One number cannot answer both questions, and
when it was asked to, characters walked up sheer walls while gentle hills stopped them.

### Step-Down Limit

The **Step-Down Limit** is the greatest drop a character follows rather than walking off it into a
fall. It is deliberately *not* the same quantity as the Climb Angle: how steep a hill you can climb
is a question about the body against the ground, while how far you step down before falling is a
question about when a ledge becomes a fall.

### Blocked Move

A **Blocked Move** is a walk attempt the terrain refuses: the destination is solid and no rise
within the Step-Up Limit clears it. A Blocked Move changes nothing — the character does not
advance, does not rise, and **spends no Movement Budget**. Walking into a wall is free.

### Movement Budget

The **Movement Budget** is the distance a character may walk during its turn, replenished each
turn. It is spent per pixel actually advanced, so rising and falling are free and a Blocked Move
costs nothing. Firing ends the turn, and with it any unspent budget.

**Turning is not movement** and is never charged to the budget. A character with nothing left to
spend can still face either way, and so can always shoot in either direction.

### Chassis Tilt

**Chassis Tilt** is the character's orientation, taken from the slope of the ground beneath it: the
line between the ground found under its left edge and under its right edge. A character in the air
has no tilt. Tilt reads the ground far more generously than walking does, so a character tilts to
terrain it could never climb.

### Chassis-Relative Aim

Aim is measured **against the Chassis**, not against the world. The ground a character stands on
therefore changes where its shot goes. When Chassis Tilt changes, the aim measurement is preserved
and the real-world direction moves with the chassis.

Aim is confined to a fixed range relative to the chassis. Terrain that tilts a character far enough
can press its aim against that limit, denying shots that would be available on level ground.

### Reconnection Window

A dropped connection is not a departure. A character whose player has disconnected stays on the
field for the **Reconnection Window**, keeping its health, its position, its turn and its unspent
Movement Budget, and rejoining restores all of it because none of it was ever torn down. The turn
clock is *frozen* for the duration rather than extended, so a player who returns gets back the time
they had left and no more.

A **deliberate leave is not a drop** and does not wait out the window — the opponent should not sit
through a timer for someone who has already gone. Only expiry of the window removes the character
and passes the turn.

While the window is open the character is marked as disconnected to everyone else, because a
character standing still because its player is thinking and one standing still because its player
fell off the network are otherwise indistinguishable.

### Projectile Lifetime

A projectile that has neither collided nor left the world after a bounded number of frames is
retired, and the turn proceeds. This is a **backstop, not a game rule**: nothing legitimate reaches
it, since a full-power shot crosses the map in well under a second.

It exists because the turn only passes once no projectile is in flight, which makes a single
projectile that can never resolve a permanent freeze for *every* player in the room. Retirement is
deliberately not an impact — it destroys no terrain and damages nobody, and it reports no position,
because the position of a projectile that failed to resolve is precisely the value that cannot be
trusted.

### Match Phase

A match is either **playing** or **ended**. It ends when fewer than two characters remain, at which
point turn passing, the turn clock and wind changes all stop — with one character left there is
nobody to pass the turn to, and a lone survivor otherwise plays on indefinitely.

The **winner** is the single survivor. Two characters dying in the same exchange is a **draw**, and
is reported as one: a winner is only ever named when there is genuinely one character left, never
inferred from whoever happens to remain. Because deaths can land in the same frame, the outcome is
decided once at the end of a frame rather than on each removal.

A match only becomes endable once it has had two characters at the same time; before the second
player arrives, one character is a room waiting to fill.

### Rematch

A finished match can be restarted **without anyone reconnecting**: a new map, full health, spawns
reassigned, terrain log cleared, for whoever is still in the room. Every connected player must ask,
and the tally is recomputed when someone leaves as well as when someone asks, so one player's
departure cannot hold the room in a finished match. A player inside a Reconnection Window is
counted as still here, so a rematch cannot start without them and leave them stranded on arrival.

### Turn Clock

The time left in the current turn, published as a **remaining duration** rather than a deadline.
A deadline would require the client's clock to agree with the server's, and a countdown computed
from a skewed clock is wrong by the skew for as long as the skew lasts.

### Terrain Op Log

The record of every terrain change since the map loaded, replayed in full to each joining client.

It is **compacted, not bounded**: consecutive operations of the same type covering adjacent columns
merge into one rectangle, which is what lip collapse produces in bulk. Only that rewrite is
performed, and only against the immediately preceding operation. Terrain operations both remove and
*add* terrain — sliver fills restore it — so their **order is their meaning**, and an operation that
looks redundant next to its neighbour may be doing the opposite job. A match that keeps digging new
ground still grows the log.

### Kill Boundary

The **Kill Boundary** is the edge of the world. A character that passes it dies at once, whatever
its health. It is the only lethal consequence of falling: characters take no damage from impact,
however far they fall.

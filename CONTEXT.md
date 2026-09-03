# BrowserBound Domain Model

## Overview

BrowserBound is a turn-based multiplayer artillery game. Players aim projectiles at each other across destructible terrain, with wind as a strategic element that changes each round.

## Core Concepts

### Projectile

A **Projectile** is a physical object fired by a player with an initial velocity. It is affected by gravity and wind each frame, moves in a parabolic arc, and collides with terrain or players.

- **Position**: `(x, y)` — current location in world space
- **Velocity**: `(vx, vy)` — horizontal and vertical speed
- **Lifetime**: From fire until it hits terrain, goes out of bounds, or hits an opponent

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
4. **Broadcast state** — Send updated projectile positions and wind state to all clients

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

### Climb Angle

The **Climb Angle** is the steepest slope a character can walk up. It is the game's definition of
"too steep", and everything else about climbing follows from it.

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

### Kill Boundary

The **Kill Boundary** is the edge of the world. A character that passes it dies at once, whatever
its health. It is the only lethal consequence of falling: characters take no damage from impact,
however far they fall.

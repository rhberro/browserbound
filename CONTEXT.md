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
- **Duration**: How many frames the current wind persists (random: 5–10 frames)

When wind duration expires, a new wind spawns immediately with random magnitude and direction.

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

**WindManager** tracks the current wind state and when it changes. It owns:
- Current wind magnitude and direction
- Frames remaining in current wind cycle
- When duration expires, generates new random wind

**Interface**:
- `getCurrentWind() → {magnitude, direction, framesRemaining}`
- `advance(deltaTime) → void` — Decrements framesRemaining; spawns new wind if duration expired

### Game Loop Sequence

Each server frame:

1. **WindManager.advance()** — Check if current wind duration expired; if so, generate new wind
2. **PhysicsAdapter.updateAllProjectiles(projectiles, wind)** — Advance each projectile position and velocity given wind
3. **GameRoom checks collisions** — For each projectile, test if it hit terrain, went out of bounds, or hit a player
4. **GameRoom removes dead projectiles** — Removes projectiles that collided or left bounds
5. **Broadcast state** — Send updated projectile positions and wind state to all clients

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
- **WIND_DURATION_MIN, WIND_DURATION_MAX**: Frames (20–60)

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

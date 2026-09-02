# ADR-0001: Stateless PhysicsAdapter Module

**Status**: Accepted

**Date**: 2026-09-02

## Context

Physics logic was scattered across three modules:
- `shared/physics.ts` — exports unused `ProjectileSimulation` and `calculateTrajectory()`
- `server/GameRoom.ts` — hardcoded physics loop (lines 260–276) with wind coefficient mismatch
- `client/gameState.ts` — receives position updates only; no client-side prediction

This created **poor locality**: understanding projectile motion required jumping between four files and two modules. It also created **hidden bugs**: wind coefficient differed between implementations, trajectory bounds hardcoded at 1000 but `MAP_HEIGHT` is 1200.

## Decision

Create a **stateless PhysicsAdapter** module that encapsulates all velocity math (gravity, wind force application, position integration). GameRoom owns projectile state and lifecycle.

### PhysicsAdapter Interface

```typescript
export class PhysicsAdapter {
  constructor(config: {gravity: number, windIntegration: number}) {}
  
  createProjectile(angle: number, power: number): {vx: number, vy: number}
  updateAllProjectiles(projectiles: Projectile[], wind: Wind): void
}
```

### Responsibilities

**Behind the seam (PhysicsAdapter)**:
- Velocity → position integration
- Gravity application: `vy += GRAVITY`
- Wind force application: `vx += wind.vx, vy += wind.vy`
- Angle/power → velocity conversion

**Outside the seam (GameRoom)**:
- Projectile lifecycle (create, store, remove)
- Terrain collision detection
- Wind state and persistence
- Message broadcasting

## Rationale

1. **Locality**: All physics math lives in one module. Reader understands velocity calculations by reading PhysicsAdapter only.

2. **Testability**: PhysicsAdapter can be unit-tested independently. Mock gravity and wind; verify trajectories. No need to mock terrain or Colyseus.

3. **Determinism**: Stateless design means same inputs always produce identical outputs. This enables both server simulation and client-side prediction (future feature) to use the same code.

4. **Reusability**: Client can use PhysicsAdapter for UI hints (aiming trajectory preview) without duplicating collision logic or initializing full game state.

5. **Shallow to understand**: Separating "pure math" (PhysicsAdapter) from "game logic" (GameRoom) makes each module's job clear. Future changes to collision detection won't touch physics code.

## Consequences

**Benefits**:
- Physics logic is testable, localized, and reusable
- Wind coefficient mismatch eliminated (single source of truth)
- Trajectory bounds validated (PhysicsAdapter receives map dimensions)
- Foundation for future client-side prediction

**Costs**:
- GameRoom's physics loop becomes less self-contained (calls two modules: PhysicsAdapter + terrain)
- Projectile objects must be plain `{x, y, vx, vy}` to avoid coupling PhysicsAdapter to domain types

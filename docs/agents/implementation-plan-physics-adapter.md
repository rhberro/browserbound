# Implementation Plan: Unify Physics into PhysicsAdapter

## Overview

Refactor scattered physics logic into a unified `PhysicsAdapter` module and `WindManager`. This eliminates dead code, fixes bugs (wind coefficient mismatch, trajectory bounds), and establishes a testable seam.

**Timeline estimate**: ~2–3 hours (implement adapters, refactor GameRoom, add tests)

---

## Phase 1: Implement Core Adapters

### Step 1.1: Implement PhysicsAdapter

**File**: `shared/src/adapters/PhysicsAdapter.ts`

**What to do**:
- Implement `createProjectile(angle, power)` — convert angle/power to vx/vy
- Implement `updateAllProjectiles(projectiles, wind)` — advance each projectile one frame
  - Apply gravity: `projectile.vy += this.gravity`
  - Apply wind force: `projectile.vx += wind.magnitude * cos(wind.angle) * this.windIntegration`
  - Integrate position: `projectile.x += projectile.vx; projectile.y += projectile.vy`

### Step 1.2: Implement WindManager

**File**: `server/src/adapters/WindManager.ts`

**What to do**:
- Implement `generateNewWind()` — random magnitude, angle, duration
- Implement `advance()` — decrement duration; spawn new wind when it expires

---

## Phase 2: Refactor GameRoom

### Step 2.1: Initialize PhysicsAdapter and WindManager

Update `server/src/rooms/GameRoom.ts` constructor.

### Step 2.2: Update Fire Message Handler

Replace hardcoded velocity math with PhysicsAdapter.createProjectile().

### Step 2.3: Update Physics Loop

Replace physics loop (lines 260–276) with PhysicsAdapter.updateAllProjectiles() + WindManager.advance().

### Step 2.4: Delete Dead Code

- Delete `calculateTrajectory()` from `shared/src/physics.ts`
- Delete unused `ProjectileSimulation` class

---

## Phase 3: Update Client

### Step 3.1: Display Wind on Client

Receive and render wind state from server.

---

## Phase 4: Testing

Create unit tests for PhysicsAdapter and WindManager.

---

## Checklist

- [ ] PhysicsAdapter implemented and tested
- [ ] WindManager implemented and tested
- [ ] GameRoom fire handler updated
- [ ] GameRoom physics loop updated
- [ ] Dead code deleted
- [ ] Client updated to receive wind state
- [ ] All tests pass

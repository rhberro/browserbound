/**
 * PhysicsAdapter: Stateless physics engine for projectile simulation.
 *
 * Owns: velocity calculations, gravity, wind force application
 * Doesn't own: terrain collision, projectile lifecycle, wind persistence
 */

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Wind {
  magnitude: number;
  angle: number; // radians [0, 2π)
}

export interface PhysicsConfig {
  gravity: number; // pixels/frame² — downward acceleration
  windIntegration: number; // scaling factor for wind force
}

export class PhysicsAdapter {
  private gravity: number;
  private windIntegration: number;

  constructor(config: PhysicsConfig) {
    this.gravity = config.gravity;
    this.windIntegration = config.windIntegration;
  }

  /**
   * Convert player aim (angle, power) to initial velocity.
   *
   * @param angle - Aim angle in radians [0, 2π), where 0 = right, π/2 = up
   * @param power - Aim power [0, 100]
   * @returns Initial velocity {vx, vy}
   */
  createProjectile(angle: number, power: number): { vx: number; vy: number } {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  /**
   * Advance all projectiles one frame given current wind.
   * Modifies projectiles in-place.
   */
  updateAllProjectiles(projectiles: Projectile[], wind: Wind): void {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}

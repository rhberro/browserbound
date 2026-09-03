/**
 * PhysicsAdapter: Stateless physics engine for projectile simulation.
 *
 * Owns: velocity calculations, gravity, wind force application
 * Doesn't own: terrain collision, projectile lifecycle, wind persistence
 *
 * Per-weapon ballistics (mass, wind influence) arrive as PARAMETERS, never as a
 * weapon lookup: this adapter must not learn what a "weapon" is, or the ADR 0001
 * boundary — velocity math only, no game rules — stops holding. See
 * `createProjectile` and `updateAllProjectiles`.
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

/**
 * Sanitise a divisor that comes from a config table.
 *
 * A mass of 0 (a field left unset, a weapon added without one) would divide the
 * launch speed to Infinity, and the projectile would leave the map on its first
 * frame with no collision ever reported — the shot simply vanishes and the turn
 * hangs on `nothingInFlight`. Falling back to the reference mass keeps a
 * mis-configured weapon merely wrong instead of unplayable.
 */
function safeMass(mass: number): number {
  return Number.isFinite(mass) && mass > 0 ? mass : 1;
}

/**
 * Sanitise a wind scale. Zero is MEANINGFUL here (a wind-immune projectile), so
 * only non-finite values fall back; negatives are clamped away because a
 * projectile that accelerates INTO the wind would make the wind dial lie.
 */
function safeWindInfluence(influence: number): number {
  if (!Number.isFinite(influence)) return 1;
  return Math.max(0, influence);
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
   * Mass DIVIDES the launch speed, following GunBound's
   * `Projectile.InitializeMovement` (`speed * force * ForceFactor / mass`): the
   * same power sends a heavier shell a shorter distance, so each weapon has its
   * own ranging feel instead of every weapon flying the identical arc.
   *
   * Range on flat ground goes as speed², i.e. as 1/mass² — a 20% heavier shell
   * reaches ~69% as far, not 83%. That squaring is why the values in
   * WeaponConfigAdapter sit in a narrow band around 1.
   *
   * @param angle - Aim angle in radians [0, 2π), where 0 = right, π/2 = up
   * @param power - Aim power [0, 100]
   * @param mass - Weapon mass; 1 is the reference weapon and leaves the arc
   *               exactly as it was before per-weapon mass existed.
   * @returns Initial velocity {vx, vy}
   */
  createProjectile(angle: number, power: number, mass: number = 1): { vx: number; vy: number } {
    const speed = (power * 0.3) / safeMass(mass);
    return {
      vx: speed * Math.cos(angle),
      vy: -speed * Math.sin(angle),
    };
  }

  /**
   * Advance all projectiles one frame given current wind.
   * Modifies projectiles in-place.
   *
   * `windInfluenceOf` scales the wind acceleration PER PROJECTILE (GunBound's
   * `xWind * wForce * windInfluence`), so a heavy shell shrugs off a gust that
   * pushes a light one off target, and an influence of 0 is fully wind-immune.
   * It is a callback rather than a field on Projectile because the schema
   * Projectile is a synchronized object and carries only `weaponType`; resolving
   * that to a number is the caller's job, which also keeps weapon config out of
   * this file.
   *
   * Defaults to 1 for every projectile, so callers that do not care about
   * per-weapon wind (tests, the client's wind-dial geometry check) get exactly
   * the previous behaviour.
   */
  updateAllProjectiles<T extends Projectile>(
    projectiles: T[],
    wind: Wind,
    windInfluenceOf: (projectile: T) => number = () => 1
  ): void {
    // Hoisted out of the loop: the wind acceleration before per-projectile
    // scaling is the same for everything in the air this frame.
    const baseWindAx = wind.magnitude * Math.cos(wind.angle) * this.windIntegration;
    const baseWindAy = wind.magnitude * Math.sin(wind.angle) * this.windIntegration;

    for (const proj of projectiles) {
      proj.vy += this.gravity;

      const influence = safeWindInfluence(windInfluenceOf(proj));
      proj.vx += baseWindAx * influence;
      proj.vy += baseWindAy * influence;

      proj.x += proj.vx;
      proj.y += proj.vy;
    }
  }
}

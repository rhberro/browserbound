/**
 * WeaponConfigAdapter: Declarative weapon specifications.
 *
 * Defines weapon behavior (projectile count, spread, timing) in a config-driven way.
 * Replaces hardcoded if/else chains in the fire() method.
 */

export type SpreadPattern = 'none' | 'randomSmall' | 'fixedWide';

export interface ProjectileSpawn {
  count: number; // How many projectiles
  spreadPattern: SpreadPattern; // How angles spread
  spreadAmount?: number; // Spread range in degrees (for randomSmall/fixedWide)
  fireFrame?: number; // When to fire relative to trigger (0 = immediate)
  fireFrameStagger?: number; // If set, stagger fires by this many frames (for burst)
  usePhysicsAdapter?: boolean; // Use PhysicsAdapter.createProjectile() instead of raw velocity
}

export interface WeaponSpec {
  id: number;
  name: string;
  projectileCount: number;
  projectiles: ProjectileSpawn[];
  description?: string;

  /**
   * Radius (px) of the hole erased from the terrain mask by one projectile.
   *
   * Deliberately INDEPENDENT of splashRadius. Crater radius is constrained by the
   * locomotion step-up rule (STEP_LIMIT = 12): a crater rim steeper than the step
   * limit is unclimbable, so a big crater traps whoever is standing in it. That is
   * a terrain-tuning knob. Damage is a balance knob. Coupling the two would mean
   * every terrain fix silently rebalances the weapon, so they stay separate fields
   * even where they currently hold similar numbers.
   */
  craterRadius: number;

  /**
   * Blast falloff scale (px). NOT the edge of the blast — the name is inherited
   * and is now misleading. This is the distance at which a target takes ~50% of
   * maxDamage. Damage decays to exactly zero at splashRange(splashRadius), i.e.
   * `2 * splashRadius + 4`, which is a little over twice this value.
   *
   * Callers deciding which characters to test MUST use splashRange(), not this.
   */
  splashRadius: number;

  /**
   * Peak damage of a single projectile — what splashDamage() returns in the
   * saturated core of the blast. Fully independent of splashRadius: splashRadius
   * sets how far the damage reaches, maxDamage sets how hard it lands.
   */
  maxDamage: number;

  /**
   * Knockback impulse per point of damage dealt (velocity units per damage point).
   * See knockbackImpulse().
   */
  knockbackScale: number;
}

export const WEAPONS: Record<number, WeaponSpec> = {
  1: {
    id: 1,
    name: 'Normal',
    projectileCount: 1,
    projectiles: [
      {
        count: 1,
        spreadPattern: 'none',
        fireFrame: 0,
        usePhysicsAdapter: true, // Uses PhysicsAdapter.createProjectile()
      },
    ],
    description: 'Single projectile, standard ballistics',
    // Reference weapon: one heavy shot. Crater 50 matches the value the game has
    // always hardcoded, so terrain behaviour is unchanged for the baseline weapon.
    // 50 damage in the core -> two clean hits to kill from full health.
    // Splash 40 means 25 damage at 40px and zero at 84px; damage therefore reaches
    // a bit beyond the crater rim, which is what makes "close" meaningful.
    craterRadius: 50,
    splashRadius: 40,
    maxDamage: 50,
    // 50 dmg * 0.35 = 17.5 px/frame (clamped to TERMINAL_VELOCITY 12) on direct hit.
    // Noticeably shoves the target across the map.
    knockbackScale: 0.35,
  },
  2: {
    id: 2,
    name: 'Burst',
    projectileCount: 3,
    projectiles: [
      {
        count: 3,
        spreadPattern: 'randomSmall',
        spreadAmount: 0.4, // ±0.2° random variation
        fireFrame: 0,
        fireFrameStagger: 5, // Fire at frames 0, 5, 10
        usePhysicsAdapter: false,
      },
    ],
    description: '3 projectiles in quick succession with ±0.2° random spread',
    // Three staggered projectiles on a ±0.2° spread land almost on top of each
    // other, so per-projectile numbers must be well under a third of Normal or
    // Burst becomes a strictly better Normal. 16 dmg x 3 = 48 if all three
    // converge — just under Normal's 50, and only at short range where the spread
    // has not opened up.
    // Splash 16 (zero at 36px) keeps each pellet tight: Burst is a precision
    // weapon, so it must not inherit Normal's forgiving 84px reach.
    // Crater 20 x3 overlapping digs roughly a Normal-sized hole, and each
    // individual rim stays near STEP_LIMIT so a near miss does not wall someone in.
    craterRadius: 20,
    splashRadius: 16,
    maxDamage: 16,
    // Higher per-damage scale so a single 16-dmg projectile visibly shoves
    // (16 * 0.40 = 6.4); three stacked hits total 12 px/frame (terminal velocity).
    knockbackScale: 0.40,
  },
  3: {
    id: 3,
    name: 'Shotgun',
    projectileCount: 3,
    projectiles: [
      {
        count: 3,
        spreadPattern: 'fixedWide',
        spreadAmount: 1, // ±1° fixed spread
        fireFrame: 0,
        usePhysicsAdapter: false,
      },
    ],
    description: '3 projectiles spread ±1°, fires simultaneously',
    // Wider fixed spread than Burst, fired simultaneously: at range the three
    // pellets separate, so the all-three-land case is a close-range reward.
    // Slightly higher per-pellet damage than Burst to pay for that unreliability,
    // but trimmed to 18 (from a first pass at 20) because splash 20 reaches 44px
    // — wide enough that dispersed pellets each still clip a target for partial
    // damage. 54 point blank, ~30 at a range where the pattern has opened up.
    craterRadius: 25,
    splashRadius: 20,
    maxDamage: 18,
    // 18 * 0.40 = 7.2 per pellet; ~10.8 if all three connect at similar ranges.
    knockbackScale: 0.40,
  },
};

/**
 * Get weapon spec by ID, with fallback to Normal (1) if not found.
 */
export function getWeapon(weaponType: number): WeaponSpec {
  return WEAPONS[weaponType] || WEAPONS[1];
}

/**
 * Get all available weapons for UI display.
 */
export function getAllWeapons(): WeaponSpec[] {
  return Object.values(WEAPONS).sort((a, b) => a.id - b.id);
}

/**
 * Generate projectile specs for a weapon, given an aim angle.
 * Returns array of { angle, fireFrame } for each projectile.
 */
export function generateProjectileSpecs(
  weaponType: number,
  aimAngle: number
): Array<{ angle: number; fireFrame: number }> {
  const weapon = getWeapon(weaponType);
  const specs: Array<{ angle: number; fireFrame: number }> = [];

  for (const spawn of weapon.projectiles) {
    const baseFireFrame = spawn.fireFrame ?? 0;
    const stagger = spawn.fireFrameStagger ?? 0;

    if (spawn.spreadPattern === 'none') {
      // Single projectile, no spread
      specs.push({
        angle: aimAngle,
        fireFrame: baseFireFrame,
      });
    } else if (spawn.spreadPattern === 'randomSmall') {
      // Random small spread, typically for burst weapons
      const maxSpread = (spawn.spreadAmount ?? 0.4) / 2; // Convert from total to half-range
      for (let i = 0; i < spawn.count; i++) {
        const randomOffset = (Math.random() * maxSpread * 2 - maxSpread) * (Math.PI / 180);
        specs.push({
          angle: aimAngle + randomOffset,
          fireFrame: baseFireFrame + i * stagger,
        });
      }
    } else if (spawn.spreadPattern === 'fixedWide') {
      // Fixed wide spread, typically for shotgun weapons
      const spread = (spawn.spreadAmount ?? 1) * (Math.PI / 180); // Convert degrees to radians
      const totalSpread = spread * (spawn.count - 1);
      const startAngle = aimAngle - totalSpread / 2;

      for (let i = 0; i < spawn.count; i++) {
        specs.push({
          angle: startAngle + i * spread,
          fireFrame: baseFireFrame + i * stagger,
        });
      }
    }
  }

  return specs;
}

/**
 * Outer edge of a blast: the distance at which splashDamage() reaches exactly 0.
 *
 * Callers selecting which characters an explosion touches MUST range-test against
 * this, NOT against splashRadius — the damage curve extends to a little over twice
 * splashRadius. Testing against splashRadius alone would silently drop every
 * target in the outer (and largest) half of the blast.
 */
export function splashRange(splashRadius: number): number {
  if (!(splashRadius > 0)) return 0;
  return 2 * splashRadius + 4;
}

/**
 * Splash damage falloff — the Hedgewars `doMakeExplosion` curve, normalised to
 * [0, 1] and scaled by the weapon's maxDamage.
 *
 *   range = 2*R + 4                               // damage reaches 0 here
 *   norm  = min((range - distance) / (2*R), 1)    // 1 in the core, ~0.5 at d = R
 *   dmg   = maxDamage * norm
 *
 * Shape notes: the curve saturates at maxDamage for the innermost 4px (the `min`
 * clamp), then decays linearly to exactly zero at `range`. A target at
 * distance R — the field misleadingly named splashRadius — takes ~50%.
 *
 * Normalising is what makes maxDamage a real, independent knob: the raw Hedgewars
 * expression yields damage numerically equal to R, which would force peak damage
 * to track the blast size, and truncating it at R instead of its true zero at
 * `2R+4` would leave a ~50%-damage cliff at the rim.
 *
 * @param distance Distance in px from the explosion centre to the target.
 * @param splashRadius The weapon's splashRadius (falloff scale, ~50% point).
 * @param maxDamage The weapon's maxDamage (core damage).
 * @returns Damage in health points; 0 at or beyond splashRange(), never negative.
 */
export function splashDamage(distance: number, splashRadius: number, maxDamage: number): number {
  if (!(splashRadius > 0) || !(maxDamage > 0)) return 0;
  // Negative distances are meaningless; treat them as a direct hit.
  const d = Math.max(0, distance);
  const range = splashRange(splashRadius);
  if (d >= range) return 0;

  const norm = Math.min((range - d) / (2 * splashRadius), 1);
  return Math.max(0, maxDamage * norm);
}

/**
 * Knockback impulse applied to a character hit by a blast.
 *
 * Magnitude is proportional to the DAMAGE DEALT, not to distance directly, so a
 * blast that barely scratches a target barely moves it, and the two always agree.
 * Direction is the radially normalised vector from the blast centre to the target.
 *
 *   mag = knockbackScale * damage
 *   ix  = mag * dx / dist;  iy = mag * dy / dist
 *
 * DIVERGENCE FROM HEDGEWARS: Hedgewars applies knockback axis-separably, using
 * sign(dx) and sign(dy) as the direction. That gives a target at 45° an impulse of
 * (m, m) — magnitude m*sqrt(2) — while a target directly overhead gets (0, m), for
 * identical damage. That sqrt(2) advantage/penalty is an artifact of the
 * implementation, not a design decision, and it is invisible to players trying to
 * read the game. Normalising costs one hypot per hit and removes the unfairness.
 *
 * @param dx Target x minus explosion x.
 * @param dy Target y minus explosion y.
 * @param damage Damage actually dealt to this target (see splashDamage()).
 * @param knockbackScale The weapon's knockbackScale.
 * @returns Impulse to add to the character's velocity.
 */
export function knockbackImpulse(
  dx: number,
  dy: number,
  damage: number,
  knockbackScale: number
): { ix: number; iy: number } {
  const dist = Math.hypot(dx, dy);
  // Direct overlap: the direction is undefined, and dividing by 0 would produce
  // NaN velocities that poison the whole physics step. No impulse is the only
  // sane answer.
  if (dist === 0 || !Number.isFinite(dist)) return { ix: 0, iy: 0 };
  if (!(damage > 0)) return { ix: 0, iy: 0 };

  const mag = knockbackScale * damage;
  return { ix: (mag * dx) / dist, iy: (mag * dy) / dist };
}

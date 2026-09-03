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
   * Step Window (STEP_UP_LIMIT): a rim that rises faster than the step limit per
   * pixel travelled is unclimbable, so a big crater traps whoever is standing in
   * it. What saves these values at the current limit is that a circular rim is a
   * SLOPE — it only approaches vertical at the very edge — plus `collapseLips`,
   * which flattens the overhangs a crater digs into existing terrain. That is a
   * terrain-tuning knob. Damage is a balance knob. Coupling the two would mean
   * every terrain fix silently rebalances the weapon, so they stay separate fields
   * even where they currently hold similar numbers.
   */
  craterRadius: number;

  /**
   * Blast falloff scale (px). The distance at which a target takes exactly
   * `maxDamage` — the reference point of the inverse-distance curve. Damage
   * reaches zero at splashRange(splashRadius) = `2 * splashRadius + 4`.
   *
   * Callers deciding which characters to test MUST use splashRange(), not this.
   */
  splashRadius: number;

  /**
   * Damage at distance `splashRadius`, the reference point the inverse-distance
   * curve is normalised to pass through. A dead-centre hit is clamped to
   * `SPLASH_MAX_MULTIPLIER` × this, so this is NOT the peak — it is the value a
   * target at the falloff scale takes.
   */
  maxDamage: number;

  /**
   * Knockback impulse per point of damage dealt (velocity units per damage point).
   * See knockbackImpulse().
   */
  knockbackScale: number;

  /**
   * Mass divides launch speed (see PhysicsAdapter.createProjectile), so a
   * heavier shell needs more power for the same range and a lighter one carries
   * further for free. 1 is the reference mass and leaves the arc unchanged.
   * TUNE.
   */
  mass: number;

  /**
   * Scales how strongly wind bends this projectile (see
   * PhysicsAdapter.updateAllProjectiles). 1 is the reference; a light shell
   * shrugs wind off less, so values above 1 drift more, and 0 is wind-immune.
   * TUNE.
   */
  windInfluence: number;

  /**
   * Delay cost added to the firer's total when this weapon is fired. Cheaper
   * weapons buy tempo: whoever has the lowest total acts next, so firing a
   * cheap shot can earn two turns in a row (issue #35). TUNE.
   */
  delayCost: number;
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
    // maxDamage 25 is the damage AT splashRadius 40; a direct hit is clamped to
    // 2× = 50 — two clean hits to kill from full health — and damage reaches
    // zero at 84px, a little beyond the crater rim.
    craterRadius: 50,
    splashRadius: 40,
    maxDamage: 25,
    // 50 dmg * 0.35 = ~17px of SIDEWAYS shove on a direct hit. Only the
    // horizontal component is spent — since ADR 0004 nothing moves a character
    // upward — and it is spent as a walked displacement, so it follows slopes,
    // stops against walls, and pushes the target off a ledge rather than
    // launching it. TUNE via KNOCKBACK_SHOVE_SCALE.
    knockbackScale: 0.35,
    // The reference shell: mass 1 leaves the arc untouched, wind 1 leaves the
    // existing drift untouched. Heavier and less wind-sensitive than the pellet
    // weapons, as the "heavy single shot" name implies.
    mass: 1.0,
    windInfluence: 1.0,
    // The baseline tempo. Cheaper than the pellet weapons, so the reliable
    // single shot also comes back around sooner. TUNE.
    delayCost: 770,
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
    // Burst becomes a strictly better Normal. 8 dmg at R x 3 = 24; a point-blank
    // direct hit is 2× = 16 each — 48 if all three converge, just under Normal's
    // 50, and only at short range where the spread has not opened up.
    // Splash 16 (zero at 36px) keeps each pellet tight: Burst is a precision
    // weapon, so it must not inherit Normal's forgiving 84px reach.
    // Crater 20 x3 overlapping digs roughly a Normal-sized hole, and each
    // individual rim stays shallow enough that a near miss does not wall someone in.
    craterRadius: 20,
    splashRadius: 16,
    maxDamage: 8,
    // Higher per-damage scale so a single 16-dmg projectile visibly shoves
    // (16 * 0.40 = 6.4, so ~6px); three stacked hits shove ~19px in total.
    knockbackScale: 0.40,
    // Lighter pellets than Normal: they carry a little further and drift a
    // little more in wind, which suits a tight-spread precision burst. TUNE.
    mass: 0.95,
    windInfluence: 1.2,
    // A touch more tempo than Normal to pay for the tighter precision ceiling.
    // TUNE.
    delayCost: 830,
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
    // Slightly higher per-pellet damage than Burst to pay for that unreliability:
    // 9 at R (a direct hit is 2× = 18), and splash 20 reaches 44px — wide enough
    // that dispersed pellets each still clip a target for partial damage.
    // 54 point blank, ~30 at a range where the pattern has opened up.
    craterRadius: 25,
    splashRadius: 20,
    maxDamage: 9,
    // 18 * 0.40 = 7.2 per pellet; ~10.8 if all three connect at similar ranges.
    knockbackScale: 0.40,
    // Lightest pellets of the three: the furthest carry, but also the most wind
    // drift — which the wide spread already punishes at range. TUNE.
    mass: 0.9,
    windInfluence: 1.4,
    // Most expensive of the three: the wide spread is a close-range reward, and
    // the tempo cost is the tax on it. TUNE.
    delayCost: 900,
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
 * The clamp on the inverse-distance curve: a direct hit deals at most this
 * multiple of maxDamage. GunBound's `BaseDamage * radius / distance` is
 * unbounded at the centre; ours saturates so a dead-centre hit is strong and
 * predictable rather than arbitrary. TUNE.
 */
export const SPLASH_MAX_MULTIPLIER = 2;

/**
 * Splash damage falloff — an inverse-distance curve, clamped at close range.
 *
 *   range = 2*R + 4                     // damage reaches 0 here
 *   edge  = R / range                   // what a raw R/d curve still holds at the edge
 *   norm  = (R / d - edge) / (1 - edge) // 1 at d = R, 0 at d = range
 *   dmg   = maxDamage * min(SPLASH_MAX_MULTIPLIER, norm)
 *
 * Shape notes: damage is proportional to R/d, so a glancing hit is far weaker
 * than a direct one and a dead-centre hit is far stronger — up to the clamp.
 * Subtracting `edge` and re-normalising is what makes the curve reach EXACTLY
 * zero at `range` with no discontinuity at the boundary. A raw 1/d curve
 * (GunBound's) does not: it still holds `R/range` ≈ 50% at the edge and then
 * snaps to zero, leaving a cliff the linear ramp this replaced did not have.
 *
 * The clamp is the deliberate divergence from GunBound. Their formula divides
 * by the centre distance with nothing flooring it, so a hit at distance ~0 is
 * effectively unbounded; ours saturates at `SPLASH_MAX_MULTIPLIER` × maxDamage.
 *
 * @param distance Distance in px from the blast to the nearest point of the body.
 * @param splashRadius The weapon's splashRadius (falloff scale; damage here = maxDamage).
 * @param maxDamage The weapon's maxDamage (damage at distance splashRadius).
 * @returns Damage in health points; 0 at or beyond splashRange(), never negative.
 */
export function splashDamage(distance: number, splashRadius: number, maxDamage: number): number {
  if (!(splashRadius > 0) || !(maxDamage > 0)) return 0;
  // Negative distances are meaningless; treat them as a direct hit.
  const d = Math.max(0, distance);
  const range = splashRange(splashRadius);
  if (d >= range) return 0;

  const edge = splashRadius / range;
  const norm = (splashRadius / Math.max(d, 1) - edge) / (1 - edge);
  return Math.max(0, maxDamage * Math.min(SPLASH_MAX_MULTIPLIER, norm));
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

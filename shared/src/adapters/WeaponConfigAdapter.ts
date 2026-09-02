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

import { describe, it, expect } from 'vitest';
import {
  getWeapon,
  getAllWeapons,
  generateProjectileSpecs,
  splashDamage,
  splashRange,
  knockbackImpulse,
  WEAPONS,
} from '../WeaponConfigAdapter';
import { TERMINAL_VELOCITY } from '../../types';

describe('WeaponConfigAdapter', () => {
  describe('WEAPONS config', () => {
    it('should have 3 weapons defined', () => {
      expect(Object.keys(WEAPONS)).toHaveLength(3);
    });

    it('should have Normal (1), Burst (2), and Shotgun (3) weapons', () => {
      expect(WEAPONS[1].name).toBe('Normal');
      expect(WEAPONS[2].name).toBe('Burst');
      expect(WEAPONS[3].name).toBe('Shotgun');
    });

    it('Normal weapon should have 1 projectile', () => {
      expect(WEAPONS[1].projectileCount).toBe(1);
    });

    it('Burst weapon should have 3 projectiles', () => {
      expect(WEAPONS[2].projectileCount).toBe(3);
    });

    it('Shotgun weapon should have 3 projectiles', () => {
      expect(WEAPONS[3].projectileCount).toBe(3);
    });
  });

  describe('getWeapon', () => {
    it('should return Normal weapon for type 1', () => {
      const weapon = getWeapon(1);
      expect(weapon.id).toBe(1);
      expect(weapon.name).toBe('Normal');
    });

    it('should return Burst weapon for type 2', () => {
      const weapon = getWeapon(2);
      expect(weapon.id).toBe(2);
      expect(weapon.name).toBe('Burst');
    });

    it('should return Shotgun weapon for type 3', () => {
      const weapon = getWeapon(3);
      expect(weapon.id).toBe(3);
      expect(weapon.name).toBe('Shotgun');
    });

    it('should fallback to Normal weapon for unknown type', () => {
      const weapon = getWeapon(999);
      expect(weapon.id).toBe(1);
      expect(weapon.name).toBe('Normal');
    });
  });

  describe('getAllWeapons', () => {
    it('should return all weapons sorted by id', () => {
      const weapons = getAllWeapons();
      expect(weapons).toHaveLength(3);
      expect(weapons[0].id).toBe(1);
      expect(weapons[1].id).toBe(2);
      expect(weapons[2].id).toBe(3);
    });
  });

  describe('generateProjectileSpecs', () => {
    it('Normal weapon should generate 1 projectile at aim angle', () => {
      const specs = generateProjectileSpecs(1, Math.PI / 4); // 45°
      expect(specs).toHaveLength(1);
      expect(specs[0].angle).toBe(Math.PI / 4);
      expect(specs[0].fireFrame).toBe(0);
    });

    it('Burst weapon should generate 3 projectiles with staggered fire', () => {
      const aimAngle = Math.PI / 4;
      const specs = generateProjectileSpecs(2, aimAngle);
      expect(specs).toHaveLength(3);

      // First projectile fires at frame 0
      expect(specs[0].fireFrame).toBe(0);
      // Second at frame 5
      expect(specs[1].fireFrame).toBe(5);
      // Third at frame 10
      expect(specs[2].fireFrame).toBe(10);

      // All angles should be close to aim angle (within ±0.2°)
      for (const spec of specs) {
        const angleDiff = Math.abs(spec.angle - aimAngle);
        const maxDeviation = (0.2 * Math.PI) / 180; // 0.2° in radians
        expect(angleDiff).toBeLessThanOrEqual(maxDeviation);
      }
    });

    it('Shotgun weapon should generate 3 projectiles spread ±1° simultaneously', () => {
      const aimAngle = Math.PI / 4;
      const specs = generateProjectileSpecs(3, aimAngle);
      expect(specs).toHaveLength(3);

      // All fire at same time
      for (const spec of specs) {
        expect(spec.fireFrame).toBe(0);
      }

      // Spread should be ±1° (π/180 radians)
      const spreadRad = (1 * Math.PI) / 180;
      expect(specs[0].angle).toBeCloseTo(aimAngle - spreadRad, 5);
      expect(specs[1].angle).toBeCloseTo(aimAngle, 5);
      expect(specs[2].angle).toBeCloseTo(aimAngle + spreadRad, 5);
    });

    it('should handle zero aim angle correctly', () => {
      const specs = generateProjectileSpecs(3, 0);
      expect(specs).toHaveLength(3);
      expect(specs[1].angle).toBeCloseTo(0, 5);
    });

    it('should handle large aim angles correctly', () => {
      const aimAngle = 2 * Math.PI - 0.1; // Just before 2π
      const specs = generateProjectileSpecs(3, aimAngle);
      expect(specs).toHaveLength(3);
    });
  });

  describe('weapon randomness', () => {
    it('Burst weapon should have different random spread on each call', () => {
      const aimAngle = Math.PI / 4;
      const specs1 = generateProjectileSpecs(2, aimAngle);
      const specs2 = generateProjectileSpecs(2, aimAngle);

      // Angles should be different due to randomness
      let allDifferent = false;
      for (let i = 0; i < specs1.length; i++) {
        if (Math.abs(specs1[i].angle - specs2[i].angle) > 0.0001) {
          allDifferent = true;
          break;
        }
      }
      expect(allDifferent).toBe(true);
    });

    it('Shotgun weapon should generate same spread every time', () => {
      const aimAngle = Math.PI / 4;
      const specs1 = generateProjectileSpecs(3, aimAngle);
      const specs2 = generateProjectileSpecs(3, aimAngle);

      // Angles should be identical
      for (let i = 0; i < specs1.length; i++) {
        expect(specs1[i].angle).toBeCloseTo(specs2[i].angle, 10);
      }
    });
  });

  describe('damage and knockback config', () => {
    it('every weapon should define all four combat fields as positive numbers', () => {
      for (const weapon of getAllWeapons()) {
        expect(weapon.craterRadius).toBeGreaterThan(0);
        expect(weapon.splashRadius).toBeGreaterThan(0);
        expect(weapon.maxDamage).toBeGreaterThan(0);
        expect(weapon.knockbackScale).toBeGreaterThan(0);
      }
    });

    it('maxDamage should be the peak of every weapon curve', () => {
      for (const weapon of getAllWeapons()) {
        expect(splashDamage(0, weapon.splashRadius, weapon.maxDamage)).toBeCloseTo(
          weapon.maxDamage,
          10
        );
      }
    });

    it('multi-projectile weapons should hit softer per projectile than Normal', () => {
      expect(WEAPONS[2].maxDamage).toBeLessThan(WEAPONS[1].maxDamage / 2);
      expect(WEAPONS[3].maxDamage).toBeLessThan(WEAPONS[1].maxDamage / 2);
      expect(WEAPONS[2].splashRadius).toBeLessThan(WEAPONS[1].splashRadius);
      expect(WEAPONS[3].splashRadius).toBeLessThan(WEAPONS[1].splashRadius);
    });

    it('should not let a full multi-projectile volley out-damage a Normal direct hit by much', () => {
      // All three projectiles converging is the best case for Burst/Shotgun and
      // must stay in the same league as Normal's single core hit, not above it.
      for (const id of [2, 3]) {
        const volley = WEAPONS[id].maxDamage * WEAPONS[id].projectileCount;
        expect(volley).toBeLessThanOrEqual(WEAPONS[1].maxDamage * 1.1);
      }
    });

    it('should let a full volley saturate the terminal-velocity clamp without overwhelming it', () => {
      // Every weapon is tuned so that a clean hit SATURATES the clamp: the
      // airborne integrator caps horizontal knockback at TERMINAL_VELOCITY every
      // tick, and a direct hit that lands under that cap would barely move the
      // target. So an impulse above TERMINAL_VELOCITY is the intent, not a bug.
      //
      // What still needs bounding is how far above. The clamp discards the
      // excess, so a wildly oversized impulse buys nothing while making the
      // knockbackScale field read as if it did — two weapons could differ on
      // paper and be indistinguishable in play. Twice terminal velocity keeps
      // every weapon inside the range where the number still means something.
      for (const weapon of getAllWeapons()) {
        const volleyImpulse = weapon.maxDamage * weapon.knockbackScale * weapon.projectileCount;
        expect(volleyImpulse).toBeGreaterThanOrEqual(TERMINAL_VELOCITY);
        expect(volleyImpulse).toBeLessThanOrEqual(TERMINAL_VELOCITY * 2);
      }
    });

    it('should keep splashRadius independent of craterRadius', () => {
      // Not an equality ban, a coupling ban: the fields must be separately
      // settable. At least one weapon differs, proving nothing derives one
      // from the other.
      const differs = getAllWeapons().some((w) => w.splashRadius !== w.craterRadius);
      expect(differs).toBe(true);
    });

    it('should keep maxDamage independent of splashRadius', () => {
      const differs = getAllWeapons().some((w) => w.maxDamage !== w.splashRadius);
      expect(differs).toBe(true);
    });
  });

  describe('splashRange', () => {
    it('should be 2R + 4', () => {
      expect(splashRange(50)).toBe(104);
      expect(splashRange(16)).toBe(36);
    });

    it('should be 0 for a non-positive radius', () => {
      expect(splashRange(0)).toBe(0);
      expect(splashRange(-5)).toBe(0);
    });

    it('should be the exact point where damage hits zero', () => {
      for (const weapon of getAllWeapons()) {
        const range = splashRange(weapon.splashRadius);
        expect(splashDamage(range - 0.001, weapon.splashRadius, weapon.maxDamage)).toBeGreaterThan(
          0
        );
        expect(splashDamage(range, weapon.splashRadius, weapon.maxDamage)).toBe(0);
      }
    });
  });

  describe('splashDamage', () => {
    it('should deal maxDamage in the saturated core, independent of splashRadius', () => {
      expect(splashDamage(0, 40, 50)).toBeCloseTo(50, 10);
      expect(splashDamage(0, 16, 50)).toBeCloseTo(50, 10);
      expect(splashDamage(0, 40, 7)).toBeCloseTo(7, 10);
    });

    it('should deal about half of maxDamage at distance == splashRadius', () => {
      // norm at d = R is (2R + 4 - R) / 2R = 0.5 + 2/R, i.e. just over half.
      expect(splashDamage(40, 40, 50)).toBeCloseTo(50 * (0.5 + 2 / 40), 10);
      expect(splashDamage(40, 40, 50) / 50).toBeGreaterThan(0.5);
      expect(splashDamage(40, 40, 50) / 50).toBeLessThan(0.6);
    });

    it('should fall off linearly outside the saturated core', () => {
      const r = 40;
      const max = 50;
      const perPixel = max / (2 * r);
      expect(splashDamage(20, r, max) - splashDamage(30, r, max)).toBeCloseTo(10 * perPixel, 10);
      expect(splashDamage(30, r, max) - splashDamage(40, r, max)).toBeCloseTo(10 * perPixel, 10);
    });

    it('should scale linearly with maxDamage at any fixed distance', () => {
      expect(splashDamage(30, 40, 100)).toBeCloseTo(splashDamage(30, 40, 50) * 2, 10);
    });

    it('should decay to zero with no discontinuity at the outer edge', () => {
      const r = 40;
      const max = 50;
      const range = splashRange(r);
      // Approaching the edge, damage tends to 0 rather than dropping off a cliff.
      expect(splashDamage(range - 1, r, max)).toBeLessThan(max * 0.02);
      expect(splashDamage(range - 1, r, max)).toBeGreaterThan(0);
      expect(splashDamage(range, r, max)).toBe(0);
    });

    it('should be monotonically non-increasing with distance', () => {
      let previous = Infinity;
      for (let d = 0; d <= 120; d++) {
        const dmg = splashDamage(d, 40, 50);
        expect(dmg).toBeLessThanOrEqual(previous);
        previous = dmg;
      }
    });

    it('should deal no damage at or beyond splashRange', () => {
      expect(splashDamage(104, 50, 50)).toBe(0);
      expect(splashDamage(105, 50, 50)).toBe(0);
      expect(splashDamage(1000, 50, 50)).toBe(0);
    });

    it('should still deal damage beyond splashRadius (range is ~2x)', () => {
      expect(splashDamage(60, 40, 50)).toBeGreaterThan(0);
    });

    it('should never return a negative value', () => {
      for (let d = 0; d <= 500; d += 7) {
        expect(splashDamage(d, 16, 16)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should treat a non-positive radius or damage as no blast', () => {
      expect(splashDamage(0, 0, 50)).toBe(0);
      expect(splashDamage(5, -10, 50)).toBe(0);
      expect(splashDamage(0, 40, 0)).toBe(0);
    });

    it('should treat a negative distance as a direct hit', () => {
      expect(splashDamage(-5, 40, 50)).toBeCloseTo(50, 10);
    });
  });

  describe('knockbackImpulse', () => {
    it('should push away from the blast in all four quadrants', () => {
      const cases = [
        { dx: 10, dy: 10 },
        { dx: -10, dy: 10 },
        { dx: -10, dy: -10 },
        { dx: 10, dy: -10 },
      ];
      for (const { dx, dy } of cases) {
        const { ix, iy } = knockbackImpulse(dx, dy, 20, 0.15);
        expect(Math.sign(ix)).toBe(Math.sign(dx));
        expect(Math.sign(iy)).toBe(Math.sign(dy));
      }
    });

    it('should scale magnitude with damage dealt', () => {
      const weak = knockbackImpulse(0, -10, 1, 0.15);
      const strong = knockbackImpulse(0, -10, 50, 0.15);
      expect(Math.hypot(weak.ix, weak.iy)).toBeCloseTo(0.15, 10);
      expect(Math.hypot(strong.ix, strong.iy)).toBeCloseTo(7.5, 10);
    });

    it('should give equal magnitude at 45 degrees and directly overhead (regression: no axis-separable sqrt(2) bias)', () => {
      const diagonal = knockbackImpulse(10, -10, 30, 0.15);
      const overhead = knockbackImpulse(0, -10, 30, 0.15);
      const diagonalMag = Math.hypot(diagonal.ix, diagonal.iy);
      const overheadMag = Math.hypot(overhead.ix, overhead.iy);
      expect(diagonalMag).toBeCloseTo(overheadMag, 10);
      expect(diagonalMag).toBeCloseTo(30 * 0.15, 10);
    });

    it('should have magnitude independent of distance for equal damage', () => {
      const near = knockbackImpulse(3, 4, 25, 0.2);
      const far = knockbackImpulse(300, 400, 25, 0.2);
      expect(Math.hypot(near.ix, near.iy)).toBeCloseTo(Math.hypot(far.ix, far.iy), 10);
    });

    it('should return a zero impulse without NaN when the target overlaps the blast', () => {
      const { ix, iy } = knockbackImpulse(0, 0, 50, 0.15);
      expect(Number.isNaN(ix)).toBe(false);
      expect(Number.isNaN(iy)).toBe(false);
      expect(ix).toBe(0);
      expect(iy).toBe(0);
    });

    it('should return a zero impulse when no damage was dealt', () => {
      expect(knockbackImpulse(10, 10, 0, 0.15)).toEqual({ ix: 0, iy: 0 });
    });
  });
});

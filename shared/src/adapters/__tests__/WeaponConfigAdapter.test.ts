import { describe, it, expect } from 'vitest';
import { getWeapon, getAllWeapons, generateProjectileSpecs, WEAPONS } from '../WeaponConfigAdapter';

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
});

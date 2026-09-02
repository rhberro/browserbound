import { describe, it, expect } from 'vitest';
import { PhysicsAdapter, Projectile, Wind } from '../PhysicsAdapter';

describe('PhysicsAdapter', () => {
  const adapter = new PhysicsAdapter({
    gravity: 0.4,
    windIntegration: 0.1,
  });

  describe('createProjectile', () => {
    it('creates projectile with correct velocity from angle and power', () => {
      const vel = adapter.createProjectile(0, 100); // 0 radians = right
      expect(vel.vx).toBeGreaterThan(0);
      expect(Math.abs(vel.vy)).toBeLessThan(0.01); // No vertical component when angle = 0

      const vel45 = adapter.createProjectile(Math.PI / 4, 100); // 45 degrees
      expect(vel45.vx).toBeGreaterThan(0);
      expect(vel45.vy).toBeLessThan(0); // Negative because up is -y
    });

    it('applies power scaling correctly', () => {
      const vel1 = adapter.createProjectile(0, 50);
      const vel2 = adapter.createProjectile(0, 100);
      expect(vel2.vx).toBeCloseTo(vel1.vx * 2, 5);
    });

    it('handles 90 degree angle (straight up)', () => {
      const vel = adapter.createProjectile(Math.PI / 2, 100);
      expect(Math.abs(vel.vx)).toBeLessThan(0.01); // Should be ~0
      expect(vel.vy).toBeLessThan(0); // Should be negative
    });

    it('handles zero power', () => {
      const vel = adapter.createProjectile(0, 0);
      expect(Math.abs(vel.vx)).toBeLessThan(0.01);
      expect(Math.abs(vel.vy)).toBeLessThan(0.01);
    });
  });

  describe('updateAllProjectiles', () => {
    it('applies gravity to projectiles', () => {
      const projectiles: Projectile[] = [
        { x: 100, y: 100, vx: 0, vy: 0 },
      ];
      const wind: Wind = { magnitude: 0, angle: 0 };

      adapter.updateAllProjectiles(projectiles, wind);

      expect(projectiles[0].vy).toBe(0.4); // gravity value
      expect(projectiles[0].y).toBe(100.4); // position updated
    });

    it('applies wind force to projectiles', () => {
      const projectiles: Projectile[] = [
        { x: 100, y: 100, vx: 0, vy: 0 },
      ];
      const wind: Wind = { magnitude: 1.0, angle: 0 }; // Wind to the right

      adapter.updateAllProjectiles(projectiles, wind);

      expect(projectiles[0].vx).toBeCloseTo(0.1, 5); // 1.0 * cos(0) * 0.1
      expect(projectiles[0].vy).toBeCloseTo(0.4, 5); // gravity
    });

    it('applies wind in different directions', () => {
      const wind90: Wind = { magnitude: 1.0, angle: Math.PI / 2 }; // Wind upward
      const projectiles: Projectile[] = [
        { x: 100, y: 100, vx: 0, vy: 0 },
      ];

      adapter.updateAllProjectiles(projectiles, wind90);

      expect(Math.abs(projectiles[0].vx)).toBeLessThan(0.01); // Should be ~0
      expect(projectiles[0].vy).toBeGreaterThan(0.3); // Wind up + some gravity
    });

    it('updates multiple projectiles independently', () => {
      const projectiles: Projectile[] = [
        { x: 100, y: 100, vx: 5, vy: 2 },
        { x: 200, y: 150, vx: -3, vy: 1 },
        { x: 150, y: 200, vx: 0, vy: 0 },
      ];
      const wind: Wind = { magnitude: 0.5, angle: 0 };

      adapter.updateAllProjectiles(projectiles, wind);

      expect(projectiles[0].x).toBeCloseTo(105.05, 0);
      expect(projectiles[1].x).toBeCloseTo(196.95, 0);
      expect(projectiles[2].x).toBeCloseTo(150.05, 0);
    });

    it('maintains determinism with same inputs', () => {
      const projectiles1: Projectile[] = [
        { x: 100, y: 100, vx: 10, vy: -5 },
      ];
      const projectiles2: Projectile[] = [
        { x: 100, y: 100, vx: 10, vy: -5 },
      ];
      const wind: Wind = { magnitude: 0.7, angle: Math.PI / 6 };

      adapter.updateAllProjectiles(projectiles1, wind);
      adapter.updateAllProjectiles(projectiles2, wind);

      expect(projectiles1[0].x).toBe(projectiles2[0].x);
      expect(projectiles1[0].y).toBe(projectiles2[0].y);
      expect(projectiles1[0].vx).toBe(projectiles2[0].vx);
      expect(projectiles1[0].vy).toBe(projectiles2[0].vy);
    });

    it('handles zero wind correctly', () => {
      const projectiles: Projectile[] = [
        { x: 100, y: 100, vx: 5, vy: 3 },
      ];
      const wind: Wind = { magnitude: 0, angle: 0 };

      adapter.updateAllProjectiles(projectiles, wind);

      expect(projectiles[0].vx).toBe(5); // No wind force
      expect(projectiles[0].vy).toBe(3 + 0.4); // Only gravity
    });
  });
});

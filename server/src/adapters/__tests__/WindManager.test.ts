import { describe, it, expect } from 'vitest';
import { WindManager } from '../WindManager';

describe('WindManager', () => {
  describe('initialization', () => {
    it('creates initial wind with valid properties', () => {
      const manager = new WindManager({
        durationMin: 5,
        durationMax: 10,
        magnitudeMin: 0.1,
        magnitudeMax: 0.5,
      });

      const wind = manager.getCurrentWind();
      expect(wind.magnitude).toBeGreaterThanOrEqual(0.1);
      expect(wind.magnitude).toBeLessThanOrEqual(0.5);
      expect(wind.angle).toBeGreaterThanOrEqual(0);
      expect(wind.angle).toBeLessThanOrEqual(2 * Math.PI);
      expect(wind.framesRemaining).toBeGreaterThanOrEqual(5);
      expect(wind.framesRemaining).toBeLessThanOrEqual(10);
    });

    it('uses default config when not provided', () => {
      const manager = new WindManager();
      const wind = manager.getCurrentWind();
      expect(wind).toBeDefined();
      expect(wind.magnitude).toBeDefined();
      expect(wind.angle).toBeDefined();
      expect(wind.framesRemaining).toBeDefined();
    });
  });

  describe('getCurrentWind', () => {
    it('returns a copy of wind state (not reference)', () => {
      const manager = new WindManager();
      const wind1 = manager.getCurrentWind();
      const wind2 = manager.getCurrentWind();

      expect(wind1).toEqual(wind2);
      expect(wind1).not.toBe(wind2); // Different objects
    });
  });

  describe('generateNewWind', () => {
    it('generates new wind with valid properties', () => {
      const manager = new WindManager({
        durationMin: 3,
        durationMax: 8,
        magnitudeMin: 0.2,
        magnitudeMax: 0.8,
      });

      const newWind = manager.generateNewWind();
      expect(newWind.magnitude).toBeGreaterThanOrEqual(0.2);
      expect(newWind.magnitude).toBeLessThanOrEqual(0.8);
      expect(newWind.angle).toBeGreaterThanOrEqual(0);
      expect(newWind.angle).toBeLessThanOrEqual(2 * Math.PI);
      expect(newWind.framesRemaining).toBeGreaterThanOrEqual(3);
      expect(newWind.framesRemaining).toBeLessThanOrEqual(8);
    });

    it('respects magnitude bounds', () => {
      const manager = new WindManager({
        magnitudeMin: 0.3,
        magnitudeMax: 0.4,
      });

      for (let i = 0; i < 10; i++) {
        const wind = manager.generateNewWind();
        expect(wind.magnitude).toBeGreaterThanOrEqual(0.3);
        expect(wind.magnitude).toBeLessThanOrEqual(0.4);
      }
    });

    it('generates randomness in wind properties', () => {
      const manager = new WindManager();
      const winds = Array.from({ length: 20 }, () => manager.generateNewWind());

      const magnitudes = winds.map(w => w.magnitude);
      const angles = winds.map(w => w.angle);
      const durations = winds.map(w => w.framesRemaining);

      const uniqueMagnitudes = new Set(magnitudes).size > 1;
      const uniqueAngles = new Set(angles).size > 1;
      const uniqueDurations = new Set(durations).size > 1;

      expect(uniqueMagnitudes).toBe(true);
      expect(uniqueAngles).toBe(true);
      expect(uniqueDurations).toBe(true);
    });
  });

  describe('advance', () => {
    it('decrements framesRemaining', () => {
      const manager = new WindManager({
        durationMin: 10,
        durationMax: 10,
      });

      const initialWind = manager.getCurrentWind();
      manager.advance();
      const updatedWind = manager.getCurrentWind();

      expect(updatedWind.framesRemaining).toBe(initialWind.framesRemaining - 1);
    });

    it('does not generate new wind until duration expires', () => {
      const manager = new WindManager({
        durationMin: 3,
        durationMax: 3,
      });

      const initialWind = manager.getCurrentWind();
      const initialAngle = initialWind.angle;

      manager.advance(); // frames: 3 → 2
      expect(manager.getCurrentWind().angle).toBe(initialAngle);

      manager.advance(); // frames: 2 → 1
      expect(manager.getCurrentWind().angle).toBe(initialAngle);

      manager.advance(); // frames: 1 → 0, triggers new wind generation
      const newWind = manager.getCurrentWind();
      // After generation, framesRemaining is 3 (from generateNewWind with durationMin: 3)
      expect(newWind.framesRemaining).toBe(3);
    });
  });

  describe('setWind', () => {
    it('allows manual wind setting for testing', () => {
      const manager = new WindManager();

      manager.setWind(0.25, Math.PI / 3, 5);

      const wind = manager.getCurrentWind();
      expect(wind.magnitude).toBe(0.25);
      expect(wind.angle).toBe(Math.PI / 3);
      expect(wind.framesRemaining).toBe(5);
    });
  });

  describe('wind lifecycle', () => {
    it('cycles through wind correctly', () => {
      const manager = new WindManager({
        durationMin: 2,
        durationMax: 2,
      });

      const wind1 = manager.getCurrentWind();
      expect(wind1.framesRemaining).toBe(2);

      manager.advance(); // framesRemaining: 2 → 1
      expect(manager.getCurrentWind().framesRemaining).toBe(1);

      manager.advance(); // framesRemaining: 1 → 0, triggers new wind generation
      const wind2 = manager.getCurrentWind();
      expect(wind2.framesRemaining).toBe(2); // New wind generated with duration 2
    });
  });
});

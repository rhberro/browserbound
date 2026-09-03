import { describe, it, expect } from 'vitest';
import {
  debrisCount,
  spawnDebris,
  stepParticles,
  DEBRIS_PIXELS_PER_PARTICLE,
  DEBRIS_MAX_PER_IMPACT,
} from '../particles';

describe('debrisCount', () => {
  it('scales with the pixels removed', () => {
    expect(debrisCount(0)).toBe(0);
    expect(debrisCount(DEBRIS_PIXELS_PER_PARTICLE)).toBe(1);
    expect(debrisCount(DEBRIS_PIXELS_PER_PARTICLE * 3 + 1)).toBe(3);
  });

  it('is bounded however large the crater', () => {
    expect(debrisCount(DEBRIS_MAX_PER_IMPACT * DEBRIS_PIXELS_PER_PARTICLE * 100)).toBe(
      DEBRIS_MAX_PER_IMPACT
    );
  });
});

describe('spawnDebris', () => {
  it('emits one particle per full bucket, positioned at the impact', () => {
    const particles = spawnDebris(120, 340, DEBRIS_PIXELS_PER_PARTICLE * 2, () => 0.5);
    expect(particles).toHaveLength(2);
    for (const p of particles) {
      expect(p.x).toBe(120);
      expect(p.y).toBe(340);
    }
  });

  it('throws every particle upward, so the burst reads as debris not a spill', () => {
    const particles = spawnDebris(0, 0, DEBRIS_PIXELS_PER_PARTICLE * 5, () => Math.random());
    for (const p of particles) {
      expect(p.vy).toBeLessThan(0);
    }
  });

  it('emits nothing for a shot that removed no terrain', () => {
    expect(spawnDebris(0, 0, 0)).toEqual([]);
  });

  it('is deterministic for a fixed random source', () => {
    const a = spawnDebris(10, 20, DEBRIS_PIXELS_PER_PARTICLE, () => 0.5);
    const b = spawnDebris(10, 20, DEBRIS_PIXELS_PER_PARTICLE, () => 0.5);
    expect(a).toEqual(b);
  });
});

describe('stepParticles', () => {
  const particle = {
    x: 0,
    y: 0,
    vx: 10,
    vy: -20,
    age: 0,
    life: 1000,
    size: 2,
    color: 0x000000,
  };

  it('integrates position and velocity without mutating the input', () => {
    const out = stepParticles([particle], 100);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(1, 5);
    expect(out[0].y).toBeCloseTo(-2, 5);
    expect(out[0].vy).toBeCloseTo(80, 5);
    expect(out[0].age).toBe(100);

    // Input untouched.
    expect(particle.x).toBe(0);
    expect(particle.vy).toBe(-20);
    expect(particle.age).toBe(0);
  });

  it('drops particles whose life has run out', () => {
    const dying = { ...particle, life: 50 };
    expect(stepParticles([dying], 100)).toEqual([]);
  });
});

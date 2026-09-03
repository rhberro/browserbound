/**
 * Debris particle model and simulation.
 *
 * Pure TypeScript — no Pixi, no DOM — so the spawn and integration rules are
 * unit-testable the way the renderer itself is not. The random source is
 * injected at the seam so the spawn logic is deterministic under test.
 *
 * The physics is deliberately trivial: a position, a velocity, a constant
 * gravity and a fade. Debris is decoration and must never affect play, so there
 * is deliberately no collision, no terrain sampling and no damage here.
 */

/** One short-lived debris particle, in world coordinates (y grows downward). */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Milliseconds already alive. */
  age: number;
  /** Total lifetime in milliseconds. */
  life: number;
  size: number;
  color: number;
}

/** GunBound's divisor: one debris particle per this many pixels removed. */
export const DEBRIS_PIXELS_PER_PARTICLE = 32;

/** Hard cap on particles a single impact may emit, whatever the crater size. */
export const DEBRIS_MAX_PER_IMPACT = 120;

/**
 * Hard cap on particles alive at once. Without this a heavy volley could stack
 * unbounded particles and tank the frame; with it the oldest burst gives way to
 * the newest. TUNE.
 */
export const DEBRIS_MAX_TOTAL = 300;

/** Downward acceleration, px/s². Debris is thrown up and falls back. */
export const DEBRIS_GRAVITY = 1000;

/** How long a particle lives, in ms. */
export const DEBRIS_LIFE_MS = 1000;

/** Upward launch speed range, px/s. */
export const DEBRIS_SPEED_MIN = 120;
export const DEBRIS_SPEED_MAX = 340;

/** Half-range of horizontal launch speed, px/s. */
export const DEBRIS_SPREAD = 160;

/** How many debris particles a crater of `removedPixels` produces. */
export function debrisCount(removedPixels: number): number {
  if (removedPixels <= 0) return 0;
  return Math.min(
    DEBRIS_MAX_PER_IMPACT,
    Math.floor(removedPixels / DEBRIS_PIXELS_PER_PARTICLE)
  );
}

/**
 * Build the debris burst for one impact. `random` is injectable for tests.
 *
 * Every particle launches UPWARD with a sideways spread, so the burst reads as
 * earth thrown out of a hole rather than a stain spreading on the ground.
 */
export function spawnDebris(
  x: number,
  y: number,
  removedPixels: number,
  random: () => number = Math.random
): Particle[] {
  const count = debrisCount(removedPixels);
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: (random() * 2 - 1) * DEBRIS_SPREAD,
      vy: -(DEBRIS_SPEED_MIN + random() * (DEBRIS_SPEED_MAX - DEBRIS_SPEED_MIN)),
      age: 0,
      life: DEBRIS_LIFE_MS * (0.6 + random() * 0.4),
      size: 1.5 + random() * 2.5,
      color: 0x6b4a2f,
    });
  }
  return particles;
}

/**
 * Advance every particle by `dtMs` and drop the expired ones.
 *
 * Returns a NEW array; neither the input array nor its particles are mutated.
 */
export function stepParticles(particles: Particle[], dtMs: number): Particle[] {
  const dt = dtMs / 1000;
  const out: Particle[] = [];
  for (const p of particles) {
    const age = p.age + dtMs;
    if (age >= p.life) continue;
    out.push({
      ...p,
      age,
      x: p.x + p.vx * dt,
      y: p.y + p.vy * dt,
      vy: p.vy + DEBRIS_GRAVITY * dt,
    });
  }
  return out;
}

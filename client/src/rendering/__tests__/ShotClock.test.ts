import { describe, it, expect } from 'vitest';
import { ShotClock, SHOT_DELAY_MS } from '../ShotClock';
import { PlayerMotion } from '../PlayerMotion';

describe('ShotClock', () => {
  it('draws the moment SHOT_DELAY_MS behind live', () => {
    const clock = new ShotClock();
    expect(clock.renderTime(1000)).toBe(1000 - SHOT_DELAY_MS);
  });

  it('holds an effect until the drawn moment reaches it', () => {
    const clock = new ShotClock(60);
    let fired = false;
    clock.defer(1000, () => (fired = true));

    clock.flush(1030);
    expect(fired).toBe(false);

    clock.flush(1059);
    expect(fired).toBe(false);

    clock.flush(1060);
    expect(fired).toBe(true);
  });

  it('runs an effect exactly once', () => {
    const clock = new ShotClock(60);
    let runs = 0;
    clock.defer(1000, () => runs++);
    clock.flush(1100);
    clock.flush(1200);
    expect(runs).toBe(1);
    expect(clock.pending).toBe(0);
  });

  it('releases effects in the order they happened', () => {
    const clock = new ShotClock(60);
    const seen: string[] = [];
    clock.defer(1000, () => seen.push('explosion'));
    clock.defer(1000, () => seen.push('crater'));
    clock.defer(1010, () => seen.push('next shot'));

    clock.flush(1100);
    expect(seen).toEqual(['explosion', 'crater', 'next shot']);
  });

  it('drops pending effects on clear without running them', () => {
    const clock = new ShotClock(60);
    let fired = false;
    clock.defer(1000, () => (fired = true));
    clock.clear();
    clock.flush(2000);
    expect(fired).toBe(false);
  });
});

/**
 * The regression this whole module exists for. A projectile's drawn position
 * and its explosion must describe the same instant — the bug was two clocks,
 * not a bad position, so nothing short of comparing the two catches it coming
 * back.
 */
describe('flight and impact agree on where the shot was', () => {
  const PATCH_MS = 50;

  it('explodes where the projectile is drawn, not where it has got to', () => {
    const motion = new PlayerMotion(SHOT_DELAY_MS);
    const clock = new ShotClock(SHOT_DELAY_MS);

    // A shot travelling 100px per patch along x, reported at the patch rate.
    let now = 1000;
    let serverX = 0;
    const step = 100;
    let drawn = { x: 0, y: 0 };

    // Fly for a while so the interpolation buffer is warm.
    for (let patch = 0; patch < 6; patch++) {
      serverX += step;
      now += PATCH_MS;
      drawn = motion.update('p1', serverX, 0, false, PATCH_MS, now);
      clock.flush(now);
    }

    // The server resolves the shot at the position it has actually reached.
    const impactX = serverX;
    let explosionX: number | null = null;
    clock.defer(now, () => (explosionX = impactX));

    // Nothing yet: the drawn projectile has not arrived.
    clock.flush(now);
    expect(explosionX).toBeNull();

    // Keep drawing at the patch rate, with no further server positions, until
    // the explosion is released.
    let guard = 0;
    while (explosionX === null && guard++ < 20) {
      now += PATCH_MS / 2;
      drawn = motion.update('p1', serverX, 0, false, PATCH_MS / 2, now);
      clock.flush(now);
    }

    expect(explosionX).toBe(impactX);
    // The whole point: the blast lands on the projectile, not a patch ahead.
    expect(Math.abs(drawn.x - (explosionX as unknown as number))).toBeLessThan(1);
  });

  it('was broken before: a live explosion outruns a delayed projectile', () => {
    const motion = new PlayerMotion(SHOT_DELAY_MS);
    let now = 1000;
    let serverX = 0;
    let drawn = { x: 0, y: 0 };
    for (let patch = 0; patch < 6; patch++) {
      serverX += 100;
      now += PATCH_MS;
      drawn = motion.update('p1', serverX, 0, false, PATCH_MS, now);
    }

    // An impact drawn the instant it arrives — the old behaviour — is a whole
    // delay's worth of flight ahead of the projectile the player is watching.
    expect(serverX - drawn.x).toBeGreaterThan(50);
  });
});

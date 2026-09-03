/**
 * ParticleSystem: draws the debris particle pool.
 *
 * The thin PIXI skin over the pure simulation in `particles.ts`. One persistent
 * `Graphics` holds every live particle and is redrawn each frame. Particles
 * genuinely change position and alpha every frame, so the usual "do not rebuild
 * unchanged geometry" rule does not apply here — unlike a health bar there is
 * no static shape to cache. The total-particle cap in `DEBRIS_MAX_TOTAL` is what
 * keeps a heavy volley from making that redraw expensive.
 */

import * as PIXI from 'pixi.js';
import { Particle, stepParticles, DEBRIS_MAX_TOTAL } from './particles';

export class ParticleSystem {
  private particles: Particle[] = [];
  private graphics: PIXI.Graphics;

  constructor(parent: PIXI.Container) {
    this.graphics = new PIXI.Graphics();
    parent.addChild(this.graphics);
  }

  /**
   * Add a burst of particles, dropping the oldest past the cap. Dropping the
   * oldest rather than refusing the newest keeps the newest burst visible, which
   * is the one the player is looking at.
   */
  spawn(particles: Particle[]): void {
    this.particles = this.particles.concat(particles);
    if (this.particles.length > DEBRIS_MAX_TOTAL) {
      this.particles = this.particles.slice(this.particles.length - DEBRIS_MAX_TOTAL);
    }
  }

  /** Advance the simulation one frame and redraw. */
  update(dtMs: number): void {
    this.particles = stepParticles(this.particles, dtMs);
    this.draw();
  }

  /** Drop every live particle without destroying the shared `Graphics`. */
  clear(): void {
    this.particles = [];
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
    this.particles = [];
  }

  private draw(): void {
    const g = this.graphics;
    g.clear();
    for (const p of this.particles) {
      const fade = 1 - p.age / p.life;
      g.circle(p.x, p.y, p.size);
      g.fill({ color: p.color, alpha: fade });
    }
  }
}

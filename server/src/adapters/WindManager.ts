/**
 * WindManager: Tracks current wind state and persistence.
 *
 * Wind persists for a random duration (20-60 frames), then a new wind spawns.
 * Magnitude and direction are both random.
 */

export interface WindState {
  magnitude: number; // force strength
  angle: number; // direction in radians [0, 2π)
  framesRemaining: number; // how many frames until this wind expires
}

export interface WindConfig {
  durationMin: number;
  durationMax: number;
  magnitudeMin: number;
  magnitudeMax: number;
}

export class WindManager {
  private wind: WindState;
  private config: WindConfig;

  constructor(config: Partial<WindConfig> = {}) {
    this.config = {
      durationMin: config.durationMin ?? 5,
      durationMax: config.durationMax ?? 10,
      magnitudeMin: config.magnitudeMin ?? 0.1,
      magnitudeMax: config.magnitudeMax ?? 0.5,
    };

    this.wind = this.generateNewWind();
  }

  /**
   * Get current wind state (safe to read, don't modify).
   */
  getCurrentWind(): WindState {
    return { ...this.wind };
  }

  /**
   * Advance wind by one frame. If duration expires, spawn new wind.
   */
  advance(): void {
    this.wind.framesRemaining -= 1;
    if (this.wind.framesRemaining <= 0) {
      this.wind = this.generateNewWind();
    }
  }

  /**
   * Generate a new random wind and update internal state.
   */
  generateNewWind(): WindState {
    const magnitude =
      Math.random() * (this.config.magnitudeMax - this.config.magnitudeMin) +
      this.config.magnitudeMin;
    const angle = Math.random() * (2 * Math.PI);
    const duration =
      Math.floor(
        Math.random() * (this.config.durationMax - this.config.durationMin)
      ) + this.config.durationMin;

    this.wind = {
      magnitude,
      angle,
      framesRemaining: duration,
    };

    return { ...this.wind };
  }

  /**
   * (Optional) Manually set wind for testing or scripted sequences.
   */
  setWind(magnitude: number, angle: number, duration: number): void {
    this.wind = { magnitude, angle, framesRemaining: duration };
  }
}

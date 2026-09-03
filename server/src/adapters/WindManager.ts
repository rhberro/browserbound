import {
  WIND_MAGNITUDE_MIN,
  WIND_MAGNITUDE_MAX,
  WIND_DRIFT_CHANCE,
  WIND_DRIFT_MAGNITUDE,
  WIND_DRIFT_ANGLE,
  WIND_REROLL_TURNS_MIN,
  WIND_REROLL_TURNS_MAX,
} from '@browserbond/shared';

/**
 * WindManager: owns the current Wind and how it changes over a match.
 *
 * Wind DRIFTS. At the end of every turn it is nudged — a small change to
 * magnitude and direction, applied only some of the time — and every so often
 * it is re-rolled outright. It used to hold one value for 5-10 complete ROUNDS
 * and then teleport, which made the previous shot useless as information and
 * meant wind had to be relearned from scratch each time it moved.
 *
 * Everything here counts in TURNS, never rounds. A "round" only exists because
 * turn order is currently a rotation that wraps back to index 0; ticket #35
 * replaces that with a delay queue and the concept disappears. Nothing in the
 * wind path may depend on it.
 */

export interface WindState {
  magnitude: number; // force strength, within [magnitudeMin, magnitudeMax]
  angle: number; // direction in radians, always [0, 2π)
  turnsUntilReroll: number; // turns left before a full re-roll
}

export interface WindConfig {
  magnitudeMin: number;
  magnitudeMax: number;
  /** Turns between full re-rolls, drawn uniformly from [min, max]. */
  rerollTurnsMin: number;
  rerollTurnsMax: number;
  /** Probability in [0, 1] that a given turn disturbs the wind at all. */
  driftChance: number;
  /** Maximum magnitude change per disturbed turn, applied as +/-. */
  driftMagnitude: number;
  /** Maximum angle change per disturbed turn, in radians, applied as +/-. */
  driftAngle: number;
}

const TWO_PI = 2 * Math.PI;

/**
 * Fold an angle into [0, 2π). Drift accumulates without bound otherwise, and a
 * direction of 400 radians renders the same as one of 400 - 63*2π but compares
 * as wildly different — the wind dial's rotation is driven straight off this
 * number.
 */
function wrapAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class WindManager {
  private wind: WindState;
  private config: WindConfig;
  private random: () => number;

  /**
   * `random` is injectable so the drift and re-roll cadence can be asserted as
   * numbers rather than as bounds. Production passes nothing.
   */
  constructor(config: Partial<WindConfig> = {}, random: () => number = Math.random) {
    this.config = {
      magnitudeMin: config.magnitudeMin ?? WIND_MAGNITUDE_MIN,
      magnitudeMax: config.magnitudeMax ?? WIND_MAGNITUDE_MAX,
      rerollTurnsMin: config.rerollTurnsMin ?? WIND_REROLL_TURNS_MIN,
      rerollTurnsMax: config.rerollTurnsMax ?? WIND_REROLL_TURNS_MAX,
      driftChance: config.driftChance ?? WIND_DRIFT_CHANCE,
      driftMagnitude: config.driftMagnitude ?? WIND_DRIFT_MAGNITUDE,
      driftAngle: config.driftAngle ?? WIND_DRIFT_ANGLE,
    };
    this.random = random;

    this.wind = this.generateNewWind();
  }

  /**
   * Current wind. A copy: callers hand this straight to the physics adapter and
   * to synchronized state, and neither may write back through it.
   */
  getCurrentWind(): WindState {
    return { ...this.wind };
  }

  /**
   * Advance the wind by one TURN, and return what it became.
   *
   * Either the countdown expires and the wind is re-rolled, or the wind is
   * nudged with probability `driftChance`. The countdown is decremented before
   * anything else, so a stalled drift roll can never stall the re-roll with it.
   */
  advanceTurn(): WindState {
    this.wind.turnsUntilReroll -= 1;
    if (this.wind.turnsUntilReroll <= 0) {
      return this.generateNewWind();
    }

    if (this.random() >= this.config.driftChance) {
      return { ...this.wind };
    }

    // Symmetric offsets: a draw of 0.5 is no change, 0 and 1 are the full step
    // down and up. Magnitude clamps at the bounds and angle wraps, so drift can
    // neither escape the configured range nor wind the dial past a circle.
    const magnitudeStep = (this.random() * 2 - 1) * this.config.driftMagnitude;
    const angleStep = (this.random() * 2 - 1) * this.config.driftAngle;

    this.wind.magnitude = clamp(
      this.wind.magnitude + magnitudeStep,
      this.config.magnitudeMin,
      this.config.magnitudeMax
    );
    this.wind.angle = wrapAngle(this.wind.angle + angleStep);

    return { ...this.wind };
  }

  /**
   * Replace the wind outright with a fresh random one, and restart the re-roll
   * countdown. Called when that countdown expires and when a match restarts, so
   * a rematch does not inherit the previous match's weather.
   */
  generateNewWind(): WindState {
    const magnitude =
      this.random() * (this.config.magnitudeMax - this.config.magnitudeMin) +
      this.config.magnitudeMin;
    const angle = wrapAngle(this.random() * TWO_PI);
    const turns =
      Math.floor(
        this.random() * (this.config.rerollTurnsMax - this.config.rerollTurnsMin)
      ) + this.config.rerollTurnsMin;

    this.wind = { magnitude, angle, turnsUntilReroll: turns };

    return { ...this.wind };
  }

  /**
   * Force a specific wind. For tests and scripted sequences only — nothing in
   * the game loop should be choosing the weather by hand.
   */
  setWind(magnitude: number, angle: number, turnsUntilReroll: number): void {
    this.wind = { magnitude, angle: wrapAngle(angle), turnsUntilReroll };
  }
}

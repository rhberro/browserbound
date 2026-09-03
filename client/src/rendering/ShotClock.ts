/**
 * ShotClock: the one timeline every part of a shot is presented on.
 *
 * A projectile's position is synchronized STATE, arriving at the patch rate,
 * so the renderer plays it back slightly behind live in order to always have a
 * sample on each side to interpolate between. Its impact is a MESSAGE, and a
 * message is not interpolated — it arrives and it is true right now.
 *
 * Presenting the two on different clocks is what made shots explode into thin
 * air: the drawn projectile was a fixed delay short of the ground when the
 * explosion, terrain crater and the projectile's own disappearance all fired at
 * once, a projectile's-flight-time-worth of pixels ahead of it. Nothing was out
 * of sync with the server — every piece was correct, and no two pieces agreed
 * on when "now" was.
 *
 * So: one clock. Positions are read at `renderTime`, and everything a shot does
 * on arrival is queued here and released when `renderTime` catches up to the
 * moment it was received. The delay is paid once, by the whole shot, and inside
 * that timeline flight and impact line up exactly.
 */

/**
 * How far behind live a shot is drawn.
 *
 * Sized as ONE server patch interval plus a small margin — the least that still
 * guarantees a sample on each side of `renderTime`, since patches are what
 * projectile positions arrive in. It was two intervals, borrowed from the
 * character interpolation this code once shared, and every millisecond of it is
 * also delay between pressing fire and seeing the shot leave. Characters can
 * afford it because nobody is watching for the exact frame a walk begins.
 *
 * The rest of the launch delay is network round trip and patch quantisation,
 * which no amount of buffering removes: the client cannot draw a projectile
 * before it has been told about one, and it cannot predict the flight itself
 * because terrain lives only on the server (ADR 0002), so a predicted shot
 * would sail straight through the ground it was supposed to hit.
 */
export const SHOT_DELAY_MS = 60;

interface DeferredEffect {
  /** Wall-clock time at which `renderTime` reaches the moment this described. */
  dueAt: number;
  run: () => void;
}

export class ShotClock {
  private queue: DeferredEffect[] = [];

  constructor(private readonly delayMs: number = SHOT_DELAY_MS) {}

  /** The moment being drawn right now, given the current wall clock. */
  renderTime(now: number): number {
    return now - this.delayMs;
  }

  /**
   * Hold an effect until the drawn moment catches up to `now` — the instant the
   * server reported it.
   */
  defer(now: number, run: () => void): void {
    this.queue.push({ dueAt: now + this.delayMs, run });
  }

  /**
   * Release every effect whose moment has arrived, oldest first.
   *
   * Ordering is load-bearing: a crater and the explosion that made it are two
   * effects at the same instant, and playing them out of order shows the hole
   * before the blast.
   */
  flush(now: number): void {
    if (this.queue.length === 0) return;

    const due = this.queue.filter((e) => e.dueAt <= now);
    if (due.length === 0) return;
    this.queue = this.queue.filter((e) => e.dueAt > now);

    due.sort((a, b) => a.dueAt - b.dueAt);
    for (const effect of due) effect.run();
  }

  /**
   * Drop everything still waiting, WITHOUT running it.
   *
   * For teardown and for a match ending: a queued crater belongs to a match
   * that no longer exists, and running it on the way out would paint it over
   * whatever replaced it.
   */
  clear(): void {
    this.queue = [];
  }

  /** Effects still waiting to be shown. */
  get pending(): number {
    return this.queue.length;
  }
}

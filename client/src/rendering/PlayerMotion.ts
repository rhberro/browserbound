/**
 * PlayerMotion: turns 20Hz server positions into a smooth per-frame position.
 *
 * The server simulates at ~16ms but Colyseus patches at ~50ms, so assigning
 * `sprite.x = player.x` makes characters teleport between patches. Two
 * different treatments are needed, because the two cases have opposite
 * failure modes (Phase 7 of the movement/physics plan):
 *
 * - **Remote characters** are rendered in the past, at `INTERP_DELAY_MS`
 *   behind the newest sample, so there is always a sample on each side to
 *   interpolate between. Delay is free here — nobody is holding the keys.
 * - **The local character** is never delayed. It exponentially decays toward
 *   the latest server position, so it converges within a couple of frames of
 *   a patch. A local character lagging its own input is exactly the artifact
 *   this is removing.
 */

/**
 * Default playback delay: roughly two patch intervals at the server's 20Hz
 * patch rate. Generous on purpose for characters, where a late sample matters
 * more than the delay does.
 *
 * Projectiles override it — see `SHOT_DELAY_MS`. A shot is watched frame by
 * frame and its delay is felt as input lag on the fire button, so it buys the
 * least buffering that still brackets `renderTime`.
 */
export const INTERP_DELAY_MS = 100;

/** Samples older than this behind the render time are dropped. */
const BUFFER_HISTORY_MS = 600;

/**
 * Half-life of the local player's error toward the server position. At 40ms
 * the visible lag at WALK_SPEED (120px/s) is under 7px and it converges inside
 * ~2 frames at 60fps — smooth, but not perceptibly behind the input.
 */
const LOCAL_HALF_LIFE_MS = 40;

/**
 * Beyond this distance a correction is a teleport (spawn, respawn, knockback
 * across the map), not motion, and must snap rather than glide across the map.
 */
const SNAP_DISTANCE = 200;

/** Below this the smoothing has effectively arrived; settle exactly. */
const SETTLE_EPSILON = 0.05;

interface Sample {
  t: number;
  x: number;
  y: number;
}

interface Track {
  /** Timestamped server positions (remote players only). */
  samples: Sample[];
  /** Last server position observed, used to detect a new patch. */
  lastServerX: number;
  lastServerY: number;
  /** Current rendered position. */
  x: number;
  y: number;
}

export class PlayerMotion {
  private tracks: Map<string, Track> = new Map();

  /**
   * @param delayMs how far behind live remote tracks are played back. The local
   *   player is never delayed, so this does not touch it.
   */
  constructor(private readonly delayMs: number = INTERP_DELAY_MS) {}

  /**
   * Feed the latest server position for a player and get back the position to
   * render this frame.
   *
   * @param isLocal true for the session's own player — no delay, smoothing only
   * @param dtMs frame delta in milliseconds
   * @param now client clock in milliseconds (`performance.now()`)
   */
  update(
    id: string,
    serverX: number,
    serverY: number,
    isLocal: boolean,
    dtMs: number,
    now: number
  ): { x: number; y: number } {
    let track = this.tracks.get(id);

    if (!track) {
      // A new player snaps to its first position rather than sliding in from 0,0.
      track = {
        samples: [{ t: now, x: serverX, y: serverY }],
        lastServerX: serverX,
        lastServerY: serverY,
        x: serverX,
        y: serverY,
      };
      this.tracks.set(id, track);
      return { x: track.x, y: track.y };
    }

    const moved = serverX !== track.lastServerX || serverY !== track.lastServerY;
    const jumped =
      moved && Math.hypot(serverX - track.lastServerX, serverY - track.lastServerY) > SNAP_DISTANCE;

    if (moved) {
      track.lastServerX = serverX;
      track.lastServerY = serverY;
      if (jumped) {
        // Teleport: discard the history so we never interpolate across it.
        track.samples = [];
        track.x = serverX;
        track.y = serverY;
      }
      track.samples.push({ t: now, x: serverX, y: serverY });
    }

    if (jumped) {
      return { x: track.x, y: track.y };
    }

    if (isLocal) {
      // Exponential smoothing toward the server position, framerate-independent:
      // the fraction of remaining error removed depends on elapsed time, not on
      // how many frames happened to fit into it.
      const k = 1 - Math.pow(2, -dtMs / LOCAL_HALF_LIFE_MS);
      track.x += (serverX - track.x) * k;
      track.y += (serverY - track.y) * k;
      if (Math.abs(serverX - track.x) < SETTLE_EPSILON) track.x = serverX;
      if (Math.abs(serverY - track.y) < SETTLE_EPSILON) track.y = serverY;
      // The local player never uses the buffer; keep it from growing.
      if (track.samples.length > 1) track.samples = track.samples.slice(-1);
      return { x: track.x, y: track.y };
    }

    const renderTime = now - this.delayMs;
    const at = this.sampleAt(track.samples, renderTime);
    track.x = at.x;
    track.y = at.y;
    this.prune(track.samples, renderTime);
    return { x: track.x, y: track.y };
  }

  /** Position of the sample track at `t`, interpolating between neighbours. */
  private sampleAt(samples: Sample[], t: number): { x: number; y: number } {
    if (samples.length === 0) return { x: 0, y: 0 };
    if (samples.length === 1 || t <= samples[0].t) {
      const s = samples[0];
      return { x: s.x, y: s.y };
    }

    const newest = samples[samples.length - 1];
    if (t >= newest.t) {
      // Ahead of the newest sample (a stalled or dropped patch). Hold the last
      // known position rather than extrapolating into a guess that has to be
      // corrected back.
      return { x: newest.x, y: newest.y };
    }

    for (let i = samples.length - 1; i > 0; i--) {
      const b = samples[i];
      const a = samples[i - 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        const f = span > 0 ? (t - a.t) / span : 1;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }

    return { x: newest.x, y: newest.y };
  }

  /** Drop samples fully behind the render window, keeping one on each side. */
  private prune(samples: Sample[], renderTime: number): void {
    const cutoff = renderTime - BUFFER_HISTORY_MS;
    let drop = 0;
    while (drop + 1 < samples.length && samples[drop + 1].t < cutoff) drop++;
    if (drop > 0) samples.splice(0, drop);
  }

  /** The position currently being rendered for a player, if it has one. */
  getRendered(id: string): { x: number; y: number } | null {
    const track = this.tracks.get(id);
    return track ? { x: track.x, y: track.y } : null;
  }

  remove(id: string): void {
    this.tracks.delete(id);
  }
}

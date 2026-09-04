import { Seat } from '@browserbond/shared';

interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

/**
 * Owns every piece of per-session state that lives OUTSIDE synchronized
 * schema: held input, walk windup, fall delay, wind drift, and the
 * blocked-notify debounce flag. These were five separate Maps/Sets directly
 * on GameRoom, each released from a different subset of the room's five or
 * six teardown paths — `removePlayer` was meant to be the one path that
 * released all of them, but a new map added later would forget to list
 * itself there. Consolidating them here means there is exactly one place a
 * session's runtime state can leak from: `remove()`.
 *
 * Deliberately NOT a home for game rules (turn order, movement legality,
 * physics math) — this is storage plus the connection-lifecycle transitions
 * that release it. The rules that read and write this storage stay in
 * GameRoom, where the rest of the simulation lives.
 */
export class PlayerLifecycle {
  private inputs: Map<string, PlayerInput> = new Map();
  /**
   * Milliseconds a direction has been held. See GameRoom's own doc comment on
   * the walk windup mechanic for why this is not reset per step.
   */
  private walkWindup: Map<string, number> = new Map();
  /** Milliseconds a character has been unsupported, waiting out FALL_DELAY_MS. */
  private fallDelay: Map<string, number> = new Map();
  /** Sub-pixel wind drift accumulated over a fall, spent as whole pixels. */
  private windDrift: Map<string, number> = new Map();
  private blockedNotified: Set<string> = new Set();

  /**
   * A client connected to the room and claimed a Seat.
   *
   * Takes the Seat itself, not just the sessionId, because this is the room's
   * connection-lifecycle boundary and a future consumer of per-session
   * runtime state (e.g. team-aware physics) will need it at exactly this
   * call site. Nothing reads it yet — GameRoom still looks seats up via
   * `state.seats` — so it is intentionally not cached here; caching it would
   * be a second, unread copy of state Colyseus already owns.
   */
  join(_sessionId: string, _seat: Seat): void {
    // No-op by design; see doc comment above.
  }

  /**
   * A dropped connection came back inside the reconnection window.
   *
   * Deliberately does nothing to the physics maps: the entire point of
   * `onDrop` leaving them untouched is that a fall in progress resumes
   * exactly where it left off. This is kept as an explicit call — rather than
   * omitted — so the reconnect transition is visible at the GameRoom call
   * site instead of being implied by the absence of one.
   */
  reconnect(_sessionId: string): void {
    // No-op by design; see doc comment above.
  }

  /**
   * A connection ended.
   *
   * `graceful: true` is a recoverable drop (`onDrop`): only the held input
   * clears, so a disconnected character stops walking into a wall but keeps
   * its windup/fall/drift state for when it reconnects. `graceful: false` is
   * a permanent departure (`onLeave`, or a killed player) and delegates to
   * `remove`.
   */
  leave(sessionId: string, graceful: boolean): void {
    if (graceful) {
      this.inputs.delete(sessionId);
      return;
    }
    this.remove(sessionId);
  }

  /** The one path every piece of a session's runtime state is released from. */
  remove(sessionId: string): void {
    this.inputs.delete(sessionId);
    this.walkWindup.delete(sessionId);
    this.fallDelay.delete(sessionId);
    this.windDrift.delete(sessionId);
    this.blockedNotified.delete(sessionId);
  }

  /**
   * Bulk reset of the five physics maps for a fresh match or a disposed room
   * (`beginMatch`, `returnToLobby`, `onDispose`).
   */
  clearAll(): void {
    this.inputs.clear();
    this.walkWindup.clear();
    this.fallDelay.clear();
    this.windDrift.clear();
    this.blockedNotified.clear();
  }

  getInput(sessionId: string): PlayerInput | undefined {
    return this.inputs.get(sessionId);
  }

  setInput(sessionId: string, input: PlayerInput): void {
    this.inputs.set(sessionId, input);
  }

  clearInput(sessionId: string): void {
    this.inputs.delete(sessionId);
  }

  getWalkWindup(sessionId: string): number {
    return this.walkWindup.get(sessionId) ?? 0;
  }

  setWalkWindup(sessionId: string, value: number): void {
    this.walkWindup.set(sessionId, value);
  }

  clearWalkWindup(sessionId: string): void {
    this.walkWindup.delete(sessionId);
  }

  getFallDelay(sessionId: string): number {
    return this.fallDelay.get(sessionId) ?? 0;
  }

  setFallDelay(sessionId: string, value: number): void {
    this.fallDelay.set(sessionId, value);
  }

  clearFallDelay(sessionId: string): void {
    this.fallDelay.delete(sessionId);
  }

  getWindDrift(sessionId: string): number {
    return this.windDrift.get(sessionId) ?? 0;
  }

  setWindDrift(sessionId: string, value: number): void {
    this.windDrift.set(sessionId, value);
  }

  clearWindDrift(sessionId: string): void {
    this.windDrift.delete(sessionId);
  }

  isBlockedNotified(sessionId: string): boolean {
    return this.blockedNotified.has(sessionId);
  }

  setBlockedNotified(sessionId: string): void {
    this.blockedNotified.add(sessionId);
  }

  clearBlockedNotified(sessionId: string): void {
    this.blockedNotified.delete(sessionId);
  }
}

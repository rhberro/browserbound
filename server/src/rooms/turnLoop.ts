/**
 * When a shot is over.
 *
 * Extracted from the simulation loop so the staged-projectile boundary can be
 * tested without standing up a room. The rule reads as one line but has three
 * inputs, and getting it wrong is invisible until a specific weapon meets a
 * specific piece of terrain.
 */
export interface ProjectileCounts {
  /** Projectiles currently in the air. */
  active: number;
  /** Projectiles staged to launch on a later frame (Burst fires at 0, 5, 10). */
  pending: number;
  /** Projectiles that resolved on THIS frame. */
  resolvedThisFrame: number;
}

/**
 * True when the turn should pass.
 *
 * `pending` is the term that used to be missing, and its absence is why Burst
 * fired into the next player's turn: Burst stages three projectiles across ten
 * frames, so if the first resolves quickly — into nearby terrain, or straight
 * down — the active list empties while two shots are still staged. The turn
 * passed and the remaining two launched on the opponent's clock.
 *
 * `resolvedThisFrame` is what keeps this an edge rather than a level. Without
 * it the condition is true on every idle frame of every turn, and the turn
 * would pass the instant it began.
 */
export function shouldAdvanceTurn(counts: ProjectileCounts): boolean {
  return nothingInFlight(counts) && counts.resolvedThisFrame > 0;
}

/** Nothing airborne and nothing staged. The turn timer asks the same question. */
export function nothingInFlight(counts: Pick<ProjectileCounts, 'active' | 'pending'>): boolean {
  return counts.active === 0 && counts.pending === 0;
}

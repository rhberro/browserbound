/**
 * The one fallback chain for "what name do we show for this player?": a
 * profile's own display name, then an email's local part, then the raw user
 * id, then a short slice of the session id.
 *
 * Server-side only in practice: SupabaseAdmin.fetchDisplayName calls this
 * after its DB lookup, and GameRoom.onAuth's resolved value is what
 * GameRoom.onJoin now trusts for Seat.displayName — replacing the client's
 * own unverified claim, which onJoin used to read instead. The client no
 * longer computes a competing guess at all (it used to, in
 * gameState.ts's createRoom/joinRoom, but that value was never read
 * server-side once onJoin switched to the resolved one, so it was deleted
 * rather than wired through this resolver too).
 */
export interface DisplayNameProfile {
  displayName?: string | null;
  email?: string | null;
}

export function resolveDisplayName(
  userId: string,
  profile: DisplayNameProfile | null | undefined,
  sessionId: string
): string {
  if (profile?.displayName) return profile.displayName;
  if (profile?.email) return profile.email.split('@')[0];
  if (userId) return userId;
  return `Player ${sessionId.substring(0, 4)}`;
}

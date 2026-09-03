import { matchEnded, matchResultText, rematchText } from '../signals';
import type { GameState } from '../../gameState';

/**
 * The end-of-match overlay: the result, and a way to play again.
 *
 * Shown to BOTH players, including the one who lost — losing used to mean
 * having your character deleted and being left in a room with nothing
 * happening and no explanation.
 *
 * The rematch needs no reconnection: the server rebuilds the match around
 * whoever is still in the room.
 */
export function MatchResult({ gameState }: { gameState: GameState }) {
  if (!matchEnded.value) return null;

  return (
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div class="hud-panel pointer-events-auto flex flex-col items-center gap-4 rounded-xl px-10 py-8 shadow-lg shadow-black/60">
        <span class="hud-label">Match over</span>
        <span class="text-3xl font-bold text-ink">{matchResultText}</span>

        <button
          type="button"
          class="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-accent-600"
          onClick={() => gameState.requestRematch()}
        >
          {rematchText}
        </button>

        <span class="text-[10px] text-neutral-600">
          Starts when both players are ready
        </span>
      </div>
    </div>
  );
}

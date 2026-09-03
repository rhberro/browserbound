import { matchEnded, matchResultText, rematchText } from '../signals';
import type { GameState } from '../../gameState';

/**
 * The end-of-match overlay — Variant 2: frosted neon panel with the result and
 * a way to play again.
 */
export function MatchResult({ gameState }: { gameState: GameState }) {
  if (!matchEnded.value) return null;

  return (
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div class="hud-panel pointer-events-auto flex flex-col items-center gap-4 rounded-lg px-10 py-8">
        <span class="hud-label">Match over</span>
        <span class="text-3xl font-black text-ink">{matchResultText}</span>

        <button
          type="button"
          class="bg-accent px-6 py-2.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-accent-600"
          onClick={() => gameState.requestRematch()}
        >
          {rematchText}
        </button>

        <span class="text-[10px] text-neutral-500">
          Starts when both players are ready
        </span>
      </div>
    </div>
  );
}

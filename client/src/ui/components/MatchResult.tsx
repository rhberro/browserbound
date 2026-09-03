import { matchEnded, matchResultText } from '../signals';

/**
 * The end-of-match overlay — displays the result and automatically returns to lobby.
 */
export function MatchResult() {
  if (!matchEnded.value) return null;

  return (
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div class="hud-panel pointer-events-auto flex flex-col items-center gap-4 rounded-lg px-10 py-8">
        <span class="hud-label">Match over</span>
        <span class="text-3xl font-black text-ink">{matchResultText}</span>

        <span class="text-[10px] text-neutral-500">
          Returning to lobby...
        </span>
      </div>
    </div>
  );
}

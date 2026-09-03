import { isMyTurn, isTurnEnding, turnSeconds, turnSecondsText } from '../signals';

/**
 * Seconds left before the turn passes on its own — Variant 2: a cyan countdown
 * pinned top-centre.
 */
export function TurnClock() {
  if (turnSeconds.value <= 0) return null;

  const ending = isTurnEnding.value;

  return (
    <div class="flex flex-col items-center">
      <span class="hud-label">{isMyTurn.value ? 'Your turn' : 'Opponent'}</span>
      <span
        class={`text-3xl font-black tabular-nums ${ending ? 'text-red-400' : 'text-ink'}`}
      >
        {turnSecondsText}
      </span>
    </div>
  );
}

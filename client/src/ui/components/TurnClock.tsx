import { isMyTurn, isTurnEnding, turnSeconds, turnSecondsText } from '../signals';

/**
 * Seconds left before the turn passes on its own.
 *
 * The value arrives from the server as a REMAINING DURATION rather than a
 * deadline, so nothing here does clock arithmetic and a client whose clock
 * disagrees with the server's still counts down correctly.
 */
export function TurnClock() {
  if (turnSeconds.value <= 0) return null;

  const ending = isTurnEnding.value;

  return (
    <div class="flex flex-col items-center">
      <span class="hud-label">{isMyTurn.value ? 'Your turn' : 'Opponent'}</span>
      <span
        class={`text-lg font-bold tabular-nums ${ending ? 'text-red-400' : 'text-ink'}`}
      >
        {turnSecondsText}
      </span>
    </div>
  );
}

import {
  isOutOfMovement,
  movementFillStyle,
  movementText,
} from '../signals';

/**
 * How far this character may still walk this turn.
 *
 * The Movement Budget is spent per pixel actually advanced, and when it runs
 * out the character simply stops responding to movement input. Without this
 * readout that reads as a bug rather than a rule, which is the whole reason it
 * is on screen.
 */
export function MovementBudget() {
  const spent = isOutOfMovement.value;

  return (
    <div class="flex min-w-36 flex-col gap-2">
      <span class="hud-label">Move</span>

      <div class="flex items-center gap-2">
        <div class="relative h-7 flex-1 overflow-hidden rounded-md border border-neutral-700 bg-neutral-800">
          <div
            class={`absolute inset-y-0 left-0 transition-[width] duration-150 ease-out ${
              spent ? 'bg-neutral-600' : 'bg-linear-to-r from-sky-700 to-sky-400'
            }`}
            style={movementFillStyle}
          />
        </div>

        <span class="min-w-8 text-right text-xs font-semibold tabular-nums">{movementText}</span>
      </div>

      {/* Reserved whether or not it is showing, so the deck does not jump
          height at the moment the budget runs out. */}
      <span
        class={`text-[10px] font-semibold ${
          spent ? 'text-amber-400' : 'invisible text-transparent'
        }`}
      >
        Out of movement — fire or wait
      </span>
    </div>
  );
}

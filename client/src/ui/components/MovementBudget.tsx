import { isOutOfMovement, movementBlockText, movementFillStyle, movementText } from '../signals';

/**
 * How far this character may still walk this turn — Variant 2: a violet
 * stamina bar on the action cluster.
 */
export function MovementBudget() {
  const spent = isOutOfMovement.value;

  return (
    <div class="flex min-w-36 flex-col gap-2">
      <span class="hud-label">Move</span>

      <div class="flex items-center gap-2">
        <div class="relative h-8 flex-1 overflow-hidden border border-neutral-700 bg-black/40">
          <div
            class={`absolute inset-y-0 left-0 transition-[width] duration-150 ease-out ${
              spent ? 'bg-neutral-600' : 'bg-linear-to-r from-violet-600 to-fuchsia-400'
            }`}
            style={movementFillStyle}
          />
        </div>

        <span class="min-w-8 text-right text-sm font-bold tabular-nums text-ink">{movementText}</span>
      </div>

      {/* Space reserved whether or not there is a message, so the deck does
          not jump height the moment movement stops. */}
      <span
        class={`text-[10px] font-semibold ${
          movementBlockText.value ? 'text-amber-400' : 'invisible text-transparent'
        }`}
      >
        {movementBlockText.value || '\u00a0'}
      </span>
    </div>
  );
}

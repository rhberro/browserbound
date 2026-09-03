import { angleText, isMyTurn, lastAngleText } from '../signals';
import { useInput } from '../InputContext';
import { useHoldRepeat } from '../useHoldRepeat';

const STEPPER_CLASS =
  'flex size-9 items-center justify-center border border-accent/70 bg-accent/5 ' +
  'text-lg font-bold text-accent select-none touch-none ' +
  'hover:bg-accent/15 active:bg-accent/25 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent';

/** Aim angle with press-and-hold steppers and the previous shot's angle —
 *  Variant 2: sharp-edged steppers and a cyan readout. */
export function AngleControl() {
  const input = useInput();
  const down = useHoldRepeat(() => input.angleDown(), { accelerate: true });
  const up = useHoldRepeat(() => input.angleUp(), { accelerate: true });
  const disabled = !isMyTurn.value;

  return (
    <div class="flex min-w-36 flex-col gap-2">
      <span class="hud-label">Angle</span>

      <div class="flex items-center justify-center gap-2">
        <button type="button" class={STEPPER_CLASS} disabled={disabled} aria-label="Lower angle" {...down}>
          −
        </button>

        <div class="flex min-w-12 flex-col items-center">
          <span class="text-xl font-bold tabular-nums text-accent-300">{angleText}</span>
          <span class="text-[9px] text-neutral-500 tabular-nums">{lastAngleText}</span>
        </div>

        <button type="button" class={STEPPER_CLASS} disabled={disabled} aria-label="Raise angle" {...up}>
          +
        </button>
      </div>
    </div>
  );
}

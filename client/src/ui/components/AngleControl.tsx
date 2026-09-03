import { angleText, isMyTurn, lastAngleText } from '../signals';
import { useInput } from '../InputContext';
import { useHoldRepeat } from '../useHoldRepeat';

const STEPPER_CLASS =
  'flex size-9 items-center justify-center rounded-md border border-accent bg-transparent ' +
  'text-base font-semibold text-accent select-none touch-none ' +
  'hover:bg-accent/12 active:bg-accent/22 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent';

/** Aim angle with press-and-hold steppers and the previous shot's angle. */
export function AngleControl() {
  const input = useInput();
  const down = useHoldRepeat(() => input.angleDown());
  const up = useHoldRepeat(() => input.angleUp());
  const disabled = !isMyTurn.value;

  return (
    <div class="flex min-w-35 flex-col gap-2">
      <span class="hud-label">Angle</span>

      <div class="flex items-center justify-center gap-1.5">
        <button type="button" class={STEPPER_CLASS} disabled={disabled} aria-label="Lower angle" {...down}>
          −
        </button>

        <div class="flex min-w-12 flex-col items-center">
          <span class="text-sm font-semibold tabular-nums">{angleText}</span>
          <span class="text-[9px] text-neutral-600 tabular-nums">{lastAngleText}</span>
        </div>

        <button type="button" class={STEPPER_CLASS} disabled={disabled} aria-label="Raise angle" {...up}>
          +
        </button>
      </div>
    </div>
  );
}

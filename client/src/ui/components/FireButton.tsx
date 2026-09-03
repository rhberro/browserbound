import { useRef } from 'preact/hooks';
import { isCharging, isMyTurn } from '../signals';
import { useInput } from '../InputContext';

/**
 * Hold to charge, release to fire — Variant 2: a glowing cyan FIRE plate.
 *
 * The pointer is captured on press so the release always lands here even if the
 * cursor drifts off the button mid-charge.
 */
export function FireButton() {
  const input = useInput();
  const holding = useRef(false);
  const charging = isCharging.value;
  const disabled = !isMyTurn.value;

  const release = (e: PointerEvent) => {
    if (!holding.current) return;
    e.preventDefault();
    holding.current = false;
    input.release();
  };

  // Charging can also end elsewhere (the shot goes out, or the turn passes).
  if (!charging && holding.current) holding.current = false;

  return (
    <div class="flex items-end">
      <button
        type="button"
        disabled={disabled}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          holding.current = true;
          input.startCharging();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        class={
          'border-2 border-accent px-8 py-3.5 text-[15px] font-black text-accent ' +
          'select-none touch-none transition-shadow duration-100 ease-out ' +
          'hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent ' +
          (charging ? 'shadow-[0_0_24px_rgba(34,211,238,0.85),inset_0_0_12px_rgba(34,211,238,0.35)]' : '')
        }
      >
        FIRE
      </button>
    </div>
  );
}

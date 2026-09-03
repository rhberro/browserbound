import { useCallback, useEffect, useRef } from 'preact/hooks';

const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 60;

/**
 * Press-and-hold auto-repeat for stepper buttons: one step on press, then a
 * steady stream after a short delay.
 *
 * The pointer is captured so a hold survives the cursor drifting off the
 * button, and the repeat is cleared on every way a press can end.
 */
export function useHoldRepeat(step: () => void) {
  const delayRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  const stop = useCallback(() => {
    if (delayRef.current !== null) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // A component unmounting mid-hold must not leave an interval running.
  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      stepRef.current();
      stop();
      delayRef.current = window.setTimeout(() => {
        timerRef.current = window.setInterval(() => stepRef.current(), REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [stop]
  );

  return {
    onPointerDown,
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
  };
}

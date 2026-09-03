import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';

/**
 * How long a press must be held before it becomes a repeat rather than a tap.
 *
 * This is what makes "one tap is exactly one step" true: below this the button
 * has fired once and nothing is scheduled yet, so a player nudging aim by a
 * single unit cannot accidentally take two.
 */
export const HOLD_REPEAT_DELAY_MS = 350;

/** Cadence of a non-accelerating hold; the behaviour every stepper had before the ramp. */
export const FLAT_REPEAT_INTERVAL_MS = 60;

/**
 * Ramp constants, taken from GunBound's `Parameter.HUDCrosshair*Sensibility`
 * (0.15s start, 0.008s reduction per step, 0.03s floor) and kept in the same
 * proportions here.
 *
 * The point of the ramp is that fine adjustment and long travel are not the
 * same speed. The first repeats are *slower* than our old flat 60ms so a held
 * press can still be released on an exact value, and the floor is half the old
 * interval so crossing the whole aim range stops being a wait. The ramp
 * bottoms out after 15 repeats (~1.4s of holding), which is long enough that
 * nobody reaches full speed while making a small correction.
 */
export const RAMP_INITIAL_INTERVAL_MS = 150;
/** Reduction applied per repeat, so the acceleration is linear in step count. */
export const RAMP_DECREMENT_MS = 8;
/**
 * Fastest the repeat ever goes. Below ~30ms the stream outruns both the 20Hz
 * server patch rate and a player's ability to stop on a value, so a faster
 * floor buys travel speed by making the control unlandable.
 */
export const RAMP_MIN_INTERVAL_MS = 30;

/**
 * Gap that follows the auto-repeat at `repeatIndex` (0 being the first one,
 * which the hold delay itself precedes). Pure, and the whole ramp schedule.
 */
export function repeatIntervalMs(repeatIndex: number, accelerate: boolean): number {
  if (!accelerate) return FLAT_REPEAT_INTERVAL_MS;
  return Math.max(
    RAMP_MIN_INTERVAL_MS,
    RAMP_INITIAL_INTERVAL_MS - repeatIndex * RAMP_DECREMENT_MS
  );
}

export interface HoldRepeatOptions {
  /**
   * Opt in to the accelerating ramp. Off by default so a stepper only changes
   * feel when its owner asked for it — the aim controls want travel, a control
   * with a handful of discrete positions does not.
   */
  accelerate?: boolean;
}

export interface HoldRepeat {
  /** Fire one step immediately, then begin repeating from the top of the ramp. */
  start: () => void;
  /** End the hold and reset the ramp, so the next press starts slow again. */
  stop: () => void;
}

/**
 * The timer engine behind `useHoldRepeat`, free of Preact and the DOM so the
 * schedule can be asserted against fake timers.
 *
 * A chained `setTimeout` rather than `setInterval`, because an accelerating
 * cadence has a different delay every time and an interval cannot change its
 * period without being torn down and rebuilt each step.
 */
export function createHoldRepeat(step: () => void, options: HoldRepeatOptions = {}): HoldRepeat {
  const accelerate = options.accelerate ?? false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let repeatIndex = 0;

  const stop = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    repeatIndex = 0;
  };

  const scheduleNext = (delayMs: number) => {
    timer = setTimeout(() => {
      step();
      const delay = repeatIntervalMs(repeatIndex, accelerate);
      repeatIndex++;
      scheduleNext(delay);
    }, delayMs);
  };

  const start = () => {
    // Clearing first means a second press without a release (a lost pointerup,
    // a second finger) restarts the hold instead of running two chains at once.
    stop();
    step();
    scheduleNext(HOLD_REPEAT_DELAY_MS);
  };

  return { start, stop };
}

/**
 * Press-and-hold auto-repeat for stepper buttons: one step on press, a pause,
 * then a repeat at the cadence `options` selects — flat by default, or an
 * accelerating ramp for controls that need to travel a wide range.
 *
 * The pointer is captured so a hold survives the cursor drifting off the
 * button, and the repeat is cleared on every way a press can end. Releasing
 * resets the ramp, so each press starts slow enough to land on one value.
 */
export function useHoldRepeat(step: () => void, options: HoldRepeatOptions = {}) {
  const stepRef = useRef(step);
  stepRef.current = step;

  const accelerate = options.accelerate ?? false;
  // Keyed on `accelerate` alone: rebuilding the engine mid-hold would strand a
  // running timer, and `step` is read through a ref precisely to avoid that.
  const repeat = useMemo(
    () => createHoldRepeat(() => stepRef.current(), { accelerate }),
    [accelerate]
  );

  const stop = useCallback(() => repeat.stop(), [repeat]);

  // A component unmounting mid-hold must not leave a timer chain running.
  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      repeat.start();
    },
    [repeat]
  );

  return {
    onPointerDown,
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
  };
}

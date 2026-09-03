import { windArrowStyle, windValueText } from '../signals';

/**
 * Wind, as a compass dial — Variant 2: a compact cyan dial with a glowing
 * needle, parked top-right.
 *
 * Both readouts are bound as SIGNALS rather than props, so a wind change
 * patches one text node and one transform without re-rendering the component.
 * That is also what lets the CSS rotation transition run: re-rendering would
 * replace the element mid-transition and the needle would jump.
 */
export function WindDial() {
  return (
    <div class="pointer-events-auto">
      <div class="hud-panel relative flex size-20 items-center justify-center rounded-full text-ink">
        {/*
          The segmented rim. `pathLength` renormalises the circle to 100 units
          regardless of its radius, so the dash pattern is exact arithmetic —
          16 segments of 6.25 — instead of a circumference computed by hand.
        */}
        <svg class="absolute inset-0 size-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            class="text-neutral-700"
            stroke-width="8"
            pathLength="100"
            stroke-dasharray="4.5 1.75"
          />
        </svg>

        {/*
          The needle. Rotation is applied to a full-size layer and the arrow
          sits at its RIGHT edge, so zero degrees points right — matching the
          firing frame, where wind is applied as `vx += magnitude * cos(angle)`.
        */}
        <div
          class="absolute inset-0 transition-transform duration-300 ease-out"
          style={windArrowStyle}
          aria-hidden="true"
        >
          <svg
            class="absolute right-0 top-1/2 size-3.5 -translate-y-1/2 text-accent drop-shadow-[0_0_6px_var(--color-accent)]"
            viewBox="0 0 10 10"
            fill="currentColor"
          >
            <path d="M0 0.5 L9.5 5 L0 9.5 Z" />
          </svg>
        </div>

        <div class="flex flex-col items-center leading-none">
          <span class="text-xl font-bold tabular-nums text-accent-300">{windValueText}</span>
          <span class="hud-label mt-0.5">Wind</span>
        </div>
      </div>
    </div>
  );
}

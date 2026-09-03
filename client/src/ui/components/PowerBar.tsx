import { lastPowerStyle, lastPowerText, powerFillStyle, powerText } from '../signals';

/** Division markers every 10% so players can read the gauge at a glance. */
const DIVISIONS = Array.from({ length: 9 }, (_, i) => (i + 1) * 10);

const BAR_CLASS = 'absolute inset-y-0 left-0 bg-linear-to-r from-accent-600 to-accent';

/**
 * Charge gauge: the filling bar, plus a ghost of the previous shot's power to
 * aim off. This is the only part of the HUD that changes every frame, and both
 * bars are bound as signals so nothing here re-renders while charging.
 */
export function PowerBar() {
  return (
    <div class="flex min-w-50 flex-col gap-2">
      <span class="hud-label">Power</span>

      <div class="flex items-center gap-2">
        <div class="relative h-7 flex-1 overflow-hidden rounded-md border border-neutral-700 bg-neutral-800">
          <div class={`${BAR_CLASS} z-2 opacity-25`} style={lastPowerStyle} />
          <div class={`${BAR_CLASS} z-3`} style={powerFillStyle} />

          {DIVISIONS.map((percent) => (
            <div
              key={percent}
              class="absolute inset-y-0 z-4 w-px bg-neutral-600 opacity-40"
              style={`left:${percent}%`}
            />
          ))}
        </div>

        <div class="flex min-w-12 flex-col items-end">
          <span class="text-xs font-semibold tabular-nums">{powerText}</span>
          <span class="text-[9px] text-neutral-600 tabular-nums">{lastPowerText}</span>
        </div>
      </div>
    </div>
  );
}

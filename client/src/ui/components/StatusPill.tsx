import { windArrowStyle, windText } from '../signals';

/**
 * Wind magnitude and heading, shown at the top of the screen.
 *
 * Both readouts are bound as signals, so a wind change patches the text node
 * and the arrow's transform without re-rendering this component — which is what
 * lets the CSS rotation transition actually run.
 */
export function StatusPill() {
  return (
    <div class="pointer-events-auto flex justify-center p-5">
      <div class="hud-panel flex items-center gap-4 rounded-full px-6 py-3.5 text-ink shadow-lg shadow-black/40">
        <div class="flex flex-col items-center">
          <span class="hud-label">Wind</span>
          <span class="text-lg font-bold tabular-nums">{windText}</span>
        </div>

        <div class="h-10 w-px bg-neutral-700 opacity-50" />

        <div
          class="flex size-12 items-center justify-center text-3xl text-accent transition-transform duration-300 ease-out"
          style={windArrowStyle}
          aria-hidden="true"
        >
          →
        </div>
      </div>
    </div>
  );
}

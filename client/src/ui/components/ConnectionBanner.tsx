import { isConnected } from '../signals';

/**
 * Shown only while our own connection is dropped and being retried — Variant 2:
 * a glowing cyan alert strip.
 */
export function ConnectionBanner() {
  if (isConnected.value) return null;

  return (
    <div class="pointer-events-none flex justify-center px-4 pt-2">
      <div class="hud-panel px-5 py-1.5 text-sm font-bold text-accent">
        Connection lost — reconnecting…
      </div>
    </div>
  );
}

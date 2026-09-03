import { isConnected } from '../signals';

/**
 * Shown only while our own connection is dropped and being retried.
 *
 * Deliberately loud and centred: from inside a disconnect, a game that has
 * stopped responding and a game waiting on the opponent look exactly the same,
 * and the player needs to know which one they are in before they start
 * hammering keys.
 */
export function ConnectionBanner() {
  if (isConnected.value) return null;

  return (
    <div class="pointer-events-none flex justify-center px-4 pt-2">
      <div class="hud-panel rounded-full px-5 py-2 text-sm font-semibold text-accent shadow-lg shadow-black/40">
        Connection lost — reconnecting…
      </div>
    </div>
  );
}

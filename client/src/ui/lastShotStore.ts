/**
 * Per-player persistence for the "last used" angle/power readouts.
 *
 * Each browser tab is one player, so this deliberately uses sessionStorage
 * rather than localStorage: localStorage is shared by every tab on the origin,
 * which made one player's last shot leak into the other player's HUD when both
 * sat in the same browser. sessionStorage is scoped to the tab, so it still
 * survives a reload of that player's own session and nothing else.
 */

const PREFIX = 'browserbound:lastShot:';

export function readLastShotValue(key: string, fallback: number): number {
  try {
    const stored = sessionStorage.getItem(PREFIX + key);
    if (stored === null) return fallback;
    const value = parseFloat(stored);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies) — not fatal.
    return fallback;
  }
}

export function writeLastShotValue(key: string, value: number): void {
  try {
    sessionStorage.setItem(PREFIX + key, value.toString());
  } catch {
    // Ignore: the readout still works for the rest of this session.
  }
}

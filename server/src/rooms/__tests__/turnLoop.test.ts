import { describe, it, expect } from 'vitest';
import { shouldAdvanceTurn } from '../turnLoop';

describe('shouldAdvanceTurn', () => {
  it('passes the turn when the last projectile of a volley resolves', () => {
    expect(shouldAdvanceTurn({ active: 0, pending: 0, resolvedThisFrame: 1 })).toBe(true);
  });

  it('holds the turn while a projectile is still in the air', () => {
    expect(shouldAdvanceTurn({ active: 1, pending: 0, resolvedThisFrame: 1 })).toBe(false);
  });

  // The Burst defect. Burst stages three projectiles at frames 0, 5 and 10, so
  // a first shot that resolves immediately — into nearby terrain, or fired
  // straight down — empties the ACTIVE list while two shots are still staged.
  it('holds the turn while a projectile is still staged to fire', () => {
    expect(shouldAdvanceTurn({ active: 0, pending: 2, resolvedThisFrame: 1 })).toBe(false);
  });

  it('holds the turn when everything is staged and nothing is airborne yet', () => {
    expect(shouldAdvanceTurn({ active: 0, pending: 3, resolvedThisFrame: 0 })).toBe(false);
  });

  it('passes the turn only once the whole Burst volley has resolved', () => {
    // Frame-by-frame walk of the failing case: shot 1 fires and resolves at
    // once, shots 2 and 3 are still staged.
    expect(shouldAdvanceTurn({ active: 0, pending: 2, resolvedThisFrame: 1 })).toBe(false);
    // Shot 2 activates, then resolves; shot 3 is still staged.
    expect(shouldAdvanceTurn({ active: 0, pending: 1, resolvedThisFrame: 1 })).toBe(false);
    // Shot 3 activates and resolves. Nothing left anywhere.
    expect(shouldAdvanceTurn({ active: 0, pending: 0, resolvedThisFrame: 1 })).toBe(true);
  });

  it('does not pass the turn on an idle frame', () => {
    // Without the resolvedThisFrame term this is the state of EVERY frame of a
    // turn in which nobody has fired, and the turn would pass instantly.
    expect(shouldAdvanceTurn({ active: 0, pending: 0, resolvedThisFrame: 0 })).toBe(false);
  });
});

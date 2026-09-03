import { render } from 'preact';
import { HudRoot } from './HudRoot';
import { InputContext } from './InputContext';
import type { InputAdapter } from '../adapters/InputAdapter';

/** Mount the HUD overlay into the #hud element declared in index.html. */
export function mountHud(inputAdapter: InputAdapter): void {
  const host = document.getElementById('hud');
  if (!host) {
    console.error('HUD host element #hud not found');
    return;
  }

  render(
    <InputContext.Provider value={inputAdapter}>
      <HudRoot />
    </InputContext.Provider>,
    host
  );
}

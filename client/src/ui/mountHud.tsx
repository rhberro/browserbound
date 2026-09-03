import { render } from 'preact';
import { HudRoot } from './HudRoot';
import { InputContext } from './InputContext';
import type { InputAdapter } from '../adapters/InputAdapter';
import type { GameState } from '../gameState';

/** Mount the HUD overlay into the #hud element declared in index.html. */
export function mountHud(inputAdapter: InputAdapter, gameState: GameState): void {
  const host = document.getElementById('hud');
  if (!host) {
    console.error('HUD host element #hud not found');
    return;
  }

  render(
    <InputContext.Provider value={inputAdapter}>
      <HudRoot gameState={gameState} />
    </InputContext.Provider>,
    host
  );
}

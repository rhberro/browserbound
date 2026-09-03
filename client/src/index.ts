import * as PIXI from 'pixi.js';
import { h, render } from 'preact';
import { LoginSignup } from './ui/screens/LoginSignup';
import { supabase } from './supabase';
import { GameState } from './gameState';
import { GameScene } from './scenes/GameScene';

async function main() {
  try {
    // Check for existing session
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      // Show login/signup screen
      const ui = document.getElementById('ui');
      if (!ui) throw new Error('No UI element');

      render(
        h(LoginSignup, {
          onSuccess: () => {
            // Restart the app after successful auth
            window.location.reload();
          },
        }),
        ui,
      );
      return;
    }

    // Auth successful, initialize game
    const app = new PIXI.Application();

    await app.init({
      // `resizeTo` owns the size from here on, including the first one. The
      // initial size and the resize path used to be set separately and
      // disagreed — the first applied a 600px minimum height and the listener
      // did not — so a window shorter than 600px changed size on its first
      // resize event for no reason the player could see.
      resizeTo: window,
      backgroundColor: 0x87ceeb,
      antialias: true,
      // A deliberate decision, not a default: render at the display's true
      // pixel density and let autoDensity scale the canvas back down with CSS.
      // autoDensity was already on and meaningless without this. Capped at 2
      // because beyond that the fill cost stops buying visible sharpness.
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });

    const container = document.getElementById('game-container');
    if (!container) throw new Error('No container element');
    container.appendChild(app.canvas);

    const gameState = new GameState();
    await gameState.connect();

    const scene = new GameScene(app, gameState);

    const tick = () => {
      scene.update(app.ticker.deltaMS);
      scene.render();
    };
    app.ticker.add(tick);

    // Teardown. `resizeTo` means there is no hand-rolled resize listener left
    // to remove — Pixi's own handling throttles to one resize per frame, which
    // the hand-written one did not.
    const teardown = () => {
      app.ticker.remove(tick);
      scene.destroy();
      void gameState.leave();
      app.destroy(true, { children: true, texture: true });
    };
    window.addEventListener('pagehide', teardown, { once: true });
  } catch (error) {
    console.error('Failed to initialize game:', error);
    const ui = document.getElementById('ui');
    if (ui) {
      ui.innerHTML = `<div style="color: red;">Error: ${error instanceof Error ? error.message : String(error)}</div>`;
    }
  }
}

main();

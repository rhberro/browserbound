import * as PIXI from 'pixi.js';
import { Client } from 'colyseus.js';
import { GameState } from './gameState';
import { GameScene } from './scenes/GameScene';

async function main() {
  try {
    // Initialize Pixi
    const app = new PIXI.Application();
    const canvasWidth = window.innerWidth;
    const canvasHeight = Math.max(600, window.innerHeight);

    await app.init({
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: 0x87ceeb,
      antialias: true,
      autoDensity: true,
    });

    const container = document.getElementById('game-container');
    if (!container) throw new Error('No container element');
    container.appendChild(app.canvas);

    // Connect to server
    const gameState = new GameState();
    await gameState.connect();

    // Create game scene
    const scene = new GameScene(app, gameState);

    // Game loop
    app.ticker.add(() => {
      scene.update(app.ticker.deltaMS);
      scene.render();
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (app.renderer) {
        app.renderer.resize(window.innerWidth, window.innerHeight);
      }
    });
  } catch (error) {
    console.error('Failed to initialize game:', error);
    const ui = document.getElementById('ui');
    if (ui) {
      ui.innerHTML = `<div style="color: red;">Error: ${error instanceof Error ? error.message : String(error)}</div>`;
    }
  }
}

main();

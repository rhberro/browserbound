import * as PIXI from 'pixi.js';
import { Client } from 'colyseus.js';
import { GameState } from './gameState';
import { GameScene } from './scenes/GameScene';

async function main() {
  try {
    console.log('Initializing PixiJS...');

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

    console.log('PixiJS initialized, canvas:', app.canvas);

    const container = document.getElementById('game-container');
    if (!container) throw new Error('No container element');
    container.appendChild(app.canvas);

    console.log('Canvas appended to DOM');

    // Connect to server
    const gameState = new GameState();
    console.log('Connecting to server...');
    await gameState.connect();
    console.log('Connected to server');

    // Create game scene
    const scene = new GameScene(app, gameState);
    console.log('Game scene created');

    // Game loop
    app.ticker.add(() => {
      scene.update(app.ticker.deltaMS);
      scene.render();
    });

    console.log('Game loop started');

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

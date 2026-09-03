import * as PIXI from 'pixi.js';
import { supabase } from './supabase';
import { sceneManager } from './scenes/SceneManager';
import { LoginSignup } from './ui/screens/LoginSignup';
import { Splash } from './ui/screens/Splash';
import { MainMenu } from './ui/screens/MainMenu';
import { Settings } from './ui/screens/Settings';
import { FindServers } from './ui/screens/FindServers';
import { CreateServer } from './ui/screens/CreateServer';
import { Lobby } from './ui/screens/Lobby';
import { GameState } from './gameState';
import { GameScene } from './scenes/GameScene';

let app: PIXI.Application | null = null;
let gameState: GameState | null = null;
let gameScene: GameScene | null = null;

async function initializeGame() {
  if (app) return;

  app = new PIXI.Application();

  await app.init({
    resizeTo: window,
    backgroundColor: 0x87ceeb,
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });

  const container = document.getElementById('game-container');
  if (!container) throw new Error('No container element');
  container.appendChild(app.canvas);

  gameState = new GameState();
  await gameState.connect();

  gameScene = new GameScene(app, gameState);

  const tick = () => {
    if (gameScene && app) {
      gameScene.update(app.ticker.deltaMS);
      gameScene.render();
    }
  };
  app.ticker.add(tick);

  const teardown = () => {
    if (app) {
      app.ticker.remove(tick);
      if (gameScene) gameScene.destroy();
      if (gameState) void gameState.leave();
      app.destroy(true, { children: true, texture: true });
    }
  };
  window.addEventListener('pagehide', teardown, { once: true });
}

async function main() {
  try {
    // Register all screens
    sceneManager.registerScene('splash', Splash);
    sceneManager.registerScene('auth', LoginSignup);
    sceneManager.registerScene('mainMenu', MainMenu);
    sceneManager.registerScene('settings', Settings);
    sceneManager.registerScene('findServers', FindServers);
    sceneManager.registerScene('createServer', CreateServer);
    sceneManager.registerScene('lobby', Lobby);

    // Show splash screen first
    sceneManager.go('splash', {
      onDone: () => checkAuth(),
    });
  } catch (error) {
    console.error('Failed to initialize app:', error);
    const ui = document.getElementById('hud');
    if (ui) {
      ui.innerHTML = `<div style="color: red;">Error: ${error instanceof Error ? error.message : String(error)}</div>`;
    }
  }
}

async function checkAuth() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    sceneManager.go('auth', {
      onSuccess: () => {
        checkAuth();
      },
    });
    return;
  }

  // Auth successful, go to main menu
  await initializeGame();
  sceneManager.go('mainMenu', {
    onNavigate: (scene: string) => {
      sceneManager.go(scene as any, {
        onNavigate: (nextScene: string) => {
          sceneManager.go(nextScene as any, {
            onNavigate: (finalScene: string) => {
              sceneManager.go(finalScene as any);
            },
          });
        },
      });
    },
  });
}

main();

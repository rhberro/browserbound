import { h, render, FunctionComponent } from 'preact';
import { unmountHud } from '../ui/mountHud';
import type { MatchPhase } from '@browserbond/shared';

type SceneName = 'splash' | 'auth' | 'mainMenu' | 'settings' | 'findServers' | 'createServer' | 'lobby' | 'game';

interface SceneComponent {
  component: FunctionComponent<any>;
  props?: Record<string, any>;
}

const scenes: Record<Exclude<SceneName, 'game'>, SceneComponent> = {
  splash: { component: () => h('div', {}, 'Splash') }, // Will be replaced
  auth: { component: () => h('div', {}, 'Auth') }, // Will be replaced
  mainMenu: { component: () => h('div', {}, 'Main Menu') }, // Will be replaced
  settings: { component: () => h('div', {}, 'Settings') }, // Will be replaced
  findServers: { component: () => h('div', {}, 'Find Servers') },
  createServer: { component: () => h('div', {}, 'Create Server') },
  lobby: { component: () => h('div', {}, 'Lobby') },
};

export class SceneManager {
  private currentScene: SceneName | null = null;

  registerScene(name: Exclude<SceneName, 'game'>, component: FunctionComponent<any>, props?: Record<string, any>) {
    scenes[name] = { component, props };
  }

  go(sceneName: SceneName, params?: Record<string, any>) {
    // Handle game scene specially - it's a PIXI renderer, not a UI component
    if (sceneName === 'game') {
      if (this.currentScene !== 'game') {
        unmountHud();
        const { createGameScene } = require('../index');
        createGameScene();
      }
      this.currentScene = sceneName;
      return;
    }

    // For UI scenes, unmount game scene if active
    if (this.currentScene === 'game') {
      const { destroyGameScene } = require('../index');
      destroyGameScene();
    }

    // Unmount previous UI scene
    if (this.currentScene !== null && this.currentScene !== 'game') {
      unmountHud();
    }

    const sceneUi = scenes[sceneName as Exclude<SceneName, 'game'>];
    if (!sceneUi) {
      console.warn(`Scene "${sceneName}" not found`);
      return;
    }

    // Mount new scene
    const props = { ...sceneUi.props, ...params };
    const ui = document.getElementById('hud');
    if (!ui) {
      console.error('No HUD element found');
      return;
    }

    render(h(sceneUi.component, props), ui);
    this.currentScene = sceneName;
  }

  getCurrentScene(): SceneName | null {
    return this.currentScene;
  }

  onMatchPhaseChange(phase: MatchPhase) {
    if (phase === 'playing') {
      this.go('game');
    } else if (phase === 'lobby') {
      this.go('lobby');
    }
  }
}

export const sceneManager = new SceneManager();

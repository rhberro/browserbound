import { h, render, FunctionComponent } from 'preact';
import { unmountHud, mountHud } from '../ui/mountHud';

type SceneName = 'splash' | 'auth' | 'mainMenu' | 'settings' | 'findServers' | 'createServer' | 'lobby';

interface SceneComponent {
  component: FunctionComponent<any>;
  props?: Record<string, any>;
}

const scenes: Record<SceneName, SceneComponent> = {
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

  registerScene(name: SceneName, component: FunctionComponent<any>, props?: Record<string, any>) {
    scenes[name] = { component, props };
  }

  go(sceneName: SceneName, params?: Record<string, any>) {
    // Unmount previous scene
    if (this.currentScene !== null) {
      unmountHud();
    }

    const scene = scenes[sceneName];
    if (!scene) {
      console.warn(`Scene "${sceneName}" not found`);
      return;
    }

    // Mount new scene
    const props = { ...scene.props, ...params };
    const ui = document.getElementById('hud');
    if (!ui) {
      console.error('No HUD element found');
      return;
    }

    render(h(scene.component, props), ui);
    this.currentScene = sceneName;
  }

  getCurrentScene(): SceneName | null {
    return this.currentScene;
  }
}

export const sceneManager = new SceneManager();

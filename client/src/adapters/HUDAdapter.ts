import { GameState } from '../gameState';
import { InputAdapter, AimState } from './InputAdapter';
import { StatusPill } from '../components/StatusPill';
import { AngleControl } from '../components/AngleControl';
import { PowerBar } from '../components/PowerBar';
import { WeaponSelector } from '../components/WeaponSelector';
import { FireButton } from '../components/FireButton';

/**
 * HUDAdapter: Orchestrates HUD component lifecycle and updates.
 * Each component independently subscribes to gameState/InputAdapter.
 */
export class HUDAdapter {
  private container: HTMLElement | null = null;
  private gameState: GameState;
  private inputAdapter: InputAdapter;

  // Components
  private statusPill: StatusPill | null = null;
  private angleControl: AngleControl | null = null;
  private powerBar: PowerBar | null = null;
  private weaponSelector: WeaponSelector | null = null;
  private fireButton: FireButton | null = null;

  constructor(gameState: GameState, inputAdapter: InputAdapter) {
    this.gameState = gameState;
    this.inputAdapter = inputAdapter;
  }

  initialize(): void {
    this.container = document.getElementById('hud');
    if (!this.container) {
      console.error('HUD container not found');
      return;
    }

    this.setupLayout();
    this.mountComponents();
  }

  private setupLayout(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="hud-root" style="
        position: absolute;
        inset: 0;
        pointer-events: none;
        display: flex;
        flex-direction: column;
      ">
        <div id="hud-status" style="
          pointer-events: auto;
          flex-shrink: 0;
        "></div>
        <div id="hud-controls" style="
          pointer-events: auto;
          position: absolute;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 32px;
          padding: 20px 32px;
          background: rgba(22, 24, 38, 0.92);
          border: 1px solid var(--color-neutral-700);
          border-radius: 12px;
          max-width: 90vw;
        "></div>
      </div>
    `;
  }

  private mountComponents(): void {
    // Status components
    this.statusPill = new StatusPill(this.gameState);
    this.statusPill.mount('hud-status');

    // Control components
    this.angleControl = new AngleControl(this.inputAdapter);
    this.angleControl.mount('hud-controls');

    this.powerBar = new PowerBar(this.inputAdapter);
    this.powerBar.mount('hud-controls');

    this.weaponSelector = new WeaponSelector(this.inputAdapter);
    this.weaponSelector.mount('hud-controls');

    this.fireButton = new FireButton(this.inputAdapter);
    this.fireButton.mount('hud-controls');
  }

  /**
   * Update all components with current state.
   * Called each frame.
   */
  update(aimState: AimState): void {
    this.statusPill?.update();
    this.angleControl?.update();
    this.powerBar?.update();
    this.weaponSelector?.update();
    this.fireButton?.update();
  }

  destroy(): void {
    this.statusPill?.destroy();
    this.angleControl?.destroy();
    this.powerBar?.destroy();
    this.weaponSelector?.destroy();
    this.fireButton?.destroy();

    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

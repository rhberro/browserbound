import { GameState } from '../gameState';
import { InputAdapter, AimState } from './InputAdapter';

export class HUDAdapter {
  private container: HTMLElement | null = null;
  private gameState: GameState;
  private inputAdapter: InputAdapter;

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

    // Initialize HUD structure
    this.setupHUD();
  }

  private setupHUD(): void {
    if (!this.container) return;

    // Create main HUD container with layout
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
          flex-grow: 1;
        "></div>
      </div>
    `;
  }

  /**
   * Update HUD with current game and input state.
   * Called each frame or on state changes.
   */
  update(aimState: AimState): void {
    if (!this.container) return;

    const statusDiv = document.getElementById('hud-status');
    if (statusDiv) {
      this.updateStatus(statusDiv, aimState);
    }

    const controlsDiv = document.getElementById('hud-controls');
    if (controlsDiv) {
      this.updateControls(controlsDiv, aimState);
    }
  }

  private updateStatus(container: HTMLElement, aimState: AimState): void {
    const turnState = this.gameState.turnState;
    if (!turnState) return;

    // Status pill with wind and round info
    const windSpeed = (turnState.windSpeed / 100).toFixed(1);
    const windAngle = (turnState.windDirection * 180) / Math.PI;

    container.innerHTML = `
      <div style="
        padding: 16px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 24px;
      ">
        <div style="
          padding: 12px 18px;
          border-radius: 999px;
          background: rgba(22, 24, 38, 0.92);
          border: 1px solid var(--color-neutral-700);
          display: flex;
          align-items: center;
          gap: 14px;
          font-size: 14px;
          color: var(--color-text);
        ">
          <span>WIND: <strong>${windSpeed}</strong></span>
          <span style="
            display: inline-block;
            transform: rotate(${windAngle}deg);
            transition: transform 0.3s ease-out;
          ">→</span>
        </div>
      </div>
    `;
  }

  private updateControls(container: HTMLElement, aimState: AimState): void {
    const selectedWeapon = this.inputAdapter.getSelectedWeapon();

    container.innerHTML = `
      <div style="
        position: absolute;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 24px;
        padding: 16px;
        background: rgba(22, 24, 38, 0.92);
        border: 1px solid var(--color-neutral-700);
        border-radius: 12px;
      ">
        <!-- Angle Control -->
        <div id="angle-control" style="display: flex; flex-direction: column; gap: 8px; min-width: 120px;">
          <label style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-500);">Angle</label>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="angle-down" style="
              padding: 6px 10px;
              border: 1px solid var(--color-accent);
              background: transparent;
              color: var(--color-accent);
              border-radius: 4px;
              cursor: pointer;
            ">−</button>
            <span style="min-width: 40px; text-align: center; font-weight: 600;">${aimState.angle.toFixed(0)}°</span>
            <button id="angle-up" style="
              padding: 6px 10px;
              border: 1px solid var(--color-accent);
              background: transparent;
              color: var(--color-accent);
              border-radius: 4px;
              cursor: pointer;
            ">+</button>
          </div>
        </div>

        <!-- Power Bar -->
        <div id="power-control" style="display: flex; flex-direction: column; gap: 8px; min-width: 140px;">
          <label style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-500);">Power</label>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="
              flex: 1;
              height: 24px;
              background: var(--color-neutral-800);
              border: 1px solid var(--color-neutral-700);
              border-radius: 4px;
              overflow: hidden;
              position: relative;
            ">
              <div style="
                height: 100%;
                width: ${aimState.power}%;
                background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent));
                transition: width 0.05s linear;
              "></div>
            </div>
            <span style="min-width: 35px; text-align: right; font-weight: 600; font-size: 12px;">${aimState.power.toFixed(0)}%</span>
          </div>
        </div>

        <!-- Weapon Selector -->
        <div id="weapon-control" style="display: flex; flex-direction: column; gap: 8px;">
          <label style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-500);">Weapon</label>
          <div style="display: flex; gap: 4px;">
            <button id="weapon-1" data-weapon="1" style="
              padding: 8px 12px;
              border: 1px solid ${selectedWeapon === 1 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
              background: ${selectedWeapon === 1 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
              color: var(--color-text);
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              font-weight: ${selectedWeapon === 1 ? '600' : '400'};
            ">1</button>
            <button id="weapon-2" data-weapon="2" style="
              padding: 8px 12px;
              border: 1px solid ${selectedWeapon === 2 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
              background: ${selectedWeapon === 2 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
              color: var(--color-text);
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              font-weight: ${selectedWeapon === 2 ? '600' : '400'};
            ">2</button>
            <button id="weapon-3" data-weapon="3" style="
              padding: 8px 12px;
              border: 1px solid ${selectedWeapon === 3 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
              background: ${selectedWeapon === 3 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
              color: var(--color-text);
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              font-weight: ${selectedWeapon === 3 ? '600' : '400'};
            ">3</button>
          </div>
        </div>

        <!-- Fire Button -->
        <div id="fire-control" style="display: flex; align-items: flex-end;">
          <button id="fire-button" style="
            padding: 12px 24px;
            border: 2px solid var(--color-accent);
            background: transparent;
            color: var(--color-accent);
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            transition: all 0.1s ease-out;
            ${aimState.isCharging ? 'box-shadow: 0 0 16px rgba(145, 132, 217, 0.6);' : ''}
          ">FIRE</button>
        </div>
      </div>
    `;

    // Attach event listeners
    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    // Angle controls
    const angleDown = document.getElementById('angle-down');
    const angleUp = document.getElementById('angle-up');
    if (angleDown) angleDown.addEventListener('click', () => this.inputAdapter.angleDown());
    if (angleUp) angleUp.addEventListener('click', () => this.inputAdapter.angleUp());

    // Weapon selector
    for (let i = 1; i <= 3; i++) {
      const btn = document.getElementById(`weapon-${i}`);
      if (btn) {
        btn.addEventListener('click', () => this.inputAdapter.selectWeapon(i));
      }
    }

    // Fire button
    const fireBtn = document.getElementById('fire-button');
    if (fireBtn) {
      fireBtn.addEventListener('mousedown', () => this.inputAdapter.startCharging());
      fireBtn.addEventListener('mouseup', () => this.inputAdapter.fire());
      fireBtn.addEventListener('mouseleave', () => this.inputAdapter.release());
    }
  }
}

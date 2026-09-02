import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * PowerBar: Displays power charging bar (0-100%) with divisions and last-used ghost bar.
 * Last-used stays visible while charging and updates only on release.
 */
export class PowerBar {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;
  private lastPower: number = 0;

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
    // Load last power from localStorage
    const stored = localStorage.getItem('lastUsedPower');
    if (stored) this.lastPower = parseFloat(stored);
  }

  mount(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) {
      console.error(`PowerBar: parent ${parentId} not found`);
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'power-control';
    this.container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 200px;
    `;
    parent.appendChild(this.container);

    this.update();
  }

  update(): void {
    if (!this.container) return;

    const aimState = this.inputAdapter.getAimState();

    // Save power only when releasing (not while charging)
    if (!aimState.isCharging && aimState.power === 0 && this.lastPower !== this.inputAdapter.getAimState().power) {
      // Power was just released - save it
      if (this.lastPower > 0) {
        localStorage.setItem('lastUsedPower', this.lastPower.toString());
      }
    } else if (aimState.isCharging) {
      // While charging, track what would be saved on release
      this.lastPower = aimState.power;
    }

    // Generate division markers at 10%, 20%, etc.
    const divisions = Array.from({length: 10}, (_, i) => {
      const percent = (i + 1) * 10;
      return `<div style="
        position: absolute;
        left: ${percent}%;
        top: 0;
        width: 1px;
        height: 100%;
        background: var(--color-neutral-600);
        opacity: 0.4;
        z-index: 1;
      "></div>`;
    }).join('');

    // Get last used value from localStorage for display
    const storedLastPower = parseFloat(localStorage.getItem('lastUsedPower') || '0');

    this.container.innerHTML = `
      <label style="font-size: 10px; text-transform: uppercase; color: var(--color-neutral-500);">Power</label>
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="
          flex: 1;
          height: 28px;
          background: var(--color-neutral-800);
          border: 1px solid var(--color-neutral-700);
          border-radius: 4px;
          overflow: visible;
          position: relative;
        ">
          <div style="
            position: absolute;
            inset: 0;
            display: flex;
          ">
            ${divisions}
          </div>
          <!-- Last used ghost bar (behind current) -->
          <div style="
            position: absolute;
            height: 100%;
            width: ${storedLastPower}%;
            background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent));
            opacity: 0.25;
            transition: width 0.1s linear;
            z-index: 2;
          "></div>
          <!-- Current power bar (in front) -->
          <div style="
            position: absolute;
            height: 100%;
            width: ${aimState.power}%;
            background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent));
            transition: width 0.05s linear;
            z-index: 3;
          "></div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; min-width: 50px;">
          <span style="font-weight: 600; font-size: 12px;">${aimState.power.toFixed(0)}%</span>
          <span style="
            font-size: 9px;
            color: var(--color-neutral-600);
            opacity: 0.6;
            height: 14px;
            display: flex;
            align-items: center;
          ">Last: ${storedLastPower.toFixed(0)}%</span>
        </div>
      </div>
    `;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

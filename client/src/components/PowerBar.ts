import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * PowerBar: Displays power charging bar (0-100%) with divisions and last-used ghost bar.
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

    // Save power if charged
    if (aimState.power > 0) {
      this.lastPower = aimState.power;
      localStorage.setItem('lastUsedPower', this.lastPower.toString());
    }

    // Generate division markers at 10%, 20%, etc.
    let divisions = '';
    for (let i = 1; i <= 10; i++) {
      const percent = i * 10;
      divisions += `<div style="
        position: absolute;
        left: ${percent}%;
        top: -4px;
        width: 1px;
        height: 4px;
        background: var(--color-neutral-600);
        opacity: 0.5;
      "></div>`;
    }

    this.container.innerHTML = `
      <label style="font-size: 10px; text-transform: uppercase; color: var(--color-neutral-500);">Power</label>
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="
          flex: 1;
          height: 28px;
          background: var(--color-neutral-800);
          border: 1px solid var(--color-neutral-700);
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        ">
          ${divisions}
          <!-- Last used ghost bar -->
          <div style="
            position: absolute;
            height: 100%;
            width: ${this.lastPower}%;
            background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent));
            opacity: 0.2;
            transition: width 0.1s linear;
            z-index: 1;
          "></div>
          <!-- Current power bar -->
          <div style="
            position: absolute;
            height: 100%;
            width: ${aimState.power}%;
            background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent));
            transition: width 0.05s linear;
            z-index: 2;
          "></div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; min-width: 45px;">
          <span style="font-weight: 600; font-size: 12px;">${aimState.power.toFixed(0)}%</span>
          <span style="
            font-size: 9px;
            color: var(--color-neutral-600);
            opacity: 0.6;
          ">Last: ${this.lastPower.toFixed(0)}%</span>
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

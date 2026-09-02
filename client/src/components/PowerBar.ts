import { InputAdapter } from '../adapters/InputAdapter';
import { readLastShotValue, writeLastShotValue } from './lastShotStore';

/**
 * PowerBar: Displays power charging bar (0-100%) with divisions and last-used ghost bar.
 *
 * The DOM is built once in mount(); update() only patches widths and labels.
 * "Last used" is committed on the charging -> not-charging edge, so the ghost
 * bar keeps showing the previous shot while the player charges the next one.
 */
export class PowerBar {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;

  private lastPower: number = 0;
  private chargingPower: number = 0;
  private wasCharging: boolean = false;

  // Live nodes
  private fillEl: HTMLElement | null = null;
  private ghostEl: HTMLElement | null = null;
  private valueEl: HTMLElement | null = null;
  private lastEl: HTMLElement | null = null;

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
    this.lastPower = readLastShotValue('power', 0);
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

    // Division markers at 10%, 20%, ...
    const divisions = Array.from({ length: 9 }, (_, i) => {
      const percent = (i + 1) * 10;
      return `<div style="
        position: absolute;
        left: ${percent}%;
        top: 0;
        width: 1px;
        height: 100%;
        background: var(--color-neutral-600);
        opacity: 0.4;
        z-index: 4;
      "></div>`;
    }).join('');

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
          <!-- Last used ghost bar (behind current) -->
          <div id="power-ghost" style="
            position: absolute;
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent));
            opacity: 0.25;
            z-index: 2;
          "></div>
          <!-- Current power bar (in front) -->
          <div id="power-fill" style="
            position: absolute;
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent));
            z-index: 3;
          "></div>
          ${divisions}
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; min-width: 50px;">
          <span id="power-value" style="font-weight: 600; font-size: 12px;">0%</span>
          <span id="power-last" style="
            font-size: 9px;
            color: var(--color-neutral-600);
            opacity: 0.6;
            height: 14px;
            display: flex;
            align-items: center;
          ">Last: 0%</span>
        </div>
      </div>
    `;
    parent.appendChild(this.container);

    this.fillEl = this.container.querySelector('#power-fill');
    this.ghostEl = this.container.querySelector('#power-ghost');
    this.valueEl = this.container.querySelector('#power-value');
    this.lastEl = this.container.querySelector('#power-last');

    this.update();
  }

  update(): void {
    if (!this.fillEl || !this.ghostEl || !this.valueEl || !this.lastEl) return;

    const { power, isCharging } = this.inputAdapter.getAimState();

    if (isCharging) {
      // Remember the highest reading so the release edge has a value to commit,
      // even though power is zeroed the same frame the shot goes out.
      this.chargingPower = power;
    } else if (this.wasCharging && this.chargingPower > 0) {
      this.lastPower = this.chargingPower;
      this.chargingPower = 0;
      writeLastShotValue('power', this.lastPower);
    }
    this.wasCharging = isCharging;

    const fillWidth = `${power}%`;
    if (this.fillEl.style.width !== fillWidth) this.fillEl.style.width = fillWidth;

    const ghostWidth = `${this.lastPower}%`;
    if (this.ghostEl.style.width !== ghostWidth) this.ghostEl.style.width = ghostWidth;

    const valueText = `${power.toFixed(0)}%`;
    if (this.valueEl.textContent !== valueText) this.valueEl.textContent = valueText;

    const lastText = `Last: ${this.lastPower.toFixed(0)}%`;
    if (this.lastEl.textContent !== lastText) this.lastEl.textContent = lastText;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

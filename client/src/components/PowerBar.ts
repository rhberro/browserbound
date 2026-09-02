import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * PowerBar: Displays power charging bar (0-100%).
 * Independently subscribes to InputAdapter charging state updates.
 */
export class PowerBar {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
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
      min-width: 140px;
    `;
    parent.appendChild(this.container);

    this.update();
  }

  update(): void {
    if (!this.container) return;

    const aimState = this.inputAdapter.getAimState();

    this.container.innerHTML = `
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
    `;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

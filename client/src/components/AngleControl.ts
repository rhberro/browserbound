import { InputAdapter, AimState } from '../adapters/InputAdapter';

/**
 * AngleControl: Displays angle stepper buttons and slider with last-used angle.
 * Attaches listeners directly to button elements.
 */
export class AngleControl {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;
  private lastAngle: number = 45;

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
  }

  mount(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) {
      console.error(`AngleControl: parent ${parentId} not found`);
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'angle-control';
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
      <label style="font-size: 10px; text-transform: uppercase; color: var(--color-neutral-500);">Angle</label>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button id="angle-down-btn" style="
          padding: 6px 10px;
          border: 1px solid var(--color-accent);
          background: transparent;
          color: var(--color-accent);
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
        ">−</button>
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 45px;">
          <span style="font-weight: 600; font-size: 13px;">${aimState.angle.toFixed(0)}°</span>
          <span style="
            font-size: 9px;
            color: var(--color-neutral-600);
            opacity: 0.6;
          ">Last: ${this.lastAngle.toFixed(0)}°</span>
        </div>
        <button id="angle-up-btn" style="
          padding: 6px 10px;
          border: 1px solid var(--color-accent);
          background: transparent;
          color: var(--color-accent);
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
        ">+</button>
      </div>
    `;

    this.attachListeners();
  }

  private attachListeners(): void {
    const downBtn = this.container?.querySelector('#angle-down-btn') as HTMLButtonElement;
    const upBtn = this.container?.querySelector('#angle-up-btn') as HTMLButtonElement;

    if (downBtn) {
      downBtn.onclick = () => {
        this.inputAdapter.angleDown();
        this.lastAngle = this.inputAdapter.getAimState().angle;
        this.update();
      };
    }

    if (upBtn) {
      upBtn.onclick = () => {
        this.inputAdapter.angleUp();
        this.lastAngle = this.inputAdapter.getAimState().angle;
        this.update();
      };
    }
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

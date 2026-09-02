import { InputAdapter } from '../adapters/InputAdapter';
import { readLastShotValue, writeLastShotValue } from './lastShotStore';

/**
 * AngleControl: Displays angle stepper buttons with last-used angle.
 *
 * The DOM is built once in mount(); update() only patches text so the
 * buttons survive across frames and can receive click/press events.
 */
export class AngleControl {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;
  private lastAngle: number = 0;
  private chargingAngle: number = 0;
  private wasCharging: boolean = false;

  // Live nodes
  private valueEl: HTMLElement | null = null;
  private lastEl: HTMLElement | null = null;

  // Press-and-hold repeat
  private repeatTimer: number | null = null;
  private repeatDelay: number | null = null;

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
    this.lastAngle = readLastShotValue('angle', 0);
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

    const buttonStyle = `
      padding: 6px 10px;
      border: 1px solid var(--color-accent);
      background: transparent;
      color: var(--color-accent);
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      user-select: none;
    `;

    this.container.innerHTML = `
      <label style="font-size: 10px; text-transform: uppercase; color: var(--color-neutral-500);">Angle</label>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button id="angle-down-btn" type="button" style="${buttonStyle}">−</button>
        <div style="display: flex; flex-direction: column; align-items: center; min-width: 45px;">
          <span id="angle-value" style="font-weight: 600; font-size: 13px;">45°</span>
          <span id="angle-last" style="
            font-size: 9px;
            color: var(--color-neutral-600);
            opacity: 0.6;
          ">Last: 0°</span>
        </div>
        <button id="angle-up-btn" type="button" style="${buttonStyle}">+</button>
      </div>
    `;
    parent.appendChild(this.container);

    this.valueEl = this.container.querySelector('#angle-value');
    this.lastEl = this.container.querySelector('#angle-last');

    this.bindStepper('#angle-down-btn', () => this.inputAdapter.angleDown());
    this.bindStepper('#angle-up-btn', () => this.inputAdapter.angleUp());

    this.update();
  }

  /**
   * Wire a stepper button: one step on press, then auto-repeat while held.
   */
  private bindStepper(selector: string, step: () => void): void {
    const btn = this.container?.querySelector(selector) as HTMLButtonElement | null;
    if (!btn) return;

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      step();
      this.update();

      this.stopRepeat();
      this.repeatDelay = window.setTimeout(() => {
        this.repeatTimer = window.setInterval(() => {
          step();
          this.update();
        }, 60);
      }, 350);
    });

    const stop = () => this.stopRepeat();
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  }

  private stopRepeat(): void {
    if (this.repeatDelay !== null) {
      clearTimeout(this.repeatDelay);
      this.repeatDelay = null;
    }
    if (this.repeatTimer !== null) {
      clearInterval(this.repeatTimer);
      this.repeatTimer = null;
    }
  }

  update(): void {
    if (!this.valueEl || !this.lastEl) return;

    const { angle, isCharging } = this.inputAdapter.getAimState();

    // "Last" means the angle of the previous shot: commit it on the
    // charging -> not-charging edge, the same moment the shot goes out.
    if (isCharging) {
      this.chargingAngle = angle;
    } else if (this.wasCharging) {
      this.lastAngle = this.chargingAngle;
      writeLastShotValue('angle', this.lastAngle);
    }
    this.wasCharging = isCharging;

    const valueText = `${angle.toFixed(0)}°`;
    if (this.valueEl.textContent !== valueText) this.valueEl.textContent = valueText;

    const lastText = `Last: ${this.lastAngle.toFixed(0)}°`;
    if (this.lastEl.textContent !== lastText) this.lastEl.textContent = lastText;
  }

  destroy(): void {
    this.stopRepeat();
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

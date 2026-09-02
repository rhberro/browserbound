import { GameState } from '../gameState';

/**
 * StatusPill: Displays wind speed (as %), direction, and round indicator.
 */
export class StatusPill {
  private container: HTMLElement | null = null;
  private gameState: GameState;

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  mount(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) {
      console.error(`StatusPill: parent ${parentId} not found`);
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'status-pill';
    this.container.style.cssText = `
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 24px;
    `;
    parent.appendChild(this.container);

    this.update();
  }

  update(): void {
    if (!this.container) return;

    const turnState = this.gameState.turnState;
    if (!turnState) return;

    // Wind: 0-50 becomes 0-100%
    const windPercent = Math.round((turnState.windSpeed / 50) * 100);
    const windAngle = (turnState.windDirection * 180) / Math.PI;

    this.container.innerHTML = `
      <div style="
        padding: 14px 22px;
        border-radius: 999px;
        background: rgba(22, 24, 38, 0.92);
        border: 1px solid var(--color-neutral-700);
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 15px;
        color: var(--color-text);
      ">
        <div style="display: flex; flex-direction: column; align-items: center;">
          <span style="font-size: 11px; text-transform: uppercase; color: var(--color-neutral-500);">Wind</span>
          <span style="font-weight: 700; font-size: 18px;">${windPercent}%</span>
        </div>
        <div style="
          width: 1px;
          height: 40px;
          background: var(--color-neutral-700);
          opacity: 0.5;
        "></div>
        <div style="
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          transform: rotate(${windAngle}deg);
          transition: transform 0.3s ease-out;
          font-size: 32px;
          color: var(--color-accent);
        ">→</div>
      </div>
    `;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

import { GameState } from '../gameState';

/**
 * StatusPill: Displays wind speed, direction, and round indicator.
 * Independently subscribes to gameState.windChanged events.
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
      padding: 16px;
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

    const windSpeed = (turnState.windSpeed / 100).toFixed(1);
    const windAngle = (turnState.windDirection * 180) / Math.PI;

    this.container.innerHTML = `
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
    `;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

import { InputAdapter } from '../adapters/InputAdapter';

/**
 * WeaponSelector: Displays weapon selection buttons (1/2/3).
 * Uses event delegation for persistent event handling.
 */
export class WeaponSelector {
  private container: HTMLElement | null = null;
  private inputAdapter: InputAdapter;
  private listenerAttached: boolean = false;

  constructor(inputAdapter: InputAdapter) {
    this.inputAdapter = inputAdapter;
  }

  mount(parentId: string): void {
    const parent = document.getElementById(parentId);
    if (!parent) {
      console.error(`WeaponSelector: parent ${parentId} not found`);
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'weapon-control';
    this.container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
    parent.appendChild(this.container);

    this.setupEventDelegation();
    this.update();
  }

  private setupEventDelegation(): void {
    if (!this.container || this.listenerAttached) return;

    this.container.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const weaponNum = target.getAttribute('data-weapon');
      if (weaponNum) {
        this.inputAdapter.selectWeapon(parseInt(weaponNum));
        this.update();
      }
    });

    this.listenerAttached = true;
  }

  update(): void {
    if (!this.container) return;

    const selectedWeapon = this.inputAdapter.getSelectedWeapon();

    this.container.innerHTML = `
      <label style="font-size: 10px; text-transform: uppercase; color: var(--color-neutral-500);">Weapon</label>
      <div style="display: flex; gap: 4px;">
        <button data-weapon="1" style="
          padding: 8px 14px;
          border: 1px solid ${selectedWeapon === 1 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
          background: ${selectedWeapon === 1 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
          color: var(--color-text);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: ${selectedWeapon === 1 ? '600' : '400'};
          transition: all 0.1s;
        ">1</button>
        <button data-weapon="2" style="
          padding: 8px 14px;
          border: 1px solid ${selectedWeapon === 2 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
          background: ${selectedWeapon === 2 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
          color: var(--color-text);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: ${selectedWeapon === 2 ? '600' : '400'};
          transition: all 0.1s;
        ">2</button>
        <button data-weapon="3" style="
          padding: 8px 14px;
          border: 1px solid ${selectedWeapon === 3 ? 'var(--color-accent)' : 'var(--color-neutral-700)'};
          background: ${selectedWeapon === 3 ? 'rgba(145, 132, 217, 0.1)' : 'transparent'};
          color: var(--color-text);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: ${selectedWeapon === 3 ? '600' : '400'};
          transition: all 0.1s;
        ">3</button>
      </div>
    `;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

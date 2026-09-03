import { computed, signal } from '@preact/signals';
import type { GameState } from '../gameState';
import type { AimState, InputAdapter } from '../adapters/InputAdapter';
import { readLastShotValue, writeLastShotValue } from './lastShotStore';

/**
 * The single boundary between the imperative game loop and the declarative HUD.
 *
 * The game keeps its per-frame pull model: `syncHudSignals()` runs every frame
 * and writes every value unconditionally. That is free when nothing moved —
 * signals compare with `===` before notifying — so a HUD element only does work
 * when the value it actually reads has changed. The power gauge filling at 60fps
 * therefore costs nothing in the angle, weapon or status controls.
 */

export const angle = signal(45);
export const power = signal(0);
export const isCharging = signal(false);
export const selectedWeapon = signal(1);
export const isMyTurn = signal(false);
export const windSpeed = signal(0);
export const windDirection = signal(0);

export const lastAngle = signal(readLastShotValue('angle', 0));
export const lastPower = signal(readLastShotValue('power', 0));

/** Rendered readouts. Placed straight into JSX, these patch a text node
 *  without re-rendering the component that holds them. */
export const angleText = computed(() => `${angle.value.toFixed(0)}°`);
export const lastAngleText = computed(() => `Last: ${lastAngle.value.toFixed(0)}°`);
export const powerText = computed(() => `${power.value.toFixed(0)}%`);
export const lastPowerText = computed(() => `Last: ${lastPower.value.toFixed(0)}%`);

/** windSpeed is magnitude * 100 and magnitude maxes out at 0.5, so 0-50 maps to 0-100%. */
export const windText = computed(() => `${Math.round((windSpeed.value / 50) * 100)}%`);

/** Style and class strings, kept as signals so they bind to the element
 *  directly. The 60fps charge path therefore touches one attribute on one
 *  node and re-renders no component at all. */
export const powerFillStyle = computed(() => `width:${power.value}%`);
export const lastPowerStyle = computed(() => `width:${lastPower.value}%`);
export const windArrowStyle = computed(
  () => `transform:rotate(${((windDirection.value * 180) / Math.PI).toFixed(1)}deg)`
);

// Charge-edge tracking for the "last used" readouts. Both values are captured
// while charging and committed the frame the shot goes out, because the aim
// state is zeroed on that same frame.
let wasCharging = false;
let chargingAngle = 0;
let chargingPower = 0;

function commitLastShot(aim: AimState): void {
  if (aim.isCharging) {
    chargingAngle = aim.angle;
    chargingPower = aim.power;
  } else if (wasCharging) {
    lastAngle.value = chargingAngle;
    writeLastShotValue('angle', chargingAngle);

    if (chargingPower > 0) {
      lastPower.value = chargingPower;
      writeLastShotValue('power', chargingPower);
    }
    chargingPower = 0;
  }
  wasCharging = aim.isCharging;
}

/** Push the current frame's game and input state into the HUD. */
export function syncHudSignals(gameState: GameState, inputAdapter: InputAdapter): void {
  const aim = inputAdapter.getAimState();

  angle.value = aim.angle;
  power.value = aim.power;
  isCharging.value = aim.isCharging;
  selectedWeapon.value = inputAdapter.getSelectedWeapon();
  isMyTurn.value = gameState.isMyTurn();

  const turnState = gameState.turnState;
  if (turnState) {
    windSpeed.value = turnState.windSpeed;
    windDirection.value = turnState.windDirection;
  }

  commitLastShot(aim);
}

/** The deck dims while the opponent plays. Inertness itself comes from the
 *  `disabled` attribute on each control — `pointer-events: none` here would be
 *  undone by the panel's own `pointer-events: auto`. Bound as a class signal so
 *  a turn change costs one attribute write rather than a HUD re-render. */
export const deckStateClass = computed(() =>
  isMyTurn.value ? '' : 'opacity-55 saturate-50'
);

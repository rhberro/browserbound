import { computed, signal } from '@preact/signals';
import type { GameState } from '../gameState';
import type { AimState, InputAdapter } from '../adapters/InputAdapter';
import { MOVE_BUDGET } from '@browserbond/shared';
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

/** Pixels of walking left this turn, and the budget a full turn starts with. */
export const movementBudget = signal(0);
export const movementBudgetMax = signal(MOVE_BUDGET);
/** Whole seconds left in the current turn. */
export const turnSeconds = signal(0);

/** Match outcome. `matchEnded` gates the whole result overlay. */
export const matchEnded = signal(false);
export const winnerId = signal('');
export const mySessionId = signal('');
/** How many players have asked for a rematch, and how many are here. */
export const rematchReady = signal(0);
export const rematchOf = signal(0);

/** Epoch ms of the last Blocked Move, so the cue can fade on its own. */
export const blockedAt = signal(0);

/**
 * False while our OWN connection is dropped and being retried.
 *
 * The opponent's disconnect shows on their sprite; this is the other half —
 * the dropped player needs to know the game has not frozen and that a rejoin
 * is in progress, because from inside a drop the two look identical.
 */
export const isConnected = signal(true);

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

/**
 * Movement Budget as a percentage of a full turn's allowance, for the bar, and
 * as a rounded pixel count for the readout.
 */
export const movementFillStyle = computed(
  () => `width:${Math.max(0, Math.min(100, (movementBudget.value / movementBudgetMax.value) * 100))}%`
);
export const movementText = computed(() => `${Math.max(0, Math.round(movementBudget.value))}`);

/**
 * True when it is your turn and you have walked as far as you may.
 *
 * This is the state that used to read as a bug: the character simply stopped
 * responding to movement input with nothing on screen to explain why.
 */
export const isOutOfMovement = computed(
  () => isMyTurn.value && movementBudget.value <= 0
);

/** How long the Blocked Move cue stays up. */
const BLOCKED_CUE_MS = 1200;

/**
 * Ticked once a frame so time-based cues expire without their own timers.
 *
 * This invalidates the computed below every frame, which is cheap — it returns
 * the same string almost always, and signals compare with === before notifying,
 * so the DOM text node is only touched when the message actually changes.
 */
export const nowMs = signal(Date.now());

/**
 * Why movement is not happening, or empty when it is.
 *
 * The two reasons look identical on screen — the character stops — and mean
 * opposite things: a spent budget is over for the turn, while a wall is free
 * to walk away from. Blocked wins when both apply, because it is the
 * transient one and the one the player can act on.
 */
export const movementBlockText = computed(() => {
  if (blockedAt.value > 0 && nowMs.value - blockedAt.value < BLOCKED_CUE_MS) {
    return 'Blocked — that slope is too steep';
  }
  return isOutOfMovement.value ? 'Out of movement — fire or wait' : '';
});


export const turnSecondsText = computed(() => `${turnSeconds.value}s`);

/**
 * The result, from this player's point of view.
 *
 * An empty winner is a DRAW, not a loss — both characters died in the same
 * exchange. Reporting that as a loss to both players would be wrong for both.
 */
export const matchResultText = computed(() => {
  if (!matchEnded.value) return '';
  if (winnerId.value === '') return 'Draw';
  return winnerId.value === mySessionId.value ? 'You win' : 'You lose';
});

export const rematchText = computed(() =>
  rematchOf.value > 1 ? `Rematch (${rematchReady.value}/${rematchOf.value})` : 'Rematch'
);
/** The last five seconds of a turn, when the countdown should read as urgent. */
export const isTurnEnding = computed(() => isMyTurn.value && turnSeconds.value > 0 && turnSeconds.value <= 5);

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
    chargingAngle = aim.angleDeg;
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

  angle.value = aim.angleDeg;
  power.value = aim.power;
  isCharging.value = aim.isCharging;
  selectedWeapon.value = inputAdapter.getSelectedWeapon();
  isMyTurn.value = gameState.isMyTurn();

  const turnState = gameState.turnState;
  if (turnState) {
    windSpeed.value = turnState.windSpeed;
    windDirection.value = turnState.windDirection;
    // Already a remaining duration when it leaves the server, so no clock
    // arithmetic happens here and client clock skew cannot affect it.
    turnSeconds.value = turnState.turnSecondsRemaining;
  }

  nowMs.value = Date.now();

  const me = gameState.getMyPlayer();
  movementBudget.value = me ? me.movementBudget : 0;

  if (turnState) {
    matchEnded.value = turnState.matchPhase === 'ended';
    winnerId.value = turnState.winnerId;
  }
  mySessionId.value = gameState.getRoomSessionId() ?? '';

  commitLastShot(aim);
}

/** The deck dims while the opponent plays. Inertness itself comes from the
 *  `disabled` attribute on each control — `pointer-events: none` here would be
 *  undone by the panel's own `pointer-events: auto`. Bound as a class signal so
 *  a turn change costs one attribute write rather than a HUD re-render. */
export const deckStateClass = computed(() =>
  isMyTurn.value ? '' : 'opacity-55 saturate-50'
);

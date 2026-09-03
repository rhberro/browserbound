import { computed, signal } from '@preact/signals';
import type { GameState } from '../gameState';
import type { AimState, InputAdapter } from '../adapters/InputAdapter';
import { MOVE_STEPS, worldAimDeg } from '@browserbond/shared';
import { readLastShotValue, writeLastShotValue } from './lastShotStore';
import { windRotationDeg } from './windDialGeometry';

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
export const movementBudgetMax = signal(MOVE_STEPS);
/** Whole seconds left in the current turn. */
export const turnSeconds = signal(0);

/** Match outcome. `matchEnded` gates the whole result overlay. */
export const matchEnded = signal(false);
export const winningTeamId = signal(-1);
export const mySessionId = signal('');

/** One player in acting order, for the Delay readout. */
export interface TurnOrderEntry {
  delay: number;
  label: string;
  isYou: boolean;
  isCurrent: boolean;
}

/** Living players sorted by Delay — leftmost acts next (issue #35). */
export const turnOrder = signal<TurnOrderEntry[]>([]);
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

/**
 * Wind as the bare number the dial shows.
 *
 * `windSpeed` is the simulation's magnitude scaled by 100, so it spans the
 * WindManager's 0.1-0.5 range as 10-50. Shown as that integer rather than as a
 * percentage of the maximum: a dial reads as a measurement, and "34" is a
 * quantity a player learns the feel of, where "68%" invites them to wonder
 * 68% of what.
 */
export const windValueText = computed(() => `${Math.round(windSpeed.value)}`);

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
  if (winningTeamId.value === -1) return 'Draw';
  return 'Match ended'; // Team-based result text will be implemented in issue #49
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
/**
 * The needle's rotation.
 *
 * A straight degrees conversion, and it must stay one. Wind pushes a projectile
 * by `vx += magnitude * cos(angle)`, `vy += magnitude * sin(angle)` in a frame
 * where y grows DOWNWARD, which is exactly what a CSS rotation measures:
 * clockwise from pointing right. So heading zero is a needle pointing right and
 * a shot drifting right. Negating the angle, or offsetting it to put zero at
 * the top, would mirror the dial against the drift it describes — and a wind
 * indicator that points the wrong way is worse than none.
 */
export const windArrowStyle = computed(
  () => `transform:rotate(${windRotationDeg(windDirection.value).toFixed(1)}deg)`
);

// Charge-edge tracking for the "last used" readouts. Both values are captured
// while charging and committed the frame the shot goes out, because the aim
// state is zeroed on that same frame.
let wasCharging = false;
let chargingAngle = 0;
let chargingPower = 0;

function commitLastShot(aim: AimState, displayAngleDeg: number): void {
  if (aim.isCharging) {
    chargingAngle = displayAngleDeg;
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
  const me = gameState.getMyPlayer();
  const displayAngleDeg = me ? worldAimDeg(aim.angleDeg, me.tilt, me.facing || 1) : aim.angleDeg;

  angle.value = displayAngleDeg;
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

  movementBudget.value = me ? me.movementBudget : 0;

  if (turnState) {
    matchEnded.value = turnState.matchPhase === 'ended';
    winningTeamId.value = turnState.winningTeamId;
  }
  mySessionId.value = gameState.getRoomSessionId() ?? '';

  // Players in acting order: lowest Delay first. Labels are stable ("You" plus
  // P1..PN by sorted session id), so a player keeps their label as the order
  // moves around them.
  const players = Array.from(gameState.players.entries());
  const stableIds = players.map(([id]) => id).sort();
  const currentId = gameState.turnState?.currentPlayerId ?? '';
  turnOrder.value = players
    .map(([id, p]) => {
      const isYou = id === mySessionId.value;
      const label = isYou
        ? 'You'
        : players.length === 2
          ? 'Opp'
          : `P${stableIds.indexOf(id) + 1}`;
      return { delay: p.delay, label, isYou, isCurrent: id === currentId };
    })
    .sort((a, b) => a.delay - b.delay || a.label.localeCompare(b.label));

  commitLastShot(aim, displayAngleDeg);
}

/** The deck dims while the opponent plays. Inertness itself comes from the
 *  `disabled` attribute on each control — `pointer-events: none` here would be
 *  undone by the panel's own `pointer-events: auto`. Bound as a class signal so
 *  a turn change costs one attribute write rather than a HUD re-render. */
export const deckStateClass = computed(() =>
  isMyTurn.value ? '' : 'opacity-55 saturate-50'
);

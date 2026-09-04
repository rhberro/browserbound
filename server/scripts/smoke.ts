/**
 * End-to-end smoke test: two real clients, one real websocket, a real room.
 *
 * The unit suites cover pure functions well and the room not at all, because
 * exercising a Colyseus room needs a running server. Three tickets in a row
 * (#11's projectile lifetime, #13's staged-projectile turn boundary, #21's
 * match end) ended up with acceptance criteria verifiable only by reading the
 * code. This is the harness that closes that gap, and it earned its place the
 * first time it ran by catching the 0.18 SDK reconnecting a session underneath
 * a deliberate leave.
 *
 * Deliberately NOT part of `pnpm test`: it needs a server (default port from
 * .env or PORT env var) and runs in wall-clock seconds, so it is a separate command.
 *
 *   pnpm --filter @browserbond/server dev      # one terminal
 *   pnpm --filter @browserbond/server smoke    # another
 *
 * Covers both the new lobby phase flow (#49) and existing drop/reconnect behavior.
 *
 * Exits non-zero if any expectation fails, so CI can gate on it.
 */
import { Client, getStateCallbacks } from '@colyseus/sdk';

const PORT = parseInt(process.env.PORT || '3002');
const URL = `ws://localhost:${PORT}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function main() {
  const c1 = new Client(URL);
  const c2 = new Client(URL);

  // NEW FLOW: Create game and test lobby phase
  const r1 = await c1.create('game', { mode: 'duel', roomName: 'smoke' });
  const r2 = await c2.joinById(r1.roomId);
  await wait(600);

  // Initial state: both in lobby, no players spawned yet
  check('room created in lobby phase', r1.state.matchPhase === 'lobby', r1.state.matchPhase);
  check('no players yet in lobby', r1.state.players.size === 0, `size=${r1.state.players.size}`);
  check('two seats available', r1.state.seats?.size === 2, `seats=${r1.state.seats?.size}`);

  // Claim seats
  r1.send('claimSeat', { seatIndex: 0 });
  r2.send('claimSeat', { seatIndex: 1 });
  await wait(300);

  check('both seats claimed',
    Array.from(r1.state.seats?.values() || []).filter((s: any) => s.sessionId !== '').length === 2);

  // Set ready
  r1.send('setReady', { ready: true });
  r2.send('setReady', { ready: true });
  await wait(300);

  check('both players ready',
    Array.from(r1.state.seats?.values() || []).every((s: any) => s.ready === true));

  // Host starts game
  r1.send('startGame', {});
  await wait(800); // Wait for match to start and players to spawn

  const $1 = getStateCallbacks(r1);
  let terrainOps = 0;
  r1.onMessage('terrainOp', () => terrainOps++);
  r1.onMessage('terrainSync', () => {});
  r2.onMessage('terrainSync', () => {});
  r2.onMessage('terrainOp', () => {});

  check('two players spawned', r1.state.players.size === 2, `size=${r1.state.players.size}`);
  check('a turn is running', r1.state.currentPlayerId !== '');
  check('match is playing', r1.state.matchPhase === 'playing', r1.state.matchPhase);
  check('turn clock is counting', r1.state.turnSecondsRemaining > 0,
    `${r1.state.turnSecondsRemaining}s`);

  const me = r1.state.players.get(r1.sessionId);
  check('character has spawned on terrain', !!me && me.y > 0, `y=${me?.y}`);
  check('movement budget granted to current player',
    (r1.state.players.get(r1.state.currentPlayerId)?.movementBudget ?? 0) > 0);
  check('velocity is NOT synchronized', (me as any)?.vx === undefined);
  check('tilt IS synchronized', typeof me?.tilt === 'number');

  // Whoever holds the turn aims and fires.
  const active = r1.state.currentPlayerId === r1.sessionId ? r1 : r2;
  active.send('aimAngle', { angle: 55 });
  await wait(300);
  const aimer = r1.state.players.get(r1.state.currentPlayerId);
  check('aim reached the server', Math.abs((aimer?.aimAngle ?? 0) - (55 * Math.PI) / 180) < 1e-6,
    `${aimer?.aimAngle}`);

  // Malformed messages must not wedge the room (#11).
  active.send('fire', { power: {}, weaponType: 1 });
  active.send('aimAngle', { angle: 'nope' });
  await wait(300);
  check('malformed fire/aim rejected, no projectile created', r1.state.projectiles.size === 0);

  let sawProjectile = false;
  $1(r1.state).projectiles.onAdd(() => { sawProjectile = true; });

  active.send('fire', { power: 70, weaponType: 1 });
  await wait(400);
  check('projectile appeared in synchronized state', sawProjectile);

  // Let it fly and land.
  await wait(4000);
  check('projectile resolved', r1.state.projectiles.size === 0);
  check('terrain was destroyed', terrainOps > 0, `${terrainOps} ops`);
  check('turn passed after the shot', r1.state.currentPlayerId !== active.sessionId ||
    r1.state.players.size < 2);

  // Reconnection (#12 preserved through #24's onDrop/onReconnect).
  const beforeId = r2.sessionId;
  const token = r2.reconnectionToken;
  // 0.18's SDK reconnects automatically, so a non-consented leave exercises
  // the whole loop: server onDrop -> allowReconnection -> SDK retry -> onReconnect.
  let sawDrop = false;
  let sawReconnect = false;
  // Sampling `connected` on a timer races the SDK, which retries in 0.2s.
  // Watch the field instead, so the observation cannot be missed.
  let everMarkedDisconnected = false;
  $1(r1.state.players.get(beforeId)!).listen('connected', (v: boolean) => {
    if (v === false) everMarkedDisconnected = true;
  });
  r2.onDrop(() => { sawDrop = true; });
  r2.onReconnect(() => { sawReconnect = true; });

  void r2.leave(false);
  await wait(700);
  const dropped = r1.state.players.get(beforeId);
  check('dropped player kept their character', !!dropped);
  check('dropped player was marked disconnected', everMarkedDisconnected);
  check('client saw the drop', sawDrop);

  await wait(2500);
  check('SDK reconnected automatically', sawReconnect);
  check('reconnected player marked connected again',
    r1.state.players.get(beforeId)?.connected === true);
  check('same room after reconnect', r2.roomId === r1.roomId);
  void token;
  const r2b = r2;

  // Match end: kill one character outright.
  const victimId = r1.state.players.get(r1.sessionId) ? r1.sessionId : beforeId;
  await r2b.leave(true);
  await wait(800);
  check('match ended when one character remained', r1.state.matchPhase === 'ended',
    r1.state.matchPhase);
  check('winning team recorded', r1.state.winningTeamId !== undefined,
    `winningTeamId=${r1.state.winningTeamId}`);
  check('turn clock stopped', r1.state.turnSecondsRemaining === 0);
  void victimId;

  // Match end → auto-return to lobby for next match
  await wait(3000); // Wait for auto-transition to lobby
  check('returned to lobby after match ended', r1.state.matchPhase === 'lobby',
    r1.state.matchPhase);
  check('seats cleared for next match', r1.state.players.size === 0, `players=${r1.state.players.size}`);

  await r1.leave(true);
  await wait(300);

  console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} SMOKE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE TEST ERROR', e);
  process.exit(1);
});

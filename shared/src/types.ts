export interface PlayerState {
  id: string;
  x: number;
  y: number;
  health: number;
  currentlyAiming: boolean;
  facing: number; // 1 = direita, -1 = esquerda
}

export interface TurnState {
  currentPlayerId: string;
  windSpeed: number;
  windDirection: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ProjectileInput {
  angle: number; // radians
  power: number; // 0-100
  weaponType: 'cannon' | 'missile';
}

export const GRAVITY = 0.4;
export const POWER_SCALE = 0.3;

/**
 * Scales wind magnitude (0.1 - 0.5) into a per-frame acceleration.
 * At 0.35, full wind pushes at 0.175 px/frame² — ~44% of gravity, enough to
 * visibly bend a long shot; the weakest wind stays a gentle ~9% nudge.
 */
export const WIND_INTEGRATION = 0.35;

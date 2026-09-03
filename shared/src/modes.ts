export type GameMode = 'duel' | '2v2' | '3v3' | 'ffa';

export interface ModeConfig {
  name: string;
  teamCount: number;
  teamSize: number;
  ffaCount?: number;
}

const MODES: Record<GameMode, ModeConfig> = {
  duel: { name: 'Duel', teamCount: 2, teamSize: 1 },
  '2v2': { name: '2v2 Teams', teamCount: 2, teamSize: 2 },
  '3v3': { name: '3v3 Teams', teamCount: 2, teamSize: 3 },
  ffa: { name: 'Free For All', teamCount: 1, teamSize: 1 },
};

export function resolveMode(mode: GameMode, ffaCount: number = 2): ModeConfig {
  if (mode === 'ffa') {
    return {
      name: `${ffaCount} Player FFA`,
      teamCount: ffaCount,
      teamSize: 1,
      ffaCount,
    };
  }
  return MODES[mode];
}

export function teamOfSeat(seatIndex: number, teamSize: number): number {
  return Math.floor(seatIndex / teamSize);
}

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { GameState } from '../../gameState';
import { Seat, teamOfSeat } from '@browserbond/shared';

interface LobbyProps {
  onNavigate: (scene: string) => void;
}

interface SeatUI {
  seatIndex: number;
  sessionId: string;
  displayName: string;
  ready: boolean;
  team: number;
  isLocal: boolean;
}

export function Lobby({ onNavigate }: LobbyProps) {
  const [gameState] = useState(() => new GameState());
  const [seats, setSeats] = useState<SeatUI[]>([]);
  const [mySessionId, setMySessionId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [teamCount, setTeamCount] = useState(2);
  const [teamSize, setTeamSize] = useState(1);
  const [myReady, setMyReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const updateState = () => {
      const state = gameState.getGameState();
      if (!state) return;

      const sessionId = gameState.getRoomSessionId();
      setMySessionId(sessionId || '');
      setRoomName(state.roomName || '');
      setTeamCount(state.teamCount || 2);
      setTeamSize(state.teamSize || 1);
      setIsHost(sessionId === state.hostSessionId);

      const seatArray: SeatUI[] = Array.from(state.seats?.values() || []).map((seat: any) => ({
        seatIndex: seat.seatIndex,
        sessionId: seat.sessionId,
        displayName: seat.displayName,
        ready: seat.ready,
        team: teamOfSeat(seat.seatIndex, teamSize),
        isLocal: seat.sessionId === sessionId,
      }));

      setSeats(seatArray);

      const mySeat = seatArray.find((s) => s.isLocal);
      if (mySeat) {
        setMyReady(mySeat.ready);
      }
    };

    const interval = setInterval(updateState, 500);
    updateState();

    return () => clearInterval(interval);
  }, [gameState]);

  const handleClaimSeat = (seatIndex: number) => {
    const mySeat = seats.find((s) => s.isLocal);
    if (mySeat?.ready) {
      setError('Cannot change seat while ready');
      return;
    }
    gameState.claimSeat(seatIndex);
  };

  const handleToggleReady = () => {
    const mySeat = seats.find((s) => s.isLocal);
    if (!mySeat || mySeat.seatIndex < 0) {
      setError('You must claim a seat first');
      return;
    }
    gameState.setReady(!myReady);
  };

  const handleStartGame = () => {
    gameState.startGame();
  };

  const mySeat = seats.find((s) => s.isLocal);
  const allSeatsNeeded = teamCount * teamSize;
  const allFilled = seats.filter((s) => s.seatIndex >= 0).length === allSeatsNeeded;
  const allReady = allFilled && seats.filter((s) => s.seatIndex >= 0).every((s) => s.ready);

  const seatsByTeam: Record<number, SeatUI[]> = {};
  for (let i = 0; i < teamCount; i++) {
    seatsByTeam[i] = seats.filter((s) => s.team === i && s.seatIndex >= 0);
  }

  return (
    <div class="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-start p-4 pt-12 pointer-events-auto">
      <div class="w-full max-w-2xl pointer-events-auto">
        <div class="flex items-center justify-between mb-8 pointer-events-auto">
          <div class="pointer-events-none">
            <h1 class="text-3xl font-bold text-white">{roomName}</h1>
            <p class="text-slate-400 text-sm">Waiting for players...</p>
          </div>
          <button
            onClick={() => onNavigate('mainMenu')}
            class="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition pointer-events-auto cursor-pointer"
          >
            Back
          </button>
        </div>

        {error && (
          <div class="bg-red-500 bg-opacity-20 border border-red-500 rounded p-3 text-red-300 text-sm mb-4 pointer-events-auto">
            {error}
          </div>
        )}

        <div class="bg-slate-800 rounded-lg border border-slate-700 p-6 pointer-events-auto">
          <div class="space-y-6 pointer-events-auto">
            {Object.entries(seatsByTeam).map(([teamId, teamSeats]) => (
              <div key={teamId} class="pointer-events-auto">
                <h3 class="text-sm font-semibold text-slate-300 mb-2 pointer-events-none">
                  Team {parseInt(teamId) + 1}
                </h3>
                <div class="grid grid-cols-2 gap-2 pointer-events-auto">
                  {teamSeats.map((seat) => (
                    <div
                      key={seat.sessionId}
                      class="bg-slate-700 border border-slate-600 rounded p-3 pointer-events-auto"
                    >
                      <div class="font-semibold text-white text-sm pointer-events-none">
                        {seat.displayName}
                      </div>
                      <div class={`text-xs ${seat.ready ? 'text-green-400' : 'text-slate-400'} pointer-events-none`}>
                        {seat.ready ? '✓ Ready' : 'Not ready'}
                      </div>
                    </div>
                  ))}

                  {[...Array(teamSize - teamSeats.length)].map((_, i) => (
                    <button
                      key={`empty-${teamId}-${i}`}
                      onClick={() => {
                        const targetSeatIndex =
                          parseInt(teamId) * teamSize + teamSeats.length + i;
                        handleClaimSeat(targetSeatIndex);
                      }}
                      disabled={mySeat?.ready || mySeat?.seatIndex !== -1}
                      class="bg-slate-700 border-2 border-dashed border-slate-600 rounded p-3 hover:border-slate-500 disabled:opacity-50 transition pointer-events-auto cursor-pointer text-slate-400"
                    >
                      <div class="text-sm pointer-events-none">[Empty]</div>
                      <div class="text-xs pointer-events-none">Click to claim</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div class="mt-8 space-y-3 border-t border-slate-600 pt-6 pointer-events-auto">
            {mySeat && mySeat.seatIndex >= 0 && (
              <button
                onClick={handleToggleReady}
                class={`w-full font-semibold py-2 px-4 rounded transition pointer-events-auto cursor-pointer ${
                  myReady
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {myReady ? 'Unready' : 'Ready'}
              </button>
            )}

            {isHost && (
              <button
                onClick={handleStartGame}
                disabled={!allReady}
                class="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-600 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded transition pointer-events-auto cursor-pointer"
              >
                Start Game ({seats.filter((s) => s.seatIndex >= 0 && s.ready).length}/{allSeatsNeeded})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

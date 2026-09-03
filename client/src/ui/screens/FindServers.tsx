import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { GameState } from '../../gameState';

interface FindServersProps {
  onNavigate: (scene: string) => void;
}

interface RoomInfo {
  roomId: string;
  name: string;
  mode: string;
  currentPlayers: number;
  maxPlayers: number;
}

export function FindServers({ onNavigate }: FindServersProps) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadRooms = async () => {
      try {
        setLoading(true);
        const gameState = new GameState();
        const availableRooms = await gameState.discoverRooms();

        const roomList = availableRooms.map((room: any) => ({
          roomId: room.roomId,
          name: room.metadata?.roomName || 'Unnamed Room',
          mode: room.metadata?.mode || 'Unknown',
          currentPlayers: room.clients || 0,
          maxPlayers: room.maxClients || 2,
        }));

        setRooms(roomList);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load servers');
      } finally {
        setLoading(false);
      }
    };

    loadRooms();
  }, []);

  const handleJoinRoom = async (roomId: string) => {
    try {
      const gameState = new GameState();
      await gameState.joinRoom(roomId);
      onNavigate('lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
    }
  };

  return (
    <div class="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-start p-4 pt-12 pointer-events-auto">
      <div class="w-full max-w-2xl pointer-events-auto">
        <div class="flex items-center justify-between mb-8 pointer-events-auto">
          <h1 class="text-3xl font-bold text-white pointer-events-none">Find Servers</h1>
          <button
            onClick={() => onNavigate('mainMenu')}
            class="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition pointer-events-auto cursor-pointer"
          >
            Back
          </button>
        </div>

        <div class="bg-slate-800 rounded-lg border border-slate-700 p-6 pointer-events-auto">
          {error && (
            <div class="bg-red-500 bg-opacity-20 border border-red-500 rounded p-3 text-red-300 text-sm mb-4 pointer-events-auto">
              {error}
            </div>
          )}

          {loading ? (
            <p class="text-slate-400 pointer-events-none text-center py-8">Loading servers...</p>
          ) : rooms.length === 0 ? (
            <p class="text-slate-400 pointer-events-none text-center py-8">No servers available</p>
          ) : (
            <div class="space-y-2 pointer-events-auto">
              {rooms.map((room) => (
                <button
                  key={room.roomId}
                  onClick={() => handleJoinRoom(room.roomId)}
                  class="w-full bg-slate-700 hover:bg-slate-600 text-left p-4 rounded border border-slate-600 transition pointer-events-auto cursor-pointer"
                >
                  <div class="flex items-center justify-between pointer-events-none">
                    <div>
                      <h3 class="text-white font-semibold">{room.name}</h3>
                      <p class="text-slate-400 text-sm">{room.mode}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-white font-semibold">{room.currentPlayers}/{room.maxPlayers}</p>
                      <p class="text-slate-400 text-sm">Players</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

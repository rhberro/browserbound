import { h } from 'preact';
import { useState } from 'preact/hooks';
import { getGameState } from '../../index';

interface CreateServerProps {
  onNavigate: (scene: string) => void;
}

export function CreateServer({ onNavigate }: CreateServerProps) {
  const [roomName, setRoomName] = useState('');
  const [mode, setMode] = useState('duel');
  const [ffaCount, setFfaCount] = useState('2');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    if (!roomName.trim()) {
      setError('Please enter a room name');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const gameState = getGameState();
      await gameState.createRoom({
        mode,
        roomName: roomName.trim(),
        ffaCount: mode === 'ffa' ? parseInt(ffaCount) : undefined,
      });
      onNavigate('lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-start p-4 pt-12 pointer-events-auto">
      <div class="w-full max-w-md pointer-events-auto">
        <div class="flex items-center justify-between mb-8 pointer-events-auto">
          <h1 class="text-3xl font-bold text-white pointer-events-none">Create Server</h1>
          <button
            onClick={() => onNavigate('mainMenu')}
            class="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded transition pointer-events-auto cursor-pointer"
          >
            Back
          </button>
        </div>

        <div class="bg-slate-800 rounded-lg border border-slate-700 p-6 pointer-events-auto">
          <form onSubmit={handleCreate} class="space-y-4 pointer-events-auto">
            <div class="pointer-events-auto">
              <label class="block text-sm font-medium text-slate-300 mb-1 pointer-events-none">Room Name</label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName((e.target as HTMLInputElement).value)}
                class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 pointer-events-auto"
                placeholder="My Game Room"
                disabled={loading}
                required
              />
            </div>

            <div class="pointer-events-auto">
              <label class="block text-sm font-medium text-slate-300 mb-1 pointer-events-none">Game Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode((e.target as HTMLSelectElement).value)}
                class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500 pointer-events-auto"
                disabled={loading}
              >
                <option value="duel">Duel (1v1)</option>
                <option value="2v2">2v2 Teams</option>
                <option value="3v3">3v3 Teams</option>
                <option value="ffa">Free For All</option>
              </select>
            </div>

            {mode === 'ffa' && (
              <div class="pointer-events-auto">
                <label class="block text-sm font-medium text-slate-300 mb-1 pointer-events-none">
                  Player Count: {ffaCount}
                </label>
                <input
                  type="range"
                  min="2"
                  max="5"
                  value={ffaCount}
                  onChange={(e) => setFfaCount((e.target as HTMLInputElement).value)}
                  class="w-full pointer-events-auto"
                  disabled={loading}
                />
              </div>
            )}

            {error && (
              <div class="bg-red-500 bg-opacity-20 border border-red-500 rounded p-3 text-red-300 text-sm pointer-events-auto">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              class="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-600 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded transition pointer-events-auto cursor-pointer"
            >
              {loading ? 'Creating...' : 'Create Server'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

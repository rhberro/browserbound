import { defineServer, defineRoom, LobbyRoom } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

const PORT = parseInt(process.env.PORT || '3002');

/**
 * 0.17 replaced constructing a Server and registering rooms against it with a
 * single definition. Rooms are declared up front rather than added afterwards,
 * so there is no window in which the server is listening but a room type is
 * not yet registered.
 *
 * Ping settings moved from the server onto the TRANSPORT, which is where they
 * always belonged — they describe the socket, not the matchmaker. Passed
 * explicitly rather than dropped, because they are what detects a dead
 * connection, and detecting one promptly is what gives the reconnection window
 * in GameRoom its full length.
 */
const server = defineServer({
  transport: new WebSocketTransport({
    pingInterval: 5000,
    pingMaxRetries: 3,
  }),
  rooms: {
    game: defineRoom(GameRoom, { enableRealtimeListing: true }),
    lobby: defineRoom(LobbyRoom),
  },
});

/**
 * `defineServer` only DEFINES — it binds nothing. Colyseus' own dev tooling
 * boots a default-exported server for you, but this project runs the entry
 * point directly with tsx, so without an explicit listen the process starts,
 * finds nothing holding the event loop open, and exits 0 having served
 * nobody. The export stays for the tooling path.
 */
export default server;

server.listen(PORT).catch((error) => {
  console.error('Failed to start BrowserBound server:', error);
  process.exitCode = 1;
});

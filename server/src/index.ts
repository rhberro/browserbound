import { Server } from 'colyseus';
import { GameRoom } from './rooms/GameRoom';

const gameServer = new Server({
  pingInterval: 5000,
  pingMaxRetries: 3,
});

gameServer.define('game', GameRoom);

console.log('Starting BrowserBond Server on port 3002...');
gameServer.listen(3002);
console.log('🎮 BrowserBond Server listening on ws://localhost:3002');

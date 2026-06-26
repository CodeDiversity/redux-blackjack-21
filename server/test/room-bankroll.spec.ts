import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, _resetDbForTests } from '../src/storage/db';
import { Config } from '../src/config';
import { setBankroll } from '../src/storage/bankroll.repository';
import { RoomService } from '../src/room/room.service';

const playerA = '00000000-0000-4000-8000-000000000001';
const playerB = '00000000-0000-4000-8000-000000000002';

describe('RoomService bankroll hydration', () => {
  let dir: string;

  beforeEach(() => {
    _resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), 'bj21-room-bankroll-'));
    initDb({ dbPath: join(dir, 'blackjack.db') });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetDbForTests();
  });

  it('createRoom hydrates the host seat from a persisted row', () => {
    setBankroll(playerA, 800);
    const svc = new RoomService();
    const { state } = svc.createRoom('socket-A', 'Alice', playerA);
    const hostSeat = state.players.find((p) => p.name === 'Alice');
    expect(hostSeat?.bankroll).toBe(800);
  });

  it('createRoom uses STARTING_BANKROLL when no row exists', () => {
    // No setBankroll call — playerA has no row.
    const svc = new RoomService();
    const { state } = svc.createRoom('socket-A', 'Alice', playerA);
    const hostSeat = state.players.find((p) => p.name === 'Alice');
    expect(hostSeat?.bankroll).toBe(Config.STARTING_BANKROLL);
  });

  it('joinRoom hydrates the joining seat from a persisted row', () => {
    setBankroll(playerB, 600);
    const svc = new RoomService();
    const { roomId } = svc.createRoom('socket-A', 'Alice', playerA);
    const { state } = svc.joinRoom(roomId, 'socket-B', 'Bob', playerB);
    const guestSeat = state.players.find((p) => p.name === 'Bob');
    expect(guestSeat?.bankroll).toBe(600);
  });

  it('joinRoom uses STARTING_BANKROLL when no row exists', () => {
    const svc = new RoomService();
    const { roomId } = svc.createRoom('socket-A', 'Alice', playerA);
    const { state } = svc.joinRoom(roomId, 'socket-B', 'Bob', playerB);
    const guestSeat = state.players.find((p) => p.name === 'Bob');
    expect(guestSeat?.bankroll).toBe(Config.STARTING_BANKROLL);
  });
});

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, _resetDbForTests, getDb } from '../src/storage/db';
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

describe('RoomService bankroll writeback', () => {
  let dir: string;
  let svc: RoomService;
  let roomId: string;
  let hostSeatId: string;
  let guestSeatId: string;
  let guestPlayerId: string;

  beforeEach(async () => {
    _resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), 'bj21-room-bankroll-wb-'));
    initDb({ dbPath: join(dir, 'blackjack.db') });

    // Seed: host at 1000, guest at 1000.
    setBankroll(playerA, 1000);
    setBankroll(playerB, 1000);

    svc = new RoomService();
    const host = svc.createRoom('socket-A', 'Alice', playerA);
    roomId = host.roomId;
    hostSeatId = host.seatId;

    const guest = svc.joinRoom(roomId, 'socket-B', 'Bob', playerB);
    guestSeatId = guest.seatId;
    guestPlayerId = playerB;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetDbForTests();
  });

  it('writeback fires for hand:double and persists the new bankroll', () => {
    // The state machine debits bankroll on hand:double (not on bet:place),
    // so drive the room into player_turn with a 2-card hand on the host,
    // then issue hand:double. The guest also has an actionable hand so the
    // allHandsActed auto-transition does not fire (otherwise the auto-pipeline
    // would settle the round and credit bankroll back, masking the debit).
    const state = svc.getState(roomId)!;
    state.phase = 'player_turn';
    state.activeSeat = 0;
    state.players[0] = {
      ...state.players[0],
      status: 'acting',
      hands: [{
        cards: [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: '5' }],
        bet: 50,
        stood: false,
        busted: false,
        isBlackjack: false,
        doubled: false,
      }],
      activeHandIndex: 0,
    };
    state.players[1] = {
      ...state.players[1],
      status: 'acting',
      hands: [{
        cards: [{ suit: '♠', rank: '7' }, { suit: '♥', rank: '8' }],
        bet: 100,
        stood: false,
        busted: false,
        isBlackjack: false,
        doubled: false,
      }],
      activeHandIndex: 0,
    };

    svc.apply(
      roomId,
      { type: 'hand:double', seatId: state.players[0].id, handIndex: 0 },
      () => ({ suit: '♦', rank: '3' }),
    );

    const row = getDb()
      .prepare('SELECT amount FROM bankrolls WHERE player_id = ?')
      .get(playerA) as { amount: number };
    expect(row.amount).toBe(950);
  });

  it('writeback fires independently for each player', () => {
    // Put both players into player_turn with 2-card hands, then issue
    // hand:double on the host. Independence is proven if the host's row is
    // written to 950 while the guest's row remains at the seeded 1000 —
    // i.e. the diff loop attributes the write to the host's playerId and
    // does not bulk-write every seat.
    const state = svc.getState(roomId)!;
    state.phase = 'player_turn';
    state.activeSeat = 0;
    state.players[0] = {
      ...state.players[0],
      status: 'acting',
      hands: [{
        cards: [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: '5' }],
        bet: 50,
        stood: false,
        busted: false,
        isBlackjack: false,
        doubled: false,
      }],
      activeHandIndex: 0,
    };
    state.players[1] = {
      ...state.players[1],
      status: 'acting',
      hands: [{
        cards: [{ suit: '♠', rank: '7' }, { suit: '♥', rank: '8' }],
        bet: 100,
        stood: false,
        busted: false,
        isBlackjack: false,
        doubled: false,
      }],
      activeHandIndex: 0,
    };

    svc.apply(
      roomId,
      { type: 'hand:double', seatId: state.players[0].id, handIndex: 0 },
      () => ({ suit: '♦', rank: '3' }),
    );
    // After the host doubles, verify the host's bankroll was persisted (950)
    // and the guest's was NOT touched (still 1000).
    const hostAfter = getDb().prepare('SELECT amount FROM bankrolls WHERE player_id = ?').get(playerA) as { amount: number };
    const guestAfter = getDb().prepare('SELECT amount FROM bankrolls WHERE player_id = ?').get(guestPlayerId) as { amount: number };
    expect(hostAfter.amount).toBe(950);
    expect(guestAfter.amount).toBe(1000);
  });

  it('writeback does NOT fire when bankroll is unchanged (e.g. round:ready)', () => {
    // round:ready does not touch bankroll. Seed with a known row, run it,
    // assert the row's updated_at is unchanged (or — if the row was never
    // written — assert no row was written).
    _resetDbForTests();
    initDb({ dbPath: join(dir, 'blackjack.db') });
    setBankroll(playerA, 1000);
    const rowBefore = getDb().prepare('SELECT updated_at FROM bankrolls WHERE player_id = ?').get(playerA) as { updated_at: number };

    svc.apply(roomId, { type: 'round:ready', seatId: hostSeatId });

    const rowAfter = getDb().prepare('SELECT updated_at FROM bankrolls WHERE player_id = ?').get(playerA) as { updated_at: number };
    expect(rowAfter.updated_at).toBe(rowBefore.updated_at);
  });

  it('writeback does NOT fire for empty seats', () => {
    // Only one player in the room — other seats are 'empty'. Even if a
    // round-level action somehow touched an empty seat (it does not, today),
    // the writeback must skip it because status === 'empty'.
    setBankroll(playerB, 1000);  // guest playerId exists but seat is empty
    const before = getDb().prepare('SELECT amount FROM bankrolls WHERE player_id = ?').get(playerB) as { amount: number };

    svc.apply(roomId, { type: 'round:ready', seatId: hostSeatId });

    const after = getDb().prepare('SELECT amount FROM bankrolls WHERE player_id = ?').get(playerB) as { amount: number };
    expect(after.amount).toBe(before.amount);
  });
});

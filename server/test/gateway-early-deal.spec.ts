import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../src/config';
import type { GameState, LobbyState } from '../src/shared/types';

async function listen<T = any>(socket: Socket, event: string, predicate?: (p: T) => boolean): Promise<T> {
  return new Promise<T>((resolve) => {
    const handler = (p: T) => { if (!predicate || predicate(p)) { socket.off(event, handler); resolve(p); } };
    socket.on(event, handler);
  });
}

async function connectPlayer(url: string, playerId: string): Promise<Socket> {
  const socket = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId } });
  await new Promise<void>((r) => socket.on('connect', () => r()));
  return socket;
}

async function createRoomAndStartBetting(host: Socket): Promise<void> {
  const lobby = listen<LobbyState>(host, 'lobby:state');
  await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
  await lobby;
  const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
  host.emit('round:ready');
  await betting;
}

describe('gateway early-deal (all-active-players-have-bet)', () => {
  let app: INestApplication;
  let url: string;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-earlydeal-'));
    process.env.DB_PATH = join(dir, 'blackjack.db');
    jest.resetModules();
    const { AppModule } = require('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors({ origin: '*', credentials: true });
    await app.listen(0);
    const addr = app.getHttpServer().address();
    url = `http://localhost:${addr.port}`;
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('solo host: betting → dealing fires immediately after Place Bet (no 10s wait)', async () => {
    const host = await connectPlayer(url, '00000000-0000-4000-8000-000000000010');
    await createRoomAndStartBetting(host);

    const dealing = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');
    host.emit('bet:place', { amount: 50 });

    // If the early-deal path is wired, dealing arrives in ~one network roundtrip.
    // If it isn't wired, dealing only arrives after BET_DEADLINE_MS + DEALING_DURATION_MS,
    // so the 500ms timeout will reject first.
    const got = await Promise.race([
      dealing,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('dealing did not arrive within 500ms')), 500)),
    ]);
    expect(got.phase).toBe('dealing');

    host.disconnect();
  }, 10_000);

  it('two players: dealing fires only after the second player bets', async () => {
    const host = await connectPlayer(url, '00000000-0000-4000-8000-000000000011');
    const guest = await connectPlayer(url, '00000000-0000-4000-8000-000000000012');
    const lobby = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
    const lobbyState = await lobby;
    await new Promise<void>((resolve) => guest.emit('room:join', { roomId: lobbyState.roomId, name: 'Bob' }, () => resolve()));

    const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await betting;

    // After A bets, phase must still be betting.
    const afterA = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting' && s.players.some((p) => p.hands[0]?.bet === 50));
    host.emit('bet:place', { amount: 50 });
    const stateAfterA = await Promise.race([
      afterA,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('expected betting state after A')), 1_000)),
    ]);
    expect(stateAfterA.phase).toBe('betting');

    // After B bets, dealing must arrive quickly.
    const dealing = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');
    guest.emit('bet:place', { amount: 50 });
    const stateAfterB = await Promise.race([
      dealing,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('expected dealing after B')), 1_000)),
    ]);
    expect(stateAfterB.phase).toBe('dealing');

    host.disconnect();
    guest.disconnect();
  }, 15_000);

  it('slow better: 10s fallback still fires when only one of two players bets', async () => {
    const host = await connectPlayer(url, '00000000-0000-4000-8000-000000000013');
    const guest = await connectPlayer(url, '00000000-0000-4000-8000-000000000014');
    const lobby = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
    const lobbyState = await lobby;
    await new Promise<void>((resolve) => guest.emit('room:join', { roomId: lobbyState.roomId, name: 'Bob' }, () => resolve()));

    const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await betting;

    // Only A bets; B does not. After the 10s deadline, dealing must fire and
    // B must be sitting_out. This is the existing fallback path — covered
    // here to lock in the regression.
    host.emit('bet:place', { amount: 50 });

    const dealing = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');
    await new Promise((r) => setTimeout(r, Config.BET_DEADLINE_MS + 500));
    const got = await dealing;
    expect(got.phase).toBe('dealing');

    // The sitting_out assignment is done in assignBetDeadline, not in the
    // early-deal branch, so this only confirms the fallback path still works.
    const guestPlayer = got.players.find((p) => p.name === 'Bob');
    expect(guestPlayer?.status).toBe('sitting_out');

    host.disconnect();
    guest.disconnect();
  }, 20_000);

  it('sitting_out seats are excluded from the all-have-bet check', async () => {
    // Three seats, but one (Charlie) is sitting_out before the round starts.
    // Alice and Bob are active; once both bet, dealing must fire even though
    // Charlie has no bet.
    const alice = await connectPlayer(url, '00000000-0000-4000-8000-000000000020');
    const bob = await connectPlayer(url, '00000000-0000-4000-8000-000000000021');
    const charlie = await connectPlayer(url, '00000000-0000-4000-8000-000000000022');

    const lobby = listen<LobbyState>(alice, 'lobby:state');
    await new Promise<void>((resolve) => alice.emit('room:create', { name: 'Alice' }, () => resolve()));
    const lobbyState = await lobby;
    await new Promise<void>((resolve) => bob.emit('room:join', { roomId: lobbyState.roomId, name: 'Bob' }, () => resolve()));
    await new Promise<void>((resolve) => charlie.emit('room:join', { roomId: lobbyState.roomId, name: 'Charlie' }, () => resolve()));

    // Force Charlie into sitting_out before the round starts.
    // The simplest path: have the room run one round where Charlie didn't
    // bet, which leaves them sitting_out. We then advance to the next
    // betting phase and confirm the all-have-bet check ignores Charlie.
    const betting1 = listen<GameState>(alice, 'game:state', (s) => s.phase === 'betting');
    alice.emit('round:ready');
    await betting1;

    alice.emit('bet:place', { amount: 50 });
    bob.emit('bet:place', { amount: 50 });
    // Charlie does not bet; after the 10s fallback, dealing fires and
    // Charlie stays empty (not a betting participant). Wait for dealing to
    // complete into player_turn before standing.
    const dealing1 = listen<GameState>(alice, 'game:state', (s) => s.phase === 'dealing');
    await new Promise((r) => setTimeout(r, Config.BET_DEADLINE_MS + 500));
    await dealing1;
    // Wait the dealing duration so the room transitions to player_turn
    // before we start standing (hand:stand requires player_turn phase).
    await new Promise((r) => setTimeout(r, Config.DEALING_DURATION_MS + 500));

    // All stand to reach settled, then advance to the next betting phase.
    const settled = listen<GameState>(alice, 'game:state', (s) => s.phase === 'settled');
    for (let i = 0; i < 4; i++) {
      alice.emit('hand:stand', { handIndex: 0 });
      bob.emit('hand:stand', { handIndex: 0 });
      await new Promise((r) => setTimeout(r, 50));
    }
    await settled;
    const betting2 = listen<GameState>(alice, 'game:state', (s) => s.phase === 'betting');
    await new Promise((r) => setTimeout(r, Config.SETTLE_PAUSE_MS + 500));
    const stateBeforeBet2 = await betting2;
    const charlieSeat = stateBeforeBet2.players.find((p) => p.name === 'Charlie');
    expect(charlieSeat?.status).toBe('sitting_out');

    // Now Alice and Bob bet. The all-have-bet check must ignore Charlie
    // (sitting_out) and fire dealing immediately.
    const dealing2 = listen<GameState>(alice, 'game:state', (s) => s.phase === 'dealing');
    alice.emit('bet:place', { amount: 50 });
    bob.emit('bet:place', { amount: 50 });
    const got = await Promise.race([
      dealing2,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('expected dealing after Alice and Bob bet')), 1_000)),
    ]);
    expect(got.phase).toBe('dealing');

    alice.disconnect();
    bob.disconnect();
    charlie.disconnect();
  }, 30_000);

  it('no intermediate betting broadcast after the all-in bet', async () => {
    // Two-player room. After both players bet, the very next broadcast must
    // be the dealing state — not a betting state with the bet recorded, then
    // a dealing state later. Today's onBet broadcasts the betting state with
    // the bet applied; the early-deal fix collapses it into a single dealing
    // broadcast.
    const host = await connectPlayer(url, '00000000-0000-4000-8000-000000000030');
    const guest = await connectPlayer(url, '00000000-0000-4000-8000-000000000031');
    const lobby = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
    const lobbyState = await lobby;
    await new Promise<void>((resolve) => guest.emit('room:join', { roomId: lobbyState.roomId, name: 'Bob' }, () => resolve()));

    const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await betting;

    // Collect every game:state broadcast that arrives on the host socket for
    // 600ms after the all-in bet. The list must contain zero betting-phase
    // broadcasts (today it contains one: the bet:place broadcast).
    const broadcasts: GameState[] = [];
    const collector = (s: GameState) => { broadcasts.push(s); };
    host.on('game:state', collector);

    host.emit('bet:place', { amount: 50 });
    guest.emit('bet:place', { amount: 50 });

    // Wait long enough that any intermediate betting broadcast would have
    // arrived, but well under the 10s BET_DEADLINE_MS window so the fallback
    // timer cannot fire here.
    await new Promise((r) => setTimeout(r, 600));
    host.off('game:state', collector);

    const intermediateBetting = broadcasts.find((s) => s.phase === 'betting');
    expect(intermediateBetting).toBeUndefined();
    // And the final broadcast we observe must be dealing.
    const last = broadcasts[broadcasts.length - 1];
    expect(last.phase).toBe('dealing');

    host.disconnect();
    guest.disconnect();
  }, 10_000);
});
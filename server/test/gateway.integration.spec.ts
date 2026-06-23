import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { Config } from '../src/config';
import type { GameState, LobbyState } from '../src/shared/types';

async function listen<T = any>(socket: Socket, event: string, predicate?: (p: T) => boolean): Promise<T> {
  return new Promise<T>((resolve) => {
    const handler = (p: T) => { if (!predicate || predicate(p)) { socket.off(event, handler); resolve(p); } };
    socket.on(event, handler);
  });
}

describe('gateway integration: 2-player full round', () => {
  let app: INestApplication;
  let url: string;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-gwint-'));
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

  it('walks two clients through create → join → bet → deal → stand → stand → settle', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
    const guest = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
    await Promise.all([new Promise<void>((r) => host.on('connect', () => r())), new Promise<void>((r) => guest.on('connect', () => r()))]);

    // Register listeners BEFORE emitting to avoid race with synchronous server emit.
    const lobby1Promise = listen<LobbyState>(host, 'lobby:state');
    const created = await new Promise<{ seatId: string }>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, (resp: any) => resolve(resp));
    });
    const lobby1 = await lobby1Promise;
    const roomId = lobby1.roomId;
    expect(created.seatId).toBeTruthy();

    const guestLobbyPromise = listen<LobbyState>(guest, 'lobby:state');
    await new Promise<void>((resolve) => {
      guest.emit('room:join', { roomId, name: 'Bob' }, () => resolve());
    });
    await guestLobbyPromise;

    // Transition out of lobby phase so bets are accepted (lobby only handles round:ready).
    const readyPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await readyPromise;

    const betState1 = listen<GameState>(host, 'game:state');
    const betState2 = listen<GameState>(guest, 'game:state');
    host.emit('bet:place', { amount: 50 });
    guest.emit('bet:place', { amount: 50 });
    await Promise.all([betState1, betState2]);

    const startedPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'player_turn');
    // The deal fires automatically when the 10s bet deadline elapses; the
    // dealing phase then lasts Config.DEALING_DURATION_MS before player_turn.
    await new Promise((r) => setTimeout(r, Config.BET_DEADLINE_MS + Config.DEALING_DURATION_MS + 500));
    const started = await startedPromise;
    expect(started.phase).toBe('player_turn');
    expect(started.activeSeat).not.toBeNull();

    // Listen for the next phase on the host. We expect that after both players stand
    // the phase becomes 'dealer_turn' then 'settled'.
    const settledPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'settled');

    // Drive the round: each player stands in turn.
    // The active seat progresses seat 0 → seat 1 → dealer_turn → settled.
    // We do not need to know which player is active because each player's hand:stand
    // is rejected (NOT_YOUR_TURN) if it's not their turn. We'll fire stand from both
    // and use the host's state stream to know when the phase changes.
    for (let i = 0; i < 4; i++) {
      host.emit('hand:stand', { handIndex: 0 });
      guest.emit('hand:stand', { handIndex: 0 });
      await new Promise((r) => setTimeout(r, 50));
    }

    const settled = await settledPromise;
    expect(settled.phase).toBe('settled');
    expect(settled.lastResult).toBeTruthy();
    expect(settled.lastResult!.payouts.length).toBeGreaterThan(0);

    // The next betting phase arrives automatically when the 3s settle pause elapses.
    const betting2Promise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting' && s.lastResult === null);
    await new Promise((r) => setTimeout(r, Config.SETTLE_PAUSE_MS + 500));
    const betting2 = await betting2Promise;
    expect(betting2.phase).toBe('betting');
    expect(betting2.lastResult).toBeNull();
    expect(betting2.dealer.cards).toEqual([]);
    // Each player's hand should be reset; lastBet should be preserved from the previous round.
    for (const p of betting2.players) {
      if (p.status === 'empty') continue;
      expect(p.hands.length).toBe(1);
      expect(p.hands[0].cards).toEqual([]);
      expect(p.hands[0].bet).toBe(0);
      expect(p.lastBet).toBe(50); // both players bet 50 in round 1
    }

    host.disconnect();
    guest.disconnect();
  }, 30_000);

  it('re-loops the betting phase when 0 players bet by the deadline', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
    await new Promise<void>((r) => host.on('connect', () => r()));

    const lobbyPromise = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    await lobbyPromise;

    // round:ready → phase transitions to 'betting'.
    const bettingPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    const betting1 = await bettingPromise;
    expect(betting1.phase).toBe('betting');
    expect(betting1.phaseEndsAt).toBeGreaterThan(Date.now());

    // Wait for the bet deadline; nobody has bet → re-loop.
    const betting2Promise = listen<GameState>(host, 'game:state',
      (s) => s.phase === 'betting' && s.phaseEndsAt !== null && s.phaseEndsAt > betting1.phaseEndsAt!);
    await new Promise((r) => setTimeout(r, Config.BET_DEADLINE_MS + 500));
    const betting2 = await betting2Promise;
    expect(betting2.phase).toBe('betting');
    expect(betting2.phaseEndsAt).toBeGreaterThan(betting1.phaseEndsAt!);

    host.disconnect();
  }, 15_000);

  describe('room:resume', () => {
    it('rebinds a returning client to the same seat using the seatToken', async () => {
      const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
      await new Promise<void>((r) => host.on('connect', () => r()));

      const lobby1 = listen<LobbyState>(host, 'lobby:state');
      const created = await new Promise<{ seatId: string; seatToken: string }>((resolve) => {
        host.emit('room:create', { name: 'Alice' }, (resp: any) => resolve(resp));
      });
      const lobbyState = await lobby1;
      const roomId = lobbyState.roomId;
      expect(created.seatId).toBeTruthy();
      expect(created.seatToken).toBeTruthy();

      // Simulate a reload: a fresh socket reconnects with the seatToken.
      const fresh = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
      await new Promise<void>((r) => fresh.on('connect', () => r()));
      const lobby2 = listen<LobbyState>(fresh, 'lobby:state');
      const gameState2 = listen<{ phase: string }>(fresh, 'game:state');
      const resumed = await new Promise<{ seatId: string }>((resolve) => {
        fresh.emit('room:resume', { roomId, seatToken: created.seatToken }, (resp: any) => resolve(resp));
      });
      const freshLobby = await lobby2;
      const freshGame = await gameState2;
      // The ack's seatId matches the original seat, and the resumed player shows
      // up in the lobby / game broadcasts — proving the socket-to-seat binding
      // was actually updated, not just that the server echoed the original id.
      expect(resumed.seatId).toBe(created.seatId);
      expect(freshLobby.players.map((p) => p.name)).toContain('Alice');
      expect(freshGame.phase).toBe('lobby');

      host.disconnect();
      fresh.disconnect();
    }, 10_000);

    it('emits SEAT_GONE error when the seatToken is unknown', async () => {
      const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
      await new Promise<void>((r) => host.on('connect', () => r()));
      const lobby1 = listen<LobbyState>(host, 'lobby:state');
      await new Promise<void>((resolve) => {
        host.emit('room:create', { name: 'Alice' }, () => resolve());
      });
      const lobbyState = await lobby1;
      const err = listen<{ code: string }>(host, 'error');
      host.emit('room:resume', { roomId: lobbyState.roomId, seatToken: 'bogus' });
      const got = await err;
      expect(got.code).toBe('SEAT_GONE');
      host.disconnect();
    }, 10_000);
  });

  describe('disconnect grace period', () => {
    it('keeps the seat in the room after a socket disconnects, so a fresh socket can resume', async () => {
      const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
      await new Promise<void>((r) => host.on('connect', () => r()));

      const lobby1 = listen<LobbyState>(host, 'lobby:state');
      const created = await new Promise<{ seatId: string; seatToken: string }>((resolve) => {
        host.emit('room:create', { name: 'Alice' }, (resp: any) => resolve(resp));
      });
      const roomId = (await lobby1).roomId;
      expect(created.seatToken).toBeTruthy();

      // Simulate a page reload: the original socket drops before a fresh
      // one can connect. With the grace period in place, the seat entry
      // must NOT be removed synchronously on disconnect.
      host.disconnect();
      // Yield so any synchronous (incorrect) leave handler would have run.
      await new Promise((r) => setImmediate(r));

      const fresh = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
      await new Promise<void>((r) => fresh.on('connect', () => r()));

      // The fresh socket should be able to resume the original seat using
      // the seatToken. If the seat had been removed on disconnect, this
      // would emit SEAT_GONE instead.
      const lobby2 = listen<LobbyState>(fresh, 'lobby:state');
      const resumed = await new Promise<{ seatId: string }>((resolve) => {
        fresh.emit('room:resume', { roomId, seatToken: created.seatToken }, (resp: any) => resolve(resp));
      });
      const freshLobby = await lobby2;

      expect(resumed.seatId).toBe(created.seatId);
      expect(freshLobby.players.map((p) => p.name)).toContain('Alice');

      fresh.disconnect();
    }, 10_000);

    it('still emits SEAT_GONE when an unknown token is used during the grace period', async () => {
      // A wrong token must still fail, even if a (different) seat is currently
      // in the grace period from a prior disconnect. Defends against
      // accidentally over-eager cancellation logic.
      const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
      await new Promise<void>((r) => host.on('connect', () => r()));
      const lobby1 = listen<LobbyState>(host, 'lobby:state');
      await new Promise<void>((resolve) => {
        host.emit('room:create', { name: 'Alice' }, () => resolve());
      });
      const roomId = (await lobby1).roomId;

      // Disconnect so a grace timer is now pending for Alice's seat.
      host.disconnect();
      await new Promise((r) => setImmediate(r));

      // A brand-new socket tries to resume with a bogus token in the same
      // room. The seat exists (Alice's), but the token is wrong → SEAT_GONE.
      const fresh = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000003' } });
      await new Promise<void>((r) => fresh.on('connect', () => r()));
      const err = listen<{ code: string }>(fresh, 'error');
      fresh.emit('room:resume', { roomId, seatToken: 'bogus-during-grace' });
      const got = await err;
      expect(got.code).toBe('SEAT_GONE');
      fresh.disconnect();
    }, 10_000);
  });
});

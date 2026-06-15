import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors({ origin: '*', credentials: true });
    await app.listen(0);
    const addr = app.getHttpServer().address();
    url = `http://localhost:${addr.port}`;
  });

  afterAll(async () => { await app.close(); });

  it('walks two clients through create → join → bet → deal → stand → stand → settle', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true });
    const guest = io(url, { transports: ['websocket'], forceNew: true });
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

    const startedPromise = listen<GameState>(host, 'game:state', (s) => s.phase !== 'lobby' && s.phase !== 'betting');
    host.emit('round:start');
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

    // Host advances to the next hand.
    const betting2Promise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting' && s.lastResult === null);
    host.emit('round:advance');
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
  }, 15_000);

  it('rejects round:start when no one has bet and round:ready gates the flow into betting', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true });
    await new Promise<void>((r) => host.on('connect', () => r()));

    const lobbyPromise = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    await lobbyPromise;

    // round:start with no bets → NOT_READY error.
    const errPromise = listen<{ code: string }>(host, 'error');
    host.emit('round:start');
    const err = await errPromise;
    expect(err.code).toBe('NOT_READY');

    // round:ready → phase transitions to 'betting'.
    const readyPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    const betting = await readyPromise;
    expect(betting.phase).toBe('betting');
    expect(betting.lastResult).toBeNull();
    expect(betting.activeSeat).toBeNull();

    host.disconnect();
  }, 10_000);

  it('rejects round:advance from a non-host with NOT_HOST', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true });
    const guest = io(url, { transports: ['websocket'], forceNew: true });
    await Promise.all([
      new Promise<void>((r) => host.on('connect', () => r())),
      new Promise<void>((r) => guest.on('connect', () => r())),
    ]);

    const lobbyPromise = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    const lobby = await lobbyPromise;
    const roomId = lobby.roomId;

    await new Promise<void>((resolve) => {
      guest.emit('room:join', { roomId, name: 'Bob' }, () => resolve());
    });

    // Guest (non-host) emits round:advance → expect NOT_HOST error.
    const errPromise = listen<{ code: string }>(guest, 'error');
    guest.emit('round:advance');
    const err = await errPromise;
    expect(err.code).toBe('NOT_HOST');

    host.disconnect();
    guest.disconnect();
  }, 10_000);

  it('rejects round:advance from the host while not in settled phase', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true });
    await new Promise<void>((r) => host.on('connect', () => r()));

    const lobbyPromise = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    await lobbyPromise;

    // Host is in lobby phase (not settled). Emit round:advance → expect INVALID_PHASE.
    const errPromise = listen<{ code: string }>(host, 'error');
    host.emit('round:advance');
    const err = await errPromise;
    expect(err.code).toBe('INVALID_PHASE');

    host.disconnect();
  }, 10_000);

  describe('room:resume', () => {
    it('rebinds a returning client to the same seat using the seatToken', async () => {
      const host = io(url, { transports: ['websocket'], forceNew: true });
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
      const fresh = io(url, { transports: ['websocket'], forceNew: true });
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
      const host = io(url, { transports: ['websocket'], forceNew: true });
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
});

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { Config } from '../../src/config';
import type { GameState, LobbyState } from '../../src/shared/types';

async function listen<T = any>(socket: Socket, event: string, predicate?: (p: T) => boolean): Promise<T> {
  return new Promise<T>((resolve) => {
    const handler = (p: T) => { if (!predicate || predicate(p)) { socket.off(event, handler); resolve(p); } };
    socket.on(event, handler);
  });
}

async function connect(url: string): Promise<Socket> {
  const sock = io(url, { transports: ['websocket'], forceNew: true });
  await new Promise<void>((r) => sock.on('connect', () => r()));
  return sock;
}

describe('gateway integration: 5-player full round', () => {
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

  it('walks 5 clients through create → join → bet → deal → 5x stand → settle', async () => {
    // Connect host + 4 guests so the table fills 5 seats.
    const host = await connect(url);
    const guests: Socket[] = [];
    for (let i = 0; i < 4; i++) guests.push(await connect(url));
    const players = [host, ...guests];

    // Host creates the room.
    const lobbyPromise = listen<LobbyState>(host, 'lobby:state');
    const created = await new Promise<{ seatId: string; roomId: string }>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, (resp: any) => resolve(resp));
    });
    const lobby = await lobbyPromise;
    const roomId = lobby.roomId;
    expect(created.seatId).toBeTruthy();
    expect(roomId).toBeTruthy();

    // Each guest joins the room.
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i];
      const joinLobbyPromise = listen<LobbyState>(g, 'lobby:state');
      await new Promise<void>((resolve) => {
        g.emit('room:join', { roomId, name: `Player${i + 2}` }, () => resolve());
      });
      await joinLobbyPromise;
    }

    // Transition out of lobby phase so bets are accepted.
    const readyPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    const readyState = await readyPromise;
    expect(readyState.players.filter((p) => p.status !== 'empty').length).toBe(5);

    // Each player places a $50 bet.
    const betPromises: Promise<GameState>[] = [];
    for (const s of players) {
      betPromises.push(listen<GameState>(s, 'game:state'));
    }
    for (const s of players) {
      s.emit('bet:place', { amount: 50 });
    }
    await Promise.all(betPromises);

    // Host starts the round (deal fires automatically when the bet deadline elapses).
    const startedPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'player_turn');
    await new Promise((r) => setTimeout(r, Config.BET_DEADLINE_MS + 500));
    const started = await startedPromise;
    expect(started.phase).toBe('player_turn');
    expect(started.activeSeat).not.toBeNull();

    // Track which seats have been the active seat during player_turn.
    const seenActiveSeats = new Set<number>([started.activeSeat!]);

    // Pre-arm listeners for dealer_turn and settled so we don't miss them.
    const dealerTurnPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealer_turn');
    const settledPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'settled');

    // Listen for game:state events on the host to track which seats have acted.
    const traceListener = (s: GameState) => {
      if (s.phase === 'player_turn' && s.activeSeat !== null) {
        seenActiveSeats.add(s.activeSeat);
      }
    };
    host.on('game:state', traceListener);

    // Drive the round. Each player's hand:stand is rejected (NOT_YOUR_TURN) if it's not
    // their turn. We fire stand from all players and let the state machine walk.
    // The dealer_turn/settled listeners above will resolve when the round completes.
    for (let i = 0; i < 10; i++) {
      for (const s of players) {
        s.emit('hand:stand', { handIndex: 0 });
      }
      // If the dealer already played and the round settled, break early.
      if (i > 0) {
        const winner = await Promise.race([
          dealerTurnPromise.then(() => 'dealer' as const).catch(() => null),
          settledPromise.then(() => 'settled' as const).catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 200)),
        ]);
        if (winner) break;
      } else {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Wait for the round to finish (dealer_turn may resolve first, then settled).
    const settled = await settledPromise;
    host.off('game:state', traceListener);
    expect(settled.phase).toBe('settled');
    expect(settled.lastResult).toBeTruthy();
    expect(settled.lastResult!.payouts.length).toBeGreaterThan(0);

    // All 5 players should have been the active seat — proves the 5-player flow walked.
    expect(seenActiveSeats.size).toBe(5);
    for (let i = 0; i < 5; i++) expect(seenActiveSeats.has(i)).toBe(true);

    for (const s of players) s.disconnect();
  }, 45_000);
});

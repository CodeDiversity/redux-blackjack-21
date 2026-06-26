import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
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

describe('bankroll persistence (end-to-end)', () => {
  const playerA = '00000000-0000-4000-8000-0000000000a1';
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-bp-e2e-'));
    dbPath = join(dir, 'blackjack.db');
    process.env.DB_PATH = dbPath;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a player\'s bankroll survives an app restart', async () => {
    // --- Phase 1: connect, run a full round whose settle mutates bankroll ---
    jest.resetModules();
    const { AppModule } = require('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app1: INestApplication = moduleRef.createNestApplication();
    app1.enableCors({ origin: '*', credentials: true });
    await app1.listen(0);
    const url1 = `http://localhost:${app1.getHttpServer().address().port}`;

    const host = await connectPlayer(url1, playerA);
    // Set up the lobby:state listener BEFORE room:create (race-free order;
    // onCreate emits lobby:state synchronously).
    const lobby = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
    await lobby;
    const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await betting;

    // bet:place only records the bet on the hand — it does NOT mutate bankroll
    // (the state machine debits on hand:double/hand:split and credits on
    // round:resolve via assignSettle). So we drive the room through dealing
    // → player_turn → hand:double → dealer_turn → settled, which mutates
    // bankroll at both the double (debit) and the settle (payout credit/debit).
    host.emit('bet:place', { amount: 50 });
    await listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');

    // dealing → player_turn happens via the server's auto-advance timer
    // (round:dealingComplete fires after Config.DEALING_DURATION_MS).
    const playerTurn = listen<GameState>(host, 'game:state', (s) => s.phase === 'player_turn');
    await new Promise((r) => setTimeout(r, Config.DEALING_DURATION_MS + 500));
    await playerTurn;

    // Solo player: hand:double debits bankroll by hand.bet (50) AND
    // allHandsActed becomes true → auto-transition to dealer_turn →
    // applyAction sends round:dealerPlay → settled. The settle entry
    // action assignSettle then applies the per-hand payout, mutating
    // bankroll a second time. The exact final value depends on the
    // dealer's drawn cards, but it MUST differ from STARTING_BANKROLL
    // (1000) because at minimum the double debited 50.
    const settled = listen<GameState>(host, 'game:state', (s) => s.phase === 'settled');
    host.emit('hand:double', { handIndex: 0 });
    const stateSettled = await settled;

    const seat = stateSettled.players.find((p) => p.name === 'Alice');
    expect(seat).toBeDefined();
    expect(seat!.bankroll).not.toBe(Config.STARTING_BANKROLL);

    // Confirm the writeback landed in the DB. The diff loop in
    // RoomService.apply fires once per bankroll-changing action, so by
    // the time we reach settled the row reflects the post-settle value.
    // Use a fresh better-sqlite3 connection here (not getDb()) because
    // jest.resetModules() causes this test file and the freshly-loaded
    // AppModule to each evaluate storage/db.ts as a separate module
    // instance, so each has its own `_db` singleton. The test file's
    // Config.DB_PATH was captured at the test's import time (before
    // beforeAll set process.env.DB_PATH), so the test's getDb() would
    // resolve to the default 'data/blackjack.db' — not the tempdir.
    // Opening `new Database(dbPath)` directly bypasses both singletons
    // and reads the same on-disk file the app's connection wrote to.
    const reader1 = new Database(dbPath);
    const row1 = reader1
      .prepare('SELECT amount FROM bankrolls WHERE player_id = ?')
      .get(playerA) as { amount: number } | undefined;
    reader1.close();
    expect(row1).toBeDefined();
    const persistedAmount = row1!.amount;
    expect(persistedAmount).not.toBe(Config.STARTING_BANKROLL);

    host.disconnect();
    await app1.close();

    // --- Phase 2: re-open the same DB path, create a new room, hydrate ---
    jest.resetModules();
    const { AppModule: AppModule2 } = require('../src/app.module');
    const moduleRef2 = await Test.createTestingModule({ imports: [AppModule2] }).compile();
    const app2: INestApplication = moduleRef2.createNestApplication();
    app2.enableCors({ origin: '*', credentials: true });
    await app2.listen(0);
    const url2 = `http://localhost:${app2.getHttpServer().address().port}`;

    const host2 = await connectPlayer(url2, playerA);
    // Set up the game:state listener BEFORE room:create, because
    // onCreate emits both lobby:state and game:state synchronously
    // (server/src/gateway/game.gateway.ts:188-189). If we awaited
    // lobby:state first, the game:state broadcast would already have
    // arrived and been dropped.
    const initialState = listen<GameState>(host2, 'game:state');
    const lobby2 = listen<LobbyState>(host2, 'lobby:state');
    await new Promise<void>((resolve) => host2.emit('room:create', { name: 'Alice2' }, () => resolve()));
    const lobbyState2 = await lobby2;
    expect(lobbyState2.roomId).toBeTruthy();

    // The freshly-assigned host seat must show bankroll === persistedAmount
    // (proves hydration from SQLite works across the restart), NOT
    // STARTING_BANKROLL. The first game:state broadcast after lobby:state
    // carries the new room's seats, which have just been assigned via
    // assignSeat (which calls getBankroll).
    const state2 = await initialState;
    const hostSeat = state2.players.find((p) => p.name === 'Alice2');
    expect(hostSeat?.bankroll).toBe(persistedAmount);

    host2.disconnect();
    await app2.close();
  }, 30_000);
});

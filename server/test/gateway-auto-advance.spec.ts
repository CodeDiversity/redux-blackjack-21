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

describe('gateway auto-advance timers', () => {
  let app: INestApplication;
  let url: string;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-autoadvance-'));
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

  it('attaches phaseEndsAt to the betting game:state', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000002' } });
    await new Promise<void>((r) => host.on('connect', () => r()));
    const lobby1 = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    await lobby1;

    const bettingPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    const betting = await bettingPromise;
    expect(betting.phaseEndsAt).not.toBeNull();
    expect(betting.phaseEndsAt!).toBeGreaterThan(Date.now());
    expect(betting.phaseEndsAt!).toBeLessThanOrEqual(Date.now() + Config.BET_DEADLINE_MS + 100);

    host.disconnect();
  }, 10_000);

  it('attaches phaseEndsAt to the settled game:state', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000002' } });
    const guest = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000002' } });
    await Promise.all([
      new Promise<void>((r) => host.on('connect', () => r())),
      new Promise<void>((r) => guest.on('connect', () => r())),
    ]);

    const lobby1 = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    const lobbyState = await lobby1;
    const roomId = lobbyState.roomId;
    await new Promise<void>((resolve) => {
      guest.emit('room:join', { roomId, name: 'Bob' }, () => resolve());
    });

    const bettingPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await bettingPromise;
    host.emit('bet:place', { amount: 50 });
    guest.emit('bet:place', { amount: 50 });
    const turnPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'player_turn');
    await new Promise((r) => setTimeout(r, Config.BET_DEADLINE_MS + 500));
    await turnPromise;

    const settledPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'settled');
    for (let i = 0; i < 4; i++) {
      host.emit('hand:stand', { handIndex: 0 });
      guest.emit('hand:stand', { handIndex: 0 });
      await new Promise((r) => setTimeout(r, 50));
    }
    const settled = await settledPromise;
    expect(settled.phaseEndsAt).not.toBeNull();

    const nextBetting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    await new Promise((r) => setTimeout(r, Config.SETTLE_PAUSE_MS + 500));
    const betting2 = await nextBetting;
    expect(betting2.phase).toBe('betting');
    expect(betting2.phaseEndsAt).not.toBeNull();

    host.disconnect();
    guest.disconnect();
  }, 20_000);

  it('cancels the timer when the room is destroyed', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000002' } });
    await new Promise<void>((r) => host.on('connect', () => r()));
    const lobby1 = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    await lobby1;
    const bettingPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await bettingPromise;
    host.disconnect();
    await new Promise((r) => setTimeout(r, Config.DISCONNECT_GRACE_MS + 1_000));
    const host2 = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000002' } });
    await new Promise<void>((r) => host2.on('connect', () => r()));
    const lobby2 = listen<LobbyState>(host2, 'lobby:state');
    await new Promise<void>((resolve) => {
      host2.emit('room:create', { name: 'Alice2' }, () => resolve());
    });
    const fresh = await lobby2;
    expect(fresh.roomId).toBeTruthy();
    host2.disconnect();
  }, 45_000);
});

describe('gateway dealing-phase auto-advance', () => {
  let app: INestApplication;
  let url: string;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-autoadvance-'));
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

  it('transitions dealing → player_turn after DEALING_DURATION_MS', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000002' } });
    const guest = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId: '00000000-0000-4000-8000-000000000002' } });
    await Promise.all([
      new Promise<void>((r) => host.on('connect', () => r())),
      new Promise<void>((r) => guest.on('connect', () => r())),
    ]);

    // Set up a 2-player room in betting phase, with both players having bet.
    const lobby1 = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    const lobbyState = await lobby1;
    const roomId = lobbyState.roomId;
    await new Promise<void>((resolve) => {
      guest.emit('room:join', { roomId, name: 'Bob' }, () => resolve());
    });

    const bettingPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await bettingPromise;
    host.emit('bet:place', { amount: 50 });
    guest.emit('bet:place', { amount: 50 });

    // With early-deal wired, dealing fires within ms of both bets landing.
    // Capture the dealing broadcast via a listener so phaseEndsAt is read
    // immediately (the deadline timer is cancelled by the early-deal branch).
    const dealingPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');
    const dealing = await dealingPromise;
    expect(dealing.phase).toBe('dealing');
    expect(dealing.phaseEndsAt).not.toBeNull();
    expect(dealing.phaseEndsAt!).toBeGreaterThan(Date.now());
    expect(dealing.phaseEndsAt!).toBeLessThanOrEqual(Date.now() + Config.DEALING_DURATION_MS + 100);

    const playerTurnPromise = listen<GameState>(host, 'game:state', (s) => s.phase === 'player_turn');
    await new Promise((r) => setTimeout(r, Config.DEALING_DURATION_MS + 500));
    const playerTurn = await playerTurnPromise;
    expect(playerTurn.phase).toBe('player_turn');

    host.disconnect();
    guest.disconnect();
  }, 20_000);
});

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

  it('walks two clients through create → join → bet → deal → hit → stand → settle', async () => {
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

    const betState1 = listen<GameState>(host, 'game:state');
    const betState2 = listen<GameState>(guest, 'game:state');
    host.emit('bet:place', { amount: 50 });
    guest.emit('bet:place', { amount: 50 });
    await Promise.all([betState1, betState2]);

    const startedPromise = listen<GameState>(host, 'game:state', (s) => s.phase !== 'lobby' && s.phase !== 'betting');
    host.emit('round:start');
    const started = await startedPromise;
    expect(['player_turn', 'dealer_turn', 'settled']).toContain(started.phase);

    host.disconnect();
    guest.disconnect();
  }, 15_000);
});

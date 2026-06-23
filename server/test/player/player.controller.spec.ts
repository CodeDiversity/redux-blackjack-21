import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import type { HandRow } from '../../src/storage/hands.repository';

// Set DB_PATH BEFORE requiring any src modules so Config.DB_PATH
// is initialized with our temp path (Config is `as const` and frozen
// at module load time).
const dir = mkdtempSync(join(tmpdir(), 'bj21-ctrl-'));
process.env.DB_PATH = join(dir, 'blackjack.db');

// Require src modules (not top-level imports) so we share the same
// module instance the controller uses, and so they pick up the DB_PATH
// env var set above.
const { _resetDbForTests } = require('../../src/storage/db');
const { recordHand } = require('../../src/storage/hands.repository');
const { AppModule } = require('../../src/app.module');

const playerId = '00000000-0000-4000-8000-000000000abc';

const base = (over: Partial<HandRow> = {}): HandRow => ({
  id: 'h', player_id: playerId, bet_amount: 100, outcome: 'win', net: 100,
  seat_index: 0, hand_index: 0, is_doubled: 0 as 0 | 1, player_total: 20, dealer_total: 18,
  player_cards: '[]', dealer_cards: '[]', room_code: 'R', round_number: 1, created_at: 0,
  ...over,
});

describe('PlayerController (GET /api/players/:playerId/profile)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    _resetDbForTests();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors({ origin: '*', credentials: true });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 400 for a malformed playerId', async () => {
    await request(app.getHttpServer()).get('/api/players/not-a-uuid/profile').expect(400);
  });

  it('returns an empty profile for an unknown but valid-shape playerId', async () => {
    const res = await request(app.getHttpServer()).get(`/api/players/${playerId}/profile`).expect(200);
    expect(res.body.stats.hands_played).toBe(0);
    expect(res.body.streaks.current).toEqual({ kind: null, length: 0 });
    expect(res.body.achievements).toHaveLength(6);
    expect(res.body.achievements.every((a: any) => a.earned === false)).toBe(true);
    expect(res.body.recentHands).toEqual([]);
  });

  it('returns full profile with stats, streaks, achievements, and recent hands', async () => {
    recordHand(base({ id: 'h1', outcome: 'win', net: 100, bet_amount: 25, created_at: 1 }));
    recordHand(base({ id: 'h2', outcome: 'win', net: 200, bet_amount: 200, created_at: 2, is_doubled: 1 }));
    recordHand(base({ id: 'h3', outcome: 'loss', net: -50, bet_amount: 50, created_at: 3 }));
    recordHand(base({ id: 'h4', outcome: 'blackjack', net: 75, bet_amount: 300, created_at: 4 }));

    const res = await request(app.getHttpServer()).get(`/api/players/${playerId}/profile`).expect(200);
    expect(res.body.stats).toMatchObject({
      hands_played: 4, wins: 2, losses: 1, blackjacks: 1, doubles: 1,
      net_profit: 325, biggest_win: 200, biggest_loss: -50,
    });
    expect(res.body.streaks.current).toEqual({ kind: 'win', length: 1 }); // last is blackjack → win
    expect(res.body.streaks.longestWinStreak).toBe(2); // win, win, then loss
    expect(res.body.recentHands[0].id).toBe('h4');     // newest first
    expect(res.body.bySeat).toEqual([{ seat_index: 0, hands: 4, wins: 3 }]);
    const byBetMap = Object.fromEntries(res.body.byBet.map((b: any) => [b.bucket, b]));
    expect(byBetMap.small).toEqual({ bucket: 'small', hands: 2, wins: 1 });
    expect(byBetMap.medium).toEqual({ bucket: 'medium', hands: 1, wins: 1 });
    expect(byBetMap.large).toEqual({ bucket: 'large', hands: 1, wins: 1 });

    const earned = res.body.achievements.filter((a: any) => a.earned).map((a: any) => a.id).sort();
    expect(earned).toEqual(['doubled-down', 'first-blackjack']);
  });
});
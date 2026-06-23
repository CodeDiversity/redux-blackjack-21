import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, _resetDbForTests } from '../../src/storage/db';
import { recordHand, type HandRow } from '../../src/storage/hands.repository';
import {
  getPlayerStats, getPerformanceBySeat, getPerformanceByBetSize, getAllHandsForStreaks,
} from '../../src/storage/stats.repository';

const playerId = '00000000-0000-4000-8000-000000000001';
const base = (over: Partial<HandRow> = {}): HandRow => ({
  id: 'h', player_id: playerId, bet_amount: 100, outcome: 'win', net: 100,
  seat_index: 0, hand_index: 0, is_doubled: 0 as 0 | 1, player_total: 20, dealer_total: 18,
  player_cards: '[]', dealer_cards: '[]', room_code: 'R', round_number: 1, created_at: 0,
  ...over,
});

describe('stats.repository', () => {
  let dir: string;
  beforeEach(() => {
    _resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), 'bj21-stats-'));
    initDb({ dbPath: join(dir, 'blackjack.db') });
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); _resetDbForTests(); });

  describe('getPlayerStats', () => {
    it('returns zeros for a player with no hands', () => {
      const s = getPlayerStats(playerId);
      expect(s).toEqual({
        hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
        net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0,
      });
    });

    it('aggregates mixed outcomes correctly', () => {
      recordHand(base({ id: 'h1', outcome: 'win', net: 100, bet_amount: 100 }));
      recordHand(base({ id: 'h2', outcome: 'loss', net: -50, bet_amount: 50 }));
      recordHand(base({ id: 'h3', outcome: 'blackjack', net: 75, bet_amount: 50 }));
      recordHand(base({ id: 'h4', outcome: 'push', net: 0, bet_amount: 100 }));
      recordHand(base({ id: 'h5', outcome: 'win', net: 200, bet_amount: 200, is_doubled: 1 }));
      const s = getPlayerStats(playerId);
      expect(s.hands_played).toBe(5);
      expect(s.wins).toBe(2);
      expect(s.losses).toBe(1);
      expect(s.pushes).toBe(1);
      expect(s.blackjacks).toBe(1);
      expect(s.doubles).toBe(1);
      expect(s.net_profit).toBe(325);
      expect(s.biggest_win).toBe(200);
      expect(s.biggest_loss).toBe(-50);
      expect(s.total_wagered).toBe(500);
    });
  });

  describe('getPerformanceBySeat', () => {
    it('groups by seat_index and counts wins (win+blackjack)', () => {
      recordHand(base({ id: 'h1', seat_index: 0, outcome: 'win' }));
      recordHand(base({ id: 'h2', seat_index: 0, outcome: 'loss' }));
      recordHand(base({ id: 'h3', seat_index: 1, outcome: 'blackjack' }));
      const out = getPerformanceBySeat(playerId);
      expect(out).toEqual([
        { seat_index: 0, hands: 2, wins: 1 },
        { seat_index: 1, hands: 1, wins: 1 },
      ]);
    });
  });

  describe('getPerformanceByBetSize', () => {
    it('buckets bets into small/medium/large/max', () => {
      recordHand(base({ id: 'a', bet_amount: 50, outcome: 'win' }));     // small
      recordHand(base({ id: 'b', bet_amount: 99, outcome: 'loss' }));    // small
      recordHand(base({ id: 'c', bet_amount: 100, outcome: 'win' }));    // medium
      recordHand(base({ id: 'd', bet_amount: 249, outcome: 'win' }));    // medium
      recordHand(base({ id: 'e', bet_amount: 250, outcome: 'loss' }));   // large
      recordHand(base({ id: 'f', bet_amount: 499, outcome: 'win' }));    // large
      recordHand(base({ id: 'g', bet_amount: 500, outcome: 'win' }));    // max
      const out = getPerformanceByBetSize(playerId);
      const map = Object.fromEntries(out.map((b) => [b.bucket, b]));
      expect(map.small).toEqual({ bucket: 'small', hands: 2, wins: 1 });
      expect(map.medium).toEqual({ bucket: 'medium', hands: 2, wins: 2 });
      expect(map.large).toEqual({ bucket: 'large', hands: 2, wins: 1 });
      expect(map.max).toEqual({ bucket: 'max', hands: 1, wins: 1 });
    });
  });

  describe('getAllHandsForStreaks', () => {
    it('returns all hands for the player, oldest first', () => {
      recordHand(base({ id: 'h1', created_at: 3, outcome: 'win' }));
      recordHand(base({ id: 'h2', created_at: 1, outcome: 'loss' }));
      recordHand(base({ id: 'h3', created_at: 2, outcome: 'win' }));
      const ids = getAllHandsForStreaks(playerId).map((h) => h.id);
      expect(ids).toEqual(['h2', 'h3', 'h1']);
    });
  });
});

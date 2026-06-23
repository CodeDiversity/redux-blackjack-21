import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, _resetDbForTests } from '../../src/storage/db';
import { recordHand, getRecentHands } from '../../src/storage/hands.repository';

function freshDb() {
  _resetDbForTests();
  const dir = mkdtempSync(join(tmpdir(), 'bj21-hands-'));
  initDb({ dbPath: join(dir, 'blackjack.db') });
  return dir;
}

const baseHand = {
  player_id: '00000000-0000-4000-8000-000000000001',
  bet_amount: 100,
  outcome: 'win' as const,
  net: 100,
  seat_index: 0,
  hand_index: 0,
  is_doubled: 0 as 0 | 1,
  player_total: 20,
  dealer_total: 18,
  player_cards: JSON.stringify([{ suit: '♠', rank: 'K' }, { suit: '♥', rank: 'Q' }]),
  dealer_cards: JSON.stringify([{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '8' }]),
  room_code: 'ABCDE',
  round_number: 1,
  created_at: 1_700_000_000_000,
};

describe('hands.repository', () => {
  let dir: string;
  beforeEach(() => { dir = freshDb(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); _resetDbForTests(); });

  it('recordHand inserts a row that round-trips through getRecentHands', () => {
    const id = 'hand-1';
    recordHand({ id, ...baseHand });
    const rows = getRecentHands(baseHand.player_id, 20, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id, bet_amount: 100, outcome: 'win', net: 100, seat_index: 0,
      player_total: 20, dealer_total: 18, room_code: 'ABCDE', round_number: 1,
    });
  });

  it('getRecentHands orders newest-first by created_at', () => {
    recordHand({ id: 'h1', ...baseHand, created_at: 1_000 });
    recordHand({ id: 'h2', ...baseHand, created_at: 3_000 });
    recordHand({ id: 'h3', ...baseHand, created_at: 2_000 });
    const ids = getRecentHands(baseHand.player_id, 20, 0).map((r) => r.id);
    expect(ids).toEqual(['h2', 'h3', 'h1']);
  });

  it('getRecentHands respects limit and offset', () => {
    for (let i = 0; i < 5; i++) recordHand({ id: `h${i}`, ...baseHand, created_at: i });
    const page1 = getRecentHands(baseHand.player_id, 2, 0);
    const page2 = getRecentHands(baseHand.player_id, 2, 2);
    expect(page1.map((r) => r.id)).toEqual(['h4', 'h3']);
    expect(page2.map((r) => r.id)).toEqual(['h2', 'h1']);
  });

  it('JSON card columns round-trip cleanly', () => {
    const cards = [{ suit: '♠' as const, rank: 'A' as const }, { suit: '♥' as const, rank: 'K' as const }];
    recordHand({ id: 'bj', ...baseHand, player_cards: JSON.stringify(cards), outcome: 'blackjack', net: 150 });
    const row = getRecentHands(baseHand.player_id, 1, 0)[0];
    expect(JSON.parse(row.player_cards)).toEqual(cards);
  });

  it('filters by player_id', () => {
    recordHand({ id: 'mine', ...baseHand });
    recordHand({ id: 'other', ...baseHand, player_id: '00000000-0000-4000-8000-000000000002' });
    const rows = getRecentHands(baseHand.player_id, 20, 0);
    expect(rows.map((r) => r.id)).toEqual(['mine']);
  });
});

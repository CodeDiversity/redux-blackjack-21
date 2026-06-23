import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, getDb, _resetDbForTests } from '../../src/storage/db';

describe('storage/db', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-db-'));
  });

  afterEach(() => {
    try { _resetDbForTests(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the hands table and indexes on a fresh DB', () => {
    const dbPath = join(dir, 'blackjack.db');
    initDb({ dbPath });
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='hands'"
    ).all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('hands');

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='hands'"
    ).all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining([
      'idx_hands_player_created',
      'idx_hands_player_outcome',
      'idx_hands_player_seat',
      'idx_hands_player_bet',
      'idx_hands_room',
    ]));
  });

  it('is idempotent — running init twice does not throw', () => {
    const dbPath = join(dir, 'blackjack.db');
    initDb({ dbPath });
    expect(() => initDb({ dbPath })).not.toThrow();
  });
});

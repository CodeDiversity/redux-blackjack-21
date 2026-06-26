import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, getDb, _resetDbForTests } from '../../src/storage/db';
import { Config } from '../../src/config';
import { getBankroll, setBankroll } from '../../src/storage/bankroll.repository';

const playerA = '00000000-0000-4000-8000-000000000001';
const playerB = '00000000-0000-4000-8000-000000000002';

function freshDb() {
  _resetDbForTests();
  const dir = mkdtempSync(join(tmpdir(), 'bj21-bankroll-'));
  initDb({ dbPath: join(dir, 'blackjack.db') });
  return dir;
}

describe('bankroll.repository', () => {
  let dir: string;
  beforeEach(() => { dir = freshDb(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); _resetDbForTests(); });

  it('getBankroll returns STARTING_BANKROLL for an unknown player', () => {
    expect(getBankroll(playerA)).toBe(Config.STARTING_BANKROLL);
  });

  it('setBankroll then getBankroll returns the stored amount', () => {
    setBankroll(playerA, 800);
    expect(getBankroll(playerA)).toBe(800);
  });

  it('setBankroll is an upsert: second call wins', () => {
    setBankroll(playerA, 800);
    setBankroll(playerA, 600);
    expect(getBankroll(playerA)).toBe(600);
  });

  it('different playerIds are independent', () => {
    setBankroll(playerA, 800);
    setBankroll(playerB, 400);
    expect(getBankroll(playerA)).toBe(800);
    expect(getBankroll(playerB)).toBe(400);
  });

  it('setBankroll stores updated_at as a recent timestamp', () => {
    const before = Date.now();
    setBankroll(playerA, 800);
    const after = Date.now();
    const row = getDb()
      .prepare('SELECT updated_at FROM bankrolls WHERE player_id = ?')
      .get(playerA) as { updated_at: number };
    expect(row.updated_at).toBeGreaterThanOrEqual(before);
    expect(row.updated_at).toBeLessThanOrEqual(after);
  });
});

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { Config } from '../config';

let _db: DB | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS hands (
  id              TEXT    PRIMARY KEY,
  player_id       TEXT    NOT NULL,
  bet_amount      INTEGER NOT NULL,
  outcome         TEXT    NOT NULL,
  net             INTEGER NOT NULL,
  seat_index      INTEGER NOT NULL,
  hand_index      INTEGER NOT NULL DEFAULT 0,
  is_doubled      INTEGER NOT NULL DEFAULT 0,
  player_total    INTEGER NOT NULL,
  dealer_total    INTEGER NOT NULL,
  player_cards    TEXT    NOT NULL,
  dealer_cards    TEXT    NOT NULL,
  room_code       TEXT    NOT NULL,
  round_number    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hands_player_created   ON hands (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hands_player_outcome   ON hands (player_id, outcome);
CREATE INDEX IF NOT EXISTS idx_hands_player_seat      ON hands (player_id, seat_index);
CREATE INDEX IF NOT EXISTS idx_hands_player_bet       ON hands (player_id, bet_amount);
CREATE INDEX IF NOT EXISTS idx_hands_room             ON hands (room_code, round_number);

CREATE TABLE IF NOT EXISTS bankrolls (
  player_id   TEXT    PRIMARY KEY,
  amount      INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;

export type InitDbOptions = { dbPath: string };

export function initDb(opts: InitDbOptions = { dbPath: resolveDbPath() }): DB {
  const path = isAbsolute(opts.dbPath) ? opts.dbPath : resolve(process.cwd(), opts.dbPath);
  mkdirSync(dirname(path), { recursive: true });
  if (_db) _db.close();
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.exec(SCHEMA_SQL);
  return _db;
}

export function getDb(): DB {
  if (!_db) _db = initDb();
  return _db;
}

/** Test-only: drop the singleton so the next getDb() opens a fresh connection. */
export function _resetDbForTests(): void {
  if (_db) { _db.close(); _db = null; }
}

function resolveDbPath(): string {
  return Config.DB_PATH;
}

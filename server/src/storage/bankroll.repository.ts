import { getDb } from './db';
import { Config } from '../config';

/**
 * Read the current persisted bankroll for a player.
 *
 * Returns Config.STARTING_BANKROLL (1000) when the player has no row yet —
 * this is the "first visit" case. Never throws on a missing row.
 */
export function getBankroll(playerId: string): number {
  const row = getDb()
    .prepare('SELECT amount FROM bankrolls WHERE player_id = ?')
    .get(playerId) as { amount: number } | undefined;
  return row?.amount ?? Config.STARTING_BANKROLL;
}

/**
 * Persist the current bankroll for a player. UPSERT: first call inserts;
 * subsequent calls overwrite. Synchronous; atomic per call (better-sqlite3).
 */
export function setBankroll(playerId: string, amount: number): void {
  getDb()
    .prepare(`
      INSERT INTO bankrolls (player_id, amount, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE
        SET amount = excluded.amount, updated_at = excluded.updated_at
    `)
    .run(playerId, amount, Date.now());
}

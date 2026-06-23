import { randomUUID } from 'crypto';
import { getDb } from './db';

export type Outcome = 'win' | 'loss' | 'push' | 'blackjack' | 'surrender';

export type NewHand = {
  id?: string;
  player_id: string;
  bet_amount: number;
  outcome: Outcome;
  net: number;
  seat_index: number;
  hand_index: number;
  is_doubled: 0 | 1;
  player_total: number;
  dealer_total: number;
  player_cards: string;  // JSON
  dealer_cards: string;  // JSON
  room_code: string;
  round_number: number;
  created_at: number;
};

export type HandRow = NewHand & { id: string };

const INSERT_SQL = `
INSERT INTO hands (
  id, player_id, bet_amount, outcome, net, seat_index, hand_index, is_doubled,
  player_total, dealer_total, player_cards, dealer_cards, room_code, round_number, created_at
) VALUES (
  @id, @player_id, @bet_amount, @outcome, @net, @seat_index, @hand_index, @is_doubled,
  @player_total, @dealer_total, @player_cards, @dealer_cards, @room_code, @round_number, @created_at
)
`;

export function recordHand(hand: NewHand): void {
  const row: HandRow = { id: hand.id ?? randomUUID(), ...hand };
  getDb().prepare(INSERT_SQL).run(row);
}

const RECENT_SQL = `
SELECT id, player_id, bet_amount, outcome, net, seat_index, hand_index, is_doubled,
       player_total, dealer_total, player_cards, dealer_cards, room_code, round_number, created_at
FROM hands
WHERE player_id = ?
ORDER BY created_at DESC
LIMIT ? OFFSET ?
`;

export function getRecentHands(playerId: string, limit: number, offset: number): HandRow[] {
  return getDb().prepare(RECENT_SQL).all(playerId, limit, offset) as HandRow[];
}

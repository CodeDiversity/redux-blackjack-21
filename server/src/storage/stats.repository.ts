import { getDb } from './db';
import type { HandRow } from './hands.repository';
import type { PlayerStats } from '../player/achievements';

const STATS_SQL = `
SELECT
  COUNT(*)                                                    AS hands_played,
  COALESCE(SUM(CASE WHEN outcome = 'win'        THEN 1 ELSE 0 END), 0) AS wins,
  COALESCE(SUM(CASE WHEN outcome = 'loss'       THEN 1 ELSE 0 END), 0) AS losses,
  COALESCE(SUM(CASE WHEN outcome = 'push'       THEN 1 ELSE 0 END), 0) AS pushes,
  COALESCE(SUM(CASE WHEN outcome = 'blackjack'  THEN 1 ELSE 0 END), 0) AS blackjacks,
  COALESCE(SUM(CASE WHEN outcome = 'surrender'  THEN 1 ELSE 0 END), 0) AS surrenders,
  COALESCE(SUM(CASE WHEN is_doubled = 1         THEN 1 ELSE 0 END), 0) AS doubles,
  COALESCE(SUM(net), 0)                                       AS net_profit,
  COALESCE(MAX(net), 0)                                       AS biggest_win,
  COALESCE(MIN(net), 0)                                       AS biggest_loss,
  COALESCE(SUM(bet_amount), 0)                                AS total_wagered
FROM hands
WHERE player_id = ?
`;

type StatsRow = {
  hands_played: number; wins: number; losses: number; pushes: number;
  blackjacks: number; surrenders: number; doubles: number;
  net_profit: number; biggest_win: number; biggest_loss: number; total_wagered: number;
};

export function getPlayerStats(playerId: string): PlayerStats {
  const r = getDb().prepare(STATS_SQL).get(playerId) as StatsRow | undefined;
  return r ?? {
    hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
    net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0,
  };
}

const SEAT_SQL = `
SELECT seat_index,
       COUNT(*)                                                          AS hands,
       SUM(CASE WHEN outcome IN ('win','blackjack') THEN 1 ELSE 0 END)   AS wins
FROM hands
WHERE player_id = ?
GROUP BY seat_index
ORDER BY seat_index
`;

export type SeatBreakdown = { seat_index: number; hands: number; wins: number };

export function getPerformanceBySeat(playerId: string): SeatBreakdown[] {
  return getDb().prepare(SEAT_SQL).all(playerId) as SeatBreakdown[];
}

const BET_SQL = `
SELECT
  CASE
    WHEN bet_amount < 100  THEN 'small'
    WHEN bet_amount < 250  THEN 'medium'
    WHEN bet_amount < 500  THEN 'large'
    ELSE                        'max'
  END AS bucket,
  COUNT(*)                                                          AS hands,
  SUM(CASE WHEN outcome IN ('win','blackjack') THEN 1 ELSE 0 END)   AS wins
FROM hands
WHERE player_id = ?
GROUP BY bucket
`;

export type BetBucket = { bucket: 'small' | 'medium' | 'large' | 'max'; hands: number; wins: number };

export function getPerformanceByBetSize(playerId: string): BetBucket[] {
  return getDb().prepare(BET_SQL).all(playerId) as BetBucket[];
}

const ALL_HANDS_SQL = `
SELECT id, player_id, bet_amount, outcome, net, seat_index, hand_index, is_doubled,
       player_total, dealer_total, player_cards, dealer_cards, room_code, round_number, created_at
FROM hands
WHERE player_id = ?
ORDER BY created_at ASC
`;

export function getAllHandsForStreaks(playerId: string): HandRow[] {
  return getDb().prepare(ALL_HANDS_SQL).all(playerId) as HandRow[];
}

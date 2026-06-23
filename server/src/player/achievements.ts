import type { HandRow } from '../storage/hands.repository';

export type { HandRow };

export type PlayerStats = {
  hands_played: number;
  wins: number;
  losses: number;
  pushes: number;
  blackjacks: number;
  surrenders: number;
  doubles: number;
  net_profit: number;
  biggest_win: number;
  biggest_loss: number;
  total_wagered: number;
};

export type AchievementResult = { earned: boolean; earnedAt: number | null };

export type Achievement = {
  id: string;
  name: string;
  description: string;
  icon: string;
  predicate: (stats: PlayerStats, hands: HandRow[]) => AchievementResult;
};

export function evaluateAchievement(a: Achievement, stats: PlayerStats, hands: HandRow[]): AchievementResult {
  return a.predicate(stats, hands);
}

export function longestWinStreak(hands: HandRow[]): number {
  let max = 0, run = 0;
  for (const h of hands) {
    if (h.outcome === 'win' || h.outcome === 'blackjack') {
      run += 1;
      if (run > max) max = run;
    } else if (h.outcome === 'push') {
      // push keeps the streak alive but doesn't extend the win count
      continue;
    } else {
      run = 0;
    }
  }
  return max;
}

export function hadWinAfter3LossStreak(hands: HandRow[]): boolean {
  let run = 0;
  for (const h of hands) {
    if (h.outcome === 'loss') {
      run += 1;
    } else if (h.outcome === 'win' || h.outcome === 'blackjack') {
      if (run >= 3) return true;
      run = 0;
    } else {
      run = 0;
    }
  }
  return false;
}

const firstHand = (hands: HandRow[], pred: (h: HandRow) => boolean): HandRow | undefined =>
  hands.find(pred);

const result = (earned: boolean, hand?: HandRow): AchievementResult =>
  earned ? { earned: true, earnedAt: hand?.created_at ?? null } : { earned: false, earnedAt: null };

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-blackjack',
    name: 'Natural',
    description: 'Win a hand with a natural blackjack',
    icon: '🂡',
    predicate: (s, h) => result(s.blackjacks >= 1, firstHand(h, (x) => x.outcome === 'blackjack')),
  },
  {
    id: 'ten-wins',
    name: 'Double Digits',
    description: 'Win 10 hands',
    icon: '🔟',
    predicate: (s) => result(s.wins >= 10),
  },
  {
    id: 'on-a-heater',
    name: 'On a Heater',
    description: 'Win 5 hands in a row',
    icon: '🔥',
    predicate: (_s, h) => result(longestWinStreak(h) >= 5),
  },
  {
    id: 'big-bet',
    name: 'High Roller',
    description: 'Place a max bet (500)',
    icon: '💰',
    predicate: (_s, h) => result(h.some((x) => x.bet_amount >= 500), firstHand(h, (x) => x.bet_amount >= 500)),
  },
  {
    id: 'doubled-down',
    name: 'Double or Nothing',
    description: 'Double down on a hand',
    icon: '✌️',
    predicate: (_s, h) => result(h.some((x) => x.is_doubled === 1), firstHand(h, (x) => x.is_doubled === 1)),
  },
  {
    id: 'comeback-kid',
    name: 'Comeback Kid',
    description: 'Win a hand after losing 3 in a row',
    icon: '🩹',
    predicate: (_s, h) => result(hadWinAfter3LossStreak(h)),
  },
];
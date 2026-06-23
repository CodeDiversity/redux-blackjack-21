import { Controller, Get, Param, BadRequestException } from '@nestjs/common';
import { getPlayerStats, getPerformanceBySeat, getPerformanceByBetSize, getAllHandsForStreaks } from '../storage/stats.repository';
import { getRecentHands, type Outcome } from '../storage/hands.repository';
import { ACHIEVEMENTS, evaluateAchievement, longestWinStreak, type PlayerStats } from './achievements';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_SIZE = 20;

export type ProfileResponse = {
  stats: PlayerStats;
  streaks: {
    current: { kind: 'win' | 'loss' | null; length: number };
    longestWinStreak: number;
    last10: Outcome[];
  };
  bySeat: { seat_index: number; hands: number; wins: number }[];
  byBet: { bucket: 'small' | 'medium' | 'large' | 'max'; hands: number; wins: number }[];
  achievements: { id: string; name: string; description: string; icon: string; earned: boolean; earnedAt: number | null }[];
  recentHands: ReturnType<typeof getRecentHands>;
};

@Controller('api/players')
export class PlayerController {
  @Get(':playerId/profile')
  getProfile(@Param('playerId') playerId: string): ProfileResponse {
    if (!UUID_V4_RE.test(playerId)) throw new BadRequestException('Invalid playerId');
    const stats = getPlayerStats(playerId);
    const hands = getAllHandsForStreaks(playerId);
    const streaks = computeStreaks(hands);
    const bySeat = getPerformanceBySeat(playerId);
    const byBet = getPerformanceByBetSize(playerId);
    const achievements = ACHIEVEMENTS.map((a) => {
      const r = evaluateAchievement(a, stats, hands);
      return { id: a.id, name: a.name, description: a.description, icon: a.icon, earned: r.earned, earnedAt: r.earnedAt };
    });
    const recentHands = getRecentHands(playerId, PAGE_SIZE, 0);
    return { stats, streaks, bySeat, byBet, achievements, recentHands };
  }
}

function computeStreaks(hands: ReturnType<typeof getAllHandsForStreaks>) {
  const last10 = hands.slice(-10).map((h) => h.outcome);
  const longest = longestWinStreak(hands);
  let current: { kind: 'win' | 'loss' | null; length: number } = { kind: null, length: 0 };
  if (hands.length > 0) {
    const last = hands[hands.length - 1];
    const lastKind = (last.outcome === 'win' || last.outcome === 'blackjack') ? 'win'
      : last.outcome === 'loss' ? 'loss' : null;
    if (lastKind) {
      let len = 0;
      for (let i = hands.length - 1; i >= 0; i--) {
        const k = (hands[i].outcome === 'win' || hands[i].outcome === 'blackjack') ? 'win'
          : hands[i].outcome === 'loss' ? 'loss' : null;
        if (k === lastKind) len += 1; else break;
      }
      current = { kind: lastKind, length: len };
    }
  }
  return { current, longestWinStreak: longest, last10 };
}

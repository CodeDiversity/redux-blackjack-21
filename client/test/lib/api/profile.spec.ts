import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProfile } from '../../../src/lib/api/profile';

const sample = {
  stats: { hands_played: 1, wins: 1, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
            net_profit: 100, biggest_win: 100, biggest_loss: 0, total_wagered: 100 },
  streaks: { current: { kind: 'win' as const, length: 1 }, longestWinStreak: 1, last10: ['win'] },
  bySeat: [{ seat_index: 0, hands: 1, wins: 1 }],
  byBet: [{ bucket: 'small' as const, hands: 1, wins: 1 }],
  achievements: [{ id: 'x', name: 'X', description: '', icon: '⭐', earned: false, earnedAt: null }],
  recentHands: [],
};

describe('fetchProfile', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the parsed profile on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => sample,
    }));
    const p = await fetchProfile('p1');
    expect(p).toEqual(sample);
  });

  it('returns an empty profile on 404 (not an error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    const p = await fetchProfile('p1');
    expect(p.stats.hands_played).toBe(0);
    expect(p.achievements).toEqual([]);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(fetchProfile('p1')).rejects.toThrow('network down');
  });

  it('throws on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(fetchProfile('p1')).rejects.toThrow(/500/);
  });
});

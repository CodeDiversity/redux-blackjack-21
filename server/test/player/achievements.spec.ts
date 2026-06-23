import { ACHIEVEMENTS, evaluateAchievement, type PlayerStats } from '../../src/player/achievements';
import type { HandRow } from '../../src/storage/hands.repository';
import { longestWinStreak, hadWinAfter3LossStreak } from '../../src/player/achievements';

const makeStats = (over: Partial<PlayerStats> = {}): PlayerStats => ({
  hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
  net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0,
  ...over,
});

const makeHand = (over: Partial<HandRow> = {}): HandRow => ({
  id: 'h', player_id: 'p', bet_amount: 100, outcome: 'win', net: 100,
  seat_index: 0, hand_index: 0, is_doubled: 0 as 0 | 1, player_total: 20, dealer_total: 18,
  player_cards: '[]', dealer_cards: '[]', room_code: 'R', round_number: 1, created_at: 0,
  ...over,
});

describe('streak helpers', () => {
  it('longestWinStreak returns 0 for empty input', () => {
    expect(longestWinStreak([])).toBe(0);
  });

  it('longestWinStreak counts consecutive non-loss outcomes', () => {
    const h = (o: HandRow['outcome']) => makeHand({ outcome: o });
    expect(longestWinStreak([h('win'), h('win'), h('loss'), h('win')])).toBe(2);
    expect(longestWinStreak([h('win'), h('win'), h('win'), h('loss')])).toBe(3);
    expect(longestWinStreak([h('win'), h('blackjack'), h('win')])).toBe(3);
    expect(longestWinStreak([h('win'), h('push'), h('win')])).toBe(2); // push is not a win
  });

  it('hadWinAfter3LossStreak is true iff any win follows 3 consecutive losses', () => {
    const h = (o: HandRow['outcome']) => makeHand({ outcome: o });
    expect(hadWinAfter3LossStreak([h('loss'), h('loss'), h('loss'), h('win')])).toBe(true);
    expect(hadWinAfter3LossStreak([h('loss'), h('loss'), h('win')])).toBe(false);
    expect(hadWinAfter3LossStreak([h('loss'), h('loss'), h('loss'), h('loss'), h('win')])).toBe(true);
  });
});

describe('ACHIEVEMENTS registry', () => {
  it('exposes 6 achievements with id, name, description, icon, predicate', () => {
    expect(ACHIEVEMENTS).toHaveLength(6);
    for (const a of ACHIEVEMENTS) {
      expect(a.id).toMatch(/^[a-z-]+$/);
      expect(typeof a.name).toBe('string');
      expect(typeof a.description).toBe('string');
      expect(typeof a.icon).toBe('string');
      expect(typeof a.predicate).toBe('function');
    }
  });

  it('first-blackjack is earned iff stats.blackjacks >= 1', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'first-blackjack')!;
    expect(evaluateAchievement(a, makeStats({ blackjacks: 0 }), []).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats({ blackjacks: 1 }), []).earned).toBe(true);
  });

  it('ten-wins is earned iff stats.wins >= 10', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'ten-wins')!;
    expect(evaluateAchievement(a, makeStats({ wins: 9 }), []).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats({ wins: 10 }), []).earned).toBe(true);
  });

  it('big-bet is earned iff any hand has bet_amount >= 500', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'big-bet')!;
    expect(evaluateAchievement(a, makeStats(), [makeHand({ bet_amount: 250 })]).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats(), [makeHand({ bet_amount: 500 })]).earned).toBe(true);
  });

  it('doubled-down is earned iff any hand has is_doubled = 1', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'doubled-down')!;
    expect(evaluateAchievement(a, makeStats(), [makeHand({ is_doubled: 0 })]).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats(), [makeHand({ is_doubled: 1 })]).earned).toBe(true);
  });

  it('on-a-heater (5-win streak) uses the helper', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'on-a-heater')!;
    const h = (o: HandRow['outcome']) => makeHand({ outcome: o });
    expect(evaluateAchievement(a, makeStats(), [h('win'), h('win'), h('win'), h('win')]).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats(), [h('win'), h('win'), h('win'), h('win'), h('win')]).earned).toBe(true);
  });

  it('comeback-kid is earned iff hadWinAfter3LossStreak', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'comeback-kid')!;
    const h = (o: HandRow['outcome']) => makeHand({ outcome: o });
    expect(evaluateAchievement(a, makeStats(), [h('loss'), h('loss'), h('win')]).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats(), [h('loss'), h('loss'), h('loss'), h('win')]).earned).toBe(true);
  });

  it('earnedAt is the created_at of the relevant hand, or null', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'first-blackjack')!;
    const r = evaluateAchievement(a, makeStats({ blackjacks: 1 }), [
      makeHand({ outcome: 'blackjack', created_at: 1234 }),
    ]);
    expect(r.earnedAt).toBe(1234);
    const r2 = evaluateAchievement(a, makeStats({ blackjacks: 0 }), []);
    expect(r2.earnedAt).toBeNull();
  });
});
import { computePayout } from '../src/game/payout';
import { Config } from '../src/config';
import type { Card } from '../src/shared/types';

const c = (rank: Card['rank']): Card => ({ suit: '♠', rank });

describe('computePayout', () => {
  it('player busts → lose', () => {
    expect(computePayout({ playerCards: [c('K'), c('Q'), c('5')], dealerCards: [c('7'), c('8')], bet: 100 }))
      .toEqual({ delta: -100, reason: 'lose' });
  });

  it('player natural BJ, dealer not BJ → blackjack (3:2)', () => {
    const delta = (Config.BLACKJACK_PAYOUT_NUMERATOR / Config.BLACKJACK_PAYOUT_DENOMINATOR) * 100;
    expect(computePayout({ playerCards: [c('A'), c('K')], dealerCards: [c('7'), c('8')], bet: 100 }))
      .toEqual({ delta, reason: 'blackjack' });
  });

  it('player natural BJ, dealer also BJ → push', () => {
    expect(computePayout({ playerCards: [c('A'), c('K')], dealerCards: [c('A'), c('K')], bet: 100 }))
      .toEqual({ delta: 0, reason: 'push' });
  });

  it('player 20, dealer 19 → win 1:1', () => {
    expect(computePayout({ playerCards: [c('K'), c('Q')], dealerCards: [c('K'), c('9')], bet: 100 }))
      .toEqual({ delta: 100, reason: 'win' });
  });

  it('player 19, dealer 20 → lose', () => {
    expect(computePayout({ playerCards: [c('K'), c('9')], dealerCards: [c('K'), c('Q')], bet: 100 }))
      .toEqual({ delta: -100, reason: 'lose' });
  });

  it('player 20, dealer 20 → push', () => {
    expect(computePayout({ playerCards: [c('K'), c('Q')], dealerCards: [c('K'), c('Q')], bet: 100 }))
      .toEqual({ delta: 0, reason: 'push' });
  });

  it('player 19, dealer bust → win', () => {
    expect(computePayout({ playerCards: [c('K'), c('9')], dealerCards: [c('K'), c('Q'), c('5')], bet: 100 }))
      .toEqual({ delta: 100, reason: 'win' });
  });

  it('player 3-card 21, dealer natural BJ → lose (3-card 21 is not a natural)', () => {
    expect(computePayout({ playerCards: [c('7'), c('7'), c('7')], dealerCards: [c('A'), c('K')], bet: 100 }))
      .toEqual({ delta: -100, reason: 'lose' });
  });
});

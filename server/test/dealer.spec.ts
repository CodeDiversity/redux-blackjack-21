import { dealerShouldHit, hasPeekableUpcard, dealerHoleCardShouldBeHidden } from '../src/game/dealer';
import { Config } from '../src/config';
import type { Card, CardSlot } from '../src/shared/types';

const c = (rank: Card['rank']): Card => ({ suit: '♠', rank });

describe('dealerShouldHit (S17)', () => {
  it('hits on hard 16', () => {
    expect(dealerShouldHit([c('10'), c('6')])).toBe(true);
  });
  it('stands on hard 17', () => {
    expect(dealerShouldHit([c('10'), c('7')])).toBe(false);
  });
  it('stands on soft 17 when S17 is configured', () => {
    expect(Config.DEALER_STANDS_ON_SOFT_17).toBe(true);
    expect(dealerShouldHit([c('A'), c('6')])).toBe(false);
  });
  it('hits on soft 16', () => {
    expect(dealerShouldHit([c('A'), c('5')])).toBe(true);
  });
});

describe('hasPeekableUpcard', () => {
  it('is true for A upcard', () => {
    expect(hasPeekableUpcard([c('A'), { hidden: true }])).toBe(true);
  });
  it('is true for 10-value upcard', () => {
    expect(hasPeekableUpcard([c('10'), { hidden: true }])).toBe(true);
    expect(hasPeekableUpcard([c('J'), { hidden: true }])).toBe(true);
  });
  it('is false for other upcards', () => {
    expect(hasPeekableUpcard([c('7'), { hidden: true }])).toBe(false);
  });
});

describe('dealerHoleCardShouldBeHidden', () => {
  it('is true during player_turn', () => {
    expect(dealerHoleCardShouldBeHidden('player_turn')).toBe(true);
  });
  it('is false during dealer_turn', () => {
    expect(dealerHoleCardShouldBeHidden('dealer_turn')).toBe(false);
  });
  it('is true during betting', () => {
    expect(dealerHoleCardShouldBeHidden('betting')).toBe(true);
  });
});

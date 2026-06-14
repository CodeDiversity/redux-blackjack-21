import { handTotal, isBusted, isNaturalBlackjack } from '../src/game/hand';
import type { Card } from '../src/shared/types';

const c = (rank: Card['rank']): Card => ({ suit: '♠', rank });

describe('handTotal', () => {
  it('totals numeric cards at face value', () => {
    expect(handTotal([c('5'), c('7')])).toBe(12);
  });

  it('values J/Q/K as 10', () => {
    expect(handTotal([c('J'), c('Q')])).toBe(20);
  });

  it('counts an Ace as 11 when it does not bust', () => {
    expect(handTotal([c('A'), c('6')])).toBe(17);
  });

  it('counts an Ace as 1 when 11 would bust', () => {
    expect(handTotal([c('A'), c('K'), c('5')])).toBe(16);
  });

  it('handles multiple aces correctly', () => {
    expect(handTotal([c('A'), c('A'), c('9')])).toBe(21);
    expect(handTotal([c('A'), c('A'), c('A')])).toBe(13);
  });
});

describe('isBusted', () => {
  it('is true for totals over 21', () => {
    expect(isBusted([c('K'), c('Q'), c('5')])).toBe(true);
  });

  it('is false at exactly 21', () => {
    expect(isBusted([c('K'), c('A')])).toBe(false);
  });

  it('is false below 21', () => {
    expect(isBusted([c('7'), c('8')])).toBe(false);
  });
});

describe('isNaturalBlackjack', () => {
  it('is true for A + K (or any 10-value) on 2 cards', () => {
    expect(isNaturalBlackjack([c('A'), c('K')])).toBe(true);
    expect(isNaturalBlackjack([c('A'), c('10')])).toBe(true);
  });

  it('is false for any 3+ card 21', () => {
    expect(isNaturalBlackjack([c('7'), c('7'), c('7')])).toBe(false);
    expect(isNaturalBlackjack([c('A'), c('5'), c('5')])).toBe(false);
  });

  it('is false for 2 cards that do not total 21', () => {
    expect(isNaturalBlackjack([c('K'), c('9')])).toBe(false);
  });
});

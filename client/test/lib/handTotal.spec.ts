import { describe, it, expect } from 'vitest';
import { handTotal } from '../../src/lib/handTotal';
import type { Hand } from '../../src/shared/types';

function hand(cards: Hand['cards'], overrides: Partial<Hand> = {}): Hand {
  return {
    cards,
    bet: 0,
    stood: false,
    busted: false,
    isBlackjack: false,
    doubled: false,
    ...overrides,
  };
}

describe('handTotal', () => {
  it('returns 0 for an empty hand', () => {
    expect(handTotal(hand([]))).toEqual({
      total: 0, soft: false, hasHidden: false, isBlackjack: false, isBust: false,
    });
  });

  it('computes a hard 17 (K + 7)', () => {
    const h = hand([{ suit: '♠', rank: 'K' }, { suit: '♥', rank: '7' }]);
    expect(handTotal(h)).toEqual({
      total: 17, soft: false, hasHidden: false, isBlackjack: false, isBust: false,
    });
  });

  it('computes a soft 17 (A + 6)', () => {
    const h = hand([{ suit: '♠', rank: 'A' }, { suit: '♥', rank: '6' }]);
    const t = handTotal(h);
    expect(t.total).toBe(17);
    expect(t.soft).toBe(true);
  });

  it('demotes an ace from 11 to 1 when the hand would bust (A + A + 6 = 18)', () => {
    const h = hand([
      { suit: '♠', rank: 'A' },
      { suit: '♥', rank: 'A' },
      { suit: '♦', rank: '6' },
    ]);
    const t = handTotal(h);
    expect(t.total).toBe(18);
    expect(t.soft).toBe(true);
  });

  it('reports a bust (K + Q + 5 = 25)', () => {
    const h = hand(
      [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: 'Q' }, { suit: '♦', rank: '5' }],
      { busted: true },
    );
    const t = handTotal(h);
    expect(t.total).toBe(25);
    expect(t.isBust).toBe(true);
  });

  it('ignores a single hidden card in the dealer hand', () => {
    const h = hand([{ hidden: true }, { suit: '♠', rank: '7' }]);
    const t = handTotal(h);
    expect(t.total).toBe(7);
    expect(t.hasHidden).toBe(true);
  });

  it('reports hasHidden when every card is hidden', () => {
    const h = hand([{ hidden: true }, { hidden: true }]);
    expect(handTotal(h)).toEqual({
      total: 0, soft: false, hasHidden: true, isBlackjack: false, isBust: false,
    });
  });

  it('flags a blackjack (A + K with hand.isBlackjack === true)', () => {
    const h = hand(
      [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: 'K' }],
      { isBlackjack: true },
    );
    const t = handTotal(h);
    expect(t.total).toBe(21);
    expect(t.isBlackjack).toBe(true);
  });
});

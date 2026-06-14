import type { Card, CardSlot, Hand } from '../shared/types';

export type HandTotal = {
  total: number;
  soft: boolean;
  hasHidden: boolean;
  isBlackjack: boolean;
  isBust: boolean;
};

export function handTotal(hand: Hand): HandTotal {
  const hasHidden = hand.cards.some(isHidden);
  const visible = hand.cards.filter(isVisible);
  const total = bestTotal(visible);
  return {
    total,
    soft: isSoft(visible, total),
    hasHidden,
    isBlackjack: hand.isBlackjack,
    isBust: hand.busted,
  };
}

function isHidden(c: CardSlot): c is { hidden: true } {
  return 'hidden' in c;
}
function isVisible(c: CardSlot): c is Card {
  return !('hidden' in c);
}

function cardPoints(c: Card): number {
  if (c.rank === 'A') return 11;
  if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') return 10;
  return parseInt(c.rank, 10);
}

function bestTotal(cards: Card[]): number {
  let total = cards.reduce((sum, c) => sum + cardPoints(c), 0);
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isSoft(cards: Card[], best: number): boolean {
  if (!cards.some((c) => c.rank === 'A')) return false;
  const hard = cards.reduce(
    (sum, c) => sum + (c.rank === 'A' ? 1 : cardPoints(c)),
    0,
  );
  return best !== hard;
}

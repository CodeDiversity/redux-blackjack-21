import type { Card, CardSlot } from '../shared/types';

const RANK_VALUE: Record<Card['rank'], number> = {
  A: 11,
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 10, Q: 10, K: 10,
};

export function handTotal(cards: CardSlot[]): number {
  const realCards = cards.filter((c): c is Card => !('hidden' in c));
  let total = 0;
  let aces = 0;
  for (const card of realCards) {
    if (card.rank === 'A') { aces++; total += 11; }
    else { total += RANK_VALUE[card.rank]; }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function isBusted(cards: CardSlot[]): boolean {
  return handTotal(cards) > 21;
}

export function isNaturalBlackjack(cards: CardSlot[]): boolean {
  if (cards.length !== 2) return false;
  const realCards = cards.filter((c): c is Card => !('hidden' in c));
  return handTotal(realCards) === 21;
}

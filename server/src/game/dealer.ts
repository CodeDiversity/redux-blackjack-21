import { Config } from '../config';
import { handTotal } from './hand';
import type { Card, CardSlot, Phase } from '../shared/types';

export function dealerShouldHit(cards: CardSlot[]): boolean {
  const total = handTotal(cards);
  if (total < 17) return true;
  if (total > 17) return false;
  // total === 17
  const realCards = cards.filter((c): c is Card => !('hidden' in c));
  const hasAce = realCards.some((card) => card.rank === 'A');
  return hasAce && !Config.DEALER_STANDS_ON_SOFT_17;
}

export function hasPeekableUpcard(dealerCards: CardSlot[]): boolean {
  const first = dealerCards[0];
  if (!first || 'hidden' in first) return false;
  return first.rank === 'A' || ['10', 'J', 'Q', 'K'].includes(first.rank);
}

export function dealerHoleCardShouldBeHidden(phase: Phase): boolean {
  return phase !== 'dealer_turn';
}

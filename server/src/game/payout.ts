import { Config } from '../config';
import { handTotal, isBusted, isNaturalBlackjack } from './hand';
import type { CardSlot } from '../shared/types';

export type PayoutResult = { delta: number; reason: 'win' | 'lose' | 'push' | 'blackjack' };

export function computePayout(args: {
  playerCards: CardSlot[];
  dealerCards: CardSlot[];
  bet: number;
}): PayoutResult {
  const { playerCards, dealerCards, bet } = args;
  const playerTotal = handTotal(playerCards);
  const dealerTotal = handTotal(dealerCards);
  const playerBj = isNaturalBlackjack(playerCards);
  const dealerBj = isNaturalBlackjack(dealerCards);
  const playerBust = isBusted(playerCards);
  const dealerBust = isBusted(dealerCards);

  if (playerBust) return { delta: -bet, reason: 'lose' };
  if (playerBj && dealerBj) return { delta: 0, reason: 'push' };
  if (playerBj && !dealerBj) {
    const delta = (Config.BLACKJACK_PAYOUT_NUMERATOR / Config.BLACKJACK_PAYOUT_DENOMINATOR) * bet;
    return { delta, reason: 'blackjack' };
  }
  if (dealerBj) return { delta: -bet, reason: 'lose' };
  if (dealerBust) return { delta: bet, reason: 'win' };
  if (playerTotal > dealerTotal) return { delta: bet, reason: 'win' };
  if (playerTotal < dealerTotal) return { delta: -bet, reason: 'lose' };
  return { delta: 0, reason: 'push' };
}

import { createSelector } from 'reselect';
import { selectGameState, selectSelfSeatId, selectMySeat } from './self';
import type { Card, Hand } from '../shared/types';

const MIN_BET = 10;
const MAX_BET = 500;
const STARTING_BANKROLL = 1000;

export type AvailableActions = { canHit: boolean; canStand: boolean; canDouble: boolean; canSplit: boolean };

export const makeSelectAvailableActions = (handIndex: number) =>
  createSelector(
    [selectGameState, selectSelfSeatId, selectMySeat],
    (state, _selfId, me): AvailableActions => {
      if (!state || !me) return { canHit: false, canStand: false, canDouble: false, canSplit: false };
      const hand: Hand | undefined = me.hands[handIndex];
      if (!hand) return { canHit: false, canStand: false, canDouble: false, canSplit: false };
      if (hand.stood || hand.busted || hand.doubled || hand.cards.length === 0) {
        return { canHit: false, canStand: false, canDouble: false, canSplit: false };
      }
      const canHit = hand.cards.length < 5 && !isBustedTotal(hand);
      const canStand = true;
      const canDouble = hand.cards.length === 2 && me.bankroll >= hand.bet;
      const realCards = hand.cards.filter((c): c is Card => !('hidden' in c));
      const canSplit =
        hand.cards.length === 2 &&
        realCards.length === 2 &&
        realCards[0].rank === realCards[1].rank &&
        me.hands.length === 1 &&
        me.bankroll >= hand.bet;
      return { canHit, canStand, canDouble, canSplit };
    },
  );

function isBustedTotal(hand: Hand): boolean {
  let total = 0;
  let aces = 0;
  for (const c of hand.cards) {
    if ('hidden' in c) continue;
    if (c.rank === 'A') { aces++; total += 11; }
    else if (['10', 'J', 'Q', 'K'].includes(c.rank)) total += 10;
    else total += Number(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total > 21;
}

// suppress unused-warning on the local constants (kept for parity if referenced later)
void MIN_BET; void MAX_BET; void STARTING_BANKROLL;

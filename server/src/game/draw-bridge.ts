import type { Card, CardSlot, GameState } from '../shared/types';
import type { Action } from './state-machine';
import { GameError } from './state-machine';
import { dealerShouldHit } from './dealer';

export type PreparedEvent = { type: string; [k: string]: unknown };

export function prepareEvent(state: GameState, action: Action, draw?: () => Card): PreparedEvent {
  if (!draw) throw new GameError('DRAW_REQUIRED');

  switch (action.type) {
    case 'bet:place':
    case 'hand:stand':
    case 'round:ready':
      return { ...action };

    case 'hand:hit':
    case 'hand:double':
      return { ...action, card: draw() };

    case 'hand:split':
      return { ...action, leftCard: draw(), rightCard: draw() };

    case 'round:betDeadline': {
      // Same shape as round:start: pre-draw 2 cards per betting player + 1 dealer upcard.
      const dealtCards: { playerIndex: number; cards: [Card, Card] }[] = [];
      state.players.forEach((p, i) => {
        if (p.status === 'empty' || p.status === 'sitting_out') return;
        if (p.hands[0]?.bet === 0) return;  // unbetter; will be sat out
        dealtCards.push({ playerIndex: i, cards: [draw(), draw()] });
      });
      return { ...action, dealtCards, dealerUpcard: draw() };
    }

    default:
      throw new Error(`not implemented: ${(action as Action).type}`);
  }
}

export function computeDealerEvent(state: GameState, draw: () => Card): PreparedEvent {
  const finalHand: CardSlot[] = state.dealer.cards.map((c) => ('hidden' in c ? draw() : c));
  while (dealerShouldHit(finalHand)) {
    finalHand.push(draw());
  }
  return { type: 'round:dealerPlay', dealerFinalHand: finalHand };
}

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
    case 'round:advance':
      return { ...action };

    case 'hand:hit':
    case 'hand:double':
      return { ...action, card: draw() };

    case 'hand:split':
      return { ...action, leftCard: draw(), rightCard: draw() };

    case 'round:start': {
      const dealtCards: { playerIndex: number; cards: [Card, Card] }[] = [];
      state.players.forEach((p, i) => {
        if (p.hands[0]?.bet && p.hands[0].bet > 0) {
          dealtCards.push({ playerIndex: i, cards: [draw(), draw()] });
        }
      });
      return { ...action, dealtCards, dealerUpcard: draw() };
    }

    default:
      throw new Error(`not implemented: ${(action as Action).type}`);
  }
}

export function computeDealerEvent(state: GameState, draw: () => Card): PreparedEvent {
  throw new Error('not implemented');
}

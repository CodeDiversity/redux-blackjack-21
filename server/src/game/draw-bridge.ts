import type { Card, CardSlot, GameState } from '../shared/types';
import type { Action } from './state-machine';
import { dealerShouldHit } from './dealer';

export type PreparedEvent = { type: string; [k: string]: unknown };

export function prepareEvent(state: GameState, action: Action, draw?: () => Card): PreparedEvent {
  throw new Error('not implemented');
}

export function computeDealerEvent(state: GameState, draw: () => Card): PreparedEvent {
  throw new Error('not implemented');
}

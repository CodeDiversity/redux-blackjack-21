import type { Card, CardSlot, GameState } from '../shared/types';
import type { Action } from './state-machine';
import { dealerShouldHit } from './dealer';

export type PreparedEvent = { type: string; [k: string]: unknown };

export function prepareEvent(state: GameState, action: Action, draw?: () => Card): PreparedEvent {
  // No-card actions: pass through unchanged.
  const noCardActions: Action['type'][] = ['bet:place', 'hand:stand', 'round:ready', 'round:advance'];
  if (noCardActions.includes(action.type)) {
    return { ...action };
  }

  throw new Error(`not implemented: ${action.type}`);
}

export function computeDealerEvent(state: GameState, draw: () => Card): PreparedEvent {
  throw new Error('not implemented');
}

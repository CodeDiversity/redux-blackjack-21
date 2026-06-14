// Placeholder stub. The XState machine will be built in subsequent steps.
import {
  applyAction as legacyApply,
  createInitialState as legacyCreate,
  Action as LegacyAction,
  GameError as LegacyGameError,
} from './state-machine.legacy';
import type { Card, GameState } from '../shared/types';

export type Action = LegacyAction;
export class GameError extends LegacyGameError {}
export const createInitialState = legacyCreate;
export const applyAction = legacyApply as (state: GameState, action: Action, draw?: () => Card) => GameState;

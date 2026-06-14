import { createSelector } from 'reselect';
import type { RootState } from '../store';

export const selectSelfSeatId = (s: RootState) => s.connection.selfSeatId;
export const selectGameState = (s: RootState) => s.game.state;

export const selectMySeat = createSelector(
  [selectGameState, selectSelfSeatId],
  (state, selfId) => (state && selfId ? state.players.find((p) => p.id === selfId) ?? null : null),
);

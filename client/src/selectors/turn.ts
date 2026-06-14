import { createSelector } from 'reselect';
import { selectGameState, selectSelfSeatId } from './self';

export const selectIsMyTurn = createSelector(
  [selectGameState, selectSelfSeatId],
  (state, selfId) => {
    if (!state || !selfId) return false;
    if (state.phase !== 'player_turn') return false;
    if (state.activeSeat === null) return false;
    const me = state.players[state.activeSeat];
    return !!me && me.id === selfId && me.status === 'acting';
  },
);

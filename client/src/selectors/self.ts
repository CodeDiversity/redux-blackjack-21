import { createSelector } from 'reselect';
import type { RootState } from '../store';

export const selectSelfSeatId = (s: RootState) => s.connection.selfSeatId;
export const selectGameState = (s: RootState) => s.game.state;
export const selectHostId = (s: RootState) => s.lobby.hostId;

export const selectAmIHost = createSelector(
  [selectSelfSeatId, selectHostId],
  (selfId, hostId) => !!selfId && hostId === selfId,
);

export const selectMySeat = createSelector(
  [selectGameState, selectSelfSeatId],
  (state, selfId) => (state && selfId ? state.players.find((p) => p.id === selfId) ?? null : null),
);

export const selectMyLastBet = createSelector(
  [selectMySeat],
  (me) => me?.lastBet ?? 0,
);

export const selectCanRebet = createSelector(
  [selectMySeat],
  (me) => !!me && me.lastBet > 0 && me.lastBet <= me.bankroll && me.status === 'betting',
);

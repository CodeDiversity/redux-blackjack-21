import type { RootState } from '../store';

/**
 * Returns the full lobby-seat array. Prefers the game's authoritative
 * `state.players` (which includes `status: 'empty'` placeholders) and
 * falls back to the lobby-slice projection while the first 'state:update'
 * is still in flight.
 */
export const selectLobbySeats = (s: RootState) => {
  const state = s.game.state;
  if (state) return state.players;
  return s.lobby.players;
};

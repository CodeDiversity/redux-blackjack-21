import { describe, it, expect } from 'vitest';
import { selectLobbySeats } from '../../src/selectors/lobby';
import type { RootState } from '../../src/store';
import type { GameState, PlayerSeat } from '../../src/shared/types';
import type { LobbyPlayer } from '../../src/store/lobby.slice';

function seat(id: string, status: PlayerSeat['status'] = 'sitting_out'): PlayerSeat {
  return {
    id,
    name: id,
    bankroll: 0,
    hands: [],
    status,
    connectedAt: 0,
    lastBet: 0,
  };
}

function lobbyPlayer(id: string): LobbyPlayer {
  return { id, name: id, ready: true, connectedAt: 0 };
}

function stateWith(opts: { game: GameState | null; lobbyPlayers: LobbyPlayer[] }): RootState {
  return {
    game: { state: opts.game, lastResult: null },
    connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
    lobby: { roomId: 'R', hostId: 's0', players: opts.lobbyPlayers },
    ui: { betInputValue: 0, toasts: [] },
  } as unknown as RootState;
}

describe('selectLobbySeats', () => {
  it('returns state.game.state.players (the full SEAT_COUNT array) when game state exists', () => {
    const players = [seat('s0', 'betting'), seat('s1', 'empty')];
    const root = stateWith({
      game: {
        roomId: 'R', phase: 'lobby', shoeSize: 200, cutCardIndex: 50,
        players, dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
        activeSeat: null, roundNumber: 0, lastResult: null,
      },
      lobbyPlayers: [lobbyPlayer('s0')],
    });
    expect(selectLobbySeats(root)).toHaveLength(2);
    const seats = selectLobbySeats(root) as PlayerSeat[];
    expect(seats[1].status).toBe('empty');
  });

  it('falls back to state.lobby.players when game state is null (pre-snapshot)', () => {
    const root = stateWith({ game: null, lobbyPlayers: [lobbyPlayer('s0'), lobbyPlayer('s1')] });
    expect(selectLobbySeats(root)).toHaveLength(2);
  });

  it('returns an empty array when neither game state nor lobby players exist', () => {
    const root = stateWith({ game: null, lobbyPlayers: [] });
    expect(selectLobbySeats(root)).toEqual([]);
  });
});

import { gameReducer, gameStateReceived, roundResultReceived, gameCleared } from '../../src/store/game.slice';
import type { GameState, RoundResult } from '../../src/shared/types';

const baseState: GameState = {
  roomId: 'R1', phase: 'betting', shoeSize: 200, cutCardIndex: 50,
  players: [], dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
  activeSeat: null, roundNumber: 1, lastResult: null,
};

describe('game slice', () => {
  it('replaces state on gameStateReceived', () => {
    const next = gameReducer(undefined, gameStateReceived({ ...baseState, phase: 'player_turn' }));
    expect(next.state?.phase).toBe('player_turn');
  });

  it('records lastResult on roundResultReceived', () => {
    const result: RoundResult = { payouts: [{ seatId: 's1', delta: 100, reason: 'win' }] };
    const next = gameReducer(undefined, roundResultReceived(result));
    expect(next.lastResult).toEqual(result);
  });

  it('clears on gameCleared', () => {
    const after = gameReducer(undefined, gameStateReceived(baseState));
    const cleared = gameReducer(after, gameCleared());
    expect(cleared.state).toBeNull();
  });
});

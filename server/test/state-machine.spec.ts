import { createInitialState, applyAction } from '../src/game/state-machine';
import { Config } from '../src/config';
import type { Card, GameState } from '../src/shared/types';

const newRoom = (): GameState => ({ ...createInitialState('ROOM1', Config.SEAT_COUNT, 1), phase: 'betting' });

describe('applyAction: bet:place', () => {
  it('places a bet when in betting phase and amount is valid', () => {
    const state = newRoom();
    const seatId = state.players[0].id;
    const next = applyAction(state, { type: 'bet:place', seatId, amount: 100 });
    expect(next.players[0].hands[0].bet).toBe(100);
  });

  it('rejects bets below MIN_BET', () => {
    const state = newRoom();
    const seatId = state.players[0].id;
    expect(() => applyAction(state, { type: 'bet:place', seatId, amount: 1 })).toThrow('BET_OUT_OF_RANGE');
  });

  it('rejects bets above MAX_BET', () => {
    const state = newRoom();
    const seatId = state.players[0].id;
    expect(() => applyAction(state, { type: 'bet:place', seatId, amount: 9999 })).toThrow('BET_OUT_OF_RANGE');
  });

  it('rejects bets above bankroll', () => {
    let state = newRoom();
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, bankroll: 50 } : p) };
    const seatId = state.players[0].id;
    expect(() => applyAction(state, { type: 'bet:place', seatId, amount: 200 })).toThrow('INSUFFICIENT_FUNDS');
  });

  it('rejects bets in non-betting phase', () => {
    const state: GameState = { ...newRoom(), phase: 'player_turn' };
    const seatId = state.players[0].id;
    expect(() => applyAction(state, { type: 'bet:place', seatId, amount: 100 })).toThrow('INVALID_PHASE');
  });
});

describe('applyAction: hand:hit', () => {
  it('adds a card to the active hand', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting', hands: [{ ...p.hands[0], cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }] } : p) };
    const deck: Card[] = [
      { suit: '♦', rank: '7' },                              // hit card
    ];
    let i = 0;
    const draw = () => deck[i++];
    const next = applyAction(state, { type: 'hand:hit', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(next.players[0].hands[0].cards.length).toBe(3);
  });
});

describe('applyAction: hand:stand', () => {
  it('marks the hand stood and advances the turn', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = {
      ...state,
      players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting', hands: [{ ...p.hands[0], cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }] } : p),
      dealer: { ...state.dealer, cards: [{ suit: '♠', rank: '10' }, { hidden: true }] },
    };
    // Need deck: dealer hole card reveal + maybe more
    const deck: Card[] = [
      { suit: '♣', rank: 'K' },                              // dealer hole reveal (total 20, stands)
    ];
    let i = 0;
    const draw = () => deck[i++];
    const next = applyAction(state, { type: 'hand:stand', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(next.players[0].hands[0].stood).toBe(true);
  });
});

describe('applyAction: hand:double', () => {
  it('doubles the bet, draws one card, and locks the hand', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    // Two acting players so the turn advances to player 1 after player 0
    // doubles (no auto-transition to dealer_turn). Keeps the test focused
    // on the hand:double mechanics rather than the dealer/settle flow.
    state = {
      ...state,
      players: state.players.map((p, i) => i === 0
        ? { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 100, cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }] }
        : i === 1
        ? { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 100, cards: [{ suit: '♠', rank: '7' }, { suit: '♥', rank: '8' }] }] }
        : p),
    };
    const deck: Card[] = [
      { suit: '♦', rank: '3' },                              // double card
    ];
    let i = 0;
    const draw = () => deck[i++];
    const next = applyAction(state, { type: 'hand:double', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(next.players[0].hands[0].bet).toBe(200);
    expect(next.players[0].hands[0].doubled).toBe(true);
    expect(next.players[0].hands[0].cards.length).toBe(3);
    expect(next.players[0].bankroll).toBe(900);
  });
});

describe('applyAction: hand:split', () => {
  it('splits a same-rank pair into two hands with one card each, deducts bet', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 100, cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }] }] } : p) };
    // Need deck: 2 cards for split, then dealer cards
    const deck: Card[] = [
      { suit: '♣', rank: '2' }, { suit: '♦', rank: '9' },    // split cards
      { suit: '♣', rank: 'K' }, { suit: '♣', rank: 'K' },    // dealer cards
    ];
    let i = 0;
    const draw = () => deck[i++];
    const next = applyAction(state, { type: 'hand:split', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(next.players[0].hands.length).toBe(2);
    expect(next.players[0].hands[0].cards.length).toBe(2);
    expect(next.players[0].hands[1].cards.length).toBe(2);
    expect(next.players[0].bankroll).toBe(900);
  });

  it('rejects split when ranks differ', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting', hands: [{ ...p.hands[0], cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '9' }] }] } : p) };
    const deck: Card[] = [];
    let i = 0;
    const draw = () => deck[i++];
    expect(() => applyAction(state, { type: 'hand:split', seatId: state.players[0].id, handIndex: 0 }, draw)).toThrow('CANNOT_SPLIT');
  });
});

describe('applyAction: round:ready', () => {
  it('transitions lobby → betting, clears lastResult, clears activeSeat', () => {
    const state: GameState = { ...createInitialState('ROOM1', 2, 0), phase: 'lobby', lastResult: { payouts: [] } };
    const next = applyAction(state, { type: 'round:ready', seatId: state.players[0].id });
    expect(next.phase).toBe('betting');
    expect(next.activeSeat).toBeNull();
    expect(next.lastResult).toBeNull();
  });

  it('transitions settled → betting so the next round can begin', () => {
    const state: GameState = {
      ...createInitialState('ROOM1', 2, 1),
      phase: 'settled',
      lastResult: { payouts: [{ seatId: 'x', delta: 50, reason: 'win' }] },
    };
    const next = applyAction(state, { type: 'round:ready', seatId: state.players[0].id });
    expect(next.phase).toBe('betting');
    expect(next.lastResult).toBeNull();
  });

  it('rejects ready outside lobby/settled (e.g. while a round is in flight)', () => {
    const state: GameState = { ...createInitialState('ROOM1', 2, 1), phase: 'player_turn' };
    expect(() => applyAction(state, { type: 'round:ready', seatId: state.players[0].id })).toThrow('INVALID_PHASE');
  });
});

describe('settle: lastBet population', () => {
  it('records the bet of every resolved hand into the seat lastBet', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = {
      ...state,
      players: state.players.map((p, i) => i === 0
        ? { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 75, cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }] }
        : { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 200, cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: 'A' }] }] }),
      dealer: { ...state.dealer, cards: [{ suit: '♣', rank: 'K' }, { suit: '♦', rank: '5' }] },
    };
    // Drive to settled by standing every acting player.
    const deck: Card[] = [
      { suit: '♣', rank: '5' },                              // dealer hole reveal / dealer event draw
      { suit: '♣', rank: '9' },                              // spare
    ];
    let i = 0;
    const draw = () => deck[i++];
    let next = state;
    for (const player of state.players) {
      if (player.status === 'acting') {
        next = applyAction(next, { type: 'hand:stand', seatId: player.id, handIndex: 0 }, draw);
      }
    }
    expect(next.phase).toBe('settled');
    expect(next.players[0].lastBet).toBe(75);
    expect(next.players[1].lastBet).toBe(200);
  });
});

describe('hasAtLeastOneBet guard', () => {
  it('returns true when at least one seated player has hands[0].bet > 0', () => {
    const state: GameState = {
      ...newRoom(),
      players: [
        { id: 'p0', name: 'A', bankroll: 1000, hands: [{ cards: [], bet: 100, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'betting', connectedAt: 0, lastBet: 0, activeHandIndex: 0 },
        { id: 'p1', name: 'B', bankroll: 1000, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'betting', connectedAt: 0, lastBet: 0, activeHandIndex: 0 },
      ],
    };
    // Import the guard from the state machine's internal array.
    const { guards } = require('../src/game/state-machine');
    const guard = guards.find((g: any) => g.name === 'hasAtLeastOneBet')!;
    expect(guard).toBeTruthy();
    expect(guard.predicate(state, { type: 'bet:place', seatId: 'p0', amount: 100 })).toBe(true);
  });

  it('returns false when no seated player has bet', () => {
    const state = newRoom();  // all seats are empty in newRoom; that's "no seated player" → false
    const { guards } = require('../src/game/state-machine');
    const guard = guards.find((g: any) => g.name === 'hasAtLeastOneBet')!;
    expect(guard.predicate(state, { type: 'bet:place', seatId: 'p0', amount: 100 })).toBe(false);
  });

  it('returns false when all seated players have bet === 0', () => {
    const state: GameState = {
      ...newRoom(),
      players: [
        { id: 'p0', name: 'A', bankroll: 1000, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'betting', connectedAt: 0, lastBet: 0, activeHandIndex: 0 },
        { id: 'p1', name: 'B', bankroll: 1000, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'betting', connectedAt: 0, lastBet: 0, activeHandIndex: 0 },
      ],
    };
    const { guards } = require('../src/game/state-machine');
    const guard = guards.find((g: any) => g.name === 'hasAtLeastOneBet')!;
    expect(guard.predicate(state, { type: 'bet:place', seatId: 'p0', amount: 100 })).toBe(false);
  });

  it('ignores empty and sitting_out seats', () => {
    const state: GameState = {
      ...newRoom(),
      players: [
        { id: 'p0', name: 'A', bankroll: 1000, hands: [{ cards: [], bet: 100, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'betting', connectedAt: 0, lastBet: 0, activeHandIndex: 0 },
        { id: 'p1', name: 'B', bankroll: 1000, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'sitting_out', connectedAt: 0, lastBet: 0, activeHandIndex: 0 },
        { id: 'p2', name: 'C', bankroll: 1000, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'empty', connectedAt: 0, lastBet: 0, activeHandIndex: 0 },
      ],
    };
    const { guards } = require('../src/game/state-machine');
    const guard = guards.find((g: any) => g.name === 'hasAtLeastOneBet')!;
    expect(guard.predicate(state, { type: 'bet:place', seatId: 'p0', amount: 100 })).toBe(true);
  });
});

describe('applyAction: round:betDeadline (with bets)', () => {
  it('transitions betting → dealing and deals cards to bettors when at least 1 player has bet', () => {
    let state = newRoom();
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, name: 'Alice', status: 'betting', hands: [{ cards: [], bet: 100, stood: false, busted: false, isBlackjack: false, doubled: false }] }
          : i === 1
          ? { ...p, name: 'Bob', status: 'betting', hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }] }
          : p,
      ),
    };
    const deck: Card[] = [
      { suit: '♠', rank: '5' },  // Alice card 1
      { suit: '♥', rank: '6' },  // Alice card 2
      { suit: '♦', rank: 'K' },  // dealer upcard
    ];
    let i = 0;
    const draw = () => deck[i++];
    const next = applyAction(
      state,
      { type: 'round:betDeadline', seatId: '__server__' },
      draw,
    );
    expect(next.phase).toBe('dealing');
    expect(next.players[0].hands[0].cards.length).toBe(2);
    expect(next.dealer.cards.length).toBe(2);  // upcard + hidden
  });

  it('sits out seated players who did not bet', () => {
    let state = newRoom();
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, name: 'Alice', status: 'betting', hands: [{ cards: [], bet: 100, stood: false, busted: false, isBlackjack: false, doubled: false }] }
          : i === 1
          ? { ...p, name: 'Bob', status: 'betting', hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }] }
          : p,
      ),
    };
    const deck: Card[] = [
      { suit: '♠', rank: '5' },
      { suit: '♥', rank: '6' },
      { suit: '♦', rank: 'K' },
    ];
    let i = 0;
    const draw = () => deck[i++];
    const next = applyAction(
      state,
      { type: 'round:betDeadline', seatId: '__server__' },
      draw,
    );
    // Alice (bet 100) is acting; Bob (bet 0) is sitting_out
    expect(next.players[0].status).toBe('acting');
    expect(next.players[1].status).toBe('sitting_out');
  });

  it('preserves lastBet on sat-out players', () => {
    let state = newRoom();
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, name: 'Alice', status: 'betting', hands: [{ cards: [], bet: 100, stood: false, busted: false, isBlackjack: false, doubled: false }] }
          : i === 1
          ? { ...p, name: 'Bob', status: 'betting', lastBet: 50, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }] }
          : p,
      ),
    };
    const deck: Card[] = [
      { suit: '♠', rank: '5' },
      { suit: '♥', rank: '6' },
      { suit: '♦', rank: 'K' },
    ];
    let i = 0;
    const draw = () => deck[i++];
    const next = applyAction(
      state,
      { type: 'round:betDeadline', seatId: '__server__' },
      draw,
    );
    expect(next.players[1].lastBet).toBe(50);
    expect(next.players[1].status).toBe('sitting_out');
  });

  it('does not affect empty seats', () => {
    let state = newRoom();
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, name: 'Alice', status: 'betting', hands: [{ cards: [], bet: 100, stood: false, busted: false, isBlackjack: false, doubled: false }] }
          : p,
      ),
    };
    const deck: Card[] = [
      { suit: '♠', rank: '5' },
      { suit: '♥', rank: '6' },
      { suit: '♦', rank: 'K' },
    ];
    let i = 0;
    const draw = () => deck[i++];
    const next = applyAction(
      state,
      { type: 'round:betDeadline', seatId: '__server__' },
      draw,
    );
    // The 3 empty seats remain empty
    for (let j = 1; j < 5; j++) {
      expect(next.players[j].status).toBe('empty');
    }
  });
});

describe('applyAction: round:betDeadline (no bets, re-loop)', () => {
  it('stays in betting phase and bumps action count when 0 players have bet', () => {
    const state = newRoom();  // no bets placed
    const next = applyAction(
      state,
      { type: 'round:betDeadline', seatId: '__server__' },
      () => { throw new Error('draw should not be called on re-loop'); },
    );
    expect(next.phase).toBe('betting');
    expect(next.activeSeat).toBeNull();
    expect(next.lastResult).toBeNull();
  });
});

describe('applyAction: round:dealingComplete', () => {
  it('transitions dealing → player_turn without changing hands', () => {
    let state = newRoom();
    // Drive the room into 'dealing' by running betDeadline with at least one bet.
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, name: 'Alice', status: 'betting', hands: [{ cards: [], bet: 100, stood: false, busted: false, isBlackjack: false, doubled: false }] }
          : p,
      ),
    };
    const deck: Card[] = [
      { suit: '♠', rank: '5' },
      { suit: '♥', rank: '6' },
      { suit: '♦', rank: 'K' },
    ];
    let i = 0;
    const draw = () => deck[i++];
    state = applyAction(state, { type: 'round:betDeadline', seatId: '__server__' }, draw);
    expect(state.phase).toBe('dealing');
    const handsBefore = state.players[0].hands[0].cards;
    const dealerBefore = state.dealer.cards;
    const next = applyAction(state, { type: 'round:dealingComplete', seatId: '__server__' });
    expect(next.phase).toBe('player_turn');
    expect(next.players[0].hands[0].cards).toBe(handsBefore);
    expect(next.dealer.cards).toBe(dealerBefore);
  });

  it('throws INVALID_PHASE from any non-dealing phase', () => {
    const state = newRoom();
    expect(() =>
      applyAction(state, { type: 'round:dealingComplete', seatId: '__server__' }),
    ).toThrow('INVALID_PHASE');
  });
});

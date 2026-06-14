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
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 100, cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }] } : p) };
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

describe('applyAction: round:start', () => {
  const deck: Card[] = [
    { suit: '♠', rank: '5' }, { suit: '♥', rank: '6' },
    { suit: '♦', rank: '7' }, { suit: '♣', rank: '8' },
  ];
  let i = 0;
  const draw = () => deck[i++];

  it('rejects NOT_READY when a seated player has bet === 0', () => {
    const state: GameState = { ...createInitialState('ROOM1', 2, 0), phase: 'betting' };
    // Seat 0 is empty; only an actually seated seat without a bet would trigger this.
    state.players[0] = { ...state.players[0], name: 'Alice', status: 'betting', hands: [{ ...state.players[0].hands[0], bet: 50 }] };
    state.players[1] = { ...state.players[1], name: 'Bob', status: 'betting', hands: [{ ...state.players[1].hands[0], bet: 0 }] };
    expect(() => applyAction(state, { type: 'round:start', seatId: state.players[0].id }, draw)).toThrow('NOT_READY');
  });

  it('deals to all seated players when every seat has a bet', () => {
    const state: GameState = { ...createInitialState('ROOM1', 2, 0), phase: 'betting' };
    state.players[0] = { ...state.players[0], name: 'Alice', status: 'betting', hands: [{ ...state.players[0].hands[0], bet: 50 }] };
    state.players[1] = { ...state.players[1], name: 'Bob', status: 'betting', hands: [{ ...state.players[1].hands[0], bet: 50 }] };
    i = 0; // reset deck cursor
    const next = applyAction(state, { type: 'round:start', seatId: state.players[0].id }, draw);
    expect(next.phase).toBe('player_turn');
    expect(next.activeSeat).toBe(0);
    expect(next.players[0].hands[0].cards.length).toBe(2);
    expect(next.players[1].hands[0].cards.length).toBe(2);
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
    // Drive to settled by having both stand.
    const deck: Card[] = [
      { suit: '♣', rank: '5' },                              // dealer hole reveal for player 0 stand
      { suit: '♣', rank: '9' },                              // dealer hole reveal for player 1 stand
    ];
    let i = 0;
    const draw = () => deck[i++];
    let next = applyAction(state, { type: 'hand:stand', seatId: state.players[0].id, handIndex: 0 }, draw);
    next = applyAction(next, { type: 'hand:stand', seatId: state.players[1].id, handIndex: 0 }, draw);
    expect(next.phase).toBe('settled');
    expect(next.players[0].lastBet).toBe(75);
    expect(next.players[1].lastBet).toBe(200);
  });
});

describe('applyAction: round:advance', () => {
  function makeSettledState(): GameState {
    return {
      ...createInitialState('ROOM1', 2, 1),
      phase: 'settled',
      dealer: { cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: '5' }], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
      lastResult: { payouts: [{ seatId: 'x', delta: 50, reason: 'win' }] },
      activeSeat: null,
      players: [
        { id: 's0', name: 'Alice', bankroll: 1050, hands: [{ cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }], bet: 0, stood: true, busted: false, isBlackjack: false, doubled: false }], status: 'stood', connectedAt: 0, lastBet: 50 },
        { id: 's1', name: 'Bob', bankroll: 950, hands: [{ cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: '9' }], bet: 0, stood: true, busted: false, isBlackjack: false, doubled: false }], status: 'stood', connectedAt: 0, lastBet: 100 },
        { id: 's2', name: 'Carol', bankroll: 0, hands: [{ cards: [], bet: 0, stood: false, busted: true, isBlackjack: false, doubled: false }], status: 'busted', connectedAt: 0, lastBet: 200 },
        { id: 's3', name: 'Dan', bankroll: 0, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'sitting_out', connectedAt: 0, lastBet: 0 },
        { id: 's4', name: '', bankroll: 1000, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'empty', connectedAt: 0, lastBet: 0 },
      ],
    } as GameState;
  }

  it('transitions settled → betting and clears lastResult and activeSeat', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.phase).toBe('betting');
    expect(next.lastResult).toBeNull();
    expect(next.activeSeat).toBeNull();
  });

  it('clears the dealer hand', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.dealer.cards).toEqual([]);
    expect(next.dealer.bet).toBe(0);
    expect(next.dealer.stood).toBe(false);
    expect(next.dealer.busted).toBe(false);
  });

  it('resets every non-sitting-out, non-empty player to a single empty hand', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.players[0].hands.length).toBe(1);
    expect(next.players[0].hands[0].cards).toEqual([]);
    expect(next.players[0].hands[0].bet).toBe(0);
    expect(next.players[1].hands.length).toBe(1);
    expect(next.players[1].hands[0].cards).toEqual([]);
  });

  it('preserves sitting_out and empty seats', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.players[3].status).toBe('sitting_out');
    expect(next.players[4].status).toBe('empty');
  });

  it('auto-promotes bankroll === 0 players to sitting_out', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    // seat 2 (Carol) was 'busted' with bankroll 0 → must become 'sitting_out'
    expect(next.players[2].status).toBe('sitting_out');
  });

  it('sets non-sitting-out, non-empty, non-broke players to betting', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.players[0].status).toBe('betting');
    expect(next.players[1].status).toBe('betting');
  });

  it('leaves lastBet untouched on every seat', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.players[0].lastBet).toBe(50);
    expect(next.players[1].lastBet).toBe(100);
    expect(next.players[2].lastBet).toBe(200);
    expect(next.players[3].lastBet).toBe(0);
    expect(next.players[4].lastBet).toBe(0);
  });

  it('leaves shoeSize, cutCardIndex, and roundNumber unchanged', () => {
    const state: GameState = { ...makeSettledState(), shoeSize: 187, cutCardIndex: 50, roundNumber: 7 };
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.shoeSize).toBe(187);
    expect(next.cutCardIndex).toBe(50);
    expect(next.roundNumber).toBe(7);
  });

  it('throws INVALID_PHASE if not currently in settled', () => {
    const state: GameState = { ...createInitialState('ROOM1', 2, 0), phase: 'betting' };
    expect(() => applyAction(state, { type: 'round:advance', seatId: state.players[0].id })).toThrow('INVALID_PHASE');
  });
});

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

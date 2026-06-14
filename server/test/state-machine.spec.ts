import { createInitialState, applyAction } from '../src/game/state-machine';
import { Config } from '../src/config';
import type { GameState } from '../src/shared/types';

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
    const next = applyAction(state, { type: 'hand:hit', seatId: state.players[0].id, handIndex: 0 });
    expect(next.players[0].hands[0].cards.length).toBe(3);
  });
});

describe('applyAction: hand:stand', () => {
  it('marks the hand stood and advances the turn', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting', hands: [{ ...p.hands[0], cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }] } : p) };
    const next = applyAction(state, { type: 'hand:stand', seatId: state.players[0].id, handIndex: 0 });
    expect(next.players[0].hands[0].stood).toBe(true);
  });
});

describe('applyAction: hand:double', () => {
  it('doubles the bet, draws one card, and locks the hand', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 100, cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }] } : p) };
    const next = applyAction(state, { type: 'hand:double', seatId: state.players[0].id, handIndex: 0 });
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
    const next = applyAction(state, { type: 'hand:split', seatId: state.players[0].id, handIndex: 0 });
    expect(next.players[0].hands.length).toBe(2);
    expect(next.players[0].hands[0].cards.length).toBe(1);
    expect(next.players[0].hands[1].cards.length).toBe(1);
    expect(next.players[0].bankroll).toBe(900);
  });

  it('rejects split when ranks differ', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting', hands: [{ ...p.hands[0], cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '9' }] }] } : p) };
    expect(() => applyAction(state, { type: 'hand:split', seatId: state.players[0].id, handIndex: 0 })).toThrow('CANNOT_SPLIT');
  });
});

import { prepareEvent, computeDealerEvent } from '../src/game/draw-bridge';
import type { Card, GameState } from '../src/shared/types';
import { createInitialState } from '../src/game/state-machine';
import { Config } from '../src/config';

const baseState = (): GameState => ({ ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'betting' });

const makeDraw = (cards: Card[]) => {
  let i = 0;
  return () => cards[i++];
};

function state_with_one_seated_player(): GameState['players'] {
  return [
    {
      id: 'p0',
      name: 'Alice',
      bankroll: 1000,
      hands: [{ cards: [], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: 'betting',
      connectedAt: 0,
      lastBet: 0,
      activeHandIndex: 0,
    },
    {
      id: 'p1',
      name: '',
      bankroll: 1000,
      hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: 'empty',
      connectedAt: 0,
      lastBet: 0,
      activeHandIndex: 0,
    },
  ] as GameState['players'];
}

describe('drawBridge.prepareEvent', () => {
  it('returns a bet:place event unchanged (no cards needed)', () => {
    const state = baseState();
    const draw = makeDraw([]);
    const ev = prepareEvent(state, { type: 'bet:place', seatId: state.players[0].id, amount: 50 }, draw);
    expect(ev).toEqual({ type: 'bet:place', seatId: state.players[0].id, amount: 50 });
  });

  it('attaches 1 card to hand:hit', () => {
    const state: GameState = { ...baseState(), phase: 'player_turn', activeSeat: 0 };
    const draw = makeDraw([{ suit: '♦', rank: '7' }]);
    const ev = prepareEvent(state, { type: 'hand:hit', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(ev).toEqual({ type: 'hand:hit', seatId: state.players[0].id, handIndex: 0, card: { suit: '♦', rank: '7' } });
  });

  it('attaches 1 card to hand:double', () => {
    const state: GameState = { ...baseState(), phase: 'player_turn', activeSeat: 0 };
    const draw = makeDraw([{ suit: '♦', rank: 'K' }]);
    const ev = prepareEvent(state, { type: 'hand:double', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(ev).toEqual({ type: 'hand:double', seatId: state.players[0].id, handIndex: 0, card: { suit: '♦', rank: 'K' } });
  });

  it('attaches 2 cards to hand:split', () => {
    const state: GameState = { ...baseState(), phase: 'player_turn', activeSeat: 0 };
    const draw = makeDraw([{ suit: '♣', rank: '2' }, { suit: '♦', rank: '9' }]);
    const ev = prepareEvent(state, { type: 'hand:split', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(ev).toEqual({
      type: 'hand:split',
      seatId: state.players[0].id,
      handIndex: 0,
      leftCard: { suit: '♣', rank: '2' },
      rightCard: { suit: '♦', rank: '9' },
    });
  });

  it('attaches dealtCards and dealerUpcard to round:start', () => {
    const state: GameState = {
      ...baseState(),
      phase: 'betting',
      players: state_with_one_seated_player(),
    };
    const draw = makeDraw([
      { suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }, // seat 0 hand
      { suit: '♣', rank: 'K' },                            // dealer upcard
    ]);
    const ev = prepareEvent(state, { type: 'round:start', seatId: state.players[0].id }, draw);
    expect(ev).toEqual({
      type: 'round:start',
      seatId: state.players[0].id,
      dealtCards: [{ playerIndex: 0, cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }],
      dealerUpcard: { suit: '♣', rank: 'K' },
    });
  });

  it('throws GameError with code DRAW_REQUIRED when draw is undefined and action needs cards', () => {
    const state: GameState = { ...baseState(), phase: 'player_turn', activeSeat: 0 };
    expect(() =>
      prepareEvent(state, { type: 'hand:hit', seatId: state.players[0].id, handIndex: 0 }, undefined),
    ).toThrow('DRAW_REQUIRED');
  });
});

describe('drawBridge.computeDealerEvent', () => {
  it('reveals the hole card and applies the dealer strategy', () => {
    const state: GameState = {
      ...baseState(),
      phase: 'dealer_turn',
      dealer: { cards: [{ suit: '♠', rank: '10' }, { hidden: true }], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    };
    const draw = makeDraw([
      { suit: '♥', rank: '7' },  // hole card → total 17, stand
    ]);
    const ev = computeDealerEvent(state, draw);
    expect(ev).toEqual({
      type: 'round:dealerPlay',
      dealerFinalHand: [{ suit: '♠', rank: '10' }, { suit: '♥', rank: '7' }],
    });
  });

  it('continues drawing while the dealer total is below 17', () => {
    const state: GameState = {
      ...baseState(),
      phase: 'dealer_turn',
      dealer: { cards: [{ suit: '♠', rank: '5' }, { hidden: true }], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    };
    const draw = makeDraw([
      { suit: '♥', rank: '6' },  // hole card → total 11, hit
      { suit: '♦', rank: '3' },  // hit → total 14, hit
      { suit: '♣', rank: '2' },  // hit → total 16, hit
      { suit: '♠', rank: 'K' },  // hit → total 26, bust
    ]);
    const ev = computeDealerEvent(state, draw);
    expect(ev).toEqual({
      type: 'round:dealerPlay',
      dealerFinalHand: [
        { suit: '♠', rank: '5' },
        { suit: '♥', rank: '6' },
        { suit: '♦', rank: '3' },
        { suit: '♣', rank: '2' },
        { suit: '♠', rank: 'K' },
      ],
    });
  });
});

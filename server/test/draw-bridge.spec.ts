import { prepareEvent, computeDealerEvent } from '../src/game/draw-bridge';
import type { Card, GameState } from '../src/shared/types';
import { createInitialState } from '../src/game/state-machine';
import { Config } from '../src/config';

const baseState = (): GameState => ({ ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'betting' });

const makeDraw = (cards: Card[]) => {
  let i = 0;
  return () => cards[i++];
};

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
});

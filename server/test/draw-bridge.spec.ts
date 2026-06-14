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
});

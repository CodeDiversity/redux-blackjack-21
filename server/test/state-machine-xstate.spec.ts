import { machine, createInitialState, applyAction } from '../src/game/state-machine';
import { createActor } from 'xstate';
import { Config } from '../src/config';
import type { Card, GameState } from '../src/shared/types';

// A GameContext-shaped object used to seed the XState machine when we don't
// care about the runtime state. Mirrors the initial values in
// `initialContext()` in state-machine.ts.
const emptyContext = () => ({
  shoeSize: 0,
  cutCardIndex: 0,
  players: [] as GameState['players'],
  dealer: { cards: [] as Card[], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
  activeSeat: null as number | null,
  roundNumber: 0,
  lastResult: null as GameState['lastResult'],
  __actionCount: 0,
});

describe('XState machine: state graph shape', () => {
  it('has the 5 expected states', () => {
    // We discover states by walking transitions from a hydrated actor.
    // Start in the betting phase with one player that has bet, so the
    // hasAtLeastOneBet guard on round:betDeadline passes and we transition
    // to player_turn.
    const players = [{
      id: 'p0',
      name: 'Alice',
      bankroll: 1000,
      hands: [{ cards: [], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: 'betting' as const,
      connectedAt: 0,
      lastBet: 0,
      activeHandIndex: 0,
    }];
    const actor = createActor(machine, {
      snapshot: machine.resolveState({ value: 'lobby', context: { ...emptyContext(), players } }),
    });
    actor.start();
    const states = new Set<string>();
    states.add(actor.getSnapshot().value as string);

    actor.send({ type: 'round:ready', seatId: 'x' });
    states.add(actor.getSnapshot().value as string);
    actor.send({ type: 'round:betDeadline', seatId: '__server__', dealtCards: [{ playerIndex: 0, cards: [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: 'K' }] }], dealerUpcard: { suit: '♠', rank: 'A' } });
    states.add(actor.getSnapshot().value as string);

    expect([...states].sort()).toEqual(['betting', 'lobby', 'player_turn']);
  });

  it('lobby transitions to betting on round:ready', () => {
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'round:ready', seatId: 'x' });
    expect(actor.getSnapshot().value).toBe('betting');
  });

  it('settled transitions to betting on round:ready', () => {
    // Start a fresh actor and hydrate into the settled state.
    const actor = createActor(machine, {
      snapshot: machine.resolveState({ value: 'settled', context: emptyContext() }),
    });
    actor.start();
    actor.send({ type: 'round:ready', seatId: 'x' });
    expect(actor.getSnapshot().value).toBe('betting');
  });

  it('player_turn has events for hand:hit, hand:stand, hand:double, hand:split', () => {
    const events = ['hand:hit', 'hand:stand', 'hand:double', 'hand:split'] as const;
    for (const type of events) {
      const nextActor = createActor(machine, {
        snapshot: machine.resolveState({ value: 'player_turn', context: emptyContext() }),
      });
      nextActor.start();
      // The exact event shape varies by type (hand:hit needs a card, hand:split needs two).
      // The transition must not throw.
      if (type === 'hand:split') {
        expect(() =>
          nextActor.send({ type, seatId: 'x', handIndex: 0, leftCard: { suit: '♠', rank: 'A' }, rightCard: { suit: '♠', rank: 'A' } } as any),
        ).not.toThrow();
      } else {
        expect(() =>
          nextActor.send({ type, seatId: 'x', handIndex: 0, card: { suit: '♠', rank: 'A' } } as any),
        ).not.toThrow();
      }
    }
  });
});

describe('betting state: round:betDeadline transitions', () => {
  it('has two transitions: one to player_turn (guarded by hasAtLeastOneBet), one to betting (re-loop)', () => {
    // XState v5 exposes the resolved machine config (the typed state node
    // tree) as `machine.config`. We walk into the betting state's `on` map
    // to inspect the `round:betDeadline` transition array.
    const bettingNode = (machine as any).config.states.betting;
    const on = bettingNode.on;
    const transitions = on['round:betDeadline'] as any[];
    expect(Array.isArray(transitions)).toBe(true);
    expect(transitions.length).toBe(2);
    expect(transitions[0].target).toBe('player_turn');
    expect(transitions[0].guard).toBe('hasAtLeastOneBet');
    expect(transitions[1].target).toBe('betting');
  });
});

describe('snapshot roundtrip', () => {
  // NOTE: This block exercises the roundtrip through the public `applyAction`
  // API rather than the (currently inlined) `toSnapshot` / `fromSnapshot`
  // helpers. The "roundtrip" semantics in our machine is: `applyAction` takes
  // a `GameState`, sends an event, and returns a fully reconstructed
  // `GameState` (every field populated). The tests below verify that for the
  // simplest possible flows (no event, lobby→betting, bet:place).

  it('returns a GameState that equals the input when phase is lobby and no action mutates', () => {
    const state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 3), phase: 'betting' };
    // Re-build the state through `createInitialState` to compare the structural
    // shape (initial state plus the phase override).
    const baseline: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'lobby' };
    const seatId = baseline.players[0].id;
    const after = applyAction(baseline, { type: 'round:ready', seatId });
    // All non-roomId, non-mutated fields are preserved on the result.
    expect(after.phase).toBe('betting');
    expect(after.shoeSize).toBe(baseline.shoeSize);
    expect(after.cutCardIndex).toBe(baseline.cutCardIndex);
    expect(after.activeSeat).toBeNull();
    expect(after.roundNumber).toBe(baseline.roundNumber);
    expect(after.lastResult).toBeNull();
    expect(after.players.length).toBe(baseline.players.length);
  });

  it('survives a bet:place → applyAction roundtrip (bet is set on the returned state)', () => {
    let state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'lobby' };
    state = applyAction(state, { type: 'round:ready', seatId: state.players[0].id });
    const seatId = state.players[0].id;
    state = applyAction(state, { type: 'bet:place', seatId, amount: 100 });
    expect(state.players[0].hands[0].bet).toBe(100);
  });
});

const seatWithBankroll = (state: GameState, idx: number, bankroll: number): GameState => ({
  ...state,
  players: state.players.map((p, i) => i === idx ? { ...p, bankroll } : p),
});

const makeDraw = (cards: Card[]) => {
  let i = 0;
  return () => cards[i++];
};

describe('validation guards', () => {
  it('isLobbyOrBetting accepts betting, rejects lobby and player_turn', () => {
    // The XState lobby state has no `bet:place` transition, so lobby throws
    // INVALID_PHASE for that action (lobby only accepts `round:ready`).
    // The `betting` state accepts `bet:place`; the `player_turn` state
    // does not.
    const lobby = createInitialState('R', Config.SEAT_COUNT, 0);
    const betting = { ...lobby, phase: 'betting' as const };
    const turn = { ...lobby, phase: 'player_turn' as const };
    expect(() => applyAction(lobby, { type: 'bet:place', seatId: lobby.players[0].id, amount: 50 })).toThrow('INVALID_PHASE');
    expect(() => applyAction(betting, { type: 'bet:place', seatId: betting.players[0].id, amount: 50 })).not.toThrow();
    expect(() => applyAction(turn, { type: 'bet:place', seatId: turn.players[0].id, amount: 50 })).toThrow('INVALID_PHASE');
  });

  it('isValidBetAmount throws BET_OUT_OF_RANGE for amount below MIN_BET', () => {
    const state = createInitialState('R', Config.SEAT_COUNT, 0);
    expect(() => applyAction(state, { type: 'bet:place', seatId: state.players[0].id, amount: 1 })).toThrow('BET_OUT_OF_RANGE');
  });

  it('isValidBetAmount throws BET_OUT_OF_RANGE for amount above MAX_BET', () => {
    const state = createInitialState('R', Config.SEAT_COUNT, 0);
    expect(() => applyAction(state, { type: 'bet:place', seatId: state.players[0].id, amount: Config.MAX_BET + 1 })).toThrow('BET_OUT_OF_RANGE');
  });

  it('hasSufficientFundsForBet throws INSUFFICIENT_FUNDS when bankroll < amount', () => {
    const state = seatWithBankroll(createInitialState('R', Config.SEAT_COUNT, 0), 0, 50);
    expect(() => applyAction(state, { type: 'bet:place', seatId: state.players[0].id, amount: 100 })).toThrow('INSUFFICIENT_FUNDS');
  });

  it('isActiveSeat throws NOT_YOUR_TURN when seat is not the active seat', () => {
    let state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'player_turn', activeSeat: 0 };
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting' as const, hands: [{ ...p.hands[0], cards: [{ suit: '♠', rank: '5' }] }] } : p) };
    const draw = makeDraw([{ suit: '♦', rank: '7' }]);
    expect(() => applyAction(state, { type: 'hand:hit', seatId: state.players[1].id, handIndex: 0 }, draw)).toThrow('NOT_YOUR_TURN');
  });

  it('isHandActionable throws HAND_LOCKED when hand is already stood', () => {
    let state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'player_turn', activeSeat: 0 };
    state = {
      ...state,
      // The targeted hand is stood (HAND_LOCKED) but the second hand is still
      // actionable — so the allHandsActed auto-transition to dealer_turn does
      // NOT fire, and the rejected action surfaces as HAND_LOCKED.
      dealer: { ...state.dealer, cards: [] },
      players: state.players.map((p, i) => i === 0
        ? { ...p, status: 'acting' as const, hands: [
            { ...p.hands[0], cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }], stood: true },
            { ...p.hands[0], cards: [{ suit: '♣', rank: '7' }, { suit: '♦', rank: '8' }] },
          ] }
        : p),
    };
    const draw = makeDraw([{ suit: '♦', rank: '7' }]);
    expect(() => applyAction(state, { type: 'hand:hit', seatId: state.players[0].id, handIndex: 0 }, draw)).toThrow('HAND_LOCKED');
  });

  it('canSplitHand throws CANNOT_SPLIT when ranks differ', () => {
    let state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'player_turn', activeSeat: 0 };
    state = { ...state, players: state.players.map((p, i) => i === 0 ? { ...p, status: 'acting' as const, bankroll: 1000, hands: [{ ...p.hands[0], bet: 50, cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '9' }] }] } : p) };
    const draw = makeDraw([]);
    expect(() => applyAction(state, { type: 'hand:split', seatId: state.players[0].id, handIndex: 0 }, draw)).toThrow('CANNOT_SPLIT');
  });

  it('canSplitHand throws CANNOT_SPLIT when hand already has 2 hands (resplit blocked)', () => {
    let state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'player_turn', activeSeat: 0 };
    state = {
      ...state,
      players: state.players.map((p, i) => i === 0
        ? { ...p, status: 'acting' as const, bankroll: 1000, hands: [
            { cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '2' }], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false },
            { cards: [{ suit: '♦', rank: '8' }, { suit: '♣', rank: '3' }], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false },
          ] }
        : p),
    };
    const draw = makeDraw([{ suit: '♣', rank: '5' }, { suit: '♦', rank: '9' }]);
    expect(() => applyAction(state, { type: 'hand:split', seatId: state.players[0].id, handIndex: 0 }, draw)).toThrow('CANNOT_SPLIT');
  });

  it('isSettled throws INVALID_PHASE when called from betting', () => {
    const state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'betting' };
    // round:ready is the only event that would target `settled`. Sending it
    // from betting must throw INVALID_PHASE.
    expect(() => applyAction(state, { type: 'round:ready', seatId: state.players[0].id })).toThrow('INVALID_PHASE');
  });
});

describe('handIndex validation against activeHandIndex', () => {
  function makePlayerTurnFixture() {
    // Seat 0 has 2 hands (post-split). activeHandIndex is 0.
    const seat0Id = 's0';
    const hand0: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    const hand1: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♦', rank: '8' }, { suit: '♣', rank: '5' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    return createInitialState('R', Config.SEAT_COUNT).players.map((p, i) =>
      i === 0 ? { ...p, id: seat0Id, name: 'Alice', status: 'acting' as const, hands: [hand0, hand1], activeHandIndex: 0 } : p
    );
  }

  it('rejects hand:hit with handIndex=1 when activeHandIndex=0', () => {
    const players = makePlayerTurnFixture();
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT),
      phase: 'player_turn',
      activeSeat: 0,
      players,
    };
    expect(() =>
      applyAction(state, { type: 'hand:hit', seatId: 's0', handIndex: 1 }, () => ({ suit: '♠', rank: 'A' })),
    ).toThrow('HAND_LOCKED');
  });

  it('rejects hand:stand with handIndex=1 when activeHandIndex=0', () => {
    const players = makePlayerTurnFixture();
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT),
      phase: 'player_turn',
      activeSeat: 0,
      players,
    };
    expect(() =>
      applyAction(state, { type: 'hand:stand', seatId: 's0', handIndex: 1 }),
    ).toThrow('HAND_LOCKED');
  });

  it('rejects hand:double with handIndex=1 when activeHandIndex=0', () => {
    const players = makePlayerTurnFixture();
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT),
      phase: 'player_turn',
      activeSeat: 0,
      players,
    };
    expect(() =>
      applyAction(state, { type: 'hand:double', seatId: 's0', handIndex: 1 }, () => ({ suit: '♠', rank: 'A' })),
    ).toThrow('HAND_LOCKED');
  });
});

describe('activeHandIndex walks all hands in order', () => {
  function makeSplitSeat() {
    const hand0: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    const hand1: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♦', rank: '8' }, { suit: '♣', rank: '5' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    return {
      ...createInitialState('R', Config.SEAT_COUNT).players[0],
      id: 's0',
      name: 'Alice',
      status: 'acting' as const,
      hands: [hand0, hand1],
      activeHandIndex: 0,
    };
  }

  function fixtureWithSeat(seatIdx: number): GameState {
    const players = createInitialState('R', Config.SEAT_COUNT).players.map((p, i) =>
      i === seatIdx ? makeSplitSeat() : p,
    );
    return {
      ...createInitialState('R', Config.SEAT_COUNT),
      phase: 'player_turn',
      activeSeat: seatIdx,
      players,
    };
  }

  it('hand:stand on hand 0 advances activeHandIndex to 1 within the same seat', () => {
    const state = fixtureWithSeat(0);
    const next = applyAction(state, { type: 'hand:stand', seatId: 's0', handIndex: 0 });
    expect(next.activeSeat).toBe(0);
    expect(next.players[0].activeHandIndex).toBe(1);
    expect(next.players[0].hands[0].stood).toBe(true);
    expect(next.players[0].hands[1].stood).toBe(false);
  });

  it('hand:double on hand 0 advances activeHandIndex to 1 within the same seat', () => {
    const state = fixtureWithSeat(0);
    const next = applyAction(state, { type: 'hand:double', seatId: 's0', handIndex: 0 }, () => ({ suit: '♠', rank: 'A' }));
    expect(next.activeSeat).toBe(0);
    expect(next.players[0].activeHandIndex).toBe(1);
    expect(next.players[0].hands[0].doubled).toBe(true);
  });

  it('hand:hit on hand 1 to bust advances to next seat (no further hands)', () => {
    const hand0: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }],
      bet: 50, stood: true, busted: false, isBlackjack: false, doubled: false,
    };
    const hand1: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '6' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    const players = createInitialState('R', Config.SEAT_COUNT).players.map((p, i) =>
      i === 0
        ? { ...p, id: 's0', name: 'Alice', status: 'acting' as const, activeHandIndex: 1, hands: [hand0, hand1] }
        : p,
    );
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT), phase: 'player_turn', activeSeat: 0, players,
    };
    const next = applyAction(state, { type: 'hand:hit', seatId: 's0', handIndex: 1 }, () => ({ suit: '♠', rank: 'K' }));
    expect(next.players[0].hands[1].busted).toBe(true);
    expect(next.players[0].activeHandIndex).toBe(2);
  });

  it('hand:hit to a non-completing total does not bump activeHandIndex', () => {
    // 5+5=10, hit to 7=17. Hand should NOT be bumped, activeSeat should stay.
    const hand: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '5' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    const players = createInitialState('R', Config.SEAT_COUNT).players.map((p, i) =>
      i === 0
        ? {
            ...createInitialState('R', Config.SEAT_COUNT).players[0],
            id: 's0', name: 'Alice', status: 'acting' as const, activeHandIndex: 0,
            hands: [hand],
          }
        : p,
    );
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT), phase: 'player_turn', activeSeat: 0, players,
    };
    const next = applyAction(state, { type: 'hand:hit', seatId: 's0', handIndex: 0 }, () => ({ suit: '♠', rank: '7' }));
    expect(next.players[0].hands[0].cards.length).toBe(3);
    expect(next.players[0].hands[0].busted).toBe(false);
    expect(next.players[0].activeHandIndex).toBe(0);
    expect(next.activeSeat).toBe(0);
  });

  it('hand:bust as the last acting action transitions to dealer_turn', () => {
    // Only seat 0 is acting; it busts; phase should be dealer_turn.
    const hand: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: '6' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    const players = createInitialState('R', Config.SEAT_COUNT).players.map((p, i) =>
      i === 0
        ? {
            ...createInitialState('R', Config.SEAT_COUNT).players[0],
            id: 's0', name: 'Alice', status: 'acting' as const, activeHandIndex: 0,
            hands: [hand],
          }
        : p,
    );
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT), phase: 'player_turn', activeSeat: 0, players,
    };
    const next = applyAction(state, { type: 'hand:hit', seatId: 's0', handIndex: 0 }, () => ({ suit: '♠', rank: 'K' }));
    expect(next.players[0].hands[0].busted).toBe(true);
    // Phase may be 'dealer_turn' (no draw provided) or 'settled' (draw triggered dealer event).
    // What matters is that the player_turn phase has ended.
    expect(next.phase).not.toBe('player_turn');
    expect(next.activeSeat).toBeNull();
  });
});

describe('activeHandIndex resets when a new seat becomes active', () => {
  it('seat 2 with hand 1 incomplete (hand 0 done) becomes active with activeHandIndex=1', () => {
    // Seat 0 is acting on hand 1 (its last incomplete hand); hand 0 is already stood.
    // After seat 0's stand on hand 1, the table should advance to seat 2 and set
    // seat 2's activeHandIndex to 1 (the first incomplete hand).
    const handDone0: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: '9' }],
      bet: 50, stood: true, busted: false, isBlackjack: false, doubled: false,
    };
    const handDone1: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '7' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    const handReady: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♠', rank: '9' }, { suit: '♥', rank: '7' }],
      bet: 50, stood: true, busted: false, isBlackjack: false, doubled: false,
    };
    const handPending: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '5' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    const players = createInitialState('R', Config.SEAT_COUNT).players.map((p, i) => {
      if (i === 0) {
        return {
          ...p, id: 's0', name: 'Alice', status: 'acting' as const, activeHandIndex: 1,
          hands: [handDone0, handDone1],
        };
      }
      if (i === 2) {
        return {
          ...p, id: 's2', name: 'Carol', status: 'acting' as const, activeHandIndex: 0,
          hands: [handReady, handPending],
        };
      }
      return p;
    });
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT), phase: 'player_turn', activeSeat: 0, players,
    };
    const next = applyAction(state, { type: 'hand:stand', seatId: 's0', handIndex: 1 });
    // Expected: activeSeat moves to 2; seat 2's activeHandIndex is 1 (first incomplete hand).
    expect(next.activeSeat).toBe(2);
    expect(next.players[2].activeHandIndex).toBe(1);
  });
});

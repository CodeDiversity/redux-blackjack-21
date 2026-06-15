import { setup, createActor, assign, and } from 'xstate';
import { Config } from '../config';
import type { Card, CardSlot, GameState, Hand, PlayerSeat, RoundResult } from '../shared/types';
import { isBusted, handTotal } from './hand';
import { computePayout } from './payout';
import { prepareEvent, computeDealerEvent } from './draw-bridge';

// --- Public types (unchanged) ------------------------------------------------

export type Action =
  | { type: 'bet:place'; seatId: string; amount: number }
  | { type: 'hand:hit'; seatId: string; handIndex: number }
  | { type: 'hand:stand'; seatId: string; handIndex: number }
  | { type: 'hand:double'; seatId: string; handIndex: number }
  | { type: 'hand:split'; seatId: string; handIndex: number }
  | { type: 'round:ready'; seatId: string }
  | { type: 'round:betDeadline'; seatId: string };

export class GameError extends Error {
  constructor(public code: string) { super(code); }
}

// --- XState event type (enriched Action with pre-drawn cards) --------------

export type GameEvent =
  | { type: 'bet:place'; seatId: string; amount: number }
  | { type: 'hand:hit'; seatId: string; handIndex: number; card: Card }
  | { type: 'hand:stand'; seatId: string; handIndex: number }
  | { type: 'hand:double'; seatId: string; handIndex: number; card: Card }
  | { type: 'hand:split'; seatId: string; handIndex: number; leftCard: Card; rightCard: Card }
  | { type: 'round:ready'; seatId: string }
  | { type: 'round:dealerPlay'; dealerFinalHand: CardSlot[] }
  | { type: 'round:betDeadline'; seatId: string; dealtCards: { playerIndex: number; cards: [Card, Card] }[]; dealerUpcard: Card | null };

// --- XState context ---------------------------------------------------------

export type GameContext = {
  shoeSize: number;
  cutCardIndex: number;
  players: PlayerSeat[];
  dealer: Hand;
  activeSeat: number | null;
  roundNumber: number;
  lastResult: RoundResult | null;
  __actionCount: number;
};

const initialContext = (): GameContext => ({
  shoeSize: 0,
  cutCardIndex: 0,
  players: [],
  dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
  activeSeat: null,
  roundNumber: 0,
  lastResult: null,
  __actionCount: 0,
});

// --- Validation guards ------------------------------------------------------

type GuardPredicate = (state: GameState, event: Action) => boolean;
type GuardDef = { name: string; predicate: GuardPredicate; errorCode: string };

export const guards: GuardDef[] = [
  // Phase guards
  { name: 'isLobbyOrBetting', errorCode: 'INVALID_PHASE',
    predicate: (s) => s.phase === 'lobby' || s.phase === 'betting' },
  { name: 'isPlayerTurnPhase', errorCode: 'INVALID_PHASE',
    predicate: (s) => s.phase === 'player_turn' },
  { name: 'isLobbyOrSettled', errorCode: 'INVALID_PHASE',
    predicate: (s) => s.phase === 'lobby' || s.phase === 'settled' },
  { name: 'isSettled', errorCode: 'INVALID_PHASE',
    predicate: (s) => s.phase === 'settled' },

  // Bet guards
  { name: 'isValidBetAmount', errorCode: 'BET_OUT_OF_RANGE',
    predicate: (s, e) => e.type === 'bet:place' && e.amount >= Config.MIN_BET && e.amount <= Config.MAX_BET },
  { name: 'hasSufficientFundsForBet', errorCode: 'INSUFFICIENT_FUNDS',
    predicate: (s, e) => {
      if (e.type !== 'bet:place') return false;
      const p = s.players.find((x) => x.id === e.seatId);
      return p !== undefined && p.bankroll >= e.amount;
    }},

  // Turn guards
  { name: 'isActiveSeat', errorCode: 'NOT_YOUR_TURN',
    predicate: (s, e) => {
      if (e.type === 'bet:place' || e.type === 'round:ready' || e.type === 'round:betDeadline') return true;
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      return idx !== -1 && idx === s.activeSeat;
    }},

  // Hand guards
  { name: 'isHandActive', errorCode: 'HAND_LOCKED',
    predicate: (s, e) => {
      if (e.type !== 'hand:hit' && e.type !== 'hand:stand' && e.type !== 'hand:double' && e.type !== 'hand:split') return false;
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      if (idx === -1) return false;
      return e.handIndex === s.players[idx].activeHandIndex;
    }},
  { name: 'isHandActionable', errorCode: 'HAND_LOCKED',
    predicate: (s, e) => {
      if (e.type !== 'hand:hit' && e.type !== 'hand:stand') return false;
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      if (idx === -1) return false;
      const hand = s.players[idx].hands[e.handIndex];
      return !!hand && hand.cards.length > 0 && !hand.stood && !hand.busted && !hand.doubled;
    }},
  { name: 'isDoubleableHand', errorCode: 'HAND_LOCKED',
    predicate: (s, e) => {
      if (e.type !== 'hand:double') return false;
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      if (idx === -1) return false;
      const hand = s.players[idx].hands[e.handIndex];
      return !!hand && hand.cards.length <= 2 && !hand.stood && !hand.busted && !hand.doubled;
    }},
  { name: 'canSplitHand', errorCode: 'CANNOT_SPLIT',
    predicate: (s, e) => {
      if (e.type !== 'hand:split') return false;
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      if (idx === -1) return false;
      const p = s.players[idx];
      const hand = p.hands[e.handIndex];
      if (!hand || hand.cards.length !== 2) return false;
      if (p.hands.length >= 2) return false;
      const real = hand.cards.filter((c): c is Card => !('hidden' in c));
      return real[0]?.rank === real[1]?.rank;
    }},
  { name: 'hasSufficientFundsForDouble', errorCode: 'INSUFFICIENT_FUNDS',
    predicate: (s, e) => {
      if (e.type !== 'hand:double') return false;
      const p = s.players.find((x) => x.id === e.seatId);
      return p !== undefined && p.bankroll >= p.hands[e.handIndex].bet;
    }},
  { name: 'hasSufficientFundsForSplit', errorCode: 'INSUFFICIENT_FUNDS',
    predicate: (s, e) => {
      if (e.type !== 'hand:split') return false;
      const p = s.players.find((x) => x.id === e.seatId);
      return p !== undefined && p.bankroll >= p.hands[e.handIndex].bet;
    }},
  { name: 'noAcesRuleForSplit', errorCode: 'CANNOT_SPLIT',
    predicate: (s, e) => {
      if (e.type !== 'hand:split') return true;  // vacuous when not splitting aces
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      if (idx === -1) return false;
      const hand = s.players[idx].hands[e.handIndex];
      const real = hand?.cards.filter((c): c is Card => !('hidden' in c)) ?? [];
      if (real[0]?.rank !== 'A') return true;
      return Config.RESPLIT_ACES;
    }},

  // Round guards
  { name: 'hasAtLeastOneBet', errorCode: 'NO_BETS',
    predicate: (s) => s.players.some((p) =>
      p.status !== 'empty' && p.status !== 'sitting_out' && p.hands[0]?.bet > 0) },
  { name: 'allHandsActed', errorCode: 'INVALID_PHASE',
    predicate: (s) => {
      const acting = s.players.filter((p) => p.status === 'acting');
      if (acting.length === 0) return false;
      return acting.every((p) => p.hands.every((h) => h.stood || h.busted || h.doubled || h.cards.length === 0));
    }},
];

// Order of guards to check per action — used by inferRejectionReason.
const actionGuards: Partial<Record<Action['type'], string[]>> = {
  'bet:place': ['isLobbyOrBetting', 'isValidBetAmount', 'hasSufficientFundsForBet'],
  'hand:hit': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActive', 'isHandActionable'],
  'hand:stand': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActive', 'isHandActionable'],
  'hand:double': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActive', 'isDoubleableHand', 'hasSufficientFundsForDouble'],
  'hand:split': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActive', 'canSplitHand', 'hasSufficientFundsForSplit', 'noAcesRuleForSplit'],
  'round:ready': ['isLobbyOrSettled'],
  'round:betDeadline': ['hasAtLeastOneBet'],
};

function inferRejectionReason(state: GameState, action: Action): string {
  const guardList = actionGuards[action.type] ?? [];
  for (const guardName of guardList) {
    const guard = guards.find((g) => g.name === guardName);
    if (guard && !guard.predicate(state, action)) {
      return guard.errorCode;
    }
  }
  return 'INVALID_PHASE';
}

// --- XState machine (states and events; guards and actions added in later tasks)

// Walk to the next acting seat (after `from`) and reset its `activeHandIndex`
// to the first incomplete hand. Also sets the seat's `status` to `'acting'`
// (in case it was `'sitting_out'` or another non-acting state). Returns the
// new activeSeat index, or `null` if no acting seat is found (signals the
// `allHandsActed` auto-transition to `dealer_turn`).
function advanceToNextActingSeat(players: PlayerSeat[], from: number): { seat: number | null; players: PlayerSeat[] } {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const s = players[idx];
    const firstIncomplete = s.hands.findIndex(
      (h) => !h.stood && !h.busted && !h.doubled && h.cards.length > 0,
    );
    if (firstIncomplete !== -1) {
      const newPlayers = players.map((p, j) =>
        j === idx ? { ...p, activeHandIndex: firstIncomplete, status: 'acting' as const } : p,
      );
      return { seat: idx, players: newPlayers };
    }
  }
  return { seat: null, players };
}

function makeGuardFn(g: GuardDef) {
  return ({ context, event }: { context: GameContext; event: GameEvent }) => {
    // Adapt XState (context, event) → our (state, action) signature.
    // The XState phase is not in context — but our guards reference s.phase,
    // so we need to derive it. Since the XState machine guards are only used
    // in their own state context, we extract it from the snapshot value.
    // Note: the actionGuards map drives the check order; the inner phase
    // check uses the XState machine's current state value.
    // We don't have direct access to the state value here, so we leave it as
    // a placeholder; the predicate that depends on phase will rely on the
    // calling state being correct (XState only invokes guards in matching states).
    const fakeState: GameState = {
      roomId: '',
      phase: 'lobby',  // unused by predicates when invoked inside the right XState state
      phaseEndsAt: null,
      shoeSize: context.shoeSize,
      cutCardIndex: context.cutCardIndex,
      players: context.players,
      dealer: context.dealer,
      activeSeat: context.activeSeat,
      roundNumber: context.roundNumber,
      lastResult: context.lastResult,
    };
    // Coerce the enriched event to the user-action shape.
    const action = event as unknown as Action;
    return g.predicate(fakeState, action);
  };
}

export const machine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
  },
  guards: {
    isLobbyOrBetting: makeGuardFn(guards.find((g) => g.name === 'isLobbyOrBetting')!),
    isPlayerTurnPhase: makeGuardFn(guards.find((g) => g.name === 'isPlayerTurnPhase')!),
    isLobbyOrSettled: makeGuardFn(guards.find((g) => g.name === 'isLobbyOrSettled')!),
    isSettled: makeGuardFn(guards.find((g) => g.name === 'isSettled')!),
    isValidBetAmount: makeGuardFn(guards.find((g) => g.name === 'isValidBetAmount')!),
    hasSufficientFundsForBet: makeGuardFn(guards.find((g) => g.name === 'hasSufficientFundsForBet')!),
    isActiveSeat: makeGuardFn(guards.find((g) => g.name === 'isActiveSeat')!),
    isHandActive: makeGuardFn(guards.find((g) => g.name === 'isHandActive')!),
    isHandActionable: makeGuardFn(guards.find((g) => g.name === 'isHandActionable')!),
    isDoubleableHand: makeGuardFn(guards.find((g) => g.name === 'isDoubleableHand')!),
    canSplitHand: makeGuardFn(guards.find((g) => g.name === 'canSplitHand')!),
    hasSufficientFundsForDouble: makeGuardFn(guards.find((g) => g.name === 'hasSufficientFundsForDouble')!),
    hasSufficientFundsForSplit: makeGuardFn(guards.find((g) => g.name === 'hasSufficientFundsForSplit')!),
    noAcesRuleForSplit: makeGuardFn(guards.find((g) => g.name === 'noAcesRuleForSplit')!),
    hasAtLeastOneBet: makeGuardFn(guards.find((g) => g.name === 'hasAtLeastOneBet')!),
    allHandsActed: ({ context, event }: { context: GameContext; event: GameEvent }) => {
      // Only fire the auto-transition after a hand:* event that completed a hand.
      // (Don't fire for hand:double / hand:split, which leave the player with a hand to act on.)
      if (event.type === 'hand:double' || event.type === 'hand:split') return false;
      const acting = context.players.filter((p) => p.status === 'acting');
      if (acting.length === 0) return false;
      return acting.every((p) => p.hands.every((h) => h.stood || h.busted || h.doubled || h.cards.length === 0));
    },
  },
  actions: {
    assignBetDeadline: assign(({ context, event }) => {
      if (event.type !== 'round:betDeadline') return {};
      const dealtPlayers = context.players.map((p, i) => {
        // Auto-sit-out seated players who didn't bet.
        if (p.status !== 'empty' && p.status !== 'sitting_out' && p.hands[0]?.bet === 0) {
          return { ...p, status: 'sitting_out' as const };
        }
        const deal = event.dealtCards.find((d) => d.playerIndex === i);
        if (!deal) return p;
        return {
          ...p,
          hands: [{ ...p.hands[0], cards: [...deal.cards] }],
          status: 'acting' as const,
        };
      });
      const actingIndex = dealtPlayers.findIndex((p) => p.status === 'acting');
      const hiddenCard: CardSlot = { hidden: true };
      return {
        __actionCount: context.__actionCount + 1,
        players: dealtPlayers,
        dealer: { ...context.dealer, cards: [event.dealerUpcard as Card, hiddenCard] },
        activeSeat: actingIndex === -1 ? null : actingIndex,
        roundNumber: context.roundNumber + 1,
        lastResult: null,
      };
    }),
    assignHit: assign(({ context, event }) => {
      if (event.type !== 'hand:hit') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const newCards = [...hand.cards, event.card];
      const busted = isBusted(newCards);
      const handComplete = busted || handTotal(newCards) === 21;
      const newHand = { ...hand, cards: newCards, busted };
      const newHands = player.hands.map((h, j) => j === event.handIndex ? newHand : h);
      const nextHandIndex = event.handIndex + 1;
      const stillHasHand = handComplete && nextHandIndex < newHands.length &&
        !newHands[nextHandIndex].stood && !newHands[nextHandIndex].busted && !newHands[nextHandIndex].doubled;
      const midPlayers = context.players.map((p, i) =>
        i === context.activeSeat
          ? { ...p, hands: newHands, activeHandIndex: handComplete ? nextHandIndex : player.activeHandIndex }
          : p,
      );
      const { seat: activeSeat, players: newPlayers } = handComplete
        ? (stillHasHand ? { seat: context.activeSeat, players: midPlayers } : advanceToNextActingSeat(midPlayers, context.activeSeat!))
        : { seat: context.activeSeat, players: midPlayers };
      return {
        __actionCount: context.__actionCount + 1,
        shoeSize: context.shoeSize - 1,
        players: newPlayers,
        activeSeat,
      };
    }),
    assignStand: assign(({ context, event }) => {
      if (event.type !== 'hand:stand') return {};
      const seat = context.players[context.activeSeat!];
      const newHands = seat.hands.map((h, j) => j === event.handIndex ? { ...h, stood: true } : h);
      // Bump activeHandIndex within the seat; if exhausted, advance to the next acting seat.
      const nextHandIndex = event.handIndex + 1;
      const stillHasHand = nextHandIndex < newHands.length &&
        !newHands[nextHandIndex].stood && !newHands[nextHandIndex].busted && !newHands[nextHandIndex].doubled;
      const midPlayers = context.players.map((p, i) =>
        i === context.activeSeat
          ? { ...p, hands: newHands, activeHandIndex: stillHasHand ? nextHandIndex : seat.activeHandIndex }
          : p,
      );
      const { seat: activeSeat, players: newPlayers } = stillHasHand
        ? { seat: context.activeSeat, players: midPlayers }
        : advanceToNextActingSeat(midPlayers, context.activeSeat!);
      return {
        __actionCount: context.__actionCount + 1,
        players: newPlayers,
        activeSeat,
      };
    }),
    assignDouble: assign(({ context, event }) => {
      if (event.type !== 'hand:double') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const newCards = [...hand.cards, event.card];
      const newHand = { ...hand, cards: newCards, bet: hand.bet * 2, doubled: true, busted: isBusted(newCards) };
      const newHands = player.hands.map((h, j) => j === event.handIndex ? newHand : h);
      const nextHandIndex = event.handIndex + 1;
      const stillHasHand = nextHandIndex < newHands.length &&
        !newHands[nextHandIndex].stood && !newHands[nextHandIndex].busted && !newHands[nextHandIndex].doubled;
      const midPlayers = context.players.map((p, i) =>
        i === context.activeSeat
          ? { ...p, bankroll: p.bankroll - hand.bet, hands: newHands, activeHandIndex: stillHasHand ? nextHandIndex : player.activeHandIndex }
          : p,
      );
      const { seat: activeSeat, players: newPlayers } = stillHasHand
        ? { seat: context.activeSeat, players: midPlayers }
        : advanceToNextActingSeat(midPlayers, context.activeSeat!);
      return {
        __actionCount: context.__actionCount + 1,
        shoeSize: context.shoeSize - 1,
        players: newPlayers,
        activeSeat,
      };
    }),
    assignSplit: assign(({ context, event }) => {
      if (event.type !== 'hand:split') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const c0: Card = 'hidden' in hand.cards[0] ? (hand.cards[1] as Card) : hand.cards[0];
      const acesRule = c0.rank === 'A' && !Config.RESPLIT_ACES;
      const leftHand = { ...hand, cards: [hand.cards[0], event.leftCard] };
      const rightHand: Hand = { cards: [hand.cards[1], event.rightCard], bet: hand.bet, stood: acesRule, busted: false, isBlackjack: false, doubled: false };
      return {
        __actionCount: context.__actionCount + 1,
        shoeSize: context.shoeSize - 2,
        // After a split the player still has hands to act on — keep activeSeat as-is.
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? { ...p, bankroll: p.bankroll - hand.bet, hands: [leftHand, rightHand], activeHandIndex: 0 }
            : p,
        ),
      };
    }),
    assignDealerHand: assign(({ context, event }) => {
      if (event.type !== 'round:dealerPlay') return {};
      const hiddenCount = context.dealer.cards.filter((c) => 'hidden' in c).length;
      return {
        __actionCount: context.__actionCount + 1,
        shoeSize: context.shoeSize - (event.dealerFinalHand.length - context.dealer.cards.length) - hiddenCount,
        dealer: { ...context.dealer, cards: event.dealerFinalHand, busted: isBusted(event.dealerFinalHand) },
      };
    }),
    assignSettle: assign(({ context }) => {
      const payouts: RoundResult['payouts'] = [];
      const players = context.players.map((p) => {
        if (p.status === 'empty' || p.status === 'sitting_out') return p;
        const lastBet = p.hands.reduce((max, h) => Math.max(max, h.bet), 0);
        const totalDelta = p.hands.reduce((sum, hand) => {
          const result = computePayout({ playerCards: hand.cards, dealerCards: context.dealer.cards, bet: hand.bet });
          payouts.push({ seatId: p.id, delta: result.delta, reason: result.reason });
          return sum + result.delta;
        }, 0);
        return { ...p, bankroll: p.bankroll + totalDelta, lastBet, status: 'stood' as const };
      });
      return { __actionCount: context.__actionCount + 1, players, lastResult: { payouts } };
    }),
    assignBet: assign(({ context, event }) => {
      if (event.type !== 'bet:place') return {};
      return {
        __actionCount: context.__actionCount + 1,
        players: context.players.map((p) =>
          p.id === event.seatId
            ? { ...p, hands: [{ ...p.hands[0], bet: event.amount }], status: 'betting' as const }
            : p,
        ),
      };
    }),
    assignReady: assign(({ context }) => {
      return {
        __actionCount: context.__actionCount + 1,
        activeSeat: null,
        lastResult: null,
      };
    }),
    assignBetDeadlineEmpty: assign(({ context }) => {
      return {
        __actionCount: context.__actionCount + 1,
        activeSeat: null,
        lastResult: null,
      };
    }),
  },
}).createMachine({
  id: 'blackjack',
  initial: 'lobby',
  context: initialContext(),
  states: {
    lobby: {
      on: { 'round:ready': { target: 'betting', actions: 'assignReady' } },
    },
    betting: {
      on: {
        'bet:place': { actions: 'assignBet', guard: and(['isValidBetAmount', 'hasSufficientFundsForBet']) },
        'round:betDeadline': [
          { target: 'player_turn', actions: 'assignBetDeadline', guard: 'hasAtLeastOneBet' },
          { target: 'betting', actions: 'assignBetDeadlineEmpty' },
        ],
      },
    },
    player_turn: {
      on: {
        'hand:hit': { actions: 'assignHit', guard: and(['isActiveSeat', 'isHandActive', 'isHandActionable']) },
        'hand:stand': { actions: 'assignStand', guard: and(['isActiveSeat', 'isHandActive', 'isHandActionable']) },
        'hand:double': { actions: 'assignDouble', guard: and(['isActiveSeat', 'isHandActive', 'isDoubleableHand', 'hasSufficientFundsForDouble']) },
        'hand:split': { actions: 'assignSplit', guard: and(['isActiveSeat', 'isHandActive', 'canSplitHand', 'hasSufficientFundsForSplit', 'noAcesRuleForSplit']) },
      },
      always: [{ guard: 'allHandsActed', target: 'dealer_turn' }],
    },
    dealer_turn: {
      on: { 'round:dealerPlay': { target: 'settled', actions: 'assignDealerHand' } },
    },
    settled: {
      on: {
        'round:ready': { target: 'betting', actions: 'assignReady' },
      },
      entry: 'assignSettle',
    },
  },
});

type MachineSnapshot = ReturnType<typeof createActor<typeof machine>>['getSnapshot'] extends () => infer R ? R : never;

// --- Public API: createInitialState (unchanged) ----------------------------

export function createInitialState(roomId: string, seatCount: number, _roundNumber = 0): GameState {
  const seats: PlayerSeat[] = Array.from({ length: seatCount }, (_, i) => ({
    id: `seat-${i}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    bankroll: Config.STARTING_BANKROLL,
    hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
    status: 'empty' as const,
    connectedAt: Date.now(),
    lastBet: 0,
    activeHandIndex: 0,
  }));
  return {
    roomId,
    phase: 'lobby',
    phaseEndsAt: null,
    shoeSize: 0,
    cutCardIndex: 0,
    players: seats,
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null,
    roundNumber: 0,
    lastResult: null,
  };
}

function startActor(state: GameState) {
  const actor = createActor(machine);
  actor.start();
  // Override the initial state with our hydrated snapshot
  if (state.phase !== 'lobby' || state.players.length > 0) {
    // We need to send the state to a specific value+context
    // Use internal API: actor.send or the unstated state.
    // For now, we use the special "replace snapshot" via the snapshot option of createActor
  }
  return actor;
}

function eventWasApplied(next: MachineSnapshot, prev: MachineSnapshot): boolean {
  return next.value !== prev.value || next.context.__actionCount !== prev.context.__actionCount;
}

// --- applyAction wrapper ----------------------------------------------------

export function applyAction(state: GameState, action: Action, draw?: () => Card): GameState {
  // prepareEvent needs a draw for any action; supply a throw-away no-op if caller didn't.
  const safeDraw: () => Card = draw ?? (() => { throw new GameError('DRAW_REQUIRED'); });
  const actor = createActor(machine, { snapshot: machine.resolveState({ value: state.phase, context: { ...state, __actionCount: 0 } }) });
  actor.start();
  const prevSnapshot = actor.getSnapshot();
  const event = prepareEvent(state, action, safeDraw) as GameEvent;
  actor.send(event);
  const next = actor.getSnapshot();

  if (!eventWasApplied(next, prevSnapshot)) {
    throw new GameError(inferRejectionReason(state, action));
  }

  // If the auto-transition to dealer_turn fired, compute and apply the dealer event.
  if (next.value === 'dealer_turn' && draw) {
    const intermediateState: GameState = {
      roomId: state.roomId,
      phase: next.value as GameState['phase'],
      phaseEndsAt: null,
      shoeSize: next.context.shoeSize,
      cutCardIndex: next.context.cutCardIndex,
      players: next.context.players,
      dealer: next.context.dealer,
      activeSeat: next.context.activeSeat,
      roundNumber: next.context.roundNumber,
      lastResult: next.context.lastResult,
    };
    const dealerEv = computeDealerEvent(intermediateState, draw) as GameEvent;
    actor.send(dealerEv);
    const final = actor.getSnapshot();
    return {
      roomId: state.roomId,
      phase: final.value as GameState['phase'],
      phaseEndsAt: null,
      shoeSize: final.context.shoeSize,
      cutCardIndex: final.context.cutCardIndex,
      players: final.context.players,
      dealer: final.context.dealer,
      activeSeat: final.context.activeSeat,
      roundNumber: final.context.roundNumber,
      lastResult: final.context.lastResult,
    };
  }

  return {
    roomId: state.roomId,
    phase: next.value as GameState['phase'],
    phaseEndsAt: null,
    shoeSize: next.context.shoeSize,
    cutCardIndex: next.context.cutCardIndex,
    players: next.context.players,
    dealer: next.context.dealer,
    activeSeat: next.context.activeSeat,
    roundNumber: next.context.roundNumber,
    lastResult: next.context.lastResult,
  };
}

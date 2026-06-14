import { setup, createActor, assign } from 'xstate';
import { Config } from '../config';
import type { Card, CardSlot, GameState, Hand, PlayerSeat, RoundResult } from '../shared/types';
import { isBusted } from './hand';
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
  | { type: 'round:start'; seatId: string }
  | { type: 'round:advance'; seatId: string };

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
  | { type: 'round:start'; seatId: string; dealtCards: { playerIndex: number; cards: [Card, Card] }[]; dealerUpcard: Card }
  | { type: 'round:dealerPlay'; dealerFinalHand: CardSlot[] }
  | { type: 'round:advance'; seatId: string };

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

const guards: GuardDef[] = [
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
      if (e.type === 'bet:place' || e.type === 'round:ready' || e.type === 'round:start' || e.type === 'round:advance') return true;
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      return idx !== -1 && idx === s.activeSeat;
    }},

  // Hand guards
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
  { name: 'allPlayersReady', errorCode: 'NOT_READY',
    predicate: (s) => !s.players.some((p) => p.status !== 'empty' && p.hands[0]?.bet === 0) },
  { name: 'allHandsActed', errorCode: 'INVALID_PHASE',
    predicate: (s) => {
      if (s.activeSeat === null) return true;
      const seat = s.players[s.activeSeat];
      if (!seat) return true;
      return seat.hands.every((h) => h.stood || h.busted || h.doubled || h.cards.length === 0);
    }},
];

// Order of guards to check per action — used by inferRejectionReason.
const actionGuards: Partial<Record<Action['type'], string[]>> = {
  'bet:place': ['isLobbyOrBetting', 'isValidBetAmount', 'hasSufficientFundsForBet'],
  'hand:hit': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActionable'],
  'hand:stand': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActionable'],
  'hand:double': ['isPlayerTurnPhase', 'isActiveSeat', 'isDoubleableHand', 'hasSufficientFundsForDouble'],
  'hand:split': ['isPlayerTurnPhase', 'isActiveSeat', 'canSplitHand', 'hasSufficientFundsForSplit', 'noAcesRuleForSplit'],
  'round:ready': ['isLobbyOrSettled'],
  'round:start': ['allPlayersReady'],
  'round:advance': ['isSettled'],
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

export const machine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
  },
  guards: Object.fromEntries(
    guards.map((g) => [g.name, ({ context, event }: { context: GameContext; event: GameEvent }) => {
      // Adapt XState (context, event) → our (state, action) signature.
      const fakeState: GameState = {
        roomId: '',
        phase: 'lobby',  // unused by predicates; the actionGuards map drives the check order
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
    }]),
  ),
  actions: {
    assignDeal: assign(({ context, event }) => {
      if (event.type !== 'round:start') return {};
      const dealtPlayers = context.players.map((p, i) => {
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
        dealer: { ...context.dealer, cards: [event.dealerUpcard, hiddenCard] },
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
      return {
        __actionCount: context.__actionCount + 1,
        shoeSize: context.shoeSize - 1,
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? { ...p, hands: p.hands.map((h, j) => j === event.handIndex ? { ...h, cards: newCards, busted: isBusted(newCards) } : h) }
            : p,
        ),
      };
    }),
    assignStand: assign(({ context, event }) => {
      if (event.type !== 'hand:stand') return {};
      return {
        __actionCount: context.__actionCount + 1,
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? { ...p, hands: p.hands.map((h, j) => j === event.handIndex ? { ...h, stood: true } : h) }
            : p,
        ),
      };
    }),
    assignDouble: assign(({ context, event }) => {
      if (event.type !== 'hand:double') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const newCards = [...hand.cards, event.card];
      return {
        __actionCount: context.__actionCount + 1,
        shoeSize: context.shoeSize - 1,
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? {
                ...p,
                bankroll: p.bankroll - hand.bet,
                hands: p.hands.map((h, j) => j === event.handIndex ? { ...h, cards: newCards, bet: h.bet * 2, doubled: true, busted: isBusted(newCards) } : h),
              }
            : p,
        ),
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
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? { ...p, bankroll: p.bankroll - hand.bet, hands: [leftHand, rightHand] }
            : p,
        ),
      };
    }),
    assignAdvance: assign(({ context }) => {
      const emptyHand: Hand = { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false };
      return {
        __actionCount: context.__actionCount + 1,
        dealer: { ...emptyHand },
        players: context.players.map((p) => {
          if (p.status === 'empty' || p.status === 'sitting_out') return p;
          if (p.bankroll === 0) return { ...p, hands: [emptyHand], status: 'sitting_out' as const };
          return { ...p, hands: [emptyHand], status: 'betting' as const };
        }),
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
      on: { 'round:ready': { target: 'betting' } },
    },
    betting: {
      on: {
        'round:start': { target: 'player_turn', actions: 'assignDeal' },
      },
    },
    player_turn: {
      on: {
        'hand:hit': { actions: 'assignHit' },
        'hand:stand': { actions: 'assignStand' },
        'hand:double': { actions: 'assignDouble' },
        'hand:split': { actions: 'assignSplit' },
      },
    },
    dealer_turn: { on: {} },
    settled: {
      on: { 'round:advance': { target: 'betting', actions: 'assignAdvance' } },
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
  }));
  return {
    roomId,
    phase: 'lobby',
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
    shoeSize: next.context.shoeSize,
    cutCardIndex: next.context.cutCardIndex,
    players: next.context.players,
    dealer: next.context.dealer,
    activeSeat: next.context.activeSeat,
    roundNumber: next.context.roundNumber,
    lastResult: next.context.lastResult,
  };
}

// Suppress unused-import warning for isBusted / computePayout (used in Task 3.6).
void isBusted;
void computePayout;

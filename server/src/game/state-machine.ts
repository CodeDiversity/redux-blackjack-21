import { setup } from 'xstate';
import { Config } from '../config';
import type { Card, CardSlot, GameState, Hand, PlayerSeat, RoundResult } from '../shared/types';
import { isBusted } from './hand';
import { computePayout } from './payout';

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
};

const initialContext = (): GameContext => ({
  shoeSize: 0,
  cutCardIndex: 0,
  players: [],
  dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
  activeSeat: null,
  roundNumber: 0,
  lastResult: null,
});

// --- XState machine (states and events; guards and actions added in later tasks)

export const machine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
  },
}).createMachine({
  id: 'blackjack',
  initial: 'lobby',
  context: initialContext(),
  states: {
    lobby: { on: {} },
    betting: { on: {} },
    player_turn: { on: {} },
    dealer_turn: { on: {} },
    settled: { on: {} },
  },
});

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

// --- applyAction stub (replaced in Task 3.5 with the full wrapper) ----------

export function applyAction(_state: GameState, _action: Action, _draw?: () => Card): GameState {
  throw new Error('not implemented');
}

// Suppress unused-import warning for isBusted / computePayout (used in Task 3.6).
void isBusted;
void computePayout;

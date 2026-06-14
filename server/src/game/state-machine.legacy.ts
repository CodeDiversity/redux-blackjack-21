import { Config } from '../config';
import { isBusted } from './hand';
import { dealerShouldHit } from './dealer';
import { computePayout } from './payout';
import type { Card, CardSlot, GameState, Hand, PlayerSeat, RoundResult } from '../shared/types';

export type Action =
  | { type: 'bet:place'; seatId: string; amount: number }
  | { type: 'hand:hit'; seatId: string; handIndex: number }
  | { type: 'hand:stand'; seatId: string; handIndex: number }
  | { type: 'hand:double'; seatId: string; handIndex: number }
  | { type: 'hand:split'; seatId: string; handIndex: number }
  | { type: 'round:ready'; seatId: string }
  | { type: 'round:start'; seatId: string }
  | { type: 'round:advance'; seatId: string };

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

export class GameError extends Error {
  constructor(public code: string) { super(code); }
}

function findSeat(state: GameState, seatId: string): { seat: PlayerSeat; index: number } {
  const index = state.players.findIndex((p) => p.id === seatId);
  if (index === -1) throw new GameError('NOT_YOUR_TURN');
  return { seat: state.players[index], index };
}

function drawCardOrThrow(draw?: () => Card): () => Card {
  if (!draw) throw new Error('draw callback required for this action');
  return draw;
}

export function applyAction(state: GameState, action: Action, draw?: () => Card): GameState {
  switch (action.type) {
    case 'bet:place': return applyBet(state, action);
    case 'hand:hit': return applyHit(state, action, drawCardOrThrow(draw));
    case 'hand:stand': return applyStand(state, action, draw);
    case 'hand:double': return applyDouble(state, action, drawCardOrThrow(draw));
    case 'hand:split': return applySplit(state, action, drawCardOrThrow(draw));
    case 'round:ready': return applyReady(state, action);
    case 'round:start': return applyStartRound(state, drawCardOrThrow(draw));
    case 'round:advance': return applyAdvance(state, action);
  }
}

function applyBet(state: GameState, a: { seatId: string; amount: number }): GameState {
  if (state.phase !== 'lobby' && state.phase !== 'betting') throw new GameError('INVALID_PHASE');
  if (a.amount < Config.MIN_BET || a.amount > Config.MAX_BET) throw new GameError('BET_OUT_OF_RANGE');
  const { seat, index } = findSeat(state, a.seatId);
  if (seat.bankroll < a.amount) throw new GameError('INSUFFICIENT_FUNDS');
  return {
    ...state,
    phase: 'betting',
    players: state.players.map((p, i) =>
      i === index ? { ...p, hands: [{ ...p.hands[0], bet: a.amount }], status: 'betting' as const } : p),
  };
}

function activeHandCheck(state: GameState, seatId: string, handIndex: number): { seat: PlayerSeat; index: number; hand: Hand } {
  if (state.phase !== 'player_turn') throw new GameError('INVALID_PHASE');
  if (state.activeSeat === null) throw new GameError('NOT_YOUR_TURN');
  const { seat, index } = findSeat(state, seatId);
  if (state.activeSeat !== index) throw new GameError('NOT_YOUR_TURN');
  const hand = seat.hands[handIndex];
  if (!hand) throw new GameError('HAND_LOCKED');
  if (hand.stood || hand.busted || hand.doubled) throw new GameError('HAND_LOCKED');
  return { seat, index, hand };
}

function applyHit(state: GameState, a: { seatId: string; handIndex: number }, draw: () => Card): GameState {
  const { hand, index } = activeHandCheck(state, a.seatId, a.handIndex);
  if (hand.cards.length === 0) throw new GameError('HAND_LOCKED');
  const card = draw();
  const newCards: CardSlot[] = [...hand.cards, card];
  const busted = isBusted(newCards);
  const newHand: Hand = { ...hand, cards: newCards, busted };
  const seat = updateHandInSeat(state.players[index], a.handIndex, newHand);
  return advanceTurn({ ...state, players: state.players.map((p, i) => i === index ? seat : p), shoeSize: state.shoeSize - 1 }, draw);
}

function applyStand(state: GameState, a: { seatId: string; handIndex: number }, draw?: () => Card): GameState {
  const { hand, index } = activeHandCheck(state, a.seatId, a.handIndex);
  const newHand: Hand = { ...hand, stood: true };
  const seat = updateHandInSeat(state.players[index], a.handIndex, newHand);
  // If the next step is dealer_turn, draw will be invoked then.
  return advanceTurn({ ...state, players: state.players.map((p, i) => i === index ? seat : p) }, draw);
}

function applyDouble(state: GameState, a: { seatId: string; handIndex: number }, draw: () => Card): GameState {
  const { hand, index, seat } = activeHandCheck(state, a.seatId, a.handIndex);
  if (hand.cards.length > 2) throw new GameError('HAND_LOCKED');
  if (seat.bankroll < hand.bet) throw new GameError('INSUFFICIENT_FUNDS');
  const card = draw();
  const newCards: CardSlot[] = [...hand.cards, card];
  const newHand: Hand = { ...hand, cards: newCards, bet: hand.bet * 2, doubled: true, busted: isBusted(newCards) };
  const newSeat: PlayerSeat = {
    ...seat,
    bankroll: seat.bankroll - hand.bet,
    hands: seat.hands.map((h, i) => i === a.handIndex ? newHand : h),
  };
  return { ...state, players: state.players.map((p, i) => i === index ? newSeat : p), shoeSize: state.shoeSize - 1 };
}

function applySplit(state: GameState, a: { seatId: string; handIndex: number }, draw: () => Card): GameState {
  if (state.phase !== 'player_turn') throw new GameError('INVALID_PHASE');
  const { seat, index } = findSeat(state, a.seatId);
  if (state.activeSeat !== index) throw new GameError('NOT_YOUR_TURN');
  const hand = seat.hands[a.handIndex];
  if (!hand || hand.cards.length !== 2) throw new GameError('CANNOT_SPLIT');
  const realCards = hand.cards.filter((c): c is Card => !('hidden' in c));
  if (realCards[0].rank !== realCards[1].rank) throw new GameError('CANNOT_SPLIT');
  if (seat.bankroll < hand.bet) throw new GameError('INSUFFICIENT_FUNDS');
  if (seat.hands.length >= 2) throw new GameError('CANNOT_SPLIT');
  const acesRule = realCards[0].rank === 'A' && !Config.RESPLIT_ACES;
  const leftCard = draw();
  const rightCard = draw();
  const leftHand: Hand = { ...hand, cards: [realCards[0], leftCard], bet: hand.bet };
  const rightHand: Hand = { cards: [realCards[1], rightCard], bet: hand.bet, stood: acesRule, busted: false, isBlackjack: false, doubled: false };
  const newSeat: PlayerSeat = {
    ...seat,
    bankroll: seat.bankroll - hand.bet,
    hands: [leftHand, rightHand],
  };
  return { ...state, players: state.players.map((p, i) => i === index ? newSeat : p), shoeSize: state.shoeSize - 2 };
}

function applyReady(state: GameState, _a: { seatId: string }): GameState {
  if (state.phase !== 'lobby' && state.phase !== 'settled') throw new GameError('INVALID_PHASE');
  return {
    ...state,
    phase: 'betting',
    activeSeat: null,
    lastResult: null,
  };
}

function applyAdvance(state: GameState, _a: { seatId: string }): GameState {
  if (state.phase !== 'settled') throw new GameError('INVALID_PHASE');
  const emptyHand: Hand = { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false };
  const players = state.players.map((p) => {
    if (p.status === 'empty') return p;
    if (p.status === 'sitting_out') return p;
    if (p.bankroll === 0) return { ...p, hands: [emptyHand], status: 'sitting_out' as const };
    return { ...p, hands: [emptyHand], status: 'betting' as const };
  });
  return {
    ...state,
    phase: 'betting',
    activeSeat: null,
    lastResult: null,
    dealer: { ...emptyHand },
    players,
  };
}

function applyStartRound(state: GameState, draw: () => Card): GameState {
  if (state.phase !== 'lobby' && state.phase !== 'betting' && state.phase !== 'settled') throw new GameError('INVALID_PHASE');
  const hasUnbetSeated = state.players.some((p) => p.status !== 'empty' && p.hands[0].bet === 0);
  if (hasUnbetSeated) throw new GameError('NOT_READY');
  let shoeSize = state.shoeSize;
  // For each seated player with a bet, deal 2 cards
  const dealtPlayers = state.players.map((p) => {
    if (p.hands[0].bet === 0) return p;
    const c1 = draw();
    const c2 = draw();
    shoeSize -= 2;
    return { ...p, hands: [{ ...p.hands[0], cards: [c1, c2] }], status: 'acting' as const };
  });
  // Deal 2 to dealer, one face down
  const d1 = draw();
  const d2hidden: CardSlot = { hidden: true };
  shoeSize -= 2;
  const dealer: Hand = { cards: [d1, d2hidden], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false };
  return {
    ...state,
    phase: 'player_turn',
    shoeSize,
    players: dealtPlayers,
    dealer,
    activeSeat: dealtPlayers.findIndex((p) => p.status === 'acting'),
    roundNumber: state.roundNumber + 1,
    lastResult: null,
  };
}

function advanceTurn(state: GameState, draw?: () => Card): GameState {
  if (state.activeSeat === null) return state;
  const seat = state.players[state.activeSeat];
  const currentHand = seat.hands[seat.hands.length - 1];
  if (!currentHand.busted && !currentHand.stood && !currentHand.doubled && currentHand.cards.length > 0) {
    return state;
  }
  for (let i = state.activeSeat + 1; i < state.players.length; i++) {
    const s = state.players[i];
    if (s.status === 'acting' && s.hands.some((h) => !h.stood && !h.busted && !h.doubled && h.cards.length > 0)) {
      return { ...state, activeSeat: i };
    }
  }
  return enterDealerTurn(state, drawCardOrThrow(draw));
}

function enterDealerTurn(state: GameState, draw: () => Card): GameState {
  // Replace the hidden hole card with a real drawn card
  const revealedCards: CardSlot[] = state.dealer.cards.map((c) => ('hidden' in c ? draw() : c));
  // Count actual hidden replacements for shoe decrement
  const hiddenReplacements = state.dealer.cards.filter((c) => 'hidden' in c).length;
  let shoeSize = state.shoeSize - hiddenReplacements;
  while (dealerShouldHit(revealedCards)) {
    revealedCards.push(draw());
    shoeSize -= 1;
  }
  const finalDealer: Hand = { ...state.dealer, cards: revealedCards, busted: isBusted(revealedCards) };
  return settle({ ...state, phase: 'dealer_turn', dealer: finalDealer, shoeSize });
}

function settle(state: GameState): GameState {
  const payouts: RoundResult['payouts'] = [];
  const players = state.players.map((p) => {
    if (p.status === 'empty' || p.status === 'sitting_out') return p;
    // Record lastBet for each hand before reducing (split hands share the bet).
    const lastBet = p.hands.reduce((max, h) => Math.max(max, h.bet), 0);
    const totalDelta = p.hands.reduce((sum, hand) => {
      const result = computePayout({ playerCards: hand.cards, dealerCards: state.dealer.cards, bet: hand.bet });
      payouts.push({ seatId: p.id, delta: result.delta, reason: result.reason });
      return sum + result.delta;
    }, 0);
    return { ...p, bankroll: p.bankroll + totalDelta, lastBet, status: 'stood' as const };
  });
  return {
    ...state,
    phase: 'settled',
    players,
    lastResult: { payouts },
  };
}

function updateHandInSeat(seat: PlayerSeat, handIndex: number, newHand: Hand): PlayerSeat {
  return { ...seat, hands: seat.hands.map((h, i) => i === handIndex ? newHand : h) };
}

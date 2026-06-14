import { Config } from '../config';
import { createShoe, drawCard, needsReshuffle, type Shoe } from './shoe';
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
  | { type: 'round:start'; seatId: string };

export function createInitialState(roomId: string, seatCount: number, _roundNumber = 0): GameState {
  const seats: PlayerSeat[] = Array.from({ length: seatCount }, (_, i) => ({
    id: `seat-${i}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    bankroll: Config.STARTING_BANKROLL,
    hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
    status: 'empty' as const,
    connectedAt: Date.now(),
  }));
  const shoe = createShoe(Config.SHOE_DECKS);
  return {
    roomId,
    phase: 'lobby',
    shoeSize: shoe.cards.length,
    cutCardIndex: shoe.cutCardIndex,
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

export function applyAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'bet:place': return applyBet(state, action);
    case 'hand:hit': return applyHit(state, action);
    case 'hand:stand': return applyStand(state, action);
    case 'hand:double': return applyDouble(state, action);
    case 'hand:split': return applySplit(state, action);
    case 'round:start': return applyStartRound(state);
  }
}

function applyBet(state: GameState, a: { seatId: string; amount: number }): GameState {
  if (state.phase !== 'betting') throw new GameError('INVALID_PHASE');
  if (a.amount < Config.MIN_BET || a.amount > Config.MAX_BET) throw new GameError('BET_OUT_OF_RANGE');
  const { seat, index } = findSeat(state, a.seatId);
  if (seat.bankroll < a.amount) throw new GameError('INSUFFICIENT_FUNDS');
  return {
    ...state,
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

function applyHit(state: GameState, a: { seatId: string; handIndex: number }): GameState {
  const { hand, index } = activeHandCheck(state, a.seatId, a.handIndex);
  if (hand.cards.length === 0) throw new GameError('HAND_LOCKED');
  const shoe = currentShoe(state);
  const [card, nextShoe] = drawCard(shoe);
  const newCards: CardSlot[] = [...hand.cards, card];
  const busted = isBusted(newCards);
  const newHand: Hand = { ...hand, cards: newCards, busted };
  const seat = updateHandInSeat(state.players[index], a.handIndex, newHand);
  return advanceTurn({ ...state, players: state.players.map((p, i) => i === index ? seat : p), shoeSize: nextShoe.cards.length });
}

function applyStand(state: GameState, a: { seatId: string; handIndex: number }): GameState {
  const { hand, index } = activeHandCheck(state, a.seatId, a.handIndex);
  const newHand: Hand = { ...hand, stood: true };
  const seat = updateHandInSeat(state.players[index], a.handIndex, newHand);
  return advanceTurn({ ...state, players: state.players.map((p, i) => i === index ? seat : p) });
}

function applyDouble(state: GameState, a: { seatId: string; handIndex: number }): GameState {
  const { hand, index, seat } = activeHandCheck(state, a.seatId, a.handIndex);
  if (hand.cards.length > 2) throw new GameError('HAND_LOCKED');
  if (seat.bankroll < hand.bet) throw new GameError('INSUFFICIENT_FUNDS');
  const shoe = currentShoe(state);
  const [card, nextShoe] = drawCard(shoe);
  const newCards: CardSlot[] = [...hand.cards, card];
  const newHand: Hand = { ...hand, cards: newCards, bet: hand.bet * 2, doubled: true, busted: isBusted(newCards) };
  const newSeat: PlayerSeat = {
    ...seat,
    bankroll: seat.bankroll - hand.bet,
    hands: seat.hands.map((h, i) => i === a.handIndex ? newHand : h),
  };
  return { ...state, players: state.players.map((p, i) => i === index ? newSeat : p), shoeSize: nextShoe.cards.length };
}

function applySplit(state: GameState, a: { seatId: string; handIndex: number }): GameState {
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
  const leftHand: Hand = { ...hand, cards: [realCards[0]], bet: hand.bet };
  const rightHand: Hand = { cards: [realCards[1]], bet: hand.bet, stood: acesRule, busted: false, isBlackjack: false, doubled: false };
  const newSeat: PlayerSeat = {
    ...seat,
    bankroll: seat.bankroll - hand.bet,
    hands: [leftHand, rightHand],
  };
  return { ...state, players: state.players.map((p, i) => i === index ? newSeat : p) };
}

function applyStartRound(state: GameState): GameState {
  if (state.phase !== 'lobby' && state.phase !== 'settled') throw new GameError('INVALID_PHASE');
  const shoe = createShoe(Config.SHOE_DECKS);
  const { players } = reshuffleIfNeeded(state, shoe);
  const deck = currentShoe({ ...state, shoeSize: shoe.cards.length, cutCardIndex: shoe.cutCardIndex });
  let cursor = deck;
  const dealtPlayers = players.map((p) => {
    if (p.hands[0].bet === 0) return p;
    const [c1, after1] = drawCard(cursor);
    const [c2, after2] = drawCard(after1);
    cursor = after2;
    return { ...p, hands: [{ ...p.hands[0], cards: [c1, c2] }], status: 'acting' as const };
  });
  const [d1, afterD1] = drawCard(cursor);
  const [d2, afterD2] = drawCard(afterD1);
  cursor = afterD2;
  const dealer: Hand = { cards: [d1, { hidden: true }], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false };
  return {
    ...state,
    phase: 'player_turn',
    shoeSize: cursor.cards.length,
    cutCardIndex: cursor.cutCardIndex,
    players: dealtPlayers,
    dealer,
    activeSeat: dealtPlayers.findIndex((p) => p.status === 'acting'),
    roundNumber: state.roundNumber + 1,
    lastResult: null,
  };
}

function advanceTurn(state: GameState): GameState {
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
  return enterDealerTurn(state);
}

function enterDealerTurn(state: GameState): GameState {
  const dealer = { ...state.dealer, cards: state.dealer.cards.map((c) => ('hidden' in c ? { suit: '♠' as const, rank: 'A' as const } : c)) };
  let cursor = currentShoe({ ...state, dealer });
  const newCards: CardSlot[] = [...dealer.cards];
  while (dealerShouldHit(newCards as CardSlot[])) {
    const [c, next] = drawCard(cursor);
    newCards.push(c);
    cursor = next;
  }
  const finalDealer: Hand = { ...dealer, cards: newCards, busted: isBusted(newCards) };
  return settle({ ...state, phase: 'dealer_turn', dealer: finalDealer, shoeSize: cursor.cards.length });
}

function settle(state: GameState): GameState {
  const payouts: RoundResult['payouts'] = [];
  const players = state.players.map((p) => {
    if (p.status === 'empty' || p.status === 'sitting_out') return p;
    const totalDelta = p.hands.reduce((sum, hand) => {
      const result = computePayout({ playerCards: hand.cards, dealerCards: state.dealer.cards, bet: hand.bet });
      payouts.push({ seatId: p.id, delta: result.delta, reason: result.reason });
      return sum + result.delta;
    }, 0);
    return { ...p, bankroll: p.bankroll + totalDelta, status: 'stood' as const };
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

function currentShoe(state: GameState): Shoe {
  return { cards: new Array(state.shoeSize).fill({ suit: '♠', rank: 'A' }), cutCardIndex: state.cutCardIndex };
}

function reshuffleIfNeeded(state: GameState, shoe: Shoe): { players: PlayerSeat[]; shoe: Shoe } {
  if (!needsReshuffle(shoe) && state.roundNumber > 0) {
    return { players: state.players, shoe };
  }
  const fresh = createShoe(Config.SHOE_DECKS);
  return { players: state.players, shoe: fresh };
}

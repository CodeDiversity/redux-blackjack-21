export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Card = { suit: Suit; rank: Rank };
export type CardSlot = Card | { hidden: true };
export type Hand = {
  cards: CardSlot[];
  bet: number;
  stood: boolean;
  busted: boolean;
  isBlackjack: boolean;
  doubled: boolean;
};
export type SeatStatus = 'empty' | 'betting' | 'acting' | 'stood' | 'busted' | 'blackjack' | 'sitting_out';
export type PlayerSeat = {
  id: string; name: string; bankroll: number;
  hands: Hand[]; status: SeatStatus; connectedAt: number;
  lastBet: number;
  activeHandIndex: number;
};
export type Phase = 'lobby' | 'betting' | 'dealing' | 'player_turn' | 'dealer_turn' | 'settled';
export type RoundResult = {
  payouts: { seatId: string; delta: number; reason: 'win' | 'lose' | 'push' | 'blackjack' }[];
};
export type GameState = {
  roomId: string; phase: Phase; phaseEndsAt: number | null;
  shoeSize: number; cutCardIndex: number;
  players: PlayerSeat[]; dealer: Hand; activeSeat: number | null;
  roundNumber: number; lastResult: RoundResult | null;
};
export type LobbyState = {
  roomId: string;
  hostId: string;
  players: { id: string; name: string; ready: boolean; connectedAt: number }[];
};

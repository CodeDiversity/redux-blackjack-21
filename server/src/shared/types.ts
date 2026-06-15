export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export type Card = { suit: Suit; rank: Rank };

/** A dealer's hole card is sent as `{ hidden: true }` until reveal. */
export type CardSlot = Card | { hidden: true };

export type Hand = {
  cards: CardSlot[];
  bet: number;
  stood: boolean;
  busted: boolean;
  isBlackjack: boolean;
  doubled: boolean;
};

export type SeatStatus =
  | 'empty'
  | 'betting'
  | 'acting'
  | 'stood'
  | 'busted'
  | 'blackjack'
  | 'sitting_out';

export type PlayerSeat = {
  id: string;
  name: string;
  bankroll: number;
  hands: Hand[];
  status: SeatStatus;
  connectedAt: number;
  lastBet: number;
  activeHandIndex: number;  // 0-based index into hands[] when the seat is the active seat; ignored otherwise
};

export type Phase =
  | 'lobby'
  | 'betting'
  | 'dealing'
  | 'player_turn'
  | 'dealer_turn'
  | 'settled';

export type RoundResult = {
  payouts: { seatId: string; delta: number; reason: 'win' | 'lose' | 'push' | 'blackjack' }[];
};

export type GameState = {
  roomId: string;
  phase: Phase;
  shoeSize: number;
  cutCardIndex: number;
  players: PlayerSeat[];
  dealer: Hand;
  activeSeat: number | null;
  roundNumber: number;
  lastResult: RoundResult | null;
};

/** Commands the client can send. */
export type ClientCommand =
  | { type: 'room:create'; name: string }
  | { type: 'room:join'; roomId: string; name: string }
  | { type: 'room:leave' }
  | { type: 'round:ready' }
  | { type: 'bet:place'; amount: number }
  | { type: 'hand:hit'; handIndex: number }
  | { type: 'hand:stand'; handIndex: number }
  | { type: 'hand:double'; handIndex: number }
  | { type: 'hand:split'; handIndex: number }
  | { type: 'round:advance' };

/** Server-to-client wire events. */
export type ServerEvent =
  | { type: 'lobby:state'; payload: LobbyState }
  | { type: 'game:state'; payload: GameState }
  | { type: 'round:result'; payload: RoundResult }
  | { type: 'error'; payload: { code: ErrorCode; message: string } };

export type LobbyState = {
  roomId: string;
  hostId: string;
  players: { id: string; name: string; ready: boolean; connectedAt: number }[];
};

export type ErrorCode =
  | 'NOT_YOUR_TURN'
  | 'INVALID_PHASE'
  | 'INSUFFICIENT_FUNDS'
  | 'BET_OUT_OF_RANGE'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'CANNOT_SPLIT'
  | 'HAND_LOCKED'
  | 'NAME_REQUIRED'
  | 'NOT_READY'
  | 'NOT_HOST'
  | 'SEAT_GONE';

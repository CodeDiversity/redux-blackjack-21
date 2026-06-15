import { describe, it, expect } from 'vitest';
import { selectMySeat, selectMyLastBet, selectCanRebet, selectPhaseEndsAt } from '../../src/selectors/self';
import type { RootState } from '../../src/store';
import type { GameState, PlayerSeat } from '../../src/shared/types';

function seat(overrides: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id: 's0',
    name: 'Alice',
    bankroll: 1000,
    hands: [],
    status: 'betting',
    connectedAt: 0,
    lastBet: 0,
    activeHandIndex: 0,
    ...overrides,
  };
}

function stateWith(seatOrNull: PlayerSeat | null): RootState {
  const game: GameState | null = seatOrNull === null ? null : {
    roomId: 'R', phase: 'betting', phaseEndsAt: null, shoeSize: 200, cutCardIndex: 50,
    players: [seatOrNull], dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 1, lastResult: null,
  };
  return {
    game: { state: game, lastResult: null },
    connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
    lobby: { roomId: 'R', hostId: 's0', players: [] },
    ui: { betInputValue: 50, toasts: [] },
  } as unknown as RootState;
}

describe('selectMySeat', () => {
  it('returns the seat whose id matches selfSeatId', () => {
    const me = seat({ name: 'Alice' });
    const root = stateWith(me);
    expect(selectMySeat(root)?.name).toBe('Alice');
  });

  it('returns null when no game state', () => {
    const root = stateWith(null);
    expect(selectMySeat(root)).toBeNull();
  });
});

describe('selectMyLastBet', () => {
  it('returns the seat lastBet', () => {
    const root = stateWith(seat({ lastBet: 75 }));
    expect(selectMyLastBet(root)).toBe(75);
  });

  it('returns 0 when no seat', () => {
    expect(selectMyLastBet(stateWith(null))).toBe(0);
  });
});

describe('selectCanRebet', () => {
  it('is true when lastBet > 0, affordable, and status is betting', () => {
    const root = stateWith(seat({ lastBet: 50, bankroll: 1000, status: 'betting' }));
    expect(selectCanRebet(root)).toBe(true);
  });

  it('is false when lastBet is 0', () => {
    const root = stateWith(seat({ lastBet: 0, status: 'betting' }));
    expect(selectCanRebet(root)).toBe(false);
  });

  it('is false when lastBet exceeds bankroll', () => {
    const root = stateWith(seat({ lastBet: 500, bankroll: 100, status: 'betting' }));
    expect(selectCanRebet(root)).toBe(false);
  });

  it('is false when status is not betting', () => {
    const root = stateWith(seat({ lastBet: 50, status: 'sitting_out' }));
    expect(selectCanRebet(root)).toBe(false);
  });

  it('is false when no seat', () => {
    expect(selectCanRebet(stateWith(null))).toBe(false);
  });
});

describe('selectPhaseEndsAt', () => {
  it('returns the game state phaseEndsAt', () => {
    const root: RootState = {
      game: {
        state: {
          roomId: 'R', phase: 'betting', phaseEndsAt: 1_700_000_000_000,
          shoeSize: 200, cutCardIndex: 50,
          players: [],
          dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
          activeSeat: null, roundNumber: 1, lastResult: null,
        },
        lastResult: null,
      },
      connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: 's0', players: [] },
      ui: { betInputValue: 50, toasts: [] },
    } as unknown as RootState;
    expect(selectPhaseEndsAt(root)).toBe(1_700_000_000_000);
  });

  it('returns null when no game state', () => {
    const root: RootState = {
      game: { state: null, lastResult: null },
      connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: 's0', players: [] },
      ui: { betInputValue: 50, toasts: [] },
    } as unknown as RootState;
    expect(selectPhaseEndsAt(root)).toBeNull();
  });
});

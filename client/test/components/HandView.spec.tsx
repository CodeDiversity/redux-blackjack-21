import { render, screen, act } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HandView } from '../../src/components/HandView';
import { theme } from '../../src/styles/theme';
import { gameReducer } from '../../src/store/game.slice';
import { animationReducer, roundSeen } from '../../src/store/animation.slice';
import type { Hand, GameState, Card } from '../../src/shared/types';

vi.mock('../../src/lib/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: vi.fn(() => false),
}));
import { usePrefersReducedMotion } from '../../src/lib/usePrefersReducedMotion';
const mockReduced = vi.mocked(usePrefersReducedMotion);

function makeStore(initial?: Partial<{ gameState: GameState | null; lastSeen: number | null }>) {
  return configureStore({
    reducer: {
      game: gameReducer,
      animation: animationReducer,
    },
    preloadedState: {
      game: { state: initial?.gameState ?? null, lastResult: null },
      animation: { lastSeenRoundNumber: initial?.lastSeen ?? null },
    } as any,
  });
}

function hand(cards: Hand['cards']): Hand {
  return { cards, bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: 'r1',
    phase: 'player_turn',
    phaseEndsAt: null,
    shoeSize: 100,
    cutCardIndex: 75,
    players: [
      { id: 'p1', name: 'Alice', bankroll: 1000, hands: [hand([{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }])], status: 'acting', connectedAt: 0, lastBet: 50, activeHandIndex: 0 },
      { id: 'p2', name: 'Bob', bankroll: 1000, hands: [hand([{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '9' }])], status: 'acting', connectedAt: 0, lastBet: 50, activeHandIndex: 0 },
    ],
    dealer: hand([{ suit: '♠', rank: '7' }, { hidden: true } as Card | { hidden: true }]),
    activeSeat: 0,
    roundNumber: 1,
    lastResult: null,
    ...overrides,
  };
}

function renderHandView(props: { hand: Hand; isDealer?: boolean; handKey?: string; dealPosition?: number }, store = makeStore()) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <HandView hand={props.hand} isDealer={props.isDealer} handKey={props.handKey ?? 'k'} dealPosition={props.dealPosition ?? 0} />
      </ThemeProvider>
    </Provider>,
  );
}

describe('<HandView> animations', () => {
  beforeEach(() => { vi.useFakeTimers(); mockReduced.mockReturnValue(false); });
  afterEach(() => { vi.useRealTimers(); mockReduced.mockReset(); });

  it('renders all cards immediately when lastSeenRoundNumber === roundNumber (no animation)', () => {
    const cards: Card[] = [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }];
    const store = makeStore({ gameState: makeState({ roundNumber: 3 }), lastSeen: 3 });
    renderHandView({ hand: hand(cards) }, store);
    expect(screen.getAllByTestId('card').length).toBe(2);
  });

  it('renders cards progressively when lastSeenRoundNumber < roundNumber', () => {
    const cards: Card[] = [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }];
    const store = makeStore({ gameState: makeState({ roundNumber: 5, phase: 'dealing' }), lastSeen: 4 });
    renderHandView({ hand: hand(cards) }, store);
    expect(screen.queryAllByTestId('card').length).toBe(0);
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.queryAllByTestId('card').length).toBe(1);
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.queryAllByTestId('card').length).toBe(2);
  });

  it('renders all cards immediately when prefers-reduced-motion is true', () => {
    mockReduced.mockReturnValue(true);
    const cards: Card[] = [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }];
    const store = makeStore({ gameState: makeState({ roundNumber: 5, phase: 'dealing' }), lastSeen: 4 });
    renderHandView({ hand: hand(cards) }, store);
    expect(screen.getAllByTestId('card').length).toBe(2);
  });

  it('renders the dealer hole card as card-back during dealing/player_turn', () => {
    const store = makeStore({
      gameState: makeState({ roundNumber: 5, phase: 'player_turn' }),
      lastSeen: 5,
    });
    const dealerHand = hand([{ suit: '♠', rank: '7' }, { hidden: true } as any]);
    renderHandView({ hand: dealerHand, isDealer: true, handKey: 'dealer' }, store);
    expect(screen.getByTestId('card-back')).toBeInTheDocument();
    expect(screen.queryByTestId('card-front')).not.toBeInTheDocument();
  });

  it('roundSeen action updates the slice', () => {
    const store = makeStore({ lastSeen: 1 });
    store.dispatch(roundSeen(7));
    expect(store.getState().animation.lastSeenRoundNumber).toBe(7);
  });
});

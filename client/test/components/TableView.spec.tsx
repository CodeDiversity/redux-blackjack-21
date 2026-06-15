import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect, vi } from 'vitest';
import { TableView } from '../../src/components/TableView';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import type { GameState, PlayerSeat } from '../../src/shared/types';
import { theme } from '../../src/styles/theme';

vi.mock('../../src/socket/client', () => ({
  getSocket: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));

const SEAT_COUNT = 5;

function makeSeats(): PlayerSeat[] {
  return Array.from({ length: SEAT_COUNT }, (_, i) => ({
    id: `s${i}`,
    name: i < 2 ? ['Alice', 'Bob'][i] : '',
    bankroll: 1000,
    hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
    status: i < 2 ? 'betting' as const : 'empty' as const,
    connectedAt: Date.now(),
    lastBet: 0,
    activeHandIndex: 0,
  }));
}

function makeStore(seats: PlayerSeat[], selfSeatId: string | null = 's0') {
  const state: GameState = {
    roomId: 'R', phase: 'betting', shoeSize: 0, cutCardIndex: 0,
    players: seats,
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 0, lastResult: null,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId, status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: 's0', players: [] },
      ui: { betInputValue: 50, toasts: [] },
    },
  } as any);
}

function renderWith(ui: React.ReactNode, store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </Provider>,
  );
}

describe('TableView (5-seat layout)', () => {
  it('renders 5 tiles when 2 are seated and 3 are empty', () => {
    const store = makeStore(makeSeats());
    const { container } = renderWith(<TableView />, store);
    const tiles = container.querySelectorAll('[aria-label="empty-seat"]');
    const seatedNames = ['Alice', 'Bob'].filter((name) => container.textContent?.includes(name));
    expect(tiles.length + seatedNames.length).toBe(5);
  });

  it('renders 3 ghosted empty tiles', () => {
    const store = makeStore(makeSeats());
    const { container } = renderWith(<TableView />, store);
    const empties = container.querySelectorAll('[aria-label="empty-seat"]');
    expect(empties.length).toBe(3);
  });
});

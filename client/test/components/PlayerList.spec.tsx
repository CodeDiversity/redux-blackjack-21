import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect } from 'vitest';
import { PlayerList } from '../../src/components/PlayerList';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import type { GameState, PlayerSeat } from '../../src/shared/types';
import { theme } from '../../src/styles/theme';

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

function makeStore(seats: PlayerSeat[]) {
  const state: GameState = {
    roomId: 'R', phase: 'lobby', shoeSize: 0, cutCardIndex: 0,
    players: seats,
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 0, lastResult: null,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId: null, status: 'connected' as const, lastError: null },
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

describe('PlayerList (5-seat layout)', () => {
  it('renders 5 seat cards', () => {
    const store = makeStore(makeSeats());
    const { container } = renderWith(<PlayerList />, store);
    const cards = container.querySelectorAll('[aria-label^="seat-"], [aria-label="empty-seat"]');
    expect(cards.length).toBe(5);
  });

  it('renders the seated treatment for occupied seats', () => {
    const store = makeStore(makeSeats());
    renderWith(<PlayerList />, store);
    expect(screen.getByLabelText('seat-Alice')).toBeTruthy();
    expect(screen.getByLabelText('seat-Bob')).toBeTruthy();
    expect(screen.queryAllByLabelText('empty-seat').length).toBe(3);
  });

  it('renders the empty treatment for unoccupied seats', () => {
    const seats = makeSeats().map((s) => ({ ...s, status: 'empty' as const, name: '' }));
    const store = makeStore(seats);
    const { container } = renderWith(<PlayerList />, store);
    expect(screen.queryAllByLabelText('empty-seat').length).toBe(5);
    expect(container.textContent).toContain('Empty Seat');
  });
});

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { StartButton } from '../../src/components/StartButton';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';
import type { GameState, PlayerSeat } from '../../src/shared/types';

vi.mock('../../src/socket/client', () => ({
  getSocket: () => ({ emit: vi.fn() }),
}));

function makeSeat(id: string, name: string, status: PlayerSeat['status']): PlayerSeat {
  return {
    id, name, bankroll: 1000,
    hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
    status, connectedAt: 0, lastBet: 0, activeHandIndex: 0,
  };
}

function makeStore(opts: { players: PlayerSeat[]; hostId: string; selfSeatId: string }) {
  const state: GameState = {
    roomId: 'R', phase: 'lobby', phaseEndsAt: null,
    shoeSize: 200, cutCardIndex: 50,
    players: opts.players,
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 0, lastResult: null,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId: opts.selfSeatId, status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: opts.hostId, players: [], joinError: null },
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

describe('<StartButton />', () => {
  it('enables Begin Betting for a solo host (1 seated player)', () => {
    const store = makeStore({
      players: [makeSeat('s0', 'Alice', 'betting')],
      hostId: 's0', selfSeatId: 's0',
    });
    renderWith(<StartButton />, store);
    const btn = screen.getByRole('button', { name: /begin betting/i });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText(/waiting for/i)).toBeNull();
  });

  it('enables Begin Betting when 2+ players are seated', () => {
    const store = makeStore({
      players: [
        makeSeat('s0', 'Alice', 'betting'),
        makeSeat('s1', 'Bob', 'betting'),
        makeSeat('s2', '', 'empty'),
      ],
      hostId: 's0', selfSeatId: 's0',
    });
    renderWith(<StartButton />, store);
    const btn = screen.getByRole('button', { name: /begin betting/i });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText(/waiting for/i)).toBeNull();
  });

  it('disables Begin Betting and shows the "Waiting for players" hint when 0 are seated', () => {
    const store = makeStore({
      players: [makeSeat('s0', '', 'empty')],
      hostId: 's0', selfSeatId: 's0',
    });
    renderWith(<StartButton />, store);
    const btn = screen.getByRole('button', { name: /begin betting/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/waiting for players to join/i)).toBeInTheDocument();
  });

  it('renders "Waiting for host to start…" for non-hosts', () => {
    const store = makeStore({
      players: [
        makeSeat('s0', 'Alice', 'betting'),
        makeSeat('s1', 'Bob', 'betting'),
      ],
      hostId: 's0', selfSeatId: 's1',
    });
    renderWith(<StartButton />, store);
    expect(screen.getByText(/waiting for host to start/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /begin betting/i })).toBeNull();
  });
});

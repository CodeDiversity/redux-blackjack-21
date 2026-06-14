import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { BetPanel } from '../../src/components/BetPanel';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import * as socketClient from '../../src/socket/client';
import type { GameState } from '../../src/shared/types';
import { theme } from '../../src/styles/theme';

function makeStore(opts: { phase: GameState['phase']; lastBet: number; bankroll: number; status: GameState['players'][number]['status'] }) {
  const state: GameState = {
    roomId: 'R', phase: opts.phase, shoeSize: 200, cutCardIndex: 50,
    players: [{ id: 's0', name: 'Alice', bankroll: opts.bankroll, hands: [], status: opts.status, connectedAt: 0, lastBet: opts.lastBet }],
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 1, lastResult: null,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
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

describe('<BetPanel />', () => {
  it('renders nothing outside the betting phase', () => {
    const store = makeStore({ phase: 'player_turn', lastBet: 50, bankroll: 1000, status: 'betting' });
    const { container } = renderWith(<BetPanel />, store);
    expect(container.firstChild).toBeNull();
  });

  it('shows the Place Bet input and button during betting', () => {
    const store = makeStore({ phase: 'betting', lastBet: 0, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.getByRole('button', { name: /place bet/i })).toBeInTheDocument();
  });

  it('hides the Rebet button when lastBet is 0', () => {
    const store = makeStore({ phase: 'betting', lastBet: 0, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.queryByRole('button', { name: /rebet/i })).toBeNull();
  });

  it('hides the Rebet button when lastBet exceeds bankroll', () => {
    const store = makeStore({ phase: 'betting', lastBet: 500, bankroll: 100, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.queryByRole('button', { name: /rebet/i })).toBeNull();
  });

  it('shows the Rebet button when lastBet > 0 and lastBet <= bankroll', () => {
    const store = makeStore({ phase: 'betting', lastBet: 50, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.getByRole('button', { name: /rebet \$50/i })).toBeInTheDocument();
  });

  it('emits bet:place with the last bet amount when Rebet is clicked', () => {
    const emit = vi.fn();
    vi.spyOn(socketClient, 'getSocket').mockReturnValue({ emit } as any);
    const store = makeStore({ phase: 'betting', lastBet: 75, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    fireEvent.click(screen.getByRole('button', { name: /rebet \$75/i }));
    expect(emit).toHaveBeenCalledWith('bet:place', { amount: 75 });
  });
});

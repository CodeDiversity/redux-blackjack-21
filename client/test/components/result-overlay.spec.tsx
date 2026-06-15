import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { ResultOverlay } from '../../src/components/ResultOverlay';
import type { GameState, RoundResult } from '../../src/shared/types';
import { connectionReducer } from '../../src/store/connection.slice';
import { gameReducer } from '../../src/store/game.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';

function makeStore(opts: {
  phase: GameState['phase'];
  amIHost: boolean;
  lastResult: RoundResult | null;
  phaseEndsAt?: number | null;
}) {
  const state: GameState = {
    roomId: 'R',
    phase: opts.phase,
    phaseEndsAt: opts.phaseEndsAt ?? null,
    shoeSize: 200,
    cutCardIndex: 50,
    players: [
      { id: 's0', name: 'Alice', bankroll: 1000, hands: [], status: 'stood', connectedAt: 0, lastBet: 50, activeHandIndex: 0 },
    ],
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null,
    roundNumber: 1,
    lastResult: opts.lastResult,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: opts.lastResult },
      connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: opts.amIHost ? 's0' : 's1', players: [] },
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

describe('<ResultOverlay />', () => {
  it('renders nothing when phase is not settled', () => {
    const store = makeStore({ phase: 'betting', amIHost: true, lastResult: null });
    const { container } = renderWith(<ResultOverlay />, store);
    expect(container.firstChild).toBeNull();
  });

  it('renders the payout list during settled', () => {
    const result: RoundResult = { payouts: [{ seatId: 's0', delta: 50, reason: 'win' }] };
    const store = makeStore({ phase: 'settled', amIHost: false, lastResult: result });
    renderWith(<ResultOverlay />, store);
    expect(screen.getByText(/Round Over/i)).toBeInTheDocument();
    expect(screen.getByText(/win/i)).toBeInTheDocument();
  });

  it('does not render the Next Hand button (it has been removed)', () => {
    const result: RoundResult = { payouts: [{ seatId: 's0', delta: 50, reason: 'win' }] };
    const store = makeStore({ phase: 'settled', amIHost: true, lastResult: result, phaseEndsAt: Date.now() + 3000 });
    renderWith(<ResultOverlay />, store);
    expect(screen.queryByRole('button', { name: /next hand/i })).toBeNull();
  });

  it('does not render the Next Hand button for non-hosts', () => {
    const result: RoundResult = { payouts: [{ seatId: 's0', delta: 50, reason: 'win' }] };
    const store = makeStore({ phase: 'settled', amIHost: false, lastResult: result, phaseEndsAt: Date.now() + 3000 });
    renderWith(<ResultOverlay />, store);
    expect(screen.queryByRole('button', { name: /next hand/i })).toBeNull();
  });

  it('renders the countdown line with N seconds remaining during settled', () => {
    const result: RoundResult = { payouts: [{ seatId: 's0', delta: 50, reason: 'win' }] };
    const futureMs = Date.now() + 3_000;
    const store = makeStore({ phase: 'settled', amIHost: true, lastResult: result, phaseEndsAt: futureMs });
    renderWith(<ResultOverlay />, store);
    expect(screen.getByText(/Next hand in 3…/)).toBeInTheDocument();
  });

  it('does not render the countdown line when phaseEndsAt is null', () => {
    const result: RoundResult = { payouts: [{ seatId: 's0', delta: 50, reason: 'win' }] };
    const store = makeStore({ phase: 'settled', amIHost: true, lastResult: result, phaseEndsAt: null });
    renderWith(<ResultOverlay />, store);
    expect(screen.queryByText(/Next hand in/i)).toBeNull();
  });
});

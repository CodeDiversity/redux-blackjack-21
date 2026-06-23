import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { ActionPanel } from '../../src/components/ActionPanel';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';
import type { Card, GameState, Hand, PlayerSeat } from '../../src/shared/types';

let emit: ReturnType<typeof vi.fn>;
vi.mock('../../src/socket/client', () => ({
  getSocket: () => ({ emit: (emit = vi.fn()) }),
}));

function hand(cards: Card[]): Hand {
  return { cards, bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false };
}

function makeSeat(overrides: Partial<PlayerSeat> & { id: string }): PlayerSeat {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Alice',
    bankroll: overrides.bankroll ?? 1000,
    hands: overrides.hands ?? [hand([{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }])],
    status: overrides.status ?? 'acting',
    connectedAt: 0,
    lastBet: 50,
    activeHandIndex: overrides.activeHandIndex ?? 0,
  };
}

function makeStore(opts: { players: PlayerSeat[]; activeSeat: number; selfSeatId: string }) {
  const state: GameState = {
    roomId: 'R',
    phase: 'player_turn',
    phaseEndsAt: null,
    shoeSize: 200,
    cutCardIndex: 50,
    players: opts.players,
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: opts.activeSeat,
    roundNumber: 1,
    lastResult: null,
  };
  return configureStore({
    reducer: {
      connection: connectionReducer,
      lobby: lobbyReducer,
      game: gameReducer,
      ui: uiReducer,
    },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId: opts.selfSeatId, status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: opts.selfSeatId, players: [], joinError: null },
      ui: { betInputValue: 50, lastToast: null },
    },
  } as any);
}

function renderPanel(store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <ActionPanel />
      </ThemeProvider>
    </Provider>,
  );
}

describe('<ActionPanel /> handIndex resolution', () => {
  beforeEach(() => { emit = vi.fn(); });

  it('sends handIndex from activeHandIndex, not hands.length - 1, on the post-split left hand (regression)', () => {
    // Server state: just split, server has activeHandIndex: 0 for hand 0.
    // Old client code computed hands.length - 1 = 1 and sent handIndex: 1,
    // which the server's isHandActive guard rejected with HAND_LOCKED.
    const seat = makeSeat({
      id: 's0',
      hands: [hand([{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }]), hand([{ suit: '♦', rank: '8' }, { suit: '♣', rank: '8' }])],
      activeHandIndex: 0,
    });
    const store = makeStore({ players: [seat], activeSeat: 0, selfSeatId: 's0' });
    renderPanel(store);
    fireEvent.click(screen.getByRole('button', { name: /^hit$/i }));
    expect(emit).toHaveBeenCalledWith('hand:hit', { handIndex: 0 });
  });

  it('targets hand 1 after hand 0 is stood (multi-hand walk)', () => {
    // Server has advanced activeHandIndex to 1. The client must send 1, not 0.
    const stood = { ...hand([{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }]), stood: true };
    const seat = makeSeat({
      id: 's0',
      hands: [stood, hand([{ suit: '♦', rank: '7' }, { suit: '♣', rank: '8' }])],
      activeHandIndex: 1,
    });
    const store = makeStore({ players: [seat], activeSeat: 0, selfSeatId: 's0' });
    renderPanel(store);
    fireEvent.click(screen.getByRole('button', { name: /^hit$/i }));
    expect(emit).toHaveBeenCalledWith('hand:hit', { handIndex: 1 });
  });

  it('sends handIndex 0 on a no-split hand (baseline regression)', () => {
    // The old heuristic happened to be correct here (hands.length - 1 = 0).
    // Make sure the fix does not regress this case.
    const seat = makeSeat({ id: 's0', activeHandIndex: 0 });
    const store = makeStore({ players: [seat], activeSeat: 0, selfSeatId: 's0' });
    renderPanel(store);
    fireEvent.click(screen.getByRole('button', { name: /^hit$/i }));
    expect(emit).toHaveBeenCalledWith('hand:hit', { handIndex: 0 });
  });
});
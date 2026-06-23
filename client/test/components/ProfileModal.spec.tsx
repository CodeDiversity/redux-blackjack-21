import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileModal } from '../../src/components/ProfileModal';
import { playerReducer, profileModalOpened } from '../../src/store/player.slice';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { animationReducer } from '../../src/store/animation.slice';
import { theme } from '../../src/styles/theme';

vi.mock('../../src/lib/api/profile', () => ({
  fetchProfile: vi.fn().mockResolvedValue({
    stats: { hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0, net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0 },
    streaks: { current: { kind: null, length: 0 }, longestWinStreak: 0, last10: [] },
    bySeat: [], byBet: [], achievements: [],
    recentHands: [{ id: 'h1', bet_amount: 50, outcome: 'win', net: 50, seat_index: 0, hand_index: 0, is_doubled: 0, player_total: 19, dealer_total: 17, room_code: 'R', round_number: 1, created_at: 1 }],
  }),
}));

function makeStore() {
  return configureStore({
    reducer: {
      player: playerReducer, connection: connectionReducer, lobby: lobbyReducer,
      game: gameReducer, ui: uiReducer, animation: animationReducer,
    },
  } as any);
}

const renderOpen = (store: ReturnType<typeof makeStore>) => render(
  <Provider store={store}>
    <ThemeProvider theme={theme}>
      <ProfileModal />
    </ThemeProvider>
  </Provider>,
);

describe('<ProfileModal />', () => {
  beforeEach(() => localStorage.clear());

  it('renders nothing when closed', () => {
    const store = makeStore();
    const { container } = renderOpen(store);
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal with History and Stats tabs when open', async () => {
    const store = makeStore();
    act(() => { store.dispatch(profileModalOpened()); });
    renderOpen(store);
    expect(await screen.findByText('Your Profile')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stats' })).toBeInTheDocument();
  });

  it('closes on ESC', async () => {
    const store = makeStore();
    act(() => { store.dispatch(profileModalOpened()); });
    renderOpen(store);
    await screen.findByText('Your Profile');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getState().player.isOpen).toBe(false);
  });

  it('closes when the X is clicked', async () => {
    const store = makeStore();
    act(() => { store.dispatch(profileModalOpened()); });
    renderOpen(store);
    await screen.findByText('Your Profile');
    fireEvent.click(screen.getByLabelText('Close profile'));
    expect(store.getState().player.isOpen).toBe(false);
  });

  it('switches to Stats tab and shows headline content', async () => {
    const store = makeStore();
    act(() => { store.dispatch(profileModalOpened()); });
    renderOpen(store);
    await screen.findByText('Your Profile');
    fireEvent.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(await screen.findByText('Headline')).toBeInTheDocument();
  });
});

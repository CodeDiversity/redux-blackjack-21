import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Home } from '../../src/pages/Home';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';

const mockEmit = vi.fn();
const mockOnce = vi.fn();
vi.mock('../../src/socket/client', () => ({
  getSocket: () => ({ emit: mockEmit, on: vi.fn(), off: vi.fn(), once: mockOnce }),
}));

function renderHome() {
  const store = configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
  });
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

describe('<Home> join flow', () => {
  beforeEach(() => {
    mockEmit.mockReset();
    mockOnce.mockReset();
    localStorage.clear();
  });

  it('stores the seatToken returned from room:join in localStorage so a socket reconnect can resume', async () => {
    // Regression: Home's join path used to dispatch selfSeatAssigned but
    // skip storeSeatToken, leaving localStorage empty. After a socket
    // disconnect+reconnect, Table.tsx's tryResume returns early (no token),
    // the server's room.seats still references the old socketId, and the
    // reconnected client gets NOT_YOUR_TURN on its next bet:place.
    mockEmit.mockImplementation((event: string, _payload: any, ack?: any) => {
      if (event === 'room:join' && ack) ack({ seatId: 'seat-bob', seatToken: 'tok-bob' });
    });
    renderHome();
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Bob' } });
    fireEvent.change(screen.getByPlaceholderText(/room code/i), { target: { value: 'ABCD1' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledWith(
      'room:join',
      { roomId: 'ABCD1', name: 'Bob' },
      expect.any(Function),
    ));
    expect(localStorage.getItem('bj21.seat.ABCD1')).toBe('tok-bob');
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NamePrompt } from '../../src/components/NamePrompt';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';

const mockEmit = vi.fn();
vi.mock('../../src/socket/client', () => ({
  getSocket: () => ({ emit: mockEmit, on: vi.fn(), off: vi.fn() }),
}));

function renderWith(ui: React.ReactNode) {
  const store = configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
  });
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </Provider>,
  );
}

describe('<NamePrompt>', () => {
  beforeEach(() => mockEmit.mockReset());

  it('renders a name input and a Join button', () => {
    renderWith(<NamePrompt roomCode="ABCDE" />);
    expect(screen.getByLabelText(/your name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /join/i })).toBeTruthy();
  });

  it('does not emit when the name is empty', () => {
    renderWith(<NamePrompt roomCode="ABCDE" />);
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('emits room:join with the trimmed name and stores the returned seatToken', async () => {
    mockEmit.mockImplementation((event: string, _payload: any, ack?: any) => {
      if (event === 'room:join' && ack) ack({ seatId: 'seat-1', seatToken: 'tok-1' });
    });
    renderWith(<NamePrompt roomCode="ABCDE" />);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: '  Alice  ' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledWith(
      'room:join',
      { roomId: 'ABCDE', name: 'Alice' },
      expect.any(Function),
    ));
    expect(localStorage.getItem('bj21.seat.ABCDE')).toBe('tok-1');
  });

  it('shows an inline error when the server returns an error code', async () => {
    mockEmit.mockImplementation((event: string, _payload: any, ack?: any) => {
      if (event === 'room:join' && ack) ack({ ok: false, code: 'ROOM_NOT_FOUND' });
    });
    renderWith(<NamePrompt roomCode="NOPE" />);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});

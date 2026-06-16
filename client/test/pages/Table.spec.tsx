import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { Table } from '../../src/pages/Table';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';

type Listener = (...args: any[]) => void;
const mockSocket: {
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  _listeners: Record<string, Listener[]>;
} = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  _listeners: {},
};

mockSocket.on.mockImplementation((event: string, fn: Listener) => {
  mockSocket._listeners[event] = [...(mockSocket._listeners[event] ?? []), fn];
});
mockSocket.off.mockImplementation((event: string, fn: Listener) => {
  mockSocket._listeners[event] = (mockSocket._listeners[event] ?? []).filter((f) => f !== fn);
});

vi.mock('../../src/socket/client', () => ({
  getSocket: () => mockSocket,
}));

function makeStore() {
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
  });
}

function renderAt(path: string) {
  const store = makeStore();
  const utils = render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/room/:code" element={<Table />} />
            <Route path="/" element={<div data-testid="home" />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
  return { ...utils, store };
}

describe('<Table> reconnect flow', () => {
  beforeEach(() => {
    mockSocket.emit.mockReset();
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket._listeners = {};
    localStorage.clear();
  });

  it('renders <NamePrompt> when no seat token is stored for the room', () => {
    renderAt('/room/ABCDE');
    expect(screen.getByLabelText(/your name/i)).toBeTruthy();
  });

  it('emits room:resume with the stored token when a token exists', () => {
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    renderAt('/room/ABCDE');
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'room:resume',
      { roomId: 'ABCDE', seatToken: 'tok-1' },
      expect.any(Function),
    );
  });

  it('StrictMode: only one room:resume emit on a single mount', () => {
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    const store = makeStore();
    render(
      <React.StrictMode>
        <Provider store={store}>
          <ThemeProvider theme={theme}>
            <MemoryRouter initialEntries={['/room/ABCDE']}>
              <Routes>
                <Route path="/room/:code" element={<Table />} />
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </Provider>
      </React.StrictMode>,
    );
    const resumeCalls = mockSocket.emit.mock.calls.filter((c) => c[0] === 'room:resume');
    expect(resumeCalls.length).toBe(1);
  });

  it('on SEAT_GONE error: clears storage and navigates to /', () => {
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    renderAt('/room/ABCDE');
    const errHandlers = mockSocket._listeners['error'] ?? [];
    act(() => errHandlers.forEach((h) => h({ code: 'SEAT_GONE', message: 'Seat no longer available' })));
    expect(localStorage.getItem('bj21.seat.ABCDE')).toBeNull();
    expect(screen.getByTestId('home')).toBeTruthy();
  });

  it('never calls window.prompt', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    renderAt('/room/ABCDE');
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('re-emits room:resume after a socket disconnect (so the server re-binds the seat)', () => {
    // Regression: socket auto-reconnect (e.g. after a network blip) used to
    // skip the room:resume re-emit because the ref guard made reconnect a
    // no-op. The server's room.seats entry then kept the old socketId and
    // the reconnected client got NOT_YOUR_TURN on its next bet:place.
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    renderAt('/room/ABCDE');
    const initialResumeCalls = mockSocket.emit.mock.calls.filter((c) => c[0] === 'room:resume');
    expect(initialResumeCalls.length).toBe(1);

    // Simulate a disconnect+reconnect cycle (e.g. network blip).
    act(() => {
      (mockSocket._listeners['disconnect'] ?? []).forEach((h) => h('transport close'));
      (mockSocket._listeners['connect'] ?? []).forEach((h) => h());
    });

    const afterReconnectCalls = mockSocket.emit.mock.calls.filter((c) => c[0] === 'room:resume');
    expect(afterReconnectCalls.length).toBe(2);
    // The re-emit must reuse the same stored token.
    expect(afterReconnectCalls[1]).toEqual(['room:resume', { roomId: 'ABCDE', seatToken: 'tok-1' }, expect.any(Function)]);
  });
});

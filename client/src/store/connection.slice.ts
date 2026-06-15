import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

type ConnectionState = {
  status: ConnectionStatus;
  socketId: string | null;
  selfSeatId: string | null;
  selfSeatToken: string | null;
  lastError: { code: string; message: string } | null;
};

const initial: ConnectionState = {
  status: 'idle',
  socketId: null,
  selfSeatId: null,
  selfSeatToken: null,
  lastError: null,
};

const slice = createSlice({
  name: 'connection',
  initialState: initial,
  reducers: {
    connecting(state) { state.status = 'connecting'; },
    connectionEstablished(state, action: PayloadAction<string>) {
      state.status = 'connected';
      state.socketId = action.payload;
    },
    disconnected(state) { state.status = 'disconnected'; },
    reconnecting(state) { state.status = 'reconnecting'; },
    selfSeatAssigned(state, action: PayloadAction<{ seatId: string; seatToken: string }>) {
      state.selfSeatId = action.payload.seatId;
      state.selfSeatToken = action.payload.seatToken;
    },
    selfSeatCleared(state) {
      state.selfSeatId = null;
      state.selfSeatToken = null;
    },
    errorReceived(state, action: PayloadAction<{ code: string; message: string }>) {
      state.lastError = action.payload;
    },
    errorCleared(state) { state.lastError = null; },
  },
});

export const {
  connecting, connectionEstablished, disconnected, reconnecting,
  selfSeatAssigned, selfSeatCleared, errorReceived, errorCleared,
} = slice.actions;
export const connectionReducer = slice.reducer;
export type { ConnectionState };

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type LobbyPlayer = { id: string; name: string; ready: boolean; connectedAt: number };

type LobbyState = {
  roomId: string | null;
  hostId: string | null;
  players: LobbyPlayer[];
  joinError: string | null;
};

const initial: LobbyState = { roomId: null, hostId: null, players: [], joinError: null };

const slice = createSlice({
  name: 'lobby',
  initialState: initial,
  reducers: {
    lobbyStateReceived(state, action: PayloadAction<{ roomId: string; hostId: string; players: LobbyPlayer[] }>) {
      state.roomId = action.payload.roomId;
      state.hostId = action.payload.hostId;
      state.players = action.payload.players;
    },
    joinErrorReceived(state, action: PayloadAction<string>) { state.joinError = action.payload; },
    lobbyCleared() { return initial; },
  },
});

export const { lobbyStateReceived, joinErrorReceived, lobbyCleared } = slice.actions;
export const lobbyReducer = slice.reducer;

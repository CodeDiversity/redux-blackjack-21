import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { GameState, RoundResult } from '../shared/types';

type SliceState = {
  state: GameState | null;
  lastResult: RoundResult | null;
};

const initial: SliceState = { state: null, lastResult: null };

const slice = createSlice({
  name: 'game',
  initialState: initial,
  reducers: {
    gameStateReceived(state, action: PayloadAction<GameState>) {
      state.state = action.payload;
      if (action.payload.lastResult) state.lastResult = action.payload.lastResult;
    },
    roundResultReceived(state, action: PayloadAction<RoundResult>) { state.lastResult = action.payload; },
    gameCleared() { return initial; },
  },
});

export const { gameStateReceived, roundResultReceived, gameCleared } = slice.actions;
export const gameReducer = slice.reducer;

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

type UiState = {
  betInputValue: number;
  lastToast: { code: string; message: string } | null;
};

const initial: UiState = { betInputValue: 10, lastToast: null };

const slice = createSlice({
  name: 'ui',
  initialState: initial,
  reducers: {
    betInputChanged(state, action: PayloadAction<number>) { state.betInputValue = action.payload; },
    toastShown(state, action: PayloadAction<{ code: string; message: string }>) { state.lastToast = action.payload; },
    toastCleared(state) { state.lastToast = null; },
  },
});

export const { betInputChanged, toastShown, toastCleared } = slice.actions;
export const uiReducer = slice.reducer;

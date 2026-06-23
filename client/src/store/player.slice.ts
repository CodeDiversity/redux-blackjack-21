import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ProfileResponse } from '../lib/api/profile';

type PlayerState = {
  profile: ProfileResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  isOpen: boolean;
};

const initial: PlayerState = { profile: null, status: 'idle', error: null, isOpen: false };

const slice = createSlice({
  name: 'player',
  initialState: initial,
  reducers: {
    profileLoadStarted(state) { state.status = 'loading'; state.error = null; },
    profileLoaded(state, action: PayloadAction<ProfileResponse>) {
      state.status = 'ready';
      state.profile = action.payload;
      state.error = null;
    },
    profileLoadFailed(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.error = action.payload;
    },
    profileModalOpened(state) { state.isOpen = true; },
    profileModalClosed(state) { state.isOpen = false; },
  },
});

export const {
  profileLoadStarted, profileLoaded, profileLoadFailed,
  profileModalOpened, profileModalClosed,
} = slice.actions;
export const playerReducer = slice.reducer;

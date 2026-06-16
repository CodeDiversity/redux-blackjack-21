import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

type AnimationState = {
  lastSeenRoundNumber: number | null;
};

const initial: AnimationState = { lastSeenRoundNumber: null };

const slice = createSlice({
  name: 'animation',
  initialState: initial,
  reducers: {
    roundSeen(state, action: PayloadAction<number>) {
      state.lastSeenRoundNumber = action.payload;
    },
    animationReset() {
      return initial;
    },
  },
});

export const { roundSeen, animationReset } = slice.actions;
export const animationReducer = slice.reducer;

import { describe, it, expect } from 'vitest';
import { playerReducer, profileLoaded, profileLoadStarted, profileLoadFailed, profileModalOpened, profileModalClosed } from '../../src/store/player.slice';
import type { ProfileResponse } from '../../src/lib/api/profile';

const fixture: ProfileResponse = {
  stats: { hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
           net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0 },
  streaks: { current: { kind: null, length: 0 }, longestWinStreak: 0, last10: [] },
  bySeat: [], byBet: [], achievements: [], recentHands: [],
};

describe('player.slice', () => {
  it('starts with idle / closed / no profile / no error', () => {
    const s = playerReducer(undefined, { type: '@@INIT' });
    expect(s).toEqual({ profile: null, status: 'idle', error: null, isOpen: false });
  });

  it('profileLoadStarted sets status to loading', () => {
    const s = playerReducer(undefined, profileLoadStarted());
    expect(s.status).toBe('loading');
  });

  it('profileLoaded stores the profile and sets status to ready', () => {
    const s = playerReducer(undefined, profileLoaded(fixture));
    expect(s.profile).toBe(fixture);
    expect(s.status).toBe('ready');
  });

  it('profileLoadFailed records the error', () => {
    const s = playerReducer(undefined, profileLoadFailed('boom'));
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('profileModalOpened / Closed toggle isOpen', () => {
    const opened = playerReducer(undefined, profileModalOpened());
    expect(opened.isOpen).toBe(true);
    const closed = playerReducer(opened, profileModalClosed());
    expect(closed.isOpen).toBe(false);
  });
});

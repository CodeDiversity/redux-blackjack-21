import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect } from 'vitest';
import { ProfileStatsTab } from '../../src/components/ProfileStatsTab';
import { theme } from '../../src/styles/theme';
import type { ProfileResponse } from '../../src/lib/api/profile';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const profile: ProfileResponse = {
  stats: { hands_played: 10, wins: 4, losses: 4, pushes: 1, blackjacks: 1, surrenders: 0, doubles: 2,
           net_profit: 250, biggest_win: 200, biggest_loss: -100, total_wagered: 1000 },
  streaks: { current: { kind: 'win', length: 2 }, longestWinStreak: 3, last10: ['win', 'loss', 'win', 'push', 'blackjack'] },
  bySeat: [{ seat_index: 0, hands: 6, wins: 3 }, { seat_index: 2, hands: 4, wins: 2 }],
  byBet: [{ bucket: 'small', hands: 6, wins: 3 }, { bucket: 'max', hands: 1, wins: 1 }],
  achievements: [
    { id: 'first-blackjack', name: 'Natural', description: 'Win a hand with a natural blackjack', icon: '\u{1F0A1}', earned: true, earnedAt: 1_700_000_000_000 },
    { id: 'ten-wins', name: 'Double Digits', description: 'Win 10 hands', icon: '\u{1F51F}', earned: false, earnedAt: null },
  ],
  recentHands: [],
};

describe('<ProfileStatsTab />', () => {
  it('renders the headline counts and win rate', () => {
    wrap(<ProfileStatsTab profile={profile} />);
    // "Hands" appears as a Stat label and as two table headers, so use a count
    // check that ensures the headline label is present.
    expect(screen.getAllByText('Hands').length).toBeGreaterThan(0);
    // win rate (5 wins+bj of 10 = 50%) is computed in the headline card and
    // also appears in seat/bet tables. Asserting existence with allBy* is fine.
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
    expect(screen.getByText('+250')).toBeInTheDocument(); // net profit
  });

  it('renders the streaks card with current and longest', () => {
    const { container } = wrap(<ProfileStatsTab profile={profile} />);
    expect(screen.getByText(/2-win streak/)).toBeInTheDocument();
    // "Longest win streak: 3" is split across a text node and <strong>3</strong>,
    // so the simplest reliable check is on the rendered container text content.
    const txt = container.textContent ?? '';
    expect(txt).toMatch(/Longest win streak:/);
    expect(txt).toMatch(/Longest win streak:\s*3/);
  });

  it('renders both breakdown tables', () => {
    wrap(<ProfileStatsTab profile={profile} />);
    expect(screen.getByText('Performance by seat')).toBeInTheDocument();
    expect(screen.getByText('Performance by bet size')).toBeInTheDocument();
  });

  it('renders achievements with earned and locked styling', () => {
    wrap(<ProfileStatsTab profile={profile} />);
    expect(screen.getByText('Natural')).toBeInTheDocument();
    expect(screen.getByText('Double Digits')).toBeInTheDocument();
    expect(screen.getAllByText(/Locked/)).not.toHaveLength(0);
  });
});

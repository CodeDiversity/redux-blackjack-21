import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect } from 'vitest';
import { ProfileHistoryTab } from '../../src/components/ProfileHistoryTab';
import { theme } from '../../src/styles/theme';
import type { ProfileResponse } from '../../src/lib/api/profile';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const baseProfile: ProfileResponse = {
  stats: { hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
           net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0 },
  streaks: { current: { kind: null, length: 0 }, longestWinStreak: 0, last10: [] },
  bySeat: [], byBet: [], achievements: [],
  recentHands: [],
};

describe('<ProfileHistoryTab />', () => {
  it('shows the empty state when there are no hands', () => {
    wrap(<ProfileHistoryTab profile={baseProfile} />);
    expect(screen.getByText(/No hands yet/i)).toBeInTheDocument();
  });

  it('renders one row per hand with outcome icon and net coloring', () => {
    wrap(<ProfileHistoryTab profile={{
      ...baseProfile,
      recentHands: [
        { id: 'h1', bet_amount: 100, outcome: 'win', net: 100, seat_index: 0, hand_index: 0, is_doubled: 0 as 0 | 1, player_total: 20, dealer_total: 18, room_code: 'R', round_number: 1, created_at: 1_700_000_000_000 },
        { id: 'h2', bet_amount: 50,  outcome: 'loss', net: -50, seat_index: 0, hand_index: 0, is_doubled: 0 as 0 | 1, player_total: 19, dealer_total: 20, room_code: 'R', round_number: 2, created_at: 1_700_000_500_000 },
        { id: 'h3', bet_amount: 100, outcome: 'push', net: 0, seat_index: 0, hand_index: 0, is_doubled: 0 as 0 | 1, player_total: 20, dealer_total: 20, room_code: 'R', round_number: 3, created_at: 1_700_001_000_000 },
      ],
    }} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('win')).toBeInTheDocument();
    expect(screen.getByText('loss')).toBeInTheDocument();
    expect(screen.getByText('push')).toBeInTheDocument();
    expect(screen.getByText('+100')).toBeInTheDocument();
    expect(screen.getByText('-50')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

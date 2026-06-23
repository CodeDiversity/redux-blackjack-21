export type Outcome = 'win' | 'loss' | 'push' | 'blackjack' | 'surrender';

export type ProfileResponse = {
  stats: {
    hands_played: number; wins: number; losses: number; pushes: number;
    blackjacks: number; surrenders: number; doubles: number;
    net_profit: number; biggest_win: number; biggest_loss: number; total_wagered: number;
  };
  streaks: {
    current: { kind: 'win' | 'loss' | null; length: number };
    longestWinStreak: number;
    last10: Outcome[];
  };
  bySeat: { seat_index: number; hands: number; wins: number }[];
  byBet: { bucket: 'small' | 'medium' | 'large' | 'max'; hands: number; wins: number }[];
  achievements: { id: string; name: string; description: string; icon: string; earned: boolean; earnedAt: number | null }[];
  recentHands: {
    id: string; bet_amount: number; outcome: Outcome; net: number; seat_index: number;
    hand_index: number; is_doubled: 0 | 1; player_total: number; dealer_total: number;
    room_code: string; round_number: number; created_at: number;
  }[];
};

const EMPTY: ProfileResponse = {
  stats: { hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
           net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0 },
  streaks: { current: { kind: null, length: 0 }, longestWinStreak: 0, last10: [] },
  bySeat: [],
  byBet: [],
  achievements: [],
  recentHands: [],
};

export async function fetchProfile(playerId: string): Promise<ProfileResponse> {
  const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/profile`);
  if (res.status === 404) return EMPTY;
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  return res.json() as Promise<ProfileResponse>;
}

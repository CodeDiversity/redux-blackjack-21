import styled from 'styled-components';
import type { ProfileResponse } from '../lib/api/profile';

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: ${({ theme }) => theme.spacing.lg};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  border: 1px solid ${({ theme }) => theme.colors.feltStitch};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const CardTitle = styled.h3`
  margin: 0 0 ${({ theme }) => theme.spacing.md} 0;
  font-size: ${({ theme }) => theme.typography.bodySize};
  text-transform: uppercase;
  letter-spacing: 1px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
`;

const Stat = styled.div`
  display: flex; flex-direction: column;
  font-size: ${({ theme }) => theme.typography.bodySize};
`;

const StatValue = styled.span<{ $tone?: 'win' | 'lose' | 'neutral' }>`
  font-size: ${({ theme }) => theme.typography.titleSize};
  font-weight: 600;
  color: ${({ $tone, theme }) =>
    $tone === 'win' ? theme.colors.statusWin :
    $tone === 'lose' ? theme.colors.statusLose :
    theme.colors.textPrimary};
`;

const StatLabel = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const BigRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
  margin-top: ${({ theme }) => theme.spacing.md};
  padding-top: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.entranceSurfaceAlt};
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${({ theme }) => theme.typography.bodySize};
  th, td { padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm}; text-align: left; }
  th { color: ${({ theme }) => theme.colors.textSecondary}; font-weight: 500; text-transform: uppercase; font-size: ${({ theme }) => theme.typography.smallSize}; letter-spacing: 1px; }
  tr:nth-child(odd) td { background: ${({ theme }) => theme.colors.entranceSurfaceAlt}; }
`;

const AchievementsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
`;

const AchievementTile = styled.div<{ $earned: boolean }>`
  background: ${({ theme }) => theme.colors.entranceSurfaceAlt};
  border: 1px solid ${({ $earned, theme }) => $earned ? theme.colors.statusWin : theme.colors.surfaceDimmer};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.md};
  opacity: ${({ $earned }) => $earned ? 1 : 0.55};
  filter: ${({ $earned }) => $earned ? 'none' : 'grayscale(80%)'};
  text-align: center;
`;

const AchievementIcon = styled.div`
  font-size: 32px;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const AchievementName = styled.div`
  font-weight: 600;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const AchievementDesc = styled.div`
  font-size: ${({ theme }) => theme.typography.smallSize};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const StreakLine = styled.div`
  display: flex; align-items: center; gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  font-size: ${({ theme }) => theme.typography.bodySize};
`;

const Last10 = styled.div`
  display: flex; gap: ${({ theme }) => theme.spacing.xs};
  font-size: 20px;
`;

const winRate = (w: number, total: number): string =>
  total === 0 ? '—' : `${Math.round((w / total) * 100)}%`;

const fmtMoney = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export function ProfileStatsTab({ profile }: { profile: ProfileResponse }) {
  const { stats, streaks, bySeat, byBet, achievements } = profile;
  const winPct = winRate(stats.wins + stats.blackjacks, stats.hands_played);

  const seatByIdx = new Map(bySeat.map((s) => [s.seat_index, s]));
  const betByBucket = new Map(byBet.map((b) => [b.bucket, b]));

  return (
    <Wrap>
      <Card>
        <CardTitle>Headline</CardTitle>
        <Grid>
          <Stat><StatValue>{stats.hands_played}</StatValue><StatLabel>Hands</StatLabel></Stat>
          <Stat><StatValue>{stats.wins}</StatValue><StatLabel>Wins</StatLabel></Stat>
          <Stat><StatValue>{stats.losses}</StatValue><StatLabel>Losses</StatLabel></Stat>
          <Stat><StatValue>{stats.pushes}</StatValue><StatLabel>Pushes</StatLabel></Stat>
          <Stat><StatValue>{stats.blackjacks}</StatValue><StatLabel>Blackjacks</StatLabel></Stat>
          <Stat><StatValue>{stats.doubles}</StatValue><StatLabel>Doubles</StatLabel></Stat>
        </Grid>
        <BigRow>
          <Stat><StatValue>{winPct}</StatValue><StatLabel>Win rate</StatLabel></Stat>
          <Stat>
            <StatValue $tone={stats.net_profit > 0 ? 'win' : stats.net_profit < 0 ? 'lose' : 'neutral'}>
              {fmtMoney(stats.net_profit)}
            </StatValue>
            <StatLabel>Net profit</StatLabel>
          </Stat>
          <Stat>
            <StatValue>{fmtMoney(stats.biggest_win)} / {fmtMoney(stats.biggest_loss)}</StatValue>
            <StatLabel>Biggest W / L</StatLabel>
          </Stat>
        </BigRow>
      </Card>

      <Card>
        <CardTitle>Streaks</CardTitle>
        <StreakLine>
          {streaks.current.kind === 'win' && <>{'\u{1F525}'} {streaks.current.length}-win streak</>}
          {streaks.current.kind === 'loss' && <>{'\u2744\uFE0F'} {streaks.current.length}-loss streak</>}
          {streaks.current.kind === null && <>—</>}
          <span style={{ marginLeft: 'auto' }}>Longest win streak: <strong>{streaks.longestWinStreak}</strong></span>
        </StreakLine>
        <Last10>
          {streaks.last10.map((o, i) => (
            <span key={i} title={o}>{o === 'blackjack' ? '\u{1F0A1}' : o === 'win' ? '\u2713' : o === 'loss' ? '\u2717' : o === 'push' ? '=' : '?'}</span>
          ))}
        </Last10>
      </Card>

      <Card>
        <CardTitle>Performance by seat</CardTitle>
        <Table>
          <thead><tr><th>Seat</th><th>Hands</th><th>Wins</th><th>Win %</th></tr></thead>
          <tbody>
            {Array.from({ length: 5 }, (_, i) => {
              const s = seatByIdx.get(i);
              return (
                <tr key={i}>
                  <th scope="row">Seat {i + 1}</th>
                  <td>{s?.hands ?? '—'}</td>
                  <td>{s?.wins ?? '—'}</td>
                  <td>{s ? winRate(s.wins, s.hands) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardTitle>Performance by bet size</CardTitle>
        <Table>
          <thead><tr><th>Bucket</th><th>Hands</th><th>Wins</th><th>Win %</th></tr></thead>
          <tbody>
            {(['small', 'medium', 'large', 'max'] as const).map((b) => {
              const row = betByBucket.get(b);
              return (
                <tr key={b}>
                  <th scope="row">{b === 'small' ? '10–99' : b === 'medium' ? '100–249' : b === 'large' ? '250–499' : '500'}</th>
                  <td>{row?.hands ?? '—'}</td>
                  <td>{row?.wins ?? '—'}</td>
                  <td>{row ? winRate(row.wins, row.hands) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardTitle>Achievements</CardTitle>
        <AchievementsGrid>
          {achievements.map((a) => (
            <AchievementTile key={a.id} $earned={a.earned} title={a.earned ? `Earned${a.earnedAt ? ` on ${new Date(a.earnedAt).toISOString().slice(0, 10)}` : ''}` : 'Locked'}>
              <AchievementIcon>{a.icon}</AchievementIcon>
              <AchievementName>{a.name}</AchievementName>
              <AchievementDesc>{a.description}</AchievementDesc>
              {!a.earned && <AchievementDesc><em>Locked</em></AchievementDesc>}
            </AchievementTile>
          ))}
        </AchievementsGrid>
      </Card>
    </Wrap>
  );
}
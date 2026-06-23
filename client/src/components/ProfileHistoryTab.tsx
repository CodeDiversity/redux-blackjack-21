import styled from 'styled-components';
import type { ProfileResponse } from '../lib/api/profile';

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: ${({ theme }) => theme.spacing.md};
`;

const Empty = styled.div`
  text-align: center; color: ${({ theme }) => theme.colors.textSecondary};
  padding: ${({ theme }) => theme.spacing.xl};
`;

const List = styled.ul`
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: ${({ theme }) => theme.spacing.xs};
`;

const Row = styled.li`
  display: grid;
  grid-template-columns: 36px 1fr auto auto;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: ${({ theme }) => theme.typography.bodySize};
  align-items: center;
`;

const OutcomeIcon = styled.span<{ $tone: 'win' | 'loss' | 'push' | 'bj' | 'other' }>`
  font-size: 22px;
  color: ${({ $tone, theme }) =>
    $tone === 'win' || $tone === 'bj' ? theme.colors.statusWin :
    $tone === 'loss' ? theme.colors.statusLose :
    theme.colors.textSecondary};
`;

const OutcomeLabel = styled.span`
  text-transform: capitalize;
`;

const Net = styled.span<{ $sign: 1 | -1 | 0 }>`
  color: ${({ $sign, theme }) =>
    $sign > 0 ? theme.colors.statusWin :
    $sign < 0 ? theme.colors.statusLose :
    theme.colors.textSecondary};
  font-weight: 600;
`;

const Meta = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
`;

const Pager = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: ${({ theme }) => theme.spacing.sm} 0;
`;

const PagerButton = styled.button`
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.feltStitch};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font: inherit; cursor: pointer;
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const toneFor = (outcome: string): 'win' | 'loss' | 'push' | 'bj' | 'other' => {
  if (outcome === 'win') return 'win';
  if (outcome === 'blackjack') return 'bj';
  if (outcome === 'loss') return 'loss';
  if (outcome === 'push') return 'push';
  return 'other';
};

const iconFor = (outcome: string): string => {
  if (outcome === 'blackjack') return '\u{1F0A1}';
  if (outcome === 'win') return '\u2713';
  if (outcome === 'loss') return '\u2717';
  if (outcome === 'push') return '=';
  if (outcome === 'surrender') return '\uD83C\uDFF3';
  return '?';
};

const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

export function ProfileHistoryTab({ profile }: { profile: ProfileResponse }) {
  const hands = profile.recentHands;

  if (hands.length === 0) {
    return <Empty>No hands yet. Play a round to start your history.</Empty>;
  }

  return (
    <Wrap>
      <List>
        {hands.map((h) => (
          <Row key={h.id}>
            <OutcomeIcon $tone={toneFor(h.outcome)} aria-label={h.outcome}>{iconFor(h.outcome)}</OutcomeIcon>
            <div>
              <OutcomeLabel>{h.outcome}</OutcomeLabel>
              <Meta> · bet {h.bet_amount}{h.is_doubled ? ' (doubled)' : ''} · vs dealer {h.dealer_total}</Meta>
            </div>
            <Net $sign={h.net > 0 ? 1 : h.net < 0 ? -1 : 0}>
              {h.net > 0 ? `+${h.net}` : h.net}
            </Net>
            <Meta>{fmtDate(h.created_at)}</Meta>
          </Row>
        ))}
      </List>
      <Pager>
        <PagerButton disabled>&larr; Prev</PagerButton>
        <Meta>Page 1 of 1 &middot; {hands.length} hand{hands.length === 1 ? '' : 's'}</Meta>
        <PagerButton disabled>Next &rarr;</PagerButton>
      </Pager>
    </Wrap>
  );
}

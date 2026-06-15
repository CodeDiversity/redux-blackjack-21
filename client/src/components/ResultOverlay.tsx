import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { useNow } from '../lib/useNow';
import { selectPhaseEndsAt } from '../selectors/self';
import type { RootState } from '../store';

const Modal = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  border-radius: ${({ theme }) => theme.radii.pill};
  z-index: 50;
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.feltDark};
  border: 2px solid ${({ theme }) => theme.colors.textSecondary};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.xl};
  min-width: 320px;
  text-align: center;
  box-shadow: ${({ theme }) => theme.shadows.table};
`;

const Title = styled.h2`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: ${({ theme }) => theme.typography.titleSize};
  letter-spacing: 4px;
  text-transform: uppercase;
  margin: 0 0 ${({ theme }) => theme.spacing.md};
`;

const PayoutList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const PayoutRow = styled.li<{ $tone: 'good' | 'bad' | 'neutral' | 'gold' }>`
  padding: ${({ theme }) => `${theme.spacing.xs} 0`};
  font-size: ${({ theme }) => theme.typography.bodySize};
  color: ${({ $tone, theme }) => {
    if ($tone === 'good') return theme.colors.statusWin;
    if ($tone === 'bad') return theme.colors.statusLose;
    if ($tone === 'gold') return theme.colors.statusBlackjack;
    return theme.colors.statusPush;
  }};
  font-weight: bold;
`;

const Countdown = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  margin-top: ${({ theme }) => theme.spacing.md};
`;

function formatDelta(reason: 'win' | 'lose' | 'push' | 'blackjack', delta: number): string {
  if (reason === 'push' || delta === 0) return '$0';
  const sign = delta > 0 ? '+' : '\u2212';
  return `${sign}$${Math.abs(delta)}`;
}

function toneFor(reason: 'win' | 'lose' | 'push' | 'blackjack', delta: number): 'good' | 'bad' | 'neutral' | 'gold' {
  if (reason === 'blackjack') return 'gold';
  if (reason === 'win' || delta > 0) return 'good';
  if (reason === 'lose' || delta < 0) return 'bad';
  return 'neutral';
}

function formatRemaining(phaseEndsAt: number, now: number): number {
  return Math.max(0, Math.ceil((phaseEndsAt - now) / 1000));
}

export function ResultOverlay() {
  const state = useSelector((s: RootState) => s.game.state);
  const phaseEndsAt = useSelector(selectPhaseEndsAt);
  const now = useNow(1000);
  if (!state || state.phase !== 'settled' || !state.lastResult) return null;
  const remaining = phaseEndsAt ? formatRemaining(phaseEndsAt, now) : null;
  return (
    <Modal className="result-overlay">
      <Card>
        <Title>Round Over</Title>
        <PayoutList>
          {state.lastResult.payouts.map((p) => {
            const seat = state.players.find((s) => s.id === p.seatId);
            return (
              <PayoutRow key={p.seatId} $tone={toneFor(p.reason, p.delta)}>
                {seat?.name ?? p.seatId}: {p.reason} {formatDelta(p.reason, p.delta)}
              </PayoutRow>
            );
          })}
        </PayoutList>
        {remaining !== null && <Countdown>Next hand in {remaining}…</Countdown>}
      </Card>
    </Modal>
  );
}

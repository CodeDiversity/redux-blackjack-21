import styled, { css } from 'styled-components';
import { HandView } from './HandView';
import { Bankroll } from './Bankroll';
import { BetDisplay } from './BetDisplay';
import type { PlayerSeat as Seat } from '../shared/types';

const SeatBox = styled.div<{ $active: boolean }>`
  background: ${({ theme }) => theme.colors.surfaceDim};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.md};
  ${({ $active, theme }) =>
    $active &&
    css`
      border: 2px solid ${theme.colors.surfaceBorderActive};
      box-shadow: ${theme.shadows.activeGlow};
    `}
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const Name = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-weight: bold;
  font-size: ${({ theme }) => theme.typography.bodySize};
  .me { color: ${({ theme }) => theme.colors.textDim}; font-weight: normal; }
  .turn { color: ${({ theme }) => theme.colors.textPrimary}; font-weight: bold; margin-left: 6px; }
`;

const StatusPill = styled.div<{ $tone: 'active' | 'neutral' | 'good' | 'bad' | 'gold' }>`
  background: ${({ $tone, theme }) => {
    if ($tone === 'active') return theme.colors.textPrimary;
    if ($tone === 'good') return theme.colors.statusWin;
    if ($tone === 'bad') return theme.colors.statusLose;
    if ($tone === 'gold') return theme.colors.statusBlackjack;
    return theme.colors.surfaceDimmer;
  }};
  color: ${({ $tone, theme }) => {
    if ($tone === 'active') return theme.colors.feltDark;
    if ($tone === 'neutral') return theme.colors.textPrimary;
    return theme.colors.feltDark;
  }};
  padding: 2px 8px;
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-weight: bold;
`;

const HandBlock = styled.div`
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const HandLabel = styled.div`
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const StatusText = styled.span`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

type Tone = 'active' | 'neutral' | 'good' | 'bad' | 'gold';

function pillTone(isActive: boolean, status: Seat['status']): Tone {
  if (isActive) return 'active';
  if (status === 'stood') return 'good';
  if (status === 'busted') return 'bad';
  if (status === 'blackjack') return 'gold';
  return 'neutral';
}

function pillLabel(isActive: boolean, status: Seat['status']): string {
  if (isActive) return 'Your Turn';
  if (status === 'stood') return 'Stood';
  if (status === 'busted') return 'Busted';
  if (status === 'blackjack') return 'Blackjack';
  return status.replace('_', ' ');
}

export function PlayerSeatView({ seat, isActive, isMe }: { seat: Seat; isActive: boolean; isMe: boolean }) {
  return (
    <SeatBox $active={isActive} aria-label={`seat-${seat.name}`}>
      <Header>
        <Name>
          {seat.name}
          {isMe && <span className="me"> (you)</span>}
          {isActive && <span className="turn">— Your turn</span>}
        </Name>
        <StatusPill $tone={pillTone(isActive, seat.status)}>
          {pillLabel(isActive, seat.status)}
        </StatusPill>
      </Header>
      <Bankroll amount={seat.bankroll} />
      {seat.hands.map((h, i) => (
        <HandBlock key={i}>
          {seat.hands.length > 1 && <HandLabel>Hand {i + 1}</HandLabel>}
          <HandView hand={h} />
          <BetDisplay bet={h.bet} />
          <StatusText>{seat.status}</StatusText>
        </HandBlock>
      ))}
    </SeatBox>
  );
}

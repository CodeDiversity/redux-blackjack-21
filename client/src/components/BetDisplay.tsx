import styled from 'styled-components';
import { chipColor } from '../lib/chipColor';
import { theme as defaultTheme } from '../styles/theme';
import type { AppTheme } from '../styles/theme';

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const Chip = styled.div<{ $bg: string; $to: string }>`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${({ $bg, $to }) => `linear-gradient(135deg, ${$bg} 0%, ${$to} 100%)`};
  border: 3px dashed ${({ theme }) => theme.colors.cardWhite};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.cardWhite};
  font-size: 10px;
  font-weight: bold;
  box-shadow: ${({ theme }) => theme.shadows.card};
`;

const Label = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 0.5px;
`;

export function BetDisplay({ bet }: { bet: number }) {
  if (bet === 0) return null;
  const chip = chipColor(bet, defaultTheme as AppTheme);
  return (
    <Wrapper>
      <Chip $bg={chip.from} $to={chip.to}>${bet}</Chip>
      <Label>bet</Label>
    </Wrapper>
  );
}

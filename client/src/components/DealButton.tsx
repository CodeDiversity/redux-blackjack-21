import { useSelector } from 'react-redux';
import styled, { css } from 'styled-components';
import { getSocket } from '../socket/client';
import { selectGameState, selectAmIHost } from '../selectors/self';

const Button = styled.button<{ $enabled: boolean }>`
  background: ${({ theme }) => theme.colors.textPrimary};
  color: ${({ theme }) => theme.colors.feltDark};
  border: 2px solid ${({ theme }) => theme.colors.textSecondary};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.xl}`};
  font-size: ${({ theme }) => theme.typography.largeSize};
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: ${({ theme }) => theme.shadows.cardLarge};
  transition: opacity 120ms ease;
  ${({ $enabled }) =>
    !$enabled &&
    css`
      background: ${({ theme }) => theme.colors.surfaceDimmer};
      color: ${({ theme }) => theme.colors.textDim};
      border-color: ${({ theme }) => theme.colors.surfaceBorder};
      box-shadow: none;
      cursor: not-allowed;
    `}
`;

/**
 * Host-only button shown during the betting phase. Enabled only when every
 * seated player has placed a bet. Emits `round:start` to begin dealing.
 */
export function DealButton() {
  const state = useSelector(selectGameState);
  const amHost = useSelector(selectAmIHost);
  if (!state || state.phase !== 'betting' || !amHost) return null;

  let seatedCount = 0;
  let allSeatedHaveBet = true;
  for (const p of state.players) {
    if (p.status === 'empty') continue;
    seatedCount++;
    if (p.hands[0].bet <= 0) allSeatedHaveBet = false;
  }
  const canDeal = seatedCount >= 2 && allSeatedHaveBet;

  return (
    <Button
      $enabled={canDeal}
      disabled={!canDeal}
      onClick={() => getSocket().emit('round:start')}
    >
      Deal
    </Button>
  );
}

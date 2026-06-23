import { useSelector } from 'react-redux';
import styled, { css } from 'styled-components';
import { getSocket } from '../socket/client';
import { selectMySeat } from '../selectors/self';
import { selectIsMyTurn } from '../selectors/turn';
import { makeSelectAvailableActions } from '../selectors/actions';
import type { RootState } from '../store';

const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  flex: 1;
  background: ${({ theme, $primary }) =>
    $primary ? theme.colors.textPrimary : theme.colors.surfaceDim};
  color: ${({ theme, $primary }) =>
    $primary ? theme.colors.feltDark : theme.colors.textPrimary};
  border: 1px solid
    ${({ theme, $primary }) =>
      $primary ? theme.colors.textSecondary : theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} 0`};
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 120ms ease;
  &:hover {
    ${({ $primary, theme }) =>
      !$primary &&
      css`
        background: ${theme.colors.surfaceDimmer};
      `}
  }
`;

export function ActionPanel() {
  const isMyTurn = useSelector(selectIsMyTurn);
  const me = useSelector(selectMySeat);
  const activeHandIndex = me?.activeHandIndex ?? 0;
  const selectActions = makeSelectAvailableActions(activeHandIndex);
  const actions = useSelector((s: RootState) => selectActions(s));

  if (!isMyTurn) return null;

  return (
    <Row className="action-panel">
      {actions.canHit && (
        <ActionButton
          $primary
          onClick={() => getSocket().emit('hand:hit', { handIndex: activeHandIndex })}
        >
          Hit
        </ActionButton>
      )}
      {actions.canStand && (
        <ActionButton
          onClick={() => getSocket().emit('hand:stand', { handIndex: activeHandIndex })}
        >
          Stand
        </ActionButton>
      )}
      {actions.canDouble && (
        <ActionButton
          onClick={() => getSocket().emit('hand:double', { handIndex: activeHandIndex })}
        >
          Double
        </ActionButton>
      )}
      {actions.canSplit && (
        <ActionButton
          onClick={() => getSocket().emit('hand:split', { handIndex: activeHandIndex })}
        >
          Split
        </ActionButton>
      )}
    </Row>
  );
}

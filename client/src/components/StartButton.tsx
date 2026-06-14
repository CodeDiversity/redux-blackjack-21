import { useSelector } from 'react-redux';
import styled, { css } from 'styled-components';
import { getSocket } from '../socket/client';
import { selectAmIHost } from '../selectors/self';
import { selectLobbySeats } from '../selectors/lobby';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  width: 100%;
`;

const Hint = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  text-align: center;
`;

const Waiting = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 2px;
  text-transform: uppercase;
  text-align: center;
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.xl}`};
`;

const Cta = styled.button<{ $enabled: boolean }>`
  background: linear-gradient(135deg,
    ${({ theme }) => theme.colors.goldFrom} 0%,
    ${({ theme }) => theme.colors.goldTo} 100%);
  color: ${({ theme }) => theme.colors.goldText};
  border: 1px solid ${({ theme }) => theme.colors.goldTo};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.xxl}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.largeSize};
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  min-width: 240px;
  &:hover { filter: brightness(1.08); }
  ${({ $enabled, theme }) =>
    !$enabled &&
    css`
      background: ${theme.colors.entranceSurfaceAlt};
      color: ${theme.colors.textDim};
      border-color: ${theme.colors.entranceBorder};
      cursor: not-allowed;
      box-shadow: none;
      &:hover { filter: none; }
    `}
`;

function hintText(seatedCount: number): string {
  if (seatedCount === 0) return 'Waiting for players to join…';
  if (seatedCount === 1) return 'Waiting for 1 more player…';
  return 'Waiting for all players…';
}

export function StartButton() {
  const seats = useSelector(selectLobbySeats);
  const amHost = useSelector(selectAmIHost);

  if (!amHost) {
    return <Waiting>Waiting for host to start…</Waiting>;
  }

  // selectLobbySeats may return PlayerSeat[] (with status) or LobbyPlayer[] (no
  // status). The lobby projection only contains seated players, so a missing
  // `status` is always "seated" — narrow with 'status' in s.
  const seatedCount = seats.filter((s) => ('status' in s ? s.status !== 'empty' : true)).length;
  const canStart = seatedCount >= 2;

  return (
    <Wrap>
      {!canStart && <Hint>{hintText(seatedCount)}</Hint>}
      <Cta
        $enabled={canStart}
        disabled={!canStart}
        onClick={() => getSocket().emit('round:ready')}
      >
        Begin Betting
      </Cta>
    </Wrap>
  );
}

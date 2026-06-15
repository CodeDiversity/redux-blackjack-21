import { useSelector } from 'react-redux';
import styled, { css } from 'styled-components';
import { selectLobbySeats } from '../selectors/lobby';

const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
`;

const SeatCard = styled.div<{ $seated: boolean }>`
  width: 110px;
  height: 140px;
  background: ${({ theme }) => theme.colors.entranceSurface};
  border-radius: ${({ theme }) => theme.radii.seat};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  ${({ $seated, theme }) =>
    $seated
      ? css`
          border: 2px solid ${theme.colors.seatedBorder};
          box-shadow: ${theme.shadows.seat}, ${theme.colors.seatedGlow};
        `
      : css`
          border: 2px dashed ${theme.colors.entranceBorder};
          background: transparent;
        `}
`;

const Avatar = styled.div<{ $seated: boolean }>`
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 16px;
  font-family: ${({ theme }) => theme.typography.fontFamily};
  ${({ $seated, theme }) =>
    $seated
      ? css`
          background: linear-gradient(135deg, ${theme.colors.goldFrom} 0%, ${theme.colors.goldTo} 100%);
          color: ${theme.colors.goldText};
        `
      : css`
          background: transparent;
          color: ${theme.colors.textDim};
          font-size: 28px;
        `}
`;

const Name = styled.div<{ $seated: boolean }>`
  color: ${({ $seated, theme }) => ($seated ? theme.colors.textPrimary : theme.colors.textDim)};
  font-size: ${({ theme }) => theme.typography.bodySize};
  letter-spacing: 0.5px;
  text-align: center;
`;

const Status = styled.div<{ $seated: boolean }>`
  color: ${({ $seated, theme }) => ($seated ? theme.colors.seatedBorder : theme.colors.textDim)};
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-weight: bold;
`;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PlayerList() {
  // selectLobbySeats returns PlayerSeat[] (with status) or LobbyPlayer[] (no status).
  // The lobby projection only contains seated players, so a missing `status` is
  // always "seated" — narrow with 'status' in s.
  const seats = useSelector(selectLobbySeats);
  return (
    <Row>
      {seats.map((s) => {
        const seated = 'status' in s ? s.status !== 'empty' : true;
        return (
          <SeatCard key={s.id} $seated={seated} aria-label={seated ? `seat-${s.name}` : 'empty-seat'}>
            <Avatar $seated={seated}>{seated ? initialsOf(s.name) : '+'}</Avatar>
            <Name $seated={seated}>{seated ? s.name : 'Empty Seat'}</Name>
            <Status $seated={seated}>{seated ? 'Seated' : 'Waiting'}</Status>
          </SeatCard>
        );
      })}
    </Row>
  );
}

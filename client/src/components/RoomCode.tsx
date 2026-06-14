import { useSelector } from 'react-redux';
import styled from 'styled-components';
import type { RootState } from '../store';

const Pill = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.entranceSurfaceAlt};
  border: 1px solid ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.pill};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.xl}`};
`;

const Label = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  letter-spacing: 3px;
  text-transform: uppercase;
  font-weight: bold;
`;

const Code = styled.span`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 22px;
  letter-spacing: 6px;
`;

export function RoomCode() {
  const roomId = useSelector((s: RootState) => s.lobby.roomId);
  if (!roomId) return null;
  return (
    <Pill>
      <Label>Code</Label>
      <Code>{roomId}</Code>
    </Pill>
  );
}

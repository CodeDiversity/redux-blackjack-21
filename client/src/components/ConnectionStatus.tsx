import { useSelector } from 'react-redux';
import styled from 'styled-components';
import type { RootState } from '../store';

const Banner = styled.div<{ $tone: 'green' | 'amber' | 'red' }>`
  position: fixed;
  top: ${({ theme }) => theme.spacing.md};
  left: ${({ theme }) => theme.spacing.md};
  z-index: 100;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.pill};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  text-transform: uppercase;
`;

const Dot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  display: inline-block;
`;

const TONE_MAP: Record<string, { dot: string; label: string }> = {
  connected: { dot: '#4ade80', label: 'Connected' },
  reconnecting: { dot: '#fde047', label: 'Reconnecting…' },
  disconnected: { dot: '#f87171', label: 'Disconnected' },
};

export function ConnectionStatus() {
  const status = useSelector((s: RootState) => s.connection.status);
  if (status === 'connected') return null;
  const tone = TONE_MAP[status] ?? { dot: '#94a3b8', label: `${status}…` };
  return (
    <Banner $tone="amber">
      <Dot $color={tone.dot} />
      {tone.label}
    </Banner>
  );
}

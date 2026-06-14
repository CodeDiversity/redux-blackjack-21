import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { DealerArea } from './DealerArea';
import { PlayerSeatView } from './PlayerSeat';
import { ActionPanel } from './ActionPanel';
import { BetPanel } from './BetPanel';
import { DealButton } from './DealButton';
import { ResultOverlay } from './ResultOverlay';
import type { RootState } from '../store';

const Page = styled.div`
  min-height: 100vh;
  padding: ${({ theme }) => theme.spacing.xl};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const TableSurface = styled.div`
  position: relative;
  background: radial-gradient(
    ellipse at center,
    ${({ theme }) => theme.colors.feltLight} 0%,
    ${({ theme }) => theme.colors.feltMid} 75%,
    ${({ theme }) => theme.colors.feltDark} 100%
  );
  border: 8px solid ${({ theme }) => theme.colors.feltBorder};
  border-radius: ${({ theme }) => theme.radii.pill};
  box-shadow: ${({ theme }) => theme.shadows.table};
  padding: ${({ theme }) => theme.spacing.xxl};
  width: min(1100px, 100%);
  font-family: ${({ theme }) => theme.typography.fontFamily};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Stitching = styled.div`
  position: absolute;
  top: 14px; left: 14px; right: 14px; bottom: 14px;
  border: 2px dashed ${({ theme }) => theme.colors.feltStitch};
  border-radius: ${({ theme }) => theme.radii.pill};
  pointer-events: none;
`;

const Brand = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.feltStitch};
  font-size: ${({ theme }) => theme.typography.titleSize};
  letter-spacing: 8px;
  margin: ${({ theme }) => `${theme.spacing.md} 0`};
  font-style: italic;
`;

const Seats = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: ${({ theme }) => theme.spacing.xl};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const BottomRow = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: ${({ theme }) => theme.spacing.xl};
  gap: ${({ theme }) => theme.spacing.md};
`;

const Loading = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: ${({ theme }) => theme.typography.largeSize};
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xxl};
`;

export function TableView() {
  const state = useSelector((s: RootState) => s.game.state);
  const selfSeatId = useSelector((s: RootState) => s.connection.selfSeatId);
  if (!state) return <Loading>Loading…</Loading>;
  return (
    <Page>
      <TableSurface>
        <Stitching />
        <DealerArea />
        <Brand>BLACKJACK PAYS 3 TO 2</Brand>
        <Seats>
          {state.players
            .filter((p) => p.status !== 'empty')
            .map((p) => (
              <PlayerSeatView
                key={p.id}
                seat={p}
                isActive={state.activeSeat !== null && state.players[state.activeSeat]?.id === p.id}
                isMe={p.id === selfSeatId}
              />
            ))}
        </Seats>
        <BottomRow>
          <BetPanel />
          <DealButton />
          <ActionPanel />
        </BottomRow>
        <ResultOverlay />
      </TableSurface>
    </Page>
  );
}

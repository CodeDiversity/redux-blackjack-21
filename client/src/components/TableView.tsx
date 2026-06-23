import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components';
import { MotionConfig } from 'framer-motion';
import { DealerArea } from './DealerArea';
import { PlayerSeatView } from './PlayerSeat';
import { EmptySeatTile } from './EmptySeatTile';
import { ActionPanel } from './ActionPanel';
import { BetPanel } from './BetPanel';
import { ResultOverlay } from './ResultOverlay';
import { DealAnimationDriver } from './DealAnimationDriver';
import { profileModalOpened } from '../store/player.slice';
import { ProfileModal } from './ProfileModal';
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
  width: min(1500px, 100%);
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

const HeaderRow = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  width: 100%;
`;

const ProfileButton = styled.button`
  background: rgba(255,255,255,0.08);
  color: ${({ theme }) => theme.colors.feltStitch};
  border: 1px solid ${({ theme }) => theme.colors.feltStitch};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font: inherit; cursor: pointer;
  &:hover { background: rgba(255,255,255,0.15); }
`;

const Seats = styled.div`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: ${({ theme }) => theme.spacing.xl};
  margin-top: ${({ theme }) => theme.spacing.sm};

  @media (max-width: 1100px) {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
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
  const dispatch = useDispatch();
  const isSeated = useSelector((s: RootState) => s.connection.selfSeatId !== null);
  if (!state) return <Loading>Loading…</Loading>;

  // Pre-compute each non-empty player's deal-order position (0, 1, 2, ...).
  // The dealer's position is nonEmptyPlayerCount (handled inside DealerArea).
  const dealPositionBySeatId = new Map<string, number>();
  let dealPos = 0;
  for (const p of state.players) {
    if (p.status !== 'empty') {
      dealPositionBySeatId.set(p.id, dealPos++);
    }
  }

  return (
    <Page>
      <MotionConfig reducedMotion="user">
        <TableSurface>
          <Stitching />
          <DealerArea />
          <HeaderRow>
            <Brand>BLACKJACK PAYS 3 TO 2</Brand>
            {isSeated && (
              <ProfileButton onClick={() => dispatch(profileModalOpened())} aria-label="Open your profile">
                Profile
              </ProfileButton>
            )}
          </HeaderRow>
          <Seats>
            {state.players.map((p) =>
              p.status === 'empty' ? (
                <EmptySeatTile key={p.id} />
              ) : (
                <PlayerSeatView
                  key={p.id}
                  seat={p}
                  isActive={state.activeSeat !== null && state.players[state.activeSeat]?.id === p.id}
                  isMe={p.id === selfSeatId}
                  dealPosition={dealPositionBySeatId.get(p.id) ?? 0}
                />
              ),
            )}
          </Seats>
          <BottomRow>
            <BetPanel />
            <ActionPanel />
          </BottomRow>
          <ResultOverlay />
          <DealAnimationDriver />
          <ProfileModal />
        </TableSurface>
      </MotionConfig>
    </Page>
  );
}

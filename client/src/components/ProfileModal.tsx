import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components';
import { getOrCreatePlayerId } from '../lib/player-id';
import { fetchProfile } from '../lib/api/profile';
import {
  profileLoadStarted, profileLoaded, profileLoadFailed,
  profileModalOpened, profileModalClosed,
} from '../store/player.slice';
import { ProfileHistoryTab } from './ProfileHistoryTab';
import { ProfileStatsTab } from './ProfileStatsTab';
import type { RootState } from '../store';

const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 300;
`;

const Dialog = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.surfaceDimmer};
  border-radius: ${({ theme }) => theme.radii.lg};
  box-shadow: ${({ theme }) => theme.shadows.cardLarge};
  width: min(900px, 92vw);
  max-height: 86vh;
  display: flex; flex-direction: column;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Header = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surfaceDimmer};
`;

const Title = styled.h2`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.titleSize};
`;

const Close = styled.button`
  background: none; border: 0; color: inherit; font-size: 24px; cursor: pointer;
  &:hover { color: ${({ theme }) => theme.colors.statusWin}; }
`;

const Tabs = styled.div`
  display: flex; gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.lg}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surfaceDimmer};
`;

const Tab = styled.button<{ $active: boolean }>`
  background: ${({ $active, theme }) => $active ? theme.colors.surfaceDimmer : 'transparent'};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ $active, theme }) => $active ? theme.colors.feltStitch : 'transparent'};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font: inherit; cursor: pointer;
`;

const Body = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  overflow-y: auto;
`;

const Skeleton = styled.div`
  height: 120px; border-radius: ${({ theme }) => theme.radii.md};
  background: linear-gradient(90deg,
    ${({ theme }) => theme.colors.surfaceDimmer} 0%,
    ${({ theme }) => theme.colors.surface} 50%,
    ${({ theme }) => theme.colors.surfaceDimmer} 100%);
  background-size: 200% 100%;
  animation: pulse 1.4s ease-in-out infinite;
  @keyframes pulse {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

const ErrorBox = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex; flex-direction: column; align-items: center; gap: ${({ theme }) => theme.spacing.md};
`;

const Retry = styled.button`
  background: ${({ theme }) => theme.colors.feltStitch};
  color: ${({ theme }) => theme.colors.feltDark};
  border: 0; border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font: inherit; cursor: pointer;
`;

type TabKey = 'history' | 'stats';

function loadProfile(dispatch: ReturnType<typeof useDispatch>): void {
  dispatch(profileLoadStarted());
  fetchProfile(getOrCreatePlayerId())
    .then((p) => dispatch(profileLoaded(p)))
    .catch((e) => dispatch(profileLoadFailed(String(e?.message ?? e))));
}

export function ProfileModal() {
  const dispatch = useDispatch();
  const isOpen = useSelector((s: RootState) => s.player.isOpen);
  const status = useSelector((s: RootState) => s.player.status);
  const profile = useSelector((s: RootState) => s.player.profile);
  const error = useSelector((s: RootState) => s.player.error);
  const [tab, setTab] = useState<TabKey>('history');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    dispatch(profileLoadStarted());
    fetchProfile(getOrCreatePlayerId())
      .then((p) => { if (!cancelled) dispatch(profileLoaded(p)); })
      .catch((e) => { if (!cancelled) dispatch(profileLoadFailed(String(e?.message ?? e))); });
    return () => { cancelled = true; };
  }, [isOpen, dispatch]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch(profileModalClosed()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, dispatch]);

  if (!isOpen) return null;

  return (
    <Backdrop role="presentation" onClick={() => dispatch(profileModalClosed())}>
      <Dialog role="dialog" aria-modal="true" aria-labelledby="profile-title"
              onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title id="profile-title">Your Profile</Title>
          <Close aria-label="Close profile" onClick={() => dispatch(profileModalClosed())}>×</Close>
        </Header>
        <Tabs role="tablist">
          <Tab role="tab" aria-selected={tab === 'history'} $active={tab === 'history'}
               onClick={() => setTab('history')}>History</Tab>
          <Tab role="tab" aria-selected={tab === 'stats'} $active={tab === 'stats'}
               onClick={() => setTab('stats')}>Stats</Tab>
        </Tabs>
        <Body>
          {status === 'loading' && (
            <>
              <Skeleton /><div style={{ height: 16 }} />
              <Skeleton /><div style={{ height: 16 }} />
              <Skeleton />
            </>
          )}
          {status === 'error' && (
            <ErrorBox>
              <div>Couldn't load profile{error ? `: ${error}` : ''}.</div>
              <Retry onClick={() => loadProfile(dispatch)}>Retry</Retry>
            </ErrorBox>
          )}
          {status === 'ready' && profile && tab === 'history' && <ProfileHistoryTab profile={profile} />}
          {status === 'ready' && profile && tab === 'stats' && <ProfileStatsTab profile={profile} />}
        </Body>
      </Dialog>
    </Backdrop>
  );
}

/** Convenience export so TableView can open the modal from a button. */
export const openProfileModal = profileModalOpened;

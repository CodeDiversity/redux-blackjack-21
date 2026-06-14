import { useSelector } from 'react-redux';
import { getSocket } from '../socket/client';
import { selectAmIHost } from '../selectors/self';
import type { RootState } from '../store';

export function StartButton() {
  const { players } = useSelector((s: RootState) => s.lobby);
  const amHost = useSelector(selectAmIHost);
  if (!amHost) return null;
  const canStart = players.length >= 2 && players.every((p) => p.ready);
  return (
    <button disabled={!canStart} onClick={() => getSocket().emit('round:ready')}>
      Begin Betting
    </button>
  );
}

import { useSelector } from 'react-redux';
import { getSocket } from '../socket/client';
import type { RootState } from '../store';

export function StartButton() {
  const { hostId, players } = useSelector((s: RootState) => s.lobby);
  const selfSeatId = useSelector((s: RootState) => s.connection.selfSeatId);
  if (!selfSeatId || hostId !== selfSeatId) return null;
  const canStart = players.length >= 2 && players.every((p) => p.ready);
  return (
    <button disabled={!canStart} onClick={() => getSocket().emit('round:start')}>
      Start Round
    </button>
  );
}

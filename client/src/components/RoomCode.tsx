import { useSelector } from 'react-redux';
import type { RootState } from '../store';

export function RoomCode() {
  const roomId = useSelector((s: RootState) => s.lobby.roomId);
  if (!roomId) return null;
  return (
    <div className="room-code">
      <span>Room code: </span>
      <strong>{roomId}</strong>
    </div>
  );
}

import { RoomCode } from './RoomCode';
import { PlayerList } from './PlayerList';
import { StartButton } from './StartButton';

export function Lobby() {
  return (
    <div className="lobby">
      <RoomCode />
      <PlayerList />
      <StartButton />
    </div>
  );
}

import { useSelector } from 'react-redux';
import type { RootState } from '../store';

export function PlayerList() {
  const players = useSelector((s: RootState) => s.lobby.players);
  return (
    <ul className="player-list">
      {players.map((p) => (
        <li key={p.id}>{p.name}{p.ready ? ' ✓' : ' …'}</li>
      ))}
    </ul>
  );
}

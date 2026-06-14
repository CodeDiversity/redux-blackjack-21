import { useSelector } from 'react-redux';
import { DealerArea } from './DealerArea';
import { PlayerSeatView } from './PlayerSeat';
import { ActionPanel } from './ActionPanel';
import { BetPanel } from './BetPanel';
import { DealButton } from './DealButton';
import { ResultOverlay } from './ResultOverlay';
import type { RootState } from '../store';

export function TableView() {
  const state = useSelector((s: RootState) => s.game.state);
  const selfSeatId = useSelector((s: RootState) => s.connection.selfSeatId);
  if (!state) return <div>Loading…</div>;
  return (
    <div className="table">
      <DealerArea />
      <div className="seats">
        {state.players.filter((p) => p.status !== 'empty').map((p) => (
          <PlayerSeatView
            key={p.id}
            seat={p}
            isActive={state.activeSeat !== null && state.players[state.activeSeat]?.id === p.id}
            isMe={p.id === selfSeatId}
          />
        ))}
      </div>
      <BetPanel />
      <DealButton />
      <ActionPanel />
      <ResultOverlay />
    </div>
  );
}

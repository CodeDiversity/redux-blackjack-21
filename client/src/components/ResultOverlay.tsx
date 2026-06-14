import { useSelector } from 'react-redux';
import type { RootState } from '../store';

export function ResultOverlay() {
  const state = useSelector((s: RootState) => s.game.state);
  if (!state || state.phase !== 'settled' || !state.lastResult) return null;
  return (
    <div className="result-overlay">
      <h2>Round Over</h2>
      <ul>
        {state.lastResult.payouts.map((p) => {
          const seat = state.players.find((s) => s.id === p.seatId);
          return (
            <li key={p.seatId}>
              {seat?.name ?? p.seatId}: {p.reason} {p.delta > 0 ? `+$${p.delta}` : p.delta < 0 ? `-$${Math.abs(p.delta)}` : '$0'}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

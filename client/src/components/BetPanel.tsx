import { useSelector, useDispatch } from 'react-redux';
import { getSocket } from '../socket/client';
import { betInputChanged } from '../store/ui.slice';
import type { RootState } from '../store';

export function BetPanel() {
  const phase = useSelector((s: RootState) => s.game.state?.phase);
  const bet = useSelector((s: RootState) => s.ui.betInputValue);
  const dispatch = useDispatch();

  if (phase !== 'betting') return null;

  return (
    <div className="bet-panel">
      <input
        type="number"
        min={10}
        max={500}
        value={bet}
        onChange={(e) => dispatch(betInputChanged(Number(e.target.value)))}
      />
      <button onClick={() => getSocket().emit('bet:place', { amount: bet })}>Place Bet</button>
    </div>
  );
}

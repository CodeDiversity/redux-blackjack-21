import { useSelector } from 'react-redux';
import { HandView } from './HandView';
import type { RootState } from '../store';

export function DealerArea() {
  const dealer = useSelector((s: RootState) => s.game.state?.dealer);
  if (!dealer) return null;
  return (
    <div className="dealer-area">
      <h2>Dealer</h2>
      <HandView hand={dealer} />
    </div>
  );
}

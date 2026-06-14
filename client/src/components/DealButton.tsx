import { useSelector } from 'react-redux';
import { getSocket } from '../socket/client';
import { selectGameState, selectAmIHost } from '../selectors/self';

/**
 * Host-only button shown during the betting phase. Enabled only when every
 * seated player has placed a bet. Emits `round:start` to begin dealing.
 */
export function DealButton() {
  const state = useSelector(selectGameState);
  const amHost = useSelector(selectAmIHost);
  if (!state || state.phase !== 'betting' || !amHost) return null;

  let seatedCount = 0;
  let allSeatedHaveBet = true;
  for (const p of state.players) {
    if (p.status === 'empty') continue;
    seatedCount++;
    if (p.hands[0].bet <= 0) allSeatedHaveBet = false;
  }
  const canDeal = seatedCount >= 2 && allSeatedHaveBet;

  return (
    <button disabled={!canDeal} onClick={() => getSocket().emit('round:start')}>
      Deal
    </button>
  );
}

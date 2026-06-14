import { useSelector } from 'react-redux';
import { getSocket } from '../socket/client';
import { selectIsMyTurn, selectMySeat } from '../selectors/self';
import { makeSelectAvailableActions } from '../selectors/actions';
import type { RootState } from '../store';

export function ActionPanel() {
  const isMyTurn = useSelector(selectIsMyTurn);
  const me = useSelector(selectMySeat);
  const activeHandIndex = me?.hands.length ? me.hands.length - 1 : 0;
  const selectActions = makeSelectAvailableActions(activeHandIndex);
  const actions = useSelector((s: RootState) => selectActions(s));

  if (!isMyTurn) return null;

  return (
    <div className="action-panel">
      {actions.canHit && <button onClick={() => getSocket().emit('hand:hit', { handIndex: activeHandIndex })}>Hit</button>}
      {actions.canStand && <button onClick={() => getSocket().emit('hand:stand', { handIndex: activeHandIndex })}>Stand</button>}
      {actions.canDouble && <button onClick={() => getSocket().emit('hand:double', { handIndex: activeHandIndex })}>Double</button>}
      {actions.canSplit && <button onClick={() => getSocket().emit('hand:split', { handIndex: activeHandIndex })}>Split</button>}
    </div>
  );
}

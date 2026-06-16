import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { roundSeen } from '../store/animation.slice';
import type { RootState, AppDispatch } from '../store';

/**
 * Renders nothing. Watches the game state and dispatches `roundSeen(roundNumber)`
 * the moment the deal phase lands in `player_turn` (i.e., the cards are
 * settled in their final positions server-side). This is what makes the
 * `useStaggeredReveal` hook play the animation exactly once per round.
 */
export function DealAnimationDriver() {
  const phase = useSelector((s: RootState) => s.game.state?.phase);
  const roundNumber = useSelector((s: RootState) => s.game.state?.roundNumber);
  const lastSeen = useSelector((s: RootState) => s.animation.lastSeenRoundNumber);
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    if (
      phase === 'player_turn' &&
      roundNumber !== null &&
      roundNumber !== undefined &&
      roundNumber > (lastSeen ?? 0)
    ) {
      dispatch(roundSeen(roundNumber));
    }
  }, [phase, roundNumber, lastSeen, dispatch]);

  return null;
}

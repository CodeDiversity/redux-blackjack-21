import { useSelector, useDispatch } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { betInputChanged } from '../store/ui.slice';
import { selectCanRebet, selectMyLastBet } from '../selectors/self';
import type { RootState } from '../store';

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const BetInput = styled.input`
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  width: 80px;
  &:focus { outline: 1px solid ${({ theme }) => theme.colors.textSecondary}; }
`;

const PrimaryButton = styled.button`
  background: ${({ theme }) => theme.colors.textPrimary};
  color: ${({ theme }) => theme.colors.feltDark};
  border: 1px solid ${({ theme }) => theme.colors.textSecondary};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
`;

const SecondaryButton = styled.button`
  background: ${({ theme }) => theme.colors.surfaceDim};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1px;
  cursor: pointer;
`;

export function BetPanel() {
  const phase = useSelector((s: RootState) => s.game.state?.phase);
  const bet = useSelector((s: RootState) => s.ui.betInputValue);
  const canRebet = useSelector(selectCanRebet);
  const lastBet = useSelector(selectMyLastBet);
  const dispatch = useDispatch();

  if (phase !== 'betting') return null;

  return (
    <Wrapper className="bet-panel">
      <BetInput
        aria-label="bet-panel"
        type="number"
        min={10}
        max={500}
        value={bet}
        onChange={(e) => dispatch(betInputChanged(Number(e.target.value)))}
      />
      <PrimaryButton onClick={() => getSocket().emit('bet:place', { amount: bet })}>
        Place Bet
      </PrimaryButton>
      {canRebet && (
        <SecondaryButton onClick={() => getSocket().emit('bet:place', { amount: lastBet })}>
          Rebet ${lastBet}
        </SecondaryButton>
      )}
    </Wrapper>
  );
}

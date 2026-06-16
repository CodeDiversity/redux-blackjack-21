import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { HandView } from './HandView';
import type { RootState } from '../store';

const Wrapper = styled.div`
  text-align: center;
  margin-bottom: ${({ theme }) => theme.spacing.xl};
`;

const DealerLabel = styled.div`
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 3px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

export function DealerArea() {
  const dealer = useSelector((s: RootState) => s.game.state?.dealer);
  const players = useSelector((s: RootState) => s.game.state?.players);
  if (!dealer) return null;
  // The dealer's position in the deal order is "after all seated players."
  const nonEmptyPlayerCount = players
    ? players.filter((p) => p.status !== 'empty' && p.status !== 'sitting_out').length
    : 0;
  return (
    <Wrapper>
      <DealerLabel>Dealer</DealerLabel>
      <HandView hand={dealer} isDealer handKey="dealer" dealPosition={nonEmptyPlayerCount} />
    </Wrapper>
  );
}

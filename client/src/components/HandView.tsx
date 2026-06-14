import styled from 'styled-components';
import type { Hand, CardSlot, Card } from '../shared/types';
import { handTotal } from '../lib/handTotal';

const HandRow = styled.div<{ $isDealer: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-direction: ${({ $isDealer }) => ($isDealer ? 'row' : 'row')};
  justify-content: ${({ $isDealer }) =>
    $isDealer ? 'center' : 'flex-start'};
`;

const Label = styled.div`
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const CardBase = styled.div`
  width: 56px;
  height: 80px;
  border-radius: ${({ theme }) => theme.radii.md};
  box-shadow: ${({ theme }) => theme.shadows.card};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  line-height: 1;
`;

const CardFront = styled(CardBase)<{ $red: boolean }>`
  background: ${({ theme }) => theme.colors.cardWhite};
  border: 1px solid #ccc;
  color: ${({ $red, theme }) =>
    $red ? theme.colors.cardRed : theme.colors.cardBlack};
  font-size: 18px;
  & > .suit { font-size: 28px; margin-top: 2px; }
`;

const CardBack = styled(CardBase)`
  background: repeating-linear-gradient(
    45deg,
    ${({ theme }) => theme.colors.cardBackFrom} 0px,
    ${({ theme }) => theme.colors.cardBackFrom} 6px,
    ${({ theme }) => theme.colors.cardBackTo} 6px,
    ${({ theme }) => theme.colors.cardBackTo} 12px
  );
  border: 2px solid ${({ theme }) => theme.colors.textSecondary};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 22px;
`;

const Total = styled.div<{
  $hidden: boolean;
  $blackjack: boolean;
  $bust: boolean;
}>`
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.sm}`};
  font-size: 16px;
  font-weight: bold;
  margin-left: ${({ theme }) => theme.spacing.sm};
  color: ${({ $hidden, $blackjack, $bust, theme }) => {
    if ($bust) return theme.colors.statusLose;
    if ($blackjack) return theme.colors.statusBlackjack;
    if ($hidden) return theme.colors.textPrimary;
    return theme.colors.textPrimary;
  }};
  letter-spacing: 1px;
`;

const HiddenPrefix = styled.span`
  font-size: 10px;
  font-weight: normal;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-right: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const isRedSuit = (c: Card) => c.suit === '♥' || c.suit === '♦';

function CardView({ card }: { card: CardSlot }) {
  if ('hidden' in card) {
    return <CardBack>?</CardBack>;
  }
  return (
    <CardFront $red={isRedSuit(card)}>
      <div>{card.rank}</div>
      <div className="suit">{card.suit}</div>
    </CardFront>
  );
}

export function HandView({
  hand,
  label,
  isDealer = false,
}: {
  hand: Hand;
  label?: string;
  isDealer?: boolean;
}) {
  const t = handTotal(hand);
  return (
    <div>
      {label && <Label>{label}</Label>}
      <HandRow $isDealer={isDealer}>
        {hand.cards.map((c, i) => (
          <CardView key={i} card={c} />
        ))}
        <Total $hidden={t.hasHidden} $blackjack={t.isBlackjack} $bust={t.isBust}>
          {t.hasHidden && <HiddenPrefix>Showing</HiddenPrefix>}
          {t.total}
        </Total>
      </HandRow>
    </div>
  );
}

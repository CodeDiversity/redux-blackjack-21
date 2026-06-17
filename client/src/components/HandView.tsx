import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import type { Hand, CardSlot, Card } from '../shared/types';
import { handTotal } from '../lib/handTotal';
import { useStaggeredReveal } from '../lib/useStaggeredReveal';
import {
  DEAL_CARD_INTERVAL_MS,
  DEALER_REVEAL_CARD_INTERVAL_MS,
  CARD_ENTRY_DURATION_S,
  HOLE_CARD_FLIP_DURATION_S,
  dealPositionToStartDelayMs,
} from '../lib/animation-timings';
import type { RootState } from '../store';

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

type HandViewProps = {
  hand: Hand;
  label?: string;
  isDealer?: boolean;
  handKey: string;
  dealPosition: number;
};

export function HandView({
  hand,
  label,
  isDealer = false,
  handKey,
  dealPosition,
}: HandViewProps) {
  const phase = useSelector((s: RootState) => s.game.state?.phase);
  const roundNumber = useSelector((s: RootState) => s.game.state?.roundNumber);
  const lastSeen = useSelector((s: RootState) => s.animation.lastSeenRoundNumber);

  const isNewRound = roundNumber !== null && roundNumber !== undefined && roundNumber > (lastSeen ?? 0);

  // Deal animation: 0 → hand.cards.length, DEAL_CARD_INTERVAL_MS per step.
  const dealVisible = useStaggeredReveal(
    hand.cards.length,
    `${roundNumber ?? 'init'}:deal:${handKey}`,
    DEAL_CARD_INTERVAL_MS,
    { initialCount: 0, enabled: isNewRound, startDelayMs: dealPositionToStartDelayMs(dealPosition) },
  );

  // Dealer reveal: 1 → dealer.cards.length, DEALER_REVEAL_CARD_INTERVAL_MS per step. Only meaningful for the dealer.
  const revealVisible = useStaggeredReveal(
    hand.cards.length,
    `${roundNumber ?? 'init'}:reveal:${handKey}`,
    DEALER_REVEAL_CARD_INTERVAL_MS,
    { initialCount: 1, enabled: isDealer ? isNewRound : false },
  );

  const visibleCount = isDealer && (phase === 'dealer_turn' || phase === 'settled')
    ? revealVisible
    : dealVisible;

  const t = handTotal(hand);

  // The dealer's hole card is face-down during dealing/player_turn.
  const holeHidden = isDealer && (phase === 'dealing' || phase === 'player_turn' || phase === null || phase === undefined);

  return (
    <div>
      {label && <Label>{label}</Label>}
      <HandRow $isDealer={isDealer}>
        <AnimatePresence>
          {hand.cards.slice(0, visibleCount).map((c, i) => {
            const isHole = isDealer && i === 1;
            const cardKey = isHole
              ? `${roundNumber ?? 'init'}-${handKey}-${i}-${holeHidden ? 'hidden' : 'shown'}`
              : `${roundNumber ?? 'init'}-${handKey}-${i}`;
            return (
              <motion.div
                key={cardKey}
                layout
                data-testid={isHole ? (holeHidden ? 'card-back' : 'card-front') : 'card'}
                data-card-index={i}
                initial={isHole && !holeHidden
                  ? { scale: 0.4, opacity: 0, rotateY: 180 }
                  : { scale: 0, opacity: 0 }}
                animate={isHole && !holeHidden
                  ? { scale: 1, opacity: 1, rotateY: 0 }
                  : { scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: isHole && !holeHidden ? HOLE_CARD_FLIP_DURATION_S : CARD_ENTRY_DURATION_S, ease: 'easeOut' }}
                style={{ transformStyle: 'preserve-3d' }}
              >
                <CardView card={c} />
              </motion.div>
            );
          })}
        </AnimatePresence>
        <Total $hidden={t.hasHidden} $blackjack={t.isBlackjack} $bust={t.isBust}>
          {t.hasHidden && <HiddenPrefix>Showing</HiddenPrefix>}
          {t.total}
        </Total>
      </HandRow>
    </div>
  );
}

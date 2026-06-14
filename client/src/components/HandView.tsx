import type { Hand, CardSlot } from '../shared/types';

export function HandView({ hand, label }: { hand: Hand; label?: string }) {
  return (
    <div className="hand">
      {label && <div className="hand-label">{label}</div>}
      <div className="cards">
        {hand.cards.map((c, i) => <CardView key={i} card={c} />)}
      </div>
    </div>
  );
}

function CardView({ card }: { card: CardSlot }) {
  if ('hidden' in card) return <div className="card card-back">?</div>;
  return <div className={`card rank-${card.rank} suit-${card.suit}`}>{card.rank}{card.suit}</div>;
}

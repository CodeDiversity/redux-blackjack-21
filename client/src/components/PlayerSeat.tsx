import { useSelector } from 'react-redux';
import { HandView } from './HandView';
import { Bankroll } from './Bankroll';
import { BetDisplay } from './BetDisplay';
import type { RootState } from '../store';
import type { PlayerSeat as Seat } from '../shared/types';

export function PlayerSeatView({ seat, isActive, isMe }: { seat: Seat; isActive: boolean; isMe: boolean }) {
  return (
    <div className={`player-seat ${isActive ? 'active' : ''} ${isMe ? 'me' : ''}`}>
      <h3>{seat.name}{isMe ? ' (you)' : ''}{isActive ? ' — Your turn' : ''}</h3>
      <Bankroll amount={seat.bankroll} />
      {seat.hands.map((h, i) => (
        <div key={i}>
          <HandView hand={h} label={seat.hands.length > 1 ? `Hand ${i + 1}` : undefined} />
          <BetDisplay bet={h.bet} />
          <span className="status">{seat.status}</span>
        </div>
      ))}
    </div>
  );
}

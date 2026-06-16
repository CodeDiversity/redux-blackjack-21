import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect } from 'vitest';
import { PlayerSeatView } from '../../src/components/PlayerSeat';
import { theme } from '../../src/styles/theme';
import type { PlayerSeat } from '../../src/shared/types';

function makeSeat(overrides: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id: 's0',
    name: 'Alice',
    bankroll: 1000,
    hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
    status: 'betting',
    connectedAt: 0,
    lastBet: 0,
    activeHandIndex: 0,
    ...overrides,
  };
}

function renderSeat(props: { seat: PlayerSeat; isActive: boolean; isMe: boolean }) {
  return render(
    <ThemeProvider theme={theme}>
      <PlayerSeatView {...props} />
    </ThemeProvider>,
  );
}

describe('<PlayerSeatView> turn labels', () => {
  it('shows "Your turn" hint and "Your Turn" pill when it is my turn', () => {
    renderSeat({ seat: makeSeat({ status: 'acting' }), isActive: true, isMe: true });
    expect(screen.getByText(/— Your turn/)).toBeInTheDocument();
    expect(screen.getByText('Your Turn')).toBeInTheDocument();
  });

  it('does NOT show "Your turn" hint on another player’s active seat', () => {
    renderSeat({ seat: makeSeat({ name: 'Bob', status: 'acting' }), isActive: true, isMe: false });
    expect(screen.queryByText(/— Your turn/)).not.toBeInTheDocument();
  });

  it('shows "Acting" pill on another player’s active seat', () => {
    renderSeat({ seat: makeSeat({ name: 'Bob', status: 'acting' }), isActive: true, isMe: false });
    expect(screen.getByText('Acting')).toBeInTheDocument();
  });

  it('shows the seat’s status label in the pill when the seat is not active', () => {
    renderSeat({ seat: makeSeat({ status: 'stood' }), isActive: false, isMe: false });
    expect(screen.getByText('Stood')).toBeInTheDocument();
    expect(screen.queryByText(/— Your turn/)).not.toBeInTheDocument();
  });

  it('does not duplicate the status as raw text under the hand', () => {
    // Regression: a <StatusText>{seat.status}</StatusText> span used to appear
    // under each hand, leaking technical strings like "acting" or "betting"
    // to the user. The StatusPill is the single source of truth.
    renderSeat({ seat: makeSeat({ status: 'betting' }), isActive: false, isMe: true });
    expect(screen.getAllByText('betting')).toHaveLength(1);
  });
});

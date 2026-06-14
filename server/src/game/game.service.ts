import { Injectable } from '@nestjs/common';
import { createShoe, drawCard, needsReshuffle, type Shoe } from './shoe';
import { Config } from '../config';
import type { GameState } from '../shared/types';

/** Tracks the real (server-only) shoe per room. The GameState's `shoeSize` field
 *  is a public summary; this holds the actual card list, never shipped to clients. */
@Injectable()
export class GameService {
  private shoes = new Map<string, Shoe>();

  ensureShoe(roomId: string, state: GameState): Shoe {
    let shoe = this.shoes.get(roomId);
    if (!shoe || needsReshuffle(shoe) || state.roundNumber === 0) {
      shoe = createShoe(Config.SHOE_DECKS);
      this.shoes.set(roomId, shoe);
    }
    return shoe;
  }

  draw(roomId: string): { card: Shoe['cards'][number]; shoe: Shoe } {
    const shoe = this.shoes.get(roomId);
    if (!shoe) throw new Error('shoe not initialized');
    const [card, next] = drawCard(shoe);
    this.shoes.set(roomId, next);
    return { card, shoe: next };
  }

  discardRoom(roomId: string) {
    this.shoes.delete(roomId);
  }
}

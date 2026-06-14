import { createShoe, drawCard, needsReshuffle, type Shoe } from '../src/game/shoe';
import { Config } from '../src/config';

const freshShoe = (): Shoe => createShoe(Config.SHOE_DECKS, 42);

describe('shoe', () => {
  it('createShoe produces SHOE_DECKS * 52 cards', () => {
    const shoe = freshShoe();
    expect(shoe.cards.length).toBe(Config.SHOE_DECKS * 52);
  });

  it('createShoe contains 4 of each rank per deck', () => {
    const shoe = freshShoe();
    const counts: Record<string, number> = {};
    for (const c of shoe.cards) counts[c.rank] = (counts[c.rank] ?? 0) + 1;
    for (const rank of Object.keys(counts)) {
      expect(counts[rank]).toBe(Config.SHOE_DECKS * 4);
    }
  });

  it('drawCard returns a card and decrements remaining', () => {
    const shoe = freshShoe();
    const [card, next] = drawCard(shoe);
    expect(card).toBeDefined();
    expect(next.cards.length).toBe(shoe.cards.length - 1);
  });

  it('drawCard throws on empty shoe', () => {
    let shoe: Shoe = createShoe(1, 1);
    while (shoe.cards.length > 0) {
      const [, next] = drawCard(shoe);
      shoe = next;
    }
    expect(() => drawCard(shoe)).toThrow('shoe is empty');
  });

  it('needsReshuffle is true when shoeSize falls below cutCardIndex', () => {
    const shoe: Shoe = { cards: new Array(10).fill({ suit: '♠', rank: 'A' }), cutCardIndex: 20 };
    expect(needsReshuffle(shoe)).toBe(true);
  });

  it('needsReshuffle is false when shoeSize is above cutCardIndex', () => {
    const shoe: Shoe = { cards: new Array(50).fill({ suit: '♠', rank: 'A' }), cutCardIndex: 20 };
    expect(needsReshuffle(shoe)).toBe(false);
  });

  it('createShoe places the cut card at the configured ratio', () => {
    const shoe = freshShoe();
    const expectedCut = Math.floor(shoe.cards.length * Config.CUT_CARD_POSITION_RATIO);
    expect(Math.abs(shoe.cutCardIndex - expectedCut)).toBeLessThan(5);
  });
});

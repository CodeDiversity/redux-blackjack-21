import type { Card } from '../shared/types';

export type Shoe = {
  cards: Card[];
  cutCardIndex: number;
};

export function createShoe(decks: number, seed?: number): Shoe {
  const suits: Card['suit'][] = ['♠', '♥', '♦', '♣'];
  const ranks: Card['rank'][] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of suits) for (const rank of ranks) cards.push({ suit, rank });
  }
  shuffle(cards, seed);
  const cutCardIndex = Math.floor(cards.length * 0.25);
  return { cards, cutCardIndex };
}

export function drawCard(shoe: Shoe): [Card, Shoe] {
  if (shoe.cards.length === 0) throw new Error('shoe is empty');
  const [card, ...rest] = shoe.cards;
  return [card, { cards: rest, cutCardIndex: shoe.cutCardIndex }];
}

export function needsReshuffle(shoe: Shoe): boolean {
  return shoe.cards.length < shoe.cutCardIndex;
}

// Deterministic Fisher–Yates with optional seed (mulberry32).
function shuffle<T>(arr: T[], seed?: number): T[] {
  const rand = seed == null ? Math.random : mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mulberry32(a: number) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

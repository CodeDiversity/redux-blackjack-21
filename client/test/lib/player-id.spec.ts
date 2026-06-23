import { describe, it, expect, beforeEach } from 'vitest';
import { getOrCreatePlayerId } from '../../src/lib/player-id';

describe('getOrCreatePlayerId', () => {
  beforeEach(() => localStorage.clear());

  it('generates and stores a UUID on first call', () => {
    const id = getOrCreatePlayerId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(localStorage.getItem('bj21.playerId')).toBe(id);
  });

  it('returns the same ID on subsequent calls', () => {
    const a = getOrCreatePlayerId();
    const b = getOrCreatePlayerId();
    expect(a).toBe(b);
  });

  it('generates a fresh ID after localStorage is cleared', () => {
    const a = getOrCreatePlayerId();
    localStorage.clear();
    const b = getOrCreatePlayerId();
    expect(b).not.toBe(a);
  });

  it('degrades to an in-memory ID if localStorage is unavailable', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try {
      const id = getOrCreatePlayerId();
      expect(id).toMatch(/^[0-9a-f]{8}-/i);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

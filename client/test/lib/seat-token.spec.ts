import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredSeatToken, storeSeatToken, clearStoredSeatToken } from '../../src/lib/seat-token';

describe('seat-token helpers', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a token through store/get', () => {
    storeSeatToken('ABCDE', 'token-1');
    expect(getStoredSeatToken('ABCDE')).toBe('token-1');
  });

  it('returns null for an unknown room', () => {
    expect(getStoredSeatToken('NOPE')).toBeNull();
  });

  it('clearStoredSeatToken removes the entry', () => {
    storeSeatToken('ABCDE', 'token-1');
    clearStoredSeatToken('ABCDE');
    expect(getStoredSeatToken('ABCDE')).toBeNull();
  });

  it('degrades to null when localStorage.getItem throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try {
      expect(getStoredSeatToken('ABCDE')).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('swallows errors from localStorage.setItem', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try {
      expect(() => storeSeatToken('ABCDE', 't')).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('uses the bj21.seat.<roomId> key shape', () => {
    storeSeatToken('XYZ', 't');
    expect(localStorage.getItem('bj21.seat.XYZ')).toBe('t');
  });
});

import { readPlayerIdFromHandshake } from '../../src/player/player-identity';

describe('readPlayerIdFromHandshake', () => {
  const valid = '00000000-0000-4000-8000-000000000001';

  it('accepts a valid UUID v4-shaped string', () => {
    expect(readPlayerIdFromHandshake({ playerId: valid })).toBe(valid);
  });

  it('rejects missing auth', () => {
    expect(() => readPlayerIdFromHandshake(undefined)).toThrow();
  });

  it('rejects missing playerId field', () => {
    expect(() => readPlayerIdFromHandshake({})).toThrow();
  });

  it('rejects non-string playerId', () => {
    expect(() => readPlayerIdFromHandshake({ playerId: 42 })).toThrow();
    expect(() => readPlayerIdFromHandshake({ playerId: null })).toThrow();
  });

  it('rejects malformed (not 36 chars / wrong shape)', () => {
    expect(() => readPlayerIdFromHandshake({ playerId: 'not-a-uuid' })).toThrow();
    expect(() => readPlayerIdFromHandshake({ playerId: '00000000000040008000000000000001' })).toThrow(); // 35 chars
  });
});
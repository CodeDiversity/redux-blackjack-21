const KEY_PREFIX = 'bj21.seat.';

function keyFor(roomId: string): string {
  return `${KEY_PREFIX}${roomId}`;
}

export function getStoredSeatToken(roomId: string): string | null {
  try {
    return localStorage.getItem(keyFor(roomId));
  } catch {
    return null;
  }
}

export function storeSeatToken(roomId: string, token: string): void {
  try {
    localStorage.setItem(keyFor(roomId), token);
  } catch {
    /* ignore: private mode / quota / disabled storage */
  }
}

export function clearStoredSeatToken(roomId: string): void {
  try {
    localStorage.removeItem(keyFor(roomId));
  } catch {
    /* ignore */
  }
}

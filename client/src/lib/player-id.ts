const STORAGE_KEY = 'bj21.playerId';

export function getOrCreatePlayerId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private mode, blocked). Fall back to a UUID
    // that lives only for this tab — the server will still accept it.
    return crypto.randomUUID();
  }
}

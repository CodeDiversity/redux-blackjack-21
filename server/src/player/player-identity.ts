/**
 * The PlayerId is an opaque, client-supplied identifier. Today it's a
 * localStorage UUID. Tomorrow it can be a Supabase auth.users.id, a session
 * cookie, or anything else — the rest of the server treats it as a string.
 *
 * The server NEVER trusts the client for auth; stats are derived from hands
 * this server wrote, keyed by the player_id the client claimed at the time
 * of the hand. A client can't rewrite history by changing its ID.
 */
export type PlayerId = string;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readPlayerIdFromHandshake(auth: Record<string, unknown> | undefined): PlayerId {
  const id = auth?.playerId;
  if (typeof id !== 'string' || !UUID_V4_RE.test(id)) {
    throw new Error('Missing or invalid playerId in socket auth payload');
  }
  return id;
}
# Persist Bankroll Across Server Restarts

**Date:** 2026-06-26
**Status:** Draft — pending user review

## Problem

Player bankrolls live on `PlayerSeat.bankroll` in the in-memory `GameState`
(`server/src/shared/types.ts:31`, initialized at `server/src/game/state-machine.ts:515`
with `Config.STARTING_BANKROLL`). They vanish on any server restart and on
room destruction (which happens when the last player leaves — see
`server/src/room/room.service.ts:72`). There is no row in SQLite for "this
player's bankroll"; the existing `hands` table only stores completed hand
history, not current funds.

The persistence infrastructure is already in place: `client/src/lib/player-id.ts`
generates a localStorage UUID on first visit; `server/src/player/player-identity.ts`
validates UUID-v4 in the socket auth handshake; `server/src/storage/db.ts`
initializes a `better-sqlite3` database at `Config.DB_PATH = 'data/blackjack.db'`
in WAL mode; `server/src/storage/hands.repository.ts` is the template for
repositories; `room.service.ts` already stores `playerId` on each seat
entry (lines 21, 34, 44). What's missing is the durable row + hydrate +
writeback.

## Goal

A player's bankroll survives both:

- A normal `npm run dev` restart (developer hits Ctrl+C, restarts).
- An abnormal crash (kill -9, power loss).

When the same browser returns with the same localStorage UUID and joins or
creates any room, the seat's starting bankroll is the persisted value, not
`Config.STARTING_BANKROLL`.

## Non-Goals

- Persisting room state. Rooms still vanish on destruction; only bankrolls survive.
- Persisting hands-in-progress. If the server crashes mid-hand, the hand is lost
  (and so is the seat). The player's *bankroll* reflects the last fully-completed
  write, which is correct given the requirement.
- Multi-process / multi-server bankroll consistency. The server is single-process.
- E2E coverage that duplicates what unit + integration tests already prove (see Testing).
- Login / auth. The localStorage UUID is the identity model; no password, no signup.
- New dependencies. `better-sqlite3` is already a server dependency.

## Design

### 1. New table in the existing SQLite database

Append to `SCHEMA_SQL` in `server/src/storage/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS bankrolls (
  player_id   TEXT    PRIMARY KEY,
  amount      INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

Idempotent (`IF NOT EXISTS`). No index — primary-key lookup is O(log n) and
the table will hold at most a few hundred rows in practice. The existing WAL
mode and `mkdirSync(dirname(path), { recursive: true })` from `db.ts:42`
cover the boot path.

### 2. New repository: `server/src/storage/bankroll.repository.ts`

Mirrors `hands.repository.ts`. Two functions:

```ts
export function getBankroll(playerId: string): number;
export function setBankroll(playerId: string, amount: number): void;
```

- `getBankroll`: `SELECT amount FROM bankrolls WHERE player_id = ?`. Returns
  `Config.STARTING_BANKROLL` if no row exists. Never throws on a missing row.
- `setBankroll`: `INSERT ... ON CONFLICT(player_id) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`.
  Synchronous. Atomic per call.

### 3. Hydrate on seat assignment in `room.service.ts`

Two entry points hydrate a seat's bankroll from the repo:

- `createRoom` → `assignSeat(state, seatId, hostSocketId, hostName, hostPlayerId)`
- `joinRoom` → `assignSeat(state, seatId, socketId, name, playerId)`

In each, `assignSeat` calls `getBankroll(playerId)` and overrides the seat's
default `bankroll` field on `next[idx]`.

**Implementation note:** `assignSeat` currently takes only `(state, seatId,
socketId, name)` and does not know the playerId. The implementation must
extend its signature to accept `playerId` and thread it through from both
call sites (the parameters already exist in `createRoom` and `joinRoom`'s
signatures — they're just dropped before reaching `assignSeat`).

**`resumeSeat` is intentionally NOT a hydration point.** When a reconnecting
player resumes into their old seat, the seat's in-memory bankroll (already
equal to the persisted value at last writeback) is correct. Re-hydrating
on resume would also overwrite any in-progress hand's pending changes
(the seat's bankroll has already been debited for the current round). The
simpler invariant — bankroll persists across server restart, not across
seat re-assignment — matches the stated goal and is a smaller change.

### 4. Writeback after every bankroll-changing action in `room.service.ts`

The state machine is pure; persistence is the room service's job (the same
way `hands.repository.recordHand()` is called from the gateway after
`round:resolve`, not from inside `applyAction`).

In `room.service.apply(roomId, action, draw?)`:

1. Capture a snapshot of `room.state.players.map(p => p.bankroll)` before `applyAction`.
2. Run `applyAction` as today; replace `room.state` with the new state.
3. Diff: for each seat index `i` where `prev[i] !== next[i].bankroll` AND
   `next[i].status !== 'empty'`, call `setBankroll(entry.playerId, next[i].bankroll)`
   using the `playerId` from `room.seats.get(seatId)`.

This adds persistence at the three bankroll-changing events in the state
machine today:

- `hand:double` (line 368 of `state-machine.ts`, `assignDouble`): `bankroll - hand.bet`.
- `hand:split` (line 395, `assignSplit`): `bankroll - hand.bet` for the second hand.
- `round:resolve` (line 419, via `assignSettle`): `bankroll + totalDelta` (payouts).

`bet:place` only sets `hands[0].bet` — it does NOT mutate `bankroll`. The
bankroll debit happens later when the hand is doubled, split, or resolved.
The `sitting_out` branch in `assignAdvance` (line 448) only changes status,
not bankroll.

The diff loop is action-agnostic — it fires whenever `next[i].bankroll !==
prev[i]`, regardless of which state-machine transition produced the change.
Any future state-machine transition that mutates `bankroll` is automatically
covered by the diff without changes to the persistence layer.

### 5. No client changes

The localStorage UUID already exists at `client/src/lib/player-id.ts:1-15`,
and the socket auth handshake already carries it (validated server-side by
`readPlayerIdFromHandshake` at `player-identity.ts:14`). The `bankroll`
field is already part of the `game:state` payload broadcast to clients.
No client code is touched.

### 6. No new dependencies

`better-sqlite3` is already a server dependency (see `package.json` and
`server/src/storage/db.ts:1`).

## Files touched

| File | Change |
|---|---|
| `server/src/storage/db.ts` | Append `CREATE TABLE IF NOT EXISTS bankrolls ...` to `SCHEMA_SQL`. |
| `server/src/storage/bankroll.repository.ts` | **New file.** `getBankroll`, `setBankroll`. |
| `server/src/storage/bankroll.repository.spec.ts` | **New file.** Unit tests. |
| `server/src/room/room.service.ts` | `assignSeat` loads `getBankroll(playerId)` and overrides the seat's bankroll. `apply` diffs and writebacks. |
| `server/src/room/room.service.spec.ts` (or new file) | Hydration unit tests. |

No client files. No spec changes to `server/src/shared/types.ts` — `PlayerSeat.bankroll`
stays as `number`; only its provenance changes from "always `STARTING_BANKROLL` at boot"
to "loaded from repo at assign time."

## Behavior

End-to-end after the change:

1. **First visit.** Client generates UUID, stores in `localStorage.bj21.playerId`,
   sends in socket auth. Server validates, creates socket binding.
2. **Create room.** `getBankroll(playerId)` → no row → returns `STARTING_BANKROLL = 1000`.
   Seat's bankroll = 1000. Player places a bet of 50 → state machine reduces bankroll
   to 950 → diff detects 1000 → 950 → `setBankroll(playerId, 950)`. First SQLite
   row created.
3. **Hand resolves (host wins +60 net).** State machine reduces bankroll to 1010.
   Diff detects 950 → 1010 → `setBankroll(playerId, 1010)`. Row updated.
4. **Server restarted (Ctrl+C, `npm run dev` again).** `initDb()` opens the same
   `data/blackjack.db`, runs `SCHEMA_SQL` (idempotent — bankrolls table exists).
5. **Player returns, opens a new room.** `getBankroll(playerId)` → row exists →
   returns `1010`. Seat's bankroll = 1010. Persistence goal achieved.

## Risks

- **Same playerId in two browser tabs.** Both tabs read the same bankroll on
  assign and write back independently. The second tab's stale snapshot would
  overwrite the first tab's writes if both place bets in quick succession.
  Mitigation: this is "one user, two tabs" — not a multi-user race. The player
  wins or loses in one tab, sees the (correct) result in the other within one
  round. No defensive coding; this matches existing behavior of the hands
  table.
- **Seat-token reuse by a different playerId.** `resumeSeat` currently trusts
  `seatToken` as proof of identity. After this change, the seat's in-memory
  bankroll is not re-hydrated on resume (see Decision in §3). A token thief
  would see the legitimate player's current round bankroll. This is **pre-existing**
  behavior — token-based auth is the current model — and is out of scope.
- **Crash between `applyAction` returning and `setBankroll` running.** Window
  is microseconds (synchronous code in the same handler turn). Last fully-completed
  write is what survives. Acceptable per the goal.
- **`data/blackjack.db` manually deleted.** All bankrolls reset to
  `STARTING_BANKROLL`. Same blast radius as today's `hands` table. Not defended.
- **No writeback on `leaveRoom`.** If a player leaves with bankroll $X, the
  last `setBankroll` call (from the most recent action) already wrote $X.
  No additional writeback needed. Verified by walking the state-machine
  transitions.

## Testing

### Unit — `server/src/storage/bankroll.repository.spec.ts`

Mirror `hands.repository.spec.ts`. Use `:memory:` or a temp path via
`initDb({ dbPath })`.

- `getBankroll(unknownId)` returns `Config.STARTING_BANKROLL`.
- After `setBankroll(id, 800)`, `getBankroll(id)` returns `800`.
- Two calls to `setBankroll(id, ...)` — second wins (UPSERT semantics).
- Different playerIds are independent.

### Unit — `room.service` hydration

Extend the existing `room.service.spec.ts` (or new file if one doesn't exist):

- `createRoom` with a playerId that has a persisted `$800` → assert seat's
  `bankroll === 800` on the returned state.
- `createRoom` with no persisted row → assert seat's `bankroll === STARTING_BANKROLL`.
- `joinRoom` with a persisted `$600` → assert seat's `bankroll === 600`.

### Integration — writeback after actions

Extend `gateway-early-deal.spec.ts` (or new `gateway-bankroll-persistence.spec.ts`):

- Two-player room. Host bets 50 and resolves a hand. Query `bankrolls` table
  directly: assert row exists with `amount` equal to the post-round bankroll.
- Restart simulation: `initDb` with the same path after closing the previous
  handle. `createRoom` with the same `hostPlayerId` → assert the new seat's
  bankroll matches what was persisted.

### E2E (Playwright) — only if needed

The existing `profile.spec.ts` exercises the playerId flow but doesn't cover
persistence specifically. A persistence E2E would:

- Play a hand; assert the seat chip / display shows a net change.
- `page.reload()`.
- Re-open or re-join a room with the same UUID.
- Assert the displayed bankroll matches the pre-reload value.

**Decision deferred to implementation:** if the UI displays bankroll in a
pre-round screen (lobby header, seat chip), the E2E is worth adding. If
bankroll is only visible mid-round or in the profile modal, the integration
test is sufficient and the E2E is skipped (no unique coverage).

### What is NOT tested

- Multi-process races (project is single-process).
- Disk-full or file-lock failures (same as today; we don't downgrade the
  reliability contract for the existing `hands` table either).
- Concurrent writes from the same playerId in two rooms (covered under Risks;
  not a regression vs. today).

## Out of scope for follow-up

If bankroll persistence lands cleanly and we want to extend it later, the
natural follow-ups are:

- A `bankroll_history` table (every change, not just current value) — useful
  for a "net worth over time" chart in the profile modal.
- A "reset bankroll" admin endpoint for testing.
- Server-side enforcement that a playerId can't be reused across two simultaneous
  rooms (would require a `sessions` table).

None of these is part of this spec.

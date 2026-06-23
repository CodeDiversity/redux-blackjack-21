# Hand history & stats — design

**Date:** 2026-06-23
**Status:** Draft, awaiting user review
**Supersedes:** n/a
**Parent spec:** n/a

## Problem

The blackjack game has no record of past play. A player who plays 20 hands, refreshes, and rejoins has no way to see their last hand, let alone their win rate, biggest win, or hand history. The game has hit/stand/double/split and payouts, but no persistence of historical data — bankroll is in-memory and lost on disconnect.

The user wants:

- A **hand history** they can scroll through (most recent first).
- A **stats view** with headline numbers (W/L/Push, blackjacks, biggest win/loss, net profit), per-seat and per-bet-size performance, current and longest win streaks, and a small set of achievements.
- Data **persists across server restarts** so the user's progress isn't lost.
- The path stays open for a future real-auth integration (e.g., Supabase).

## Goal

Ship a profile modal in v1 that shows the player's lifetime hand history and derived stats. Data lives in a single SQLite table on the server. A thin identity layer owns the "opaque player ID" abstraction so a future Supabase swap is one file, not a data-model migration.

The change is additive: no changes to the game state machine, gateway, or existing components beyond (a) writing a row in `payout.ts` on hand resolution and (b) reading the player ID in the socket handshake.

## Non-Goals

- Current bankroll in the profile (requires reconciling in-memory game state with DB; profile shows net_profit for now).
- Hand replay UI. Card data is stored so a future replay feature can use it, but no replay UI is built.
- Public profiles, leaderboards, or any way to view another player's stats.
- Persistent bankroll across sessions. Separate feature, larger scope.
- Migrations tooling. `CREATE TABLE IF NOT EXISTS` is enough for v1.
- Real authentication. The player ID is client-claimed and unauthenticated for v1. Supabase migration is a future swap.
- A new game lobby, room system, or any new multiplayer feature.
- Insurance, surrender, multi-deck shoe, or other rule changes. (The schema leaves room for `outcome = 'surrender'` but no UI emits it.)
- Per-user preferences or settings panels.
- Mobile-specific design beyond what the existing components already do.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Storage | SQLite via `better-sqlite3`, single file at `server/data/blackjack.db` | User OK with adding a DB; better-sqlite3 is sync (no async overhead in a NestJS handler), zero-config, no migration tooling needed for v1. Future migrations can be added without changing this file. |
| Storage layer | Raw SQL in a thin repository; no ORM | The schema is one table. An ORM would be more code than the queries it saves. |
| Stats approach | Derive on read from the hand history table | Data model is one table; stats are always consistent; aggregation cost is negligible at this volume. Can denormalize later if a real-time use case appears. |
| Player identity | Stable UUID v4 in `localStorage`, opaque to the server | Solves the name-collision problem; the server stores it as a string and never trusts it for auth. Future Supabase swap replaces the ID source, not the data model. |
| Player ID abstraction | One file: `server/src/player/player-identity.ts` | Single boundary for the future Supabase swap. The rest of the server treats the ID as an opaque string. |
| Modal placement | Button in TableView header → opens a modal with History + Stats tabs | User chose this. Conventional, doesn't disrupt the table layout. |
| Achievements | Static TypeScript registry; predicates evaluated in-process | All predicates are 1-3 lines of TypeScript; SQL would be less readable. The hand data is already loaded for the streaks computation; no extra query. |
| Pagination | 20 hands per page, server-side `LIMIT`/`OFFSET` | Server-side pagination keeps the response small; the modal only ever renders one page. |
| Card data in the table | JSON strings in a single column, not normalized into a `cards` table | Hands are frozen records; we never query individual cards. Inline storage keeps the table small and the read fast. |
| Test strategy | Layered: server unit (storage, identity, achievements), server integration (controller), client unit (modal, slice, lib), E2E (play + open modal) | Each layer has a distinct scope; no duplication. |
| Modal accessibility | Focus trap, ESC closes, real `<table>` elements with `<th scope>`, color is never the only signal | Standard a11y hygiene; no new patterns. |
| Styling | Existing CSS modules, no new framework, no new dependencies | The existing components use CSS modules; ProfileModal follows the same pattern. |

## Architecture

Three new boundaries, two surgical changes.

### New: storage layer

```
server/src/storage/
├── db.ts                # better-sqlite3 connection + idempotent bootstrap
└── hands.repository.ts  # write + aggregate queries
```

`db.ts` exports a singleton `Database` instance. On first import, it runs the `CREATE TABLE IF NOT EXISTS` for `hands` plus the five indexes. Subsequent imports are no-ops. The DB path is read from `config.ts` (default `server/data/blackjack.db`).

`hands.repository.ts` exposes:

```ts
recordHand(hand: NewHand): void                          // single-row insert
getPlayerStats(playerId: string): PlayerStats            // 1 SQL: headline counts + sums
getRecentHands(playerId: string, limit: number, offset: number): HandSummary[]  // paginated
getPerformanceBySeat(playerId: string): SeatBreakdown[]  // 1 SQL: GROUP BY seat_index
getPerformanceByBetSize(playerId: string): BetBucket[]   // 1 SQL: GROUP BY CASE bucket
getAllHandsForStreaks(playerId: string): HandSummary[]   // small list, loaded once for streak math
```

The streak computations (current + longest) walk the full list in TypeScript — a single in-memory pass, no SQL gymnastics. At the worst-case volume (a few thousand hands) this is sub-millisecond.

### New: player module

```
server/src/player/
├── player.module.ts
├── player.controller.ts        # GET /api/players/:playerId/profile
├── player-identity.ts          # opaque ID abstraction
└── achievements.ts             # registry + predicate helpers
```

`player-identity.ts` owns the ID abstraction:

```ts
export type PlayerId = string;
export const PLAYER_ID_HEADER = 'x-player-id';

export function readPlayerIdFromHandshake(auth: Record<string, unknown> | undefined): PlayerId {
  const id = auth?.playerId;
  if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) return id;
  throw new Error('Missing or invalid playerId in socket auth payload');
}
```

The handshake is the only place the abstraction lives. When Supabase replaces localStorage, this file changes from "validate a localStorage-issued UUID" to "validate a Supabase JWT, extract the user id." Nothing else moves.

`player.controller.ts` is one endpoint:

```
GET /api/players/:playerId/profile
→ {
    stats: { hands_played, wins, losses, pushes, blackjacks, surrenders, doubles,
             net_profit, biggest_win, biggest_loss, total_wagered },
    streaks: { current: { kind: 'win' | 'loss' | null, length: number },
               longestWinStreak: number,
               last10: Outcome[] },
    bySeat:   [{ seat_index, hands, wins }, ...],
    byBet:    [{ bucket: 'small' | 'medium' | 'large' | 'max', hands, wins }, ...],
    achievements: [{ id, name, description, icon,
                     earned: boolean,
                     earnedAt: ISO8601 | null }, ...],
    recentHands: [{ id, bet_amount, outcome, net, seat_index, hand_index, is_doubled,
                    player_total, dealer_total, room_code, round_number, created_at }, ...]
  }
```

`achievements[i].earnedAt` is derived on read: it's the timestamp of the earliest hand that satisfies the predicate. For example, `first-blackjack.earnedAt` = the `created_at` of the player's first hand with `outcome = 'blackjack'`. Each achievement's predicate returns both `boolean` and a `Date | null` (the relevant hand timestamp, or `null` if never earned). This avoids a separate `player_achievements` table while still showing "earned on" dates in the UI.

All derived in one call. ~6 SQL queries. The client makes one round trip when the modal opens.

### New: client modal

```
client/src/
├── components/
│   ├── ProfileModal.tsx           # modal shell, tab switching, fetch
│   ├── ProfileHistoryTab.tsx      # paginated list
│   └── ProfileStatsTab.tsx        # 5 card subcomponents
├── lib/
│   ├── player-id.ts               # getOrCreatePlayerId()
│   └── api/profile.ts             # fetchProfile(playerId)
└── store/
    └── player.slice.ts            # loaded profile + open/closed state
```

`player-id.ts` is 10 lines:

```ts
const STORAGE_KEY = 'bj21.playerId';
export function getOrCreatePlayerId(): string {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
```

Used in `socket/index.ts` (passed in `auth` payload) and in `lib/api/profile.ts` (read directly to build the request URL).

### Surgical: payout writes a hand row

`server/src/game/payout.ts` resolves a hand as it does today. The new step, at the end of resolution:

```ts
handsRepository.recordHand({
  id: randomUUID(),
  player_id: playerId,        // from socket handshake
  bet_amount: hand.bet,
  outcome: deriveOutcome(hand, dealer),
  net: computeNet(hand, dealer),
  seat_index: playerSeatIndex,
  hand_index: hand.handIndex,
  is_doubled: hand.wasDoubled ? 1 : 0,
  player_total: bestTotal(hand),
  dealer_total: dealer.total,
  player_cards: JSON.stringify(hand.cards),
  dealer_cards: JSON.stringify(dealer.cards),
  room_code: room.code,
  round_number: room.roundNumber,
  created_at: Date.now(),
});
```

If the write fails, the in-memory bankroll is still updated (the existing path). The hand row is the only casualty. No rollback, no error to the player — this is a non-critical audit log.

### Surgical: gateway reads the player ID

`server/src/gateway/game.gateway.ts` calls `readPlayerIdFromHandshake(client.handshake.auth)` on `connection` and stores the ID on a per-connection map keyed by socket id. The room service looks up the ID by socket when wiring a player into a room, and threads it into the `RoomPlayer` record. The payout path receives the ID via the player record on the resolved hand. No other code path needs to know about it.

A client that connects without an ID is rejected. The client always sends one; this is defense-in-depth.

## Data model

One table. Five indexes. No joins, no migrations, no ORM.

```sql
CREATE TABLE IF NOT EXISTS hands (
  id              TEXT    PRIMARY KEY,
  player_id       TEXT    NOT NULL,
  bet_amount      INTEGER NOT NULL,
  outcome         TEXT    NOT NULL,        -- 'win' | 'loss' | 'push' | 'blackjack' | 'surrender'
  net             INTEGER NOT NULL,
  seat_index      INTEGER NOT NULL,
  hand_index      INTEGER NOT NULL DEFAULT 0,
  is_doubled      INTEGER NOT NULL DEFAULT 0,
  player_total    INTEGER NOT NULL,
  dealer_total    INTEGER NOT NULL,
  player_cards    TEXT    NOT NULL,        -- JSON: [{suit, rank}, ...]
  dealer_cards    TEXT    NOT NULL,        -- JSON
  room_code       TEXT    NOT NULL,
  round_number    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL         -- unix epoch ms
);

CREATE INDEX IF NOT EXISTS idx_hands_player_created   ON hands (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hands_player_outcome   ON hands (player_id, outcome);
CREATE INDEX IF NOT EXISTS idx_hands_player_seat      ON hands (player_id, seat_index);
CREATE INDEX IF NOT EXISTS idx_hands_player_bet       ON hands (player_id, bet_amount);
CREATE INDEX IF NOT EXISTS idx_hands_room             ON hands (room_code, round_number);
```

### Outcome semantics

| Outcome | Net calculation | When |
|---|---|---|
| `blackjack` | `+ floor(bet * 1.5)` | Natural 21 on first two cards, not split |
| `win` | `+ bet` | Player total > dealer total, no bust |
| `loss` | `- bet` | Player total < dealer total, OR player busts |
| `push` | `0` | Player total == dealer total |
| `surrender` | `- floor(bet / 2)` | Reserved for v2; not emitted in v1 |

A doubled hand is a `win`/`loss` with `is_doubled = 1` and `bet_amount` set to the doubled wager. Splits produce one row per sub-hand with the same `round_number` and a distinct `hand_index`.

### Format assumptions

`player_id` is assumed to be a UUID v4 (36 chars, hex + dashes) for v1. The handshake validator enforces this. If the future Supabase swap changes the format, the validation rule changes too; existing rows become orphaned (acceptable cost — Supabase migration is a one-time event).

`outcome` is one of the five enum values; the write path validates against this enum before insert.

`player_cards` and `dealer_cards` are JSON strings (not blobs), formatted as `[{ "suit": "♠", "rank": "A" }, ...]`. The shape matches the existing `Card` type in the shared module.

## UI

### Trigger

A `Profile` button next to the player's name in the TableView header. Visible only when the player is seated.

### Modal

- Backdrop click closes. ESC closes. Focus trap on open. Body scroll locked. `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the title.
- Two tabs along the top: `History` (default), `Stats`. `role="tablist"`, arrow-key navigation, `aria-selected` on the active tab.
- Close (×) button top-right.

### History tab

Paginated list, 20 per page, most recent first. Each row:

```
[icon]  Blackjack / Win / Loss / Push   bet: 100   net: +150   vs dealer 21  ·  2026-06-23 14:02
```

- Icon: outcome-specific (🂡 BJ, ✓ win, ✗ loss, = push, 🏳 surrender)
- Net colored green for positive, red for negative, gray for zero
- "Next page" / "Prev page" at the bottom; "Showing 21-40 of 137" caption
- Empty state: "No hands yet. Play a round to start your history."

### Stats tab

Five cards, in order:

1. **Headline** (full width) — Hands played, Wins, Losses, Pushes, Blackjacks, Doubles. Big row: Net profit, Biggest win, Biggest loss. Win rate as a percentage.
2. **Streaks** — Current streak ("🔥 3-win streak" / "❄️ 2-loss streak" / "—"), longest win streak, last 10 outcomes as a small icon row.
3. **Performance by seat** — `<table>` of seat → hands → wins → win %, rows for seats that have hands.
4. **Performance by bet size** — `<table>` of bucket → hands → wins → win %, all four buckets shown (zero-hand buckets render with em-dashes).
5. **Achievements** (full width) — Grid of 6 tiles, 3 per row. Earned: full color, name, description, earned date. Locked: grayscale, name, "Locked" label.

### Loading & error states

- Loading: skeleton cards in the modal body. No spinner.
- Error: "Couldn't load profile" + Retry button.
- On every modal open: refetch. No caching across opens.

### Accessibility

- Real `<table>` elements with `<th scope="row">` and `<th scope="col">` for the per-seat and per-bet tables.
- Color is never the only signal: outcome icon + text label + color.
- Focus trap, ESC, backdrop, scroll lock.

## Testing

### Server unit

- `storage/db.spec.ts` — bootstrap creates the table, is idempotent, indexes are present.
- `storage/hands.repository.spec.ts` — write/read round-trip, JSON card columns round-trip, pagination.
- `storage/stats.repository.spec.ts` — three fixtures (empty / single hand / mixed history of 10+ hands), each aggregation matches expected output.
- `player/achievements.spec.ts` — each predicate has positive and negative cases; `longestWinStreak` and `hadWinAfter3LossStreak` have targeted tests.
- `player/player-identity.spec.ts` — valid UUID v4 accepted, missing rejected, malformed rejected, non-string rejected.

### Server integration

- `player/player.controller.spec.ts` — full `GET /api/players/:playerId/profile` round trip with seeded hands.

### Client unit

- `lib/player-id.spec.ts` — first call generates, subsequent calls return same ID, after `localStorage.clear()` a new ID is generated.
- `store/player.slice.spec.ts` — `setProfile`, `setOpen`, lifecycle.
- `components/ProfileModal.spec.tsx` — opens, switches tabs, closes on ESC, closes on backdrop, focus trap.
- `components/ProfileHistoryTab.spec.tsx` — paginates, empty state, outcome icons and colors.
- `components/ProfileStatsTab.spec.tsx` — five cards from a fixture profile, locked vs earned.
- `lib/api/profile.spec.ts` — happy path, network error, 404 (empty profile, not an error).

### Server change coverage

- `game/payout.spec.ts` — one new assertion: after resolution, a row exists in `hands` with the right `outcome`, `net`, `is_doubled`. Real sqlite file in a temp dir; not mocked.
- `gateway/game.gateway.spec.ts` — one new test: socket with `auth.playerId` has the ID available downstream; socket without it is rejected.

### E2E

- `client/e2e/profile.spec.ts` — two tabs join, play 3 hands, each opens the profile modal, sees 3 hands in History, sees the right counts in Stats. Screenshot both tab states.

## Files touched

### New (server)

- `server/src/storage/db.ts`
- `server/src/storage/hands.repository.ts`
- `server/src/player/player.module.ts`
- `server/src/player/player.controller.ts`
- `server/src/player/player-identity.ts`
- `server/src/player/achievements.ts`

### New (client)

- `client/src/components/ProfileModal.tsx`
- `client/src/components/ProfileHistoryTab.tsx`
- `client/src/components/ProfileStatsTab.tsx`
- `client/src/lib/player-id.ts`
- `client/src/lib/api/profile.ts`
- `client/src/store/player.slice.ts`

### Modified (server)

- `server/src/config.ts` — add `dbPath` config
- `server/src/game/payout.ts` — write hand row on resolution
- `server/src/gateway/game.gateway.ts` — read `auth.playerId`, attach to socket
- `server/src/app.module.ts` — import `PlayerModule`, run DB bootstrap on boot
- `server/package.json` — `+ better-sqlite3`, `+ @types/better-sqlite3`

### Modified (client)

- `client/src/socket/index.ts` — pass `playerId` in `auth` payload
- `client/src/components/TableView.tsx` — add Profile button + modal mount

### New tests (server)

- `server/test/storage/db.spec.ts`
- `server/test/storage/hands.repository.spec.ts`
- `server/test/storage/stats.repository.spec.ts`
- `server/test/player/achievements.spec.ts`
- `server/test/player/player-identity.spec.ts`
- `server/test/player/player.controller.spec.ts`

### New tests (client)

- `client/test/lib/player-id.spec.ts`
- `client/test/lib/api/profile.spec.ts`
- `client/test/store/player.slice.spec.ts`
- `client/test/components/ProfileModal.spec.tsx`
- `client/test/components/ProfileHistoryTab.spec.tsx`
- `client/test/components/ProfileStatsTab.spec.tsx`
- `client/e2e/profile.spec.ts`

### Modified tests (server)

- `server/test/game/payout.spec.ts` — 1 new assertion
- `server/test/gateway/game.gateway.spec.ts` — 1 new test

### No changes

- `server/src/game/state-machine.ts` — untouched
- `server/src/game/game.service.ts` — untouched (payout is the only hand-resolution sink)
- `client/src/store/game.slice.ts` — untouched
- All existing components except `TableView.tsx`
- All existing E2E specs

## Dependencies added

- **Server:** `better-sqlite3`, `@types/better-sqlite3` (dev).
- **Client:** none. `crypto.randomUUID()` is in every modern browser.

## Out of scope / open questions

- **Current bankroll in profile** — the bankroll is in-memory; profile shows `net_profit` instead. Adding bankroll is a separate feature.
- **Hand replay** — card data is stored, no UI is built.
- **Public profiles / leaderboards** — not in v1.
- **Persistent bankroll across sessions** — separate feature.
- **Migrations tooling** — `CREATE TABLE IF NOT EXISTS` is enough for v1.
- **Real authentication** — Supabase migration is a future swap. The ID abstraction is designed for it.
- **Insurance, surrender, multi-deck shoe, dealer-hits-soft-17 toggle** — schema has room (`outcome = 'surrender'`), UI does not.
- **A test that asserts the `player_id` format in old rows after a hypothetical Supabase swap** — would be brittle; deferred until the swap is real.

## Risk

- **Low:** DB bootstrap is idempotent. No migration ordering risk.
- **Low:** The payout write is a single new line inside the existing resolution critical section. If it fails, the in-memory bankroll is still updated; the worst case is a missing hand row, recoverable by replaying the day's logs.
- **Medium:** The player ID abstraction is a soft contract. A future Supabase swap that changes the ID format orphans existing `hands.player_id` rows. Mitigation: one-line comment in the schema noting the format assumption; we accept the migration cost when the time comes.
- **Low:** ProfileModal is the first new component on TableView in this project. It uses the same modal CSS pattern the existing ErrorToast uses. No new patterns.
- **Low:** The achievement list is a static registry. Adding a new achievement is one entry in `achievements.ts`; no migration.

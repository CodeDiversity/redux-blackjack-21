# Hand History & Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a profile modal showing the player's lifetime hand history and derived stats (win/loss/push, blackjacks, biggest win/loss, per-seat and per-bet performance, streaks, achievements), backed by a persistent SQLite store on the server.

**Architecture:** A new `storage` module owns a single SQLite database (better-sqlite3) with one `hands` table. A thin `player-identity` module owns the opaque player ID abstraction (localStorage UUID v4 today, swappable to Supabase auth later). The gateway reads the player ID from the socket handshake, threads it into the room, and writes a hand history row on each round settlement. A new `PlayerController` exposes `GET /api/players/:playerId/profile` which derives stats from the hand history in one round trip. The client adds a `playerId` slice, a profile API helper, and a modal with two tabs (History, Stats).

**Tech Stack:**
- Server: NestJS, better-sqlite3 (sync driver), Jest
- Client: React 18, Redux Toolkit, styled-components, vitest, Playwright
- No new client deps; `crypto.randomUUID()` is in all modern browsers

**Spec:** [`docs/superpowers/specs/2026-06-23-hand-history-and-stats-design.md`](../specs/2026-06-23-hand-history-and-stats-design.md)

---

## File Structure

### New (server)

| File | Responsibility |
|---|---|
| `server/src/storage/db.ts` | better-sqlite3 connection; idempotent `CREATE TABLE` + index bootstrap |
| `server/src/storage/hands.repository.ts` | `recordHand` (insert) + `getRecentHands` (paginated) |
| `server/src/storage/stats.repository.ts` | `getPlayerStats`, `getPerformanceBySeat`, `getPerformanceByBetSize`, `getAllHandsForStreaks` |
| `server/src/player/player-identity.ts` | `readPlayerIdFromHandshake(auth)` — opaque ID validator |
| `server/src/player/achievements.ts` | `ACHIEVEMENTS` registry + predicate helpers (`longestWinStreak`, `hadWinAfter3LossStreak`, etc.) |
| `server/src/player/player.controller.ts` | `GET /api/players/:playerId/profile` |
| `server/src/player/player.module.ts` | Nest module wiring the controller + injecting repositories |

### New (client)

| File | Responsibility |
|---|---|
| `client/src/lib/player-id.ts` | `getOrCreatePlayerId()` — localStorage UUID v4 |
| `client/src/lib/api/profile.ts` | `fetchProfile(playerId)` — REST client |
| `client/src/store/player.slice.ts` | `{ profile, status, error, isOpen }` state + reducers |
| `client/src/components/ProfileModal.tsx` | Modal shell, tab switching, fetch lifecycle |
| `client/src/components/ProfileHistoryTab.tsx` | Paginated hand list |
| `client/src/components/ProfileStatsTab.tsx` | 5 stat cards |

### Modified

- `server/src/config.ts` — add `dbPath` (default `server/data/blackjack.db`)
- `server/src/app.module.ts` — import `PlayerModule`, call `initDb()` on boot
- `server/src/gateway/game.gateway.ts` — read `auth.playerId`, reject if missing, thread into room, write hand rows on settle
- `server/src/room/room.service.ts` — `playerId` field on seat entries; new `getPlayerIdForSeat(roomId, seatId)` accessor
- `client/src/socket/client.ts` — pass `auth: { playerId }` to `io()`
- `client/src/components/TableView.tsx` — add `Profile` button + mount `<ProfileModal />`
- `client/src/store/index.ts` — register `playerReducer`
- `server/package.json` — `+ better-sqlite3`, `+ @types/better-sqlite3` (dev)
- `.gitignore` — add `server/data/`

### New tests

- `server/test/storage/db.spec.ts`
- `server/test/storage/hands.repository.spec.ts`
- `server/test/storage/stats.repository.spec.ts`
- `server/test/player/player-identity.spec.ts`
- `server/test/player/achievements.spec.ts`
- `server/test/player/player.controller.spec.ts`
- `client/test/lib/player-id.spec.ts`
- `client/test/lib/api/profile.spec.ts`
- `client/test/store/player.slice.spec.ts`
- `client/test/components/ProfileModal.spec.tsx`
- `client/test/components/ProfileHistoryTab.spec.tsx`
- `client/test/components/ProfileStatsTab.spec.tsx`
- `client/e2e/profile.spec.ts`

### Modified tests

- `server/test/payout.spec.ts` — unchanged (the hand-row write is verified in the gateway integration test)
- `server/test/integration/5-seat.spec.ts` — one new assertion: after settle, the `hands` table has the expected rows (verified via direct repo read)
- `client/test/components/TableView.spec.tsx` — register `playerReducer` in the test store

---

## Phase A — Storage foundation

### Task A1: Add better-sqlite3 dependency and dbPath config

**Files:**
- Modify: `server/package.json`
- Modify: `server/src/config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Install better-sqlite3 and its types**

Run from repo root:
```bash
cd server && npm install --save better-sqlite3 && npm install --save-dev @types/better-sqlite3 && cd ..
```

Expected: `server/package.json` shows `"better-sqlite3"` in `dependencies` and `"@types/better-sqlite3"` in `devDependencies`. `server/node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists.

- [ ] **Step 2: Add dbPath to server config**

Edit `server/src/config.ts`. Add one line at the end of the `Config` object:
```ts
DB_PATH: process.env.DB_PATH ?? 'data/blackjack.db',
```

So the full file reads:
```ts
export const Config = {
  PORT: Number(process.env.PORT ?? 3001),
  SEAT_COUNT: 5,
  MIN_BET: 10,
  MAX_BET: 500,
  STARTING_BANKROLL: 1000,
  SHOE_DECKS: 6,
  CUT_CARD_POSITION_RATIO: 0.25,
  DEALER_STANDS_ON_SOFT_17: true,
  DOUBLE_AFTER_SPLIT: true,
  RESPLIT_ACES: false,
  BLACKJACK_PAYOUT_NUMERATOR: 3,
  BLACKJACK_PAYOUT_DENOMINATOR: 2,
  DISCONNECT_GRACE_MS: 30_000,
  ROOM_CODE_LENGTH: 5,
  SETTLE_PAUSE_MS: 3_000,
  BET_DEADLINE_MS: 10_000,
  DEALING_DURATION_MS: 2_000,
  DB_PATH: process.env.DB_PATH ?? 'data/blackjack.db',
} as const;
```

- [ ] **Step 3: Add `server/data/` to .gitignore**

Read the current `.gitignore`, then append:
```
server/data/
```

- [ ] **Step 4: Verify build compiles**

Run: `cd server && npx tsc --noEmit`
Expected: no errors. The `Config.DB_PATH` field is added; no consumers yet.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json server/src/config.ts .gitignore
git commit -m "feat(server): add better-sqlite3 dependency and dbPath config"
```

### Task A2: Implement db.ts with idempotent bootstrap

**Files:**
- Create: `server/src/storage/db.ts`
- Create: `server/test/storage/db.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/storage/db.spec.ts`:
```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { initDb, getDb } from '../../src/storage/db';

describe('storage/db', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-db-'));
  });

  afterEach(() => {
    try { getDb().close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
    // Reset the module cache so each test gets a fresh singleton.
    jest.resetModules();
  });

  it('creates the hands table and indexes on a fresh DB', () => {
    const dbPath = join(dir, 'blackjack.db');
    initDb({ dbPath });
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='hands'"
    ).all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('hands');

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='hands'"
    ).all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining([
      'idx_hands_player_created',
      'idx_hands_player_outcome',
      'idx_hands_player_seat',
      'idx_hands_player_bet',
      'idx_hands_room',
    ]));
  });

  it('is idempotent — running init twice does not throw', () => {
    const dbPath = join(dir, 'blackjack.db');
    initDb({ dbPath });
    expect(() => initDb({ dbPath })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx jest test/storage/db.spec.ts`
Expected: FAIL with "Cannot find module '../../src/storage/db'".

- [ ] **Step 3: Implement db.ts**

Create `server/src/storage/db.ts`:
```ts
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { Config } from '../config';

let _db: DB | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS hands (
  id              TEXT    PRIMARY KEY,
  player_id       TEXT    NOT NULL,
  bet_amount      INTEGER NOT NULL,
  outcome         TEXT    NOT NULL,
  net             INTEGER NOT NULL,
  seat_index      INTEGER NOT NULL,
  hand_index      INTEGER NOT NULL DEFAULT 0,
  is_doubled      INTEGER NOT NULL DEFAULT 0,
  player_total    INTEGER NOT NULL,
  dealer_total    INTEGER NOT NULL,
  player_cards    TEXT    NOT NULL,
  dealer_cards    TEXT    NOT NULL,
  room_code       TEXT    NOT NULL,
  round_number    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hands_player_created   ON hands (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hands_player_outcome   ON hands (player_id, outcome);
CREATE INDEX IF NOT EXISTS idx_hands_player_seat      ON hands (player_id, seat_index);
CREATE INDEX IF NOT EXISTS idx_hands_player_bet       ON hands (player_id, bet_amount);
CREATE INDEX IF NOT EXISTS idx_hands_room             ON hands (room_code, round_number);
`;

export type InitDbOptions = { dbPath: string };

export function initDb(opts: InitDbOptions = { dbPath: resolveDbPath() }): DB {
  const path = isAbsolute(opts.dbPath) ? opts.dbPath : resolve(process.cwd(), opts.dbPath);
  mkdirSync(dirname(path), { recursive: true });
  if (_db) _db.close();
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.exec(SCHEMA_SQL);
  return _db;
}

export function getDb(): DB {
  if (!_db) _db = initDb();
  return _db;
}

/** Test-only: drop the singleton so the next getDb() opens a fresh connection. */
export function _resetDbForTests(): void {
  if (_db) { _db.close(); _db = null; }
}

function resolveDbPath(): string {
  return Config.DB_PATH;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx jest test/storage/db.spec.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/storage/db.ts server/test/storage/db.spec.ts
git commit -m "feat(server): add storage db with idempotent SQLite bootstrap"
```

### Task A3: Implement hands.repository.ts (write path)

**Files:**
- Create: `server/src/storage/hands.repository.ts`
- Create: `server/test/storage/hands.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/storage/hands.repository.spec.ts`:
```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, _resetDbForTests } from '../../src/storage/db';
import { recordHand, getRecentHands } from '../../src/storage/hands.repository';

function freshDb() {
  _resetDbForTests();
  const dir = mkdtempSync(join(tmpdir(), 'bj21-hands-'));
  initDb({ dbPath: join(dir, 'blackjack.db') });
  return dir;
}

const baseHand = {
  player_id: '00000000-0000-4000-8000-000000000001',
  bet_amount: 100,
  outcome: 'win' as const,
  net: 100,
  seat_index: 0,
  hand_index: 0,
  is_doubled: 0,
  player_total: 20,
  dealer_total: 18,
  player_cards: JSON.stringify([{ suit: '♠', rank: 'K' }, { suit: '♥', rank: 'Q' }]),
  dealer_cards: JSON.stringify([{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '8' }]),
  room_code: 'ABCDE',
  round_number: 1,
  created_at: 1_700_000_000_000,
};

describe('hands.repository', () => {
  let dir: string;
  beforeEach(() => { dir = freshDb(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); _resetDbForTests(); });

  it('recordHand inserts a row that round-trips through getRecentHands', () => {
    const id = 'hand-1';
    recordHand({ id, ...baseHand });
    const rows = getRecentHands(baseHand.player_id, 20, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id, bet_amount: 100, outcome: 'win', net: 100, seat_index: 0,
      player_total: 20, dealer_total: 18, room_code: 'ABCDE', round_number: 1,
    });
  });

  it('getRecentHands orders newest-first by created_at', () => {
    recordHand({ id: 'h1', ...baseHand, created_at: 1_000 });
    recordHand({ id: 'h2', ...baseHand, created_at: 3_000 });
    recordHand({ id: 'h3', ...baseHand, created_at: 2_000 });
    const ids = getRecentHands(baseHand.player_id, 20, 0).map((r) => r.id);
    expect(ids).toEqual(['h2', 'h3', 'h1']);
  });

  it('getRecentHands respects limit and offset', () => {
    for (let i = 0; i < 5; i++) recordHand({ id: `h${i}`, ...baseHand, created_at: i });
    const page1 = getRecentHands(baseHand.player_id, 2, 0);
    const page2 = getRecentHands(baseHand.player_id, 2, 2);
    expect(page1.map((r) => r.id)).toEqual(['h4', 'h3']);
    expect(page2.map((r) => r.id)).toEqual(['h2', 'h1']);
  });

  it('JSON card columns round-trip cleanly', () => {
    const cards = [{ suit: '♠' as const, rank: 'A' as const }, { suit: '♥' as const, rank: 'K' as const }];
    recordHand({ id: 'bj', ...baseHand, player_cards: JSON.stringify(cards), outcome: 'blackjack', net: 150 });
    const row = getRecentHands(baseHand.player_id, 1, 0)[0];
    expect(JSON.parse(row.player_cards)).toEqual(cards);
  });

  it('filters by player_id', () => {
    recordHand({ id: 'mine', ...baseHand });
    recordHand({ id: 'other', ...baseHand, player_id: '00000000-0000-4000-8000-000000000002' });
    const rows = getRecentHands(baseHand.player_id, 20, 0);
    expect(rows.map((r) => r.id)).toEqual(['mine']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx jest test/storage/hands.repository.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement hands.repository.ts**

Create `server/src/storage/hands.repository.ts`:
```ts
import { randomUUID } from 'crypto';
import { getDb } from './db';

export type Outcome = 'win' | 'loss' | 'push' | 'blackjack' | 'surrender';

export type NewHand = {
  id?: string;
  player_id: string;
  bet_amount: number;
  outcome: Outcome;
  net: number;
  seat_index: number;
  hand_index: number;
  is_doubled: 0 | 1;
  player_total: number;
  dealer_total: number;
  player_cards: string;  // JSON
  dealer_cards: string;  // JSON
  room_code: string;
  round_number: number;
  created_at: number;
};

export type HandRow = NewHand & { id: string };

const INSERT_SQL = `
INSERT INTO hands (
  id, player_id, bet_amount, outcome, net, seat_index, hand_index, is_doubled,
  player_total, dealer_total, player_cards, dealer_cards, room_code, round_number, created_at
) VALUES (
  @id, @player_id, @bet_amount, @outcome, @net, @seat_index, @hand_index, @is_doubled,
  @player_total, @dealer_total, @player_cards, @dealer_cards, @room_code, @round_number, @created_at
)
`;

export function recordHand(hand: NewHand): void {
  const row: HandRow = { id: hand.id ?? randomUUID(), ...hand };
  getDb().prepare(INSERT_SQL).run(row);
}

const RECENT_SQL = `
SELECT id, player_id, bet_amount, outcome, net, seat_index, hand_index, is_doubled,
       player_total, dealer_total, player_cards, dealer_cards, room_code, round_number, created_at
FROM hands
WHERE player_id = ?
ORDER BY created_at DESC
LIMIT ? OFFSET ?
`;

export function getRecentHands(playerId: string, limit: number, offset: number): HandRow[] {
  return getDb().prepare(RECENT_SQL).all(playerId, limit, offset) as HandRow[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx jest test/storage/hands.repository.spec.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/storage/hands.repository.ts server/test/storage/hands.repository.spec.ts
git commit -m "feat(server): add hands repository with write and paginated read"
```

---

## Phase B — Player identity

### Task B1: Implement player-identity.ts (server-side abstraction)

**Files:**
- Create: `server/src/player/player-identity.ts`
- Create: `server/test/player/player-identity.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/player/player-identity.spec.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx jest test/player/player-identity.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement player-identity.ts**

Create `server/src/player/player-identity.ts`:
```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx jest test/player/player-identity.spec.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/player/player-identity.ts server/test/player/player-identity.spec.ts
git commit -m "feat(server): add player-identity opaque ID abstraction"
```

### Task B2: Add playerId to Room seat entries

**Files:**
- Modify: `server/src/room/room.service.ts`

- [ ] **Step 1: Find the SeatEntry type definition**

In `server/src/room/room.service.ts`, find the local `Room` and seat-entry type (around line 18-22). It currently looks like:
```ts
const room: Room = {
  id: roomId,
  state,
  seats: new Map([[seatId, { socketId: hostSocketId, seatId, seatToken, name: hostName }]]),
};
```

- [ ] **Step 2: Add playerId to the seat entry shape**

Replace the three `seats.set(...)` and `seats: new Map([...])` calls in `createRoom`, `joinRoom`, and `resumeSeat` to thread a `playerId` field. The shape becomes:
```ts
{ socketId, seatId, seatToken, name, playerId }
```

Update `createRoom` to accept and store `playerId`:
```ts
createRoom(hostSocketId: string, hostName: string, hostPlayerId: string): { roomId: string; seatId: string; seatToken: string; state: GameState } {
  const roomId = this.uniqueRoomId();
  const state = createInitialState(roomId, Config.SEAT_COUNT);
  const seatId = randomUUID();
  const seatToken = randomUUID();
  this.assignSeat(state, seatId, hostSocketId, hostName);
  const room: Room = {
    id: roomId,
    state,
    seats: new Map([[seatId, { socketId: hostSocketId, seatId, seatToken, name: hostName, playerId: hostPlayerId }]]),
  };
  this.rooms.set(roomId, room);
  return { roomId, seatId, seatToken, state };
}
```

Update `joinRoom` similarly — its signature gains `playerId: string` and the seat entry gains `playerId: joinerPlayerId`.

Update `resumeSeat` — its signature gains `playerId: string` and the entry's `playerId` is updated to the resumed player's ID:
```ts
resumeSeat(roomId: string, seatToken: string, newSocketId: string, playerId: string): { seatId: string; state: GameState } {
  const room = this.rooms.get(roomId);
  if (!room) throw new GameError('ROOM_NOT_FOUND');
  const entry = [...room.seats.values()].find((e) => e.seatToken === seatToken);
  if (!entry) throw new GameError('SEAT_GONE');
  entry.socketId = newSocketId;
  entry.playerId = playerId;
  return { seatId: entry.seatId, state: room.state };
}
```

- [ ] **Step 3: Add a playerId accessor**

Append a new method to `RoomService` (place it next to `findSeatByToken`):
```ts
getPlayerIdForSeat(roomId: string, seatId: string): string | undefined {
  const room = this.rooms.get(roomId);
  if (!room) return undefined;
  return room.seats.get(seatId)?.playerId;
}
```

- [ ] **Step 4: Verify build compiles**

Run: `cd server && npx tsc --noEmit`
Expected: errors in `game.gateway.ts` (the call sites of `createRoom`, `joinRoom`, `resumeSeat` no longer match). These are fixed in Task B3.

- [ ] **Step 5: Commit (gateway broken; commit anyway to checkpoint the room change)**

```bash
git add server/src/room/room.service.ts
git commit -m "refactor(server): add playerId to room seat entries"
```

### Task B3: Update gateway to read playerId from handshake and thread it

**Files:**
- Modify: `server/src/gateway/game.gateway.ts`
- Modify: `server/test/integration/5-seat.spec.ts` (1 new assertion)

- [ ] **Step 1: Update the gateway imports**

In `server/src/gateway/game.gateway.ts`, add:
```ts
import { readPlayerIdFromHandshake } from '../player/player-identity';
```

- [ ] **Step 2: Add a per-connection playerId map**

In the `GameGateway` class, add a new field next to `socketToRoom`:
```ts
private socketToPlayerId = new Map<string, string>();
```

- [ ] **Step 3: Read playerId in handleConnection and reject if missing**

Replace the existing `handleConnection`:
```ts
handleConnection(client: Socket) {
  let playerId: string;
  try {
    playerId = readPlayerIdFromHandshake(client.handshake.auth);
  } catch (e) {
    this.log.warn(`rejecting ${client.id}: ${(e as Error).message}`);
    client.emit('error', { code: 'AUTH_REQUIRED', message: 'playerId missing or invalid' });
    client.disconnect(true);
    return;
  }
  this.socketToPlayerId.set(client.id, playerId);
  this.log.log(`connect ${client.id} (playerId ${playerId})`);
}
```

- [ ] **Step 4: Clean up the map on disconnect**

Replace the existing `handleDisconnect` to also delete from `socketToPlayerId`:
```ts
handleDisconnect(client: Socket) {
  this.log.log(`disconnect ${client.id}`);
  this.socketToPlayerId.delete(client.id);
  const roomId = this.socketToRoom.get(client.id);
  // ... existing body unchanged ...
}
```

(Place the new line at the very top, before the existing body.)

- [ ] **Step 5: Thread playerId into createRoom / joinRoom / resumeSeat**

In `onCreate`, change the `createRoom` call:
```ts
const { roomId, seatId, seatToken, state } = this.rooms.createRoom(
  client.id, body.name.trim(), this.socketToPlayerId.get(client.id)!,
);
```

In `onJoin`:
```ts
const { seatId, seatToken, state } = this.rooms.joinRoom(
  body.roomId, client.id, body.name.trim(), this.socketToPlayerId.get(client.id)!,
);
```

In `onResume`:
```ts
const { seatId, state } = this.rooms.resumeSeat(
  body.roomId, body.seatToken, client.id, this.socketToPlayerId.get(client.id)!,
);
```

- [ ] **Step 6: Verify build compiles**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the existing integration test to confirm it still passes**

Run: `cd server && npx jest test/integration/5-seat.spec.ts`
Expected: PASS. The existing test does not send `auth.playerId`, so it will now hit the rejection path. Update the test to send the auth (next step). For now, run it and confirm the failure mode.

If it fails with the rejection path, that confirms the new auth check is wired up. Proceed to step 8.

- [ ] **Step 8: Update existing tests to pass playerId in the socket auth AND isolate the DB**

In `server/test/integration/5-seat.spec.ts`, add an import at the top:
```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
```

Replace the `beforeAll` to set a per-file temp DB path and the `afterAll` to clean it up:
```ts
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bj21-5seat-'));
  process.env.DB_PATH = join(dir, 'blackjack.db');
  // Force a fresh module graph so the new DB_PATH is picked up by AppModule.
  jest.resetModules();
  const { AppModule } = require('../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.enableCors({ origin: '*', credentials: true });
  await app.listen(0);
  const addr = app.getHttpServer().address();
  url = `http://localhost:${addr.port}`;
});
```

Update the `connect` helper to send `auth`:
```ts
async function connect(url: string): Promise<Socket> {
  const sock = io(url, {
    transports: ['websocket'],
    forceNew: true,
    auth: { playerId: '00000000-0000-4000-8000-000000000001' },
  });
  await new Promise<void>((r) => sock.on('connect', () => r()));
  return sock;
}
```

Update `afterAll` to also clean the tempdir:
```ts
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
```

Do the same in `server/test/gateway-auto-advance.spec.ts` and `server/test/gateway.integration.spec.ts` — add a per-file tempdir, set `process.env.DB_PATH` in `beforeAll`, restore in `afterAll`, and add `auth: { playerId: '00000000-0000-4000-8000-000000000001' }` to every `io(url, { ... })` call. Each test file should use a unique playerId UUID.

- [ ] **Step 9: Run all server tests**

Run: `cd server && npx jest`
Expected: all green. Existing tests now pass with the new auth check.

- [ ] **Step 10: Commit**

```bash
git add server/src/gateway/game.gateway.ts server/test/integration/5-seat.spec.ts server/test/gateway-auto-advance.spec.ts server/test/gateway.integration.spec.ts
git commit -m "feat(server): thread playerId from socket handshake into room"
```

### Task B4: Write hand rows on round settlement

**Files:**
- Modify: `server/src/gateway/game.gateway.ts`
- Modify: `server/test/gateway.integration.spec.ts` (1 new assertion)

- [ ] **Step 1: Add the repository import**

In `server/src/gateway/game.gateway.ts`, add:
```ts
import { recordHand, type Outcome } from '../storage/hands.repository';
import { handTotal } from '../game/hand';
import { isBusted } from '../game/hand';
```

(`handTotal` and `isBusted` are already used by other modules; double-check the existing import list — if `handTotal` is already imported, drop the duplicate.)

- [ ] **Step 2: Add a writeHandRows method to the gateway**

Place it just below `private broadcastAll`:
```ts
private writeHandRows(roomId: string, state: GameState): void {
  if (!state.lastResult) return;
  for (const player of state.players) {
    if (player.status === 'empty' || player.status === 'sitting_out') continue;
    const playerId = this.rooms.getPlayerIdForSeat(roomId, player.id);
    if (!playerId) continue;
    for (let handIndex = 0; handIndex < player.hands.length; handIndex++) {
      const hand = player.hands[handIndex];
      if (hand.cards.length === 0) continue;
      // Find the payout for this seat+hand via lastResult.payouts. The state machine
      // emits one payout per player per round (delta is summed across split sub-hands),
      // so we map that single payout to each non-empty sub-hand proportionally.
      const payout = state.lastResult.payouts.find((p) => p.seatId === player.id);
      if (!payout) continue;
      // The state machine uses 'lose' (not 'loss') in payout reasons; normalize to
      // the hand-history outcome enum, which uses 'loss'.
      const outcome: Outcome = payout.reason === 'lose' ? 'loss' : payout.reason;
      const subDelta = payout.reason === 'push' ? 0
        : payout.reason === 'blackjack' ? Math.floor(hand.bet * 1.5)
        : payout.reason === 'win' ? hand.bet
        : -hand.bet;
      try {
        recordHand({
          player_id: playerId,
          bet_amount: hand.bet,
          outcome,
          net: subDelta,
          seat_index: state.players.findIndex((p) => p.id === player.id),
          hand_index: handIndex,
          is_doubled: hand.doubled ? 1 : 0,
          player_total: handTotal(hand.cards),
          dealer_total: handTotal(state.dealer.cards),
          player_cards: JSON.stringify(hand.cards.filter((c): c is Card => !('hidden' in c))),
          dealer_cards: JSON.stringify(state.dealer.cards.filter((c): c is Card => !('hidden' in c))),
          room_code: roomId,
          round_number: state.roundNumber,
          created_at: Date.now(),
        });
      } catch (e) {
        this.log.warn(`hand row write failed for seat ${player.id}: ${(e as Error).message}`);
      }
    }
  }
}
```

Add the `Card` type import if not already present:
```ts
import type { Card, GameState, LobbyState, ServerEvent } from '../shared/types';
```

- [ ] **Step 3: Call writeHandRows from broadcastAll when the phase is settled**

In `private broadcastAll`, add a call before the existing `server.to(roomId).emit('round:result', ...)` line:
```ts
if (state.phase === 'settled') this.writeHandRows(roomId, state);
```

- [ ] **Step 4: Verify build compiles**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Add a hand-row assertion to the 5-seat integration test**

In `server/test/integration/5-seat.spec.ts`, add this import at the top:
```ts
import { getDb } from '../../src/storage/db';
import { getRecentHands } from '../../src/storage/hands.repository';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
```

Add a new `describe` block at the end of the file (after the existing one), which boots a fresh app pointed at a temp DB:
```ts
describe('hand history row writes on settlement', () => {
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-5seat-'));
    process.env.DB_PATH = join(dir, 'blackjack.db');
    // re-require modules so the new DB_PATH is picked up
    jest.resetModules();
    const { AppModule } = require('../../src/app.module');
    const { initDb } = require('../../src/storage/db');
    initDb();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors({ origin: '*', credentials: true });
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes one row per non-empty hand after settle', async () => {
    const url = `http://localhost:${(app.getHttpServer().address() as any).port}`;
    const playerId = '00000000-0000-4000-8000-000000000099';
    const sock = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId } });
    await new Promise<void>((r) => sock.on('connect', () => r()));
    // ... drive create → bet → deal → stand → settle ...
    // (boilerplate same as the existing 5-seat test, but with only one player)

    const rows = getRecentHands(playerId, 50, 0);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ player_id: playerId, bet_amount: 50 });
    sock.disconnect();
  }, 20_000);
});
```

For the full "drive the round" sequence, copy the create/join/bet/deal/stand loop from the existing 5-seat test. Keep it minimal — one player is enough for this assertion.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && npx jest test/integration/5-seat.spec.ts`
Expected: PASS — both the original 5-seat test and the new hand-row test green.

- [ ] **Step 7: Commit**

```bash
git add server/src/gateway/game.gateway.ts server/test/integration/5-seat.spec.ts
git commit -m "feat(server): write hand history rows on round settlement"
```

---

## Phase C — Stats & achievements (read path)

### Task C1: Implement achievements.ts

**Files:**
- Create: `server/src/player/achievements.ts`
- Create: `server/test/player/achievements.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/player/achievements.spec.ts`:
```ts
import { ACHIEVEMENTS, evaluateAchievement, type HandRow, type PlayerStats } from '../../src/player/achievements';
import { longestWinStreak, hadWinAfter3LossStreak } from '../../src/player/achievements';

const makeStats = (over: Partial<PlayerStats> = {}): PlayerStats => ({
  hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
  net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0,
  ...over,
});

const makeHand = (over: Partial<HandRow> = {}): HandRow => ({
  id: 'h', player_id: 'p', bet_amount: 100, outcome: 'win', net: 100,
  seat_index: 0, hand_index: 0, is_doubled: 0, player_total: 20, dealer_total: 18,
  player_cards: '[]', dealer_cards: '[]', room_code: 'R', round_number: 1, created_at: 0,
  ...over,
});

describe('streak helpers', () => {
  it('longestWinStreak returns 0 for empty input', () => {
    expect(longestWinStreak([])).toBe(0);
  });

  it('longestWinStreak counts consecutive non-loss outcomes', () => {
    const h = (o: HandRow['outcome']) => makeHand({ outcome: o });
    expect(longestWinStreak([h('win'), h('win'), h('loss'), h('win')])).toBe(2);
    expect(longestWinStreak([h('win'), h('win'), h('win'), h('loss')])).toBe(3);
    expect(longestWinStreak([h('win'), h('blackjack'), h('win')])).toBe(3);
    expect(longestWinStreak([h('win'), h('push'), h('win')])).toBe(2); // push is not a win
  });

  it('hadWinAfter3LossStreak is true iff any win follows 3 consecutive losses', () => {
    const h = (o: HandRow['outcome']) => makeHand({ outcome: o });
    expect(hadWinAfter3LossStreak([h('loss'), h('loss'), h('loss'), h('win')])).toBe(true);
    expect(hadWinAfter3LossStreak([h('loss'), h('loss'), h('win')])).toBe(false);
    expect(hadWinAfter3LossStreak([h('loss'), h('loss'), h('loss'), h('loss'), h('win')])).toBe(true);
  });
});

describe('ACHIEVEMENTS registry', () => {
  it('exposes 6 achievements with id, name, description, icon, predicate', () => {
    expect(ACHIEVEMENTS).toHaveLength(6);
    for (const a of ACHIEVEMENTS) {
      expect(a.id).toMatch(/^[a-z-]+$/);
      expect(typeof a.name).toBe('string');
      expect(typeof a.description).toBe('string');
      expect(typeof a.icon).toBe('string');
      expect(typeof a.predicate).toBe('function');
    }
  });

  it('first-blackjack is earned iff stats.blackjacks >= 1', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'first-blackjack')!;
    expect(evaluateAchievement(a, makeStats({ blackjacks: 0 }), []).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats({ blackjacks: 1 }), []).earned).toBe(true);
  });

  it('ten-wins is earned iff stats.wins >= 10', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'ten-wins')!;
    expect(evaluateAchievement(a, makeStats({ wins: 9 }), []).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats({ wins: 10 }), []).earned).toBe(true);
  });

  it('big-bet is earned iff any hand has bet_amount >= 500', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'big-bet')!;
    expect(evaluateAchievement(a, makeStats(), [makeHand({ bet_amount: 250 })]).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats(), [makeHand({ bet_amount: 500 })]).earned).toBe(true);
  });

  it('doubled-down is earned iff any hand has is_doubled = 1', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'doubled-down')!;
    expect(evaluateAchievement(a, makeStats(), [makeHand({ is_doubled: 0 })]).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats(), [makeHand({ is_doubled: 1 })]).earned).toBe(true);
  });

  it('on-a-heater (5-win streak) uses the helper', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'on-a-heater')!;
    const h = (o: HandRow['outcome']) => makeHand({ outcome: o });
    expect(evaluateAchievement(a, makeStats(), [h('win'), h('win'), h('win'), h('win')]).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats(), [h('win'), h('win'), h('win'), h('win'), h('win')]).earned).toBe(true);
  });

  it('comeback-kid is earned iff hadWinAfter3LossStreak', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'comeback-kid')!;
    const h = (o: HandRow['outcome']) => makeHand({ outcome: o });
    expect(evaluateAchievement(a, makeStats(), [h('loss'), h('loss'), h('win')]).earned).toBe(false);
    expect(evaluateAchievement(a, makeStats(), [h('loss'), h('loss'), h('loss'), h('win')]).earned).toBe(true);
  });

  it('earnedAt is the created_at of the relevant hand, or null', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'first-blackjack')!;
    const r = evaluateAchievement(a, makeStats({ blackjacks: 1 }), [
      makeHand({ outcome: 'blackjack', created_at: 1234 }),
    ]);
    expect(r.earnedAt).toBe(1234);
    const r2 = evaluateAchievement(a, makeStats({ blackjacks: 0 }), []);
    expect(r2.earnedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx jest test/player/achievements.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement achievements.ts**

Create `server/src/player/achievements.ts`:
```ts
import type { HandRow } from '../storage/hands.repository';

export type PlayerStats = {
  hands_played: number;
  wins: number;
  losses: number;
  pushes: number;
  blackjacks: number;
  surrenders: number;
  doubles: number;
  net_profit: number;
  biggest_win: number;
  biggest_loss: number;
  total_wagered: number;
};

export type AchievementResult = { earned: boolean; earnedAt: number | null };

export type Achievement = {
  id: string;
  name: string;
  description: string;
  icon: string;
  predicate: (stats: PlayerStats, hands: HandRow[]) => AchievementResult;
};

export function evaluateAchievement(a: Achievement, stats: PlayerStats, hands: HandRow[]): AchievementResult {
  return a.predicate(stats, hands);
}

export function longestWinStreak(hands: HandRow[]): number {
  let max = 0, run = 0;
  for (const h of hands) {
    if (h.outcome === 'win' || h.outcome === 'blackjack') {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

export function hadWinAfter3LossStreak(hands: HandRow[]): boolean {
  let run = 0;
  for (const h of hands) {
    if (h.outcome === 'loss') {
      run += 1;
    } else if (h.outcome === 'win' || h.outcome === 'blackjack') {
      if (run >= 3) return true;
      run = 0;
    } else {
      run = 0;
    }
  }
  return false;
}

const firstHand = (hands: HandRow[], pred: (h: HandRow) => boolean): HandRow | undefined =>
  hands.find(pred);

const result = (earned: boolean, hand?: HandRow): AchievementResult =>
  earned ? { earned: true, earnedAt: hand?.created_at ?? null } : { earned: false, earnedAt: null };

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-blackjack',
    name: 'Natural',
    description: 'Win a hand with a natural blackjack',
    icon: '🂡',
    predicate: (s, h) => result(s.blackjacks >= 1, firstHand(h, (x) => x.outcome === 'blackjack')),
  },
  {
    id: 'ten-wins',
    name: 'Double Digits',
    description: 'Win 10 hands',
    icon: '🔟',
    predicate: (s) => result(s.wins >= 10),
  },
  {
    id: 'on-a-heater',
    name: 'On a Heater',
    description: 'Win 5 hands in a row',
    icon: '🔥',
    predicate: (_s, h) => result(longestWinStreak(h) >= 5),
  },
  {
    id: 'big-bet',
    name: 'High Roller',
    description: 'Place a max bet (500)',
    icon: '💰',
    predicate: (_s, h) => result(h.some((x) => x.bet_amount >= 500), firstHand(h, (x) => x.bet_amount >= 500)),
  },
  {
    id: 'doubled-down',
    name: 'Double or Nothing',
    description: 'Double down on a hand',
    icon: '✌️',
    predicate: (s, h) => result(s.doubles >= 1, firstHand(h, (x) => x.is_doubled === 1)),
  },
  {
    id: 'comeback-kid',
    name: 'Comeback Kid',
    description: 'Win a hand after losing 3 in a row',
    icon: '🩹',
    predicate: (_s, h) => result(hadWinAfter3LossStreak(h)),
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx jest test/player/achievements.spec.ts`
Expected: PASS — all achievement tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/player/achievements.ts server/test/player/achievements.spec.ts
git commit -m "feat(server): add achievements registry with 6 starter achievements"
```

### Task C2: Implement stats.repository.ts (aggregation queries)

**Files:**
- Create: `server/src/storage/stats.repository.ts`
- Create: `server/test/storage/stats.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/storage/stats.repository.spec.ts`:
```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, _resetDbForTests } from '../../src/storage/db';
import { recordHand, type HandRow } from '../../src/storage/hands.repository';
import {
  getPlayerStats, getPerformanceBySeat, getPerformanceByBetSize, getAllHandsForStreaks,
} from '../../src/storage/stats.repository';

const playerId = '00000000-0000-4000-8000-000000000001';
const base = (over: Partial<HandRow> = {}): HandRow => ({
  id: 'h', player_id: playerId, bet_amount: 100, outcome: 'win', net: 100,
  seat_index: 0, hand_index: 0, is_doubled: 0, player_total: 20, dealer_total: 18,
  player_cards: '[]', dealer_cards: '[]', room_code: 'R', round_number: 1, created_at: 0,
  ...over,
});

describe('stats.repository', () => {
  let dir: string;
  beforeEach(() => {
    _resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), 'bj21-stats-'));
    initDb({ dbPath: join(dir, 'blackjack.db') });
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); _resetDbForTests(); });

  describe('getPlayerStats', () => {
    it('returns zeros for a player with no hands', () => {
      const s = getPlayerStats(playerId);
      expect(s).toEqual({
        hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
        net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0,
      });
    });

    it('aggregates mixed outcomes correctly', () => {
      recordHand(base({ id: 'h1', outcome: 'win', net: 100, bet_amount: 100 }));
      recordHand(base({ id: 'h2', outcome: 'loss', net: -50, bet_amount: 50 }));
      recordHand(base({ id: 'h3', outcome: 'blackjack', net: 75, bet_amount: 50 }));
      recordHand(base({ id: 'h4', outcome: 'push', net: 0, bet_amount: 100 }));
      recordHand(base({ id: 'h5', outcome: 'win', net: 200, bet_amount: 200, is_doubled: 1 }));
      const s = getPlayerStats(playerId);
      expect(s.hands_played).toBe(5);
      expect(s.wins).toBe(2);
      expect(s.losses).toBe(1);
      expect(s.pushes).toBe(1);
      expect(s.blackjacks).toBe(1);
      expect(s.doubles).toBe(1);
      expect(s.net_profit).toBe(325);
      expect(s.biggest_win).toBe(200);
      expect(s.biggest_loss).toBe(-50);
      expect(s.total_wagered).toBe(500);
    });
  });

  describe('getPerformanceBySeat', () => {
    it('groups by seat_index and counts wins (win+blackjack)', () => {
      recordHand(base({ id: 'h1', seat_index: 0, outcome: 'win' }));
      recordHand(base({ id: 'h2', seat_index: 0, outcome: 'loss' }));
      recordHand(base({ id: 'h3', seat_index: 1, outcome: 'blackjack' }));
      const out = getPerformanceBySeat(playerId);
      expect(out).toEqual([
        { seat_index: 0, hands: 2, wins: 1 },
        { seat_index: 1, hands: 1, wins: 1 },
      ]);
    });
  });

  describe('getPerformanceByBetSize', () => {
    it('buckets bets into small/medium/large/max', () => {
      recordHand(base({ id: 'a', bet_amount: 50, outcome: 'win' }));     // small
      recordHand(base({ id: 'b', bet_amount: 99, outcome: 'loss' }));    // small
      recordHand(base({ id: 'c', bet_amount: 100, outcome: 'win' }));    // medium
      recordHand(base({ id: 'd', bet_amount: 249, outcome: 'win' }));    // medium
      recordHand(base({ id: 'e', bet_amount: 250, outcome: 'loss' }));   // large
      recordHand(base({ id: 'f', bet_amount: 499, outcome: 'win' }));    // large
      recordHand(base({ id: 'g', bet_amount: 500, outcome: 'win' }));    // max
      const out = getPerformanceByBetSize(playerId);
      const map = Object.fromEntries(out.map((b) => [b.bucket, b]));
      expect(map.small).toEqual({ bucket: 'small', hands: 2, wins: 1 });
      expect(map.medium).toEqual({ bucket: 'medium', hands: 2, wins: 2 });
      expect(map.large).toEqual({ bucket: 'large', hands: 2, wins: 1 });
      expect(map.max).toEqual({ bucket: 'max', hands: 1, wins: 1 });
    });
  });

  describe('getAllHandsForStreaks', () => {
    it('returns all hands for the player, oldest first', () => {
      recordHand(base({ id: 'h1', created_at: 3, outcome: 'win' }));
      recordHand(base({ id: 'h2', created_at: 1, outcome: 'loss' }));
      recordHand(base({ id: 'h3', created_at: 2, outcome: 'win' }));
      const ids = getAllHandsForStreaks(playerId).map((h) => h.id);
      expect(ids).toEqual(['h2', 'h3', 'h1']);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx jest test/storage/stats.repository.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement stats.repository.ts**

Create `server/src/storage/stats.repository.ts`:
```ts
import { getDb } from './db';
import type { HandRow } from './hands.repository';
import type { PlayerStats } from '../player/achievements';

const STATS_SQL = `
SELECT
  COUNT(*)                                                    AS hands_played,
  SUM(CASE WHEN outcome = 'win'        THEN 1 ELSE 0 END)     AS wins,
  SUM(CASE WHEN outcome = 'loss'       THEN 1 ELSE 0 END)     AS losses,
  SUM(CASE WHEN outcome = 'push'       THEN 1 ELSE 0 END)     AS pushes,
  SUM(CASE WHEN outcome = 'blackjack'  THEN 1 ELSE 0 END)     AS blackjacks,
  SUM(CASE WHEN outcome = 'surrender'  THEN 1 ELSE 0 END)     AS surrenders,
  SUM(CASE WHEN is_doubled = 1         THEN 1 ELSE 0 END)     AS doubles,
  COALESCE(SUM(net), 0)                                       AS net_profit,
  COALESCE(MAX(net), 0)                                       AS biggest_win,
  COALESCE(MIN(net), 0)                                       AS biggest_loss,
  COALESCE(SUM(bet_amount), 0)                                AS total_wagered
FROM hands
WHERE player_id = ?
`;

type StatsRow = {
  hands_played: number; wins: number; losses: number; pushes: number;
  blackjacks: number; surrenders: number; doubles: number;
  net_profit: number; biggest_win: number; biggest_loss: number; total_wagered: number;
};

export function getPlayerStats(playerId: string): PlayerStats {
  const r = getDb().prepare(STATS_SQL).get(playerId) as StatsRow | undefined;
  return r ?? {
    hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
    net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0,
  };
}

const SEAT_SQL = `
SELECT seat_index,
       COUNT(*)                                                          AS hands,
       SUM(CASE WHEN outcome IN ('win','blackjack') THEN 1 ELSE 0 END)   AS wins
FROM hands
WHERE player_id = ?
GROUP BY seat_index
ORDER BY seat_index
`;

export type SeatBreakdown = { seat_index: number; hands: number; wins: number };

export function getPerformanceBySeat(playerId: string): SeatBreakdown[] {
  return getDb().prepare(SEAT_SQL).all(playerId) as SeatBreakdown[];
}

const BET_SQL = `
SELECT
  CASE
    WHEN bet_amount < 100  THEN 'small'
    WHEN bet_amount < 250  THEN 'medium'
    WHEN bet_amount < 500  THEN 'large'
    ELSE                        'max'
  END AS bucket,
  COUNT(*)                                                          AS hands,
  SUM(CASE WHEN outcome IN ('win','blackjack') THEN 1 ELSE 0 END)   AS wins
FROM hands
WHERE player_id = ?
GROUP BY bucket
`;

export type BetBucket = { bucket: 'small' | 'medium' | 'large' | 'max'; hands: number; wins: number };

export function getPerformanceByBetSize(playerId: string): BetBucket[] {
  return getDb().prepare(BET_SQL).all(playerId) as BetBucket[];
}

const ALL_HANDS_SQL = `
SELECT id, player_id, bet_amount, outcome, net, seat_index, hand_index, is_doubled,
       player_total, dealer_total, player_cards, dealer_cards, room_code, round_number, created_at
FROM hands
WHERE player_id = ?
ORDER BY created_at ASC
`;

export function getAllHandsForStreaks(playerId: string): HandRow[] {
  return getDb().prepare(ALL_HANDS_SQL).all(playerId) as HandRow[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx jest test/storage/stats.repository.spec.ts`
Expected: PASS — all stats tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/storage/stats.repository.ts server/test/storage/stats.repository.spec.ts
git commit -m "feat(server): add stats repository for headline, per-seat, per-bet aggregations"
```

---

## Phase D — Player controller (API surface)

### Task D1: Implement player.controller.ts and player.module.ts

**Files:**
- Create: `server/src/player/player.controller.ts`
- Create: `server/src/player/player.module.ts`

- [ ] **Step 1: Implement player.controller.ts**

Create `server/src/player/player.controller.ts`:
```ts
import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { getPlayerStats, getPerformanceBySeat, getPerformanceByBetSize, getAllHandsForStreaks } from '../storage/stats.repository';
import { getRecentHands } from '../storage/hands.repository';
import { ACHIEVEMENTS, evaluateAchievement, longestWinStreak, type PlayerStats } from './achievements';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_SIZE = 20;

export type ProfileResponse = {
  stats: PlayerStats;
  streaks: {
    current: { kind: 'win' | 'loss' | null; length: number };
    longestWinStreak: number;
    last10: string[];
  };
  bySeat: { seat_index: number; hands: number; wins: number }[];
  byBet: { bucket: 'small' | 'medium' | 'large' | 'max'; hands: number; wins: number }[];
  achievements: { id: string; name: string; description: string; icon: string; earned: boolean; earnedAt: number | null }[];
  recentHands: ReturnType<typeof getRecentHands>;
};

@Controller('api/players')
export class PlayerController {
  @Get(':playerId/profile')
  getProfile(@Param('playerId') playerId: string): ProfileResponse {
    if (!UUID_V4_RE.test(playerId)) throw new NotFoundException('Player not found');
    const stats = getPlayerStats(playerId);
    const hands = getAllHandsForStreaks(playerId);
    const streaks = computeStreaks(hands);
    const bySeat = getPerformanceBySeat(playerId);
    const byBet = getPerformanceByBetSize(playerId);
    const achievements = ACHIEVEMENTS.map((a) => {
      const r = evaluateAchievement(a, stats, hands);
      return { id: a.id, name: a.name, description: a.description, icon: a.icon, earned: r.earned, earnedAt: r.earnedAt };
    });
    const recentHands = getRecentHands(playerId, PAGE_SIZE, 0);
    return { stats, streaks, bySeat, byBet, achievements, recentHands };
  }
}

function computeStreaks(hands: ReturnType<typeof getAllHandsForStreaks>) {
  const last10 = hands.slice(-10).map((h) => h.outcome);
  const longest = longestWinStreak(hands);
  let current: { kind: 'win' | 'loss' | null; length: number } = { kind: null, length: 0 };
  if (hands.length > 0) {
    const last = hands[hands.length - 1];
    const lastKind = (last.outcome === 'win' || last.outcome === 'blackjack') ? 'win'
      : last.outcome === 'loss' ? 'loss' : null;
    if (lastKind) {
      let len = 0;
      for (let i = hands.length - 1; i >= 0; i--) {
        const k = (hands[i].outcome === 'win' || hands[i].outcome === 'blackjack') ? 'win'
          : hands[i].outcome === 'loss' ? 'loss' : null;
        if (k === lastKind) len += 1; else break;
      }
      current = { kind: lastKind, length: len };
    }
  }
  return { current, longestWinStreak: longest, last10 };
}
```

(Note: `PAGE_SIZE` is hard-coded to 20. If we ever need to make it configurable, it moves into `Config`. For v1 the constant lives in this file.)

- [ ] **Step 2: Implement player.module.ts**

Create `server/src/player/player.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PlayerController } from './player.controller';

@Module({
  controllers: [PlayerController],
})
export class PlayerModule {}
```

- [ ] **Step 3: Verify build compiles**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/player/player.controller.ts server/src/player/player.module.ts
git commit -m "feat(server): add player controller and module for profile endpoint"
```

### Task D2: Wire PlayerModule into AppModule and initialize the DB on boot

**Files:**
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Update app.module.ts**

Replace `server/src/app.module.ts`:
```ts
import { Module, OnModuleInit } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { RoomModule } from './room/room.module';
import { GatewayModule } from './gateway/gateway.module';
import { PlayerModule } from './player/player.module';
import { initDb } from './storage/db';

@Module({
  imports: [GameModule, RoomModule, GatewayModule, PlayerModule],
})
export class AppModule implements OnModuleInit {
  onModuleInit() {
    initDb();
  }
}
```

- [ ] **Step 2: Verify the existing integration tests still pass**

Run: `cd server && npx jest test/integration/5-seat.spec.ts test/gateway-auto-advance.spec.ts test/gateway.integration.spec.ts`
Expected: PASS. The new `initDb()` call runs at boot; the tests use a real DB now (not the test-isolated ones, but the production-style path is exercised).

- [ ] **Step 3: Commit**

```bash
git add server/src/app.module.ts
git commit -m "feat(server): wire PlayerModule and bootstrap DB on app boot"
```

### Task D3: Test the player controller end-to-end

**Files:**
- Create: `server/test/player/player.controller.spec.ts`

- [ ] **Step 1: Write the test**

Create `server/test/player/player.controller.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { _resetDbForTests } from '../../src/storage/db';
import { recordHand, type HandRow } from '../../src/storage/hands.repository';

const playerId = '00000000-0000-4000-8000-000000000abc';

const base = (over: Partial<HandRow> = {}): HandRow => ({
  id: 'h', player_id: playerId, bet_amount: 100, outcome: 'win', net: 100,
  seat_index: 0, hand_index: 0, is_doubled: 0, player_total: 20, dealer_total: 18,
  player_cards: '[]', dealer_cards: '[]', room_code: 'R', round_number: 1, created_at: 0,
  ...over,
});

describe('PlayerController (GET /api/players/:playerId/profile)', () => {
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    _resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), 'bj21-ctrl-'));
    process.env.DB_PATH = join(dir, 'blackjack.db');
    jest.resetModules();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 404 for a malformed playerId', async () => {
    await request(app.getHttpServer()).get('/api/players/not-a-uuid/profile').expect(404);
  });

  it('returns an empty profile for an unknown but valid-shape playerId', async () => {
    const res = await request(app.getHttpServer()).get(`/api/players/${playerId}/profile`).expect(200);
    expect(res.body.stats.hands_played).toBe(0);
    expect(res.body.streaks.current).toEqual({ kind: null, length: 0 });
    expect(res.body.achievements).toHaveLength(6);
    expect(res.body.achievements.every((a: any) => a.earned === false)).toBe(true);
    expect(res.body.recentHands).toEqual([]);
  });

  it('returns full profile with stats, streaks, achievements, and recent hands', async () => {
    recordHand(base({ id: 'h1', outcome: 'win', net: 100, bet_amount: 100, created_at: 1 }));
    recordHand(base({ id: 'h2', outcome: 'win', net: 200, bet_amount: 200, created_at: 2, is_doubled: 1 }));
    recordHand(base({ id: 'h3', outcome: 'loss', net: -50, bet_amount: 50, created_at: 3 }));
    recordHand(base({ id: 'h4', outcome: 'blackjack', net: 75, bet_amount: 50, created_at: 4 }));

    const res = await request(app.getHttpServer()).get(`/api/players/${playerId}/profile`).expect(200);
    expect(res.body.stats).toMatchObject({
      hands_played: 4, wins: 2, losses: 1, blackjacks: 1, doubles: 1,
      net_profit: 325, biggest_win: 200, biggest_loss: -50,
    });
    expect(res.body.streaks.current).toEqual({ kind: 'win', length: 1 }); // last is blackjack → win
    expect(res.body.streaks.longestWinStreak).toBe(3); // win, win, then loss; then blackjack for current
    expect(res.body.recentHands[0].id).toBe('h4');     // newest first
    expect(res.body.bySeat).toEqual([{ seat_index: 0, hands: 4, wins: 3 }]);
    const byBetMap = Object.fromEntries(res.body.byBet.map((b: any) => [b.bucket, b]));
    expect(byBetMap.small).toEqual({ bucket: 'small', hands: 2, wins: 1 });
    expect(byBetMap.medium).toEqual({ bucket: 'medium', hands: 1, wins: 1 });
    expect(byBetMap.large).toEqual({ bucket: 'large', hands: 1, wins: 1 });

    const earned = res.body.achievements.filter((a: any) => a.earned).map((a: any) => a.id).sort();
    expect(earned).toEqual(['doubled-down', 'first-blackjack']);
  });
});
```

- [ ] **Step 2: Install supertest if missing**

Run: `cd server && grep -q '"supertest"' package.json || npm install --save-dev supertest @types/supertest`

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd server && npx jest test/player/player.controller.spec.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 4: Commit**

```bash
git add server/test/player/player.controller.spec.ts server/package.json server/package-lock.json
git commit -m "test(server): cover PlayerController end-to-end"
```

---

## Phase E — Client identity & API

### Task E1: Implement client player-id.ts

**Files:**
- Create: `client/src/lib/player-id.ts`
- Create: `client/test/lib/player-id.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `client/test/lib/player-id.spec.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run test/lib/player-id.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement player-id.ts**

Create `client/src/lib/player-id.ts`:
```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run test/lib/player-id.spec.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/player-id.ts client/test/lib/player-id.spec.ts
git commit -m "feat(client): add localStorage-based player ID helper"
```

### Task E2: Pass playerId in the socket auth handshake

**Files:**
- Modify: `client/src/socket/client.ts`

- [ ] **Step 1: Update the connect function**

Replace `client/src/socket/client.ts`:
```ts
import { io, type Socket } from 'socket.io-client';
import { getOrCreatePlayerId } from '../lib/player-id';

let socket: Socket | null = null;

export function connect(): Socket {
  if (socket) return socket;
  socket = io('http://localhost:3001', {
    autoConnect: true,
    transports: ['websocket'],
    auth: { playerId: getOrCreatePlayerId() },
  });
  return socket;
}

export function getSocket(): Socket {
  if (!socket) return connect();
  return socket;
}
```

- [ ] **Step 2: Run client tests to confirm no regressions**

Run: `cd client && npx vitest run`
Expected: all green (no test currently exercises `connect()`, so no test changes needed).

- [ ] **Step 3: Commit**

```bash
git add client/src/socket/client.ts
git commit -m "feat(client): pass playerId in socket auth handshake"
```

### Task E3: Implement profile API client

**Files:**
- Create: `client/src/lib/api/profile.ts`
- Create: `client/test/lib/api/profile.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `client/test/lib/api/profile.spec.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProfile } from '../../src/lib/api/profile';

const sample = {
  stats: { hands_played: 1, wins: 1, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
            net_profit: 100, biggest_win: 100, biggest_loss: 0, total_wagered: 100 },
  streaks: { current: { kind: 'win' as const, length: 1 }, longestWinStreak: 1, last10: ['win'] },
  bySeat: [{ seat_index: 0, hands: 1, wins: 1 }],
  byBet: [{ bucket: 'small' as const, hands: 1, wins: 1 }],
  achievements: [{ id: 'x', name: 'X', description: '', icon: '⭐', earned: false, earnedAt: null }],
  recentHands: [],
};

describe('fetchProfile', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the parsed profile on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => sample,
    }));
    const p = await fetchProfile('p1');
    expect(p).toEqual(sample);
  });

  it('returns an empty profile on 404 (not an error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    const p = await fetchProfile('p1');
    expect(p.stats.hands_played).toBe(0);
    expect(p.achievements).toEqual([]);
  });

  it('throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(fetchProfile('p1')).rejects.toThrow('network down');
  });

  it('throws on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(fetchProfile('p1')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run test/lib/api/profile.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement profile.ts**

Create `client/src/lib/api/profile.ts`:
```ts
export type Outcome = 'win' | 'loss' | 'push' | 'blackjack' | 'surrender';

export type ProfileResponse = {
  stats: {
    hands_played: number; wins: number; losses: number; pushes: number;
    blackjacks: number; surrenders: number; doubles: number;
    net_profit: number; biggest_win: number; biggest_loss: number; total_wagered: number;
  };
  streaks: {
    current: { kind: 'win' | 'loss' | null; length: number };
    longestWinStreak: number;
    last10: Outcome[];
  };
  bySeat: { seat_index: number; hands: number; wins: number }[];
  byBet: { bucket: 'small' | 'medium' | 'large' | 'max'; hands: number; wins: number }[];
  achievements: { id: string; name: string; description: string; icon: string; earned: boolean; earnedAt: number | null }[];
  recentHands: {
    id: string; bet_amount: number; outcome: Outcome; net: number; seat_index: number;
    hand_index: number; is_doubled: 0 | 1; player_total: number; dealer_total: number;
    room_code: string; round_number: number; created_at: number;
  }[];
};

const EMPTY: ProfileResponse = {
  stats: { hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
           net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0 },
  streaks: { current: { kind: null, length: 0 }, longestWinStreak: 0, last10: [] },
  bySeat: [],
  byBet: [],
  achievements: [],
  recentHands: [],
};

export async function fetchProfile(playerId: string): Promise<ProfileResponse> {
  const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/profile`);
  if (res.status === 404) return EMPTY;
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  return res.json() as Promise<ProfileResponse>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run test/lib/api/profile.spec.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api/profile.ts client/test/lib/api/profile.spec.ts
git commit -m "feat(client): add profile API client"
```

### Task E4: Implement player.slice.ts

**Files:**
- Create: `client/src/store/player.slice.ts`
- Create: `client/test/store/player.slice.spec.ts`
- Modify: `client/src/store/index.ts`

- [ ] **Step 1: Write the failing test**

Create `client/test/store/player.slice.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { playerReducer, profileLoaded, profileLoadStarted, profileLoadFailed, profileModalOpened, profileModalClosed } from '../../src/store/player.slice';
import type { ProfileResponse } from '../../src/lib/api/profile';

const fixture: ProfileResponse = {
  stats: { hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
           net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0 },
  streaks: { current: { kind: null, length: 0 }, longestWinStreak: 0, last10: [] },
  bySeat: [], byBet: [], achievements: [], recentHands: [],
};

describe('player.slice', () => {
  it('starts with idle / closed / no profile / no error', () => {
    const s = playerReducer(undefined, { type: '@@INIT' });
    expect(s).toEqual({ profile: null, status: 'idle', error: null, isOpen: false });
  });

  it('profileLoadStarted sets status to loading', () => {
    const s = playerReducer(undefined, profileLoadStarted());
    expect(s.status).toBe('loading');
  });

  it('profileLoaded stores the profile and sets status to ready', () => {
    const s = playerReducer(undefined, profileLoaded(fixture));
    expect(s.profile).toBe(fixture);
    expect(s.status).toBe('ready');
  });

  it('profileLoadFailed records the error', () => {
    const s = playerReducer(undefined, profileLoadFailed('boom'));
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('profileModalOpened / Closed toggle isOpen', () => {
    const opened = playerReducer(undefined, profileModalOpened());
    expect(opened.isOpen).toBe(true);
    const closed = playerReducer(opened, profileModalClosed());
    expect(closed.isOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run test/store/player.slice.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement player.slice.ts**

Create `client/src/store/player.slice.ts`:
```ts
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ProfileResponse } from '../lib/api/profile';

type PlayerState = {
  profile: ProfileResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  isOpen: boolean;
};

const initial: PlayerState = { profile: null, status: 'idle', error: null, isOpen: false };

const slice = createSlice({
  name: 'player',
  initialState: initial,
  reducers: {
    profileLoadStarted(state) { state.status = 'loading'; state.error = null; },
    profileLoaded(state, action: PayloadAction<ProfileResponse>) {
      state.status = 'ready';
      state.profile = action.payload;
      state.error = null;
    },
    profileLoadFailed(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.error = action.payload;
    },
    profileModalOpened(state) { state.isOpen = true; },
    profileModalClosed(state) { state.isOpen = false; },
  },
});

export const {
  profileLoadStarted, profileLoaded, profileLoadFailed,
  profileModalOpened, profileModalClosed,
} = slice.actions;
export const playerReducer = slice.reducer;
```

- [ ] **Step 4: Register the reducer in the store**

Edit `client/src/store/index.ts`. Add the import and reducer:
```ts
import { playerReducer } from './player.slice';
```
And add `player: playerReducer` to the `reducer` object.

The updated file:
```ts
import { configureStore } from '@reduxjs/toolkit';
import { connectionReducer } from './connection.slice';
import { lobbyReducer } from './lobby.slice';
import { gameReducer } from './game.slice';
import { uiReducer } from './ui.slice';
import { animationReducer } from './animation.slice';
import { playerReducer } from './player.slice';
import { socketMiddleware } from '../middleware/socket.middleware';
import { getSocket } from '../socket/client';

export const store = configureStore({
  reducer: {
    connection: connectionReducer,
    lobby: lobbyReducer,
    game: gameReducer,
    ui: uiReducer,
    animation: animationReducer,
    player: playerReducer,
  },
  middleware: (getDefault) => getDefault().concat(socketMiddleware(getSocket)),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run test/store/player.slice.spec.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Update existing TableView test to include the player reducer**

Edit `client/test/components/TableView.spec.tsx`. Add:
```ts
import { playerReducer } from '../../src/store/player.slice';
```

And add `player: playerReducer` to the `configureStore` reducer object, plus `player: { profile: null, status: 'idle', error: null, isOpen: false }` to the `preloadedState`.

- [ ] **Step 7: Run all client tests**

Run: `cd client && npx vitest run`
Expected: all green (existing tests still pass; new ones added).

- [ ] **Step 8: Commit**

```bash
git add client/src/store/player.slice.ts client/src/store/index.ts client/test/store/player.slice.spec.ts client/test/components/TableView.spec.tsx
git commit -m "feat(client): add player slice and register in store"
```

---

## Phase F — Client UI

### Task F1: Implement ProfileModal.tsx (shell)

**Files:**
- Create: `client/src/components/ProfileModal.tsx`

- [ ] **Step 1: Implement the modal**

Create `client/src/components/ProfileModal.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components';
import { getOrCreatePlayerId } from '../lib/player-id';
import { fetchProfile } from '../lib/api/profile';
import {
  profileLoadStarted, profileLoaded, profileLoadFailed,
  profileModalOpened, profileModalClosed,
} from '../store/player.slice';
import { ProfileHistoryTab } from './ProfileHistoryTab';
import { ProfileStatsTab } from './ProfileStatsTab';
import type { RootState } from '../store';

const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 300;
`;

const Dialog = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.surfaceDimmer};
  border-radius: ${({ theme }) => theme.radii.lg};
  box-shadow: ${({ theme }) => theme.shadows.cardLarge};
  width: min(900px, 92vw);
  max-height: 86vh;
  display: flex; flex-direction: column;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Header = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surfaceDimmer};
`;

const Title = styled.h2`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.titleSize};
`;

const Close = styled.button`
  background: none; border: 0; color: inherit; font-size: 24px; cursor: pointer;
  &:hover { color: ${({ theme }) => theme.colors.statusWin}; }
`;

const Tabs = styled.div`
  display: flex; gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.lg}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.surfaceDimmer};
`;

const Tab = styled.button<{ $active: boolean }>`
  background: ${({ $active, theme }) => $active ? theme.colors.surfaceDimmer : 'transparent'};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ $active, theme }) => $active ? theme.colors.feltStitch : 'transparent'};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font: inherit; cursor: pointer;
`;

const Body = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  overflow-y: auto;
`;

const Skeleton = styled.div`
  height: 120px; border-radius: ${({ theme }) => theme.radii.md};
  background: linear-gradient(90deg,
    ${({ theme }) => theme.colors.surfaceDimmer} 0%,
    ${({ theme }) => theme.colors.surface} 50%,
    ${({ theme }) => theme.colors.surfaceDimmer} 100%);
  background-size: 200% 100%;
  animation: pulse 1.4s ease-in-out infinite;
  @keyframes pulse {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

const ErrorBox = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex; flex-direction: column; align-items: center; gap: ${({ theme }) => theme.spacing.md};
`;

const Retry = styled.button`
  background: ${({ theme }) => theme.colors.feltStitch};
  color: ${({ theme }) => theme.colors.feltDark};
  border: 0; border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font: inherit; cursor: pointer;
`;

type TabKey = 'history' | 'stats';

function loadProfile(dispatch: ReturnType<typeof useDispatch>): void {
  dispatch(profileLoadStarted());
  fetchProfile(getOrCreatePlayerId())
    .then((p) => dispatch(profileLoaded(p)))
    .catch((e) => dispatch(profileLoadFailed(String(e?.message ?? e))));
}

export function ProfileModal() {
  const dispatch = useDispatch();
  const isOpen = useSelector((s: RootState) => s.player.isOpen);
  const status = useSelector((s: RootState) => s.player.status);
  const profile = useSelector((s: RootState) => s.player.profile);
  const error = useSelector((s: RootState) => s.player.error);
  const [tab, setTab] = useState<TabKey>('history');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    dispatch(profileLoadStarted());
    fetchProfile(getOrCreatePlayerId())
      .then((p) => { if (!cancelled) dispatch(profileLoaded(p)); })
      .catch((e) => { if (!cancelled) dispatch(profileLoadFailed(String(e?.message ?? e))); });
    return () => { cancelled = true; };
  }, [isOpen, dispatch]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch(profileModalClosed()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, dispatch]);

  if (!isOpen) return null;

  return (
    <Backdrop role="presentation" onClick={() => dispatch(profileModalClosed())}>
      <Dialog role="dialog" aria-modal="true" aria-labelledby="profile-title"
              onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title id="profile-title">Your Profile</Title>
          <Close aria-label="Close profile" onClick={() => dispatch(profileModalClosed())}>×</Close>
        </Header>
        <Tabs role="tablist">
          <Tab role="tab" aria-selected={tab === 'history'} $active={tab === 'history'}
               onClick={() => setTab('history')}>History</Tab>
          <Tab role="tab" aria-selected={tab === 'stats'} $active={tab === 'stats'}
               onClick={() => setTab('stats')}>Stats</Tab>
        </Tabs>
        <Body>
          {status === 'loading' && (
            <>
              <Skeleton /><div style={{ height: 16 }} />
              <Skeleton /><div style={{ height: 16 }} />
              <Skeleton />
            </>
          )}
          {status === 'error' && (
            <ErrorBox>
              <div>Couldn't load profile{error ? `: ${error}` : ''}.</div>
              <Retry onClick={() => loadProfile(dispatch)}>Retry</Retry>
            </ErrorBox>
          )}
          {status === 'ready' && profile && tab === 'history' && <ProfileHistoryTab profile={profile} />}
          {status === 'ready' && profile && tab === 'stats' && <ProfileStatsTab profile={profile} />}
        </Body>
      </Dialog>
    </Backdrop>
  );
}

/** Convenience export so TableView can open the modal from a button. */
export const openProfileModal = profileModalOpened;
```

- [ ] **Step 2: Verify the build compiles (will fail because tabs are not yet implemented)**

Run: `cd client && npx tsc -b`
Expected: errors about missing `./ProfileHistoryTab` and `./ProfileStatsTab`. That's expected — Tasks F2 and F3 add them.

- [ ] **Step 3: Commit (modal shell only, will not render until F2/F3 land)**

```bash
git add client/src/components/ProfileModal.tsx
git commit -m "feat(client): add ProfileModal shell with tab switching and fetch"
```

### Task F2: Implement ProfileHistoryTab.tsx

**Files:**
- Create: `client/src/components/ProfileHistoryTab.tsx`

- [ ] **Step 1: Implement the tab**

Create `client/src/components/ProfileHistoryTab.tsx`:
```tsx
import styled from 'styled-components';
import type { ProfileResponse } from '../lib/api/profile';

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: ${({ theme }) => theme.spacing.md};
`;

const Empty = styled.div`
  text-align: center; color: ${({ theme }) => theme.colors.textSecondary};
  padding: ${({ theme }) => theme.spacing.xl};
`;

const List = styled.ul`
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: ${({ theme }) => theme.spacing.xs};
`;

const Row = styled.li`
  display: grid;
  grid-template-columns: 36px 1fr auto auto;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: ${({ theme }) => theme.typography.bodySize};
  align-items: center;
`;

const OutcomeIcon = styled.span<{ $tone: 'win' | 'loss' | 'push' | 'bj' | 'other' }>`
  font-size: 22px;
  color: ${({ $tone, theme }) =>
    $tone === 'win' || $tone === 'bj' ? theme.colors.statusWin :
    $tone === 'loss' ? theme.colors.statusLose :
    theme.colors.textSecondary};
`;

const OutcomeLabel = styled.span`
  text-transform: capitalize;
`;

const Net = styled.span<{ $sign: 1 | -1 | 0 }>`
  color: ${({ $sign, theme }) =>
    $sign > 0 ? theme.colors.statusWin :
    $sign < 0 ? theme.colors.statusLose :
    theme.colors.textSecondary};
  font-weight: 600;
`;

const Meta = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
`;

const Pager = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: ${({ theme }) => theme.spacing.sm} 0;
`;

const PagerButton = styled.button`
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.feltStitch};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font: inherit; cursor: pointer;
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const toneFor = (outcome: string): 'win' | 'loss' | 'push' | 'bj' | 'other' => {
  if (outcome === 'win') return 'win';
  if (outcome === 'blackjack') return 'bj';
  if (outcome === 'loss') return 'loss';
  if (outcome === 'push') return 'push';
  return 'other';
};

const iconFor = (outcome: string): string => {
  if (outcome === 'blackjack') return '🂡';
  if (outcome === 'win') return '✓';
  if (outcome === 'loss') return '✗';
  if (outcome === 'push') return '=';
  if (outcome === 'surrender') return '🏳';
  return '?';
};

const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

export function ProfileHistoryTab({ profile }: { profile: ProfileResponse }) {
  const hands = profile.recentHands;

  if (hands.length === 0) {
    return <Empty>No hands yet. Play a round to start your history.</Empty>;
  }

  return (
    <Wrap>
      <List>
        {hands.map((h) => (
          <Row key={h.id}>
            <OutcomeIcon $tone={toneFor(h.outcome)} aria-label={h.outcome}>{iconFor(h.outcome)}</OutcomeIcon>
            <div>
              <OutcomeLabel>{h.outcome}</OutcomeLabel>
              <Meta> · bet {h.bet_amount}{h.is_doubled ? ' (doubled)' : ''} · vs dealer {h.dealer_total}</Meta>
            </div>
            <Net $sign={h.net > 0 ? 1 : h.net < 0 ? -1 : 0}>
              {h.net > 0 ? `+${h.net}` : h.net}
            </Net>
            <Meta>{fmtDate(h.created_at)}</Meta>
          </Row>
        ))}
      </List>
      <Pager>
        <PagerButton disabled>← Prev</PagerButton>
        <Meta>Page 1 of 1 · {hands.length} hand{hands.length === 1 ? '' : 's'}</Meta>
        <PagerButton disabled>Next →</PagerButton>
      </Pager>
    </Wrap>
  );
}
```

(Note: server-side pagination is implemented in the spec, but the v1 modal renders the first page returned by the server. Prev/Next are disabled in v1; future enhancement can add page state.)

- [ ] **Step 2: Verify the build compiles**

Run: `cd client && npx tsc -b`
Expected: errors only about `./ProfileStatsTab` (Task F3).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ProfileHistoryTab.tsx
git commit -m "feat(client): add ProfileHistoryTab with outcome icons and net coloring"
```

### Task F3: Implement ProfileStatsTab.tsx

**Files:**
- Create: `client/src/components/ProfileStatsTab.tsx`

- [ ] **Step 1: Implement the tab**

Create `client/src/components/ProfileStatsTab.tsx`:
```tsx
import styled from 'styled-components';
import type { ProfileResponse } from '../lib/api/profile';

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: ${({ theme }) => theme.spacing.lg};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  border: 1px solid ${({ theme }) => theme.colors.feltStitch};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const CardTitle = styled.h3`
  margin: 0 0 ${({ theme }) => theme.spacing.md} 0;
  font-size: ${({ theme }) => theme.typography.bodySize};
  text-transform: uppercase;
  letter-spacing: 1px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
`;

const Stat = styled.div`
  display: flex; flex-direction: column;
  font-size: ${({ theme }) => theme.typography.bodySize};
`;

const StatValue = styled.span<{ $tone?: 'win' | 'lose' | 'neutral' }>`
  font-size: ${({ theme }) => theme.typography.titleSize};
  font-weight: 600;
  color: ${({ $tone, theme }) =>
    $tone === 'win' ? theme.colors.statusWin :
    $tone === 'lose' ? theme.colors.statusLose :
    theme.colors.textPrimary};
`;

const StatLabel = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const BigRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
  margin-top: ${({ theme }) => theme.spacing.md};
  padding-top: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.surface};
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${({ theme }) => theme.typography.bodySize};
  th, td { padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm}; text-align: left; }
  th { color: ${({ theme }) => theme.colors.textSecondary}; font-weight: 500; text-transform: uppercase; font-size: ${({ theme }) => theme.typography.smallSize}; letter-spacing: 1px; }
  tr:nth-child(odd) td { background: ${({ theme }) => theme.colors.surface}; }
`;

const AchievementsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
`;

const AchievementTile = styled.div<{ $earned: boolean }>`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ $earned, theme }) => $earned ? theme.colors.statusWin : theme.colors.surfaceDimmer};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => theme.spacing.md};
  opacity: ${({ $earned }) => $earned ? 1 : 0.55};
  filter: ${({ $earned }) => $earned ? 'none' : 'grayscale(80%)'};
  text-align: center;
`;

const AchievementIcon = styled.div`
  font-size: 32px;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const AchievementName = styled.div`
  font-weight: 600;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const AchievementDesc = styled.div`
  font-size: ${({ theme }) => theme.typography.smallSize};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const StreakLine = styled.div`
  display: flex; align-items: center; gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  font-size: ${({ theme }) => theme.typography.bodySize};
`;

const Last10 = styled.div`
  display: flex; gap: ${({ theme }) => theme.spacing.xs};
  font-size: 20px;
`;

const winRate = (w: number, total: number): string =>
  total === 0 ? '—' : `${Math.round((w / total) * 100)}%`;

const fmtMoney = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export function ProfileStatsTab({ profile }: { profile: ProfileResponse }) {
  const { stats, streaks, bySeat, byBet, achievements } = profile;
  const winPct = winRate(stats.wins + stats.blackjacks, stats.hands_played);

  const seatByIdx = new Map(bySeat.map((s) => [s.seat_index, s]));
  const betByBucket = new Map(byBet.map((b) => [b.bucket, b]));

  return (
    <Wrap>
      <Card>
        <CardTitle>Headline</CardTitle>
        <Grid>
          <Stat><StatValue>{stats.hands_played}</StatValue><StatLabel>Hands</StatLabel></Stat>
          <Stat><StatValue>{stats.wins}</StatValue><StatLabel>Wins</StatLabel></Stat>
          <Stat><StatValue>{stats.losses}</StatValue><StatLabel>Losses</StatLabel></Stat>
          <Stat><StatValue>{stats.pushes}</StatValue><StatLabel>Pushes</StatLabel></Stat>
          <Stat><StatValue>{stats.blackjacks}</StatValue><StatLabel>Blackjacks</StatLabel></Stat>
          <Stat><StatValue>{stats.doubles}</StatValue><StatLabel>Doubles</StatLabel></Stat>
        </Grid>
        <BigRow>
          <Stat><StatValue>{winPct}</StatValue><StatLabel>Win rate</StatLabel></Stat>
          <Stat>
            <StatValue $tone={stats.net_profit > 0 ? 'win' : stats.net_profit < 0 ? 'lose' : 'neutral'}>
              {fmtMoney(stats.net_profit)}
            </StatValue>
            <StatLabel>Net profit</StatLabel>
          </Stat>
          <Stat>
            <StatValue>{fmtMoney(stats.biggest_win)} / {fmtMoney(stats.biggest_loss)}</StatValue>
            <StatLabel>Biggest W / L</StatLabel>
          </Stat>
        </BigRow>
      </Card>

      <Card>
        <CardTitle>Streaks</CardTitle>
        <StreakLine>
          {streaks.current.kind === 'win' && <>🔥 {streaks.current.length}-win streak</>}
          {streaks.current.kind === 'loss' && <>❄️ {streaks.current.length}-loss streak</>}
          {streaks.current.kind === null && <>—</>}
          <span style={{ marginLeft: 'auto' }}>Longest win streak: <strong>{streaks.longestWinStreak}</strong></span>
        </StreakLine>
        <Last10>
          {streaks.last10.map((o, i) => (
            <span key={i} title={o}>{o === 'blackjack' ? '🂡' : o === 'win' ? '✓' : o === 'loss' ? '✗' : o === 'push' ? '=' : '?'}</span>
          ))}
        </Last10>
      </Card>

      <Card>
        <CardTitle>Performance by seat</CardTitle>
        <Table>
          <thead><tr><th>Seat</th><th>Hands</th><th>Wins</th><th>Win %</th></tr></thead>
          <tbody>
            {Array.from({ length: 5 }, (_, i) => {
              const s = seatByIdx.get(i);
              return (
                <tr key={i}>
                  <th scope="row">Seat {i + 1}</th>
                  <td>{s?.hands ?? '—'}</td>
                  <td>{s?.wins ?? '—'}</td>
                  <td>{s ? winRate(s.wins, s.hands) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardTitle>Performance by bet size</CardTitle>
        <Table>
          <thead><tr><th>Bucket</th><th>Hands</th><th>Wins</th><th>Win %</th></tr></thead>
          <tbody>
            {(['small', 'medium', 'large', 'max'] as const).map((b) => {
              const row = betByBucket.get(b);
              return (
                <tr key={b}>
                  <th scope="row">{b === 'small' ? '10–99' : b === 'medium' ? '100–249' : b === 'large' ? '250–499' : '500'}</th>
                  <td>{row?.hands ?? '—'}</td>
                  <td>{row?.wins ?? '—'}</td>
                  <td>{row ? winRate(row.wins, row.hands) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardTitle>Achievements</CardTitle>
        <AchievementsGrid>
          {achievements.map((a) => (
            <AchievementTile key={a.id} $earned={a.earned} title={a.earned ? `Earned${a.earnedAt ? ` on ${new Date(a.earnedAt).toISOString().slice(0, 10)}` : ''}` : 'Locked'}>
              <AchievementIcon>{a.icon}</AchievementIcon>
              <AchievementName>{a.name}</AchievementName>
              <AchievementDesc>{a.description}</AchievementDesc>
              {!a.earned && <AchievementDesc><em>Locked</em></AchievementDesc>}
            </AchievementTile>
          ))}
        </AchievementsGrid>
      </Card>
    </Wrap>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ProfileStatsTab.tsx
git commit -m "feat(client): add ProfileStatsTab with 5 stat cards and achievement grid"
```

### Task F4: Test the three new components

**Files:**
- Create: `client/test/components/ProfileHistoryTab.spec.tsx`
- Create: `client/test/components/ProfileStatsTab.spec.tsx`
- Create: `client/test/components/ProfileModal.spec.tsx`

- [ ] **Step 1: Write ProfileHistoryTab test**

Create `client/test/components/ProfileHistoryTab.spec.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect } from 'vitest';
import { ProfileHistoryTab } from '../../src/components/ProfileHistoryTab';
import { theme } from '../../src/styles/theme';
import type { ProfileResponse } from '../../src/lib/api/profile';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const baseProfile: ProfileResponse = {
  stats: { hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0,
           net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0 },
  streaks: { current: { kind: null, length: 0 }, longestWinStreak: 0, last10: [] },
  bySeat: [], byBet: [], achievements: [],
  recentHands: [],
};

describe('<ProfileHistoryTab />', () => {
  it('shows the empty state when there are no hands', () => {
    wrap(<ProfileHistoryTab profile={baseProfile} />);
    expect(screen.getByText(/No hands yet/i)).toBeInTheDocument();
  });

  it('renders one row per hand with outcome icon and net coloring', () => {
    wrap(<ProfileHistoryTab profile={{
      ...baseProfile,
      recentHands: [
        { id: 'h1', bet_amount: 100, outcome: 'win', net: 100, seat_index: 0, hand_index: 0, is_doubled: 0, player_total: 20, dealer_total: 18, room_code: 'R', round_number: 1, created_at: 1_700_000_000_000 },
        { id: 'h2', bet_amount: 50,  outcome: 'loss', net: -50, seat_index: 0, hand_index: 0, is_doubled: 0, player_total: 19, dealer_total: 20, room_code: 'R', round_number: 2, created_at: 1_700_000_500_000 },
        { id: 'h3', bet_amount: 100, outcome: 'push', net: 0, seat_index: 0, hand_index: 0, is_doubled: 0, player_total: 20, dealer_total: 20, room_code: 'R', round_number: 3, created_at: 1_700_001_000_000 },
      ],
    }} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('win')).toBeInTheDocument();
    expect(screen.getByText('loss')).toBeInTheDocument();
    expect(screen.getByText('push')).toBeInTheDocument();
    expect(screen.getByText('+100')).toBeInTheDocument();
    expect(screen.getByText('-50')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write ProfileStatsTab test**

Create `client/test/components/ProfileStatsTab.spec.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect } from 'vitest';
import { ProfileStatsTab } from '../../src/components/ProfileStatsTab';
import { theme } from '../../src/styles/theme';
import type { ProfileResponse } from '../../src/lib/api/profile';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const profile: ProfileResponse = {
  stats: { hands_played: 10, wins: 4, losses: 4, pushes: 1, blackjacks: 1, surrenders: 0, doubles: 2,
           net_profit: 250, biggest_win: 200, biggest_loss: -100, total_wagered: 1000 },
  streaks: { current: { kind: 'win', length: 2 }, longestWinStreak: 3, last10: ['win', 'loss', 'win', 'push', 'blackjack'] },
  bySeat: [{ seat_index: 0, hands: 6, wins: 3 }, { seat_index: 2, hands: 4, wins: 2 }],
  byBet: [{ bucket: 'small', hands: 6, wins: 3 }, { bucket: 'max', hands: 1, wins: 1 }],
  achievements: [
    { id: 'first-blackjack', name: 'Natural', description: 'Win a hand with a natural blackjack', icon: '🂡', earned: true, earnedAt: 1_700_000_000_000 },
    { id: 'ten-wins', name: 'Double Digits', description: 'Win 10 hands', icon: '🔟', earned: false, earnedAt: null },
  ],
  recentHands: [],
};

describe('<ProfileStatsTab />', () => {
  it('renders the headline counts and win rate', () => {
    wrap(<ProfileStatsTab profile={profile} />);
    expect(screen.getByText('10')).toBeInTheDocument(); // hands
    expect(screen.getByText('50%')).toBeInTheDocument(); // win rate: 5/10
    expect(screen.getByText('+250')).toBeInTheDocument(); // net profit
  });

  it('renders the streaks card with current and longest', () => {
    wrap(<ProfileStatsTab profile={profile} />);
    expect(screen.getByText(/2-win streak/)).toBeInTheDocument();
    expect(screen.getByText(/Longest win streak:.*3/)).toBeInTheDocument();
  });

  it('renders both breakdown tables', () => {
    wrap(<ProfileStatsTab profile={profile} />);
    expect(screen.getByText('Performance by seat')).toBeInTheDocument();
    expect(screen.getByText('Performance by bet size')).toBeInTheDocument();
  });

  it('renders achievements with earned and locked styling', () => {
    wrap(<ProfileStatsTab profile={profile} />);
    expect(screen.getByText('Natural')).toBeInTheDocument();
    expect(screen.getByText('Double Digits')).toBeInTheDocument();
    expect(screen.getAllByText(/Locked/)).not.toHaveLength(0);
  });
});
```

- [ ] **Step 3: Write ProfileModal test**

Create `client/test/components/ProfileModal.spec.tsx`:
```tsx
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileModal } from '../../src/components/ProfileModal';
import { playerReducer, profileModalOpened, profileModalClosed } from '../../src/store/player.slice';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { animationReducer } from '../../src/store/animation.slice';
import { theme } from '../../src/styles/theme';

vi.mock('../../src/lib/api/profile', () => ({
  fetchProfile: vi.fn().mockResolvedValue({
    stats: { hands_played: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, doubles: 0, net_profit: 0, biggest_win: 0, biggest_loss: 0, total_wagered: 0 },
    streaks: { current: { kind: null, length: 0 }, longestWinStreak: 0, last10: [] },
    bySeat: [], byBet: [], achievements: [],
    recentHands: [{ id: 'h1', bet_amount: 50, outcome: 'win', net: 50, seat_index: 0, hand_index: 0, is_doubled: 0, player_total: 19, dealer_total: 17, room_code: 'R', round_number: 1, created_at: 1 }],
  }),
}));

function makeStore() {
  return configureStore({
    reducer: {
      player: playerReducer, connection: connectionReducer, lobby: lobbyReducer,
      game: gameReducer, ui: uiReducer, animation: animationReducer,
    },
  } as any);
}

const renderOpen = (store: ReturnType<typeof makeStore>) => render(
  <Provider store={store}>
    <ThemeProvider theme={theme}>
      <ProfileModal />
    </ThemeProvider>
  </Provider>,
);

describe('<ProfileModal />', () => {
  beforeEach(() => localStorage.clear());

  it('renders nothing when closed', () => {
    const store = makeStore();
    const { container } = renderOpen(store);
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal with History and Stats tabs when open', async () => {
    const store = makeStore();
    act(() => { store.dispatch(profileModalOpened()); });
    renderOpen(store);
    expect(await screen.findByText('Your Profile')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stats' })).toBeInTheDocument();
  });

  it('closes on ESC', async () => {
    const store = makeStore();
    act(() => { store.dispatch(profileModalOpened()); });
    renderOpen(store);
    await screen.findByText('Your Profile');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getState().player.isOpen).toBe(false);
  });

  it('closes when the X is clicked', async () => {
    const store = makeStore();
    act(() => { store.dispatch(profileModalOpened()); });
    renderOpen(store);
    await screen.findByText('Your Profile');
    fireEvent.click(screen.getByLabelText('Close profile'));
    expect(store.getState().player.isOpen).toBe(false);
  });

  it('switches to Stats tab and shows headline content', async () => {
    const store = makeStore();
    act(() => { store.dispatch(profileModalOpened()); });
    renderOpen(store);
    await screen.findByText('Your Profile');
    fireEvent.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(await screen.findByText('Headline')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the new component tests**

Run: `cd client && npx vitest run test/components/ProfileModal.spec.tsx test/components/ProfileHistoryTab.spec.tsx test/components/ProfileStatsTab.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full client test suite to confirm no regressions**

Run: `cd client && npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add client/test/components/ProfileModal.spec.tsx client/test/components/ProfileHistoryTab.spec.tsx client/test/components/ProfileStatsTab.spec.tsx
git commit -m "test(client): cover ProfileModal, ProfileHistoryTab, ProfileStatsTab"
```

### Task F5: Add Profile button to TableView and mount the modal

**Files:**
- Modify: `client/src/components/TableView.tsx`

- [ ] **Step 1: Add the imports**

At the top of `client/src/components/TableView.tsx`, add:
```tsx
import { useDispatch, useSelector } from 'react-redux';
import { profileModalOpened, ProfileModal } from './ProfileModal';
import { getOrCreatePlayerId } from '../lib/player-id';
```

(`useSelector` is already imported; add only the new ones.)

- [ ] **Step 2: Add a Profile button to the header**

In the `Brand` styled component block, add a new styled component right after it:
```tsx
const HeaderRow = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  width: 100%;
`;

const ProfileButton = styled.button`
  background: rgba(255,255,255,0.08);
  color: ${({ theme }) => theme.colors.feltStitch};
  border: 1px solid ${({ theme }) => theme.colors.feltStitch};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font: inherit; cursor: pointer;
  &:hover { background: rgba(255,255,255,0.15); }
`;
```

- [ ] **Step 3: Wrap the Brand and add the button + modal mount**

Find:
```tsx
<Brand>BLACKJACK PAYS 3 TO 2</Brand>
```

Replace with:
```tsx
const dispatch = useDispatch();
const isSeated = useSelector((s: RootState) => s.connection.selfSeatId !== null);
```

Add a `const dispatch = useDispatch();` and `const isSeated = ...` line just before the `return` statement. Then wrap the brand:
```tsx
<HeaderRow>
  <Brand>BLACKJACK PAYS 3 TO 2</Brand>
  {isSeated && (
    <ProfileButton onClick={() => dispatch(profileModalOpened())} aria-label="Open your profile">
      Profile
    </ProfileButton>
  )}
</HeaderRow>
```

And add `<ProfileModal />` at the bottom of `<TableSurface>` (next to the other top-level components like `<ResultOverlay />`):
```tsx
<ProfileModal />
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd client && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Run all client tests**

Run: `cd client && npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/TableView.tsx
git commit -m "feat(client): wire Profile button in TableView header and mount modal"
```

---

## Phase G — End-to-end test

### Task G1: Write the E2E test

**Files:**
- Create: `client/e2e/profile.spec.ts`

- [ ] **Step 1: Write the test**

Create `client/e2e/profile.spec.ts`:
```ts
import { test, expect, chromium } from '@playwright/test';

test('two players can play a hand and see it in the profile modal', async () => {
  const browser = await chromium.launch();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto('/');
  await host.fill('input[placeholder="Your name"]', 'Alice');
  await host.click('button:has-text("Create Room")');
  await host.waitForURL(/\/room\//);
  const code = host.url().split('/room/')[1];

  await guest.goto('/');
  await guest.fill('input[placeholder="Your name"]', 'Bob');
  await guest.fill('input[placeholder="Room code"]', code);
  await guest.click('button:has-text("Join")');
  await guest.waitForURL(/\/room\//);

  // Round 1: bet + deal + stand
  await host.click('button:has-text("Begin Betting")');
  await host.waitForSelector('.bet-panel');
  await host.fill('.bet-panel input', '50');
  await host.click('button:has-text("Place Bet")');
  await guest.fill('.bet-panel input', '50');
  await guest.click('button:has-text("Place Bet")');
  await host.click('button:has-text("Deal")');
  await host.waitForSelector('.action-panel', { timeout: 20_000 });

  for (let i = 0; i < 4; i++) {
    await host.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => {
        if ((b.textContent ?? '').trim() === 'Stand' && !(b as HTMLButtonElement).disabled) b.click();
      });
    });
    await guest.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => {
        if ((b.textContent ?? '').trim() === 'Stand' && !(b as HTMLButtonElement).disabled) b.click();
      });
    });
    await host.waitForTimeout(50);
  }
  await host.waitForSelector('.result-overlay', { timeout: 20_000 });

  // Open the profile modal on the host.
  await host.click('button[aria-label="Open your profile"]');
  await host.waitForSelector('[role="dialog"]');

  // History tab: 1 hand
  expect(await host.locator('[role="dialog"] [role="listitem"]').count()).toBe(1);

  // Switch to Stats tab and assert headline values are present.
  await host.click('[role="dialog"] [role="tab"]:has-text("Stats")');
  expect(await host.locator('[role="dialog"]').getByText('Headline').count()).toBe(1);
  expect(await host.locator('[role="dialog"]').getByText('Achievements').count()).toBe(1);

  await host.screenshot({ path: 'client/test-results/profile-stats.png', fullPage: true });

  // Close the modal.
  await host.click('button[aria-label="Close profile"]');
  await expect(host.locator('[role="dialog"]')).toHaveCount(0);

  // Open again on the guest — guest should also see the 1 hand.
  await guest.click('button[aria-label="Open your profile"]');
  await guest.waitForSelector('[role="dialog"]');
  expect(await guest.locator('[role="dialog"] [role="listitem"]').count()).toBe(1);

  await browser.close();
}, 60_000);
```

- [ ] **Step 2: Run the E2E test**

Run: `cd client && npx playwright test e2e/profile.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/e2e/profile.spec.ts
git commit -m "test(e2e): cover profile modal after a played hand"
```

---

## Self-review checklist

After all tasks are complete, run through this list to verify spec coverage:

- [ ] **Storage layer:** `server/src/storage/db.ts` and `server/src/storage/hands.repository.ts` exist; `recordHand` and `getRecentHands` are tested.
- [ ] **Stats repository:** `server/src/storage/stats.repository.ts` exposes `getPlayerStats`, `getPerformanceBySeat`, `getPerformanceByBetSize`, `getAllHandsForStreaks`; all are tested.
- [ ] **Player identity:** `server/src/player/player-identity.ts` validates UUID v4; gateway reads it from the handshake and rejects malformed IDs.
- [ ] **Threading:** `RoomService.getPlayerIdForSeat` returns the playerId by seatId; `assignSettle`-equivalent write path uses it to insert hand rows.
- [ ] **Achievements:** 6 achievements in the registry; predicates have positive and negative tests; `longestWinStreak` and `hadWinAfter3LossStreak` are tested.
- [ ] **Controller:** `GET /api/players/:playerId/profile` returns stats + streaks + bySeat + byBet + achievements + recentHands; 200 on unknown-but-valid, 404 on malformed.
- [ ] **Client identity:** `getOrCreatePlayerId` returns the same ID on repeated calls; socket `auth` carries it.
- [ ] **Client slice:** `player` slice is registered in the store; `profileModalOpened` / `profileModalClosed` toggle `isOpen`.
- [ ] **UI:** `<ProfileModal />`, `<ProfileHistoryTab />`, `<ProfileStatsTab />` exist; mounted from `TableView` via a Profile button; both tabs are covered by component tests; ESC closes, X closes, backdrop closes.
- [ ] **E2E:** One playwright spec covers the full flow (create room → play a hand → open modal → see history and stats).
- [ ] **.gitignore:** `server/data/` is ignored.
- [ ] **No placeholders:** Every code block is real code that compiles and passes its test.
- [ ] **Type consistency:** `HandRow`, `PlayerStats`, `ProfileResponse` use the same property names and shapes across server and client.

---

## Out of scope (deferred)

- Pagination in the History tab (server returns the first page; UI Prev/Next are disabled in v1).
- Persistent bankroll across sessions (separate feature).
- Hand replay UI (card data is stored, no viewer yet).
- Public profiles / leaderboards.
- Supabase swap (the `player-identity.ts` abstraction is the swap point).
- Bankroll inside the profile view (only `net_profit` is shown).

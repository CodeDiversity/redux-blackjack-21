# Bankroll Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player bankrolls survive a server restart (both graceful `Ctrl+C` and `kill -9`) by storing them in the existing `better-sqlite3` database, hydrated on seat assignment and written back after every bankroll-changing action.

**Architecture:** One new table (`bankrolls`) added to `SCHEMA_SQL`. One new repository (`bankroll.repository.ts`) with two pure functions: `getBankroll(playerId)` and `setBankroll(playerId, amount)`. Two surgical changes to `room.service.ts`: `assignSeat` threads `playerId` and calls `getBankroll` to override the seat's default bankroll; `apply` snapshots pre-action bankrolls, runs the existing pure state machine, and diffs to call `setBankroll` for any seat whose bankroll changed.

**Tech Stack:** `better-sqlite3` (already a server dependency), NestJS (already used for `RoomService`), Jest (already the server test runner). No new dependencies. No client changes.

## Global Constraints

- **Spec source:** `docs/superpowers/specs/2026-06-26-bankroll-persistence-design.md` — every task implements one or more sections of it.
- **No client changes.** The localStorage UUID, the socket auth handshake, and the `bankroll` field on `game:state` are all already in place. Do not modify any file under `client/`.
- **No new dependencies.** `better-sqlite3` is already at `server/package.json:14`. Do not add anything.
- **State machine stays pure.** Persistence is `room.service`'s job, mirroring how `hands.repository.recordHand()` is called from the gateway (not from inside `applyAction`).
- **Test pattern:** server tests live under `server/test/` (not `server/src/`). The Jest config in `server/package.json` matches `(/test/.*|(\.|/)(spec|test))\.(ts|js)$`. Use the existing `_resetDbForTests()` + `mkdtempSync` pattern from `server/test/storage/hands.repository.spec.ts:1-12`.
- **DDL is idempotent.** `CREATE TABLE IF NOT EXISTS bankrolls` — safe to re-run on every boot, safe to re-run during tests.
- **Existing UUID-v4 validation in `server/src/player/player-identity.ts:14-19`** is the trust boundary for playerIds. No additional validation needed in the repository.
- **Commit message format:** follow `git log --oneline -10` — `<type>(<scope>): <verb> <noun>`. Examples: `feat(server): add bankrolls table`, `test(server): cover bankroll hydration`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `server/src/storage/db.ts` | Modify | Append `bankrolls` DDL to `SCHEMA_SQL`. |
| `server/src/storage/bankroll.repository.ts` | **Create** | `getBankroll(playerId)`, `setBankroll(playerId, amount)`. |
| `server/test/storage/bankroll.repository.spec.ts` | **Create** | Unit tests for the repository. |
| `server/test/storage/db.spec.ts` | Modify | Add a "creates the bankrolls table" assertion. |
| `server/src/room/room.service.ts` | Modify | Thread `playerId` through `assignSeat`. Add hydrate + writeback. |
| `server/test/room-bankroll.spec.ts` | **Create** | Hydration + writeback unit tests for `RoomService`. |
| `server/test/gateway-bankroll-persistence.spec.ts` | **Create** | Integration test: bankroll survives server restart. |

No other files. No client files. No type changes (`PlayerSeat.bankroll` stays `number`).

---

## Task 1: Schema + repository (TDD)

**Files:**
- Modify: `server/src/storage/db.ts` (append one DDL block to `SCHEMA_SQL`)
- Create: `server/src/storage/bankroll.repository.ts`
- Modify: `server/test/storage/db.spec.ts` (add one `it` block)
- Create: `server/test/storage/bankroll.repository.spec.ts`

**Interfaces (consumed by later tasks):**
- Produces: `getBankroll(playerId: string): number` — returns `Config.STARTING_BANKROLL` (1000) when no row exists, never throws on a missing row.
- Produces: `setBankroll(playerId: string, amount: number): void` — UPSERT into `bankrolls`. Synchronous. Throws only on SQLite-level failures (disk full, file locked).

### Step 1: Write the failing test for the new table

Read `server/test/storage/db.spec.ts` first to match its style. Then append one new `it` block at the end of the existing `describe('storage/db', () => { ... })`:

```ts
it('creates the bankrolls table on a fresh DB', () => {
  const dbPath = join(dir, 'blackjack.db');
  initDb({ dbPath });
  const db = getDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='bankrolls'"
  ).all() as { name: string }[];
  expect(tables.map((t) => t.name)).toContain('bankrolls');

  // Smoke-check the schema: the two required columns must exist.
  const cols = db.prepare("PRAGMA table_info(bankrolls)").all() as { name: string }[];
  const names = cols.map((c) => c.name);
  expect(names).toEqual(expect.arrayContaining(['player_id', 'amount', 'updated_at']));
});
```

### Step 2: Run the test to confirm it fails

Run: `cd server && npx jest test/storage/db.spec.ts`
Expected: FAIL — `bankrolls` table does not exist. The existing tests in the file still pass.

### Step 3: Add the bankrolls DDL to `server/src/storage/db.ts`

Read `server/src/storage/db.ts` first. Append one DDL block to the `SCHEMA_SQL` constant (after the existing hands indexes), preserving the exact indentation and trailing-newline style:

```sql
CREATE TABLE IF NOT EXISTS bankrolls (
  player_id   TEXT    PRIMARY KEY,
  amount      INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

### Step 4: Run the db test to confirm it passes

Run: `cd server && npx jest test/storage/db.spec.ts`
Expected: PASS — all tests in the file pass, including the new `bankrolls` assertion.

### Step 5: Write the failing repository tests

Create `server/test/storage/bankroll.repository.spec.ts` with this complete content:

```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, _resetDbForTests } from '../../src/storage/db';
import { Config } from '../../src/config';
import { getBankroll, setBankroll } from '../../src/storage/bankroll.repository';

const playerA = '00000000-0000-4000-8000-000000000001';
const playerB = '00000000-0000-4000-8000-000000000002';

function freshDb() {
  _resetDbForTests();
  const dir = mkdtempSync(join(tmpdir(), 'bj21-bankroll-'));
  initDb({ dbPath: join(dir, 'blackjack.db') });
  return dir;
}

describe('bankroll.repository', () => {
  let dir: string;
  beforeEach(() => { dir = freshDb(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); _resetDbForTests(); });

  it('getBankroll returns STARTING_BANKROLL for an unknown player', () => {
    expect(getBankroll(playerA)).toBe(Config.STARTING_BANKROLL);
  });

  it('setBankroll then getBankroll returns the stored amount', () => {
    setBankroll(playerA, 800);
    expect(getBankroll(playerA)).toBe(800);
  });

  it('setBankroll is an upsert: second call wins', () => {
    setBankroll(playerA, 800);
    setBankroll(playerA, 600);
    expect(getBankroll(playerA)).toBe(600);
  });

  it('different playerIds are independent', () => {
    setBankroll(playerA, 800);
    setBankroll(playerB, 400);
    expect(getBankroll(playerA)).toBe(800);
    expect(getBankroll(playerB)).toBe(400);
  });

  it('setBankroll stores updated_at as a recent timestamp', () => {
    const before = Date.now();
    setBankroll(playerA, 800);
    const after = Date.now();
    const row = getDb()
      .prepare('SELECT updated_at FROM bankrolls WHERE player_id = ?')
      .get(playerA) as { updated_at: number };
    expect(row.updated_at).toBeGreaterThanOrEqual(before);
    expect(row.updated_at).toBeLessThanOrEqual(after);
  });
});
```

Add this import to the top of `server/test/storage/bankroll.repository.spec.ts` (next to the existing `../../src/storage/db` import):

```ts
import { getDb } from '../../src/storage/db';
```

The `setBankroll stores updated_at as a recent timestamp` test uses `getDb()` to peek at the raw `bankrolls` row directly.

### Step 6: Run the test to confirm it fails

Run: `cd server && npx jest test/storage/bankroll.repository.spec.ts`
Expected: FAIL — module `../../src/storage/bankroll.repository` does not exist or `getBankroll`/`setBankroll` are not exported.

### Step 7: Implement the repository

Create `server/src/storage/bankroll.repository.ts`:

```ts
import { getDb } from './db';
import { Config } from '../config';

/**
 * Read the current persisted bankroll for a player.
 *
 * Returns Config.STARTING_BANKROLL (1000) when the player has no row yet —
 * this is the "first visit" case. Never throws on a missing row.
 */
export function getBankroll(playerId: string): number {
  const row = getDb()
    .prepare('SELECT amount FROM bankrolls WHERE player_id = ?')
    .get(playerId) as { amount: number } | undefined;
  return row?.amount ?? Config.STARTING_BANKROLL;
}

/**
 * Persist the current bankroll for a player. UPSERT: first call inserts;
 * subsequent calls overwrite. Synchronous; atomic per call (better-sqlite3).
 */
export function setBankroll(playerId: string, amount: number): void {
  getDb()
    .prepare(`
      INSERT INTO bankrolls (player_id, amount, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE
        SET amount = excluded.amount, updated_at = excluded.updated_at
    `)
    .run(playerId, amount, Date.now());
}
```

### Step 8: Run the test to confirm it passes

Run: `cd server && npx jest test/storage/bankroll.repository.spec.ts`
Expected: PASS — all 5 tests pass.

### Step 9: Run the full server test suite

Run: `cd server && npx jest`
Expected: All previously-passing tests still pass. Total count increases by 5 (the new repository tests) + 1 (the new db assertion).

### Step 10: Commit

```bash
cd server && git add src/storage/db.ts src/storage/bankroll.repository.ts test/storage/db.spec.ts test/storage/bankroll.repository.spec.ts
git commit -m "feat(server): persist player bankrolls in SQLite bankrolls table

Adds a bankrolls table to the existing better-sqlite3 database, plus
getBankroll/setBankroll repository functions. UPSERT semantics; first-
visit reads return Config.STARTING_BANKROLL (1000). Mirrors the
hands.repository pattern at server/src/storage/hands.repository.ts.
No client changes; no new dependencies.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

(Commit from `server/` — the repo root has both server and client as workspaces, but these files are all under `server/`. Git from the repo root with explicit paths is also fine: `git add server/src/storage/...` etc.)

---

## Task 2: Hydrate bankroll on seat assignment

**Files:**
- Modify: `server/src/room/room.service.ts` (extend `assignSeat` signature + thread `playerId` from both callers + hydrate)
- Create: `server/test/room-bankroll.spec.ts` (first describe block only — writeback tests added in Task 3)

**Interfaces (consumed by Task 3):**
- `assignSeat(state, seatId, socketId, name, playerId)` — new signature. Loads `getBankroll(playerId)` and overrides the seat's default `bankroll` field on `next[idx]`.

### Step 1: Read the existing code to understand the call sites

Read `server/src/room/room.service.ts` and locate:
- `createRoom` (line 12) — already accepts `hostPlayerId`, but currently drops it before calling `assignSeat` (line 17).
- `joinRoom` (line 27) — already accepts `playerId`, but currently drops it before calling `assignSeat` (line 33).
- `assignSeat` (line 144) — current signature is `(state, seatId, socketId, name)`. Must be extended to accept `playerId`.
- `createInitialState` (in `state-machine.ts:511`) — already sets `bankroll: Config.STARTING_BANKROLL` on every empty seat (line 515). This default will be overridden by `assignSeat` for any seat that gets a real player.

### Step 2: Write the failing hydration tests

Create `server/test/room-bankroll.spec.ts` with this complete content:

```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initDb, _resetDbForTests } from '../src/storage/db';
import { Config } from '../src/config';
import { setBankroll } from '../src/storage/bankroll.repository';
import { RoomService } from '../src/room/room.service';

const playerA = '00000000-0000-4000-8000-000000000001';
const playerB = '00000000-0000-4000-8000-000000000002';

describe('RoomService bankroll hydration', () => {
  let dir: string;

  beforeEach(() => {
    _resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), 'bj21-room-bankroll-'));
    initDb({ dbPath: join(dir, 'blackjack.db') });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetDbForTests();
  });

  it('createRoom hydrates the host seat from a persisted row', () => {
    setBankroll(playerA, 800);
    const svc = new RoomService();
    const { state } = svc.createRoom('socket-A', 'Alice', playerA);
    const hostSeat = state.players.find((p) => p.name === 'Alice');
    expect(hostSeat?.bankroll).toBe(800);
  });

  it('createRoom uses STARTING_BANKROLL when no row exists', () => {
    // No setBankroll call — playerA has no row.
    const svc = new RoomService();
    const { state } = svc.createRoom('socket-A', 'Alice', playerA);
    const hostSeat = state.players.find((p) => p.name === 'Alice');
    expect(hostSeat?.bankroll).toBe(Config.STARTING_BANKROLL);
  });

  it('joinRoom hydrates the joining seat from a persisted row', () => {
    setBankroll(playerB, 600);
    const svc = new RoomService();
    const { roomId } = svc.createRoom('socket-A', 'Alice', playerA);
    const { state } = svc.joinRoom(roomId, 'socket-B', 'Bob', playerB);
    const guestSeat = state.players.find((p) => p.name === 'Bob');
    expect(guestSeat?.bankroll).toBe(600);
  });

  it('joinRoom uses STARTING_BANKROLL when no row exists', () => {
    const svc = new RoomService();
    const { roomId } = svc.createRoom('socket-A', 'Alice', playerA);
    const { state } = svc.joinRoom(roomId, 'socket-B', 'Bob', playerB);
    const guestSeat = state.players.find((p) => p.name === 'Bob');
    expect(guestSeat?.bankroll).toBe(Config.STARTING_BANKROLL);
  });
});
```

### Step 3: Run the test to confirm it fails

Run: `cd server && npx jest test/room-bankroll.spec.ts`
Expected: FAIL — `assignSeat` ignores `playerId`, so the host/guest seats keep `STARTING_BANKROLL` regardless of what was persisted. Specifically, the two `toBe(800)` and `toBe(600)` assertions fail.

### Step 4: Extend `assignSeat` to thread and hydrate bankroll

In `server/src/room/room.service.ts`:

1. Add the import at the top of the file (with the other imports):

```ts
import { getBankroll } from '../storage/bankroll.repository';
```

2. Update `assignSeat`'s signature and body (line 144). Replace the entire method with:

```ts
private assignSeat(state: GameState, seatId: string, socketId: string, name: string, playerId: string): PlayerSeat {
  const idx = state.players.findIndex((p) => p.status === 'empty');
  if (idx === -1) throw new GameError('ROOM_FULL');
  const next = [...state.players];
  next[idx] = {
    ...next[idx],
    id: seatId,
    name,
    bankroll: getBankroll(playerId),
    status: 'betting' as const,
    connectedAt: Date.now(),
  };
  state.players = next;
  return next[idx];
}
```

The change from the original is the addition of `playerId: string` to the parameter list and the explicit `bankroll: getBankroll(playerId)` field (replacing the `STARTING_BANKROLL` default inherited from `createInitialState`).

3. Update the two callers to pass `playerId`:

- `createRoom` (line 17): change `this.assignSeat(state, seatId, hostSocketId, hostName)` to `this.assignSeat(state, seatId, hostSocketId, hostName, hostPlayerId)`.
- `joinRoom` (line 33): change `this.assignSeat(room.state, seatId, socketId, name)` to `this.assignSeat(room.state, seatId, socketId, name, playerId)`.

### Step 5: Run the test to confirm it passes

Run: `cd server && npx jest test/room-bankroll.spec.ts`
Expected: PASS — all 4 hydration tests pass.

### Step 6: Run the full server test suite

Run: `cd server && npx jest`
Expected: All previously-passing tests still pass, plus the 4 new hydration tests. The pre-existing `room-resume.spec.ts` should still pass because `assignSeat` is `private` and its signature is only changed for our callers.

### Step 7: Commit

```bash
cd server && git add src/room/room.service.ts test/room-bankroll.spec.ts
git commit -m "feat(server): hydrate seat bankroll from persistence on assignment

Thread playerId through RoomService.assignSeat (called from createRoom
and joinRoom). The seat's default bankroll (Config.STARTING_BANKROLL,
inherited from createInitialState) is replaced by getBankroll(playerId)
so a returning player sees their persisted funds.

resumeSeat is intentionally NOT a hydration point — see spec §3.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Writeback bankroll after bankroll-changing actions

**Files:**
- Modify: `server/src/room/room.service.ts` (add `setBankroll` import; modify `apply`)
- Modify: `server/test/room-bankroll.spec.ts` (add the second `describe` block)

**Interfaces (consumed by Task 4):**
- `RoomService.apply(roomId, action, draw?)` — unchanged signature, unchanged return type. After the existing state-machine reduce, diff pre/post bankrolls and call `setBankroll` for any seat whose bankroll changed AND whose status is not `empty`. Uses `room.seats.get(seatId).playerId` to look up the playerId for the upsert key.

### Step 1: Read the existing `apply` method and the state machine

Read `server/src/room/room.service.ts:80-86` (the `apply` method). It is:

```ts
apply(roomId: string, action: Action, draw?: () => Card): GameState {
  const room = this.rooms.get(roomId);
  if (!room) throw new GameError('ROOM_NOT_FOUND');
  const next = applyAction(room.state, action, draw);
  room.state = next;
  return next;
}
```

Read `server/src/game/state-machine.ts:368`, `:395`, `:419`, `:448` to confirm: those four lines are the only places inside `applyAction` that mutate `PlayerSeat.bankroll`. The diff in this task catches all four.

### Step 2: Write the failing writeback tests

Append a second `describe` block to `server/test/room-bankroll.spec.ts` (do NOT remove the existing `describe` from Task 2):

```ts
import { applyAction } from '../src/game/state-machine';
import type { Action } from '../src/game/state-machine';

describe('RoomService bankroll writeback', () => {
  let dir: string;
  let svc: RoomService;
  let roomId: string;
  let hostSeatId: string;
  let guestSeatId: string;
  let guestPlayerId: string;

  beforeEach(async () => {
    _resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), 'bj21-room-bankroll-wb-'));
    initDb({ dbPath: join(dir, 'blackjack.db') });

    // Seed: host at 1000, guest at 1000.
    setBankroll(playerA, 1000);
    setBankroll(playerB, 1000);

    svc = new RoomService();
    const host = svc.createRoom('socket-A', 'Alice', playerA);
    roomId = host.roomId;
    hostSeatId = host.seatId;

    const guest = svc.joinRoom(roomId, 'socket-B', 'Bob', playerB);
    guestSeatId = guest.seatId;
    guestPlayerId = playerB;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetDbForTests();
  });

  it('writeback fires for bet:place and persists the new bankroll', () => {
    const action: Action = { type: 'bet:place', seatId: hostSeatId, amount: 50 };
    svc.apply(roomId, action);
    // Host's bankroll should now be 950 in the DB.
    const row = getDb()
      .prepare('SELECT amount FROM bankrolls WHERE player_id = ?')
      .get(playerA) as { amount: number };
    expect(row.amount).toBe(950);
  });

  it('writeback fires independently for each player', () => {
    svc.apply(roomId, { type: 'bet:place', seatId: hostSeatId, amount: 50 });
    svc.apply(roomId, { type: 'bet:place', seatId: guestSeatId, amount: 100 });
    const host = getDb().prepare('SELECT amount FROM bankrolls WHERE player_id = ?').get(playerA) as { amount: number };
    const guest = getDb().prepare('SELECT amount FROM bankrolls WHERE player_id = ?').get(guestPlayerId) as { amount: number };
    expect(host.amount).toBe(950);
    expect(guest.amount).toBe(900);
  });

  it('writeback does NOT fire when bankroll is unchanged (e.g. round:ready)', () => {
    // round:ready does not touch bankroll. Seed with a known row, run it,
    // assert the row's updated_at is unchanged (or — if the row was never
    // written — assert no row was written).
    _resetDbForTests();
    initDb({ dbPath: join(dir, 'blackjack.db') });
    setBankroll(playerA, 1000);
    const rowBefore = getDb().prepare('SELECT updated_at FROM bankrolls WHERE player_id = ?').get(playerA) as { updated_at: number };

    svc.apply(roomId, { type: 'round:ready', seatId: hostSeatId });

    const rowAfter = getDb().prepare('SELECT updated_at FROM bankrolls WHERE player_id = ?').get(playerA) as { updated_at: number };
    expect(rowAfter.updated_at).toBe(rowBefore.updated_at);
  });

  it('writeback does NOT fire for empty seats', () => {
    // Only one player in the room — other seats are 'empty'. Even if a
    // round-level action somehow touched an empty seat (it does not, today),
    // the writeback must skip it because status === 'empty'.
    setBankroll(playerB, 1000);  // guest playerId exists but seat is empty
    const before = getDb().prepare('SELECT amount FROM bankrolls WHERE player_id = ?').get(playerB) as { amount: number };

    svc.apply(roomId, { type: 'round:ready', seatId: hostSeatId });

    const after = getDb().prepare('SELECT amount FROM bankrolls WHERE player_id = ?').get(playerB) as { amount: number };
    expect(after.amount).toBe(before.amount);
  });
});
```

Add this import near the top of the file (with the other storage imports):

```ts
import { getDb } from '../src/storage/db';
```

(`getDb` is needed to peek at raw SQLite rows from inside the tests. The test file already imports `initDb`, `_resetDbForTests`, `setBankroll`.)

### Step 3: Run the test to confirm it fails

Run: `cd server && npx jest test/room-bankroll.spec.ts`
Expected: FAIL — the 4 writeback tests fail. The 4 hydration tests from Task 2 still pass.

### Step 4: Implement the writeback in `RoomService.apply`

In `server/src/room/room.service.ts`:

1. Add `setBankroll` to the existing `bankroll.repository` import at the top:

```ts
import { getBankroll, setBankroll } from '../storage/bankroll.repository';
```

2. Replace the `apply` method (line 80) with:

```ts
apply(roomId: string, action: Action, draw?: () => Card): GameState {
  const room = this.rooms.get(roomId);
  if (!room) throw new GameError('ROOM_NOT_FOUND');

  // Snapshot pre-action bankrolls so we can writeback any seat whose
  // bankroll changed. The state machine is pure; persistence is the room
  // service's job (mirrors how hands.repository.recordHand is called from
  // the gateway, not from inside applyAction).
  const prevBankrolls = room.state.players.map((p) => p.bankroll);

  const next = applyAction(room.state, action, draw);
  room.state = next;

  for (let i = 0; i < next.players.length; i++) {
    const seat = next.players[i];
    if (seat.status === 'empty') continue;
    if (prevBankrolls[i] === seat.bankroll) continue;
    const entry = room.seats.get(seat.id);
    if (!entry?.playerId) continue;
    setBankroll(entry.playerId, seat.bankroll);
  }

  return next;
}
```

### Step 5: Run the test to confirm it passes

Run: `cd server && npx jest test/room-bankroll.spec.ts`
Expected: PASS — all 8 tests in the file pass (4 hydration + 4 writeback).

### Step 6: Run the full server test suite

Run: `cd server && npx jest`
Expected: All previously-passing tests still pass, plus the 4 new writeback tests. Pre-existing gateway tests that exercise `apply` (e.g. `gateway-early-deal.spec.ts`, `gateway-auto-advance.spec.ts`) should still pass — the diff is a no-op for them unless an action actually changes a bankroll.

### Step 7: Commit

```bash
cd server && git add src/room/room.service.ts test/room-bankroll.spec.ts
git commit -m "feat(server): writeback seat bankroll after every action

After applyAction returns in RoomService.apply, diff pre/post bankrolls
for every seat and call setBankroll for any seat whose bankroll changed
AND whose status is not 'empty'. Catches all four state-machine
transitions that mutate PlayerSeat.bankroll (bet:place, hand:split,
round:resolve, sitting_out) without coupling the writeback to any
specific action type.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Integration test — bankroll survives server restart

**Files:**
- Create: `server/test/gateway-bankroll-persistence.spec.ts`

**Interfaces (no new code):**
- The persistence path is wired end-to-end. This test exercises it via the existing gateway + `RoomService` via socket.io, then closes the app, re-opens with the same DB path, and asserts hydration.

### Step 1: Write the integration test

Create `server/test/gateway-bankroll-persistence.spec.ts` with this complete content:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { GameState, LobbyState } from '../src/shared/types';
import { getDb } from '../src/storage/db';

async function listen<T = any>(socket: Socket, event: string, predicate?: (p: T) => boolean): Promise<T> {
  return new Promise<T>((resolve) => {
    const handler = (p: T) => { if (!predicate || predicate(p)) { socket.off(event, handler); resolve(p); } };
    socket.on(event, handler);
  });
}

async function connectPlayer(url: string, playerId: string): Promise<Socket> {
  const socket = io(url, { transports: ['websocket'], forceNew: true, auth: { playerId } });
  await new Promise<void>((r) => socket.on('connect', () => r()));
  return socket;
}

describe('bankroll persistence (end-to-end)', () => {
  const playerA = '00000000-0000-4000-8000-0000000000a1';
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-bp-e2e-'));
    dbPath = join(dir, 'blackjack.db');
    process.env.DB_PATH = dbPath;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a player\'s bankroll survives an app restart', async () => {
    // --- Phase 1: connect, bet, writeback happens ---
    jest.resetModules();
    const { AppModule } = require('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app1: INestApplication = moduleRef.createNestApplication();
    app1.enableCors({ origin: '*', credentials: true });
    await app1.listen(0);
    const url1 = `http://localhost:${app1.getHttpServer().address().port}`;

    const host = await connectPlayer(url1, playerA);
    const lobby = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
    const lobbyState = await lobby;
    const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await betting;

    host.emit('bet:place', { amount: 50 });
    const afterBet = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');
    await afterBet;

    // Confirm the writeback landed in the DB.
    const row1 = getDb()
      .prepare('SELECT amount FROM bankrolls WHERE player_id = ?')
      .get(playerA) as { amount: number };
    expect(row1.amount).toBe(950);

    host.disconnect();
    await app1.close();

    // --- Phase 2: re-open the same DB path, create a new room, hydrate ---
    jest.resetModules();
    const { AppModule: AppModule2 } = require('../src/app.module');
    const moduleRef2 = await Test.createTestingModule({ imports: [AppModule2] }).compile();
    const app2: INestApplication = moduleRef2.createNestApplication();
    app2.enableCors({ origin: '*', credentials: true });
    await app2.listen(0);
    const url2 = `http://localhost:${app2.getHttpServer().address().port}`;

    const host2 = await connectPlayer(url2, playerA);
    const lobby2 = listen<LobbyState>(host2, 'lobby:state');
    await new Promise<void>((resolve) => host2.emit('room:create', { name: 'Alice2' }, () => resolve()));
    const lobbyState2 = await lobby2;
    expect(lobbyState2.roomId).toBeTruthy();

    const betting2 = listen<GameState>(host2, 'game:state', (s) => s.phase === 'lobby' || s.phase === 'betting');
    // The first game:state after lobby:state carries the new room's seats.
    // After round:ready we move to betting, and the seat should already be
    // hydrated to 950.
    host2.emit('round:ready');
    const state2 = await betting2;

    // The freshly-assigned host seat must show bankroll === 950 (persisted),
    // NOT 1000 (STARTING_BANKROLL).
    const hostSeat = state2.players.find((p) => p.name === 'Alice2');
    expect(hostSeat?.bankroll).toBe(950);

    host2.disconnect();
    await app2.close();
  }, 30_000);
});
```

### Step 2: Run the test to confirm it passes

Run: `cd server && npx jest test/gateway-bankroll-persistence.spec.ts`
Expected: PASS — the integration test exercises the full hydration + writeback path end-to-end.

### Step 3: Run the full server test suite

Run: `cd server && npx jest`
Expected: All previously-passing tests still pass, plus the new integration test. Total test count grows by 1 (the integration test is a single `it` block).

### Step 4: Commit

```bash
cd server && git add test/gateway-bankroll-persistence.spec.ts
git commit -m "test(server): cover bankroll persistence end-to-end through restart

Two-phase integration test: connect via socket.io, bet, confirm the
writeback landed in SQLite. Close the app, re-open with the same DB
path, connect again, create a room, and assert the freshly-assigned
host seat hydrates to the persisted amount (950) instead of
STARTING_BANKROLL (1000).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Final Verification Gate

Run all four commands from the repo root before declaring the plan complete:

- [ ] **Server type-check:** `cd server && npx tsc --noEmit` → no errors. (Sanity: no `any`-leaks or missing imports slipped through.)
- [ ] **Server tests:** `cd server && npx jest` → all suites pass, including the new `bankroll.repository.spec.ts`, `room-bankroll.spec.ts`, `gateway-bankroll-persistence.spec.ts`, and the extended `db.spec.ts`.
- [ ] **Client type-check:** `cd client && npx tsc -b --noEmit` → no errors. (Sanity: no client files were touched, but this is the cheapest confirmation.)
- [ ] **Client tests:** `cd client && npx vitest run` → 128/128 pass. (Same as above — sanity check only.)

If any of these fail, fix the cause before declaring done — do not skip or `.skip()` the failing test as a workaround.

## E2E (Playwright) — explicitly skipped

The spec defers the question of whether to add a Playwright E2E for persistence. **Decision for this plan: skip.** The integration test in Task 4 (`gateway-bankroll-persistence.spec.ts`) exercises the full hydration path end-to-end through the socket.io boundary. A Playwright E2E would:

- Reload the browser, re-create or re-join a room.
- Assert the seat chip / displayed bankroll matches the pre-reload value.

The only unique coverage vs. the integration test is "does the React UI display the hydrated bankroll correctly?" — which is a client-rendering test, not a persistence test. It is not in scope for this feature (no client changes were made). If we later add a UI element that needs explicit hydration coverage (e.g. a "lifetime net" card), a Playwright test for that element should be added then.

## What this plan does NOT do

- Persist room state. Rooms are still ephemeral; only bankrolls survive. (Spec non-goal.)
- Persist hands-in-progress. If the server crashes mid-hand, the hand is lost. The bankroll reflects the last fully-completed writeback. (Spec non-goal.)
- Re-hydrate bankroll on `resumeSeat`. A reconnecting player keeps the seat's current in-memory bankroll (which is already equal to the persisted value). (Spec §3.)
- Add a `bankroll_history` table, a "reset bankroll" admin endpoint, or session-based playerId uniqueness enforcement. (Spec "Out of scope for follow-up".)

# Fast Deal on All Bets Placed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End the `betting` phase immediately (no countdown, no grace period) the moment every active player has placed a bet, so single-player and multiplayer "all in" no longer wait the full 10s `BET_DEADLINE_MS`.

**Architecture:** Server-only change in `server/src/gateway/game.gateway.ts`. Add an `allActivePlayersHaveBet(state)` predicate; extract a `fireBetDeadlineNow(roomId)` helper out of the existing `fireAutoAdvance('betting')` branch; modify `onBet` to call `cancelAutoAdvance` + `fireBetDeadlineNow` when the predicate is true. State machine, client components, shared types, and config are untouched. The 10s `BET_DEADLINE_MS` timer stays as the fallback for slow betters.

**Tech Stack:** NestJS gateway + Socket.IO (server), Jest + socket.io-client (server integration tests), Playwright (client E2E), TypeScript end-to-end.

## Global Constraints

- The 10s `BET_DEADLINE_MS` window remains as the fallback for slow betters — do not remove or shorten it.
- The 3s `SETTLE_PAUSE_MS` and 2s `DEALING_DURATION_MS` are unchanged.
- Single-player is a special case of the same rule, not a separate code path.
- No state-machine changes: reuse the existing `round:betDeadline` action and `assignBetDeadline` transition.
- The early-exit must produce exactly one `game:state` broadcast per `onBet` call (no flash of intermediate "betting" state with full countdown).
- `cancelAutoAdvance(roomId)` must be called before `fireBetDeadlineNow(roomId)` so the 10s fallback timer cannot fire on a phase that has already advanced.
- Server test files live under `server/test/` and follow the `gateway-auto-advance.spec.ts` pattern (real timers, `setTimeout` waits; `INestApplication` bootstrap in `beforeAll`).
- E2E test files live under `client/e2e/` and follow the `happy-path.spec.ts` pattern (Playwright `chromium.launch`, two `BrowserContext`s for host/guest).
- Each task's deliverable ends in a commit. No batching across tasks.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `server/src/gateway/game.gateway.ts` | NestJS WebSocket gateway. Owns the `pendingTimers` map, broadcasts `game:state`, runs `onBet`. | Modify: add `allActivePlayersHaveBet`; extract `fireBetDeadlineNow`; modify `onBet` |
| `server/test/gateway-early-deal.spec.ts` (new) | Integration tests for the new early-deal behavior through the gateway socket API | Create |
| `server/test/gateway-auto-advance.spec.ts` | Existing 10s/3s/2s timer regression coverage | Modify: refactor bet-deadline block to use the new shared helper |
| `client/e2e/early-deal.spec.ts` (new) | Playwright coverage for solo fast-deal and 2-player fast-deal | Create |

No other files are touched. The state machine, lobby UI, dealing animation, shared types, and config stay as-is.

---

## Task 1: Write the failing early-deal test suite

**Files:**
- Create: `server/test/gateway-early-deal.spec.ts`

**Interfaces (used by tests):**
- The socket emits `bet:place` with `{ amount: number }`.
- `game:state` broadcasts arrive on every state change; tests listen for the next broadcast matching a phase predicate.

This task only writes tests. Implementation comes in Tasks 2 and 3.

- [ ] **Step 1: Create the test file with the bootstrap block**

`server/test/gateway-early-deal.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Config } from '../src/config';
import type { GameState, LobbyState } from '../src/shared/types';

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

async function createRoomAndStartBetting(host: Socket): Promise<void> {
  const lobby = listen<LobbyState>(host, 'lobby:state');
  await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
  await lobby;
  const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
  host.emit('round:ready');
  await betting;
}

describe('gateway early-deal (all-active-players-have-bet)', () => {
  let app: INestApplication;
  let url: string;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bj21-earlydeal-'));
    process.env.DB_PATH = join(dir, 'blackjack.db');
    jest.resetModules();
    const { AppModule } = require('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors({ origin: '*', credentials: true });
    await app.listen(0);
    const addr = app.getHttpServer().address();
    url = `http://localhost:${addr.port}`;
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('solo host: betting → dealing fires immediately after Place Bet (no 10s wait)', async () => {
    const host = await connectPlayer(url, '00000000-0000-4000-8000-000000000010');
    await createRoomAndStartBetting(host);

    const dealing = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');
    host.emit('bet:place', { amount: 50 });

    // If the early-deal path is wired, dealing arrives in ~one network roundtrip.
    // If it isn't wired, dealing only arrives after BET_DEADLINE_MS + DEALING_DURATION_MS,
    // so the 500ms timeout will reject first.
    const got = await Promise.race([
      dealing,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('dealing did not arrive within 500ms')), 500)),
    ]);
    expect(got.phase).toBe('dealing');

    host.disconnect();
  }, 10_000);

  it('two players: dealing fires only after the second player bets', async () => {
    const host = await connectPlayer(url, '00000000-0000-4000-8000-000000000011');
    const guest = await connectPlayer(url, '00000000-0000-4000-8000-000000000012');
    const lobby = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
    const lobbyState = await lobby;
    await new Promise<void>((resolve) => guest.emit('room:join', { roomId: lobbyState.roomId, name: 'Bob' }, () => resolve()));

    const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await betting;

    // After A bets, phase must still be betting.
    const afterA = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting' && s.players.some((p) => p.hands[0]?.bet === 50));
    host.emit('bet:place', { amount: 50 });
    const stateAfterA = await Promise.race([
      afterA,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('expected betting state after A')), 1_000)),
    ]);
    expect(stateAfterA.phase).toBe('betting');

    // After B bets, dealing must arrive quickly.
    const dealing = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');
    guest.emit('bet:place', { amount: 50 });
    const stateAfterB = await Promise.race([
      dealing,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('expected dealing after B')), 1_000)),
    ]);
    expect(stateAfterB.phase).toBe('dealing');

    host.disconnect();
    guest.disconnect();
  }, 15_000);

  it('slow better: 10s fallback still fires when only one of two players bets', async () => {
    const host = await connectPlayer(url, '00000000-0000-4000-8000-000000000013');
    const guest = await connectPlayer(url, '00000000-0000-4000-8000-000000000014');
    const lobby = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => host.emit('room:create', { name: 'Alice' }, () => resolve()));
    const lobbyState = await lobby;
    await new Promise<void>((resolve) => guest.emit('room:join', { roomId: lobbyState.roomId, name: 'Bob' }, () => resolve()));

    const betting = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting');
    host.emit('round:ready');
    await betting;

    // Only A bets; B does not. After the 10s deadline, dealing must fire and
    // B must be sitting_out. This is the existing fallback path — covered
    // here to lock in the regression.
    host.emit('bet:place', { amount: 50 });

    const dealing = listen<GameState>(host, 'game:state', (s) => s.phase === 'dealing');
    await new Promise((r) => setTimeout(r, Config.BET_DEADLINE_MS + 500));
    const got = await dealing;
    expect(got.phase).toBe('dealing');

    // The sitting_out assignment is done in assignBetDeadline, not in the
    // early-deal branch, so this only confirms the fallback path still works.
    const guestPlayer = got.players.find((p) => p.name === 'Bob');
    expect(guestPlayer?.status).toBe('sitting_out');

    host.disconnect();
    guest.disconnect();
  }, 20_000);

  it('sitting_out seats are excluded from the all-have-bet check', async () => {
    // Three seats, but one (Charlie) is sitting_out before the round starts.
    // Alice and Bob are active; once both bet, dealing must fire even though
    // Charlie has no bet.
    const alice = await connectPlayer(url, '00000000-0000-4000-8000-000000000020');
    const bob = await connectPlayer(url, '00000000-0000-4000-8000-000000000021');
    const charlie = await connectPlayer(url, '00000000-0000-4000-8000-000000000022');

    const lobby = listen<LobbyState>(alice, 'lobby:state');
    await new Promise<void>((resolve) => alice.emit('room:create', { name: 'Alice' }, () => resolve()));
    const lobbyState = await lobby;
    await new Promise<void>((resolve) => bob.emit('room:join', { roomId: lobbyState.roomId, name: 'Bob' }, () => resolve()));
    await new Promise<void>((resolve) => charlie.emit('room:join', { roomId: lobbyState.roomId, name: 'Charlie' }, () => resolve()));

    // Force Charlie into sitting_out before the round starts.
    // The simplest path: have the room run one round where Charlie didn't
    // bet, which leaves them sitting_out. We then advance to the next
    // betting phase and confirm the all-have-bet check ignores Charlie.
    const betting1 = listen<GameState>(alice, 'game:state', (s) => s.phase === 'betting');
    alice.emit('round:ready');
    await betting1;

    alice.emit('bet:place', { amount: 50 });
    bob.emit('bet:place', { amount: 50 });
    // Charlie does not bet; after the 10s fallback, Charlie becomes sitting_out.
    const dealing1 = listen<GameState>(alice, 'game:state', (s) => s.phase === 'dealing');
    await new Promise((r) => setTimeout(r, Config.BET_DEADLINE_MS + 500));
    await dealing1;

    // All stand to reach settled, then advance to the next betting phase.
    for (let i = 0; i < 4; i++) {
      alice.emit('hand:stand', { handIndex: 0 });
      bob.emit('hand:stand', { handIndex: 0 });
      await new Promise((r) => setTimeout(r, 50));
    }
    const settled = listen<GameState>(alice, 'game:state', (s) => s.phase === 'settled');
    await settled;
    const betting2 = listen<GameState>(alice, 'game:state', (s) => s.phase === 'betting');
    await new Promise((r) => setTimeout(r, Config.SETTLE_PAUSE_MS + 500));
    const stateBeforeBet2 = await betting2;
    const charlieSeat = stateBeforeBet2.players.find((p) => p.name === 'Charlie');
    expect(charlieSeat?.status).toBe('sitting_out');

    // Now Alice and Bob bet. The all-have-bet check must ignore Charlie
    // (sitting_out) and fire dealing immediately.
    const dealing2 = listen<GameState>(alice, 'game:state', (s) => s.phase === 'dealing');
    alice.emit('bet:place', { amount: 50 });
    bob.emit('bet:place', { amount: 50 });
    const got = await Promise.race([
      dealing2,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('expected dealing after Alice and Bob bet')), 1_000)),
    ]);
    expect(got.phase).toBe('dealing');

    alice.disconnect();
    bob.disconnect();
    charlie.disconnect();
  }, 30_000);

  it('no intermediate betting broadcast after the all-in bet', async () => {
```

- [ ] **Step 2: Run the new tests to confirm they fail (where they should)**

Run: `cd server && npx jest test/gateway-early-deal.spec.ts`
Expected:
- Test 1 (solo fast-deal) — FAILS on the 500ms `Promise.race` rejection.
- Test 2 (two-player fast-deal) — FAILS on the 1s `Promise.race` rejection after B bets.
- Test 3 (slow-better fallback) — PASSES today; this is a regression lock-in. It guards against accidentally breaking the existing 10s fallback when wiring the early-deal branch.
- Test 4 (sitting-out exclusion) — FAILS on the 1s `Promise.race` rejection after Alice and Bob bet.
- Test 5 (no intermediate broadcast) — FAILS because today's `onBet` broadcasts the betting state before the 10s fallback fires.

- [ ] **Step 3: Commit the failing test suite**

```bash
git add server/test/gateway-early-deal.spec.ts
git commit -m "test(server): cover early-deal when all active players have bet"
```

---

## Task 2: Extract `fireBetDeadlineNow` helper (refactor only)

**Files:**
- Modify: `server/src/gateway/game.gateway.ts:120-159` (`scheduleAutoAdvance`, `cancelAutoAdvance`, `fireAutoAdvance`)

**Interfaces (used by Task 3):**
- `fireBetDeadlineNow(roomId: string): GameState` — ensures the shoe, draws two cards per betting player + a dealer upcard, and applies `{ type: 'round:betDeadline', seatId: '__server__' }`. Returns the resulting state.

This task is a pure refactor. No behavior change.

- [ ] **Step 1: Add `fireBetDeadlineNow` as a private method**

In `server/src/gateway/game.gateway.ts`, add after `cancelAutoAdvance` (currently at line ~134):

```ts
private fireBetDeadlineNow(roomId: string): GameState {
  this.games.ensureShoe(roomId, this.rooms.getState(roomId)!);
  const draw = () => this.games.draw(roomId).card;
  return this.rooms.apply(
    roomId,
    { type: 'round:betDeadline', seatId: '__server__' },
    draw,
  );
}
```

- [ ] **Step 2: Replace the duplicated body in `fireAutoAdvance` with a call to the new helper**

Replace the entire `fireAutoAdvance` method body (currently at lines 136–159) with:

```ts
private fireAutoAdvance(roomId: string, phase: 'settled' | 'betting' | 'dealing') {
  this.pendingTimers.delete(roomId);
  const room = this.rooms.getState(roomId);
  if (!room) return;
  if (room.phase !== phase) return;  // race: phase changed
  try {
    if (phase === 'settled') {
      // Server-internal round:advance. seatId '__server__' is a sentinel for tracing.
      this.rooms.apply(roomId, { type: 'round:advance', seatId: '__server__' });
      this.broadcastAll(roomId, this.rooms.getState(roomId)!);
    } else if (phase === 'dealing') {
      this.rooms.apply(roomId, { type: 'round:dealingComplete', seatId: '__server__' });
      this.broadcastAll(roomId, this.rooms.getState(roomId)!);
    } else {
      this.fireBetDeadlineNow(roomId);
      this.broadcastAll(roomId, this.rooms.getState(roomId)!);
    }
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    this.log.warn(`auto-advance failed: ${(e as GameError).code}`);
  }
}
```

The `'__server__'` sentinel comment moves up to the relevant branch. Behavior is unchanged — `fireBetDeadlineNow` does exactly what the inline block used to do.

- [ ] **Step 3: Run the existing auto-advance tests to confirm no regression**

Run: `cd server && npx jest test/gateway-auto-advance.spec.ts`
Expected: All tests pass — refactor is behavior-preserving.

- [ ] **Step 4: Run the broader server test suite as a safety net**

Run: `cd server && npx jest`
Expected: All tests pass.

- [ ] **Step 5: Confirm the new early-deal tests still fail (unchanged from Task 1)**

Run: `cd server && npx jest test/gateway-early-deal.spec.ts`
Expected: All four tests still fail in the same way as Task 1.

- [ ] **Step 6: Commit the refactor**

```bash
git add server/src/gateway/game.gateway.ts
git commit -m "refactor(server): extract fireBetDeadlineNow helper from fireAutoAdvance"
```

---

## Task 3: Implement the early-deal branch in `onBet`

**Files:**
- Modify: `server/src/gateway/game.gateway.ts` (add `allActivePlayersHaveBet` near the other helpers; modify `onBet`)

**Interfaces (used by callers — none externally; private gateway helper):**
- `allActivePlayersHaveBet(state: GameState): boolean` — returns `true` iff every non-empty, non-sitting-out player has `hands[0].bet > 0`. Always invoked after a successful `bet:place` apply, so the caller knows at least one active player has a bet.

- [ ] **Step 1: Add `allActivePlayersHaveBet` as a private method**

In `server/src/gateway/game.gateway.ts`, add immediately after `fireBetDeadlineNow` (added in Task 2):

```ts
private allActivePlayersHaveBet(state: GameState): boolean {
  // Active = not empty, not sitting_out. The caller has just applied a
  // successful bet:place, so there's at least one player with bet > 0;
  // this returns true iff no other active player is still missing a bet.
  return state.players.every((p) =>
    p.status === 'empty' || p.status === 'sitting_out' || (p.hands[0]?.bet ?? 0) > 0);
}
```

- [ ] **Step 2: Modify `onBet` to short-circuit on the all-have-bet condition**

Replace the `onBet` method body (currently at lines 233–244) with:

```ts
@SubscribeMessage('bet:place')
onBet(@ConnectedSocket() client: Socket, @MessageBody() body: { amount: number }) {
  const ctx = this.rooms.roomForSocket(client.id);
  if (!ctx) return this.sendError(client, 'NOT_YOUR_TURN');
  try {
    let state = this.rooms.apply(ctx.roomId, { type: 'bet:place', seatId: ctx.seatId, amount: body.amount });

    // Early exit: if every active player has now bet, skip the 10s deadline.
    if (state.phase === 'betting' && this.allActivePlayersHaveBet(state)) {
      this.cancelAutoAdvance(ctx.roomId);              // kill the 10s fallback timer
      state = this.fireBetDeadlineNow(ctx.roomId);     // deal immediately
    }

    this.broadcastAll(ctx.roomId, state);
  } catch (e) {
    if (e instanceof GameError) return this.sendError(client, e.code as any);
    throw e;
  }
}
```

The `state.phase === 'betting'` guard is defensive: a `bet:place` event should never apply when the phase is anything else (the `isLobbyOrBetting` guard rejects it), but the guard keeps the early-exit branch contained to the betting phase in case the machine or surrounding code ever changes.

- [ ] **Step 3: Run the new early-deal tests; confirm they pass**

Run: `cd server && npx jest test/gateway-early-deal.spec.ts`
Expected: All four tests pass.

- [ ] **Step 4: Run the full server suite to confirm no regression**

Run: `cd server && npx jest`
Expected: All tests pass — including the existing `gateway-auto-advance.spec.ts` cases (slow-better path, re-loop, room-destroyed cancel, dealing-phase auto-advance).

- [ ] **Step 5: Type-check the server**

Run: `cd server && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit the early-deal implementation**

```bash
git add server/src/gateway/game.gateway.ts
git commit -m "feat(server): deal immediately when all active players have bet"
```

---

## Task 4: Add Playwright coverage for the early-deal flows

**Files:**
- Create: `client/e2e/early-deal.spec.ts`

**Interfaces (consumed by tests):**
- `client/e2e/happy-path.spec.ts` patterns: `chromium.launch()`, two `BrowserContext`s for host/guest, navigate to `/`, fill the home form, click `Create Room` / `Join`, fill `.bet-panel input`, click `Place Bet`, wait for `.bet-panel` / `.action-panel`.

The happy-path test clicks a "Deal" button that no longer exists in the live UI; this new file uses the auto-advance flow and waits for `.action-panel` to appear instead of clicking Deal.

- [ ] **Step 1: Write the E2E test file**

`client/e2e/early-deal.spec.ts`:

```ts
import { test, expect, chromium } from '@playwright/test';

const URL = 'http://localhost:5173';

test.describe('fast deal on all bets placed', () => {
  test('solo host: dealing starts within 2s of Place Bet (no 10s wait)', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto(URL);
    await page.fill('input[placeholder="Your name"]', 'Alice');
    await page.click('button:has-text("Create Room")');
    await page.waitForURL(/\/room\//);

    await page.click('button:has-text("Begin Betting")');
    await page.waitForSelector('.bet-panel');

    const betTime = Date.now();
    await page.fill('.bet-panel input', '50');
    await page.click('button:has-text("Place Bet")');

    // The action panel appears when phase reaches 'player_turn', which is
    // after the 2s 'dealing' phase ends. If early-deal is wired, this
    // happens at ~2s. If it isn't, the full path takes BET_DEADLINE_MS (10s)
    // + DEALING_DURATION_MS (2s) ≈ 12s, which is well over the 5s budget.
    await page.waitForSelector('.action-panel', { timeout: 5_000 });
    const elapsed = Date.now() - betTime;
    expect(elapsed).toBeLessThan(5_000);

    await browser.close();
  });

  test('two players: dealing starts within 2s of the second player betting', async () => {
    const browser = await chromium.launch();
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    const guestPage = await guestCtx.newPage();

    await hostPage.goto(URL);
    await hostPage.fill('input[placeholder="Your name"]', 'Alice');
    await hostPage.click('button:has-text("Create Room")');
    await hostPage.waitForURL(/\/room\//);
    const roomUrl = hostPage.url();
    const code = roomUrl.split('/room/')[1];

    await guestPage.goto(URL);
    await guestPage.fill('input[placeholder="Your name"]', 'Bob');
    await guestPage.fill('input[placeholder="Room code"]', code);
    await guestPage.click('button:has-text("Join")');
    await guestPage.waitForURL(/\/room\//);

    await hostPage.click('button:has-text("Begin Betting")');
    await hostPage.waitForSelector('.bet-panel');

    // First bet — phase must still be betting.
    await hostPage.fill('.bet-panel input', '50');
    await hostPage.click('button:has-text("Place Bet")');
    await expect(hostPage.locator('.bet-panel')).toBeVisible();

    // Second bet — dealing should fire promptly.
    const lastBetTime = Date.now();
    await guestPage.fill('.bet-panel input', '50');
    await guestPage.click('button:has-text("Place Bet")');

    await hostPage.waitForSelector('.action-panel', { timeout: 5_000 });
    const elapsed = Date.now() - lastBetTime;
    expect(elapsed).toBeLessThan(5_000);

    await browser.close();
  });
});
```

- [ ] **Step 2: Run the E2E suite**

Pre-req: `npm run dev` is running (Vite at `http://localhost:5173`, Nest at `http://localhost:3001`), and Playwright browsers are installed.

Run: `cd client && npx playwright test early-deal.spec.ts`
Expected: Both tests pass. If the dev server is not up, start it in another terminal first.

- [ ] **Step 3: Run the full E2E suite to confirm no regression in adjacent flows**

Run: `cd client && npx playwright test`
Expected: All previously-passing tests still pass (or are still `test.skip()` placeholders for unimplemented flows — see `auto-advance.spec.ts` which is stubbed out).

- [ ] **Step 4: Commit the E2E coverage**

```bash
git add client/e2e/early-deal.spec.ts
git commit -m "test(e2e): cover early-deal on all bets placed (solo and 2-player)"
```

---

## Final Verification Gate

Run all four commands from the repo root before declaring the plan complete:

- [ ] **Server type-check:** `cd server && npx tsc --noEmit` → no errors.
- [ ] **Server tests:** `cd server && npx jest` → all suites pass, including `gateway-early-deal.spec.ts` and `gateway-auto-advance.spec.ts`.
- [ ] **Client tests:** `cd client && npx vitest run` → all suites pass.
- [ ] **E2E tests:** with `npm run dev` running, `cd client && npx playwright test early-deal.spec.ts` → both tests pass.

If any of these fail, fix the cause before merging — do not skip or `.skip()` the failing test as a workaround.
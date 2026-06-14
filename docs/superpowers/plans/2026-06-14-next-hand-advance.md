# Advance to Next Hand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a hand settles, the host can advance the table to a fresh `betting` phase for the next hand, and each player can rebet their previous round's bet with one click.

**Architecture:** New state machine action `round:advance` resets per-round state (dealer, player hands, status, `lastResult`) but leaves `shoeSize`, `cutCardIndex`, `roundNumber`, and a new `lastBet` per seat untouched. Host check lives in the gateway, not the state machine. New wire command `round:advance` (no body). New `NOT_HOST` error code. Bankroll=0 seats auto-promote to `sitting_out`. Client UI: host-gated "Next Hand" button in `ResultOverlay`; conditional "Rebet" button in `BetPanel`.

**Tech Stack:** Server: NestJS 10, TypeScript 5, Jest (existing). Client: React 18, Redux Toolkit 2, Reselect, Vitest + React Testing Library, Playwright (existing).

**Spec:** `docs/superpowers/specs/2026-06-14-next-hand-advance-design.md`

**Working directory notes:**
- All server commands are run from `server/`. All client commands from `client/`.
- Test commands (per project MEMORY):
  - Server: `npx jest` (unit + integration) and `npx tsc --noEmit`
  - Client: `npx vitest run` (unit), `npx tsc --noEmit -p tsconfig.json` (typecheck)
  - E2E: `npx playwright test` — Playwright browsers are not installed in this environment; plan typechecks the E2E file but does not run it. The user can run it locally.

---

## File Structure

The change touches three concerns across two workspaces. Files are grouped by responsibility; each commit modifies one cohesive unit.

**Server (game logic):**
- `server/src/shared/types.ts` — adds `lastBet: number` to `PlayerSeat`; adds `round:advance` to `ClientCommand`; adds `NOT_HOST` to `ErrorCode`
- `server/src/shared/errors.ts` — adds `NOT_HOST` to `ErrorMessages`
- `server/src/game/state-machine.ts` — adds `applyAdvance`; updates `settle` to populate `lastBet`; updates `createInitialState` to set `lastBet: 0`; adds `round:advance` to the `Action` union and `applyAction` switch
- `server/src/gateway/game.gateway.ts` — adds `@SubscribeMessage('round:advance')` handler with host check

**Server tests:**
- `server/test/state-machine.spec.ts` — adds `applyAction: round:advance` describe block; updates `settle` test to assert `lastBet` is populated
- `server/test/gateway.integration.spec.ts` — extends the existing 2-player full round test to play a second round; adds `NOT_HOST` and `INVALID_PHASE` tests

**Client (UI + selectors):**
- `client/src/shared/types.ts` — adds `lastBet: number` to `PlayerSeat` (mirror of server)
- `client/src/selectors/self.ts` — adds `selectMyLastBet` and `selectCanRebet`
- `client/src/components/ResultOverlay.tsx` — adds host-gated "Next Hand" button
- `client/src/components/BetPanel.tsx` — adds conditional "Rebet $X" button

**Client tests:**
- `client/test/selectors/self.spec.ts` — new spec covering `selectMyLastBet` and `selectCanRebet`
- `client/test/components/result-overlay.spec.tsx` — new spec covering "Next Hand" button visibility
- `client/test/components/bet-panel.spec.tsx` — new spec covering "Rebet" button visibility and click

**E2E:**
- `client/e2e/happy-path.spec.ts` — extends the existing test to play two rounds

No file is restructured. No file exceeds 250 lines after these edits. No new top-level files outside the `test/` directories.

---

## Task 1: Update shared types and error messages

**Files:**
- Modify: `server/src/shared/types.ts:28-35` (add `lastBet` to `PlayerSeat`)
- Modify: `server/src/shared/types.ts:62-71` (add `round:advance` to `ClientCommand`)
- Modify: `server/src/shared/types.ts:86-96` (add `NOT_HOST` to `ErrorCode`)
- Modify: `server/src/shared/errors.ts:3-14` (add `NOT_HOST` to `ErrorMessages`)
- Modify: `client/src/shared/types.ts:14-17` (add `lastBet` to `PlayerSeat` mirror)

- [ ] **Step 1: Update `server/src/shared/types.ts` — PlayerSeat, ClientCommand, ErrorCode**

In `server/src/shared/types.ts`, make three changes:

Change A — extend `PlayerSeat` (currently lines 28-35). Add `lastBet: number;` as the last field:

```ts
export type PlayerSeat = {
  id: string;
  name: string;
  bankroll: number;
  hands: Hand[];
  status: SeatStatus;
  connectedAt: number;
  lastBet: number;
};
```

Change B — extend `ClientCommand` (currently lines 62-71). Add the new variant as the last member:

```ts
export type ClientCommand =
  | { type: 'room:create'; name: string }
  | { type: 'room:join'; roomId: string; name: string }
  | { type: 'room:leave' }
  | { type: 'round:ready' }
  | { type: 'bet:place'; amount: number }
  | { type: 'hand:hit'; handIndex: number }
  | { type: 'hand:stand'; handIndex: number }
  | { type: 'hand:double'; handIndex: number }
  | { type: 'hand:split'; handIndex: number }
  | { type: 'round:advance' };
```

Change C — extend `ErrorCode` (currently lines 86-96). Add `'NOT_HOST'` as the last member:

```ts
export type ErrorCode =
  | 'NOT_YOUR_TURN'
  | 'INVALID_PHASE'
  | 'INSUFFICIENT_FUNDS'
  | 'BET_OUT_OF_RANGE'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'CANNOT_SPLIT'
  | 'HAND_LOCKED'
  | 'NAME_REQUIRED'
  | 'NOT_READY'
  | 'NOT_HOST';
```

- [ ] **Step 2: Update `server/src/shared/errors.ts` — add `NOT_HOST` message**

In `server/src/shared/errors.ts`, add `NOT_HOST: 'Only the host can start the next hand.',` to the `ErrorMessages` object. The final object should be:

```ts
export const ErrorMessages: Record<ErrorCode, string> = {
  NOT_YOUR_TURN: "It's not your turn yet.",
  INVALID_PHASE: 'You cannot do that right now.',
  INSUFFICIENT_FUNDS: 'You do not have enough chips for that.',
  BET_OUT_OF_RANGE: 'Bet is outside the allowed range.',
  ROOM_FULL: 'That room is full.',
  ROOM_NOT_FOUND: 'No room with that code.',
  CANNOT_SPLIT: 'This hand cannot be split.',
  HAND_LOCKED: 'This hand is no longer playable.',
  NAME_REQUIRED: 'Please enter a name.',
  NOT_READY: 'All seated players must place a bet first.',
  NOT_HOST: 'Only the host can start the next hand.',
};
```

- [ ] **Step 3: Update `client/src/shared/types.ts` — add `lastBet` to `PlayerSeat` mirror**

In `client/src/shared/types.ts`, change the `PlayerSeat` definition (currently lines 14-17) to add `lastBet: number`:

```ts
export type PlayerSeat = {
  id: string; name: string; bankroll: number;
  hands: Hand[]; status: SeatStatus; connectedAt: number;
  lastBet: number;
};
```

- [ ] **Step 4: Typecheck both workspaces**

Run server typecheck:
```bash
cd server && npx tsc --noEmit
```

Run client typecheck:
```bash
cd client && npx tsc --noEmit -p tsconfig.json
```

Both expected to PASS. (Existing tests construct seats by spreading `{ ...p, ... }`, which preserves the new `lastBet` field. Existing `createInitialState` does not — we will update it in Task 3. For now typecheck will complain about `lastBet` being missing in the seeded state if there is one; the client `game-slice.spec.ts` uses `players: []` so is safe. The server `state-machine.spec.ts` constructs via `createInitialState` which we will fix in Task 3. If Task 1 typecheck fails on the server, see note below.)

**Note:** If `npx tsc --noEmit` in `server/` fails with "Property 'lastBet' is missing in type '...'" for the existing tests, this is expected — Task 3 will fix it. In that case, do not commit Task 1 alone; proceed to Task 2, then Task 3, then run the typecheck again. (Practically: the existing `state-machine.spec.ts` uses `createInitialState` which is the only direct constructor; once Task 3 updates `createInitialState`, both the typecheck and the tests pass. The typecheck is therefore only a meaningful gate after Task 3.)

If both typechecks pass after Task 1, commit; otherwise defer the commit to after Task 3.

- [ ] **Step 5: Commit**

```bash
git add server/src/shared/types.ts server/src/shared/errors.ts client/src/shared/types.ts
git commit -m "feat(types): add lastBet to PlayerSeat, round:advance command, NOT_HOST error"
```

---

## Task 2: Add server state machine unit tests for `round:advance` and `settle`'s `lastBet`

**Files:**
- Modify: `server/test/state-machine.spec.ts` (add a new `describe` block for `round:advance` and an assertion in the `settle` test)

This task adds tests that will fail. The implementation comes in Task 3.

- [ ] **Step 1: Add a `settle → lastBet` test**

Append a new `describe` block at the end of `server/test/state-machine.spec.ts`:

```ts
describe('settle: lastBet population', () => {
  it('records the bet of every resolved hand into the seat lastBet', () => {
    let state = newRoom();
    state = { ...state, phase: 'player_turn', activeSeat: 0 };
    state = {
      ...state,
      players: state.players.map((p, i) => i === 0
        ? { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 75, cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }] }
        : { ...p, status: 'acting', bankroll: 1000, hands: [{ ...p.hands[0], bet: 200, cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: 'A' }] }] }),
      dealer: { ...state.dealer, cards: [{ suit: '♣', rank: 'K' }, { suit: '♦', rank: '5' }] },
    };
    // Drive to settled by having both stand.
    const deck: Card[] = [];
    let i = 0;
    const draw = () => deck[i++];
    let next = applyAction(state, { type: 'hand:stand', seatId: state.players[0].id, handIndex: 0 }, draw);
    next = applyAction(next, { type: 'hand:stand', seatId: state.players[1].id, handIndex: 0 }, draw);
    expect(next.phase).toBe('settled');
    expect(next.players[0].lastBet).toBe(75);
    expect(next.players[1].lastBet).toBe(200);
  });
});
```

- [ ] **Step 2: Add a `round:advance` describe block with all the new behaviors**

Append a second `describe` block after the one above:

```ts
describe('applyAction: round:advance', () => {
  function makeSettledState(): GameState {
    return {
      ...createInitialState('ROOM1', 2, 1),
      phase: 'settled',
      dealer: { cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: '5' }], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
      lastResult: { payouts: [{ seatId: 'x', delta: 50, reason: 'win' }] },
      activeSeat: null,
      players: [
        { id: 's0', name: 'Alice', bankroll: 1050, hands: [{ cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }], bet: 0, stood: true, busted: false, isBlackjack: false, doubled: false }], status: 'stood', connectedAt: 0, lastBet: 50 },
        { id: 's1', name: 'Bob', bankroll: 950, hands: [{ cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: '9' }], bet: 0, stood: true, busted: false, isBlackjack: false, doubled: false }], status: 'stood', connectedAt: 0, lastBet: 100 },
        { id: 's2', name: 'Carol', bankroll: 0, hands: [{ cards: [], bet: 0, stood: false, busted: true, isBlackjack: false, doubled: false }], status: 'busted', connectedAt: 0, lastBet: 200 },
        { id: 's3', name: 'Dan', bankroll: 0, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'sitting_out', connectedAt: 0, lastBet: 0 },
        { id: 's4', name: '', bankroll: 1000, hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }], status: 'empty', connectedAt: 0, lastBet: 0 },
      ],
    } as GameState;
  }

  it('transitions settled → betting and clears lastResult and activeSeat', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.phase).toBe('betting');
    expect(next.lastResult).toBeNull();
    expect(next.activeSeat).toBeNull();
  });

  it('clears the dealer hand', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.dealer.cards).toEqual([]);
    expect(next.dealer.bet).toBe(0);
    expect(next.dealer.stood).toBe(false);
    expect(next.dealer.busted).toBe(false);
  });

  it('resets every non-sitting-out, non-empty player to a single empty hand', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.players[0].hands.length).toBe(1);
    expect(next.players[0].hands[0].cards).toEqual([]);
    expect(next.players[0].hands[0].bet).toBe(0);
    expect(next.players[1].hands.length).toBe(1);
    expect(next.players[1].hands[0].cards).toEqual([]);
  });

  it('preserves sitting_out and empty seats', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.players[3].status).toBe('sitting_out');
    expect(next.players[4].status).toBe('empty');
  });

  it('auto-promotes bankroll === 0 players to sitting_out', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    // seat 2 (Carol) was 'busted' with bankroll 0 → must become 'sitting_out'
    expect(next.players[2].status).toBe('sitting_out');
  });

  it('sets non-sitting-out, non-empty, non-broke players to betting', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.players[0].status).toBe('betting');
    expect(next.players[1].status).toBe('betting');
  });

  it('leaves lastBet untouched on every seat', () => {
    const state = makeSettledState();
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.players[0].lastBet).toBe(50);
    expect(next.players[1].lastBet).toBe(100);
    expect(next.players[2].lastBet).toBe(200);
    expect(next.players[3].lastBet).toBe(0);
    expect(next.players[4].lastBet).toBe(0);
  });

  it('leaves shoeSize, cutCardIndex, and roundNumber unchanged', () => {
    const state: GameState = { ...makeSettledState(), shoeSize: 187, cutCardIndex: 50, roundNumber: 7 };
    const next = applyAction(state, { type: 'round:advance', seatId: state.players[0].id });
    expect(next.shoeSize).toBe(187);
    expect(next.cutCardIndex).toBe(50);
    expect(next.roundNumber).toBe(7);
  });

  it('throws INVALID_PHASE if not currently in settled', () => {
    const state: GameState = { ...createInitialState('ROOM1', 2, 0), phase: 'betting' };
    expect(() => applyAction(state, { type: 'round:advance', seatId: state.players[0].id })).toThrow('INVALID_PHASE');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd server && npx jest test/state-machine.spec.ts
```

Expected: all of the new tests FAIL. The `settle → lastBet` test fails because `settle` does not yet write `lastBet`. The `round:advance` tests fail because `applyAction` does not handle `round:advance` and the `PlayerSeat` literal in `makeSettledState` is missing required fields per the type update from Task 1 (TypeScript compile error in the test file is also a failure).

- [ ] **Step 3: Commit (failing test)**

```bash
git add server/test/state-machine.spec.ts
git commit -m "test(state-machine): cover round:advance and settle lastBet (red)"
```

---

## Task 3: Implement `applyAdvance` in the state machine and update `settle` to populate `lastBet`

**Files:**
- Modify: `server/src/game/state-machine.ts` (add `round:advance` to `Action`; add `applyAdvance`; update `settle`; update `createInitialState`)

- [ ] **Step 1: Update the `Action` union**

In `server/src/game/state-machine.ts` (around line 7-14), add `{ type: 'round:advance'; seatId: string }` to the `Action` union. The full type becomes:

```ts
export type Action =
  | { type: 'bet:place'; seatId: string; amount: number }
  | { type: 'hand:hit'; seatId: string; handIndex: number }
  | { type: 'hand:stand'; seatId: string; handIndex: number }
  | { type: 'hand:double'; seatId: string; handIndex: number }
  | { type: 'hand:split'; seatId: string; handIndex: number }
  | { type: 'round:ready'; seatId: string }
  | { type: 'round:start'; seatId: string }
  | { type: 'round:advance'; seatId: string };
```

- [ ] **Step 2: Add the `round:advance` case in the `applyAction` switch**

In the `applyAction` switch (around line 53-63), add a new case before the closing brace:

```ts
export function applyAction(state: GameState, action: Action, draw?: () => Card): GameState {
  switch (action.type) {
    case 'bet:place': return applyBet(state, action);
    case 'hand:hit': return applyHit(state, action, drawCardOrThrow(draw));
    case 'hand:stand': return applyStand(state, action, draw);
    case 'hand:double': return applyDouble(state, action, drawCardOrThrow(draw));
    case 'hand:split': return applySplit(state, action, drawCardOrThrow(draw));
    case 'round:ready': return applyReady(state, action);
    case 'round:start': return applyStartRound(state, drawCardOrThrow(draw));
    case 'round:advance': return applyAdvance(state, action);
  }
}
```

- [ ] **Step 3: Add the `applyAdvance` function**

After the existing `applyReady` function (around line 154), add:

```ts
function applyAdvance(state: GameState, _a: { seatId: string }): GameState {
  if (state.phase !== 'settled') throw new GameError('INVALID_PHASE');
  const emptyHand: Hand = { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false };
  const players = state.players.map((p) => {
    if (p.status === 'empty') return p;
    if (p.status === 'sitting_out') return p;
    if (p.bankroll === 0) return { ...p, hands: [emptyHand], status: 'sitting_out' as const };
    return { ...p, hands: [emptyHand], status: 'betting' as const };
  });
  return {
    ...state,
    phase: 'betting',
    activeSeat: null,
    lastResult: null,
    dealer: { ...emptyHand },
    players,
  };
}
```

- [ ] **Step 4: Update `settle` to populate `lastBet`**

In the existing `settle` function (around line 216-233), modify the players map to set `lastBet` from the hand bet. Replace the body with:

```ts
function settle(state: GameState): GameState {
  const payouts: RoundResult['payouts'] = [];
  const players = state.players.map((p) => {
    if (p.status === 'empty' || p.status === 'sitting_out') return p;
    // Record lastBet for each hand before reducing (split hands share the bet).
    const lastBet = p.hands.reduce((max, h) => Math.max(max, h.bet), 0);
    const totalDelta = p.hands.reduce((sum, hand) => {
      const result = computePayout({ playerCards: hand.cards, dealerCards: state.dealer.cards, bet: hand.bet });
      payouts.push({ seatId: p.id, delta: result.delta, reason: result.reason });
      return sum + result.delta;
    }, 0);
    return { ...p, bankroll: p.bankroll + totalDelta, lastBet, status: 'stood' as const };
  });
  return {
    ...state,
    phase: 'settled',
    players,
    lastResult: { payouts },
  };
}
```

- [ ] **Step 5: Update `createInitialState` to seed `lastBet: 0`**

In `createInitialState` (around line 16-36), add `lastBet: 0` to each seat:

```ts
export function createInitialState(roomId: string, seatCount: number, _roundNumber = 0): GameState {
  const seats: PlayerSeat[] = Array.from({ length: seatCount }, (_, i) => ({
    id: `seat-${i}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    bankroll: Config.STARTING_BANKROLL,
    hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
    status: 'empty' as const,
    connectedAt: Date.now(),
    lastBet: 0,
  }));
  return {
    roomId,
    phase: 'lobby',
    shoeSize: 0,
    cutCardIndex: 0,
    players: seats,
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null,
    roundNumber: 0,
    lastResult: null,
  };
}
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run:
```bash
cd server && npx jest test/state-machine.spec.ts
```

Expected: ALL tests in this file PASS (the 9 new `round:advance` tests + the new `settle` lastBet test, plus all the existing tests).

If any test fails, fix the implementation (not the test) and re-run.

- [ ] **Step 7: Typecheck the server**

Run:
```bash
cd server && npx tsc --noEmit
```

Expected: PASS. If it fails on the test file's `makeSettledState` (`as GameState` cast should silence the literal issue, but if a new test in Task 2 still complains, fix the test).

- [ ] **Step 8: Run the full server test suite**

Run:
```bash
cd server && npx jest
```

Expected: ALL tests PASS (existing 47 + new tests = ~58). The existing `round:ready` and `settle` tests should still pass — `settle` still produces a `settled` phase with valid payouts; the only change is the extra `lastBet` field on each seat.

- [ ] **Step 9: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(state-machine): implement round:advance and populate lastBet on settle"
```

---

## Task 4: Add server integration tests for `round:advance` (red)

**Files:**
- Modify: `server/test/gateway.integration.spec.ts` (extend the existing 2-player test to a second round; add `NOT_HOST` test; add `INVALID_PHASE` test)

- [ ] **Step 1: Extend the existing 2-player test to a second round**

In `server/test/gateway.integration.spec.ts`, find the test block titled `walks two clients through create → join → bet → deal → stand → stand → settle`. After the existing assertion `expect(settled.lastResult!.payouts.length).toBeGreaterThan(0);` and BEFORE the `host.disconnect();` / `guest.disconnect();` lines, insert:

```ts
    // Host advances to the next hand.
    const betting2Promise = listen<GameState>(host, 'game:state', (s) => s.phase === 'betting' && s.lastResult === null);
    host.emit('round:advance');
    const betting2 = await betting2Promise;
    expect(betting2.phase).toBe('betting');
    expect(betting2.lastResult).toBeNull();
    expect(betting2.dealer.cards).toEqual([]);
    // Each player's hand should be reset; lastBet should be preserved from the previous round.
    for (const p of betting2.players) {
      if (p.status === 'empty') continue;
      expect(p.hands.length).toBe(1);
      expect(p.hands[0].cards).toEqual([]);
      expect(p.hands[0].bet).toBe(0);
      expect(p.lastBet).toBe(50); // both players bet 50 in round 1
    }
```

- [ ] **Step 2: Add a `NOT_HOST` integration test**

Append a new `it` block inside the existing `describe('gateway integration: 2-player full round', ...)`:

```ts
  it('rejects round:advance from a non-host with NOT_HOST', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true });
    const guest = io(url, { transports: ['websocket'], forceNew: true });
    await Promise.all([
      new Promise<void>((r) => host.on('connect', () => r())),
      new Promise<void>((r) => guest.on('connect', () => r())),
    ]);

    const lobbyPromise = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    await lobbyPromise;

    const guestLobbyPromise = listen<LobbyState>(guest, 'lobby:state');
    await new Promise<void>((resolve) => {
      guest.emit('room:join', { roomId: (await lobbyPromise).roomId, name: 'Bob' }, () => resolve());
    });
    await guestLobbyPromise;
    void (await lobbyPromise); // suppress unused warning if linter complains

    // Guest (non-host) emits round:advance → expect NOT_HOST error.
    const errPromise = listen<{ code: string }>(guest, 'error');
    guest.emit('round:advance');
    const err = await errPromise;
    expect(err.code).toBe('NOT_HOST');

    host.disconnect();
    guest.disconnect();
  }, 10_000);
```

> Note: The double `await lobbyPromise` is awkward because the value was already consumed in the host path. To keep the test simple and correct, replace the body above with this cleaner version that captures the roomId up front:

Replace the body of the test you just added with this version (the cleaner one):

```ts
  it('rejects round:advance from a non-host with NOT_HOST', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true });
    const guest = io(url, { transports: ['websocket'], forceNew: true });
    await Promise.all([
      new Promise<void>((r) => host.on('connect', () => r())),
      new Promise<void>((r) => guest.on('connect', () => r())),
    ]);

    const lobbyPromise = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    const lobby = await lobbyPromise;
    const roomId = lobby.roomId;

    await new Promise<void>((resolve) => {
      guest.emit('room:join', { roomId, name: 'Bob' }, () => resolve());
    });

    // Guest (non-host) emits round:advance → expect NOT_HOST error.
    const errPromise = listen<{ code: string }>(guest, 'error');
    guest.emit('round:advance');
    const err = await errPromise;
    expect(err.code).toBe('NOT_HOST');

    host.disconnect();
    guest.disconnect();
  }, 10_000);
```

- [ ] **Step 3: Add an `INVALID_PHASE` integration test**

Append another `it` block to the same describe:

```ts
  it('rejects round:advance from the host while not in settled phase', async () => {
    const host = io(url, { transports: ['websocket'], forceNew: true });
    await new Promise<void>((r) => host.on('connect', () => r()));

    const lobbyPromise = listen<LobbyState>(host, 'lobby:state');
    await new Promise<void>((resolve) => {
      host.emit('room:create', { name: 'Alice' }, () => resolve());
    });
    await lobbyPromise;

    // Host is in lobby phase (not settled). Emit round:advance → expect INVALID_PHASE.
    const errPromise = listen<{ code: string }>(host, 'error');
    host.emit('round:advance');
    const err = await errPromise;
    expect(err.code).toBe('INVALID_PHASE');

    host.disconnect();
  }, 10_000);
```

- [ ] **Step 4: Run the integration tests to verify they fail**

Run:
```bash
cd server && npx jest test/gateway.integration.spec.ts
```

Expected: the new tests FAIL because the gateway has no `round:advance` handler. The existing 2-round test (Step 1) also fails because the `round:advance` emit is unhandled.

The 10s/15s timeouts should not fire (the test will throw a different error first, e.g., "no game:state received matching predicate").

- [ ] **Step 5: Commit (failing test)**

```bash
git add server/test/gateway.integration.spec.ts
git commit -m "test(gateway): cover round:advance 2-round flow, NOT_HOST, INVALID_PHASE (red)"
```

---

## Task 5: Implement the `round:advance` gateway handler

**Files:**
- Modify: `server/src/gateway/game.gateway.ts` (add `onAdvance` handler)

- [ ] **Step 1: Add the handler**

In `server/src/gateway/game.gateway.ts`, after the existing `onReady` handler (around line 82, before `onStart`), add:

```ts
  @SubscribeMessage('round:advance')
  onAdvance(@ConnectedSocket() client: Socket) {
    const ctx = this.rooms.roomForSocket(client.id);
    if (!ctx) return this.sendError(client, 'NOT_YOUR_TURN');
    const lobby = this.rooms.getLobbyState(ctx.roomId);
    if (!lobby || lobby.hostId !== ctx.seatId) return this.sendError(client, 'NOT_HOST');
    try {
      const state = this.rooms.apply(ctx.roomId, { type: 'round:advance', seatId: ctx.seatId });
      this.broadcastAll(ctx.roomId, state);
    } catch (e) {
      if (e instanceof GameError) return this.sendError(client, e.code as any);
      throw e;
    }
  }
```

The host check is performed before the state machine call: if the sender is not the host, we return `NOT_HOST` without calling `apply`. The state machine's `INVALID_PHASE` catch handles the case where the phase is wrong (e.g., the host double-clicks and the second emit races).

- [ ] **Step 2: Run the integration tests to verify they pass**

Run:
```bash
cd server && npx jest test/gateway.integration.spec.ts
```

Expected: ALL gateway integration tests PASS (the original two plus the three new ones from Task 4).

- [ ] **Step 3: Run the full server test suite**

Run:
```bash
cd server && npx jest
```

Expected: ALL tests PASS.

- [ ] **Step 4: Typecheck**

Run:
```bash
cd server && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/gateway/game.gateway.ts
git commit -m "feat(gateway): handle round:advance with host check"
```

---

## Task 6: Add client selectors and their unit tests

**Files:**
- Modify: `client/src/selectors/self.ts` (add `selectMyLastBet`, `selectCanRebet`)
- Create: `client/test/selectors/self.spec.ts` (new spec)

- [ ] **Step 1: Add the two selectors**

In `client/src/selectors/self.ts`, after the existing `selectMySeat` definition, add:

```ts
export const selectMyLastBet = createSelector(
  [selectMySeat],
  (me) => me?.lastBet ?? 0,
);

export const selectCanRebet = createSelector(
  [selectMySeat],
  (me) => !!me && me.lastBet > 0 && me.lastBet <= me.bankroll && me.status === 'betting',
);
```

- [ ] **Step 2: Create the selector test file**

Create `client/test/selectors/self.spec.ts`:

```ts
import { selectMySeat, selectMyLastBet, selectCanRebet } from '../../src/selectors/self';
import type { RootState } from '../../src/store';
import type { GameState, PlayerSeat } from '../../src/shared/types';

function seat(overrides: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id: 's0',
    name: 'Alice',
    bankroll: 1000,
    hands: [],
    status: 'betting',
    connectedAt: 0,
    lastBet: 0,
    ...overrides,
  };
}

function stateWith(seatOrNull: PlayerSeat | null): RootState {
  const game: GameState | null = seatOrNull === null ? null : {
    roomId: 'R', phase: 'betting', shoeSize: 200, cutCardIndex: 50,
    players: [seatOrNull], dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 1, lastResult: null,
  };
  return {
    game: { state: game, lastResult: null },
    connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
    lobby: { roomId: 'R', hostId: 's0', players: [] },
    ui: { betInputValue: 50, toasts: [] },
  } as unknown as RootState;
}

describe('selectMySeat', () => {
  it('returns the seat whose id matches selfSeatId', () => {
    const me = seat({ name: 'Alice' });
    const root = stateWith(me);
    expect(selectMySeat(root)?.name).toBe('Alice');
  });

  it('returns null when no game state', () => {
    const root = stateWith(null);
    expect(selectMySeat(root)).toBeNull();
  });
});

describe('selectMyLastBet', () => {
  it('returns the seat lastBet', () => {
    const root = stateWith(seat({ lastBet: 75 }));
    expect(selectMyLastBet(root)).toBe(75);
  });

  it('returns 0 when no seat', () => {
    expect(selectMyLastBet(stateWith(null))).toBe(0);
  });
});

describe('selectCanRebet', () => {
  it('is true when lastBet > 0, affordable, and status is betting', () => {
    const root = stateWith(seat({ lastBet: 50, bankroll: 1000, status: 'betting' }));
    expect(selectCanRebet(root)).toBe(true);
  });

  it('is false when lastBet is 0', () => {
    const root = stateWith(seat({ lastBet: 0, status: 'betting' }));
    expect(selectCanRebet(root)).toBe(false);
  });

  it('is false when lastBet exceeds bankroll', () => {
    const root = stateWith(seat({ lastBet: 500, bankroll: 100, status: 'betting' }));
    expect(selectCanRebet(root)).toBe(false);
  });

  it('is false when status is not betting', () => {
    const root = stateWith(seat({ lastBet: 50, status: 'sitting_out' }));
    expect(selectCanRebet(root)).toBe(false);
  });

  it('is false when no seat', () => {
    expect(selectCanRebet(stateWith(null))).toBe(false);
  });
});
```

- [ ] **Step 3: Run the selector tests**

Run:
```bash
cd client && npx vitest run test/selectors/self.spec.ts
```

Expected: ALL 8 tests PASS.

- [ ] **Step 4: Run the full client test suite**

Run:
```bash
cd client && npx vitest run
```

Expected: ALL tests PASS (existing 3 + 8 new = 11).

- [ ] **Step 5: Typecheck the client**

Run:
```bash
cd client && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/selectors/self.ts client/test/selectors/self.spec.ts
git commit -m "feat(client): add selectMyLastBet and selectCanRebet selectors with tests"
```

---

## Task 7: Add `ResultOverlay` Next Hand button (test + impl)

**Files:**
- Create: `client/test/components/result-overlay.spec.tsx` (new spec)
- Modify: `client/src/components/ResultOverlay.tsx` (add the button)

- [ ] **Step 1: Write the failing test**

Create `client/test/components/result-overlay.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ResultOverlay } from '../../src/components/ResultOverlay';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import type { GameState, RoundResult } from '../../src/shared/types';

function makeStore(opts: { phase: GameState['phase']; amIHost: boolean; lastResult: RoundResult | null }) {
  const state: GameState = {
    roomId: 'R', phase: opts.phase, shoeSize: 200, cutCardIndex: 50,
    players: [{ id: 's0', name: 'Alice', bankroll: 1000, hands: [], status: 'stood', connectedAt: 0, lastBet: 50 }],
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 1, lastResult: opts.lastResult,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: opts.lastResult },
      connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: opts.amIHost ? 's0' : 's1', players: [] },
      ui: { betInputValue: 50, toasts: [] },
    } as any,
  });
}

function renderWith(ui: React.ReactNode, store: ReturnType<typeof makeStore>) {
  return render(<Provider store={store}>{ui}</Provider>);
}

describe('<ResultOverlay />', () => {
  it('renders nothing when phase is not settled', () => {
    const store = makeStore({ phase: 'betting', amIHost: true, lastResult: null });
    const { container } = renderWith(<ResultOverlay />, store);
    expect(container.firstChild).toBeNull();
  });

  it('renders the payout list during settled', () => {
    const result: RoundResult = { payouts: [{ seatId: 's0', delta: 50, reason: 'win' }] };
    const store = makeStore({ phase: 'settled', amIHost: false, lastResult: result });
    renderWith(<ResultOverlay />, store);
    expect(screen.getByText(/Round Over/i)).toBeInTheDocument();
    expect(screen.getByText(/win/i)).toBeInTheDocument();
  });

  it('shows Next Hand button to the host during settled', () => {
    const result: RoundResult = { payouts: [{ seatId: 's0', delta: 50, reason: 'win' }] };
    const store = makeStore({ phase: 'settled', amIHost: true, lastResult: result });
    renderWith(<ResultOverlay />, store);
    expect(screen.getByRole('button', { name: /next hand/i })).toBeInTheDocument();
  });

  it('hides Next Hand button from non-hosts', () => {
    const result: RoundResult = { payouts: [{ seatId: 's0', delta: 50, reason: 'win' }] };
    const store = makeStore({ phase: 'settled', amIHost: false, lastResult: result });
    renderWith(<ResultOverlay />, store);
    expect(screen.queryByRole('button', { name: /next hand/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd client && npx vitest run test/components/result-overlay.spec.tsx
```

Expected: the test about "Next Hand button" FAILS (the button doesn't exist yet). The other tests pass.

- [ ] **Step 3: Update `ResultOverlay` to include the Next Hand button**

Replace the contents of `client/src/components/ResultOverlay.tsx` with:

```tsx
import { useSelector } from 'react-redux';
import { getSocket } from '../socket/client';
import { selectAmIHost } from '../selectors/self';
import type { RootState } from '../store';

export function ResultOverlay() {
  const state = useSelector((s: RootState) => s.game.state);
  const amHost = useSelector(selectAmIHost);
  if (!state || state.phase !== 'settled' || !state.lastResult) return null;
  return (
    <div className="result-overlay">
      <h2>Round Over</h2>
      <ul>
        {state.lastResult.payouts.map((p) => {
          const seat = state.players.find((s) => s.id === p.seatId);
          return (
            <li key={p.seatId}>
              {seat?.name ?? p.seatId}: {p.reason} {p.delta > 0 ? `+$${p.delta}` : p.delta < 0 ? `-$${Math.abs(p.delta)}` : '$0'}
            </li>
          );
        })}
      </ul>
      {amHost && (
        <button onClick={() => getSocket().emit('round:advance')}>Next Hand</button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd client && npx vitest run test/components/result-overlay.spec.tsx
```

Expected: ALL 4 tests PASS.

- [ ] **Step 5: Typecheck**

Run:
```bash
cd client && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/test/components/result-overlay.spec.tsx client/src/components/ResultOverlay.tsx
git commit -m "feat(client): host-gated Next Hand button in ResultOverlay"
```

---

## Task 8: Add `BetPanel` Rebet button (test + impl)

**Files:**
- Create: `client/test/components/bet-panel.spec.tsx` (new spec)
- Modify: `client/src/components/BetPanel.tsx` (add the button)

- [ ] **Step 1: Write the failing test**

Create `client/test/components/bet-panel.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { BetPanel } from '../../src/components/BetPanel';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import * as socketClient from '../../src/socket/client';
import type { GameState } from '../../src/shared/types';

function makeStore(opts: { phase: GameState['phase']; lastBet: number; bankroll: number; status: GameState['players'][number]['status'] }) {
  const state: GameState = {
    roomId: 'R', phase: opts.phase, shoeSize: 200, cutCardIndex: 50,
    players: [{ id: 's0', name: 'Alice', bankroll: opts.bankroll, hands: [], status: opts.status, connectedAt: 0, lastBet: opts.lastBet }],
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 1, lastResult: null,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: 's0', players: [] },
      ui: { betInputValue: 50, toasts: [] },
    } as any,
  });
}

function renderWith(ui: React.ReactNode, store: ReturnType<typeof makeStore>) {
  return render(<Provider store={store}>{ui}</Provider>);
}

describe('<BetPanel />', () => {
  it('renders nothing outside the betting phase', () => {
    const store = makeStore({ phase: 'player_turn', lastBet: 50, bankroll: 1000, status: 'betting' });
    const { container } = renderWith(<BetPanel />, store);
    expect(container.firstChild).toBeNull();
  });

  it('shows the Place Bet input and button during betting', () => {
    const store = makeStore({ phase: 'betting', lastBet: 0, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.getByRole('button', { name: /place bet/i })).toBeInTheDocument();
  });

  it('hides the Rebet button when lastBet is 0', () => {
    const store = makeStore({ phase: 'betting', lastBet: 0, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.queryByRole('button', { name: /rebet/i })).toBeNull();
  });

  it('hides the Rebet button when lastBet exceeds bankroll', () => {
    const store = makeStore({ phase: 'betting', lastBet: 500, bankroll: 100, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.queryByRole('button', { name: /rebet/i })).toBeNull();
  });

  it('shows the Rebet button when lastBet > 0 and lastBet <= bankroll', () => {
    const store = makeStore({ phase: 'betting', lastBet: 50, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.getByRole('button', { name: /rebet \$50/i })).toBeInTheDocument();
  });

  it('emits bet:place with the last bet amount when Rebet is clicked', () => {
    const emit = vi.fn();
    vi.spyOn(socketClient, 'getSocket').mockReturnValue({ emit } as any);
    const store = makeStore({ phase: 'betting', lastBet: 75, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    fireEvent.click(screen.getByRole('button', { name: /rebet \$75/i }));
    expect(emit).toHaveBeenCalledWith('bet:place', { amount: 75 });
  });
});
```

> Note: this test file uses Vitest's `vi.fn()` and `vi.spyOn`. They are globals (Vitest is configured with `globals: true` in `vite.config.ts`), so the imports are implicit. If the test file complains about `vi` not being defined, add `import { vi } from 'vitest';` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd client && npx vitest run test/components/bet-panel.spec.tsx
```

Expected: tests about the Rebet button FAIL. The other tests pass.

- [ ] **Step 3: Update `BetPanel` to include the Rebet button**

Replace the contents of `client/src/components/BetPanel.tsx` with:

```tsx
import { useSelector, useDispatch } from 'react-redux';
import { getSocket } from '../socket/client';
import { betInputChanged } from '../store/ui.slice';
import { selectCanRebet, selectMyLastBet } from '../selectors/self';
import type { RootState } from '../store';

export function BetPanel() {
  const phase = useSelector((s: RootState) => s.game.state?.phase);
  const bet = useSelector((s: RootState) => s.ui.betInputValue);
  const canRebet = useSelector(selectCanRebet);
  const lastBet = useSelector(selectMyLastBet);
  const dispatch = useDispatch();

  if (phase !== 'betting') return null;

  return (
    <div className="bet-panel">
      <input
        type="number"
        min={10}
        max={500}
        value={bet}
        onChange={(e) => dispatch(betInputChanged(Number(e.target.value)))}
      />
      <button onClick={() => getSocket().emit('bet:place', { amount: bet })}>Place Bet</button>
      {canRebet && (
        <button onClick={() => getSocket().emit('bet:place', { amount: lastBet })}>
          Rebet ${lastBet}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd client && npx vitest run test/components/bet-panel.spec.tsx
```

Expected: ALL 6 tests PASS.

- [ ] **Step 5: Run the full client test suite**

Run:
```bash
cd client && npx vitest run
```

Expected: ALL tests PASS.

- [ ] **Step 6: Typecheck**

Run:
```bash
cd client && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/test/components/bet-panel.spec.tsx client/src/components/BetPanel.tsx
git commit -m "feat(client): Rebet button in BetPanel gated on selectCanRebet"
```

---

## Task 9: Extend the E2E happy-path test to play two rounds

**Files:**
- Modify: `client/e2e/happy-path.spec.ts` (extend the existing test to play a second round)

- [ ] **Step 1: Extend the test to walk through two rounds**

Replace the contents of `client/e2e/happy-path.spec.ts` with:

```ts
import { test, expect, chromium } from '@playwright/test';

test('two players can play two full rounds with rebet', async () => {
  const browser = await chromium.launch();
  const host = await browser.newContext();
  const guest = await browser.newContext();

  const hostPage = await host.newPage();
  await hostPage.goto('/');
  await hostPage.fill('input[placeholder="Your name"]', 'Alice');
  await hostPage.click('button:has-text("Create Room")');
  await hostPage.waitForURL(/\/room\//);
  const roomUrl = hostPage.url();
  const code = roomUrl.split('/room/')[1];

  const guestPage = await guest.newPage();
  await guestPage.goto('/');
  await guestPage.fill('input[placeholder="Your name"]', 'Bob');
  await guestPage.fill('input[placeholder="Room code"]', code);
  await guestPage.click('button:has-text("Join")');
  await guestPage.waitForURL(/\/room\//);

  // ───── ROUND 1 ─────
  await hostPage.click('button:has-text("Begin Betting")');
  await hostPage.waitForSelector('.bet-panel');

  await hostPage.fill('.bet-panel input', '50');
  await hostPage.click('button:has-text("Place Bet")');
  await guestPage.fill('.bet-panel input', '50');
  await guestPage.click('button:has-text("Place Bet")');

  await hostPage.click('button:has-text("Deal")');
  await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });

  // Both stand until settled. Use a polling loop; one of the two attempts per round
  // is the active seat.
  for (let i = 0; i < 4; i++) {
    await hostPage.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if ((b.textContent ?? '').trim() === 'Stand' && !(b as HTMLButtonElement).disabled) b.click(); }); });
    await guestPage.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if ((b.textContent ?? '').trim() === 'Stand' && !(b as HTMLButtonElement).disabled) b.click(); }); });
    await hostPage.waitForTimeout(50);
  }

  // Wait for the result overlay on the host.
  await hostPage.waitForSelector('.result-overlay', { timeout: 10_000 });

  // ───── ADVANCE TO NEXT HAND ─────
  // Host sees the Next Hand button; guest does not.
  await expect(hostPage.locator('button:has-text("Next Hand")')).toBeVisible();
  await expect(guestPage.locator('button:has-text("Next Hand")')).toHaveCount(0);

  await hostPage.click('button:has-text("Next Hand")');
  await hostPage.waitForSelector('.bet-panel', { timeout: 5_000 });

  // ───── ROUND 2: rebet ─────
  // Both players should see the Rebet button since lastBet=50 and bankroll is positive.
  await expect(hostPage.locator('button:has-text("Rebet $50")')).toBeVisible();
  await expect(guestPage.locator('button:has-text("Rebet $50")')).toBeVisible();

  await hostPage.click('button:has-text("Rebet $50")');
  await guestPage.click('button:has-text("Rebet $50")');

  await hostPage.click('button:has-text("Deal")');
  await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });

  await browser.close();
});

test.skip('drop-and-reconnect: server auto-stands a missing player', async () => {
  // Filled in once the basic happy path is green; left as a placeholder.
});
```

- [ ] **Step 2: Typecheck the E2E file**

Run:
```bash
cd client && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS (the E2E files are excluded from the client build's main typecheck by default; if tsc complains about `@playwright/test`, verify `tsconfig.json` excludes `e2e/**`. If it doesn't, that's a pre-existing condition and not something this task should fix).

If tsc does complain about the E2E file specifically, that means the previous E2E file was already failing the typecheck — note it in the commit message but don't fix it as part of this task.

- [ ] **Step 3: (Optional) Run the E2E test**

> **Note:** Playwright browsers are not installed in this environment (per project MEMORY.md). Running this command will fail with "Executable doesn't exist" unless the user installs browsers first. To install:
> ```bash
> cd client && npx playwright install --with-deps chromium
> ```
> Then:
> ```bash
> cd client && npx playwright test
> ```
> The user should run this locally to verify the two-round flow end-to-end. Do not include a "run E2E" step in this task — typecheck is the only verifiable gate here.

- [ ] **Step 4: Commit**

```bash
git add client/e2e/happy-path.spec.ts
git commit -m "test(e2e): extend happy path to play two rounds with rebet"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| `lastBet: number` on `PlayerSeat` (server + client mirror) | Task 1 |
| `round:advance` added to `ClientCommand` | Task 1 |
| `NOT_HOST` added to `ErrorCode` and `ErrorMessages` | Task 1 |
| `applyAdvance` implementation | Task 3 |
| `settle` populates `lastBet` | Task 3 |
| `createInitialState` seeds `lastBet: 0` | Task 3 |
| Broke players (bankroll === 0) → `sitting_out` in `applyAdvance` | Task 2 (test) + Task 3 (impl) |
| `sitting_out` and `empty` preserved across advance | Task 2 (test) + Task 3 (impl) |
| `shoeSize`/`cutCardIndex`/`roundNumber` unchanged across advance | Task 2 (test) + Task 3 (impl) |
| `INVALID_PHASE` thrown if not in `settled` | Task 2 (test) + Task 3 (impl) + Task 4 (gateway test) |
| Gateway `onAdvance` handler with host check | Task 5 |
| Two-round gateway integration test | Task 4 |
| `NOT_HOST` gateway test | Task 4 |
| `INVALID_PHASE` gateway test | Task 4 |
| `selectMyLastBet` and `selectCanRebet` selectors | Task 6 |
| ResultOverlay "Next Hand" button (host-gated) | Task 7 |
| BetPanel "Rebet $X" button (gated on `selectCanRebet`) | Task 8 |
| Rebet emits `bet:place` (no new wire event) | Task 8 |
| E2E two-round flow with rebet | Task 9 |
| Reshuffle logic stays in `round:start` (no change) | (out of scope; existing code untouched) |
| Auto-sit-out for bankroll=0 (the user-approved extension) | Task 2 (test) + Task 3 (impl) |

No gaps.

**Placeholder scan:**
- No "TBD", "TODO", "implement later" in the plan body.
- No "similar to Task N" — every code block is shown in full.
- No vague "add error handling" steps — error codes are explicit (`NOT_HOST`, `INVALID_PHASE`).
- No "fill in details" — the `INVALID_PHASE` integration test's setup is concrete.

**Type consistency:**
- `applyAdvance` is named identically in Task 2, Task 3, Task 5. ✓
- `lastBet` field is named identically across types, state machine, selectors, components. ✓
- `selectCanRebet` and `selectMyLastBet` are named identically in Task 6, Task 7 (no reference), Task 8. ✓
- `getSocket().emit('round:advance')` is consistent in Task 7 and Task 9. ✓
- `selectAmIHost` is the existing selector used in Task 7 (already exists in `self.ts`). ✓
- The `makeSettledState` test helper in Task 2 uses `as GameState` to silence the literal-type complaint; Task 3's implementation matches the tested shape.

No inconsistencies found.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-14-next-hand-advance.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

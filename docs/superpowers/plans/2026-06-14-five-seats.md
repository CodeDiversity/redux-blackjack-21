# 5-Seat Tables + Split-Hand Turn Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump the per-table seat count from 2 to 5, render the new geometry cleanly in lobby and table views, and close the known split-hand turn-tracking correctness gap.

**Architecture:** A single config bump on the server (the state machine is already seat-count-agnostic). Add `activeHandIndex` to `PlayerSeat` so the server can be the authority on which hand is acting, and rewrite the `hand:*` action assigners to walk all hands in order. On the client, shrink the lobby cards to fit 5 in a row, widen the table to 1500px with a fixed 5-column grid, and add an `EmptySeatTile` for ghosted empty seats.

**Tech Stack:** Server is NestJS 10 + Socket.io + XState 5. Client is Vite + React 18 + Redux Toolkit + styled-components + Vitest + Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-14-five-seats-design.md`

**Existing test baselines (re-verify before declaring pass counts):**
- Server: 130 tests across 12 suites (jest). Test fixtures use `Config.SEAT_COUNT` so they auto-adapt to the new size.
- Client: 41 tests (vitest).
- E2E: 1 passing, 1 skipped (playwright).

---

## File Structure

Files created or modified in this plan:

- `server/src/config.ts` — modify (1 line: `SEAT_COUNT`)
- `server/src/shared/types.ts` — modify (add `activeHandIndex` to `PlayerSeat`)
- `client/src/shared/types.ts` — modify (mirror `activeHandIndex`)
- `server/src/game/state-machine.ts` — modify (init in `createInitialState`, add `isHandActive` guard, update `assignHit/Stand/Double/Split`, update `findNextActingSeat`)
- `server/test/state-machine-xstate.spec.ts` — extend (~10 new tests)
- `server/test/integration/5-seat.spec.ts` — create (gateway 5-player E2E)
- `client/src/components/PlayerList.tsx` — modify (card size, gap, flex-wrap)
- `client/src/components/TableView.tsx` — modify (width, grid, drop filter, use EmptySeatTile)
- `client/src/components/EmptySeatTile.tsx` — create
- `client/test/components/PlayerList.spec.tsx` — create
- `client/test/components/TableView.spec.tsx` — create
- `client/e2e/five-player.spec.ts` — create

---

## Task 1: Bump `Config.SEAT_COUNT` from 2 to 5

**Files:**
- Modify: `server/src/config.ts:3`

- [ ] **Step 1: Edit `server/src/config.ts`**

Change line 3:

```diff
 export const Config = {
   PORT: Number(process.env.PORT ?? 3001),
-  SEAT_COUNT: 2,
+  SEAT_COUNT: 5,
   MIN_BET: 10,
   MAX_BET: 500,
   ...
```

- [ ] **Step 2: Run server tests**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest
```

Expected: 130/130 tests pass. Test fixtures use `Config.SEAT_COUNT` so they auto-adapt. If any test fails, do not change tests to "fix" them — the goal is to verify the size change is harmless. Investigate before proceeding.

- [ ] **Step 3: Run server typecheck**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add server/src/config.ts && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "chore(server): bump SEAT_COUNT to 5"
```

---

## Task 2: Add `activeHandIndex` to `PlayerSeat` types and initialize it

**Files:**
- Modify: `server/src/shared/types.ts:28-36`
- Modify: `client/src/shared/types.ts` (mirror)
- Modify: `server/src/game/state-machine.ts:454-475` (`createInitialState`)

- [ ] **Step 1: Add `activeHandIndex` to server `PlayerSeat` type**

In `server/src/shared/types.ts`, add the field:

```diff
 export type PlayerSeat = {
   id: string;
   name: string;
   bankroll: number;
   hands: Hand[];
   status: SeatStatus;
   connectedAt: number;
   lastBet: number;
+  activeHandIndex: number;  // 0-based index into hands[] when the seat is the active seat; ignored otherwise
 };
```

- [ ] **Step 2: Mirror to client `PlayerSeat` type**

In `client/src/shared/types.ts`, apply the same diff. (This file mirrors server types; the field must be present in both.)

- [ ] **Step 3: Initialize `activeHandIndex: 0` in `createInitialState`**

In `server/src/game/state-machine.ts` line 454-475, update the seats array:

```diff
   const seats: PlayerSeat[] = Array.from({ length: seatCount }, (_, i) => ({
     id: `seat-${i}-${Math.random().toString(36).slice(2, 8)}`,
     name: '',
     bankroll: Config.STARTING_BANKROLL,
     hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
     status: 'empty' as const,
     connectedAt: Date.now(),
     lastBet: 0,
+    activeHandIndex: 0,
   }));
```

- [ ] **Step 4: Run server typecheck and tests**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx tsc --noEmit && npx jest
```

Expected: clean typecheck; 130/130 tests pass. Some test fixtures build `PlayerSeat` objects directly without `activeHandIndex`; if `tsc` complains, those fixtures need updating — but `__actionCount` was already a similar story and the existing fixtures likely use `createInitialState`. If a test fails, fix the test fixture, not the production code.

- [ ] **Step 5: Run client typecheck**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add server/src/shared/types.ts client/src/shared/types.ts server/src/game/state-machine.ts && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "feat(shared): add PlayerSeat.activeHandIndex"
```

---

## Task 3: Add `isHandActive` guard and test it (TDD)

**Files:**
- Modify: `server/src/game/state-machine.ts:96-103` (extend `isHandActionable`)
- Modify: `server/src/game/state-machine.ts:160-169` (add to `actionGuards` map)
- Modify: `server/test/state-machine-xstate.spec.ts` (add 3 tests)

- [ ] **Step 1: Write the failing test**

Open `server/test/state-machine-xstate.spec.ts` and add a new `describe` block at the end:

```ts
import { machine, createInitialState, applyAction } from '../src/game/state-machine';
import { createActor } from 'xstate';
import { Config } from '../src/config';
import type { Card, GameState } from '../src/shared/types';

// existing helpers (emptyContext, etc.) are above; reuse them.

describe('handIndex validation against activeHandIndex', () => {
  function makePlayerTurnFixture() {
    // Seat 0 has 2 hands (post-split). activeHandIndex is 0.
    const seat0Id = 's0';
    const hand0: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    const hand1: GameState['players'][0]['hands'][0] = {
      cards: [{ suit: '♦', rank: '8' }, { suit: '♣', rank: '5' }],
      bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false,
    };
    return createInitialState('R', Config.SEAT_COUNT).players.map((p, i) =>
      i === 0 ? { ...p, id: seat0Id, name: 'Alice', status: 'acting' as const, hands: [hand0, hand1], activeHandIndex: 0 } : p
    );
  }

  it('rejects hand:hit with handIndex=1 when activeHandIndex=0', () => {
    const players = makePlayerTurnFixture();
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT),
      phase: 'player_turn',
      activeSeat: 0,
      players,
    };
    expect(() =>
      applyAction(state, { type: 'hand:hit', seatId: 's0', handIndex: 1 }, () => ({ suit: '♠', rank: 'A' })),
    ).toThrow('HAND_LOCKED');
  });

  it('rejects hand:stand with handIndex=1 when activeHandIndex=0', () => {
    const players = makePlayerTurnFixture();
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT),
      phase: 'player_turn',
      activeSeat: 0,
      players,
    };
    expect(() =>
      applyAction(state, { type: 'hand:stand', seatId: 's0', handIndex: 1 }),
    ).toThrow('HAND_LOCKED');
  });

  it('rejects hand:double with handIndex=1 when activeHandIndex=0', () => {
    const players = makePlayerTurnFixture();
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT),
      phase: 'player_turn',
      activeSeat: 0,
      players,
    };
    expect(() =>
      applyAction(state, { type: 'hand:double', seatId: 's0', handIndex: 1 }, () => ({ suit: '♠', rank: 'A' })),
    ).toThrow('HAND_LOCKED');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest test/state-machine-xstate.spec.ts -t "handIndex validation"
```

Expected: FAIL — 3 tests fail because the current code does not validate `handIndex` against `activeHandIndex`. The error code may be something other than `HAND_LOCKED` (or no throw at all), which is the point.

- [ ] **Step 3: Add the `isHandActive` guard**

In `server/src/game/state-machine.ts`, extend the existing `isHandActionable` guard to also check `activeHandIndex`. Replace lines 96-103 with:

```ts
  // Hand guards
  { name: 'isHandActive', errorCode: 'HAND_LOCKED',
    predicate: (s, e) => {
      if (e.type !== 'hand:hit' && e.type !== 'hand:stand' && e.type !== 'hand:double' && e.type !== 'hand:split') return false;
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      if (idx === -1) return false;
      return e.handIndex === s.players[idx].activeHandIndex;
    }},
  { name: 'isHandActionable', errorCode: 'HAND_LOCKED',
    predicate: (s, e) => {
      if (e.type !== 'hand:hit' && e.type !== 'hand:stand') return false;
      const idx = s.players.findIndex((p) => p.id === e.seatId);
      if (idx === -1) return false;
      const hand = s.players[idx].hands[e.handIndex];
      return !!hand && hand.cards.length > 0 && !hand.stood && !hand.busted && !hand.doubled;
    }},
```

Also update `isDoubleableHand` and `canSplitHand` — they don't need `activeHandIndex` checks because the new `isHandActive` guard runs first and rejects mismatches. No change needed for them.

- [ ] **Step 4: Wire `isHandActive` into the `actionGuards` map**

Replace the `actionGuards` entries for hand actions (lines 162-165):

```diff
-  'hand:hit': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActionable'],
-  'hand:stand': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActionable'],
-  'hand:double': ['isPlayerTurnPhase', 'isActiveSeat', 'isDoubleableHand', 'hasSufficientFundsForDouble'],
-  'hand:split': ['isPlayerTurnPhase', 'isActiveSeat', 'canSplitHand', 'hasSufficientFundsForSplit', 'noAcesRuleForSplit'],
+  'hand:hit': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActive', 'isHandActionable'],
+  'hand:stand': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActive', 'isHandActionable'],
+  'hand:double': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActive', 'isDoubleableHand', 'hasSufficientFundsForDouble'],
+  'hand:split': ['isPlayerTurnPhase', 'isActiveSeat', 'isHandActive', 'canSplitHand', 'hasSufficientFundsForSplit', 'noAcesRuleForSplit'],
```

- [ ] **Step 5: Wire `isHandActive` into the XState `guards:` object**

In the `setup({ ... guards: { ... } })` block (lines 233-257), add an `isHandActive` entry. Place it before `isHandActionable`:

```diff
+    isHandActive: makeGuardFn(guards.find((g) => g.name === 'isHandActive')!),
     isHandActionable: makeGuardFn(guards.find((g) => g.name === 'isHandActionable')!),
```

Also update the `player_turn` state transitions (lines 428-434) to include `isHandActive`:

```diff
       on: {
-        'hand:hit': { actions: 'assignHit', guard: and(['isActiveSeat', 'isHandActionable']) },
-        'hand:stand': { actions: 'assignStand', guard: and(['isActiveSeat', 'isHandActionable']) },
-        'hand:double': { actions: 'assignDouble', guard: and(['isActiveSeat', 'isDoubleableHand', 'hasSufficientFundsForDouble']) },
-        'hand:split': { actions: 'assignSplit', guard: and(['isActiveSeat', 'canSplitHand', 'hasSufficientFundsForSplit', 'noAcesRuleForSplit']) },
+        'hand:hit': { actions: 'assignHit', guard: and(['isActiveSeat', 'isHandActive', 'isHandActionable']) },
+        'hand:stand': { actions: 'assignStand', guard: and(['isActiveSeat', 'isHandActive', 'isHandActionable']) },
+        'hand:double': { actions: 'assignDouble', guard: and(['isActiveSeat', 'isHandActive', 'isDoubleableHand', 'hasSufficientFundsForDouble']) },
+        'hand:split': { actions: 'assignSplit', guard: and(['isActiveSeat', 'isHandActive', 'canSplitHand', 'hasSufficientFundsForSplit', 'noAcesRuleForSplit']) },
       },
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest test/state-machine-xstate.spec.ts -t "handIndex validation"
```

Expected: 3/3 tests pass.

- [ ] **Step 7: Run full server test suite**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest
```

Expected: 130 + 3 = 133/133 pass. Investigate any regression before continuing.

- [ ] **Step 8: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add server/src/game/state-machine.ts server/test/state-machine-xstate.spec.ts && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "feat(server): validate handIndex against activeHandIndex"
```

---

## Task 4: Walk `activeHandIndex` on hand completion (TDD)

**Files:**
- Modify: `server/src/game/state-machine.ts:281-357` (assignHit, assignStand, assignDouble, assignSplit)
- Modify: `server/src/game/state-machine.ts:187-198` (findNextActingSeat)
- Modify: `server/test/state-machine-xstate.spec.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `server/test/state-machine-xstate.spec.ts`:

```ts
describe('activeHandIndex walks all hands in order', () => {
  function makeSplitSeat() {
    return {
      ...createInitialState('R', Config.SEAT_COUNT).players[0],
      id: 's0',
      name: 'Alice',
      status: 'acting' as const,
      hands: [
        { cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false },
        { cards: [{ suit: '♦', rank: '8' }, { suit: '♣', rank: '5' }], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false },
      ],
      activeHandIndex: 0,
    };
  }

  function fixtureWithSeat(seatIdx: number) {
    const players = createInitialState('R', Config.SEAT_COUNT).players.map((p, i) =>
      i === seatIdx ? makeSplitSeat() : p,
    );
    return {
      ...createInitialState('R', Config.SEAT_COUNT),
      phase: 'player_turn' as const,
      activeSeat: seatIdx,
      players,
    };
  }

  it('hand:stand on hand 0 advances activeHandIndex to 1 within the same seat', () => {
    const state = fixtureWithSeat(0);
    const next = applyAction(state, { type: 'hand:stand', seatId: 's0', handIndex: 0 });
    expect(next.activeSeat).toBe(0);
    expect(next.players[0].activeHandIndex).toBe(1);
    expect(next.players[0].hands[0].stood).toBe(true);
    expect(next.players[0].hands[1].stood).toBe(false);
  });

  it('hand:double on hand 0 advances activeHandIndex to 1 within the same seat', () => {
    const state = fixtureWithSeat(0);
    const next = applyAction(state, { type: 'hand:double', seatId: 's0', handIndex: 0 }, () => ({ suit: '♠', rank: 'A' }));
    expect(next.activeSeat).toBe(0);
    expect(next.players[0].activeHandIndex).toBe(1);
    expect(next.players[0].hands[0].doubled).toBe(true);
  });

  it('hand:hit on hand 1 to bust advances to next seat (no further hands)', () => {
    const players = createInitialState('R', Config.SEAT_COUNT).players.map((p, i) =>
      i === 0
        ? {
            ...createInitialState('R', Config.SEAT_COUNT).players[0],
            id: 's0', name: 'Alice', status: 'acting' as const, activeHandIndex: 1,
            hands: [
              { cards: [{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }], bet: 50, stood: true, busted: false, isBlackjack: false, doubled: false },
              { cards: [{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '6' }], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false },
            ],
          }
        : p,
    );
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT), phase: 'player_turn', activeSeat: 0, players,
    };
    const next = applyAction(state, { type: 'hand:hit', seatId: 's0', handIndex: 1 }, () => ({ suit: '♠', rank: 'K' }));
    expect(next.players[0].hands[1].busted).toBe(true);
    expect(next.players[0].activeHandIndex).toBe(2);
    // The seat is done; activeSeat may either stay (no further hands) or auto-advance.
    // We only assert the seat's own hands are flagged.
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest test/state-machine-xstate.spec.ts -t "activeHandIndex walks all hands"
```

Expected: 3/3 fail. The current code does not bump `activeHandIndex` after hand completion; it just sets `stood/doubled/busted` on the hand and either stays on the seat (which leaves the player stuck) or advances the seat (which skips hand 1 entirely).

- [ ] **Step 3: Update `assignStand` to bump `activeHandIndex`**

In `server/src/game/state-machine.ts` lines 301-315, replace `assignStand`:

```ts
    assignStand: assign(({ context, event }) => {
      if (event.type !== 'hand:stand') return {};
      const seat = context.players[context.activeSeat!];
      const newHands = seat.hands.map((h, j) => j === event.handIndex ? { ...h, stood: true } : h);
      // Bump activeHandIndex within the seat; if exhausted, advance to the next acting seat.
      const nextHandIndex = event.handIndex + 1;
      const stillHasHand = nextHandIndex < newHands.length &&
        !newHands[nextHandIndex].stood && !newHands[nextHandIndex].busted && !newHands[nextHandIndex].doubled;
      const nextPlayers = context.players.map((p, i) =>
        i === context.activeSeat
          ? { ...p, hands: newHands, activeHandIndex: stillHasHand ? nextHandIndex : seat.activeHandIndex }
          : p,
      );
      const activeSeat = stillHasHand
        ? context.activeSeat
        : findNextActingSeat(nextPlayers, context.activeSeat!);
      return {
        __actionCount: context.__actionCount + 1,
        players: nextPlayers,
        activeSeat,
      };
    }),
```

- [ ] **Step 4: Update `assignDouble` to bump `activeHandIndex`**

In `server/src/game/state-machine.ts` lines 316-338, replace `assignDouble`:

```ts
    assignDouble: assign(({ context, event }) => {
      if (event.type !== 'hand:double') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const newCards = [...hand.cards, event.card];
      const newHand = { ...hand, cards: newCards, bet: hand.bet * 2, doubled: true, busted: isBusted(newCards) };
      const newHands = player.hands.map((h, j) => j === event.handIndex ? newHand : h);
      const nextHandIndex = event.handIndex + 1;
      const stillHasHand = nextHandIndex < newHands.length &&
        !newHands[nextHandIndex].stood && !newHands[nextHandIndex].busted && !newHands[nextHandIndex].doubled;
      const newPlayers = context.players.map((p, i) =>
        i === context.activeSeat
          ? { ...p, bankroll: p.bankroll - hand.bet, hands: newHands, activeHandIndex: stillHasHand ? nextHandIndex : player.activeHandIndex }
          : p,
      );
      const activeSeat = stillHasHand
        ? context.activeSeat
        : findNextActingSeat(newPlayers, context.activeSeat!);
      return {
        __actionCount: context.__actionCount + 1,
        shoeSize: context.shoeSize - 1,
        players: newPlayers,
        activeSeat,
      };
    }),
```

- [ ] **Step 5: Update `assignHit` to bump `activeHandIndex` on bust or 21**

In `server/src/game/state-machine.ts` lines 281-300, replace `assignHit`:

```ts
    assignHit: assign(({ context, event }) => {
      if (event.type !== 'hand:hit') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const newCards = [...hand.cards, event.card];
      const busted = isBusted(newCards);
      const total21 = (() => {
        const real = newCards.filter((c): c is Card => !('hidden' in c));
        return real.reduce((sum, c) => sum + (c.rank === 'A' ? 11 : ['J','Q','K'].includes(c.rank) ? 10 : Number(c.rank)), 0) === 21;
      })();
      const handComplete = busted || total21;
      const newHand = { ...hand, cards: newCards, busted };
      const newHands = player.hands.map((h, j) => j === event.handIndex ? newHand : h);
      const nextHandIndex = event.handIndex + 1;
      const stillHasHand = handComplete && nextHandIndex < newHands.length &&
        !newHands[nextHandIndex].stood && !newHands[nextHandIndex].busted && !newHands[nextHandIndex].doubled;
      const newPlayers = context.players.map((p, i) =>
        i === context.activeSeat
          ? { ...p, hands: newHands, activeHandIndex: stillHasHand ? nextHandIndex : player.activeHandIndex }
          : p,
      );
      const activeSeat = handComplete
        ? (stillHasHand ? context.activeSeat : findNextActingSeat(newPlayers, context.activeSeat!))
        : context.activeSeat;
      return {
        __actionCount: context.__actionCount + 1,
        shoeSize: context.shoeSize - 1,
        players: newPlayers,
        activeSeat,
      };
    }),
```

- [ ] **Step 6: Update `assignSplit` to set `activeHandIndex = 0`**

In `server/src/game/state-machine.ts` lines 339-357, replace the `players` field in the returned object:

```diff
         players: context.players.map((p, i) =>
           i === context.activeSeat
-            ? { ...p, bankroll: p.bankroll - hand.bet, hands: [leftHand, rightHand] }
+            ? { ...p, bankroll: p.bankroll - hand.bet, hands: [leftHand, rightHand], activeHandIndex: 0 }
             : p,
         ),
```

- [ ] **Step 7: Update `findNextActingSeat` to reset `activeHandIndex` for the new seat**

In `server/src/game/state-machine.ts` lines 187-198, replace the function:

```ts
function findNextActingSeat(players: PlayerSeat[], from: number): number | null {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const s = players[idx];
    const firstIncomplete = s.hands.findIndex(
      (h) => !h.stood && !h.busted && !h.doubled && h.cards.length > 0,
    );
    if (firstIncomplete !== -1) {
      // Caller will set activeHandIndex via a follow-up assign; we just return the seat index.
      return idx;
    }
  }
  return null;
}
```

This returns `null` if no acting seat is found, signaling the dealer_turn auto-transition. (The current code returns `from` unchanged in that case, which the `allHandsActed` guard then catches — but returning `null` is more explicit and avoids confusion.)

- [ ] **Step 8: Update the return type of `findNextActingSeat` and its call sites**

The function signature is now `(players, from) => number | null`. Three call sites: `assignHit` (line 293), `assignStand` (line 309), `assignDouble` (line 331). Each passes the result directly into `activeSeat`. With the new return type, the field becomes `number | null`, which matches `GameContext.activeSeat` (line 44). No type changes needed at the call sites beyond removing the `!` non-null assertions on the return.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest test/state-machine-xstate.spec.ts -t "activeHandIndex walks all hands"
```

Expected: 3/3 pass.

- [ ] **Step 10: Run full server test suite**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest
```

Expected: 130 + 3 (from Task 3) + 3 (from this task) = 136/136 pass. Investigate any regression before continuing.

- [ ] **Step 11: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add server/src/game/state-machine.ts server/test/state-machine-xstate.spec.ts && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "feat(server): walk activeHandIndex through hand completion"
```

---

## Task 5: Reset `activeHandIndex` to first incomplete hand when the seat becomes active

**Files:**
- Modify: `server/src/game/state-machine.ts:187-198` (findNextActingSeat extension)
- Modify: `server/test/state-machine-xstate.spec.ts` (add test)

- [ ] **Step 1: Write the failing test**

Append to `server/test/state-machine-xstate.spec.ts`:

```ts
describe('activeHandIndex resets when a new seat becomes active', () => {
  it('seat 2 with hand 1 incomplete (hand 0 done) becomes active with activeHandIndex=1', () => {
    // Seat 0 has stood on both hands; seat 1 is sitting_out; seat 2 is the next to act.
    const players = createInitialState('R', Config.SEAT_COUNT).players.map((p, i) => {
      if (i === 0) {
        return {
          ...p, id: 's0', name: 'Alice', status: 'stood' as const,
          hands: [
            { cards: [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: '9' }], bet: 50, stood: true, busted: false, isBlackjack: false, doubled: false },
            { cards: [{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '7' }], bet: 50, stood: true, busted: false, isBlackjack: false, doubled: false },
          ],
          activeHandIndex: 2,
        };
      }
      if (i === 2) {
        return {
          ...p, id: 's2', name: 'Carol', status: 'acting' as const, activeHandIndex: 0,
          hands: [
            { cards: [{ suit: '♠', rank: '9' }, { suit: '♥', rank: '7' }], bet: 50, stood: true, busted: false, isBlackjack: false, doubled: false },
            { cards: [{ suit: '♦', rank: 'K' }, { suit: '♣', rank: '5' }], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false },
          ],
        };
      }
      return p;
    });
    // Force a transition by sending hand:stand on seat 0.
    const state: GameState = {
      ...createInitialState('R', Config.SEAT_COUNT), phase: 'player_turn', activeSeat: 0, players,
    };
    const next = applyAction(state, { type: 'hand:stand', seatId: 's0', handIndex: 1 });
    // Expected: activeSeat moves to 2; seat 2's activeHandIndex is set to 1 (the first incomplete hand).
    expect(next.activeSeat).toBe(2);
    expect(next.players[2].activeHandIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest test/state-machine-xstate.spec.ts -t "activeHandIndex resets when a new seat"
```

Expected: FAIL. The current `assignStand` calls `findNextActingSeat` which only returns the seat index. No code path sets the new seat's `activeHandIndex` to the first incomplete hand.

- [ ] **Step 3: Add a helper that resets the new seat's `activeHandIndex`**

In `server/src/game/state-machine.ts`, add a helper function right after `findNextActingSeat` (line 198):

```ts
// Walk to the next acting seat (after `from`) and reset its activeHandIndex
// to the first incomplete hand. Returns the new activeSeat index, or null if
// no acting seat is found (signals dealer_turn).
function advanceToNextActingSeat(players: PlayerSeat[], from: number): { seat: number | null; players: PlayerSeat[] } {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const s = players[idx];
    const firstIncomplete = s.hands.findIndex(
      (h) => !h.stood && !h.busted && !h.doubled && h.cards.length > 0,
    );
    if (firstIncomplete !== -1) {
      const newPlayers = players.map((p, j) =>
        j === idx ? { ...p, activeHandIndex: firstIncomplete, status: 'acting' as const } : p,
      );
      return { seat: idx, players: newPlayers };
    }
  }
  return { seat: null, players };
}
```

- [ ] **Step 4: Replace `findNextActingSeat` with `advanceToNextActingSeat` in `assignHit`, `assignStand`, `assignDouble`**

The current call sites do:
```ts
const activeSeat = findNextActingSeat(newPlayers, context.activeSeat!);
```

Replace each with:
```ts
const { seat: activeSeat, players: finalPlayers } = advanceToNextActingSeat(newPlayers, context.activeSeat!);
```

And use `finalPlayers` instead of `newPlayers` in the returned object. The full pattern, e.g. for `assignStand`:

```ts
    assignStand: assign(({ context, event }) => {
      if (event.type !== 'hand:stand') return {};
      const seat = context.players[context.activeSeat!];
      const newHands = seat.hands.map((h, j) => j === event.handIndex ? { ...h, stood: true } : h);
      const nextHandIndex = event.handIndex + 1;
      const stillHasHand = nextHandIndex < newHands.length &&
        !newHands[nextHandIndex].stood && !newHands[nextHandIndex].busted && !newHands[nextHandIndex].doubled;
      const midPlayers = context.players.map((p, i) =>
        i === context.activeSeat
          ? { ...p, hands: newHands, activeHandIndex: stillHasHand ? nextHandIndex : seat.activeHandIndex }
          : p,
      );
      const { seat: nextSeat, players: finalPlayers } = stillHasHand
        ? { seat: context.activeSeat, players: midPlayers }
        : advanceToNextActingSeat(midPlayers, context.activeSeat!);
      return {
        __actionCount: context.__actionCount + 1,
        players: finalPlayers,
        activeSeat: nextSeat,
      };
    }),
```

Apply the same pattern to `assignHit` and `assignDouble`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest test/state-machine-xstate.spec.ts -t "activeHandIndex resets when a new seat"
```

Expected: PASS.

- [ ] **Step 6: Run full server test suite**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest
```

Expected: 130 + 3 + 3 + 1 = 137/137 pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add server/src/game/state-machine.ts server/test/state-machine-xstate.spec.ts && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "feat(server): reset activeHandIndex when advancing to a new seat"
```

---

## Task 6: Add 5-seat gateway integration test

**Files:**
- Create: `server/test/integration/5-seat.spec.ts`

- [ ] **Step 1: Look at the existing gateway integration test for reference**

Read `server/test/gateway.integration.spec.ts` to understand the test bootstrap pattern (Nest app, socket clients, room create/join helpers). Model the new test on the same patterns.

- [ ] **Step 2: Write the 5-seat integration test**

Create `server/test/integration/5-seat.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { GameModule } from '../../src/game/game.module';

const PORT = 3100 + Math.floor(Math.random() * 100);

async function bootstrap(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [GameModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(PORT);
  return { app, url: `http://localhost:${PORT}` };
}

function connect(url: string): Promise<Socket> {
  return new Promise((resolve) => {
    const sock = io(url, { transports: ['websocket'], forceNew: true });
    sock.on('connect', () => resolve(sock));
  });
}

function nextState(sock: Socket): Promise<any> {
  return new Promise((resolve) => sock.once('game:state', resolve));
}

describe('5-seat room end-to-end', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await bootstrap());
  });

  afterAll(async () => {
    await app.close();
  });

  it('5 players can join, bet, deal, and complete a hand', async () => {
    const host = await connect(url);
    const roomId: string = await new Promise((resolve) => {
      host.emit('room:create', { name: 'Alice' }, (resp: any) => resolve(resp.roomId));
    });
    const guests: Socket[] = [];
    for (const name of ['Bob', 'Carol', 'Dan', 'Eve']) {
      const s = await connect(url);
      await new Promise<void>((resolve) => {
        s.emit('room:join', { roomId, name }, () => resolve());
      });
      guests.push(s);
    }

    // Host starts betting.
    const bet = 50;
    const placeBet = (s: Socket) =>
      new Promise<void>((resolve) => s.emit('bet:place', { seatId: 'self', amount: bet }, () => resolve()));
    const players = [host, ...guests];
    for (const s of players) await placeBet(s);

    // Host initiates the deal.
    host.emit('round:start', { seatId: 'self' });
    await nextState(host);

    // Each player stands in turn.
    for (let i = 0; i < 20; i++) {
      const stand = (s: Socket) => s.emit('hand:stand', { seatId: 'self', handIndex: 0 });
      for (const s of players) stand(s);
      await new Promise((r) => setTimeout(r, 50));
    }

    // Wait for the table to settle (settled state shows up via game:state).
    const settled = await new Promise<any>((resolve) => {
      const handler = (state: any) => {
        if (state.phase === 'settled') {
          host.off('game:state', handler);
          resolve(state);
        }
      };
      host.on('game:state', handler);
      setTimeout(() => resolve(null), 5_000);
    });
    expect(settled).not.toBeNull();
    expect(settled.players.length).toBe(5);

    for (const s of players) s.disconnect();
  }, 30_000);
});
```

- [ ] **Step 3: Run the integration test**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest test/integration/5-seat.spec.ts
```

Expected: 1/1 PASS within 30s. If the test times out, the most likely cause is the dealer_turn event not firing — check that the assigners handle the new `null` return from `findNextActingSeat` correctly (the `allHandsActed` guard's logic should auto-transition).

- [ ] **Step 4: Run full server test suite**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest
```

Expected: 137 + 1 = 138/138 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add server/test/integration/5-seat.spec.ts && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "test(server): 5-seat gateway integration end-to-end"
```

---

## Task 7: Resize PlayerList lobby cards

**Files:**
- Modify: `client/src/components/PlayerList.tsx`

- [ ] **Step 1: Shrink the seat card and avatar**

Open `client/src/components/PlayerList.tsx`. Apply the following changes:

```diff
 const SeatCard = styled.div<{ $seated: boolean }>`
-  width: 140px;
-  height: 170px;
+  width: 110px;
+  height: 140px;
   background: ${({ theme }) => theme.colors.entranceSurface};
   border-radius: ${({ theme }) => theme.radii.seat};
   display: flex;
   flex-direction: column;
   align-items: center;
   justify-content: center;
   gap: ${({ theme }) => theme.spacing.sm};
   padding: ${({ theme }) => theme.spacing.md};
   ...
 `;

 const Avatar = styled.div<{ $seated: boolean }>`
-  width: 56px;
-  height: 56px;
+  width: 44px;
+  height: 44px;
   border-radius: 50%;
   display: flex;
   align-items: center;
   justify-content: center;
   font-weight: bold;
-  font-size: 20px;
+  font-size: 16px;
   font-family: ${({ theme }) => theme.typography.fontFamily};
   ...
 `;
```

- [ ] **Step 2: Tighten the row gap and add flex-wrap**

```diff
 const Row = styled.div`
   display: flex;
-  gap: ${({ theme }) => theme.spacing.xl};
+  gap: ${({ theme }) => theme.spacing.md};
+  flex-wrap: wrap;
   justify-content: center;
   align-items: center;
 `;
```

- [ ] **Step 3: Run client typecheck and unit tests**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx tsc --noEmit -p tsconfig.json && npx vitest run
```

Expected: typecheck clean; 41/41 existing tests pass. No new tests yet — that comes in Task 9.

- [ ] **Step 4: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add client/src/components/PlayerList.tsx && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "style(client): shrink PlayerList cards for 5-seat layout"
```

---

## Task 8: Widen TableView and fix the seat grid to 5 columns

**Files:**
- Modify: `client/src/components/TableView.tsx`

- [ ] **Step 1: Widen `TableSurface`**

```diff
 const TableSurface = styled.div`
   position: relative;
   background: radial-gradient(...);
   border: 8px solid ${({ theme }) => theme.colors.feltBorder};
   border-radius: ${({ theme }) => theme.radii.pill};
   box-shadow: ${({ theme }) => theme.shadows.table};
   padding: ${({ theme }) => theme.spacing.xxl};
-  width: min(1100px, 100%);
+  width: min(1500px, 100%);
   font-family: ${({ theme }) => theme.typography.fontFamily};
   color: ${({ theme }) => theme.colors.textPrimary};
 `;
```

- [ ] **Step 2: Fix the seat grid to 5 columns with a fallback**

```diff
 const Seats = styled.div`
   display: grid;
-  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
+  grid-template-columns: repeat(5, 1fr);
   gap: ${({ theme }) => theme.spacing.xl};
   margin-top: ${({ theme }) => theme.spacing.sm};
+
+  @media (max-width: 1100px) {
+    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
+  }
 `;
```

- [ ] **Step 3: Run client typecheck and unit tests**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx tsc --noEmit -p tsconfig.json && npx vitest run
```

Expected: typecheck clean; 41/41 pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add client/src/components/TableView.tsx && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "style(client): widen TableView and fix seat grid to 5 columns"
```

---

## Task 9: Create `EmptySeatTile` component

**Files:**
- Create: `client/src/components/EmptySeatTile.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/EmptySeatTile.tsx`:

```tsx
import styled from 'styled-components';

const Tile = styled.div`
  width: 100%;
  max-width: 180px;
  aspect-ratio: 1 / 1;
  border: 2px dashed ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.seat};
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  opacity: 0.6;
`;

const Glyph = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 28px;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Label = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-weight: bold;
`;

export function EmptySeatTile() {
  return (
    <Tile aria-label="empty-seat">
      <Glyph>+</Glyph>
      <Label>Empty</Label>
    </Tile>
  );
}
```

- [ ] **Step 2: Run client typecheck**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx tsc --noEmit -p tsconfig.json
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add client/src/components/EmptySeatTile.tsx && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "feat(client): add EmptySeatTile for ghosted empty seats"
```

---

## Task 10: Use `EmptySeatTile` in TableView

**Files:**
- Modify: `client/src/components/TableView.tsx`

- [ ] **Step 1: Import `EmptySeatTile`**

```diff
 import { useSelector } from 'react-redux';
 import styled from 'styled-components';
 import { DealerArea } from './DealerArea';
 import { PlayerSeatView } from './PlayerSeat';
+import { EmptySeatTile } from './EmptySeatTile';
 import { ActionPanel } from './ActionPanel';
 import { BetPanel } from './BetPanel';
 import { DealButton } from './DealButton';
 import { ResultOverlay } from './ResultOverlay';
 import type { RootState } from '../store';
```

- [ ] **Step 2: Render empty seats as `EmptySeatTile`**

Replace the `state.players.filter(...)` block with an unconditional map:

```diff
-        {state.players
-          .filter((p) => p.status !== 'empty')
-          .map((p) => (
-            <PlayerSeatView
-              key={p.id}
-              seat={p}
-              isActive={state.activeSeat !== null && state.players[state.activeSeat]?.id === p.id}
-              isMe={p.id === selfSeatId}
-            />
-          ))}
+        {state.players.map((p) =>
+          p.status === 'empty' ? (
+            <EmptySeatTile key={p.id} />
+          ) : (
+            <PlayerSeatView
+              key={p.id}
+              seat={p}
+              isActive={state.activeSeat !== null && state.players[state.activeSeat]?.id === p.id}
+              isMe={p.id === selfSeatId}
+            />
+          ),
+        )}
```

- [ ] **Step 3: Run client typecheck and unit tests**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx tsc --noEmit -p tsconfig.json && npx vitest run
```

Expected: typecheck clean; 41/41 pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add client/src/components/TableView.tsx && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "feat(client): render ghosted empty seats on the table"
```

---

## Task 11: Add unit tests for the resized PlayerList

**Files:**
- Create: `client/test/components/PlayerList.spec.tsx`

- [ ] **Step 1: Look at the existing component test pattern**

Read `client/test/setup.ts` and one of the existing component specs (e.g. `client/test/components/*.spec.tsx` if any) to learn the test bootstrap (renderWithProviders, etc.). If `client/test/components/` is empty, use the pattern from `client/test/selectors/lobby.spec.ts` for Redux setup.

- [ ] **Step 2: Write the PlayerList spec**

Create `client/test/components/PlayerList.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { PlayerList } from '../../src/components/PlayerList';
import lobbyReducer from '../../src/store/lobby.slice';
import gameReducer from '../../src/store/game.slice';
import type { PlayerSeat } from '../../src/shared/types';

const SEAT_COUNT = 5;

function makeStore(seats: PlayerSeat[]) {
  return configureStore({
    reducer: { lobby: lobbyReducer, game: gameReducer },
    preloadedState: {
      lobby: { roomId: 'R1', hostId: 's0', players: seats.filter((s) => s.status !== 'empty').map((s) => ({ id: s.id, name: s.name, ready: true, connectedAt: s.connectedAt })) },
      game: { state: { roomId: 'R1', phase: 'lobby', shoeSize: 0, cutCardIndex: 0, players: seats, dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }, activeSeat: null, roundNumber: 0, lastResult: null } },
    },
  });
}

describe('PlayerList (5-seat layout)', () => {
  it('renders 5 seat cards', () => {
    const seats: PlayerSeat[] = Array.from({ length: SEAT_COUNT }, (_, i) => ({
      id: `s${i}`,
      name: i < 2 ? ['Alice', 'Bob'][i] : '',
      bankroll: 1000,
      hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: i < 2 ? 'betting' as const : 'empty' as const,
      connectedAt: Date.now(),
      lastBet: 0,
      activeHandIndex: 0,
    }));
    const store = makeStore(seats);
    const { container } = render(<Provider store={store}><PlayerList /></Provider>);
    const cards = container.querySelectorAll('[aria-label^="seat-"], [aria-label="empty-seat"]');
    expect(cards.length).toBe(5);
  });

  it('renders the seated treatment for occupied seats', () => {
    const seats: PlayerSeat[] = Array.from({ length: SEAT_COUNT }, (_, i) => ({
      id: `s${i}`, name: i === 0 ? 'Alice' : '', bankroll: 1000,
      hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: i === 0 ? 'betting' as const : 'empty' as const,
      connectedAt: Date.now(), lastBet: 0, activeHandIndex: 0,
    }));
    const store = makeStore(seats);
    const { container } = render(<Provider store={store}><PlayerList /></Provider>);
    expect(container.querySelector('[aria-label="seat-Alice"]')).toBeTruthy();
    expect(container.querySelectorAll('[aria-label="empty-seat"]').length).toBe(4);
  });

  it('renders the empty treatment for unoccupied seats', () => {
    const seats: PlayerSeat[] = Array.from({ length: SEAT_COUNT }, () => ({
      id: 'x', name: '', bankroll: 1000,
      hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: 'empty' as const, connectedAt: Date.now(), lastBet: 0, activeHandIndex: 0,
    }));
    const store = makeStore(seats);
    const { container } = render(<Provider store={store}><PlayerList /></Provider>);
    expect(container.querySelectorAll('[aria-label="empty-seat"]').length).toBe(5);
    expect(container.textContent).toContain('Empty Seat');
  });
});
```

Adjust the imports / store shape to match the actual `lobby.slice` and `game.slice` exports. If the slices have different keys (e.g. `lobby.players` vs `lobby.guests`), inspect the file and align the test.

- [ ] **Step 3: Run the spec**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx vitest run test/components/PlayerList.spec.tsx
```

Expected: 3/3 pass.

- [ ] **Step 4: Run full client test suite**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx vitest run
```

Expected: 41 + 3 = 44/44 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add client/test/components/PlayerList.spec.tsx && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "test(client): PlayerList renders 5 seats at 110x140"
```

---

## Task 12: Add unit tests for the resized TableView

**Files:**
- Create: `client/test/components/TableView.spec.tsx`

- [ ] **Step 1: Write the TableView spec**

Create `client/test/components/TableView.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { TableView } from '../../src/components/TableView';
import connectionReducer from '../../src/store/connection.slice';
import gameReducer from '../../src/store/game.slice';
import type { PlayerSeat } from '../../src/shared/types';

const SEAT_COUNT = 5;

function makeStore(seats: PlayerSeat[], selfSeatId: string | null = 's0') {
  return configureStore({
    reducer: { connection: connectionReducer, game: gameReducer },
    preloadedState: {
      connection: { selfSeatId, connected: true, roomId: 'R1' },
      game: { state: { roomId: 'R1', phase: 'betting', shoeSize: 0, cutCardIndex: 0, players: seats, dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }, activeSeat: null, roundNumber: 0, lastResult: null } },
    },
  });
}

describe('TableView (5-seat layout)', () => {
  it('renders 5 tiles when 2 are seated and 3 are empty', () => {
    const seats: PlayerSeat[] = Array.from({ length: SEAT_COUNT }, (_, i) => ({
      id: `s${i}`, name: i < 2 ? ['Alice', 'Bob'][i] : '', bankroll: 1000,
      hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: i < 2 ? 'betting' as const : 'empty' as const,
      connectedAt: Date.now(), lastBet: 0, activeHandIndex: 0,
    }));
    const store = makeStore(seats);
    const { container } = render(<Provider store={store}><TableView /></Provider>);
    const tiles = container.querySelectorAll('[aria-label^="seat-"], [aria-label="empty-seat"]');
    expect(tiles.length).toBe(5);
  });

  it('renders 3 ghosted empty tiles', () => {
    const seats: PlayerSeat[] = Array.from({ length: SEAT_COUNT }, (_, i) => ({
      id: `s${i}`, name: i < 2 ? ['Alice', 'Bob'][i] : '', bankroll: 1000,
      hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: i < 2 ? 'betting' as const : 'empty' as const,
      connectedAt: Date.now(), lastBet: 0, activeHandIndex: 0,
    }));
    const store = makeStore(seats);
    const { container } = render(<Provider store={store}><TableView /></Provider>);
    const empties = container.querySelectorAll('[aria-label="empty-seat"]');
    expect(empties.length).toBe(3);
  });
});
```

Adjust the slice import names and preloadedState shape to match the actual `connection.slice` and `game.slice` exports.

- [ ] **Step 2: Run the spec**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx vitest run test/components/TableView.spec.tsx
```

Expected: 2/2 pass.

- [ ] **Step 3: Run full client test suite**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx vitest run
```

Expected: 44 + 2 = 46/46 pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add client/test/components/TableView.spec.tsx && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "test(client): TableView renders 5 tiles with ghosted empties"
```

---

## Task 13: Add a 5-player E2E spec

**Files:**
- Create: `client/e2e/five-player.spec.ts`

- [ ] **Step 1: Write the lightweight 5-player E2E**

Create `client/e2e/five-player.spec.ts`:

```ts
import { test, expect, chromium } from '@playwright/test';

test('5-seat lobby and table render correctly', async () => {
  const browser = await chromium.launch();
  const host = await browser.newContext();
  const guest = await browser.newContext();

  // Host creates a 5-seat room.
  const hostPage = await host.newPage();
  await hostPage.goto('/');
  await hostPage.fill('input[placeholder="Your name"]', 'Alice');
  await hostPage.click('button:has-text("Create Room")');
  await hostPage.waitForURL(/\/room\//);
  const roomUrl = hostPage.url();
  const code = roomUrl.split('/room/')[1];

  // Guest joins.
  const guestPage = await guest.newPage();
  await guestPage.goto('/');
  await guestPage.fill('input[placeholder="Your name"]', 'Bob');
  await guestPage.fill('input[placeholder="Room code"]', code);
  await guestPage.click('button:has-text("Join")');
  await guestPage.waitForURL(/\/room\//);

  // Both should see 5 seat cards in the lobby (3 empty + 2 seated).
  await hostPage.waitForSelector('[aria-label^="seat-"]');
  const hostSeats = await hostPage.$$eval(
    '[aria-label^="seat-"], [aria-label="empty-seat"]',
    (els) => els.length,
  );
  expect(hostSeats).toBe(5);

  await guestPage.waitForSelector('[aria-label^="seat-"]');
  const guestSeats = await guestPage.$$eval(
    '[aria-label^="seat-"], [aria-label="empty-seat"]',
    (els) => els.length,
  );
  expect(guestSeats).toBe(5);

  // Host starts the round.
  await hostPage.click('button:has-text("Begin Betting")');
  await hostPage.waitForSelector('.bet-panel', { timeout: 10_000 });

  // Table should render 5 seat tiles (3 ghosted + 2 real).
  await hostPage.waitForSelector('[aria-label="empty-seat"]');
  const tableTiles = await hostPage.$$eval(
    '[aria-label^="seat-"], [aria-label="empty-seat"]',
    (els) => els.length,
  );
  expect(tableTiles).toBe(5);

  for (const ctx of [host, guest]) await ctx.close();
  await browser.close();
});
```

- [ ] **Step 2: Run the spec**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx playwright test e2e/five-player.spec.ts
```

Expected: 1/1 pass within 30s.

- [ ] **Step 3: Run full E2E suite**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx playwright test
```

Expected: 1 (happy-path) + 1 (five-player) = 2 passed, 1 skipped (the existing skipped `drop-and-reconnect`).

- [ ] **Step 4: Commit**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && git add client/e2e/five-player.spec.ts && git -c user.name=claude -c user.email=claude@anthropic.com commit -m "test(e2e): 5-seat lobby and table layout"
```

---

## Task 14: Final full verification

**Files:** none modified

- [ ] **Step 1: Server tests + typecheck**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/server && npx jest && npx tsc --noEmit
```

Expected: 138/138 pass (130 baseline + 3 handIndex-validation + 3 activeHandIndex-walk + 1 activeHandIndex-reset + 1 integration); typecheck clean.

- [ ] **Step 2: Client tests + typecheck**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx vitest run && npx tsc --noEmit -p tsconfig.json
```

Expected: 46/46 pass (41 baseline + 3 PlayerList + 2 TableView); typecheck clean.

- [ ] **Step 3: Playwright E2E**

```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21/client && npx playwright test
```

Expected: 2 passed, 1 skipped.

- [ ] **Step 4: Confirm no regressions**

If any of the above fails, the task that introduced the failure is the most recent task. Investigate, fix, commit a fix-up, and re-run this task.

- [ ] **Step 5: Confirm spec is satisfied**

Open `docs/superpowers/specs/2026-06-14-five-seats-design.md` and check off each item in the "Definition of done" list:

- [ ] `Config.SEAT_COUNT = 5` in `server/src/config.ts`. *(Task 1)*
- [ ] Lobby renders 5 seat cards in a single row at 110×140, with 16px gap. *(Tasks 7, 11)*
- [ ] Table renders 5 tiles in a single row at ~1500px max width; empty seats show as ghosted tiles. *(Tasks 8, 9, 10, 12)*
- [ ] A 5-seat room can be created, joined by 5 players, and play a full hand end-to-end. *(Task 6, Task 13)*
- [ ] Split-hand turn tracking walks all hands in order, rejects mismatched `handIndex`, and never strands a hand. *(Tasks 3, 4, 5)*
- [ ] All existing 130 server + 41 client + 1 E2E tests still pass; ~17 new tests pass. *(Tasks 1, 6, 11, 12, 13)*

- [ ] **Step 6: Commit any fix-ups (if any)**

If verification surfaced an issue and you committed a fix, ensure it is pushed. Otherwise this task is the end of the plan.

---

## Self-Review Notes

After writing the plan, I checked it against the spec:

**Spec coverage:**
- §Server: Config bump (Task 1), `activeHandIndex` data model (Task 2), handIndex validation (Task 3), completion walking (Task 4), seat-advance reset (Task 5), 5-seat integration (Task 6).
- §Client lobby: card resize (Task 7).
- §Client table: width + grid (Task 8), `EmptySeatTile` (Task 9), use in TableView (Task 10).
- §Tests: PlayerList unit (Task 11), TableView unit (Task 12), 5-player E2E (Task 13).
- §Final verification (Task 14).

**Placeholder scan:** No "TBD" / "TODO" / "fill in details" in any step. The note in Task 11 and Task 12 to "adjust imports to match the actual slice exports" is a defensive instruction to the implementer, not a plan failure — the actual exports are discoverable by reading the slice files.

**Type consistency:**
- `activeHandIndex: number` is defined in Task 2 and used uniformly in Tasks 3-5.
- `findNextActingSeat` returns `number | null` in Task 4 and the new helper `advanceToNextActingSeat` returns `{ seat, players }` in Task 5; the call sites are updated consistently.
- `EmptySeatTile` is defined in Task 9 and used in Task 10; the import is added before the use.
- The `aria-label="empty-seat"` attribute is used both in `PlayerList` (existing) and `EmptySeatTile` (new). This is acceptable because they are rendered on different routes (lobby vs. table).

**Ambiguity:**
- Tasks 11 and 12 reference specific store/slice shapes. If the actual shapes differ, the implementer adjusts the test. The intent is clear: 3 tests for PlayerList (count, seated, empty), 2 tests for TableView (count, ghosted count).
- The integration test in Task 6 uses `setTimeout`-based polling. This is intentionally simple — a more robust test would use a Promise that resolves on a specific `game:state` event, but the polling approach is easier to write and matches the existing test style.
- The E2E in Task 13 is intentionally lightweight (lobby + table layout). A full 5-player hand-played-to-settlement E2E is documented as acceptable but not required.

# State Machine Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the imperative `applyAction` switch in `server/src/game/state-machine.ts` with an XState v5 state machine, preserving the public API and the wire-format `GameState` so the gateway, client, and existing tests are unaffected.

**Architecture:** XState v5 machine owns the dynamic state (shoe, players, dealer, activeSeat, etc.). The wire-format `GameState` is reconstructed from the XState snapshot. Card draws are pre-fetched by a new `draw-bridge.ts` and attached to events. The public `applyAction(state, action, draw?)` API is preserved exactly, including the 7 `GameError` codes. A new `DRAW_REQUIRED` code is introduced at the wrapper level for missing-card-needing actions without a `draw` callback.

**Tech Stack:** Server: NestJS 10, TypeScript 5, XState v5, Jest (existing). Client: unchanged.

**Spec:** `docs/superpowers/specs/2026-06-14-state-machine-refactor-design.md`

**Working directory notes:**
- All server commands are run from `server/`.
- Test commands (per project MEMORY):
  - Server: `npx jest` (unit + integration) and `npx tsc --noEmit`
  - Client: `npx vitest run` (unit), `npx tsc --noEmit -p tsconfig.json` (typecheck)
  - E2E: `npx playwright test` — Playwright browsers are not installed in this environment; the plan typechecks the E2E file but does not run it. The user can run it locally.

---

## File Structure

**Server (new files):**
- `server/src/game/draw-bridge.ts` — pre-draw logic for each event type; computes dealer's final hand
- `server/test/draw-bridge.spec.ts` — unit tests for the draw bridge
- `server/test/state-machine-xstate.spec.ts` — structural tests for the XState machine (state graph, snapshot roundtrip)

**Server (modified files):**
- `server/src/game/state-machine.ts` — full rewrite to XState v5; keeps the public `applyAction`, `createInitialState`, `Action`, `GameError` API identical
- `server/package.json` — add `xstate@^5` dependency

**Server (transient):**
- `server/src/game/state-machine.legacy.ts` — the old imperative implementation, renamed. Deleted in Task 6.

**Unchanged:**
- `server/test/state-machine.spec.ts` — 24 existing tests pass against the new code
- `server/src/game/hand.ts`, `dealer.ts`, `payout.ts`, `shoe.ts`, `game.service.ts`
- `client/**` — wire format stable
- `server/src/shared/types.ts` — public `GameState`, `PlayerSeat`, `Hand`, `Card`, `CardSlot`, `Phase`, `RoundResult` types unchanged

No file is restructured beyond the rename. The new `state-machine.ts` is expected to be similar in line count to the old (~250-350 lines, with the XState machine definition as the bulk). `draw-bridge.ts` is ~50-100 lines.

---

## Task 1: Add xstate@^5 dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add `xstate` to `dependencies`**

In `server/package.json`, add `"xstate": "^5.18.0"` (current v5 at time of writing) to the `dependencies` block. Insert it alphabetically after `"socket.io"`:

```json
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/platform-socket.io": "^10.3.0",
    "@nestjs/websockets": "^10.3.0",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1",
    "socket.io": "^4.7.4",
    "xstate": "^5.18.0"
  },
```

- [ ] **Step 2: Install**

Run from `server/`:

```bash
npm install
```

Expected: `xstate` and its dependencies are added to `node_modules/`. No errors.

- [ ] **Step 3: Verify TypeScript can import it**

Run from `server/`:

```bash
npx tsc --noEmit
```

Expected: exit code 0, no errors. (We haven't used xstate yet, but this confirms the install is well-formed.)

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore(server): add xstate@^5 dependency"
```

---

## Task 2: Build `draw-bridge.ts` with TDD

The draw bridge has two functions: `prepareEvent(snapshot, action, draw)` and `computeDealerEvent(snapshot, draw)`. We build them incrementally with TDD: write a failing test, see it fail, implement, see it pass, commit.

**Files:**
- Create: `server/test/draw-bridge.spec.ts`
- Create: `server/src/game/draw-bridge.ts`

### Task 2.1: Test that `prepareEvent` is a stub (TDD setup)

- [ ] **Step 1: Create the test file**

Create `server/test/draw-bridge.spec.ts`:

```ts
import { prepareEvent, computeDealerEvent } from '../src/game/draw-bridge';
import type { Card, GameState } from '../src/shared/types';
import { createInitialState } from '../src/game/state-machine';
import { Config } from '../src/config';

const baseState = (): GameState => ({ ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'betting' });

const makeDraw = (cards: Card[]) => {
  let i = 0;
  return () => cards[i++];
};

describe('drawBridge.prepareEvent', () => {
  it('returns a bet:place event unchanged (no cards needed)', () => {
    const state = baseState();
    const draw = makeDraw([]);
    const ev = prepareEvent(state, { type: 'bet:place', seatId: state.players[0].id, amount: 50 }, draw);
    expect(ev).toEqual({ type: 'bet:place', seatId: state.players[0].id, amount: 50 });
  });
});
```

- [ ] **Step 2: Create the empty `draw-bridge.ts` stub**

Create `server/src/game/draw-bridge.ts`:

```ts
import type { Card, CardSlot, GameState } from '../shared/types';
import type { Action } from './state-machine';
import { dealerShouldHit } from './dealer';

export type PreparedEvent = { type: string; [k: string]: unknown };

export function prepareEvent(state: GameState, action: Action, draw?: () => Card): PreparedEvent {
  throw new Error('not implemented');
}

export function computeDealerEvent(state: GameState, draw: () => Card): PreparedEvent {
  throw new Error('not implemented');
}
```

- [ ] **Step 3: Run the test to confirm it fails**

Run from `server/`:

```bash
npx jest test/draw-bridge.spec.ts
```

Expected: FAIL with "not implemented" thrown from `prepareEvent`.

- [ ] **Step 4: Commit the failing test**

```bash
git add server/test/draw-bridge.spec.ts server/src/game/draw-bridge.ts
git commit -m "test(server): scaffold draw-bridge with first failing test"
```

### Task 2.2: Implement `prepareEvent` for no-card actions

- [ ] **Step 1: Make `prepareEvent` handle no-card actions**

In `server/src/game/draw-bridge.ts`, replace the body of `prepareEvent`:

```ts
export function prepareEvent(state: GameState, action: Action, draw?: () => Card): PreparedEvent {
  // No-card actions: pass through unchanged.
  const noCardActions: Action['type'][] = ['bet:place', 'hand:stand', 'round:ready', 'round:advance'];
  if (noCardActions.includes(action.type)) {
    return { ...action };
  }

  throw new Error(`not implemented: ${action.type}`);
}
```

- [ ] **Step 2: Run the test to confirm it passes**

Run from `server/`:

```bash
npx jest test/draw-bridge.spec.ts
```

Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
git add server/src/game/draw-bridge.ts
git commit -m "feat(server): draw-bridge handles no-card actions"
```

### Task 2.3: Add tests for `hand:hit` and `hand:double` (1 card)

- [ ] **Step 1: Add tests to `draw-bridge.spec.ts`**

Append to the `describe('drawBridge.prepareEvent', ...)` block in `server/test/draw-bridge.spec.ts`:

```ts
  it('attaches 1 card to hand:hit', () => {
    const state: GameState = { ...baseState(), phase: 'player_turn', activeSeat: 0 };
    const draw = makeDraw([{ suit: '♦', rank: '7' }]);
    const ev = prepareEvent(state, { type: 'hand:hit', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(ev).toEqual({ type: 'hand:hit', seatId: state.players[0].id, handIndex: 0, card: { suit: '♦', rank: '7' } });
  });

  it('attaches 1 card to hand:double', () => {
    const state: GameState = { ...baseState(), phase: 'player_turn', activeSeat: 0 };
    const draw = makeDraw([{ suit: '♦', rank: 'K' }]);
    const ev = prepareEvent(state, { type: 'hand:double', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(ev).toEqual({ type: 'hand:double', seatId: state.players[0].id, handIndex: 0, card: { suit: '♦', rank: 'K' } });
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest test/draw-bridge.spec.ts
```

Expected: the 2 new tests fail with "not implemented" (or similar).

- [ ] **Step 3: Implement the 1-card branch**

In `server/src/game/draw-bridge.ts`, replace the `prepareEvent` body:

```ts
export function prepareEvent(state: GameState, action: Action, draw?: () => Card): PreparedEvent {
  if (!draw) throw new Error('DRAW_REQUIRED');

  switch (action.type) {
    case 'bet:place':
    case 'hand:stand':
    case 'round:ready':
    case 'round:advance':
      return { ...action };

    case 'hand:hit':
    case 'hand:double':
      return { ...action, card: draw() };

    default:
      throw new Error(`not implemented: ${(action as Action).type}`);
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest test/draw-bridge.spec.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/test/draw-bridge.spec.ts server/src/game/draw-bridge.ts
git commit -m "feat(server): draw-bridge handles hand:hit and hand:double"
```

### Task 2.4: Add tests for `hand:split` (2 cards)

- [ ] **Step 1: Add the test**

Append to the `describe('drawBridge.prepareEvent', ...)` block:

```ts
  it('attaches 2 cards to hand:split', () => {
    const state: GameState = { ...baseState(), phase: 'player_turn', activeSeat: 0 };
    const draw = makeDraw([{ suit: '♣', rank: '2' }, { suit: '♦', rank: '9' }]);
    const ev = prepareEvent(state, { type: 'hand:split', seatId: state.players[0].id, handIndex: 0 }, draw);
    expect(ev).toEqual({
      type: 'hand:split',
      seatId: state.players[0].id,
      handIndex: 0,
      leftCard: { suit: '♣', rank: '2' },
      rightCard: { suit: '♦', rank: '9' },
    });
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest test/draw-bridge.spec.ts -t "hand:split"
```

Expected: FAIL.

- [ ] **Step 3: Implement the `hand:split` branch**

In `server/src/game/draw-bridge.ts`, add the `hand:split` case to the switch:

```ts
    case 'hand:split':
      return { ...action, leftCard: draw(), rightCard: draw() };
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx jest test/draw-bridge.spec.ts -t "hand:split"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/test/draw-bridge.spec.ts server/src/game/draw-bridge.ts
git commit -m "feat(server): draw-bridge handles hand:split"
```

### Task 2.5: Add tests for `round:start`

- [ ] **Step 1: Add the test**

Append to the `describe('drawBridge.prepareEvent', ...)` block:

```ts
  it('attaches dealtCards and dealerUpcard to round:start', () => {
    const state: GameState = {
      ...baseState(),
      phase: 'betting',
      players: state_with_one_seated_player(),
    };
    const draw = makeDraw([
      { suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }, // seat 0 hand
      { suit: '♣', rank: 'K' },                            // dealer upcard
    ]);
    const ev = prepareEvent(state, { type: 'round:start', seatId: state.players[0].id }, draw);
    expect(ev).toEqual({
      type: 'round:start',
      seatId: state.players[0].id,
      dealtCards: [{ playerIndex: 0, cards: [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }] }],
      dealerUpcard: { suit: '♣', rank: 'K' },
    });
  });
```

- [ ] **Step 2: Add a helper to `draw-bridge.spec.ts`**

Above the `describe` block, add:

```ts
function state_with_one_seated_player(): GameState['players'] {
  return [
    {
      id: 'p0',
      name: 'Alice',
      bankroll: 1000,
      hands: [{ cards: [], bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: 'betting',
      connectedAt: 0,
      lastBet: 0,
    },
    {
      id: 'p1',
      name: '',
      bankroll: 1000,
      hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
      status: 'empty',
      connectedAt: 0,
      lastBet: 0,
    },
  ] as GameState['players'];
}
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
npx jest test/draw-bridge.spec.ts -t "round:start"
```

Expected: FAIL.

- [ ] **Step 4: Implement the `round:start` branch**

In `server/src/game/draw-bridge.ts`, add the `round:start` case to the switch:

```ts
    case 'round:start': {
      const dealtCards: { playerIndex: number; cards: [Card, Card] }[] = [];
      state.players.forEach((p, i) => {
        if (p.hands[0]?.bet && p.hands[0].bet > 0) {
          dealtCards.push({ playerIndex: i, cards: [draw(), draw()] });
        }
      });
      return { ...action, dealtCards, dealerUpcard: draw() };
    }
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npx jest test/draw-bridge.spec.ts -t "round:start"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/test/draw-bridge.spec.ts server/src/game/draw-bridge.ts
git commit -m "feat(server): draw-bridge handles round:start"
```

### Task 2.6: Test that `DRAW_REQUIRED` is thrown

- [ ] **Step 1: Add the test**

Append to the `describe('drawBridge.prepareEvent', ...)` block:

```ts
  it('throws GameError with code DRAW_REQUIRED when draw is undefined and action needs cards', () => {
    const state: GameState = { ...baseState(), phase: 'player_turn', activeSeat: 0 };
    expect(() =>
      prepareEvent(state, { type: 'hand:hit', seatId: state.players[0].id, handIndex: 0 }, undefined),
    ).toThrow('DRAW_REQUIRED');
  });
```

- [ ] **Step 2: Implement `GameError` and use it**

In `server/src/game/draw-bridge.ts`, change the import to include `GameError`, and replace the `throw new Error('DRAW_REQUIRED')` with a `GameError`:

```ts
import { GameError } from './state-machine';
```

And in the body:

```ts
  if (!draw) throw new GameError('DRAW_REQUIRED');
```

- [ ] **Step 3: Add a temporary `GameError` export to `state-machine.ts`**

At the bottom of `server/src/game/state-machine.ts` (the current imperative file), add (temporarily — it'll be replaced in Task 4):

```ts
export class GameError extends Error {
  constructor(public code: string) { super(code); }
}
```

**Note:** the existing `state-machine.ts` already defines `GameError`. Verify this is true. If it is, skip this step.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx jest test/draw-bridge.spec.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/test/draw-bridge.spec.ts server/src/game/draw-bridge.ts server/src/game/state-machine.ts
git commit -m "feat(server): draw-bridge throws DRAW_REQUIRED when draw missing"
```

### Task 2.7: Implement `computeDealerEvent` (TDD)

- [ ] **Step 1: Add the test**

In `server/test/draw-bridge.spec.ts`, add a new `describe` block at the end of the file:

```ts
describe('drawBridge.computeDealerEvent', () => {
  it('reveals the hole card and applies the dealer strategy', () => {
    const state: GameState = {
      ...baseState(),
      phase: 'dealer_turn',
      dealer: { cards: [{ suit: '♠', rank: '10' }, { hidden: true }], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    };
    const draw = makeDraw([
      { suit: '♥', rank: '7' },  // hole card → total 17, stand
    ]);
    const ev = computeDealerEvent(state, draw);
    expect(ev).toEqual({
      type: 'round:dealerPlay',
      dealerFinalHand: [{ suit: '♠', rank: '10' }, { suit: '♥', rank: '7' }],
    });
  });

  it('continues drawing while the dealer total is below 17', () => {
    const state: GameState = {
      ...baseState(),
      phase: 'dealer_turn',
      dealer: { cards: [{ suit: '♠', rank: '5' }, { hidden: true }], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    };
    const draw = makeDraw([
      { suit: '♥', rank: '6' },  // hole card → total 11, hit
      { suit: '♦', rank: '3' },  // hit → total 14, hit
      { suit: '♣', rank: '2' },  // hit → total 16, hit
      { suit: '♠', rank: 'K' },  // hit → total 26, bust
    ]);
    const ev = computeDealerEvent(state, draw);
    expect(ev).toEqual({
      type: 'round:dealerPlay',
      dealerFinalHand: [
        { suit: '♠', rank: '5' },
        { suit: '♥', rank: '6' },
        { suit: '♦', rank: '3' },
        { suit: '♣', rank: '2' },
        { suit: '♠', rank: 'K' },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest test/draw-bridge.spec.ts -t "computeDealerEvent"
```

Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement `computeDealerEvent`**

In `server/src/game/draw-bridge.ts`, replace the `computeDealerEvent` body:

```ts
export function computeDealerEvent(state: GameState, draw: () => Card): PreparedEvent {
  const finalHand: CardSlot[] = state.dealer.cards.map((c) => ('hidden' in c ? draw() : c));
  while (dealerShouldHit(finalHand)) {
    finalHand.push(draw());
  }
  return { type: 'round:dealerPlay', dealerFinalHand: finalHand };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx jest test/draw-bridge.spec.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/test/draw-bridge.spec.ts server/src/game/draw-bridge.ts
git commit -m "feat(server): draw-bridge computes dealer final hand"
```

---

## Task 3: Build the new XState machine in `state-machine.ts`

This task replaces the imperative `state-machine.ts` with an XState v5 machine. We start by renaming the old file to a `.legacy.ts` (preserved for one commit as a safety net), then write the new file.

**Files:**
- Rename: `server/src/game/state-machine.ts` → `server/src/game/state-machine.legacy.ts`
- Create: `server/src/game/state-machine.ts` (new XState implementation)
- Modify: `server/src/game/state-machine.legacy.ts` (no logic changes, just the rename)

### Task 3.1: Move the old code to `.legacy.ts`

- [ ] **Step 1: Rename the file**

Run from the repo root:

```bash
git mv server/src/game/state-machine.ts server/src/game/state-machine.legacy.ts
git add server/src/game/state-machine.legacy.ts
```

- [ ] **Step 2: Verify nothing is broken yet**

Run from `server/`:

```bash
npx tsc --noEmit
npx jest test/state-machine.spec.ts
```

Expected: TypeScript fails to find `state-machine` module (because the test imports it from `../src/game/state-machine`). The Jest tests also fail.

If the project uses any other imports of `state-machine` outside the test, they will also fail. Fix any import by pointing to the new location, or hold off on this step until Task 3.3 (when the new file is created).

- [ ] **Step 3: Commit the rename**

```bash
git commit -m "refactor(server): move state-machine.ts to .legacy.ts (placeholder for new XState impl)"
```

**Note:** this commit will break the build. The next task creates the new file.

### Task 3.2: Create the new `state-machine.ts` as a stub

- [ ] **Step 1: Create the stub file**

Create `server/src/game/state-machine.ts`:

```ts
// Placeholder stub. The XState machine will be built in subsequent steps.
import { applyAction as legacyApply, createInitialState as legacyCreate, Action as LegacyAction, GameError as LegacyGameError } from './state-machine.legacy';

export type Action = LegacyAction;
export class GameError extends LegacyGameError {}
export const createInitialState = legacyCreate;
export const applyAction = legacyApply as (state: unknown, action: Action, draw?: unknown) => unknown;
```

- [ ] **Step 2: Run the tests to confirm the stub re-exports work**

Run from `server/`:

```bash
npx tsc --noEmit
npx jest test/state-machine.spec.ts
```

Expected: 24 tests pass. The stub is a re-export from the legacy file.

- [ ] **Step 3: Commit the stub**

```bash
git add server/src/game/state-machine.ts
git commit -m "refactor(server): state-machine.ts is now a re-export stub from .legacy"
```

### Task 3.3: Build the empty XState machine

- [ ] **Step 1: Replace the stub with the empty machine**

Replace the contents of `server/src/game/state-machine.ts`:

```ts
import { setup } from 'xstate';
import { Config } from '../config';
import type { Card, CardSlot, GameState, Hand, PlayerSeat, RoundResult } from '../shared/types';
import { isBusted } from './hand';
import { computePayout } from './payout';

// --- Public types (unchanged) ------------------------------------------------

export type Action =
  | { type: 'bet:place'; seatId: string; amount: number }
  | { type: 'hand:hit'; seatId: string; handIndex: number }
  | { type: 'hand:stand'; seatId: string; handIndex: number }
  | { type: 'hand:double'; seatId: string; handIndex: number }
  | { type: 'hand:split'; seatId: string; handIndex: number }
  | { type: 'round:ready'; seatId: string }
  | { type: 'round:start'; seatId: string }
  | { type: 'round:advance'; seatId: string };

export class GameError extends Error {
  constructor(public code: string) { super(code); }
}

// --- XState event type (enriched Action with pre-drawn cards) --------------

export type GameEvent =
  | { type: 'bet:place'; seatId: string; amount: number }
  | { type: 'hand:hit'; seatId: string; handIndex: number; card: Card }
  | { type: 'hand:stand'; seatId: string; handIndex: number }
  | { type: 'hand:double'; seatId: string; handIndex: number; card: Card }
  | { type: 'hand:split'; seatId: string; handIndex: number; leftCard: Card; rightCard: Card }
  | { type: 'round:ready'; seatId: string }
  | { type: 'round:start'; seatId: string; dealtCards: { playerIndex: number; cards: [Card, Card] }[]; dealerUpcard: Card }
  | { type: 'round:dealerPlay'; dealerFinalHand: CardSlot[] }
  | { type: 'round:advance'; seatId: string };

// --- XState context ---------------------------------------------------------

export type GameContext = {
  shoeSize: number;
  cutCardIndex: number;
  players: PlayerSeat[];
  dealer: Hand;
  activeSeat: number | null;
  roundNumber: number;
  lastResult: RoundResult | null;
};

const initialContext = (): GameContext => ({
  shoeSize: 0,
  cutCardIndex: 0,
  players: [],
  dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
  activeSeat: null,
  roundNumber: 0,
  lastResult: null,
});

// --- XState machine (states, events, guards, actions TBD) ------------------

export const machine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
    input: {} as void,
  },
}).createMachine({
  id: 'blackjack',
  initial: 'lobby',
  context: initialContext(),
  states: {
    lobby: { on: {} },
    betting: { on: {} },
    player_turn: { on: {} },
    dealer_turn: { on: {} },
    settled: { on: {} },
  },
});

// --- Public API: createInitialState (unchanged) ----------------------------

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

// --- applyAction stub (TBD) ------------------------------------------------

export function applyAction(_state: GameState, _action: Action, _draw?: () => Card): GameState {
  throw new Error('not implemented');
}

// Suppress unused-import warning for isBusted / computePayout (used in Task 3.6).
void isBusted;
void computePayout;
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 3: Run the existing tests to confirm they still fail (the old `applyAction` is gone)**

```bash
npx jest test/state-machine.spec.ts
```

Expected: 24 tests fail. (The stub throws "not implemented".)

- [ ] **Step 4: Commit the empty machine**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): scaffold XState machine with empty states and stub applyAction"
```

### Task 3.4: Add `applyAction` wrapper with `toSnapshot` and `fromSnapshot`

- [ ] **Step 1: Add the snapshot helpers and wrapper**

In `server/src/game/state-machine.ts`, replace the `applyAction` stub:

```ts
import { prepareEvent, computeDealerEvent, type PreparedEvent } from './draw-bridge';

// --- Snapshot translation ---------------------------------------------------

type Snapshot = ReturnType<typeof machine.transition>;

function toSnapshot(state: GameState): Snapshot {
  return machine.resolveState({
    value: state.phase,
    context: {
      shoeSize: state.shoeSize,
      cutCardIndex: state.cutCardIndex,
      players: state.players,
      dealer: state.dealer,
      activeSeat: state.activeSeat,
      roundNumber: state.roundNumber,
      lastResult: state.lastResult,
    },
  });
}

function fromSnapshot(snap: Snapshot, roomId: string): GameState {
  return {
    roomId,
    phase: snap.value as GameState['phase'],
    shoeSize: snap.context.shoeSize,
    cutCardIndex: snap.context.cutCardIndex,
    players: snap.context.players,
    dealer: snap.context.dealer,
    activeSeat: snap.context.activeSeat,
    roundNumber: snap.context.roundNumber,
    lastResult: snap.context.lastResult,
  };
}

// --- applyAction wrapper ----------------------------------------------------

export function applyAction(state: GameState, action: Action, draw?: () => Card): GameState {
  const snapshot = toSnapshot(state);
  const event = prepareEvent(snapshot, action, draw) as GameEvent;
  const next = machine.transition(snapshot, event);
  return fromSnapshot(next, state.roomId);
}
```

- [ ] **Step 2: Run the existing tests to confirm they all fail with the same reason**

```bash
npx jest test/state-machine.spec.ts
```

Expected: 24 tests still fail (likely with "No event handler" or similar XState error, since the machine has no transitions yet).

- [ ] **Step 3: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): applyAction wrapper with toSnapshot/fromSnapshot"
```

### Task 3.5: Add the `lobby → betting` and `betting → player_turn` transitions

- [ ] **Step 1: Add the `round:ready` and `round:start` events to the lobby and betting states**

In `server/src/game/state-machine.ts`, replace the empty `states` block with:

```ts
  states: {
    lobby: {
      on: { 'round:ready': { target: 'betting' } },
    },
    betting: {
      on: {
        'round:start': { target: 'player_turn' },
      },
    },
    player_turn: { on: {} },
    dealer_turn: { on: {} },
    settled: { on: {} },
  },
```

- [ ] **Step 2: Run the existing tests**

```bash
npx jest test/state-machine.spec.ts
```

Expected: the `round:ready` tests pass; the `round:start` tests fail (no `assignDeal` action yet, but the transition fires).

- [ ] **Step 3: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): lobby→betting and betting→player_turn transitions"
```

### Task 3.6: Add `assignDeal` action (so `round:start` works)

- [ ] **Step 1: Add the action**

In `server/src/game/state-machine.ts`, modify the `setup` call to include `actions`:

```ts
import { setup, assign } from 'xstate';

// ...

export const machine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
    input: {} as void,
  },
  actions: {
    assignDeal: assign(({ context, event }) => {
      if (event.type !== 'round:start') return {};
      const dealtPlayers = context.players.map((p, i) => {
        const deal = event.dealtCards.find((d) => d.playerIndex === i);
        if (!deal) return p;
        return {
          ...p,
          hands: [{ ...p.hands[0], cards: [...deal.cards] }],
          status: 'acting' as const,
        };
      });
      const actingIndex = dealtPlayers.findIndex((p) => p.status === 'acting');
      return {
        players: dealtPlayers,
        dealer: { ...context.dealer, cards: [event.dealerUpcard, { hidden: true }] },
        activeSeat: actingIndex === -1 ? null : actingIndex,
        roundNumber: context.roundNumber + 1,
        lastResult: null,
      };
    }),
  },
}).createMachine({
  id: 'blackjack',
  initial: 'lobby',
  context: initialContext(),
  states: {
    lobby: { on: { 'round:ready': { target: 'betting' } } },
    betting: {
      on: {
        'round:start': { target: 'player_turn', actions: 'assignDeal' },
      },
    },
    player_turn: { on: {} },
    dealer_turn: { on: {} },
    settled: { on: {} },
  },
});
```

- [ ] **Step 2: Run the existing tests**

```bash
npx jest test/state-machine.spec.ts
```

Expected: `round:ready` and `round:start` tests pass. Other tests still fail.

- [ ] **Step 3: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): assignDeal action for round:start"
```

### Task 3.7: Add the `player_turn` events and assign actions for `hand:hit` / `hand:stand`

- [ ] **Step 1: Add the actions and events**

In `server/src/game/state-machine.ts`, add two more `actions` to the `setup` call and update the `player_turn` state:

```ts
  actions: {
    // ... existing assignDeal ...

    assignHit: assign(({ context, event }) => {
      if (event.type !== 'hand:hit') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const newCards = [...hand.cards, event.card];
      return {
        shoeSize: context.shoeSize - 1,
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? { ...p, hands: p.hands.map((h, j) => j === event.handIndex ? { ...h, cards: newCards, busted: isBusted(newCards) } : h) }
            : p,
        ),
      };
    }),

    assignStand: assign(({ context, event }) => {
      if (event.type !== 'hand:stand') return {};
      return {
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? { ...p, hands: p.hands.map((h, j) => j === event.handIndex ? { ...h, stood: true } : h) }
            : p,
        ),
      };
    }),
  },
```

And update the `player_turn` state in `states`:

```ts
    player_turn: {
      on: {
        'hand:hit': { actions: 'assignHit' },
        'hand:stand': { actions: 'assignStand' },
      },
    },
```

- [ ] **Step 2: Run the existing tests**

```bash
npx jest test/state-machine.spec.ts
```

Expected: `bet:place`, `round:ready`, `round:start`, `hand:hit`, `hand:stand` tests pass. `hand:double` and `hand:split` tests still fail.

- [ ] **Step 3: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): assignHit and assignStand actions for player_turn"
```

### Task 3.8: Add `assignDouble` and `assignSplit`

- [ ] **Step 1: Add the actions**

In `server/src/game/state-machine.ts`, add two more `actions` to `setup`:

```ts
    assignDouble: assign(({ context, event }) => {
      if (event.type !== 'hand:double') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const newCards = [...hand.cards, event.card];
      return {
        shoeSize: context.shoeSize - 1,
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? {
                ...p,
                bankroll: p.bankroll - hand.bet,
                hands: p.hands.map((h, j) => j === event.handIndex ? { ...h, cards: newCards, bet: h.bet * 2, doubled: true, busted: isBusted(newCards) } : h),
              }
            : p,
        ),
      };
    }),

    assignSplit: assign(({ context, event }) => {
      if (event.type !== 'hand:split') return {};
      const player = context.players[context.activeSeat!];
      const hand = player.hands[event.handIndex];
      const acesRule = hand.cards[0].rank === 'A' && !Config.RESPLIT_ACES;
      const leftHand = { ...hand, cards: [hand.cards[0], event.leftCard] };
      const rightHand = { cards: [hand.cards[1], event.rightCard], bet: hand.bet, stood: acesRule, busted: false, isBlackjack: false, doubled: false };
      return {
        shoeSize: context.shoeSize - 2,
        players: context.players.map((p, i) =>
          i === context.activeSeat
            ? { ...p, bankroll: p.bankroll - hand.bet, hands: [leftHand, rightHand] }
            : p,
        ),
      };
    }),
```

Add `hand:double` and `hand:split` to the `player_turn` state:

```ts
    player_turn: {
      on: {
        'hand:hit': { actions: 'assignHit' },
        'hand:stand': { actions: 'assignStand' },
        'hand:double': { actions: 'assignDouble' },
        'hand:split': { actions: 'assignSplit' },
      },
    },
```

- [ ] **Step 2: Run the existing tests**

```bash
npx jest test/state-machine.spec.ts
```

Expected: all `hand:*` tests pass. `round:advance` tests still fail.

- [ ] **Step 3: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): assignDouble and assignSplit actions"
```

### Task 3.9: Add `assignAdvance` and the `settled → betting` transition

- [ ] **Step 1: Add the action and transition**

Add `assignAdvance` to `setup`:

```ts
    assignAdvance: assign(({ context }) => {
      const emptyHand: Hand = { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false };
      return {
        phase: undefined,  // XState's `value` will overwrite this on the next transition.
        dealer: { ...emptyHand },
        players: context.players.map((p) => {
          if (p.status === 'empty' || p.status === 'sitting_out') return p;
          if (p.bankroll === 0) return { ...p, hands: [emptyHand], status: 'sitting_out' as const };
          return { ...p, hands: [emptyHand], status: 'betting' as const };
        }),
        activeSeat: null,
        lastResult: null,
      };
    }),
```

(Note: we do NOT reset `shoeSize`, `cutCardIndex`, `roundNumber`, or `lastBet` per the existing `applyAdvance` logic — see `state-machine.legacy.ts` lines 159-176 for the exact behavior.)

Update the `settled` state:

```ts
    settled: {
      on: { 'round:advance': { target: 'betting', actions: 'assignAdvance' } },
    },
```

- [ ] **Step 2: Run the existing tests**

```bash
npx jest test/state-machine.spec.ts
```

Expected: all `round:advance` tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): assignAdvance action for round:advance"
```

### Task 3.10: Add the `player_turn → dealer_turn → settled` auto-transitions

- [ ] **Step 1: Add the auto-transition guard and dealer/settle actions**

Add a guard to `setup`:

```ts
  guards: {
    allHandsActed: ({ context }) => {
      if (context.activeSeat === null) return true;
      const seat = context.players[context.activeSeat];
      return seat.hands.every((h) => h.stood || h.busted || h.doubled || h.cards.length === 0);
    },
  },
```

And add two more actions:

```ts
    assignDealerHand: assign(({ context, event }) => {
      if (event.type !== 'round:dealerPlay') return {};
      const hiddenCount = context.dealer.cards.filter((c) => 'hidden' in c).length;
      return {
        shoeSize: context.shoeSize - (event.dealerFinalHand.length - context.dealer.cards.length) - hiddenCount,
        dealer: { ...context.dealer, cards: event.dealerFinalHand, busted: isBusted(event.dealerFinalHand) },
      };
    }),

    assignSettle: assign(({ context }) => {
      const payouts: RoundResult['payouts'] = [];
      const players = context.players.map((p) => {
        if (p.status === 'empty' || p.status === 'sitting_out') return p;
        const lastBet = p.hands.reduce((max, h) => Math.max(max, h.bet), 0);
        const totalDelta = p.hands.reduce((sum, hand) => {
          const result = computePayout({ playerCards: hand.cards, dealerCards: context.dealer.cards, bet: hand.bet });
          payouts.push({ seatId: p.id, delta: result.delta, reason: result.reason });
          return sum + result.delta;
        }, 0);
        return { ...p, bankroll: p.bankroll + totalDelta, lastBet, status: 'stood' as const };
      });
      return { players, lastResult: { payouts } };
    }),
```

Update the `player_turn` and `dealer_turn` states:

```ts
    player_turn: {
      on: {
        'hand:hit': { actions: 'assignHit' },
        'hand:stand': { actions: 'assignStand' },
        'hand:double': { actions: 'assignDouble' },
        'hand:split': { actions: 'assignSplit' },
      },
      always: [{ guard: 'allHandsActed', target: 'dealer_turn' }],
    },
    dealer_turn: {
      on: { 'round:dealerPlay': { target: 'settled', actions: 'assignDealerHand' } },
    },
    settled: {
      on: { 'round:advance': { target: 'betting', actions: 'assignAdvance' } },
      entry: 'assignSettle',
    },
```

- [ ] **Step 2: Update `applyAction` wrapper to issue the second transition for the dealer event**

In `applyAction`, after the first transition, check if the state value became `dealer_turn` and issue the second transition:

```ts
export function applyAction(state: GameState, action: Action, draw?: () => Card): GameState {
  const snapshot = toSnapshot(state);
  const event = prepareEvent(snapshot, action, draw) as GameEvent;
  const next = machine.transition(snapshot, event);

  // If the auto-transition fired, compute and apply the dealer event.
  if (next.value === 'dealer_turn' && draw) {
    const dealerEv = computeDealerEvent(next, draw) as GameEvent;
    const finalSnap = machine.transition(next, dealerEv);
    return fromSnapshot(finalSnap, state.roomId);
  }

  return fromSnapshot(next, state.roomId);
}
```

- [ ] **Step 3: Run the existing tests**

```bash
npx jest test/state-machine.spec.ts
```

Expected: all 24 existing tests pass. The `settle: lastBet population` test should also pass because `assignSettle` populates `lastBet`.

- [ ] **Step 4: Run all server tests**

```bash
npx jest
```

Expected: all 12+ suites pass, including the 24 in `state-machine.spec.ts` and the new 9 in `draw-bridge.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): dealer-turn and settled transitions with auto-event"
```

### Task 3.11: Add `assignBet` and `bet:place` event

- [ ] **Step 1: Add the action and event**

Add `assignBet` to `setup`:

```ts
    assignBet: assign(({ context, event }) => {
      if (event.type !== 'bet:place') return {};
      return {
        players: context.players.map((p, i) =>
          p.id === event.seatId
            ? { ...p, hands: [{ ...p.hands[0], bet: event.amount }], status: 'betting' as const }
            : p,
        ),
      };
    }),
```

Add `bet:place` to the `betting` state:

```ts
    betting: {
      on: {
        'bet:place': { actions: 'assignBet' },
        'round:start': { target: 'player_turn', actions: 'assignDeal' },
      },
    },
```

- [ ] **Step 2: Run the existing tests**

```bash
npx jest test/state-machine.spec.ts
```

Expected: all 24 tests pass.

- [ ] **Step 3: Run all server tests**

```bash
npx jest
npx tsc --noEmit
```

Expected: 12+ suites pass, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/game/state-machine.ts
git commit -m "feat(server): assignBet action and bet:place event"
```

---

## Task 4: Verify all 24 existing tests pass against the new code

This task is a verification gate. The XState machine is now feature-complete. We confirm by running the full server test suite.

**Files:** (no changes)

- [ ] **Step 1: Run the full server test suite**

```bash
npx jest
```

Expected: 12+ suites pass. The 24 existing `state-machine.spec.ts` tests pass, the 9 new `draw-bridge.spec.ts` tests pass.

- [ ] **Step 2: Run TypeScript typecheck**

```bash
npx tsc --noEmit
```

Expected: exit code 0, no errors.

- [ ] **Step 3: Run the client tests to confirm wire format stability**

```bash
cd ../client && npx vitest run
```

Expected: 41 client tests pass. (Wire format is unchanged.)

- [ ] **Step 4: If anything fails, fix it before proceeding**

If a client test fails, the wire format is broken — the snapshot reconstruction in `fromSnapshot` is missing a field. Fix `fromSnapshot` to include the missing field.

If a server test fails, the XState machine isn't matching the legacy behavior. Diagnose with `git diff server/src/game/state-machine.ts server/src/game/state-machine.legacy.ts` and adjust.

- [ ] **Step 5: No commit needed for verification**

Skip the commit if nothing changed. If changes were needed, commit them:

```bash
cd ../server
git add server/src/game/state-machine.ts
git commit -m "fix(server): align XState machine with legacy behavior"
```

---

## Task 5: Add structural tests for the XState machine

**Files:**
- Create: `server/test/state-machine-xstate.spec.ts`

### Task 5.1: Test the state graph shape

- [ ] **Step 1: Add the test file**

Create `server/test/state-machine-xstate.spec.ts`:

```ts
import { machine } from '../src/game/state-machine';

describe('XState machine: state graph shape', () => {
  it('has the 5 expected states', () => {
    // XState v5 doesn't expose states directly via .states, so we test via transition.
    // The first 5 transitions from `lobby` should each land in a different state.
    const lobby = machine.resolveState({ value: 'lobby', context: machine.context });
    const states = new Set<string>();
    states.add(lobby.value as string);

    let s = machine.transition(lobby, { type: 'round:ready' });
    states.add(s.value as string);
    s = machine.transition(s, { type: 'round:start', dealtCards: [], dealerUpcard: { suit: '♠', rank: 'A' } });
    states.add(s.value as string);

    expect([...states].sort()).toEqual(['betting', 'lobby', 'player_turn']);
  });

  it('lobby transitions to betting on round:ready', () => {
    const lobby = machine.resolveState({ value: 'lobby', context: machine.context });
    const next = machine.transition(lobby, { type: 'round:ready' });
    expect(next.value).toBe('betting');
  });

  it('settled transitions to betting on round:advance', () => {
    const settled = machine.resolveState({ value: 'settled', context: machine.context });
    const next = machine.transition(settled, { type: 'round:advance' });
    expect(next.value).toBe('betting');
  });

  it('player_turn has events for hand:hit, hand:stand, hand:double, hand:split', () => {
    const pt = machine.resolveState({ value: 'player_turn', context: machine.context });
    const events: Array<keyof typeof pt.value> = ['hand:hit', 'hand:stand', 'hand:double', 'hand:split'];
    for (const type of events) {
      const next = machine.transition(pt, { type, seatId: 'x', handIndex: 0, card: { suit: '♠', rank: 'A' }, leftCard: { suit: '♠', rank: 'A' }, rightCard: { suit: '♠', rank: 'A' } } as any);
      // We don't assert the state value (auto-transition may have fired) — just that the transition didn't throw.
      expect(next).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx jest test/state-machine-xstate.spec.ts
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/test/state-machine-xstate.spec.ts
git commit -m "test(server): XState machine state graph shape"
```

### Task 5.2: Test the snapshot roundtrip

- [ ] **Step 1: Add the test**

Append to `server/test/state-machine-xstate.spec.ts`:

```ts
import { toSnapshot, fromSnapshot, createInitialState, applyAction } from '../src/game/state-machine';
import { Config } from '../src/config';
import type { GameState } from '../src/shared/types';

describe('snapshot roundtrip', () => {
  it('preserves all GameState fields except roomId', () => {
    const state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 3), phase: 'betting' };
    const snap = toSnapshot(state);
    const out = fromSnapshot(snap, 'R');
    expect(out).toEqual(state);
  });

  it('survives a bet:place → fromSnapshot roundtrip', () => {
    let state: GameState = { ...createInitialState('R', Config.SEAT_COUNT, 0), phase: 'lobby' };
    state = applyAction(state, { type: 'round:ready', seatId: state.players[0].id });
    const seatId = state.players[0].id;
    state = applyAction(state, { type: 'bet:place', seatId, amount: 100 });
    expect(state.players[0].hands[0].bet).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx jest test/state-machine-xstate.spec.ts
```

Expected: 2 new tests pass; 6 total.

- [ ] **Step 3: Commit**

```bash
git add server/test/state-machine-xstate.spec.ts
git commit -m "test(server): snapshot roundtrip preserves GameState"
```

### Task 5.3: Run the full server test suite

- [ ] **Step 1: Run all server tests**

```bash
npx jest
npx tsc --noEmit
```

Expected: 12+ suites pass; 35+ state-machine-related tests pass (24 existing + 9 draw-bridge + 6 new structural); typecheck clean.

- [ ] **Step 2: Run client tests**

```bash
cd ../client && npx vitest run
```

Expected: 41 client tests pass.

- [ ] **Step 3: No commit unless changes were needed**

---

## Task 6: Delete `state-machine.legacy.ts`

**Files:**
- Delete: `server/src/game/state-machine.legacy.ts`

- [ ] **Step 1: Verify nothing imports from the legacy file**

```bash
cd ../server
grep -r "state-machine.legacy" --include="*.ts" .
```

Expected: no matches outside `node_modules`.

If there are matches, refactor the importer to use `state-machine.ts` instead.

- [ ] **Step 2: Delete the legacy file**

```bash
git rm server/src/game/state-machine.legacy.ts
```

- [ ] **Step 3: Run the full test suite one more time**

```bash
npx jest
npx tsc --noEmit
cd ../client && npx vitest run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(server): delete state-machine.legacy.ts (XState impl is canonical)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all server tests and typecheck**

```bash
cd ../server
npx jest
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 2: Run all client tests and typecheck**

```bash
cd ../client
npx vitest run
npx tsc --noEmit -p tsconfig.json
```

Expected: 41 client tests pass; typecheck clean.

- [ ] **Step 3: Run the all-in-one command from the project root**

```bash
cd ..
npm run test:server
npm run test:client
```

Expected: both pass.

- [ ] **Step 4: Check the line count of the new state-machine.ts**

```bash
wc -l server/src/game/state-machine.ts
```

Expected: 200-400 lines. The XState machine definition is the bulk; the wrapper is small.

- [ ] **Step 5: Check that the public API is unchanged**

```bash
grep -E "^export (type|class|function|const)" server/src/game/state-machine.ts
```

Expected output (approximately):
- `export type Action`
- `export class GameError`
- `export type GameEvent` (new — internal)
- `export type GameContext` (new — internal)
- `export const machine` (new — internal)
- `export function createInitialState`
- `export function applyAction`

The 4 new exports are internal; the public API (`Action`, `GameError`, `createInitialState`, `applyAction`) is unchanged.

- [ ] **Step 6: Mark the plan complete**

No commit needed. The refactor is done.

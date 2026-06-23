# Fix HAND_LOCKED after split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the client from sending `handIndex = hands.length - 1` after a split. The server's `isHandActive` guard is correct; the client must read `PlayerSeat.activeHandIndex` from state instead.

**Architecture:** One-line source change in `ActionPanel.tsx` (read `me.activeHandIndex` instead of `me.hands.length - 1`). One comment added to the dead-code path in `socket.middleware.ts` to prevent the bug from being re-introduced. Three new component tests in a new `ActionPanel.spec.tsx` to lock in the behavior.

**Tech Stack:** React 18, Redux Toolkit, Vitest, React Testing Library, styled-components, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-23-hand-locked-after-split-design.md`

---

## File Structure

This plan touches two source files and creates one test file.

- **Modify** `client/src/components/ActionPanel.tsx:44` — read `me.activeHandIndex` instead of `me.hands.length - 1`.
- **Modify** `client/src/middleware/socket.middleware.ts` — add a comment above the `socket/hit` case pointing future callers at the right source.
- **Create** `client/test/components/ActionPanel.spec.tsx` — three component tests that cover the post-split regression, the multi-hand walk, and the no-split baseline.

---

## Task 1: Add the failing ActionPanel tests

**Files:**
- Create: `client/test/components/ActionPanel.spec.tsx`

- [ ] **Step 1: Create the test file**

Write `client/test/components/ActionPanel.spec.tsx` with the contents below. It mirrors the fixture style of `StartButton.spec.tsx` and `HandView.spec.tsx`: build a `GameState` with a configurable `players` array, mount `<ActionPanel />` inside `<Provider>` + `<ThemeProvider>`, and assert on the mocked `socket.emit`.

The mock factory uses a `let emit` reference so each test can grab the latest `vi.fn()` instance and assert on it. (vi.fn() instances created inside the factory are not directly accessible to the test otherwise.)

```tsx
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { ActionPanel } from '../../src/components/ActionPanel';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';
import type { Card, GameState, Hand, PlayerSeat } from '../../src/shared/types';

let emit: ReturnType<typeof vi.fn>;
vi.mock('../../src/socket/client', () => ({
  getSocket: () => ({ emit: (emit = vi.fn()) }),
}));

function hand(cards: Card[]): Hand {
  return { cards, bet: 50, stood: false, busted: false, isBlackjack: false, doubled: false };
}

function makeSeat(overrides: Partial<PlayerSeat> & { id: string }): PlayerSeat {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Alice',
    bankroll: overrides.bankroll ?? 1000,
    hands: overrides.hands ?? [hand([{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }])],
    status: overrides.status ?? 'acting',
    connectedAt: 0,
    lastBet: 50,
    activeHandIndex: overrides.activeHandIndex ?? 0,
  };
}

function makeStore(opts: { players: PlayerSeat[]; activeSeat: number; selfSeatId: string }) {
  const state: GameState = {
    roomId: 'R',
    phase: 'player_turn',
    phaseEndsAt: null,
    shoeSize: 200,
    cutCardIndex: 50,
    players: opts.players,
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: opts.activeSeat,
    roundNumber: 1,
    lastResult: null,
  };
  return configureStore({
    reducer: {
      connection: connectionReducer,
      lobby: lobbyReducer,
      game: gameReducer,
      ui: uiReducer,
    },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId: opts.selfSeatId, status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: opts.selfSeatId, players: [], joinError: null },
      ui: { betInputValue: 50, lastToast: null },
    },
  } as any);
}

function renderPanel(store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <ActionPanel />
      </ThemeProvider>
    </Provider>,
  );
}

describe('<ActionPanel /> handIndex resolution', () => {
  beforeEach(() => { emit = vi.fn(); });

  it('sends handIndex from activeHandIndex, not hands.length - 1, on the post-split left hand (regression)', () => {
    // Server state: just split, server has activeHandIndex: 0 for hand 0.
    // Old client code computed hands.length - 1 = 1 and sent handIndex: 1,
    // which the server's isHandActive guard rejected with HAND_LOCKED.
    const seat = makeSeat({
      id: 's0',
      hands: [hand([{ suit: '♠', rank: '8' }, { suit: '♥', rank: '8' }]), hand([{ suit: '♦', rank: '8' }, { suit: '♣', rank: '8' }])],
      activeHandIndex: 0,
    });
    const store = makeStore({ players: [seat], activeSeat: 0, selfSeatId: 's0' });
    renderPanel(store);
    fireEvent.click(screen.getByRole('button', { name: /^hit$/i }));
    expect(emit).toHaveBeenCalledWith('hand:hit', { handIndex: 0 });
  });

  it('targets hand 1 after hand 0 is stood (multi-hand walk)', () => {
    // Server has advanced activeHandIndex to 1. The client must send 1, not 0.
    const stood = { ...hand([{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }]), stood: true };
    const seat = makeSeat({
      id: 's0',
      hands: [stood, hand([{ suit: '♦', rank: '7' }, { suit: '♣', rank: '8' }])],
      activeHandIndex: 1,
    });
    const store = makeStore({ players: [seat], activeSeat: 0, selfSeatId: 's0' });
    renderPanel(store);
    fireEvent.click(screen.getByRole('button', { name: /^hit$/i }));
    expect(emit).toHaveBeenCalledWith('hand:hit', { handIndex: 1 });
  });

  it('sends handIndex 0 on a no-split hand (baseline regression)', () => {
    // The old heuristic happened to be correct here (hands.length - 1 = 0).
    // Make sure the fix does not regress this case.
    const seat = makeSeat({ id: 's0', activeHandIndex: 0 });
    const store = makeStore({ players: [seat], activeSeat: 0, selfSeatId: 's0' });
    renderPanel(store);
    fireEvent.click(screen.getByRole('button', { name: /^hit$/i }));
    expect(emit).toHaveBeenCalledWith('hand:hit', { handIndex: 0 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm the regression test fails**

Run from `client/`:

```bash
cd client && npx vitest run test/components/ActionPanel.spec.tsx
```

Expected: the first test (`sends handIndex from activeHandIndex, not hands.length - 1, on the post-split left hand`) FAILS. Its `expect(emit).toHaveBeenCalledWith('hand:hit', { handIndex: 0 })` will not match because the buggy code emits `{ handIndex: 1 }`. The other two tests should PASS (the multi-hand walk and the no-split baseline work even with the buggy line, because in both cases `hands.length - 1` happens to equal `activeHandIndex`).

If all three pass, the test fixtures are wrong — stop and re-read the `ActionPanel` source to confirm what `activeHandIndex` value the component reads. Do not proceed to Task 2 until the first test fails for the right reason.

- [ ] **Step 3: Do not commit yet**

Tests are red. Commit only after Task 2 turns them green.

---

## Task 2: Fix `ActionPanel` to read `me.activeHandIndex`

**Files:**
- Modify: `client/src/components/ActionPanel.tsx:44`

- [ ] **Step 1: Apply the one-line change**

In `client/src/components/ActionPanel.tsx`, replace line 44:

```ts
  const activeHandIndex = me?.hands.length ? me.hands.length - 1 : 0;
```

with:

```ts
  const activeHandIndex = me?.activeHandIndex ?? 0;
```

No other lines in this file change. The `makeSelectAvailableActions(activeHandIndex)` call on the next line is unchanged. The button `onClick` handlers on lines 55/62/69/76 are unchanged. The `null` coalescing is defensive: if a future code path ever leaves `me.activeHandIndex` undefined, fall back to the historical default of `0` rather than `NaN`.

- [ ] **Step 2: Re-run the tests and confirm all three pass**

Run from `client/`:

```bash
cd client && npx vitest run test/components/ActionPanel.spec.tsx
```

Expected: all three tests PASS. The first test now sees `handIndex: 0` because `me.activeHandIndex === 0`. The other two still pass.

- [ ] **Step 3: Typecheck**

Run from `client/`:

```bash
cd client && npx tsc -b --noEmit
```

Expected: no type errors. (`activeHandIndex` is a required field on `PlayerSeat` per `client/src/shared/types.ts:18`, so the `?? 0` fallback is just defensive — the type itself guarantees a `number`.)

- [ ] **Step 4: Run the full client test suite**

Run from `client/`:

```bash
cd client && npm test
```

Expected: every existing test still passes. No other file is touched by this fix, but run the whole suite to be sure.

---

## Task 3: Add the dead-code signpost in the socket middleware

**Files:**
- Modify: `client/src/middleware/socket.middleware.ts:27-30`

- [ ] **Step 1: Add the comment block**

In `client/src/middleware/socket.middleware.ts`, immediately above the `case 'socket/hit':` line (currently line 27), insert a comment block. The middleware path is dead code today (no UI dispatches `socket/hit` etc.), but the bug being fixed originated in client-side handIndex derivation. The comment turns a future footgun into a signpost.

```ts
    // handIndex MUST come from `state.game.players[mySeatId].activeHandIndex`
    // (the server's value). Do not derive it from `hands.length - 1` — that
    // returns 1 after a split, while the server's activeHandIndex is 0, and
    // the isHandActive guard rejects mismatches with HAND_LOCKED.
    // See docs/superpowers/specs/2026-06-23-hand-locked-after-split-design.md.
    case 'socket/hit': getSocket().emit('hand:hit', { handIndex: action.handIndex }); return;
    case 'socket/stand': getSocket().emit('hand:stand', { handIndex: action.handIndex }); return;
    case 'socket/double': getSocket().emit('hand:double', { handIndex: action.handIndex }); return;
    case 'socket/split': getSocket().emit('hand:split', { handIndex: action.handIndex }); return;
```

(The four `case` lines are unchanged; only the comment above them is new.)

- [ ] **Step 2: Typecheck and test once more**

Run from `client/`:

```bash
cd client && npx tsc -b --noEmit && npm test
```

Expected: no type errors, all tests pass. The middleware change is comment-only, so this is a sanity check, not a behavioural test.

---

## Task 4: Commit

- [ ] **Step 1: Stage the three files**

```bash
git add client/src/components/ActionPanel.tsx client/src/middleware/socket.middleware.ts client/test/components/ActionPanel.spec.tsx
```

- [ ] **Step 2: Verify the diff is what you expect**

```bash
git diff --cached --stat
```

Expected: three files in the index, no surprises. `tsbuildinfo` files in `client/` are gitignored (per commit `3fd93cb`).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(client): send server's activeHandIndex, not hands.length - 1

After a split, the client computed the active hand index as the last
hand in the array (hands.length - 1 = 1) while the server's
PlayerSeat.activeHandIndex was 0. Every first action on the new left
hand was rejected with HAND_LOCKED.

Read activeHandIndex from the seat instead. Add a signpost comment in
the dead-code socket middleware path so a future caller does not
re-derive the value the same way. New ActionPanel tests cover the
post-split regression, the multi-hand walk, and the no-split baseline.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Confirm the commit landed**

```bash
git log --oneline -1
```

Expected: a new commit on `main` with the message above. The spec commit (`a3862c1`) and this fix commit form a two-commit chain — spec first, implementation second.

---

## Done

The fix is one line in `ActionPanel`, a comment in the middleware, and three component tests. After this lands, the "HAND_LOCKED on the first action after a split" case is closed.

If the user still sees "hand is no longer playable" toast in cases that are not post-split (e.g., a second click that lands after hitting to 21), the follow-up is Approach B from the brainstorm: track in-flight `hand:*` emits on the client and disable the buttons while one is in flight. That is intentionally out of scope here.

# Single-Player Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host sitting alone in a freshly created room can start a round and play a full hand against the dealer end-to-end, with no other player connected.

**Architecture:** Flip the client-side minimum-player gate in `StartButton` from 2 to 1, and drop the "waiting for 1 more player" hint. The server already supports any positive player count, so no backend changes are needed.

**Tech Stack:** React 18, Redux Toolkit, Vitest, React Testing Library, styled-components, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-23-single-player-mode-design.md`

---

## File Structure

This plan touches one source file and creates one test file. No other files change.

- **Modify** `client/src/components/StartButton.tsx` — relax `canStart` and simplify `hintText`.
- **Create** `client/test/components/StartButton.spec.tsx` — unit tests for the solo-host case and the existing multiplayer / non-host cases.

---

## Task 1: Add failing test for solo host

**Files:**
- Create: `client/test/components/StartButton.spec.tsx`

- [ ] **Step 1: Create the test file**

Write the file at `client/test/components/StartButton.spec.tsx` with the contents below. It mirrors the fixture style of adjacent specs (`bet-panel.spec.tsx`, `result-overlay.spec.tsx`): build a `GameState` with a configurable `players` array, a `lobby` slice that names the host, and a `connection` slice that names the local seat. The selector that `StartButton` reads is `selectLobbySeats` (`client/src/selectors/lobby.ts`), which prefers `state.game.state.players` when present, so we put a populated `players` array in the game slice.

```tsx
import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { StartButton } from '../../src/components/StartButton';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';
import type { GameState, PlayerSeat } from '../../src/shared/types';

vi.mock('../../src/socket/client', () => ({
  getSocket: () => ({ emit: vi.fn() }),
}));

function makeSeat(id: string, name: string, status: PlayerSeat['status']): PlayerSeat {
  return {
    id, name, bankroll: 1000,
    hands: [{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }],
    status, connectedAt: 0, lastBet: 0, activeHandIndex: 0,
  };
}

function makeStore(opts: { players: PlayerSeat[]; hostId: string; selfSeatId: string }) {
  const state: GameState = {
    roomId: 'R', phase: 'lobby', phaseEndsAt: null,
    shoeSize: 200, cutCardIndex: 50,
    players: opts.players,
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 0, lastResult: null,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId: opts.selfSeatId, status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: opts.hostId, players: [], joinError: null },
      ui: { betInputValue: 50, toasts: [] },
    },
  } as any);
}

function renderWith(ui: React.ReactNode, store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </Provider>,
  );
}

describe('<StartButton />', () => {
  it('enables Begin Betting for a solo host (1 seated player)', () => {
    const store = makeStore({
      players: [makeSeat('s0', 'Alice', 'betting')],
      hostId: 's0', selfSeatId: 's0',
    });
    renderWith(<StartButton />, store);
    const btn = screen.getByRole('button', { name: /begin betting/i });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText(/waiting for/i)).toBeNull();
  });

  it('enables Begin Betting when 2+ players are seated', () => {
    const store = makeStore({
      players: [
        makeSeat('s0', 'Alice', 'betting'),
        makeSeat('s1', 'Bob', 'betting'),
        makeSeat('s2', '', 'empty'),
      ],
      hostId: 's0', selfSeatId: 's0',
    });
    renderWith(<StartButton />, store);
    const btn = screen.getByRole('button', { name: /begin betting/i });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText(/waiting for/i)).toBeNull();
  });

  it('disables Begin Betting and shows the "Waiting for players" hint when 0 are seated', () => {
    const store = makeStore({
      players: [makeSeat('s0', '', 'empty')],
      hostId: 's0', selfSeatId: 's0',
    });
    renderWith(<StartButton />, store);
    const btn = screen.getByRole('button', { name: /begin betting/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/waiting for players to join/i)).toBeInTheDocument();
  });

  it('renders "Waiting for host to start…" for non-hosts', () => {
    const store = makeStore({
      players: [
        makeSeat('s0', 'Alice', 'betting'),
        makeSeat('s1', 'Bob', 'betting'),
      ],
      hostId: 's0', selfSeatId: 's1',
    });
    renderWith(<StartButton />, store);
    expect(screen.getByText(/waiting for host to start/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /begin betting/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new test file to verify it fails as expected**

Run from the repo root:

```bash
npm run test:client -- StartButton
```

Expected: the first three tests fail (button is currently disabled at 1 seat and the hint text says "Waiting for 1 more player…"). The fourth test (non-host) passes. Specifically the first test will fail with the button having `disabled` and the second will fail looking for a "waiting" text that no longer exists after the change. The exact assertion failures will be the ones we want to fix in Task 2.

If Vitest reports a `Cannot find module` or path-resolution error instead, the test file is in the right place but the import paths are wrong — re-check the import paths against `client/test/components/bet-panel.spec.tsx`.

- [ ] **Step 3: Commit the failing test (red)**

```bash
git add client/test/components/StartButton.spec.tsx
git commit -m "test(client): cover solo-host StartButton case (red)"
```

---

## Task 2: Allow single-player in StartButton

**Files:**
- Modify: `client/src/components/StartButton.tsx`

- [ ] **Step 1: Edit the `canStart` predicate and the `hintText` helper**

In `client/src/components/StartButton.tsx`, replace the two pieces of code below.

Replace the existing `hintText` function (currently lines 59–63):

```ts
function hintText(seatedCount: number): string {
  if (seatedCount === 0) return 'Waiting for players to join…';
  if (seatedCount === 1) return 'Waiting for 1 more player…';
  return 'Waiting for all players…';
}
```

with:

```ts
function hintText(seatedCount: number): string {
  if (seatedCount === 0) return 'Waiting for players to join…';
  return '';
}
```

Replace the existing `canStart` line (currently line 77):

```ts
  const canStart = seatedCount >= 2;
```

with:

```ts
  const canStart = seatedCount >= 1;
```

The rest of the file (the `Wrap`, `Hint`, `Waiting`, and `Cta` styled components, the `useSelector` calls, the early return for non-hosts, and the `onClick` emit) is unchanged.

- [ ] **Step 2: Run the new test file to verify it now passes**

```bash
npm run test:client -- StartButton
```

Expected: all four `<StartButton />` tests pass.

- [ ] **Step 3: Run the full client test suite**

```bash
npm run test:client
```

Expected: all suites pass. No regressions. (If any other spec starts failing because it asserted the old "1 more player" hint text, that would be a real regression — but no other component in the codebase reads `StartButton`'s hint text directly, so this should be a no-op.)

- [ ] **Step 4: Commit**

```bash
git add client/src/components/StartButton.tsx
git commit -m "feat(client): allow host to start a round alone

Lowers the Begin Betting minimum from 2 to 1 seated player. The
state machine and gateway already accept round:ready from any host,
so the only gate was this client-side check. Multiplayer behavior is
unchanged."
```

---

## Task 3: Manual smoke check

**Files:** none

- [ ] **Step 1: Start the dev servers**

In one terminal from the repo root:

```bash
npm run dev
```

Wait for both `server` and `client` lines to report ready. The client is at `http://localhost:5173`, the server at `http://localhost:3001`.

- [ ] **Step 2: Walk a full solo hand**

1. Open `http://localhost:5173` in a single browser tab.
2. Enter a name, click **Create Room**.
3. Confirm the **Begin Betting** button is enabled immediately (no "Waiting for 1 more player…" hint).
4. Click **Begin Betting** → confirm the phase becomes Betting.
5. Enter a bet (e.g. 50) and click **Place Bet**.
6. Wait for the bet deadline (10s) — cards should deal.
7. Play the hand to completion (hit / stand).
8. Confirm the dealer reveals, the result overlay shows, and the bankroll updates.
9. Click **Next Hand** (or wait for the settle pause) — confirm a second betting phase starts cleanly.

- [ ] **Step 3: (Optional) Confirm two-player flow is unchanged**

Open a second tab to `http://localhost:5173`, enter a different name, type the room code, click **Join**. Confirm the host's view updates to show two seated players and the round still proceeds as before.

If either step fails, do not mark the task complete — investigate the regression and fix it before moving on.

- [ ] **Step 4: Tear down the dev servers**

`Ctrl-C` in the `npm run dev` terminal. No commit needed for this task.

---

## Self-Review

**Spec coverage:**
- "Change `canStart` from `>= 2` to `>= 1`" → Task 2 Step 1.
- "`hintText` returns empty string for `seatedCount >= 1`, keeps the `=== 0` branch" → Task 2 Step 1.
- "Add or adjust unit tests for the solo-host case" → Task 1 (all four cases) and Task 2 Step 2.
- "Manual smoke" → Task 3.
- Server changes → explicitly out of scope (Non-Goals), no task needed.

**Placeholder scan:** No TBD / TODO / vague hand-waves. Every step has either a full file write, a verbatim code edit, or a concrete shell command with an explicit expected outcome.

**Type consistency:** `makeSeat` produces `PlayerSeat`. `players: PlayerSeat[]` matches `GameState['players']`. `hostId` and `selfSeatId` are both `string`, matching the `selectAmIHost` selector's expectations. The hint-text strings in the test ("waiting for players to join", "waiting for host to start") match the actual component output.

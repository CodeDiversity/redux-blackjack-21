# Animation tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slow the card deal and dealer-reveal animations by ~25–67% (per-value), pull the hard-coded timings into a single named-exports file, and bump the server's `DEALING_DURATION_MS` to keep the server-client timing coupling in sync.

**Architecture:** New `client/src/lib/animation-timings.ts` exports 4 named constants + 1 helper. `HandView.tsx` imports them (5 line replacements). Server `Config.DEALING_DURATION_MS` bumps to 2_000. Two test files get mechanical numeric updates. No new patterns, no new dependencies.

**Tech Stack:** Existing stack — React + Redux Toolkit + framer-motion + styled-components (client), NestJS + Socket.io + xstate (server), Vitest (client unit), Jest (server), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-06-17-animation-tuning-design.md`

---

## File map

**Created**
- `client/src/lib/animation-timings.ts` — 4 named exports + 1 helper (`dealPositionToStartDelayMs`)

**Modified**
- `client/src/components/HandView.tsx` — 1 new import block, 4 line replacements
- `server/src/config.ts` — `DEALING_DURATION_MS: 1_500 → 2_000` + comment
- `client/test/components/HandView.spec.tsx` — 2 numeric literals in 1 test
- `client/e2e/animations.spec.ts` — 2 timeout values

---

## Task 1: Create the new constants file

**Files:**
- Create: `client/src/lib/animation-timings.ts`

- [ ] **Step 1: Create the file**

Create `client/src/lib/animation-timings.ts` with this exact content:

```ts
/**
 * Animation timings for the card deal and dealer reveal.
 *
 * These values are global — every player sees the same animation. To retune,
 * edit the numbers here and save.
 *
 * The server's `Config.DEALING_DURATION_MS` must be >= the longest possible
 * client deal animation: `(nonEmptyPlayerCount + 1) * DEAL_CARD_INTERVAL_MS + CARD_ENTRY_DURATION_S`.
 * Both constants are cross-referenced in comments; update them together.
 *
 * `prefers-reduced-motion: reduce` short-circuits all of these
 * (see `usePrefersReducedMotion` and the `<MotionConfig reducedMotion="user">`
 * wrapper in `TableView`).
 */

/** How long each card takes to scale in during the initial deal. */
export const DEAL_CARD_INTERVAL_MS = 250;

/** How long each dealer card takes to flip in during the dealer reveal. */
export const DEALER_REVEAL_CARD_INTERVAL_MS = 500;

/** Per-card entry transition (the scale 0→1 framer-motion tween). */
export const CARD_ENTRY_DURATION_S = 0.25;

/** 3D rotateY duration for the dealer's hole card flip on reveal. */
export const HOLE_CARD_FLIP_DURATION_S = 0.6;

/**
 * Round-robin stagger: the Nth non-empty seat starts dealing `pos * interval`
 * ms after the first. Dealer is `pos = nonEmptyPlayerCount`.
 */
export function dealPositionToStartDelayMs(dealPosition: number): number {
  return dealPosition * DEAL_CARD_INTERVAL_MS;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build -w client`
Expected: succeeds. The new file isn't imported anywhere yet, so this just confirms the file is well-formed.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/animation-timings.ts
git commit -m "feat(client): add animation-timings constants module"
```

---

## Task 2: Update HandView to use the new constants

**Files:**
- Modify: `client/src/components/HandView.tsx`

- [ ] **Step 1: Add the imports**

In `client/src/components/HandView.tsx`, after the existing `useStaggeredReveal` import (around line 10), add:

```ts
import {
  DEAL_CARD_INTERVAL_MS,
  DEALER_REVEAL_CARD_INTERVAL_MS,
  CARD_ENTRY_DURATION_S,
  HOLE_CARD_FLIP_DURATION_S,
  dealPositionToStartDelayMs,
} from '../lib/animation-timings';
```

- [ ] **Step 2: Replace the 4 hard-coded values**

In the same file, make 4 replacements:

**Replacement A** — find this call (around line 130):

```ts
  const dealVisible = useStaggeredReveal(
    hand.cards.length,
    `${roundNumber ?? 'init'}:deal:${handKey}`,
    150,
    { initialCount: 0, enabled: isNewRound, startDelayMs: dealPosition * 150 },
  );
```

Replace with:

```ts
  const dealVisible = useStaggeredReveal(
    hand.cards.length,
    `${roundNumber ?? 'init'}:deal:${handKey}`,
    DEAL_CARD_INTERVAL_MS,
    { initialCount: 0, enabled: isNewRound, startDelayMs: dealPositionToStartDelayMs(dealPosition) },
  );
```

**Replacement B** — find this call (around line 138):

```ts
  const revealVisible = useStaggeredReveal(
    hand.cards.length,
    `${roundNumber ?? 'init'}:reveal:${handKey}`,
    400,
    { initialCount: 1, enabled: isDealer ? isNewRound : false },
  );
```

Replace with:

```ts
  const revealVisible = useStaggeredReveal(
    hand.cards.length,
    `${roundNumber ?? 'init'}:reveal:${handKey}`,
    DEALER_REVEAL_CARD_INTERVAL_MS,
    { initialCount: 1, enabled: isDealer ? isNewRound : false },
  );
```

**Replacement C** — find this line (around line 174):

```tsx
                transition={{ duration: isHole && !holeHidden ? 0.5 : 0.18, ease: 'easeOut' }}
```

Replace with:

```tsx
                transition={{ duration: isHole && !holeHidden ? HOLE_CARD_FLIP_DURATION_S : CARD_ENTRY_DURATION_S, ease: 'easeOut' }}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build -w client`
Expected: succeeds.

- [ ] **Step 4: Run the HandView component tests, expect the "renders cards progressively" test to fail**

Run: `cd client && npx vitest run test/components/HandView.spec.tsx`
Expected: 4 of 5 tests pass. The "renders cards progressively when lastSeenRoundNumber < roundNumber" test fails because it advances the timer by 150ms but the hook now uses 250ms intervals. The exact error will be: card count is 0 (instead of 1) after `vi.advanceTimersByTime(150)`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/HandView.tsx
git commit -m "refactor(client): use animation-timings constants in HandView"
```

---

## Task 3: Bump the server's `DEALING_DURATION_MS`

**Files:**
- Modify: `server/src/config.ts`

- [ ] **Step 1: Bump the value**

In `server/src/config.ts`, find the `DEALING_DURATION_MS` line:

```ts
  DEALING_DURATION_MS: 1_500,  // NEW — how long the client animates the initial deal
```

Replace with:

```ts
  DEALING_DURATION_MS: 2_000,  // CHANGED from 1_500. Must be >= the longest possible client deal animation: (nonEmptyPlayerCount + 1) * client DEAL_CARD_INTERVAL_MS + CARD_ENTRY_DURATION_S. See client/src/lib/animation-timings.ts.
```

- [ ] **Step 2: Verify the server build**

Run: `npm run build -w server`
Expected: succeeds.

- [ ] **Step 3: Run the full server test suite**

Run: `npm run test:server`
Expected: all tests pass. The state-machine tests don't reference `DEALING_DURATION_MS`. The gateway auto-advance test asserts `phaseEndsAt <= Date.now() + Config.BET_DEADLINE_MS + 100` — that test uses `BET_DEADLINE_MS` (10_000), not `DEALING_DURATION_MS`, so it's unaffected. The new dealing-phase test (added in the previous plan) asserts the deal broadcast has `phaseEndsAt` within `Config.DEALING_DURATION_MS + 100`; with the new 2_000ms value, the assertion holds.

- [ ] **Step 4: Commit**

```bash
git add server/src/config.ts
git commit -m "feat(server): bump DEALING_DURATION_MS to 2_000ms"
```

---

## Task 4: Update the HandView component test to use the new 250ms interval

**Files:**
- Modify: `client/test/components/HandView.spec.tsx`

- [ ] **Step 1: Update the two timer-advance literals**

In `client/test/components/HandView.spec.tsx`, find this test (the second case in the `<HandView> animations` describe block):

```ts
  it('renders cards progressively when lastSeenRoundNumber < roundNumber', () => {
    const cards: Card[] = [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }];
    const store = makeStore({ gameState: makeState({ roundNumber: 5, phase: 'dealing' }), lastSeen: 4 });
    renderHandView({ hand: hand(cards) }, store);
    expect(screen.queryAllByTestId('card').length).toBe(0);
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getAllByTestId('card').length).toBe(1);
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getAllByTestId('card').length).toBe(2);
  });
```

Replace with:

```ts
  it('renders cards progressively when lastSeenRoundNumber < roundNumber', () => {
    const cards: Card[] = [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }];
    const store = makeStore({ gameState: makeState({ roundNumber: 5, phase: 'dealing' }), lastSeen: 4 });
    renderHandView({ hand: hand(cards) }, store);
    expect(screen.queryAllByTestId('card').length).toBe(0);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getAllByTestId('card').length).toBe(1);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getAllByTestId('card').length).toBe(2);
  });
```

- [ ] **Step 2: Run the HandView test, watch it pass**

Run: `cd client && npx vitest run test/components/HandView.spec.tsx`
Expected: 5/5 pass.

- [ ] **Step 3: Run the full client test suite, confirm no regressions**

Run: `npm run test:client`
Expected: 97/97 pass (no regressions from this task).

- [ ] **Step 4: Commit**

```bash
git add client/test/components/HandView.spec.tsx
git commit -m "test(client): update HandView test to match new 250ms deal interval"
```

---

## Task 5: Update the e2e test timeouts

**Files:**
- Modify: `client/e2e/animations.spec.ts`

- [ ] **Step 1: Bump the two `action-panel` timeouts**

In `client/e2e/animations.spec.ts`, find these two lines:

```ts
  await hostPage.waitForSelector('.action-panel', { timeout: 15_000 });
  await guestPage.waitForSelector('.action-panel', { timeout: 15_000 });
```

Replace with:

```ts
  await hostPage.waitForSelector('.action-panel', { timeout: 20_000 });
  await guestPage.waitForSelector('.action-panel', { timeout: 20_000 });
```

- [ ] **Step 2: Run the e2e test, watch it pass**

Run: `npm run test:e2e -w client -- animations.spec.ts`
Expected: PASS (1 test, ~15–20s).

- [ ] **Step 3: Commit**

```bash
git add client/e2e/animations.spec.ts
git commit -m "test(e2e): bump action-panel timeout to 20s for slower deal"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run the full server test suite**

Run: `npm run test:server`
Expected: all tests pass.

- [ ] **Step 2: Run the full client test suite**

Run: `npm run test:client`
Expected: 97/97 pass across 18 files.

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run test:e2e -w client`
Expected: `animations.spec.ts` passes; other tests behave as before.

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds for both server and client.

- [ ] **Step 5: Manual smoke test**

Start the dev servers (`npm run dev`), open two browser tabs to `http://localhost:5173`. Create a room, join from the second tab, both players bet 50. Watch the deal animation — it should feel slower than yesterday's build (per-card 250ms vs 150ms, entry 0.25s vs 0.18s, hole flip 0.6s vs 0.5s). The dealer reveal should also feel slower. The action panel should still appear after the deal completes, with no jank.

- [ ] **Step 6: Commit any final tweaks**

If the smoke test surfaces fixes, commit them as `fix(client): ...` or `fix(server): ...`. If everything is clean, skip this step.

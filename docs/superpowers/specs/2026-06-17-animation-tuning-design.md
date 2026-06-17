# Animation tuning — design

**Date:** 2026-06-17
**Status:** Draft, awaiting user review
**Supersedes:** n/a (refines the timing values from [`2026-06-16-card-animations-design.md`](./2026-06-16-card-animations-design.md))
**Parent spec:** [`2026-06-16-card-animations-design.md`](./2026-06-16-card-animations-design.md)

## Problem

The card deal and dealer-reveal animations implemented yesterday land too quickly. The user finds the deal and the dealer reveal feel rushed. The values were tuned for a "snappy" feel during the original brainstorming; a "moderate" pace is preferred.

The hard-coded timings are split across two files:

- `client/src/components/HandView.tsx` — 4 literals: deal `intervalMs = 150`, dealer reveal `intervalMs = 400`, card entry `duration = 0.18`, hole card flip `duration = 0.5`, plus the `dealPosition * 150` round-robin math.
- `server/src/config.ts` — `DEALING_DURATION_MS = 1_500`, the server-side window that gives the client deal animation room to finish before the phase transitions to `player_turn`.

To re-tune, a developer has to edit the file, restart the dev server, and trust that the changes are visible. The values aren't co-located, and the server-client timing coupling is implicit.

## Goal

Slow the card animations by roughly 50–60% across the board and pull the values into a single named-exports file so future re-tunes are one-file edits. Keep the change scoped — no UI, no per-user settings, no API changes.

New values:

| Constant | Old | New |
|---|---|---|
| Deal per-card interval | 150ms | 250ms |
| Dealer reveal per-card interval | 400ms | 500ms |
| Card entry transition | 0.18s | 0.25s |
| Hole card 3D flip | 0.5s | 0.6s |
| Server `DEALING_DURATION_MS` | 1_500 | 2_000 |

## Non-Goals

- UI / settings panel. A global constants file is the only config surface.
- Per-user preferences (localStorage). All players see the same timing.
- Changes to the deal animation choreography (round-robin, scale-in, 3D flip).
- Changes to `useStaggeredReveal`, the reduced-motion path, or `MotionConfig`.
- Re-tuning the test fixtures' expected `phaseEndsAt` upper bound (the existing `+ 100` tolerance absorbs the bump).
- A e2e test for the new timings (manual smoke test only).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Config surface | New `client/src/lib/animation-timings.ts` with named exports | Per user. Single file, single source of truth, no UI, no API change. |
| Helper for round-robin math | `dealPositionToStartDelayMs(pos)` exported from the same file | The `pos * interval` expression is the one place the constant and the position variable meet; a named helper makes the call site readable and isolates the formula. |
| Server config | `DEALING_DURATION_MS` bumped to `2_000` in `server/src/config.ts` | The 500ms headroom over the longest possible deal animation (5 players × 250ms + 250ms = 1500ms) keeps the deal visible. If a future tune pushes the deal longer, the server constant must move with it. |
| Server-client coupling | One-line comment in both `animation-timings.ts` and `server/src/config.ts` cross-referencing the other | Future maintainer sees the constraint without having to derive it. |
| Test updates | `HandView.spec.tsx` "renders cards progressively" advances `250ms` instead of `150ms`; e2e `action-panel` timeout bumps from 15s to 20s | Mechanical. Hook tests use generic intervals, no change. |

## Architecture

The card-animation feature (designed and implemented yesterday) is unchanged in shape. This spec only re-tunes values and lifts the literals out of `HandView.tsx`.

```
client/src/
├── lib/
│   ├── animation-timings.ts        ← NEW: 4 named exports + 1 helper
│   ├── useStaggeredReveal.ts       ← unchanged
│   └── usePrefersReducedMotion.ts  ← unchanged
└── components/
    └── HandView.tsx                ← imports the 4 exports + helper; removes 5 hard-coded values

server/src/
├── config.ts                       ← DEALING_DURATION_MS: 1_500 → 2_000
└── game/state-machine.ts           ← unchanged
```

Server and client stay in sync via the comment cross-reference: the `DEALING_DURATION_MS` constant must be `>=` the longest possible client deal animation. The longest case (5 seated players, 2 cards each) is `(nonEmptyPlayerCount + 1) * DEAL_CARD_INTERVAL_MS` = `6 * 250 = 1500ms`. The 2000ms server window leaves 500ms headroom.

## Client changes

### New: `client/src/lib/animation-timings.ts`

```ts
/**
 * Animation timings for the card deal and dealer reveal.
 *
 * These values are global — every player sees the same animation. To retune,
 * edit the numbers here and save.
 *
 * The server's `Config.DEALING_DURATION_MS` must be >= the longest possible
 * client deal animation: `(nonEmptyPlayerCount + 1) * DEAL_CARD_INTERVAL_MS`.
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

### Modified: `client/src/components/HandView.tsx`

Five line changes — all value-extraction. No logic changes.

**Imports added** (alongside the existing `useStaggeredReveal` import):

```ts
import {
  DEAL_CARD_INTERVAL_MS,
  DEALER_REVEAL_CARD_INTERVAL_MS,
  CARD_ENTRY_DURATION_S,
  HOLE_CARD_FLIP_DURATION_S,
  dealPositionToStartDelayMs,
} from '../lib/animation-timings';
```

**Replacements** (line numbers refer to the current file at HEAD):

| Line | Before | After |
|---|---|---|
| 130 | `150,` (deal `intervalMs`) | `DEAL_CARD_INTERVAL_MS,` |
| 131 | `{ initialCount: 0, enabled: isNewRound, startDelayMs: dealPosition * 150 },` | `{ initialCount: 0, enabled: isNewRound, startDelayMs: dealPositionToStartDelayMs(dealPosition) },` |
| 138 | `400,` (reveal `intervalMs`) | `DEALER_REVEAL_CARD_INTERVAL_MS,` |
| 174 | `transition={{ duration: isHole && !holeHidden ? 0.5 : 0.18, ease: 'easeOut' }}` | `transition={{ duration: isHole && !holeHidden ? HOLE_CARD_FLIP_DURATION_S : CARD_ENTRY_DURATION_S, ease: 'easeOut' }}` |

No other changes to `HandView.tsx`.

## Server changes

### Modified: `server/src/config.ts`

One line:

```ts
DEALING_DURATION_MS: 2_000,  // CHANGED from 1_500. Must be >= the longest possible client deal animation: (nonEmptyPlayerCount + 1) * client DEAL_CARD_INTERVAL_MS. See client/src/lib/animation-timings.ts.
```

No changes to the state machine, gateway, or draw-bridge.

## Test updates

### Modified: `client/test/components/HandView.spec.tsx`

The "renders cards progressively" test (second case) hard-codes 150ms intervals. Update to 250ms:

```ts
it('renders cards progressively when lastSeenRoundNumber < roundNumber', () => {
  const cards: Card[] = [{ suit: '♠', rank: '5' }, { suit: '♥', rank: '6' }];
  const store = makeStore({ gameState: makeState({ roundNumber: 5, phase: 'dealing' }), lastSeen: 4 });
  renderHandView({ hand: hand(cards) }, store);
  expect(screen.queryAllByTestId('card').length).toBe(0);
  act(() => { vi.advanceTimersByTime(250); });   // was: 150
  expect(screen.getAllByTestId('card').length).toBe(1);
  act(() => { vi.advanceTimersByTime(250); });   // was: 150
  expect(screen.getAllByTestId('card').length).toBe(2);
});
```

The other 4 test cases don't reference the 150ms value (they use `enabled: false` for instant return, or assert static `data-testid` content), so they're unaffected.

### Modified: `client/e2e/animations.spec.ts`

Two timeouts bump from 15_000ms to 20_000ms (the two `action-panel` waits after the bet placement). The reconnect-skip reload assertion (5_000ms) stays — it's well under the 10s bet deadline.

### No changes to:

- `client/test/lib/useStaggeredReveal.spec.ts` — uses generic `intervalMs` values, no literal reference to the deal constants.
- `client/test/lib/usePrefersReducedMotion.spec.ts` — unrelated.
- `server/test/state-machine.spec.ts` — doesn't touch `DEALING_DURATION_MS`.
- `server/test/gateway-auto-advance.spec.ts` — its `phaseEndsAt` upper-bound assertion uses a `+ 100` tolerance buffer; the bump from 1500 to 2000 is well within that buffer.

## Files touched

**New:**
- `client/src/lib/animation-timings.ts` — 4 named exports + 1 helper (~30 lines).

**Modified:**
- `client/src/components/HandView.tsx` — 1 import block + 4 line replacements.
- `server/src/config.ts` — 1 value bump + 1 comment.
- `client/test/components/HandView.spec.tsx` — 2 numeric literals in 1 test.
- `client/e2e/animations.spec.ts` — 2 timeout values.

## Out of scope / open questions

- A UI for live-tuning. The current "edit file + reload" workflow is acceptable for a developer; if a non-developer ever needs to retune, a settings panel can be a follow-up.
- A test that asserts the server-client timing coupling (e.g., a unit test that fails if `DEALING_DURATION_MS < (SEAT_COUNT + 1) * DEAL_CARD_INTERVAL_MS`). Useful but adds a cross-package dependency to a test file; deferred to a follow-up unless requested.
- Animating the 3s settle-pause or 10s bet-window countdowns. Not requested.
- Re-tuning the deal/reveal choreography itself (e.g., adding a "swoop in" path). Not requested.

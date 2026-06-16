# Card deal & dealer reveal animations — design

Status: approved (brainstorming, 2026-06-16)

## Problem

When a blackjack round starts, the player cards and dealer upcard appear in
their final positions instantly. There is no motion to mark the transition
from "betting" to "the round is in play." Similarly, when the dealer's turn
begins, the hole card and any required draws (up to 17+) are revealed
instantly, with no cinematic moment. Both transitions feel abrupt against
the otherwise deliberate pacing of the table (3s settle pause, 10s bet
window, etc.).

## Goal

Two focused animations:

1. **Deal animation** — when the bet window closes, the initial 2 cards per
   player and the dealer upcard are dealt in a round-robin across all
   seated players. The hole card lands face-down. Total ~1.5s.
2. **Dealer reveal** — when `dealer_turn` begins, the hole card flips
   face-up, then any additional dealer draws appear one at a time. Total
   ~1.2s for a typical 2-card hand, longer for hands that draw to 17+.

Both animations respect `prefers-reduced-motion` (instant snap to final
state). Reconnecting clients see the final state without replaying either
animation.

## Non-goals

- Chip-to-pot animations, win/loss bursts, button micro-interactions, or
  any other motion outside the deal and dealer reveal.
- A "deck" position on the table from which cards fly. The deal motion is
  per-seat scale-in, not cards traveling across the table.
- Sound effects.
- Animating the countdown digits in `BetPanel` / `ResultOverlay` (the
  existing `useNow`-driven re-renders are already smooth enough).
- Animating card layout changes after the deal (e.g., re-flow when a
  player hits and the hand grows) — `framer-motion`'s `layout` prop
  handles this as a side effect, but no choreography is added.
- Per-player deal timing customization. The interval is global.
- Split-hand deal animation. Split hands already exist; their cards
  animate in with the same hook. No special-case choreography.
- Persisting animation state across server restarts. Animations are
  client-only ephemeral.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Animation library | framer-motion | Per user. Eases per-card stagger and 3D hole-card flip with a small surface area. |
| Implementation style | Per-card mount with `AnimatePresence` | Round-robin timing and per-card dealer reveal require per-card mount/unmount. See "Approach A" in the brainstorm. |
| Server change | New `dealing` phase | Per user. `Phase` already includes `'dealing'` (unused) — the change fills the gap, matches the existing gateway-timer pattern, and lets the action panel cleanly stay disabled. |
| `dealing` duration | 1.5s | Tunable via `Config.DEALING_DURATION_MS`. Long enough to feel like a deal, short enough that a player who's eager to act isn't delayed. |
| Deal pattern | Round-robin, ~150ms per card | Casino-familiar. Round-robin across seated players (empty seats skipped). |
| Card entry motion | Scale 0→1, 180ms ease-out | Subtle; pairs well with the staggered timing. |
| Empty seats | Skipped entirely in the deal | No ghost cards, no animation cost. `EmptySeatTile` continues to render in its slot. |
| Dealer reveal | Hole card flips first, then draws stagger 400ms apart | Per user. The flip is a 3D `rotateY` 180→0 over 500ms; subsequent draws are scale-in like the deal. |
| Reduced motion | `prefers-reduced-motion: reduce` → instant snap | Standard a11y. Implemented with a tiny `usePrefersReducedMotion` hook + framer-motion's `<MotionConfig reducedMotion="user">`. |
| Reconnect behavior | Skip animation; show final state | `lastSeenRoundNumber` slice + `flushKey` parameter on the hook. |
| Where "last seen round" lives | New `client/src/store/animation.slice.ts` | One field, one action. Slice form is consistent with the rest of the project; component-local state would scatter it. |
| `roundNumber` bump | Move from `betting→player_turn` to `betting→dealing` | So reconnecting clients detect a new round the moment they see `phase: 'dealing'`. |

## Architecture

```
┌────────────────────┐                  ┌────────────────────┐
│  Server            │                  │  Client            │
│                    │                  │                    │
│  state-machine     │                  │  HandView          │
│  ┌──────────────┐  │  game:state      │  ├─ AnimatePresence│
│  │ betting      │──┼─────────────────▶│  │  └─ motion.div   │
│  └──────┬───────┘  │                  │  │     (per card)   │
│         │ bet      │                  │  └──────────────────┘
│         │ Deadline │                  │        ▲            │
│  ┌──────▼───────┐  │                  │        │ stagger    │
│  │ dealing      │──┼─────────────────▶│  useStaggeredReveal│
│  └──────┬───────┘  │   (1.5s timer)   │  ├─ round # key     │
│         │ complete │                  │  ├─ phase flushKey  │
│  ┌──────▼───────┐  │                  │  └─ intervalMs      │
│  │ player_turn  │──┼─────────────────▶│        ▲            │
│  └──────┬───────┘  │                  │  usePrefersReduced  │
│         │ (cards   │                  │  Motion             │
│         │  drawn   │                  │                    │
│         │  server- │                  │                    │
│         │  side)   │                  │                    │
│  ┌──────▼───────┐  │                  │                    │
│  │ dealer_turn  │──┼─────────────────▶│  DealerArea        │
│  └──────┬───────┘  │                  │  ├─ rotateY flip   │
│         │ (server  │                  │  │  for hole card  │
│         │  draws)  │                  │  └─ same hook      │
│  ┌──────▼───────┐  │                  │                    │
│  │ settled      │  │                  │                    │
│  └──────────────┘  │                  │                    │
└────────────────────┘                  └────────────────────┘
```

The split mirrors the project's existing pattern (state machine = pure
transitions; gateway = timer + broadcast; client = view). The animation
"machine" lives entirely on the client; the server just inserts a phase
in which the client knows to play the animation.

## Server changes

### State machine (`server/src/game/state-machine.ts`)

**Phase graph (excerpt of changed edges):**

```
betting
  └─ on round:betDeadline → dealing       (was: → player_turn)
dealing                                (NEW)
  └─ on round:dealingComplete → player_turn
player_turn
  ...
```

**New action:**

```ts
export type Action =
  | ...
  | { type: 'round:dealingComplete'; seatId: string };  // NEW
```

**New `GameEvent` variant (not in `ClientCommand`):**

```ts
| { type: 'round:dealingComplete'; seatId: string };  // NEW
```

**Changes to the existing `round:betDeadline` handler:**

- The transition target changes from `player_turn` to `dealing`.
- The card-deal logic (assigning `dealtCards` to each seat, the dealer
  upcard) is unchanged.
- `roundNumber` is bumped on this transition (moved from the previous
  `betting → player_turn` bump).

**New edge in the `dealing` state:**

```ts
dealing: {
  on: {
    'round:dealingComplete': { target: 'player_turn' },
  },
},
```

**New guard:**

```ts
{ name: 'isDealingPhase', errorCode: 'INVALID_PHASE',
  predicate: (s) => s.phase === 'dealing' },
```

The guard is enforced when `round:dealingComplete` is received; from any
other phase it throws `INVALID_PHASE`.

### Gateway (`server/src/gateway/game.gateway.ts`)

**`scheduleAutoAdvance` — add a third case:**

```ts
private scheduleAutoAdvance(roomId: string, phase: 'settled' | 'betting' | 'dealing') {
  this.cancelAutoAdvance(roomId);
  const ms =
    phase === 'settled'  ? Config.SETTLE_PAUSE_MS :
    phase === 'betting'  ? Config.BET_DEADLINE_MS :
                           Config.DEALING_DURATION_MS;  // NEW
  const fireAt = Date.now() + ms;
  const timer = setTimeout(() => this.fireAutoAdvance(roomId, phase), ms);
  this.pendingTimers.set(roomId, { timer, fireAt });
}
```

**`fireAutoAdvance` — add a `dealing` branch:**

```ts
if (phase === 'dealing') {  // NEW
  this.rooms.apply(roomId, { type: 'round:dealingComplete', seatId: '__server__' });
  this.broadcastAll(roomId, this.rooms.getState(roomId)!);
}
```

**`broadcastAll` — drive the new timer:**

```ts
if (state.phase === 'settled')  this.scheduleAutoAdvance(roomId, 'settled');
else if (state.phase === 'betting')  this.scheduleAutoAdvance(roomId, 'betting');
else if (state.phase === 'dealing')  this.scheduleAutoAdvance(roomId, 'dealing');  // NEW
else this.cancelAutoAdvance(roomId);
```

**`attachPhaseEndsAt` — include `dealing`:**

```ts
if (state.phase !== 'settled' && state.phase !== 'betting' && state.phase !== 'dealing') {  // CHANGED
  return { ...state, phaseEndsAt: null };
}
```

**`publicState` — unchanged.** The dealer's hole card stays hidden during
`dealing` (same as `player_turn`).

### Config (`server/src/config.ts`)

```ts
export const Config = {
  ...
  DEALING_DURATION_MS: 1_500,  // NEW
} as const;
```

## Client changes

### New: `client/src/lib/useStaggeredReveal.ts`

```ts
/**
 * Returns the number of items currently "revealed" for the current key,
 * incrementing one at a time every `intervalMs` until it reaches `targetCount`.
 * When `flushKey` changes, instantly snaps to `targetCount` (cancels in-flight timers).
 * When `enabled` is false, returns `targetCount` immediately.
 * When `usePrefersReducedMotion()` is true, returns `targetCount` immediately.
 */
export function useStaggeredReveal(
  targetCount: number,
  key: unknown,
  intervalMs: number,
  options?: { enabled?: boolean; flushKey?: unknown; startDelayMs?: number },
): number;
```

**Behavior:**

- `useState(0)` for the visible count, `useRef` for the timeout id.
- `useEffect` keyed on `[key, targetCount, enabled, flushKey, intervalMs, startDelayMs]`:
  - `clearTimeout` any existing timer.
  - If `!enabled` or `prefers-reduced-motion`: set visible to `targetCount`, return.
  - If `flushKey` changed (and the previous run had a timer in flight): set visible to `targetCount` immediately, return.
  - Otherwise: schedule a `setTimeout` chain via a recursive helper that
    increments visible by 1 every `intervalMs` until it reaches
    `targetCount`. Use a `startDelayMs` initial delay before the first
    increment (used for round-robin staggering across seats).
- Cleanup: `clearTimeout` on unmount or before re-running the effect.

**Two call sites (semantic):**

```ts
// PlayerSeat, per hand, for the initial deal
const visibleCount = useStaggeredReveal(
  hand.cards.length,
  `${roundNumber}:${seatId}:${handIndex}`,
  150,
  { enabled: roundNumber > lastSeen, flushKey: phase, startDelayMs: seatIndex * 150 },
);

// DealerArea, for the staggered reveal
const visibleDealerCount = useStaggeredReveal(
  dealer.cards.length,
  `${roundNumber}:dealer`,
  400,
  { enabled: roundNumber > lastSeen, flushKey: phase },
);
```

### New: `client/src/lib/usePrefersReducedMotion.ts`

```ts
/**
 * Returns true if the user has requested reduced motion at the OS level.
 * Subscribes to changes via matchMedia.
 */
export function usePrefersReducedMotion(): boolean;
```

- Wraps `window.matchMedia('(prefers-reduced-motion: reduce)')`.
- Returns `false` when `matchMedia` is unavailable.
- Default value before the first effect run is `false` (animation plays
  initially; the hook updates synchronously on the first effect run).

### New: `client/src/store/animation.slice.ts`

```ts
type AnimationState = { lastSeenRoundNumber: number | null };
const initial: AnimationState = { lastSeenRoundNumber: null };

const slice = createSlice({
  name: 'animation',
  initialState: initial,
  reducers: {
    roundSeen(state, action: PayloadAction<number>) {
      state.lastSeenRoundNumber = action.payload;
    },
    animationReset() { return initial; },
  },
});
```

Wired into the store identically to the existing slices. `animationReset`
is dispatched on `gameCleared` (when the player leaves the room).

### New: `client/src/components/DealAnimationDriver.tsx`

A small component rendered once inside `TableView`. It watches
`state.phase` and `state.roundNumber`; on the transition into
`player_turn` (meaning the deal is complete and the cards are all in
their final positions), it dispatches `roundSeen(roundNumber)`. This
keeps "have I seen this round?" logic out of the per-hand hooks.

```tsx
export function DealAnimationDriver() {
  const phase = useSelector((s) => s.game.state?.phase);
  const roundNumber = useSelector((s) => s.game.state?.roundNumber);
  const lastSeen = useSelector((s) => s.animation.lastSeenRoundNumber);
  const dispatch = useDispatch();
  useEffect(() => {
    if (phase === 'player_turn' && roundNumber !== null && roundNumber > (lastSeen ?? 0)) {
      dispatch(roundSeen(roundNumber));
    }
  }, [phase, roundNumber, lastSeen, dispatch]);
  return null;
}
```

### Modified: `client/src/components/HandView.tsx`

```tsx
import { motion, AnimatePresence } from 'framer-motion';
import { useStaggeredReveal } from '../lib/useStaggeredReveal';

// ... existing styled components unchanged ...

export function HandView({ hand, label, isDealer = false }: { hand: Hand; label?: string; isDealer?: boolean }) {
  const roundNumber = useSelector((s) => s.game.state?.roundNumber);
  const phase = useSelector((s) => s.game.state?.phase);
  const lastSeen = useSelector((s) => s.animation.lastSeenRoundNumber);
  const seatId = isDealer ? 'dealer' : (useSelector(...).seatId ?? '');  // per-hand key
  const seatIndex = isDealer ? 0 : (useSelector(...).seatIndex);

  const targetCount = isDealer
    ? (phase === 'dealer_turn' || phase === 'settled' ? dealer.cards.length : 2)  // hole card is hidden during dealing/player_turn
    : hand.cards.length;

  const visibleCount = useStaggeredReveal(
    targetCount,
    `${roundNumber}:${seatId}`,
    isDealer ? 400 : 150,
    { enabled: roundNumber > (lastSeen ?? 0), flushKey: phase, startDelayMs: isDealer ? 0 : seatIndex * 150 },
  );

  const t = handTotal(hand, visibleCount);  // CHANGED: handTotal accepts an optional visibleCount to suppress "Showing N" / total until cards are visible
  return (
    <div>
      {label && <Label>{label}</Label>}
      <HandRow $isDealer={isDealer}>
        <AnimatePresence>
          {hand.cards.slice(0, visibleCount).map((c, i) => (
            <motion.div
              key={`${roundNumber}-${seatId}-${i}`}
              layout
              data-testid="card"
              initial={isDealer && i === 1
                ? { scale: 0, opacity: 0, rotateY: 180 }
                : { scale: 0, opacity: 0 }}
              animate={isDealer && i === 1
                ? { scale: 1, opacity: 1, rotateY: 0 }
                : { scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: isDealer && i === 1 ? 0.5 : 0.18, ease: 'easeOut' }}
              style={{ transformStyle: 'preserve-3d' }}
            >
              <CardView card={c} />
            </motion.div>
          ))}
        </AnimatePresence>
        {visibleCount > 0 && <Total $hidden={t.hasHidden} $blackjack={t.isBlackjack} $bust={t.isBust}>
          {t.hasHidden && <HiddenPrefix>Showing</HiddenPrefix>}
          {t.total}
        </Total>}
      </HandRow>
    </div>
  );
}
```

**`handTotal` change:** the existing function
(`client/src/lib/handTotal.ts`) is called with the full `hand.cards`. We
add an optional second parameter `visibleCount?: number`; if provided and
`< hand.cards.length`, the function returns `{ total: 0, hasHidden: true,
isBlackjack: false, isBust: false }` (i.e., the total is suppressed
until the deal is complete). This avoids flashing a wrong total during
the staggered deal.

For the dealer during `player_turn`: `handTotal` already returns
`hasHidden: true` and computes the visible-card total — no change needed.
The new `visibleCount` parameter only matters for the deal phase.

### Modified: `client/src/components/DealerArea.tsx`

The `DealerArea` no longer needs the `dealer` data passed in — it now
reads from the same `useStaggeredReveal` machinery via `HandView`. The
component itself stays small and only renders the label + `HandView` with
`isDealer`.

### Modified: `client/src/components/PlayerSeat.tsx`

Reads `seatIndex` from props (passed in by `TableView` based on the
`players` array index). The hook's `startDelayMs = seatIndex * 150`
provides the round-robin offset.

### Modified: `client/src/components/TableView.tsx`

- Wraps the existing `TableSurface` children in `<MotionConfig reducedMotion="user">` from framer-motion. This is a one-line wrapper; it tells framer-motion to honor the user's reduced-motion preference automatically.
- Renders `<DealAnimationDriver />` once (e.g., as a sibling of `<ResultOverlay />`).
- Passes `seatIndex` to each `PlayerSeatView` (currently absent — currently
  it just passes `seat` and `isActive`).

### Modified: `client/src/lib/handTotal.ts`

Add the optional `visibleCount` parameter. Default behavior (when omitted)
matches today. See `HandView` description above for the suppression rule.

### Theme

No new tokens. The animation durations are local to the components.
The framer-motion `ease` is hard-coded to `'easeOut'` for consistency
with the existing CSS transitions elsewhere (e.g., `transition: background 120ms ease`
in `ActionPanel.tsx:31`).

## Reduced-motion path

When `usePrefersReducedMotion` returns `true`:

1. `useStaggeredReveal` returns `targetCount` immediately, no timers.
2. framer-motion's `<MotionConfig reducedMotion="user">` skips all
   transforms, so the `initial` / `animate` states render at the
   `animate` value on the first frame.
3. The visual result: cards appear in their final positions in one
   frame. The game is fully playable; the only thing missing is the
   motion.

A user with reduced-motion enabled sees:

- The deal: all cards appear in their final positions simultaneously.
- The dealer reveal: all dealer cards visible immediately, no flip.

No additional configuration is required from the user's side.

## Reconnect behavior

The "is this a new round?" check happens at the hook's call site via the
`enabled` parameter:

```ts
const enabled = roundNumber > (lastSeen ?? 0);
```

- **First-time viewer, new round** (`lastSeen === null` or
  `lastSeen < roundNumber`): `enabled = true`. Hook plays the deal
  animation.
- **Reconnect to a mid-round state** (`lastSeen === roundNumber`):
  `enabled = false`. Hook returns `targetCount` immediately.
- **Reconnect to a new round** (impossible without a state change, but
  defensively handled): the new `roundNumber` is greater than
  `lastSeen`, animation plays.

The `flushKey = phase` parameter is a separate concern: if the phase
changes mid-animation (e.g., server's `dealingComplete` timer fires
before the local animation finishes), the hook snaps to `targetCount`
so the action panel and final state are immediately consistent. This
also makes mid-deal disconnects recover cleanly — the reconnecting
client sees whatever state the server currently has, with the hook
behaving correctly per the rules above.

## Testing

### Server (`server/test/state-machine.spec.ts`)

Three new test cases, plus one small edit:

1. **NEW** — `round:betDeadline` from `betting` transitions to `dealing`
   and populates hands from the `dealtCards` / `dealerUpcard` payload.
2. **NEW** — `round:dealingComplete` from `dealing` transitions to
   `player_turn`. Hand contents unchanged.
3. **NEW** — `round:dealingComplete` from any other phase throws
   `INVALID_PHASE`.
4. **EDIT** — the existing `betDeadline` test that asserts
   `state.phase === 'player_turn'` now asserts `state.phase === 'dealing'`
   and adds a follow-up `round:dealingComplete` step to reach
   `player_turn`.

### Client unit (`client/test/lib/useStaggeredReveal.spec.ts`, new)

Use `vi.useFakeTimers()` and `@testing-library/react`'s `renderHook`.

1. Initial render with `targetCount = 3, intervalMs = 100` returns `0`.
2. After `vi.advanceTimersByTime(100)`, returns `1`. After 300ms, returns `3`.
3. Changing `key` resets to `0` and re-staggered.
4. `targetCount` decreasing from 3 to 1 snaps to `1` immediately.
5. `usePrefersReducedMotion` returning `true` (mocked) → returns
   `targetCount` on first render; no timers scheduled.
6. `enabled = false` → returns `targetCount` immediately.
7. Unmount mid-stagger → no late state update fires (no warning).
8. `flushKey` change mid-stagger → snaps to `targetCount`.

### Client unit (`client/test/components/HandView.spec.tsx`, new)

Render `HandView` inside a `Provider` with a populated mock store.

1. `lastSeenRoundNumber === roundNumber` → all cards render on first
   render, no animation.
2. `lastSeenRoundNumber < roundNumber` → with fake timers, advancing
   time reveals cards one at a time.
3. Mock `usePrefersReducedMotion` to `true` → all cards present on
   first render regardless of `lastSeen`.
4. `phase` changes from `dealing` to `player_turn` mid-stagger → flush
   (all cards present immediately).

### E2E (`client/e2e/animations.spec.ts`, new)

Follow the existing two-tab Playwright pattern.

1. Both players place bets; after the 10s window, the deal plays.
   Assert all cards are present in both tabs by the time `player_turn`
   begins.
2. Both players stand; the dealer reveal plays. The hole card's
   `data-testid` switches from `card-back` to `card-front` within ~500ms
   of `dealer_turn` entry. (Note: the existing `CardBack` component
   doesn't have `data-testid="card-back"`; we'll add it.)
3. Reload one tab mid-`player_turn` → no replay; the reloaded tab shows
   the full hand immediately.
4. Re-run scenario 1 with `browser.newContext({ reducedMotion: 'reduce' })`
   → all cards present in both tabs immediately on phase entry.

### Out of scope for testing

- No framer-motion snapshot tests (brittle).
- No visual regression tests beyond the e2e "cards are present" assertions.
- No performance benchmarks (the deal is short, surface is small).
- No tests for the `lastSeenRoundNumber` slice directly (one-liner; covered
  transitively by the component tests).

## Files touched

**New:**

- `client/src/lib/useStaggeredReveal.ts`
- `client/src/lib/usePrefersReducedMotion.ts`
- `client/src/store/animation.slice.ts`
- `client/src/components/DealAnimationDriver.tsx`
- `client/test/lib/useStaggeredReveal.spec.ts`
- `client/test/components/HandView.spec.tsx`
- `client/e2e/animations.spec.ts`

**Modified:**

- `server/src/config.ts` — add `DEALING_DURATION_MS`.
- `server/src/game/state-machine.ts` — add `dealing` phase, new action,
  new event, new guard, move `roundNumber` bump.
- `server/src/gateway/game.gateway.ts` — extend `scheduleAutoAdvance`,
  `fireAutoAdvance`, `broadcastAll`, `attachPhaseEndsAt`.
- `server/test/state-machine.spec.ts` — 3 new cases, 1 small edit.
- `client/src/lib/handTotal.ts` — accept optional `visibleCount`.
- `client/src/components/HandView.tsx` — AnimatePresence + motion.div.
- `client/src/components/DealerArea.tsx` — pass `isDealer` and read
  state from selectors (or unchanged; mostly a passthrough).
- `client/src/components/PlayerSeat.tsx` — accept and use `seatIndex`.
- `client/src/components/TableView.tsx` — add `<MotionConfig>`,
  `<DealAnimationDriver />`, pass `seatIndex`.
- `client/src/store/index.ts` — register the `animation` reducer.

## Out of scope / open questions

- Whether to add a "Dealing…" indicator to the table while `phase ===
  'dealing'`. (Currently the action panel is hidden and no betting UI
  shows, so the user sees only the cards appearing — that may be
  enough.) Can be added in a follow-up.
- Animating the countdown digits in `BetPanel` / `ResultOverlay`.
  (Existing re-renders are smooth.)
- Sound effects. (Not requested.)
- Animating the chip-to-pot motion or win/loss bursts. (Not in scope per
  user; tracked for a future spec if desired.)
- Per-player deal interval customization. (Global 150ms only.)

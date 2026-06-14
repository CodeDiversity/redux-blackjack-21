# State Machine Refactor — Design Spec

**Date:** 2026-06-14
**Status:** Draft, awaiting user review
**Parent spec:** [`2026-06-14-blackjack-21-design.md`](./2026-06-14-blackjack-21-design.md)

## Goal

Replace the imperative `applyAction` switch in `server/src/game/state-machine.ts` with an XState v5 state machine. The state graph becomes a single declarative source of truth. The public `applyAction(state, action, draw?)` API and the wire-format `GameState` are preserved, so the gateway, client, and the 24 existing unit tests in `server/test/state-machine.spec.ts` are unaffected.

## Motivation

The current `state-machine.ts` is 262 lines with 8 imperative `apply*` functions and 5+ helpers. Reading top-to-bottom doesn't tell you "what is the hit action" — it tells you "here are 8 handlers and a pile of helpers." A user action like `hit` triggers a chain of 6 functions across 3 phases. Phase checks are duplicated in every handler. The `advanceTurn` heuristic (`hands[hands.length - 1]`) is fragile for split hands. The state machine is functionally correct but hard to follow.

XState replaces the imperative switch with a declarative state graph: states are first-class, transitions are visible, guards are named, and actions are isolated. The "what is the state machine doing" question becomes answerable by reading the machine definition.

## Non-Goals

- **Add `activeHand` to `GameState` or fix the split bug.** Out of scope for this refactor. The `advanceTurn` heuristic is documented as a known issue; fixing it cleanly is a follow-up.
- **Change the public `applyAction` API** or the wire-format `GameState` shape.
- **Change the gateway, client, or any code outside `server/src/game/`.**
- **Touch `hand.ts`, `dealer.ts`, `payout.ts`, `shoe.ts`, or `game.service.ts`.** The state machine is the only file being redesigned.
- **Property-based tests, machine visualization snapshots, or other test infrastructure beyond standard unit tests.**

## Constraints / Decisions Locked In

| Decision | Choice | Why |
|---|---|---|
| State machine library | XState v5 | Battle-tested, expressive, well-documented `setup({...}).createMachine({...})` API |
| Integration model | Pure transitions, no actors | Gateway is the only caller; `applyAction` stays a pure function; no per-room actor lifecycle to manage |
| Wire format | Unchanged (XState snapshot reconstructed as `GameState`) | Client and gateway see no change; the 24 existing tests pass without edits |
| Card-draw threading | Pre-drawn by `draw-bridge.ts`, attached to events | State machine stays purely reactive; the `draw` callback only flows through the wrapper |
| Public error API | `GameError` class with the same 6 codes | Callers see the same exception shape and codes as before |
| `roomId` ownership | Held by `GameService`, injected into the snapshot when translating back to `GameState` | The state machine doesn't know about room identity |

## Architecture

### File Layout

```
server/src/game/
├── state-machine.ts       # public API (re-exports + applyAction wrapper) + XState machine definition
├── draw-bridge.ts         # NEW: pre-draws cards based on event type, attaches to event
├── hand.ts                # unchanged
├── dealer.ts              # unchanged
├── payout.ts              # unchanged
├── shoe.ts                # unchanged
└── game.service.ts        # unchanged
```

### Public API (Unchanged)

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

export class GameError extends Error {
  constructor(public code: string) { super(code); }
}

export function createInitialState(roomId: string, seatCount: number, _roundNumber?: number): GameState;
export function applyAction(state: GameState, action: Action, draw?: () => Card): GameState;
```

The `Action` type is the *user-facing* action shape. The XState event shape is the *enriched* shape (with cards attached), defined separately inside `state-machine.ts`.

## The XState Machine

### States

The XState state value *is* the `phase` of `GameState`:

```
lobby
  └─ on round:ready → betting
betting
  └─ on bet:place → betting (mutates a seat, may stay in betting)
  └─ on round:start → player_turn (deals cards)
player_turn
  ├─ on hand:hit, hand:stand, hand:double, hand:split → player_turn
  └─ always [{ guard: allHandsActed, target: dealer_turn }]
dealer_turn
  └─ on round:dealerPlay → settled
  └─ always [{ guard: dealerDone, target: settled }]
settled
  └─ on round:advance → betting
```

The `player_turn → dealer_turn` auto-transition is the only edge that's not directly user-triggered. See "Draw threading" below for how it's handled.

### Events

XState event = the `Action` plus pre-drawn cards where needed:

```ts
type Event =
  | { type: 'bet:place'; seatId: string; amount: number }
  | { type: 'hand:hit'; seatId: string; handIndex: number; card: Card }
  | { type: 'hand:stand'; seatId: string; handIndex: number }
  | { type: 'hand:double'; seatId: string; handIndex: number; card: Card }
  | { type: 'hand:split'; seatId: string; handIndex: number; leftCard: Card; rightCard: Card }
  | { type: 'round:ready'; seatId: string }
  | { type: 'round:start'; seatId: string; dealtCards: { playerIndex: number; cards: [Card, Card] }[]; dealerUpcard: Card }
  | { type: 'round:dealerPlay'; dealerFinalHand: CardSlot[] }
  | { type: 'round:advance'; seatId: string };
```

The `round:dealerPlay` event is **synthetic** — it's not a user action. It's emitted by the `applyAction` wrapper when the auto-transition from `player_turn` to `dealer_turn` fires (see "Draw threading").

### Context

The dynamic game state held by the machine. `roomId` and `phase` are NOT in context — `roomId` is held by `GameService`, and `phase` is the XState state value. The public `GameState` reconstructs both.

```ts
type Context = {
  shoeSize: number;
  cutCardIndex: number;
  players: PlayerSeat[];
  dealer: Hand;
  activeSeat: number | null;
  roundNumber: number;
  lastResult: RoundResult | null;
};
```

### Guards

One guard per validation. Each guard has a `predicate` and an associated `errorCode` (the `GameError` code to throw if the guard rejects):

| Guard | Error code | Used by |
|---|---|---|
| `isLobbyOrBetting` | `INVALID_PHASE` | `bet:place` |
| `isValidBetAmount` | `BET_OUT_OF_RANGE` | `bet:place` |
| `hasSufficientFundsForBet` | `INSUFFICIENT_FUNDS` | `bet:place` |
| `isPlayerTurnPhase` | `INVALID_PHASE` | `hand:*` |
| `isActiveSeat` | `NOT_YOUR_TURN` | `hand:*` |
| `isHandActionable` | `HAND_LOCKED` | `hand:hit`, `hand:stand` |
| `isDoubleableHand` | `HAND_LOCKED` | `hand:double` |
| `canSplitHand` | `CANNOT_SPLIT` | `hand:split` |
| `hasSufficientFundsForDouble` | `INSUFFICIENT_FUNDS` | `hand:double` |
| `hasSufficientFundsForSplit` | `INSUFFICIENT_FUNDS` | `hand:split` |
| `noAcesRuleForSplit` | `CANNOT_SPLIT` | `hand:split` (when splitting aces) |
| `allPlayersReady` | `NOT_READY` | `round:start` |
| `allHandsActed` | (no error — fires auto-transition) | `player_turn` → `dealer_turn` |
| `dealerDone` | (no error — fires auto-transition) | `dealer_turn` → `settled` |
| `isLobbyOrSettled` | `INVALID_PHASE` | `round:ready` |
| `isSettled` | `INVALID_PHASE` | `round:advance` |

### Actions (assign)

One `assign` action per `Action` type:

| Action | Effect |
|---|---|
| `assignBet` | Sets a seat's hand bet, transitions to `betting` if not already |
| `assignHit` | Appends the pre-drawn `card` to the hand |
| `assignStand` | Marks the hand stood |
| `assignDouble` | Doubles bet, appends pre-drawn `card`, locks hand |
| `assignSplit` | Splits into two hands with pre-drawn `leftCard` and `rightCard` |
| `assignDeal` | Deals 2 cards to each seated player with a bet; sets dealer's upcard |
| `assignDealerHand` | Replaces dealer's hand with the pre-drawn final hand |
| `assignSettle` | Computes payouts, mutates bankrolls, populates `lastResult` |
| `assignAdvance` | Resets hands for the next round, transitions to `betting` |

`assignSettle` is the `entry` action on `settled` — when the `dealer_turn → settled` transition fires, the entry action runs with the dealer's final hand in context.

## Public API: The `applyAction` Wrapper

```ts
export function applyAction(
  state: GameState,
  action: Action,
  draw?: () => Card,
): GameState {
  // 1. Build the XState snapshot from the wire-format GameState.
  const snapshot = toSnapshot(state);

  // 2. Pre-draw cards. Throws GameError if `draw` is missing but needed.
  const event = drawBridge.prepareEvent(snapshot, action, draw);

  // 3. Run the transition.
  const nextSnapshot = machine.transition(snapshot, event);

  // 4. Detect rejection: state value unchanged AND no assign ran.
  if (!eventWasApplied(nextSnapshot, snapshot)) {
    throw new GameError(inferRejectionReason(snapshot, action));
  }

  // 5. Handle auto-transition to dealer_turn (see below).
  if (nextSnapshot.value === 'dealer_turn') {
    const dealerEvent = drawBridge.computeDealerEvent(nextSnapshot, draw);
    const finalSnapshot = machine.transition(nextSnapshot, dealerEvent);
    return fromSnapshot(finalSnapshot, state.roomId);
  }

  // 6. Translate snapshot back to wire-format GameState.
  return fromSnapshot(nextSnapshot, state.roomId);
}
```

## Draw Threading

### Why pre-draw?

Pure XState transitions can't call external functions like `draw()`. The state machine is fully reactive — it sees events with all the data already attached. The `draw` callback lives in the `applyAction` wrapper, not in the machine.

### `drawBridge.prepareEvent`

Maps each user action to the XState event with cards attached:

| Action type | Pre-draws |
|---|---|
| `bet:place`, `hand:stand`, `round:ready`, `round:advance` | None |
| `hand:hit`, `hand:double` | 1 card |
| `hand:split` | 2 cards (left and right) |
| `round:start` | 2 cards per seated player with a bet + 1 dealer upcard |

If `draw` is undefined and the action needs cards, `prepareEvent` throws `GameError('DRAW_REQUIRED')`. This is a new error code that wraps the existing per-action errors (e.g., `HAND_LOCKED` is thrown later by the machine's guards if the action is invalid even when `draw` succeeds).

### `drawBridge.computeDealerEvent`

When the `player_turn → dealer_turn` auto-transition fires, the `dealer_turn` state's `entry` action needs the pre-drawn dealer final hand. Since pure transitions can't call `draw`, the `applyAction` wrapper detects the state value change and issues a second transition with a synthetic `round:dealerPlay` event:

1. Draws the dealer's hole card via `draw()`.
2. Loops: while `dealerShouldHit(currentHand)`, draws another card and appends.
3. Attaches the final hand to the event.

The `dealer_turn` state accepts the `round:dealerPlay` event with a guard that the hand was provided. After applying, the `dealer_turn → settled` auto-transition fires (guarded by `dealerDone`, which is always true after the hand is applied), and the `settled` state's `entry` action runs `assignSettle`.

### Why two transitions instead of one?

The XState graph is cleaner with `round:dealerPlay` as an explicit event. The state machine is reactive: every state change is caused by an event. This makes the state graph easy to read and reason about. The cost is one extra transition per dealer-turn, which is negligible.

## Error Handling

The public `GameError` exception API is preserved exactly: same class, same 6 codes (`NOT_YOUR_TURN`, `INVALID_PHASE`, `BET_OUT_OF_RANGE`, `INSUFFICIENT_FUNDS`, `CANNOT_SPLIT`, `HAND_LOCKED`, `NOT_READY`).

### How a `GameError` gets thrown

XState guards return `false` to reject an event. The wrapper detects rejection in two ways:

1. **State value didn't change AND no `assign` action ran** → guards rejected the event. Use `inferRejectionReason(snapshot, action)` to pick the right error code.
2. **State value DID change but a guard later fails** (e.g., a guard on a `bet:place` action checks both phase and amount) → the first failing guard's name maps to an error code.

`inferRejectionReason` re-runs the guards for the action type in declaration order, returning the error code of the first one whose predicate returns false. This preserves the existing check order:

| Action | Check order (preserved) |
|---|---|
| `bet:place` | phase → amount → funds |
| `hand:hit`/`stand`/`double`/`split` | phase → active seat → hand lock → hand-specific guards |
| `round:start` | phase → all-bets-placed |
| `round:ready` | phase |
| `round:advance` | phase |

The wrapper throws before returning, so the public API still throws before any state change is visible to the caller.

### New error code: `DRAW_REQUIRED`

One new error code: `DRAW_REQUIRED`, thrown by `drawBridge.prepareEvent` when an action needs cards but `draw` is undefined. This is a wrapper-level error (not a guard-level error), because it's about the wrapper's input contract, not the state machine's behavior.

## Testing

### Existing tests: unchanged

The 24 unit tests in `server/test/state-machine.spec.ts` exercise the public `applyAction` API and assert on the public `GameState` shape. They pass unchanged because:
- The public `applyAction(state, action, draw?)` signature is identical.
- The public `GameState` shape is identical (reconstructed from the XState snapshot).
- The public `GameError` class is unchanged.
- The public `Action` type is unchanged.
- The card-drawing semantics are preserved (1 card for hit/double, 2 cards for split, etc.).

The Playwright E2E in `client/e2e/happy-path.spec.ts` is unaffected — it uses the public client API and the public server API; neither changes.

### New unit tests

A new file `server/test/state-machine-xstate.spec.ts` with focused tests on the machine's internal structure:

- **State graph shape** (~5 tests): the machine has exactly the 5 states; each state's transitions match the spec.
- **Guards** (~10 tests): each guard's predicate is tested with ctx/event combos that should pass and fail; error code mapping is correct.
- **Draw bridge** (~5 tests): `prepareEvent` for each event type attaches the right number of cards; throws `DRAW_REQUIRED` when `draw` is missing; `computeDealerEvent` pre-computes the dealer's hand correctly.
- **Snapshot roundtrip** (~2 tests): `toSnapshot` then `fromSnapshot` is identity (modulo `roomId` injection) for any `GameState` produced by the machine.

Total: ~20-22 new tests. Combined with the 24 existing tests, the state machine has ~45-46 unit tests.

### Verification gates (run after every commit)

- `cd server && npx tsc --noEmit` — TypeScript clean.
- `cd server && npx jest` — all 12+ suites pass, including the new file.
- `cd client && npx vitest run` — 41 client tests still pass (unaffected).
- `cd client && npx playwright test` — E2E still passes (unaffected).

## Migration Plan

The migration is a single, atomic refactor on the server side. No client changes. No gateway changes. No test-fixture changes (the 24 existing tests pass without edits).

### Tasks (each can be a separate commit)

1. **Add `xstate@^5` dependency** to `server/package.json`. Run `npm install`. Verify no version conflicts.

2. **Build `draw-bridge.ts`** with `prepareEvent` + `computeDealerEvent` logic, fully unit-tested in isolation. No XState yet.

3. **Build the XState machine in `state-machine.ts`** as a *new* module that imports from `draw-bridge.ts`. The public `applyAction` wrapper is a thin pass-through. **Don't delete the old imperative `apply*` functions yet** — keep them as a fallback for one commit.

4. **Migrate the 24 existing tests** to import from the new module. Run them; they should pass against the new XState implementation. If any test fails, fix the XState implementation, not the test (the tests encode the contract).

5. **Add the new structural test file** (`state-machine-xstate.spec.ts`) with the ~20 focused tests.

6. **Delete the old imperative `apply*` functions** from `state-machine.ts` once the XState implementation has all 24 + ~20 tests passing. Final commit is the cleanup.

### Risk mitigation

- Tasks 2 and 3 are decoupled: the draw bridge is tested independently, the XState machine is tested independently, the wrapper is tested via the existing 24 tests.
- The old imperative functions stay in the file through tasks 1-5, so if anything goes wrong, the file can be reverted with a single `git checkout`.
- The wire format is provably identical: `toSnapshot(GameState) → transition(event) → fromSnapshot(snapshot)` is byte-identical to the old `apply*` chain for any legal event.

## Success Criteria

- [ ] All 24 existing unit tests in `state-machine.spec.ts` pass unchanged.
- [ ] All ~20 new structural tests in `state-machine-xstate.spec.ts` pass.
- [ ] Server typecheck (`npx tsc --noEmit`) is clean.
- [ ] Client unit tests (41) still pass — unaffected.
- [ ] Playwright E2E still passes — unaffected.
- [ ] `state-machine.ts` is more readable: the XState graph is top-down, declarative, and the imperative phase checks are gone.
- [ ] `applyAction` wrapper is a thin pass-through (≤50 lines of orchestration logic; the rest is the XState machine definition).
- [ ] Public `applyAction` API, `GameState` shape, `Action` type, and `GameError` class are byte-identical to the current implementation.
- [ ] The XState machine is the single source of truth for state transitions. No other file knows the rules of blackjack.

## Open Questions

None. The design is complete and approved by the user in section-by-section review.

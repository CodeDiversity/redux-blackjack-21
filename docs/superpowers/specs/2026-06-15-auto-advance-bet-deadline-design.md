# Auto-Advance Rounds & Bet Deadline — Design Spec

**Date:** 2026-06-15
**Status:** Draft, awaiting user review
**Supersedes:** n/a
**Parent spec:** [`2026-06-14-next-hand-advance-design.md`](./2026-06-14-next-hand-advance-design.md) (the host "Next Hand" button introduced there is being removed)

## Goal

Replace the host-driven round advancement with two time-driven transitions on the server:

1. After a hand resolves (`settled`), wait **3 seconds**, then auto-advance to the betting phase. The host's "Next Hand" button is removed.
2. During the betting phase, players get a **10-second** window to place a bet. When the window closes, if at least one player has bet, deal the round and auto-sit-out any seated players who didn't bet. If zero players have bet, re-loop the betting window.

The lobby's "Begin Betting" host gate is preserved. The deal can still be triggered early by the host (Deal button is kept but relaxed to require ≥1 bet rather than all bets).

## Non-Goals

- Changing the disconnect-grace behavior (`Config.DISCONNECT_GRACE_MS`). The 30s grace is independent of the new 3s/10s timers.
- Adding persistent storage of `phaseEndsAt` to localStorage. A reconnecting client gets a fresh value on the next broadcast.
- Animations for the transition between phases.
- Per-player bet timers (one shared room-level window).
- A "Deal Now" host accelerator that short-circuits the 10s bet window. The Deal button stays but is no longer required.
- Animating the countdown digits.

## Constraints / Decisions Locked In

| Decision | Choice | Why |
|---|---|---|
| Where timers live | Gateway, not the state machine | Mirrors the existing disconnect-grace pattern. State machine refactor was explicit that timers belong outside the machine. |
| Phase auto-advance trigger | Server-internal `setTimeout` keyed by `roomId` | One timer per room; cancelled on phase change. |
| New state machine action | `round:betDeadline` (server-internal, not on `ClientCommand`) | Same shape as `round:start` (with pre-drawn `dealtCards` and `dealerUpcard`) so the deal step reuses `assignDeal`. |
| `round:advance` trigger | Server-internal `setTimeout` 3s after entering `settled` | Reuses the existing `round:advance` action; just changes who fires it (gateway, not host). |
| Zero-bet end of bet window | Re-loop to `betting` (per user) | Avoids an infinite-spin edge case; new 10s window opens immediately. |
| `round:start` host button | Keep, but relax guard to `hasAtLeastOneBet` | Host can still short-circuit the 10s window by clicking Deal. |
| Lobby "Begin Betting" | Keep host-gated | Per user. The 10s window starts on entering `betting` from any path. |
| Countdown UI | Both 3s and 10s shown to clients | Per user. |
| `phaseEndsAt` field on `GameState` | New; server-broadcast only | Lets client render countdowns without an extra wire event. |
| Source of truth for clock | Server (`phaseEndsAt` is a ms-epoch from the server's clock) | Client computes `remaining = phaseEndsAt - Date.now()`. |
| `round:advance` in `ClientCommand` | Removed | No client emits it; only the gateway's 3s timer. |
| `round:advance` in `Action` / `GameEvent` | Kept | Still used by the 3s timer. |

## Architecture

The split is the same as the disconnect-grace refactor and the state-machine refactor: state machine = "what is true after this event"; gateway = "when does the next event fire."

| Layer | Responsibility | What changes |
|---|---|---|
| State machine | Pure transitions; no `Date.now()`; no `setTimeout` | New action `round:betDeadline`; new guard `hasAtLeastOneBet`; new `assignBetDeadline` (sits out unbetters + deals) and `assignBetDeadlineEmpty` (re-loops); existing `assignDeal` is refactored to share logic with the new path. The `round:start` guard is relaxed to `hasAtLeastOneBet`. |
| Gateway | Side effects: timers, broadcasts, host check, room lifecycle | New `pendingTimers` map keyed by `roomId` storing `{ timer, fireAt }`; new `scheduleAutoAdvance` / `cancelAutoAdvance` / `fireAutoAdvance`; new `attachPhaseEndsAt` helper that decorates `game:state` payloads with the timer's `fireAt`; `broadcastAll` now drives timer scheduling off the post-transition phase. The `@SubscribeMessage('round:advance')` and its handler are removed (the gateway's `onAdvance` is no longer needed; the timer fires the action via `rooms.apply`). |
| Config | Tunable durations | `SETTLE_PAUSE_MS: 3_000`, `BET_DEADLINE_MS: 10_000`. |
| Client | View | New `useNow` hook; countdown line in `ResultOverlay` (3s) and `BetPanel` (10s); `DealButton` removed; `selectPhaseEndsAt` selector. |

## State Machine Changes

### New action: `round:betDeadline`

```ts
// server/src/game/state-machine.ts
export type Action =
  | ...
  | { type: 'round:betDeadline'; seatId: string };
```

**Not** in `ClientCommand` — only the gateway produces it. The state machine accepts it like any other action.

### New `GameEvent` variant

```ts
| { type: 'round:betDeadline'; seatId: string; dealtCards: { playerIndex: number; cards: [Card, Card] }[]; dealerUpcard: Card }
```

Same shape as `round:start`: pre-drawn by the gateway via `drawBridge.prepareEvent`, attached to the event. The state machine's assign step uses the same `dealtCards` / `dealerUpcard` payload.

### New guard: `hasAtLeastOneBet`

```ts
{ name: 'hasAtLeastOneBet', errorCode: 'NO_BETS',
  predicate: (s) => s.players.some((p) =>
    p.status !== 'empty' && p.status !== 'sitting_out' && p.hands[0]?.bet > 0) },
```

The `errorCode` is new: `NO_BETS`. Thrown by `round:start` / `round:betDeadline` arriving when 0 players have bet — except the fallback transition (re-loop) handles that case, so `NO_BETS` is effectively never thrown on the wire. It exists in the union for `inferRejectionReason` and for tests.

### Relaxed `round:start` guard

`round:start` previously required `allPlayersReady` (every seated player has bet). It now uses `hasAtLeastOneBet`. The host's "Deal" button can short-circuit the 10s bet window with a single bet placed.

### New `assignBetDeadline`

A thin wrapper that:
1. Auto-sits-out seated players with `hands[0].bet === 0` (status flips to `sitting_out`).
2. Calls a refactored shared deal helper to populate cards.

```ts
// Factor the existing assignDeal logic into a shared helper:
function dealAndMaybeSitOut(
  players: PlayerSeat[],
  dealtCards: { playerIndex: number; cards: [Card, Card] }[],
  dealerUpcard: Card,
  sitOutUnbetters: boolean,
): PlayerSeat[] { ... }
```

`assignDeal` calls it with `sitOutUnbetters: false` (host already validated all bet). `assignBetDeadline` calls it with `sitOutUnbetters: true`. No duplication.

### New `assignBetDeadlineEmpty`

Re-loop path. Resets the action counter and clears `activeSeat` and `lastResult`, but **leaves the players' bets in place** so the next 10s window continues to allow rebets / new bets. Equivalent to `assignReady`-shaped:

```ts
{ __actionCount: context.__actionCount + 1, activeSeat: null, lastResult: null }
```

### New transitions on the `betting` state

```ts
betting: {
  on: {
    'bet:place': { actions: 'assignBet', guard: and(['isValidBetAmount', 'hasSufficientFundsForBet']) },
    'round:start': { target: 'player_turn', actions: 'assignDeal', guard: 'hasAtLeastOneBet' },
    'round:betDeadline': [
      { target: 'player_turn', actions: 'assignBetDeadline', guard: 'hasAtLeastOneBet' },
      { target: 'betting', actions: 'assignBetDeadlineEmpty' },
    ],
  },
},
```

XState v5 evaluates transitions in order. The first matching transition fires; the second is the fallback.

### `actionGuards` map addition

```ts
'round:betDeadline': ['hasAtLeastOneBet'],
```

(Used for `inferRejectionReason`; the fallback transition handles the failure case directly.)

### Summary of state-machine deltas

| Item | Change |
|---|---|
| `Action` type | Add `round:betDeadline` |
| `GameEvent` type | Add same variant, with `dealtCards` and `dealerUpcard` pre-attached |
| `ClientCommand` type | Remove `round:advance` (no client emits it) |
| Guards | Add `hasAtLeastOneBet`; relax `round:start` to use it |
| `actionGuards` map | Add `round:betDeadline: ['hasAtLeastOneBet']` |
| Assigns | Add `assignBetDeadline` and `assignBetDeadlineEmpty`; factor shared deal logic from `assignDeal` into a helper |
| Transitions | `betting` state: add `round:betDeadline` with two transitions (deal vs. re-loop) |
| `errorCode` `NO_BETS` | New |

## Gateway Changes

### Pending timer map (mirrors the existing `pendingLeaves` pattern)

```ts
private pendingTimers = new Map<string, { timer: NodeJS.Timeout; fireAt: number }>();
```

One entry per `roomId`. The value holds the `setTimeout` handle and the ms-epoch when it will fire. Re-entering the same phase cancels and reschedules (handled in `scheduleAutoAdvance`).

### Scheduling

```ts
private scheduleAutoAdvance(roomId: string, phase: 'settled' | 'betting') {
  this.cancelAutoAdvance(roomId);
  const ms = phase === 'settled' ? Config.SETTLE_PAUSE_MS : Config.BET_DEADLINE_MS;
  const fireAt = Date.now() + ms;
  const timer = setTimeout(() => this.fireAutoAdvance(roomId, phase), ms);
  this.pendingTimers.set(roomId, { timer, fireAt });
}

private cancelAutoAdvance(roomId: string) {
  const entry = this.pendingTimers.get(roomId);
  if (entry) { clearTimeout(entry.timer); this.pendingTimers.delete(roomId); }
}
```

`onModuleDestroy` clears the new map alongside `pendingLeaves`.

### Firing

```ts
private fireAutoAdvance(roomId: string, phase: 'settled' | 'betting') {
  this.pendingTimers.delete(roomId);
  const room = this.rooms.getState(roomId);
  if (!room) return;
  if (room.phase !== phase) return;  // race: phase changed
  try {
    if (phase === 'settled') {
      // Server-internal round:advance. seatId '__server__' is a sentinel for tracing.
      this.rooms.apply(roomId, { type: 'round:advance', seatId: '__server__' });
    } else {
      // betting → deal or re-loop. Mirror round:start: pre-draw cards via ensureShoe + draw.
      this.games.ensureShoe(roomId, this.rooms.getState(roomId)!);
      const draw = () => this.games.draw(roomId).card;
      this.rooms.apply(roomId,
        { type: 'round:betDeadline', seatId: '__server__' },
        draw,
      );
    }
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    // Reached if NO_BETS is thrown. With the fallback transition in place, this
    // shouldn't happen — but log defensively.
    this.log.warn(`auto-advance failed: ${(e as GameError).code}`);
  }
}
```

The `'__server__'` literal is a sentinel `seatId`. The state machine's `isActiveSeat` guard returns `true` for non-hand actions, so it passes through; the gateway logs the sentinel as a tracer for server-internal transitions.

### Hook into `broadcastAll`

```ts
private broadcastAll(roomId: string, state: GameState) {
  const lobby = this.rooms.getLobbyState(roomId);
  if (lobby) this.server.to(roomId).emit('lobby:state', lobby);
  const publicState = this.attachPhaseEndsAt(roomId, state);
  this.server.to(roomId).emit('game:state', publicState);
  if (state.phase === 'settled' && state.lastResult) this.server.to(roomId).emit('round:result', state.lastResult);

  // Drive timers off the new phase.
  if (state.phase === 'settled') this.scheduleAutoAdvance(roomId, 'settled');
  else if (state.phase === 'betting') this.scheduleAutoAdvance(roomId, 'betting');
  else this.cancelAutoAdvance(roomId);
}
```

`broadcastAll` is called from `onReady`, `onAdvance` (now removed), `onStart`, `onBet`, hand actions, `handleConnection`, and `handleDisconnect`'s deferred-leave callback. The post-transition phase drives the timer schedule automatically.

### `attachPhaseEndsAt`

```ts
private attachPhaseEndsAt(roomId: string, state: GameState): GameState {
  if (state.phase !== 'settled' && state.phase !== 'betting') {
    return { ...state, phaseEndsAt: null };
  }
  const entry = this.pendingTimers.get(roomId);
  if (!entry) return { ...state, phaseEndsAt: null };
  return { ...state, phaseEndsAt: entry.fireAt };
}
```

### Removal of the `round:advance` socket handler

- `@SubscribeMessage('round:advance')` decorator and `onAdvance` method are **deleted**.
- `{ type: 'round:advance' }` is **removed from `ClientCommand`** (the wire shape).
- The state machine's `Action` and `GameEvent` types **keep** `round:advance` — only the gateway's 3s timer fires it now.

If a (now-stale) client emits `round:advance`, socket.io returns a no-handler error. The server is unaffected.

### Cancel on room destruction

`handleDisconnect`'s deferred-leave callback calls `games.discardRoom(roomId)` when the last player leaves. Add a `cancelAutoAdvance(roomId)` call right before discarding so the pending timer is cleared:

```ts
const { state, destroyed } = this.rooms.leaveRoom(roomId, oldSocketId);
if (destroyed) {
  this.cancelAutoAdvance(roomId);  // NEW
  this.games.discardRoom(roomId);
  return;
}
```

## Wire / State Shape

### `GameState.phaseEndsAt: number | null`

Additive field, default `null`. Server-broadcast only — the state machine never sets it, the gateway attaches it in `attachPhaseEndsAt` for `settled` / `betting` phases and `null` otherwise. Not part of the XState `Context`, so the machine stays pure.

```ts
// server/src/shared/types.ts + client/src/shared/types.ts
export type GameState = {
  roomId: string;
  phase: Phase;
  phaseEndsAt: number | null;   // NEW: ms epoch; null when no active timer
  shoeSize: number;
  cutCardIndex: number;
  players: PlayerSeat[];
  dealer: Hand;
  activeSeat: number | null;
  roundNumber: number;
  lastResult: RoundResult | null;
};
```

### Removed wire events / commands

| Removed | Reason |
|---|---|
| `ClientCommand: { type: 'round:advance' }` | No client emits it. |
| `@SubscribeMessage('round:advance')` | No client emits. |
| `getSocket().emit('round:advance')` in `ResultOverlay.tsx` | Button removed. |

### Unchanged wire events / commands

`lobby:state`, `game:state` (with new field), `round:result`, `error`, `bet:place`, `hand:hit`, `hand:stand`, `hand:double`, `hand:split`, `round:ready`, `room:create`, `room:join`, `room:resume`.

### `ErrorCode` union

Add `'NO_BETS'` to `ErrorCode` and `ErrorMessages` in `server/src/shared/errors.ts` and the client mirror. Never surfaced on the wire in practice; included for `inferRejectionReason` and tests.

## Client UI

### `<ResultOverlay>` changes

- Still renders when `phase === 'settled' && lastResult`.
- **Remove** the host-gated "Next Hand" button.
- Add a small countdown line below the payouts: `Next hand in {N}…` (textSecondary, smallSize). `N` is `Math.max(0, Math.ceil((phaseEndsAt - now) / 1000))`. Updates every second via `useNow(1000)`. The overlay unmounts naturally when the next broadcast transitions to `betting`.

### `<BetPanel>` changes

- Adds a small countdown line: `Betting closes in {N}…` (textDim, smallSize). Same `useNow(1000)` pattern. Renders only when `phase === 'betting' && phaseEndsAt` is non-null. Positioned below the input and buttons.

### `<DealButton>` removal

The Deal button (host's `round:start` accelerator) is **removed**. Rationale: the 10s timer is the only path out of `betting`; a host-side accelerator adds complexity without clear benefit. The state machine still accepts `round:start` (in case a future feature wants it); the gateway's `onStart` handler stays as dead code for now (or is removed for cleanliness — TBD in implementation).

### `useNow` hook (new, `client/src/lib/useNow.ts`)

```ts
import { useEffect, useState } from 'react';
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

### Selector additions

`client/src/selectors/self.ts`:

```ts
export const selectPhaseEndsAt = (s: RootState) => s.game.state?.phaseEndsAt ?? null;
```

## Data Flows

### Settle-pause auto-advance (3s)

```
[settled]
  │  Dealer turn resolves; assignSettle runs; broadcast
  │
  ▼
broadcastAll(roomId, settledState)
  │  attachPhaseEndsAt → phaseEndsAt = now + 3_000
  │  scheduleAutoAdvance('settled')
  │
  ▼
[3_000 ms pass]
  │
  ▼
fireAutoAdvance(roomId, 'settled')
  │  rooms.apply({ type: 'round:advance', seatId: '__server__' })
  │  state machine: settled → betting (assignAdvance)
  │
  ▼
broadcastAll(roomId, bettingState)
  │  phaseEndsAt = now + 10_000 (bet window starts)
  │  scheduleAutoAdvance('betting')
  │
  ▼
Client renders BetPanel with "Betting closes in 10…"
```

### Bet-deadline auto-deal (10s, ≥1 bet)

```
[betting, t = 0]
  │  scheduleAutoAdvance('betting')
  │
  ▼
[t = 0..10_000]
  │  Players emit bet:place; applyAction mutates state;
  │  broadcastAll re-broadcasts (phase still 'betting');
  │  broadcastAll does NOT reschedule — only `settled`/`betting`
  │  entry into those phases schedules; staying in 'betting' does not.
  │
  ▼
[t = 10_000]
  │
  ▼
fireAutoAdvance(roomId, 'betting')
  │  rooms.apply({ type: 'round:betDeadline' }, draw)
  │  state machine: first transition guard hasAtLeastOneBet passes
  │  → betting → player_turn, assignBetDeadline
  │  assignBetDeadline: sat-out unbetters, deal cards
  │
  ▼
broadcastAll(roomId, playerTurnState)
  │  phaseEndsAt = null
  │  cancelAutoAdvance (else branch)
```

### Bet-deadline re-loop (10s, 0 bets)

```
[betting, t = 0]
  │
  ▼
[t = 10_000, no bets placed]
  │
  ▼
fireAutoAdvance(roomId, 'betting')
  │  rooms.apply({ type: 'round:betDeadline' }, draw)
  │  state machine: first transition guard fails (0 bets)
  │  → second transition (no guard): betting → betting, assignBetDeadlineEmpty
  │
  ▼
broadcastAll(roomId, bettingState)
  │  phase === 'betting' → scheduleAutoAdvance('betting') (fresh 10s)
  │
  ▼
Client: countdown restarts at 10
```

## Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| Timer fires after phase changed | `fireAutoAdvance` bails on `room.phase !== phase` |
| New player joins mid-bet-window | Inherits remaining time on the existing timer |
| Player leaves mid-bet-window | Disconnect-grace defers seat removal; bet window unaffected |
| `bet:place` arrives within 100ms of the deadline | Race: succeeds if processed first; rejected with `INVALID_PHASE` if the deal landed first. Acceptable; client countdown is approximate. |
| Host disconnects mid-bet-window | 30s grace; deal still fires from server timer; `pickHost` re-picks on grace expiry |
| Room destroyed (last player leaves) mid-timer | `cancelAutoAdvance` called at destruction site in `handleDisconnect`'s deferred-leave callback |
| `phaseEndsAt: null` in a timed phase (defensive) | Client hides countdown; no error |
| Reconnect mid-timer | Next broadcast carries a fresh `phaseEndsAt` |
| Malicious client emits `round:betDeadline` | No socket handler; socket.io error. State machine accepts it (server-internal), but only the gateway fires it. |
| Malicious client emits `round:advance` after removal | No socket handler; socket.io error |
| Client clock skew | Countdown is approximate; server is authoritative — the round always advances on the server's clock |

## Testing Strategy

### Server unit (Jest)

**`state-machine.spec.ts` (extend)**:

- `applyAction: round:betDeadline` describe block:
  - When at least one player has bet, transitions `betting → player_turn` and assigns dealt cards to the betting player(s).
  - Auto-sits-out seated players with `hands[0].bet === 0` (status flips to `sitting_out`).
  - Preserves `lastBet` on sat-out players.
  - Re-loops `betting → betting` (with `__actionCount` incremented) when 0 players have bet.
  - Re-loops without clearing existing bets.
  - Does not affect `empty` or already-`sitting_out` seats.
- `applyAction: round:start` (modify existing): add a test that the relaxed guard allows `round:start` when only 1 of 2 seated players has bet.
- `hasAtLeastOneBet` guard unit tests: returns true when ≥1 seated player has `hands[0].bet > 0`; false when all seated players have `hands[0].bet === 0`; false when no players are seated; ignores `empty` / `sitting_out`.

**`state-machine-xstate.spec.ts` (extend)**:

- The `betting` state has two transitions for `round:betDeadline`: one to `player_turn` (guarded by `hasAtLeastOneBet`), one to `betting` (fallback re-loop).
- The `betting` state still accepts `round:start` with the new guard.

**`gateway-auto-advance.spec.ts` (new)**:

- 3s settle-pause: in `settled`, after 3s with no client input, `round:advance` is auto-fired; `game:state` transitions to `betting`; `phaseEndsAt` is set.
- 10s bet-deadline with ≥1 bet: in `betting`, after 10s with ≥1 player bet, `round:betDeadline` is auto-fired; transitions to `player_turn`; non-betters' seats go to `sitting_out`.
- 10s bet-deadline with 0 bets: in `betting`, after 10s with no bets, the round re-loops; broadcast stays in `betting` with a fresh `phaseEndsAt`.
- `phaseEndsAt` is `null` when entering `player_turn` / `dealer_turn` / `lobby` and a positive ms-epoch when entering `betting` / `settled`.
- `round:advance` socket message removed: emitting from the client now returns a socket.io error (no handler).
- Use `jest.useFakeTimers()` for time-based tests.

### Client unit (Vitest)

**`useNow` hook** (`client/test/lib/useNow.spec.ts`, new):
- Returns current time; advances when `setInterval` fires; cleans up on unmount. Use `vi.useFakeTimers()`.

**`ResultOverlay` component** (`client/test/components/ResultOverlay.spec.tsx`, new):
- Renders when `phase === 'settled' && lastResult` is truthy.
- Does **not** render "Next Hand" button (regression).
- Renders the countdown line `Next hand in {N}…` with `N === 3` initially, then `2`, then `1` (using fake timers).

**`BetPanel` component** (`client/test/components/BetPanel.spec.tsx`, new):
- Renders the countdown `Betting closes in {N}…` with `N === 10` initially.
- Updates countdown every second.
- Does not render countdown when `phaseEndsAt` is null.
- Does not render the countdown outside `betting` phase.

**`DealButton` removal**: a regression test asserting the component is no longer rendered in `TableView`.

### Client E2E (Playwright) — `client/e2e/auto-advance.spec.ts` (new)

- **3s settle-pause**: two players, host starts, both bet, deal, both stand, hand resolves. Assert `ResultOverlay` shows "Next hand in 3…2…1". After ~3.5s, assert `BetPanel` is visible.
- **10s bet deadline with ≥1 bet**: two players, host starts. Player A bets; Player B doesn't. Assert `BetPanel` shows "Betting closes in 10…9…8…". Wait ~10.5s; assert dealer area is visible; assert Player B's seat shows `sitting_out` in the PlayerList.
- **10s bet deadline with 0 bets**: two players, host starts, neither bets. Wait ~10.5s; assert still in `betting`; assert countdown has restarted (10s remaining). Player A now bets; wait ~10.5s; assert `dealing` started; Player B sat out.

### Verification gates

- `cd server && npx tsc --noEmit`
- `cd server && npx jest` — all suites pass, including the new gateway-auto-advance file
- `cd client && npx vitest run` — including the new component and hook tests
- `cd client && npx playwright test` — including the new auto-advance spec

## File-by-File Change List

| File | Change |
|---|---|
| `server/src/config.ts` | Add `SETTLE_PAUSE_MS = 3_000`, `BET_DEADLINE_MS = 10_000` |
| `server/src/shared/types.ts` | Add `phaseEndsAt: number \| null` to `GameState`; remove `round:advance` from `ClientCommand`; add `NO_BETS` to `ErrorCode` |
| `server/src/shared/errors.ts` | Add `NO_BETS` to `ErrorMessages` |
| `server/src/game/state-machine.ts` | Add `round:betDeadline` action; relax `round:start` guard; add `hasAtLeastOneBet` guard; add `assignBetDeadline` and `assignBetDeadlineEmpty`; factor `assignDeal` to share logic |
| `server/src/gateway/game.gateway.ts` | Add `pendingTimers` map; add `scheduleAutoAdvance` / `cancelAutoAdvance` / `fireAutoAdvance` / `attachPhaseEndsAt`; modify `broadcastAll` to drive timers; remove `@SubscribeMessage('round:advance')` and `onAdvance`; cancel timer on room destroy |
| `server/test/state-machine.spec.ts` | Add `round:betDeadline` describe; add `hasAtLeastOneBet` tests; relax `round:start` test |
| `server/test/state-machine-xstate.spec.ts` | Add betting-state transition tests |
| `server/test/gateway-auto-advance.spec.ts` (new) | Timer-driven auto-advance tests |
| `client/src/shared/types.ts` | Add `phaseEndsAt: number \| null` to `GameState` |
| `client/src/shared/error-codes.ts` (or equivalent) | Add `NO_BETS` (defensive; never surfaced in practice) |
| `client/src/selectors/self.ts` | Add `selectPhaseEndsAt` |
| `client/src/lib/useNow.ts` (new) | `useNow(intervalMs)` hook |
| `client/src/components/ResultOverlay.tsx` | Remove "Next Hand" button; add countdown line |
| `client/src/components/BetPanel.tsx` | Add countdown line |
| `client/src/components/DealButton.tsx` | **Removed** (file may be deleted or left as dead code; TBD in implementation) |
| `client/test/lib/useNow.spec.ts` (new) | Hook unit tests |
| `client/test/components/ResultOverlay.spec.tsx` (new) | Component tests |
| `client/test/components/BetPanel.spec.tsx` (new) | Component tests |
| `client/test/components/TableView.spec.tsx` (or extend) | Regression: `DealButton` not rendered |
| `client/e2e/auto-advance.spec.ts` (new) | E2E tests for 3s settle-pause and 10s bet-deadline |

## Open Questions (non-blocking)

- **TBD in implementation:** delete `client/src/components/DealButton.tsx` outright, or leave as dead code in case a future feature wants a host-side accelerator. The state machine still accepts `round:start`; the gateway's `onStart` could stay or be removed.
- **Disconnected player during a bet window** keeps their seat through the 30s grace. If they reconnect within grace and place a bet, the existing reconnect flow handles it. No change.
- **A player who is `sitting_out` because they didn't bet last round** keeps `lastBet` (preserved by `assignBetDeadline`). On the next `betting` phase, the Rebet button is available. The 10s window does **not** restart when a sitting-out player returns. Acceptable.
- **The `DealButton` is removed; the host's "Begin Betting" remains.** If the table is hostless after a host disconnect + 30s grace, `pickHost` re-picks. The new host can then start the next lobby round. Auto-advance from `settled` continues to work without a host.

## Known Follow-ups (deferred)

- Persistence of `phaseEndsAt` across reconnect (client recomputes from latest broadcast; persisting risks staleness).
- An optional host-side "Deal Now" accelerator (would re-add a Deal button).
- Animation of the countdown digits.
- Per-player bet timers (currently one shared 10s room window).
- Server-sent countdown events for clients with unreliable clocks (out of scope; client uses `Date.now()` for display only).

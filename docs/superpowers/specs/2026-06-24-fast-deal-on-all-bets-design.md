# Fast Deal on All Bets Placed

**Date:** 2026-06-24
**Status:** Draft — pending user review
**Supersedes:** n/a
**Parent spec:** [`2026-06-15-auto-advance-bet-deadline-design.md`](./2026-06-15-auto-advance-bet-deadline-design.md) (the 10s `BET_DEADLINE_MS` window is preserved as the fallback)

## Problem

The auto-advance bet-deadline spec gives every `betting` phase a 10-second window before the deal fires (`BET_DEADLINE_MS`). When the table is solo, the host sits through the full countdown after placing their bet. When multiplayer seats are all in, the table also waits the full countdown for no reason — everyone has already committed. Both are friction the game doesn't need.

## Goal

End the `betting` phase immediately (no remaining countdown, no grace period) the moment every active player has placed a bet. Single-player is a special case of this — with one active player, the condition is satisfied the instant they bet. Multiplayer "all in" follows the same path.

The existing 10s `BET_DEADLINE_MS` window stays as the fallback for slow players who don't bet in time.

## Non-Goals

- Skipping the 3s `SETTLE_PAUSE_MS` (between a hand resolving and the next betting phase). Per user, only the betting-phase exit is touched.
- Shortening or removing the 2s `DEALING_DURATION_MS`. Card-deal animation timing is unchanged.
- Adding a host-side "Deal Now" button. Auto-advance stays the only path out of `betting`; we just make it react earlier.
- Touching the state machine. The existing `round:betDeadline` action and `assignBetDeadline` transition are reused unchanged.
- Changing the zero-bet re-loop path. If nobody bets in 10s, the loop still re-enters `betting` with a fresh 10s window.
- Sitting-out player behavior or `lastBet` rebet flow.

## Design

### Where it lives

Server-only change in `server/src/gateway/game.gateway.ts`. One new helper, one extracted shared helper, and one modified `@SubscribeMessage('bet:place')` handler.

### New helper: `allActivePlayersHaveBet`

```ts
private allActivePlayersHaveBet(state: GameState): boolean {
  // Active = not empty, not sitting_out. The caller has just applied a
  // successful bet:place, so there's at least one player with bet > 0; this
  // returns true iff no other active player is still missing a bet.
  return state.players.every((p) =>
    p.status === 'empty' || p.status === 'sitting_out' || (p.hands[0]?.bet ?? 0) > 0);
}
```

Mirrors the existing `hasAtLeastOneBet` state-machine guard's notion of "active" (`status !== 'empty' && status !== 'sitting_out'`) but inverts the predicate as "all" instead of "some". Could be added to the state machine as a `allSeatedPlayersHaveBet` guard, but keeping it gateway-side avoids touching the machine and keeps the early-exit decision co-located with the timer cancellation logic.

### Extracted shared helper: `fireBetDeadlineNow`

```ts
private fireBetDeadlineNow(roomId: string): GameState {
  this.games.ensureShoe(roomId, this.rooms.getState(roomId)!);
  const draw = () => this.games.draw(roomId).card;
  return this.rooms.apply(
    roomId,
    { type: 'round:betDeadline', seatId: '__server__' },
    draw,
  );
}
```

`fireAutoAdvance('betting')` and the new early-exit path both use this. Eliminates the duplication of the "ensure shoe + draw + apply `round:betDeadline`" sequence.

`fireAutoAdvance` shrinks to:

```ts
private fireAutoAdvance(roomId: string, phase: 'settled' | 'betting' | 'dealing') {
  this.pendingTimers.delete(roomId);
  const room = this.rooms.getState(roomId);
  if (!room) return;
  if (room.phase !== phase) return;  // race: phase changed
  try {
    if (phase === 'settled') {
      this.rooms.apply(roomId, { type: 'round:advance', seatId: '__server__' });
      this.broadcastAll(roomId, this.rooms.getState(roomId)!);
    } else if (phase === 'dealing') {
      this.rooms.apply(roomId, { type: 'round:dealingComplete', seatId: '__server__' });
      this.broadcastAll(roomId, this.rooms.getState(roomId)!);
    } else {
      this.fireBetDeadlineNow(roomId);
      this.broadcastAll(roomId, this.rooms.getState(roomId)!);
    }
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    this.log.warn(`auto-advance failed: ${(e as GameError).code}`);
  }
}
```

### Modified `onBet`

```ts
@SubscribeMessage('bet:place')
onBet(@ConnectedSocket() client: Socket, @MessageBody() body: { amount: number }) {
  const ctx = this.rooms.roomForSocket(client.id);
  if (!ctx) return this.sendError(client, 'NOT_YOUR_TURN');
  try {
    let state = this.rooms.apply(ctx.roomId, { type: 'bet:place', seatId: ctx.seatId, amount: body.amount });

    // Early exit: if every active player has now bet, skip the 10s deadline.
    if (state.phase === 'betting' && this.allActivePlayersHaveBet(state)) {
      this.cancelAutoAdvance(ctx.roomId);              // kill the 10s fallback timer
      state = this.fireBetDeadlineNow(ctx.roomId);     // deal immediately
    }

    this.broadcastAll(ctx.roomId, state);
  } catch (e) {
    if (e instanceof GameError) return this.sendError(client, e.code as any);
    throw e;
  }
}
```

The bet and the early-exit deal happen in the same socket roundtrip. Clients see a single transition (`betting → dealing`), not a countdown finishing.

### Why this is monotonic and safe

- The 10s `BET_DEADLINE_MS` fallback is preserved. Slow betters who don't meet the early-exit condition see no change.
- The same `round:betDeadline` action and `assignBetDeadline` transition handle both paths. No new state-machine event type, no new transition.
- `cancelAutoAdvance` is safe to call when no timer is pending — it's a no-op on an empty `pendingTimers` entry.
- `broadcastAll` is called exactly once per `onBet`, regardless of whether early-exit fires. Phase transitions and `phaseEndsAt` are coherent.

## Behavior

### Single-player (host alone)

1. Host opens Home, enters a name, clicks **Create Room**.
2. Lands in `TableView` as the only seat, lobby phase.
3. Clicks **Begin Betting** → `round:ready` → phase `betting`. 10s fallback timer scheduled.
4. Host enters bet (10–500), clicks **Place Bet**.
5. `onBet` applies the bet. `allActivePlayersHaveBet` returns true (only active player, they bet).
6. `cancelAutoAdvance` clears the 10s timer. `fireBetDeadlineNow` applies `round:betDeadline`; state transitions to `dealing`.
7. Single broadcast: phase `dealing`, `phaseEndsAt` set to `now + DEALING_DURATION_MS` (2s).
8. Cards animate in. Host plays their hand. Same as today.

**Before this change:** Step 5–7 took ~10s. **After:** ~one socket roundtrip (milliseconds).

### Multiplayer all-in

1. 5 players seated. Host clicks **Begin Betting** → phase `betting`, 10s timer scheduled.
2. Player A bets. `onBet` applies. `allActivePlayersHaveBet` returns false (B, C, D, E still have bet 0). Single broadcast: phase `betting`, `phaseEndsAt` unchanged.
3. Player B bets. Same — still in `betting`, 10s timer still running.
4. Player C bets. Same.
5. Player D bets. Same.
6. Player E bets. `onBet` applies. `allActivePlayersHaveBet` returns true. `cancelAutoAdvance` clears the 10s timer. `fireBetDeadlineNow` applies `round:betDeadline`. Single broadcast: phase `dealing`.
7. Cards animate in. All five players play their hands. Same as today.

### Multiplayer slow better (regression)

1. 2 players seated. Host clicks **Begin Betting** → phase `betting`, 10s timer scheduled.
2. Player A bets. `onBet` applies. `allActivePlayersHaveBet` returns false. Broadcast.
3. Player B never bets.
4. After 10s, `fireAutoAdvance('betting')` fires. State transitions to `dealing` via `assignBetDeadline`. Player B is set to `sitting_out` by `assignBetDeadline`. Broadcast.

**Unchanged behavior** — covered by the existing `gateway-auto-advance.spec.ts` regression suite.

### Zero-bet re-loop (regression)

1. 2 players seated. Host clicks **Begin Betting** → phase `betting`, 10s timer scheduled.
2. Neither player bets.
3. After 10s, `fireAutoAdvance('betting')` fires. State stays in `betting` via `assignBetDeadlineEmpty` (fallback transition). Fresh 10s timer scheduled. Broadcast.

**Unchanged behavior** — covered by the existing `gateway-auto-advance.spec.ts` regression suite.

## Data Flows

### Single-player immediate deal

```
client emits bet:place
  │  onBet
  ▼
rooms.apply({ type: 'bet:place', seatId, amount })
  │  state.phase = 'betting', seat's status='betting', hands[0].bet = amount
  ▼
allActivePlayersHaveBet(state) === true   (single active player, they bet)
  │
  ▼
cancelAutoAdvance(roomId)                 // clears pending 10s timer
  │
  ▼
fireBetDeadlineNow(roomId)
  │  ensureShoe + draw() + rooms.apply({ type: 'round:betDeadline', seatId: '__server__' })
  │  state.phase = 'dealing', seats get dealt cards
  ▼
broadcastAll(roomId, state)
  │  attachPhaseEndsAt → phaseEndsAt = now + DEALING_DURATION_MS (2s)
  │  scheduleAutoAdvance('dealing')
  ▼
clients receive game:state (phase=dealing)
```

### Multiplayer all-in (last of N bets)

Same as above but the early-exit branch is taken when the *Nth* player bets. Each preceding `bet:place` follows the existing path (broadcast only, no early-exit).

### Slow better (regression, unchanged)

```
[t=0]   fireAutoAdvance('betting') scheduled (10s)
[t=0..10_000]
        bet:place events apply; broadcastAll re-broadcasts; no reschedule
[t=10_000]
        fireAutoAdvance('betting') fires
          rooms.apply({ type: 'round:betDeadline' }, draw)
          state: betting → dealing (assignBetDeadline, sits out unbetters)
        broadcastAll
```

## Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| Single player bets | `allActivePlayersHaveBet` true; early-exit fires |
| Last of N players bets | Same; early-exit fires |
| Player bets while another is mid-typing | Peer doesn't bet in time; 10s fallback fires; `assignBetDeadline` sits them out. Unchanged. |
| Player leaves during betting | Seat becomes `sitting_out` via disconnect-grace; `allActivePlayersHaveBet` correctly excludes them |
| New player joins during betting | Seat becomes active (`status='betting'`, `bet=0`); early-exit waits for them. Existing 10s timer remains. |
| Zero-bet re-loop path | Unchanged. `allActivePlayersHaveBet` requires at least one bet (a `bet:place` just succeeded) |
| Two near-simultaneous bets from different players | Each goes through `onBet` serially via socket.io. First bet's broadcast may show all-but-one having bet; second bet triggers early-exit. One final broadcast at phase `dealing`. The 10s timer scheduled by the first `broadcastAll` is cancelled by the second `cancelAutoAdvance`. |
| `bet:place` rejected (INVALID_PHASE etc.) | `apply` throws `GameError`; handler returns `sendError`. Early-exit code never runs. |
| Host disconnects mid-betting | `pendingLeaves` defers seat removal; early-exit unaffected. 10s timer still fires from server. |
| Room destroyed mid-betting | `cancelAutoAdvance` already called at destruction site in `handleDisconnect`'s deferred-leave callback; early-exit's `cancelAutoAdvance` is a no-op on a cleared entry |
| `phaseEndsAt` drift on early-exit | `cancelAutoAdvance` deletes the `pendingTimers` entry; `attachPhaseEndsAt` returns `null`. Clients with stale countdowns (a flash of "Betting closes in N…") snap to `null` on the next broadcast. |
| `fireBetDeadlineNow` throws (shoe exhaustion, etc.) | `try/catch` converts to `sendError` via the `GameError` branch in `onBet`. The bet is already applied; the deal just didn't fire. Worst case: stuck in betting until a future event arrives. Out of scope to harden unless requested. |
| Client clock skew | Countdown is approximate; server authoritative. Early-exit deals within one roundtrip; clients see the `dealing` phase immediately on the next broadcast. |

## Files Touched

| File | Change |
|---|---|
| `server/src/gateway/game.gateway.ts` | Add `allActivePlayersHaveBet(state)`; extract `fireBetDeadlineNow(roomId)`; modify `onBet` to call early-exit after apply; update `fireAutoAdvance` to use the shared helper |
| `server/test/gateway-early-deal.spec.ts` (new) | Early-exit unit tests |
| `server/test/gateway-auto-advance.spec.ts` (extend) | Refactor existing tests to use the shared `fireBetDeadlineNow` helper; confirm existing re-loop and sitting-out tests still pass |
| `client/e2e/early-deal.spec.ts` (new) | Playwright E2E |

**No changes** to: state machine, client components, shared types, lobby/dealing animation timings, config.

## Testing Strategy

### Server unit / integration (Jest) — `gateway-early-deal.spec.ts` (new)

Uses `jest.useFakeTimers()`:

- **Solo host bets → immediate deal.** Single seated player. Place bet. Assert phase transitions `betting → dealing` within the same socket roundtrip; assert no `betting` broadcast at the 10s mark.
- **2-player: A bets, then B bets → immediate deal.** Assert phase remains `betting` after A's bet (with timer running). After B's bet, assert `dealing` fires and the timer is cleared.
- **3-player with one sitting_out: A and B bet → immediate deal.** Pre-set one seat to `sitting_out`. A bets → still betting. B bets → immediate deal (C is excluded from the active count).
- **`cancelAutoAdvance` is called on early-exit.** Spy on `cancelAutoAdvance`; assert it's invoked once on the early-exit path and the 10s fallback does not fire.
- **Slow better (regression).** 2 players; A bets, B never bets. Advance fake timers by 10s. Assert existing fallback path still fires and sits out B. (Sanity that the new code didn't break the old path.)
- **One broadcast per `onBet`.** Spy on `broadcastAll`; assert exactly one call regardless of whether early-exit fired.

### Server unit (Jest) — `gateway-auto-advance.spec.ts` (extend)

- Refactor existing bet-deadline tests to call `fireBetDeadlineNow` directly where appropriate, exercising the shared helper from both call sites.
- Confirm 0-bet re-loop test still passes. The re-loop path runs through `fireAutoAdvance` from the 10s timer, not through `onBet`, so the early-exit code in `onBet` never executes in this scenario. Unaffected.
- Confirm sitting-out test still passes.

### Client unit (Vitest)

- No new tests required. Existing `BetPanel.spec.tsx` covers countdown rendering; the early-exit just means the countdown never reaches 0 in solo / all-bets-in cases (it jumps to `phaseEndsAt: null`). Add one assertion to `BetPanel.spec.tsx` if not already present: "when `phaseEndsAt` is null, the countdown is not rendered". Otherwise rely on existing coverage.

### Client E2E (Playwright) — `early-deal.spec.ts` (new)

- **Single-player fast deal:** open one tab, create room, click Begin Betting, enter bet, click Place Bet. Assert phase reaches `dealing` within ~500ms (no 10s wait). Assert cards animate in.
- **2-player fast deal:** two tabs join, both bet. Assert dealing starts within ~500ms of the second player's bet, not at the 10s mark. Assert `phaseEndsAt` becomes null on the transition.
- **Regression — slow better still waits:** two tabs join, only one bets, wait 10s. Assert the other is `sitting_out` (existing behavior preserved).

### Verification gates

- `cd server && npx tsc --noEmit`
- `cd server && npx jest` — new + existing gateway suites pass
- `cd client && npx vitest run`
- `cd client && npx playwright test early-deal.spec.ts`

## Risks

- **Server-only surface area.** No state-machine, no client-component, no shared-type changes. The risk of regression is contained to the gateway's `onBet` and `fireAutoAdvance` paths.
- **Extracted helper `fireBetDeadlineNow`.** Touches `fireAutoAdvance`. Existing tests catch breakage here.
- **Race: timer already fired when early-exit is computed.** The 10s fallback and the bet-induced early-exit are mutually exclusive in practice: `fireAutoAdvance` deletes the `pendingTimers` entry before applying, and `cancelAutoAdvance` is a no-op on a missing entry. If a timer fires mid-`onBet` (impossible — JS is single-threaded within one tick), the `room.phase !== phase` guard in `fireAutoAdvance` short-circuits.
- **Stale `phaseEndsAt`.** A client holding the previous broadcast sees "Betting closes in N…" briefly until the next broadcast arrives (one network roundtrip). Acceptable; counts down to the right value in non-early-exit cases.
- **Lost test coverage if a future refactor skips `bet:place` for early-exit.** The early-exit branch only runs inside `onBet` after a successful `apply`. If someone wires early-exit through a different entry point (e.g. an admin endpoint), the helper and predicate still apply — they just need to call `fireBetDeadlineNow`.

## Known Follow-ups (deferred)

- A host-side "Deal Now" accelerator (would re-introduce a button; out of scope per user).
- Skipping the 3s settle pause in solo / all-players-acted conditions (out of scope per user).
- Per-player bet timers (currently one shared room window).
- Animation of the countdown digits (no change here; existing countdown UI unchanged).
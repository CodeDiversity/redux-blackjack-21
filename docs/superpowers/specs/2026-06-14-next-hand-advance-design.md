# Advance to Next Hand — Design Spec

**Date:** 2026-06-14
**Status:** Draft, awaiting user review
**Supersedes:** n/a (additive to `2026-06-14-blackjack-21-design.md`)

## Goal

After a hand settles, the table needs a clean, server-authoritative way to reset back to a fresh `betting` phase so the next hand can be played. The current `round:ready` action was designed for the lobby → betting transition and only flips phase + clears `lastResult`; it does not reset cards, hands, bets, dealer, or player status. This spec adds a dedicated `round:advance` action and the host-only UI to trigger it, plus a "Rebet" affordance so the next bet is one click.

## Non-Goals

- Reshuffle logic (the cut-card check stays in `round:start`).
- All-players-ready-check (host-only is sufficient for v1).
- Persisting `lastBet` across server restart.
- Animations for the result → next hand transition.
- Splitting across the round boundary (after settle, the seat is treated as a fresh single hand; the `lastBet` is the original (un-split) bet from that round).

## Constraints / Decisions Locked In

| Decision | Choice | Why |
|---|---|---|
| Who advances | Host only | Matches the existing "host drives flow" model in the lobby. One button, one decision. |
| Bets on next hand | Manually re-bet; "Rebet" button is an additional affordance | The `lastBet` from the previous round is remembered, so one click repeats it. |
| Sitting-out seats | `sitting_out` and `empty` are preserved across the transition | Per your answer. Reconnect or rejoin to come back. |
| Broke players (bankroll === 0) | Auto-promoted to `sitting_out` in `applyAdvance` | Extends the sitting-out rule. Prevents the table from getting stuck when no one can bet. |
| Reshuffle | Stays in `round:start` | Per your answer. `round:advance` is a pure state reset. |
| State machine knowledge of host | None; host check is gateway-only | The state machine in this codebase is host-agnostic. Host identity lives in the room (lobby). |
| Server enforcement of host | Yes, via new error code `NOT_HOST` | Client gating is a UX nicety; the server is the gate. |
| Wire shape | New `round:advance` command (no body) | Mirrors the existing `round:ready` and `round:start` commands. |

## Architecture

The change is small and entirely additive. No existing wire events change shape; no existing reducer changes; no existing behavior is altered for any current call site. The only "new" surface is:

- A new server action `round:advance` in the state machine
- A new `@SubscribeMessage('round:advance')` handler in the gateway
- A new `ClientCommand` variant and a new `ErrorCode` value
- A new optional `lastBet` field on `PlayerSeat` (default 0)
- A new "Next Hand" button in `ResultOverlay` (host only)
- A new "Rebet" button in `BetPanel` (when applicable)

### Data flow (advance)

```
[settled]
  │   Host clicks "Next Hand" in <ResultOverlay>
  │
  ▼
socket.emit('round:advance', null)
  │
  ▼
NestJS gateway → onAdvance(client)
  │   hostId from RoomService.getLobbyState(roomId).hostId
  │   if hostId !== ctx.seatId → emit 'error' { code: 'NOT_HOST' }, return
  │
  ▼
this.rooms.apply(ctx.roomId, { type: 'round:advance', seatId: ctx.seatId })
  │
  ▼
State machine applyAdvance(state)
  │   if state.phase !== 'settled' → throw 'INVALID_PHASE'
  │   reset: dealer, activeSeat, lastResult, all player hands
  │   map seat status: empty→empty, sitting_out→sitting_out,
  │                   bankroll===0→sitting_out, else→betting
  │   leave shoeSize, cutCardIndex, roundNumber, lastBet untouched
  │
  ▼
this.broadcastAll(roomId, next)
  │   emits lobby:state, game:state
  │
  ▼
Client middleware dispatches gameStateReceived
  │
  ▼
[betting]   (next round; BetPanel re-renders with optional Rebet button)
```

### Data flow (rebet)

```
[betting]   with mySeat.lastBet > 0
  │   User clicks "Rebet $X" in <BetPanel>
  │
  ▼
socket.emit('bet:place', { amount: mySeat.lastBet })
  │
  ▼
Existing path. No new server code.
```

## State Model Changes

### `PlayerSeat` (additive)

```ts
type PlayerSeat = {
  id: string;
  name: string;
  bankroll: number;
  hands: Hand[];
  status: SeatStatus;
  connectedAt: number;
  lastBet: number;   // NEW: default 0; updated by settle()
};
```

- Server mirror: `server/src/shared/types.ts`
- Client mirror: `client/src/shared/types.ts`
- Default 0 in `createInitialState` (server only)
- Updated in `settle()`: for every hand that resolves, set `seat.lastBet = hand.bet` before reducing the seat's hands

### `ClientCommand` (additive)

```ts
| { type: 'round:advance' }
```

### `ErrorCode` (additive)

```ts
| 'NOT_HOST'
```

`ErrorMessages`: `"Only the host can start the next hand."`

### `applyAdvance` (new function in state machine)

Validates `state.phase === 'settled'`. Builds a new state with:

- `phase: 'betting'`
- `activeSeat: null`
- `lastResult: null`
- `dealer`: `{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }`
- Each `PlayerSeat`:
  - `hands`: `[{ cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false }]`
  - `status`: mapped — `empty` → `empty`, `sitting_out` → `sitting_out`, `bankroll === 0` → `sitting_out`, all else → `betting`
  - `lastBet` is **not** reset; it's the same value `settle()` wrote
- `shoeSize`, `cutCardIndex`, `roundNumber`: unchanged

The state machine does **not** validate host identity. The gateway does.

### `settle` (modified, additive)

After computing payouts and updating `bankroll`, before returning the new state, set `seat.lastBet = seat.hands[i].bet` for every resolved hand. (The hands are about to be reduced to a single fresh hand by `applyAdvance`, but the `lastBet` is captured on the seat first.)

## Network Protocol

### Client → Server commands

| Event | Payload | Validation |
|---|---|---|
| `round:advance` | — | sender is the host (gateway check); phase is `settled` (state machine check) |

### Server → Client broadcasts

No new events. The advance produces a `lobby:state` and `game:state` broadcast identical in shape to other transitions. The `round:result` event is **not** re-emitted on advance; it was emitted on the transition into `settled`.

### Error responses

| Code | When |
|---|---|
| `NOT_HOST` | non-host socket sends `round:advance` |
| `INVALID_PHASE` | `round:advance` arrives when phase is not `settled` (e.g., double-click, or out-of-order client) |

## UI Changes

### `<ResultOverlay>` (modified)

- Existing: renders only when `phase === 'settled' && lastResult` is truthy. Shows the payouts list.
- New: appends a "Next Hand" button at the bottom of the overlay.
  - Visible only when `selectAmIHost` is true.
  - On click: `getSocket().emit('round:advance')` — direct emit, matching the pattern in `<DealButton>` and `<StartButton>`.
  - Disabled visually while the request is in flight (single-click safety; the server's `INVALID_PHASE` catches the race anyway).

### `<BetPanel>` (modified)

- Existing: number input + "Place Bet" button, only during `betting`.
- New: when `selectCanRebet` is true, render a "Rebet $X" button (X = `mySeat.lastBet`) **below** the existing form.
  - "Rebet" emits `bet:place` with `amount: mySeat.lastBet`. No new wire event.
  - `selectCanRebet` returns true iff `mySeat?.lastBet > 0 && mySeat?.lastBet <= mySeat?.bankroll && mySeat?.status === 'betting'`.

### New selectors (`client/src/selectors/self.ts`)

- `selectMyLastBet`: `(s) => selectMySeat(s)?.lastBet ?? 0`
- `selectCanRebet`: derived from `selectMySeat` — `lastBet > 0 && lastBet <= bankroll && status === 'betting'`

## Testing Strategy

### Server unit (Jest) — additions to `state-machine.spec.ts`

- `applyAction: round:advance` describe block:
  - transitions `settled → betting`
  - clears `dealer.cards`, `activeSeat`, `lastResult`
  - reduces all non-sitting-out, non-empty seats to one fresh hand with `bet: 0`, `cards: []`, all flags `false`
  - preserves `sitting_out` and `empty` seats unchanged
  - auto-promotes `bankroll === 0` seats to `sitting_out`
  - leaves `shoeSize`, `cutCardIndex`, `roundNumber` unchanged
  - preserves `lastBet` across the transition (verify by setting it manually)
  - throws `INVALID_PHASE` if called from any phase other than `settled`
- `applyAction: settle` test addition:
  - populates `lastBet` for every resolved hand from `hand.bet`
  - for multi-hand (split) seats, sets `lastBet` to the bet of the **first** hand (the original pre-split bet; both halves had the same bet anyway)

### Server integration (NestJS testing + socket.io-client) — additions to `gateway.integration.spec.ts`

- Two-round flow: existing test extended to walk a second round after settle; verify second `game:state` has `phase: 'player_turn'`, fresh hands, `lastResult: null`, `lastBet` preserved.
- `NOT_HOST` test: non-host socket emits `round:advance`; verify `error` event with code `NOT_HOST`.
- `INVALID_PHASE` test: host emits `round:advance` while in `betting` phase; verify `error` event with code `INVALID_PHASE`.

### Client unit (Vitest + React Testing Library) — new tests

- `<ResultOverlay>` renders payouts list during `settled`.
- `<ResultOverlay>` renders the "Next Hand" button only when `selectAmIHost` is true.
- `<ResultOverlay>` does **not** render during `betting` or `player_turn` (regression).
- `<BetPanel>` renders the "Rebet $X" button only when `mySeat.lastBet > 0 && lastBet <= bankroll`.
- `<BetPanel>` "Rebet" click emits `bet:place` with `amount: lastBet`.
- Game slice `gameStateReceived` correctly applies a `settled` state with `lastBet` populated.

### E2E (Playwright) — extension to `happy-path.spec.ts`

- Extend the existing test to play out two rounds:
  1. Round 1: host → "Begin Betting" → both place bets → host → "Deal" → both stand → settled
  2. Verify host sees the "Next Hand" button; non-host does not
  3. Host clicks "Next Hand" → `betting`; verify `.bet-panel` is present
  4. Host clicks "Rebet $50"; verify both seats' bankrolls reflect the new bets
  5. Host clicks "Deal" → second `player_turn`
- Skipped tests for the second E2E (drop-and-reconnect) remain unchanged.

### Out of scope

Performance, load, fuzz, visual regression, animation polish.

## File-by-File Change List

| File | Change |
|---|---|
| `server/src/shared/types.ts` | Add `lastBet: number` to `PlayerSeat`. Add `round:advance` to `ClientCommand`. Add `NOT_HOST` to `ErrorCode`. |
| `server/src/game/state-machine.ts` | Add `applyAdvance`. Update `settle` to populate `lastBet`. Update `createInitialState` to set `lastBet: 0`. |
| `server/src/shared/errors.ts` | Add `NOT_HOST` to `ErrorMessages`. |
| `server/src/gateway/game.gateway.ts` | Add `onAdvance` handler with host check. |
| `server/test/state-machine.spec.ts` | New `round:advance` describe block. Add `settle` lastBet assertion. |
| `server/test/gateway.integration.spec.ts` | Extend the existing 2-round test. Add `NOT_HOST` and `INVALID_PHASE` tests. |
| `client/src/shared/types.ts` | Add `lastBet: number` to `PlayerSeat`. |
| `client/src/selectors/self.ts` | Add `selectMyLastBet` and `selectCanRebet`. |
| `client/src/components/ResultOverlay.tsx` | Add host-gated "Next Hand" button. |
| `client/src/components/BetPanel.tsx` | Add "Rebet $X" button gated on `selectCanRebet`. |
| `client/e2e/happy-path.spec.ts` | Extend to cover two rounds. |

## Open Questions (non-blocking)

- **What if the host is also the one whose bankroll is 0?** The auto-sit-out rule promotes them to `sitting_out`. The next host is auto-picked (oldest `connectedAt` among remaining connected seats) by `RoomService.pickHost`. So the next hand will have a new host. This is the right behavior, but it's an emergent property of the existing host-promotion logic — worth a comment in the code.
- **What about a player who split and busted only the second hand?** `settle` reduces both halves' payouts into a `totalDelta` and sets `lastBet` from `hands[0].bet` (the original bet, mirrored by the split). Bankroll may be below `lastBet`. On advance, the Rebet button won't show (insufficient funds). Correct behavior.

## Known Follow-ups (deferred)

- The 30s disconnect-grace auto-stand timer (pre-existing; `Config.DISCONNECT_GRACE_MS`).
- `activeHandIndex` for split hand tracking in `GameState` (pre-existing, mentioned in MEMORY.md).
- Animations and sound for the settled → next hand transition.
- Persistent `lastBet` across server restart.
- Spectator support.

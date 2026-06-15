# 5-Seat Tables + Split-Hand Turn Tracking

**Date:** 2026-06-14
**Status:** approved (brainstorming complete)
**Parent spec:** `docs/superpowers/specs/2026-06-14-blackjack-21-design.md`

## Goal

Bump the per-table seat count from 2 to 5, render the new geometry cleanly in lobby and table views, and close the known split-hand turn-tracking correctness gap at the same time.

## Scope (in)

1. `Config.SEAT_COUNT` goes from 2 → 5.
2. `PlayerSeat.activeHandIndex` field added; `advanceTurn` rewritten to walk all hands.
3. Every `hand:*` action validates its `handIndex` against the seat's `activeHandIndex`.
4. Lobby `PlayerList` shrinks cards to 110×140 and tightens the gap to 16px so 5 fit in one row.
5. `TableView` widens to 1500px max, fixes the seat grid to 5 columns, and stops filtering empty seats.
6. New `EmptySeatTile` component renders ghosted placeholders for empty seats at the play table.
7. Tests: ~12 new server, ~4 new client unit, ~1 new E2E spec.

## Scope (out — added to project backlog)

- Re-splits (splitting a hand into 3+ hands).
- Wiring `Config.DISCONNECT_GRACE_MS` to the 30s auto-stand timer in `handleDisconnect`.
- Settlement animations, sound, spectator mode.
- Per-room / env-var table-size configurability.
- Mobile-first layout polish (the 2-row wrap for narrow viewports is a defensive fallback only).
- Dealer up-card visibility tweaks.
- AI / bot players to fill empty seats.
- Backwards-compat migration for in-flight 2-seat rooms on dev servers.

## Architecture overview

Six tightly coupled changes that share files (especially `TableView.tsx` and `state-machine.ts`), so we land them as one PR:

- **Server** is mostly size-agnostic. The state machine, dealing order, and `allHandsActed` all walk `players` dynamically. A single config bump is the only structural change on the server's "size" axis.
- **Server** also gets a correctness fix for split-hand turn tracking. This is bundled because (a) the user explicitly asked for it and (b) it lives in the same files we'd touch for a 5-seat cleanup.
- **Client** lobby shrinks card size — minimal CSS change.
- **Client** table widens the felt, fixes the grid to 5 columns, and renders ghosted empty seats.

**Touched files (predicted):**
- `server/src/config.ts` (1 line)
- `server/src/shared/types.ts` (add `activeHandIndex` to `PlayerSeat`)
- `server/src/game/state-machine.ts` (`advanceTurn` rewrite + hand-index validation)
- `server/test/state-machine-xstate.spec.ts` (new cases)
- `server/test/integration/room-5-seat.spec.ts` (new, end-to-end 5-player round)
- `client/src/components/PlayerList.tsx` (card size, gap)
- `client/src/components/TableView.tsx` (width, grid, no longer filter empty)
- `client/src/components/EmptySeatTile.tsx` (new)
- `client/src/components/PlayerList.spec.tsx` (new) or extend existing
- `client/src/components/TableView.spec.tsx` (new)
- `client/e2e/five-player.spec.ts` (new)

## Server changes — detail

### Config bump

`server/src/config.ts`:

```diff
 export const Config = {
   PORT: Number(process.env.PORT ?? 3001),
-  SEAT_COUNT: 2,
+  SEAT_COUNT: 5,
   MIN_BET: 10,
   ...
 } as const;
```

`createInitialState(roomId, Config.SEAT_COUNT)` in `room.service.ts` picks it up. `room.seats.size >= Config.SEAT_COUNT` for the `ROOM_FULL` check picks it up. All existing test fixtures use `Config.SEAT_COUNT` in their `createInitialState` calls, so they auto-adapt to the new size — no test fixture rewrites needed for the count itself.

### No size-related state-machine changes

Verified seat-count-agnostic in the existing code:
- `state-machine.ts:188` loops over `players` for dealing order.
- `state-machine.ts:254-255` (`allHandsActed`) filters by status and iterates dynamically.
- The dealer's hole card is always 1 (the hidden card) — no size assumption.
- `createInitialState` already takes the seat count as a parameter.

### `activeHandIndex` data model

Add to `PlayerSeat` in `server/src/shared/types.ts`:

```ts
export type PlayerSeat = {
  id: string;
  name: string;
  bankroll: number;
  hands: Hand[];
  status: SeatStatus;
  connectedAt: number;
  lastBet: number;
  activeHandIndex: number;  // NEW: 0-based index into hands[] when seat is acting; ignored otherwise
};
```

Initial value: `0` for any seat (the value is only meaningful when the seat is the `activeSeat` and `phase === 'player_turn'`).

### `hand:*` action validation

Every `hand:hit`, `hand:stand`, `hand:double`, and `hand:split` carries a `handIndex`. The state machine validates it matches the seat's `activeHandIndex` and rejects mismatches with the existing `HAND_LOCKED` error code:

```ts
// in applyAction
const seat = state.players[state.activeSeat!];
if (action.handIndex !== seat.activeHandIndex) {
  throw new GameError('HAND_LOCKED');
}
```

This makes the server the authority on which hand is acting. The client can no longer accidentally act on a non-active hand.

### `hand:split` semantics

When a player splits, `seat.hands` grows from `[h0]` to `[h0, h1]`. The state machine sets `seat.activeHandIndex = 0` (the new left hand acts first by blackjack convention).

### Hand-completion detection

After `hand:hit`, `hand:stand`, or `hand:double`, the state machine checks if the just-acted hand is complete:
- **stand**: always complete.
- **double**: always complete (hand grows by 1, then stands).
- **hit**: complete if `busted` or `handTotal(realCards) === 21`. Standard rule.

If complete, increment `seat.activeHandIndex`. If `activeHandIndex >= hands.length`, the seat is done — call `advanceTurn`.

### `advanceTurn` rewrite

```ts
function advanceTurn(state: GameState): GameState {
  const start = state.activeSeat ?? 0;
  const n = state.players.length;

  for (let i = 0; i < n; i++) {
    const idx = (start + 1 + i) % n;
    const seat = state.players[idx];
    const hasIncomplete = seat.hands.some(
      (h) => !h.stood && !h.busted && !h.doubled && h.cards.length > 0
    );
    if (hasIncomplete) {
      const firstIncomplete = seat.hands.findIndex(
        (h) => !h.stood && !h.busted && !h.doubled && h.cards.length > 0
      );
      return {
        ...state,
        activeSeat: idx,
        players: state.players.map((p, j) =>
          j === idx ? { ...p, activeHandIndex: firstIncomplete, status: 'acting' as const } : p
        ),
      };
    }
  }

  // Nobody has incomplete hands → dealer turn
  return { ...state, phase: 'dealer_turn' as const, activeSeat: null };
}
```

The `firstIncomplete` lookup replaces the current `hands[hands.length - 1]` heuristic. This walks hand 0 first, then 1, then 2, etc. — the canonical left-to-right blackjack order.

### XState refactor note

The state machine has two implementations. Per commit `abbf553 refactor(server): delete state-machine.legacy.ts`, XState is canonical and the legacy reducer is gone. The `advanceTurn` fix applies to the XState machine's "advance" event handler. We do **not** need to port the fix to a legacy file (there isn't one).

## Client lobby changes — detail

### `PlayerList.tsx`

```diff
 const SeatCard = styled.div<{ $seated: boolean }>`
-  width: 140px;
-  height: 170px;
+  width: 110px;
+  height: 140px;
   ...
 `;

 const Avatar = styled.div<{ $seated: boolean }>`
-  width: 56px;
-  height: 56px;
+  width: 44px;
+  height: 44px;
   ...
-  font-size: 20px;
+  font-size: 16px;
 `;

 const Row = styled.div`
   display: flex;
-  gap: ${({ theme }) => theme.spacing.xl};   // 24px
+  gap: ${({ theme }) => theme.spacing.md};   // 16px
+  flex-wrap: wrap;
   justify-content: center;
   align-items: center;
 `;
```

**Math:** 5 × 110 + 4 × 16 = 614 px. Comfortable on a 1024 px viewport.

**Responsive fallback:** `flex-wrap: wrap` lets the row break to 2 rows on narrow viewports. At ~320 px (small phone), the layout may be 2+2+1 — acceptable as a defensive fallback, not a polished mobile layout.

### `Lobby.tsx`

No change. The container is `max-width: 480px` for the bottom block, but `PlayerList` sits above it without a width constraint.

### E2E selector preservation

The E2E only checks `button:has-text("Begin Betting")`, not card counts. Safe to change.

## Client table changes — detail

### `TableView.tsx`

```diff
 const TableSurface = styled.div`
   ...
-  padding: ${({ theme }) => theme.spacing.xxl};
+  padding: ${({ theme }) => theme.spacing.xxl};
-  width: min(1100px, 100%);
+  width: min(1500px, 100%);
 `;

 const Seats = styled.div`
   display: grid;
-  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
+  grid-template-columns: repeat(5, 1fr);
   gap: ${({ theme }) => theme.spacing.xl};
   margin-top: ${({ theme }) => theme.spacing.sm};

+  @media (max-width: 1100px) {
+    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
+  }
 `;
```

Remove the `.filter((p) => p.status !== 'empty')` on `state.players`. Render all 5:

```tsx
{state.players.map((p) =>
  p.status === 'empty' ? (
    <EmptySeatTile key={p.id} />
  ) : (
    <PlayerSeatView
      key={p.id}
      seat={p}
      isActive={state.activeSeat !== null && state.players[state.activeSeat]?.id === p.id}
      isMe={p.id === selfSeatId}
    />
  )
)}
```

### New component: `EmptySeatTile.tsx`

```tsx
import styled from 'styled-components';

const Tile = styled.div`
  width: 100%;
  aspect-ratio: 1 / 1;
  max-width: 180px;
  border: 2px dashed ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.seat};
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  opacity: 0.6;
`;

const Glyph = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 28px;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Label = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-weight: bold;
`;

export function EmptySeatTile() {
  return (
    <Tile aria-label="empty-seat">
      <Glyph>+</Glyph>
      <Label>Empty</Label>
    </Tile>
  );
}
```

### `PlayerSeat.tsx`

No required change. It already accepts a `seat: PlayerSeat` and renders based on the seat's data. The `TableView` switch is what routes empty seats to `EmptySeatTile` instead.

### Active-seat highlight

`isActive` is set when `state.players[state.activeSeat]?.id === p.id`. This keeps working for real seats. Empty seats are never highlighted (they're rendered as a different component).

### Per-seat layout stays the same

Cards, hand stacks, bet display, and action buttons (Hit/Stand/Double/Split) all render inside `PlayerSeat`. The "which hand is acting" within a split is now driven by `seat.activeHandIndex`. The action panel shows for the active hand of the active seat.

### E2E selector preservation

The E2E interacts with the host's controls (`BetPanel`, `DealButton`, `ActionPanel`, `ResultOverlay`). It doesn't read seat DOM. Safe.

## Data flow

No changes to Redux, sockets, or middleware. The flow stays exactly the same as today. The only new field is `PlayerSeat.activeHandIndex`, which flows through the existing `game:state` event.

```
Client UI (reads Redux)
   ↓
handler calls socket.emit(...)        ← Home: room:create / room:join
                                      ← StartButton: round:ready
                                      ← Table: hand:hit, hand:stand, etc. (now with strict handIndex)
   ↓
Server validates + returns ack        ← Home: { seatId, roomId } or { ok: false, code }
                                      ← hand:*: server validates handIndex against activeHandIndex
                                      ← round:ready: full GameState snapshot
   ↓
Socket middleware dispatches into Redux
   ↓
useSelector re-renders Home / Lobby / Table
```

## Error handling

Two new validation paths; everything else unchanged.

- **`HAND_LOCKED` (existing code, new trigger):** thrown when a `hand:*` action's `handIndex` doesn't match `seat.activeHandIndex`. The client gets a `ServerEvent` of type `error` with `code: 'HAND_LOCKED'`. The existing `ErrorToast` displays it. No client changes needed for the error display.
- **`HAND_LOCKED` from out-of-order split requests:** a player cannot act on hand 1 when hand 0 is still incomplete. Server rejects. Client shows the toast. No new component.

No new error categories. No new error components. No retry logic. The state machine remains the source of truth for which hand is acting.

## Testing

### Server — new cases (target: ~12 across 2 files)

`server/test/state-machine-xstate.spec.ts` (extend) or new `server/test/active-hand-index.spec.ts`:

1. `hand:hit` with mismatched `handIndex` is rejected with `HAND_LOCKED`.
2. `hand:stand` with mismatched `handIndex` is rejected.
3. `hand:double` with mismatched `handIndex` is rejected.
4. `hand:split` sets `seat.activeHandIndex === 0` and the left hand is acting.
5. Standing on hand 0 advances `activeHandIndex` to 1 within the same seat.
6. Doubling on hand 0 advances to hand 1.
7. Hitting hand 1 to bust advances to the next seat (no further hands on this seat).
8. `advanceTurn` returns the next seat with an incomplete hand; sets `activeHandIndex` to the first incomplete hand.
9. `advanceTurn` with all hands complete → `phase: 'dealer_turn'`, `activeSeat: null`.
10. 5-seat room: player 2 splits, player 4 doubles, others stand — `advanceTurn` walks correctly.

`server/test/integration/room-5-seat.spec.ts` (new, end-to-end through gateway):

11. Create a 5-seat room, join 5 players via sockets, `round:ready` as host, deal, all 5 place bets, walk turns to dealer, settle.
12. Create a 5-seat room, join 3 players, start, deal, leave mid-hand, server rebalances correctly.

### Client unit — new cases (target: ~4)

`client/src/components/PlayerList.spec.tsx` (new) or extend existing:

13. Renders 5 seat cards (3 empty + 2 seated fixture).
14. Card dimensions match 110×140.
15. Seated vs. empty treatment (avatar, border, label) is correct at 5 seats.

`client/src/components/TableView.spec.tsx` (new):

16. With 5 players in state, all 5 seat tiles render in the grid (2 real + 3 ghosted).
17. `EmptySeatTile` shows for empty seats and is dim.

### E2E — new spec

`client/e2e/five-player.spec.ts` (new):

18. Lightweight: host creates a 5-seat room, second client joins, both land on lobby showing 5 seat cards (one "Empty Seat" each as the other), host clicks "Begin Betting", table shows 5 seat tiles. **Caveat:** a full 5-player hand-played-to-settlement E2E is also acceptable but heavier; we prefer the lightweight version unless reviewer asks for the full flow.

### What stays the same

- All 130 server tests still pass.
- All 41 client vitest tests still pass.
- The existing `happy-path.spec.ts` (2-player flow) still passes.

### Verification commands

```bash
cd server && npx jest                            # 130 + 12 new
cd server && npx tsc --noEmit                    # clean
cd client && npx vitest run                      # 41 + 4 new
cd client && npx tsc --noEmit -p tsconfig.json   # clean
cd client && npx playwright test                 # 1 + 1 new
```

We re-verify the actual baseline counts with `npx jest` and `npx vitest run` before claiming pass counts. The 130 / 41 numbers in the v1 spec are known to drift; this spec re-derives them at implementation time.

## Definition of done

- `Config.SEAT_COUNT = 5` in `server/src/config.ts`.
- Lobby renders 5 seat cards in a single row at 110×140, with 16px gap.
- Table renders 5 tiles in a single row at ~1500px max width; empty seats show as ghosted tiles.
- A 5-seat room can be created, joined by 5 players, and play a full hand end-to-end.
- Split-hand turn tracking walks all hands in order, rejects mismatched `handIndex`, and never strands a hand.
- All existing 130 server + 41 client + 1 E2E tests still pass; ~17 new tests pass.
- This spec is referenced from the implementation plan.

## Open questions

None at design time. Implementation may surface a small number of follow-ups (e.g., a 6th-seat config could be added with one more constant change) but those are out of scope for this PR.

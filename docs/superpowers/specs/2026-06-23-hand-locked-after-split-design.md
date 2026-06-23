# Fix: "Hand is no longer playable" on the first action after a split

**Date:** 2026-06-23
**Status:** approved (brainstorming complete)
**Parent spec:** `docs/superpowers/specs/2026-06-14-five-seats-design.md` (introduced `PlayerSeat.activeHandIndex` and the `isHandActive` guard)

## Goal

Eliminate the user-visible `HAND_LOCKED` toast that fires on the first action a player takes on the left hand immediately after splitting. The server-side guard is correct; the client is sending the wrong `handIndex`.

## Root cause

The client computes which hand the player is acting on from `me.hands.length - 1`. The server tracks it on the seat in `PlayerSeat.activeHandIndex`. These agree whenever there is no split (one hand, index 0). They diverge the moment a split resolves:

- After `hand:split`, the server's `assignSplit` (`server/src/game/state-machine.ts:395`) sets `seat.activeHandIndex = 0` (the new left hand acts first by blackjack convention). The seat now has two hands, so the client's heuristic computes `hands.length - 1 = 1`.
- The client emits `hand:hit` (or `stand` / `double`) with `handIndex: 1`. The server's `isHandActive` guard (`server/src/game/state-machine.ts:100-106`) checks `e.handIndex === s.players[idx].activeHandIndex`, i.e. `1 === 0` → false → throws `GameError('HAND_LOCKED')`.
- The client surfaces this through `ErrorToast` as *"This hand is no longer playable."*

Every first action on the left hand of a split fails. Standing on hand 0 advances the server's `activeHandIndex` to 1, at which point the client's heuristic (still `1`) and the server's value agree again — so subsequent actions on hand 1 work, masking the bug.

## Scope (in)

1. `client/src/components/ActionPanel.tsx:44` — read `me.activeHandIndex` from Redux state instead of computing it as `hands.length - 1`.
2. `client/src/middleware/socket.middleware.ts:27-30` — add a one-line comment pointing future callers at `state.game.players[mySeatId].activeHandIndex`. No behavioural change; the middleware is dead code today (no UI dispatches `socket/hit` etc.), but it would re-introduce the same bug if a future caller passes a handIndex derived the same way.
3. Three client tests in `client/test/components/ActionPanel.spec.tsx` (new file if it does not exist):
   - **Split regression (red → green):** after splitting, clicking Hit/Stand/Double/Split on the new left hand sends `handIndex: 0`, matching the server's `activeHandIndex`.
   - **Multi-hand walk:** after standing on hand 0 of a split, the next click targets hand 1.
   - **No-split baseline:** a hand that has not been split still works (regression — the old `hands.length - 1` heuristic happened to be correct here, we do not break it).

## Scope (out)

- In-flight / pending button disable (Approach B from the brainstorm). The user reported the toast appearing at other times besides post-split; this is most likely a race where a second click lands after the hand auto-closes (e.g., hitting to 21), and Approach A does not address it. If those cases persist after this fix, the follow-up is to disable the action buttons while a `hand:*` emit is in flight.
- Removing the server-side `isHandActive` guard. It is the right authority and the protection it offers is worth keeping — the client should not be trusted to send the right handIndex even after this fix.
- Changing the `handIndex` field on the wire. The five-seats design explicitly added per-action `handIndex` validation; this spec does not revisit that decision.
- Server changes of any kind.
- Re-splits, animations on split, or any UX polish around the split moment.

## Architecture overview

- **Server:** unchanged. The state machine, `isHandActive` guard, and `assignSplit` are all correct.
- **Client:** a one-line read-source change in `ActionPanel`. The selector `makeSelectAvailableActions` already accepts `handIndex` as a parameter, so the rest of the component (button enabled/disabled logic, `canDouble` / `canSplit` / `canHit` checks) does not move. Only the value fed into the selector changes.
- **Middleware:** comment-only, no functional change. The dead-code path is left in place because removing it would be a separate cleanup, and the comment turns the footgun into a signpost.

## Data flow

User clicks Hit →
`ActionPanel.onClick` reads `me.activeHandIndex` from the Redux store →
`socket.emit('hand:hit', { handIndex })` →
server's `isHandActive` guard passes (the value is now correct) →
`assignHit` advances the hand.

## Error handling

No new error paths. The existing `HAND_LOCKED` guard stays in place and continues to reject genuinely stale actions (e.g., a click from a previous round that the client has not yet rendered the new state for). The client still surfaces server errors through `ErrorToast` exactly as today.

## Testing

Unit tests (Vitest + React Testing Library) in `client/test/components/ActionPanel.spec.tsx`:

- Render with a seat whose `activeHandIndex` is `1` (simulating the post-split, hand-1-active state) and assert that clicking Hit emits `handIndex: 1`, not `hands.length - 1`.
- Render with a seat whose `activeHandIndex` is `0` and `hands.length === 2` (the buggy post-split state) and assert that clicking Hit emits `handIndex: 0`. This is the red-then-green test.
- Render with a seat whose `activeHandIndex` is `0` and `hands.length === 1` (no split) and assert that clicking Hit emits `handIndex: 0`. Baseline regression.

The server-side `state-machine-xstate.spec.ts` already covers the `HAND_LOCKED` rejection paths — no new server tests.

No new E2E spec; the existing E2E suite does not exercise split and adding a split E2E is out of scope for this fix.

## Files touched

- `client/src/components/ActionPanel.tsx` — one-line change at line 44.
- `client/src/middleware/socket.middleware.ts` — comment block above the `case 'socket/hit'` line.
- `client/test/components/ActionPanel.spec.tsx` — new test file (or appended to an existing one if the layout already has one).

# Single-Player Mode

**Date:** 2026-06-23
**Status:** Draft — pending user review (approach A — minimal client-only change)

## Problem

A host who creates a room currently cannot start a round alone. The client
disables the "Begin Betting" button until a second player joins, and the
hint text reads "Waiting for 1 more player…". For solo play and demos,
this is friction the game does not need.

## Goal

A host sitting alone in a freshly created room can start a round and play
one full hand against the dealer end-to-end without joining a second
client. Multiplayer continues to work exactly as it does today.

## Non-Goals

- Server changes. The state machine, gateway, and `Config.SEAT_COUNT`
  already support any positive player count. Adding a server-side
  `MIN_PLAYERS` knob is YAGNI.
- Home page changes. There is no new "Play Solo" entry point. A solo run
  still goes through `Create Room`.
- Lobby component changes. The lobby list of seated players already
  renders correctly with a single entry.
- The non-host "Waiting for host to start…" message. Unchanged.

## Design

### Single change site

`client/src/components/StartButton.tsx` — two adjacent edits:

1. `canStart` predicate flips from `seatedCount >= 2` to `seatedCount >= 1`.
2. `hintText(seatedCount)` returns an empty string whenever
   `seatedCount >= 1`, so a host with at least one seat never sees a
   "waiting for more players" hint. The `seatedCount === 0` branch keeps
   its current copy.

```ts
// before
const canStart = seatedCount >= 2;

function hintText(seatedCount: number): string {
  if (seatedCount === 0) return 'Waiting for players to join…';
  if (seatedCount === 1) return 'Waiting for 1 more player…';
  return 'Waiting for all players…';
}
```

```ts
// after
const canStart = seatedCount >= 1;

function hintText(seatedCount: number): string {
  if (seatedCount === 0) return 'Waiting for players to join…';
  return '';
}
```

### Why client-only is enough

- `room:ready` already transitions `lobby` → `betting` with no server
  count check (`server/src/gateway/game.gateway.ts` `round:ready`
  handler, `server/src/game/state-machine.ts` `lobby` state).
- The betting phase only requires one bet to advance to `dealing`
  (`hasAtLeastOneBet` guard).
- `player_turn` → `dealer_turn` auto-transition via `allHandsActed`
  works for any number of acting seats, including one.
- The only place the "must have two" rule lived was the client's
  `StartButton`.

### Files touched

- `client/src/components/StartButton.tsx` — the two edits above.
- `client/src/components/StartButton.test.tsx` — add or adjust cases so
  the solo-host case is covered:
  - host with 0 seats → button disabled, hint "Waiting for players to join…"
  - host with 1 seat → button enabled, no hint
  - host with 2+ seats → button enabled, no hint
  - non-host → renders "Waiting for host to start…"

  (If the existing test file is missing, create it following the
  patterns used by adjacent component tests.)

## Behavior

After the change, a solo flow looks like:

1. Host opens Home, enters a name, clicks **Create Room**.
2. Lands in `TableView` as the only seat, lobby phase, with the
   "Begin Betting" button enabled.
3. Clicks **Begin Betting** → `round:ready` → phase becomes `betting`.
4. Places a bet (10–500) → phase stays `betting` until bet deadline.
5. Bet deadline fires → phase `dealing` → cards animate in.
6. Host plays their hand (hit/stand/double/split).
7. Dealer plays, hand resolves, payout updates bankroll.
8. `round:advance` → next betting phase. Repeat.

Multiplayer behavior is unchanged. The `>= 2` → `>= 1` relaxation is
monotonic: every two-player game that worked before still works.

## Testing

- Update `StartButton` unit tests to cover the solo-host case (button
  enabled, no hint).
- Run `npm test -w client` and confirm all suites pass.
- Manual smoke: `npm run dev`, open one tab, create room, run one
  hand to settled, run a second hand.

## Risks

- **Existing multiplayer UX unchanged.** No risk to the multiplayer
  path; the relaxation is strictly more permissive.
- **Hint text regression for 0 seats.** The `seatedCount === 0` branch
  is preserved verbatim, so a host who somehow sees zero seated players
  still gets a clear message.
- **No backend drift.** The server already accepted `round:ready` from
  any host at any time; this change just stops the client from hiding
  the button.

# Lobby & Home UI Polish — Design Spec

**Date:** 2026-06-14
**Status:** Draft, awaiting user review
**Parent spec:** [`2026-06-14-blackjack-21-design.md`](2026-06-14-blackjack-21-design.md)
**Prior pass:** [`2026-06-14-ui-redesign-design.md`](2026-06-14-ui-redesign-design.md)

## Goal

Polish the pre-game screens (Home page + in-room Lobby) using the existing `styled-components` theme, and clean up the last inline-styled holdout on the table. The change is strictly visual: dark "casino entrance" aesthetic for the pre-game area, theater-seat cards for the lobby, and one small table-side cleanup. No game logic, Redux state, selectors (beyond one new derived selector), or wire protocol changes.

## Non-Goals (this pass)

- Mobile / responsive design (still desktop-only per the parent spec).
- Multiple themes (light / dark / seasonal) — single dark entrance.
- Card art SVGs or image assets — pure CSS avatars (initials in a gold circle).
- Sound effects, animations, or transitions.
- A real player-controlled "I'm ready" toggle (the `ready` flag is server-computed as `status !== 'empty'`, so this pass keeps that semantics and labels it honestly as "seated").
- Copy-to-clipboard for the room code.
- A separate entrance theme object + ThemeProvider switching (Approach B was rejected — single shared theme, with new `entrance*` tokens added to the existing one).
- Extracting shared primitives (Approach C was rejected — wait for a second surface to confirm which primitives repeat).
- Refactors of any non-style code beyond the one new `selectLobbySeats` selector.
- New Redux actions, slices, or socket events.
- Server-side changes.
- Lint, Prettier, or test-infra changes.

## Constraints / Decisions Locked In

| Decision | Choice | Why |
|---|---|---|
| Styling approach | `styled-components` library, co-located in each component file | Matches the established pattern from the prior UI polish pass. No new abstraction layer. |
| Scope | Lobby + Home + one small table-side cleanup | The only unpolished components in the codebase, plus the last inline-styled holdout. |
| Aesthetic for pre-game | Dark "casino entrance" backdrop (`#0a1612`) with gold accent (`#c9a96a` → `#8b7340`) | The table stays on its green felt; the pre-game area reads as a separate "lobby" you walk through before stepping onto the table. |
| Home page layout | Single centered card: name → gold "Create Room" button → divider → "Join" with 5-char monospace code input | Familiar, scannable, no scroll, works on the existing 1024px+ target viewport. |
| Lobby layout | Theater seats: 2 fixed-size seat cards in a centered row, room code as a compact pill below, host-only start button beneath | The server's `SEAT_COUNT = 2` makes this a 2-up grid, not the 6-up from the mockup. |
| Seated visual | Green border + soft glow on occupied seats, dashed border + `+` glyph on empty seats | Strongest at-a-glance signal; reuses the existing `statusWin` color so it feels like the same family as the "your turn" glow. |
| "Ready" semantics | Relabel as "Seated" (or rely on the border alone) — the flag is `status !== 'empty'`, not a player choice | Avoids misleading users with a label that implies a toggle they can't actually perform. |
| Room code display | 5 chars (server's `ROOM_CODE_LENGTH = 5`), monospace, wide letter-spacing, dim background | Compact pill; not a hero element. |
| Start button | Gold "Begin Betting" when ≥2 seated; dimmed with a "Waiting for N more player(s)" hint otherwise; hidden for non-hosts | One line of new text on disabled state improves clarity. |
| New primitives? | **No** | One pass through; extract after we have a second surface. |
| Test additions | Only one new selector test (`selectLobbySeats`, 2-3 cases) | No regression of the existing 22 vitest + 130 jest + 1 E2E. |
| Visual regression tooling | None | Out of scope; user is the visual reviewer. |

## Architecture

The existing client has one `ThemeProvider` wrapping the entire app. The pre-game area is rendered through `pages/Home.tsx` (route `/`) and `pages/Table.tsx` (route `/room/:id`, which conditionally renders `Lobby` during the `lobby` phase and `TableView` otherwise). All of these currently use unstyled `className` HTML.

This pass:

```
main.tsx
  └─ App.tsx
       └─ <ThemeProvider theme={theme}>        ← single shared theme, with new entrance* tokens
            └─ <GlobalStyle />                  ← unchanged
                 └─ <Router>
                      ├─ Home (/)               ← new styled card on dark entrance backdrop
                      └─ Table (/room/:id)
                           ├─ ConnectionStatus
                           ├─ Lobby             ← new theater seats + room-code pill + start button
                           │   ├─ PlayerList   ← new seat cards
                           │   ├─ RoomCode     ← new compact pill
                           │   └─ StartButton  ← gold CTA + disabled hint
                           └─ TableView        ← UNCHANGED
```

The single shared theme is the right call: the existing `felt*`, `text*`, `card*`, `status*`, `surface*`, `chip*` tokens all continue to power the table as-is. New `entrance*` and `gold*` tokens are added in a separate semantic block. The `seatedGlow` / `seatedBorder` deliberately use `#4ade80` so the seated state reads as the same color family as the existing "your turn" glow.

## Theme additions

```ts
// Additions to client/src/styles/theme.ts
export const theme = {
  colors: {
    // … existing felt / text / card / status / surface / chip colors unchanged …

    // Entrance (Home + Lobby) — dark "lobby" backdrop, gold accent
    entranceBg:         '#0a1612',   // behind the page (already used by GlobalStyle body)
    entranceSurface:    '#122822',   // card / seat background
    entranceSurfaceAlt: '#0e1f1a',   // slightly darker for nested surfaces
    entranceBorder:     'rgba(220,210,190,0.15)',
    entranceBorderSoft: 'rgba(220,210,190,0.08)',

    // Gold accent (for primary CTAs, player initials, brand text)
    goldFrom: '#c9a96a',
    goldTo:   '#8b7340',
    goldText: '#0a1612',   // text color when on gold background

    // Seated vs empty seat (re-uses existing status colors in an entrance context)
    seatedBorder: '#4ade80',                                  // == existing statusWin
    seatedGlow:   '0 0 16px rgba(74,222,128,0.30)',
  },

  spacing:    { /* unchanged */ },
  typography: { /* unchanged */ },
  radii: {
    /* unchanged */
    seat: '8px',
  },
  shadows: {
    /* unchanged */
    seat: '0 4px 10px rgba(0,0,0,0.4)',
  },
};
```

The existing `GlobalStyle` already sets `body { background: #0a1612; }`, which is the same value as the new `entranceBg` token. No GlobalStyle change.

## Component-by-component breakdown

### `pages/Home.tsx` — Create/Join landing

Centered card on the dark entrance backdrop. Brand title (`Blackjack 21` in italic Georgia with wide letter-spacing, matching the table's `Brand` text) above the card; dim subtitle below the title. Card contents:

1. `YOUR NAME` label + input (`placeholder="Your name"`).
2. Gold `Create Room` button (full width).
3. Dim divider: `— or join an existing one —`.
4. Row: 5-char monospace room-code input (`placeholder="Room code"`, auto-uppercase, `maxLength={5}`) + outline `Join` button.

Below the card: a small red-tinted toast replaces the current `<p className="error">`. Same `setError(...)` calls, same UX.

**E2E selectors preserved**: `input[placeholder="Your name"]`, `input[placeholder="Room code"]`, button text `"Create Room"`, button text `"Join"`.

### `components/Lobby.tsx` — Container

Becomes a `styled.div` flex column, centered vertically, with a max-width of ~640px. Three children stacked: page title, `PlayerList` (theater seats), then the room-code pill + start button. No behavior change.

### `components/PlayerList.tsx` — Theater seats

Renders 2 seat cards (one per `state.players` entry, by `Config.SEAT_COUNT = 2`). Layout: flex row, gap 24px, centered. Each card is a fixed-size box (~140×170px) with a gold circular avatar (initials from the player name, fallback to `?` for empty), the player's name in cream, and the seated/empty treatment:

- **Occupied** (`status !== 'empty'`): gold avatar with initials, name in cream, 2px green border with seated glow, small "Seated" label below the name.
- **Empty** (`status === 'empty'`): dashed entrance border (no background fill), centered `+` glyph (24px, dim), small "Empty Seat" label below.

Reads from the new `selectLobbySeats` selector (see Data flow).

**E2E selectors preserved**: none directly — but the lobby doesn't break any existing test.

### `components/RoomCode.tsx` — Room code pill

A compact pill below the seat cards: small uppercase "CODE" label, then the 5-char code in monospace with wide letter-spacing. Dim background, no border. Renders only when `roomId` is set (same as today).

### `components/StartButton.tsx` — Host-only CTA

Renders below the room-code pill. Two states:

- **Enabled** (≥2 seated): gold `Begin Betting` button, max-width ~240px, centered horizontally within the lobby container.
- **Disabled** (<2 seated): the button is dimmed (not hidden); a one-line hint is rendered as a sibling above the button (e.g., "Waiting for 1 more player"). Hint text varies by seated count.

Only the host sees the button (`if (!amHost) return null;` — same as today). Non-host view: in the same vertical position where the start button would be, render a small "Waiting for host to start…" line in dim cream (no button).

**E2E selector preserved**: button text `"Begin Betting"`.

### `components/PlayerSeat.tsx:103` — small table-side cleanup

Replace the inline `style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4, color: '#c9bfa8' }}` on the "Hand 1" / "Hand 2" label with a `styled.div` named `HandLabel`. The label only renders when `seat.hands.length > 1` (i.e. after a split). No behavior change.

### `pages/Table.tsx:29-30` — small wrapper-class cleanup

Replace `<div className="table-page">` with a `styled.div`. No selector used by the E2E test depends on this class, so it can go.

### Untouched (no changes)

- `ResultOverlay`, `ConnectionStatus`, `ErrorToast`, `ActionPanel`, `BetPanel`, `DealButton`, `HandView`, `BetDisplay`, `Bankroll`, `DealerArea`, `TableView` — all already styled. No changes.
- `client/src/store/*`, `socket/*`, `middleware/*` — no logic changes.
- `server/*` — no changes.

## Data flow

No changes to Redux, sockets, or middleware. The flow stays exactly the same as the table.

```
Client UI (reads Redux)
   ↓
handler calls socket.emit(...)        ← Home: room:create / room:join
                                      ← StartButton: round:ready
   ↓
Server validates + returns ack        ← Home: { seatId, roomId } or { ok: false, code }
                                      ← round:ready: full GameState snapshot
   ↓
Socket middleware dispatches into Redux
   ↓
useSelector re-renders Home / Lobby
```

**One new selector** (read-only, derived, no new actions):

```ts
// client/src/selectors/lobby.ts (new file)
import type { RootState } from '../store';

export const selectLobbySeats = (s: RootState) => {
  const state = s.game.state;
  if (state) return state.players;  // full array incl. status: 'empty'
  return s.lobby.players;            // fallback: projection from lobby.slice before the first 'state:update' arrives
};
```

`Lobby.tsx` reads `s.lobby.roomId` (for the room code), `selectLobbySeats` (for the seat grid), and the existing `selectAmIHost` (to gate the start button). `StartButton.tsx` switches from reading `s.lobby.players` to using `selectLobbySeats` so empty seats are properly counted as not-ready.

## Error handling

No new error paths. The current behavior is preserved:

- **`Home.tsx`**: `room:create` and `room:join` already handle ack responses with `ok: false` (sets local `error` state). The current `<p className="error">` becomes a small red-tinted toast below the card — same `setError(...)` calls, same UX, just visually styled. No new error categories, no retry logic.
- **`room:join` `socket.once('error', ...)` listener**: left as-is. It catches the server-side error event for the "Failed to join" case.
- **Lobby**: no new error paths. Connection drops surface through the existing `ConnectionStatus` banner (already styled); server errors surface through `ErrorToast` (already styled). Nothing changes.
- **Start button**: disabled state is the only "error"-adjacent case — and it's a precondition, not an error. Handled by the "Waiting for N more player(s)" hint.

No new error states, no new error components, no error boundaries. The lobby phase is read-only for the client; the server is still source of truth.

## Testing

### Existing tests must still pass

- **Server** (130/130): unchanged. No server code changes.
- **Client unit** (22/22): no test logic changes. `renderWithProviders` (created in the previous pass) is reused.
- **Client E2E** (1 passed, 1 skipped): the happy-path test must still pass.

### E2E selector preservation checklist

The plan must explicitly enumerate these. From `client/e2e/happy-path.spec.ts`:

| Selector | Where it lives | Action |
|---|---|---|
| `input[placeholder="Your name"]` | `Home.tsx` | Keep the `placeholder` attribute verbatim |
| `input[placeholder="Room code"]` | `Home.tsx` | Keep the `placeholder` attribute verbatim |
| `button:has-text("Create Room")` | `Home.tsx` | Keep `"Create Room"` as the button text |
| `button:has-text("Join")` | `Home.tsx` | Keep `"Join"` as the button text |
| `button:has-text("Begin Betting")` | `StartButton.tsx` | Keep `"Begin Betting"` as the button text |
| `.bet-panel` | `BetPanel.tsx` | (Already preserved in the prior polish pass) |
| `.action-panel` | `ActionPanel.tsx` | (Already preserved in the prior polish pass) |
| `.result-overlay` | `ResultOverlay.tsx` | (Already preserved in the prior polish pass) |
| `button:has-text("Place Bet")` | `BetPanel.tsx` | (Already preserved) |
| `button:has-text("Deal")` | `DealButton.tsx` | (Already preserved) |
| `button:has-text("Next Hand")` | `ResultOverlay.tsx` | (Already preserved) |
| `button:has-text("Rebet $50")` | `BetPanel.tsx` | (Already preserved) |

**Lesson from the prior pass**: when a styled-components refactor drops a `className` attribute that an E2E test depends on, the test silently fails at `waitForSelector`. This spec captures all className/placeholder/text dependencies above. The plan will repeat this checklist inside its per-component task steps so the implementer cannot miss any.

### New unit tests

- `client/src/selectors/lobby.spec.ts` (2-3 cases) for `selectLobbySeats`:
  - returns `state.game.state.players` when game state exists
  - returns `state.lobby.players` when game state is null (pre-snapshot fallback)
  - returns the full `Config.SEAT_COUNT` array including `status: 'empty'` entries

No new E2E, no visual regression tooling. Manual verification: load `/`, create a room, see the lobby theater seats, copy the room code, open a second tab, paste the code, see the seats fill, click Begin Betting, see the table.

### Verification commands (run before declaring done)

```bash
cd server && npx jest                            # 130/130
cd server && npx tsc --noEmit                    # clean
cd client && npx vitest run                      # 22/22 + 2-3 new
cd client && npx tsc --noEmit -p tsconfig.json   # clean
cd client && npx playwright test                 # 1 passed, 1 skipped
```

## Out of scope (added to backlog)

- A real player-controlled "I'm ready" toggle (would require server-side changes).
- Copy-to-clipboard for the room code.
- Mobile / responsive design for the lobby.
- Extracting shared primitives (`Button`, `Card`, `Seat`, `Pill`) into `components/ui/`.
- A separate `entrance` theme object + ThemeProvider route switching.
- Theme variants (light / dark / seasonal).
- Sound / animation polish.
- Accessibility audit.
- Visual regression tooling.

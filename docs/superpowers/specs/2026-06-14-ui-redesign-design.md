# UI Polish — Design Spec

**Date:** 2026-06-14
**Status:** Draft, awaiting user review
**Parent spec:** [`2026-06-14-blackjack-21-design.md`](2026-06-14-blackjack-21-design.md)

## Goal

Give the existing blackjack client a polished visual treatment — hand totals, themed colors, and a casino-felt aesthetic — using `styled-components`. The change is strictly visual; no game logic, Redux state, or wire protocol changes.

## Non-Goals (this pass)

- Lobby + Home page styling.
- Mobile / responsive design (still desktop-only per the parent spec).
- Multiple themes (light / dark / seasonal) — single dark felt only.
- Card art SVGs or image assets — pure CSS card visuals.
- Sound effects, card-flip animations, chip-stack physics (parent spec already excludes "animations beyond simple CSS transitions").
- Accessibility audit (no new focus rings, ARIA roles, or keyboard nav for the new controls; we don't regress a11y either).
- Refactors of any non-style code.
- New Redux actions, selectors, slices, or socket events.
- Server-side changes.
- Lint, Prettier, or test-infra changes.

## Constraints / Decisions Locked In

| Decision | Choice | Why |
|---|---|---|
| Styling approach | `styled-components` library | Co-located CSS-in-JS, dynamic props, theme provider, no className soup. ~12KB gzipped runtime. |
| Scope | Polish only — no structural changes | Lowest risk, smallest diff, fastest to ship. |
| Aesthetic | Casino felt (green + cream, **no gold**) | Direction confirmed in mockup. Gold felt gaudy; cream/ivory is the chosen accent. |
| Where to put styles | Co-located in each component file | Component files are small; no need for a separate `styles/` folder per component. |
| Theme | Single theme object | No theme switching. |
| New primitives layer? | **No** | Once the lobby is polished, we'll know which primitives actually get reused. |
| Hand total logic | New pure helper in `client/src/lib/handTotal.ts` | One of two non-styling additions in this pass. Server is still source of truth for `busted` / `isBlackjack`; `handTotal` only computes the *displayed* value. |
| Chip color logic | New pure helper in `client/src/lib/chipColor.ts` | One of two non-styling additions in this pass. Returns the chip color gradient object for a given dollar amount. |
| Test additions | Only `handTotal` and `chipColor` unit tests | No regression of the existing 22 vitest tests + 1 E2E. |
| Visual regression tooling | None | Out of scope; user is the visual reviewer. |

## Architecture

The current client has 14 components, all using `className` attributes — but **no CSS file exists anywhere in the project**. The components render essentially unstyled HTML. This pass introduces real styling on top of the existing component structure.

**Layered structure:**

```
main.tsx
  └─ App.tsx
       └─ <ThemeProvider theme={theme}>
            └─ <GlobalStyle />        ← CSS reset + body background
                 └─ <Router>
                      └─ Home | Table
                           └─ Lobby | TableView
                                └─ DealerArea, PlayerSeat, HandView, ...
```

Every component file uses styled-components defined inline at the bottom of the file. The theme is consumed via `props.theme` in each styled definition. No `import styled from 'styled-components'` re-exports, no design-system layer.

**Hidden card invariant (re-stated for safety):** the dealer's hole card is `{ hidden: true }` in `state.dealer.cards` until `state.phase === 'dealer_turn' || 'settled'`. We render the hidden card visually (red-stripe back, "?") and the hand total pill as "Showing N". We never unhide locally — the server is the source of truth.

## Theme

Single exported object, typed via `typeof theme`:

```ts
// client/src/styles/theme.ts
export const theme = {
  colors: {
    // Felt (the table)
    feltLight:  '#2d6a4f',
    feltMid:    '#1b4332',
    feltDark:   '#0f2a20',
    feltBorder: '#2b1d0e',
    feltStitch: 'rgba(220,210,190,0.22)',

    // Text (cream/ivory, not gold)
    textPrimary:   '#ece4d4',
    textSecondary: '#c9bfa8',
    textDim:       '#a8a194',

    // Cards
    cardWhite: '#fafafa',
    cardBlack: '#111111',
    cardRed:   '#d40000',
    cardBackFrom: '#8b1a1a',
    cardBackTo:   '#5a0f0f',

    // Status
    statusActive:    '#ece4d4',
    statusWin:       '#4ade80',
    statusLose:      '#f87171',
    statusPush:      '#94a3b8',
    statusBlackjack: '#fde047',

    // Surfaces
    surfaceDim:        'rgba(0,0,0,0.25)',
    surfaceDimmer:     'rgba(0,0,0,0.40)',
    surfaceBorder:     'rgba(220,210,190,0.25)',
    surfaceBorderActive: '#ece4d4',

    // Bet chip colors
    chipRed:   { from: '#d40000', to: '#8b0000' },
    chipBlue:  { from: '#2563eb', to: '#1e3a8a' },
    chipGreen: { from: '#16a34a', to: '#14532d' },
    chipBlack: { from: '#262626', to: '#0a0a0a' },
  },

  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', xxl: '32px' },

  typography: {
    fontFamily: '"Georgia", "Times New Roman", serif',
    bodySize:  '14px',
    smallSize: '11px',
    largeSize: '18px',
    titleSize: '22px',
  },

  radii: { sm: '4px', md: '6px', lg: '12px', pill: '180px' },

  shadows: {
    card:        '0 2px 4px rgba(0,0,0,0.4)',
    cardLarge:   '0 2px 6px rgba(0,0,0,0.5)',
    activeGlow:  '0 0 18px rgba(236,228,212,0.35)',
    table:       'inset 0 0 80px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.6)',
  },
};

export type AppTheme = typeof theme;
```

```ts
// client/src/styles/GlobalStyle.ts
import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { margin: 0; padding: 0; min-height: 100%; }
  body {
    background: #0a1612; /* behind the table */
    color: #ece4d4;
    font-family: ${({ theme }) => theme.typography.fontFamily};
    font-size: ${({ theme }) => theme.typography.bodySize};
    -webkit-font-smoothing: antialiased;
  }
  button { font-family: inherit; }
`;
```

## Hand total

Pure function in `client/src/lib/handTotal.ts`. No React, no Redux, no IO.

```ts
import type { Hand, Card, CardSlot } from '../shared/types';

export type HandTotal = {
  total: number;
  soft: boolean;
  hasHidden: boolean;
  isBlackjack: boolean;
  isBust: boolean;
};

export function handTotal(hand: Hand): HandTotal {
  const hasHidden = hand.cards.some(isHidden);
  const visible = hand.cards.filter(isVisible);
  const total = bestTotal(visible);
  return {
    total,
    soft: isSoft(visible, total),
    hasHidden,
    isBlackjack: hand.isBlackjack,
    isBust: hand.busted,
  };
}

function isHidden(c: CardSlot): c is { hidden: true } { return 'hidden' in c; }
function isVisible(c: CardSlot): c is Card { return !('hidden' in c); }

function cardPoints(c: Card): number {
  if (c.rank === 'A') return 11;
  if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') return 10;
  return parseInt(c.rank, 10);
}

function bestTotal(cards: Card[]): number {
  let total = cards.reduce((sum, c) => sum + cardPoints(c), 0);
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}

function isSoft(cards: Card[], best: number): boolean {
  if (!cards.some((c) => c.rank === 'A')) return false;
  const hard = cards.reduce((sum, c) => sum + (c.rank === 'A' ? 1 : cardPoints(c)), 0);
  return best !== hard; // an ace is still being counted as 11
}
```

**Display rules** (used by `HandView` and the dealer area):
- `hasHidden` → render the total inside a pill labeled "Showing N".
- else → render just the number.
- `isBust` → color the number with `colors.statusLose`.
- `isBlackjack` and 2 cards → color with `colors.statusBlackjack`.
- otherwise → `textPrimary` cream.

## Chip color helper

```ts
// client/src/lib/chipColor.ts
import type { AppTheme } from '../styles/theme';

export function chipColor(amount: number, theme: AppTheme) {
  if (amount >= 100) return theme.colors.chipBlack;
  if (amount >= 25)  return theme.colors.chipGreen;
  if (amount >= 5)   return theme.colors.chipBlue;
  return theme.colors.chipRed;
}
```

## Component-by-component breakdown

Each component gets `styled-components` definitions added inline at the bottom of its file. No new component files, no new primitive abstractions. Every `className=` is removed.

| Component | What it gets |
|---|---|
| `TableView.tsx` | Oval felt table: wood border (`#2b1d0e`), radial-gradient felt fill, dashed cream stitching, "BLACKJACK PAYS 3 TO 2" text, dim radial vignette. Loading state: centered cream message. |
| `DealerArea.tsx` | Uppercase "DEALER" label in muted tan, hand centered, total pill ("Showing N" when hole card is hidden, plain `N` after reveal). |
| `PlayerSeat.tsx` | Surface box, dim bg, rounded corners. Active seat: cream border + `activeGlow` shadow. Header row: name + status pill (`YOUR TURN`, `STOOD`, `BUSTED`, `BLACKJACK`). Bankroll in dim text. |
| `HandView.tsx` | Card art: 56×80 cards with white bg, rank + large suit. Suit-colored: red (`#d40000`) for ♥♦, black (`#111`) for ♠♣. Hidden card: diagonal red-stripe pattern with "?". Hand total next to the cards. |
| `Bankroll.tsx` | Just `$N` in dim cream. |
| `BetDisplay.tsx` | A chip + label. Chip color by amount via `chipColor`. Value rendered in the chip center. |
| `BetPanel.tsx` | Row of preset bet chips using the same chip styling, plus a "Confirm Bet" button. Hidden until betting phase. |
| `DealButton.tsx` | Large cream button centered. Disabled state: dim, no shadow, `cursor: not-allowed`. |
| `ActionPanel.tsx` | Row of 4 buttons. **Hit** is primary (cream bg, dark text). Stand / Double / Split are dim. Buttons that are not legal are not rendered. |
| `ConnectionStatus.tsx` | Top-left pill. Green / amber / red dot with "Connected" / "Reconnecting…" / "Disconnected". |
| `ErrorToast.tsx` | Top-right floating panel, dim red bg + cream text. Simple opacity fade (200ms in, 3s display, 200ms out). |
| `ResultOverlay.tsx` | Centered modal-style panel. Payouts list with color-coded deltas: green `+$N` (win), red `−$N` (lose), gray `$0` (push), gold-yellow `BLACKJACK +$N` (blackjack). "Next Hand" button (host only). |

## Data flow

No changes. The existing flow is:

```
Client UI (reads Redux)
   ↓
useEffect / handler calls socket.emit(...)
   ↓
Socket.io middleware → server
   ↓
Server returns full GameState snapshot
   ↓
Socket middleware dispatches state into Redux
   ↓
useSelector re-renders TableView → PlayerSeat → HandView
```

`handTotal` is a derived value called inside `HandView` (which renders both player and dealer hands). It does not enter Redux. It is not memoized with `reselect` because the call is O(n) over a hand of ≤ ~10 cards, called from a small number of components. `HandView` is the single call site; the parent (`PlayerSeat`, `DealerArea`) does not need to compute totals.

## Error handling

No new error paths. Existing error display is via `ErrorToast` (server-side error events dispatched into Redux). The polish is visual only — the existing `error` Redux state and the `ErrorToast` component's `useEffect` for auto-dismiss remain untouched.

## Testing

**New unit tests:**
- `client/src/lib/handTotal.test.ts` (8 cases): hard 17, soft 17, demoted ace, bust, hidden ignored, all hidden, empty hand, blackjack.
- `client/src/lib/chipColor.test.ts` (8 cases): $0, $4, $5, $24, $25, $99, $100, $1000.

**Existing tests:** unchanged. The 22 vitest tests + 1 E2E (1 passed, 1 skipped) must still pass.

**TypeScript check:** `cd client && npx tsc --noEmit -p tsconfig.json` must be clean. styled-components' `noUnusedLocals` interactions are addressed by removing every dead `className=` in the same pass that removes its associated styled definition.

**No new E2E, no visual regression tooling.**

**Verification before completion:**
- `cd client && npx vitest run` → all green (existing + new)
- `cd client && npx tsc --noEmit -p tsconfig.json` → clean
- `cd client && npx playwright test` → 1 passed, 1 skipped
- Manual: load the table view, place a bet, deal, hit, stand — confirm the visual matches the mockup direction.

## Out of scope (added to backlog)

- Polish the Lobby + Home page
- Extract primitives (Card, Chip, Pill, Button) once the lobby uses the same patterns
- Theme switcher (e.g. "light felt" variant)
- Visual regression tooling
- Accessibility audit
- Sound / animation polish beyond what this pass produces

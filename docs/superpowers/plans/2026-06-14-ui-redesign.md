# UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished casino-felt visual treatment to the existing blackjack client using `styled-components`, including hand totals, themed colors, and per-component styling. No game logic, Redux, or server changes.

**Architecture:** Add `styled-components` library and a single `theme` object. Each existing component gets inline `styled-components` definitions at the bottom of its file. Two new pure helpers (`handTotal`, `chipColor`) drive derived display values. The `ThemeProvider` wraps the existing Router; `GlobalStyle` resets CSS and styles the body.

**Tech Stack:** React 18, TypeScript, Vite, Redux Toolkit, styled-components 6, Vitest, Playwright.

**Spec:** [`../specs/2026-06-14-ui-redesign-design.md`](../specs/2026-06-14-ui-redesign-design.md)

---

## File Map

### New files
- `client/src/styles/theme.ts` — single `theme` object (colors, spacing, typography, radii, shadows) + `AppTheme` type.
- `client/src/styles/styled.d.ts` — module augmentation so `props.theme` is type-checked.
- `client/src/styles/GlobalStyle.ts` — `createGlobalStyle` with CSS reset and body bg.
- `client/src/lib/handTotal.ts` — pure function returning `{ total, soft, hasHidden, isBlackjack, isBust }`.
- `client/src/lib/chipColor.ts` — pure function returning a chip color gradient object.
- `client/test/helpers/renderWithProviders.tsx` — test helper that wraps in `Provider` + `ThemeProvider`.
- `client/test/lib/handTotal.spec.ts` — 8 handTotal tests.
- `client/test/lib/chipColor.spec.ts` — 8 chipColor tests.

### Modified files
- `client/package.json` — add `styled-components` dependency.
- `client/src/App.tsx` — wrap Router in `<ThemeProvider>` and add `<GlobalStyle />`.
- 12 component files in `client/src/components/` (see Component Breakdown in spec).
- 2 existing test files: `client/test/components/result-overlay.spec.tsx` and `client/test/components/bet-panel.spec.tsx` (swap to the new `renderWithProviders` helper).

### Out of scope (do NOT touch)
- `client/src/components/Lobby.tsx`, `client/src/components/RoomCode.tsx`, `client/src/components/StartButton.tsx`, `client/src/components/PlayerList.tsx` — lobby is out of scope.
- `client/src/pages/Home.tsx` — home page is out of scope.
- `client/src/store/*`, `client/src/selectors/*`, `client/src/middleware/*`, `client/src/socket/*` — no logic changes.
- `client/src/shared/types.ts` — no new types in the wire protocol.
- `server/` — no server changes.

---

## Task 1: Add styled-components dependency

**Files:**
- Modify: `client/package.json`

- [ ] **Step 1: Install styled-components**

Run from the repo root:
```bash
cd /Users/dev/Documents/GitHub/redux-blackjack-21 && npm install --workspace client styled-components@^6.1.0
```

Expected: package added to `client/package.json` dependencies. `client/node_modules/styled-components/` is created.

- [ ] **Step 2: Verify the install**

Run: `cd client && cat package.json | grep styled-components`
Expected: line `"styled-components": "^6.1.x"` appears in the `dependencies` block.

- [ ] **Step 3: Verify nothing else broke**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (clean type check, no new errors).

- [ ] **Step 4: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "chore(client): add styled-components 6 dependency"
```

---

## Task 2: Create theme.ts

**Files:**
- Create: `client/src/styles/theme.ts`

- [ ] **Step 1: Create the styles directory and theme file**

Create `client/src/styles/theme.ts` with this exact content:

```ts
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

    // Surfaces (dim overlays on the felt)
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

  spacing: {
    xs:  '4px',
    sm:  '8px',
    md:  '12px',
    lg:  '16px',
    xl:  '24px',
    xxl: '32px',
  },

  typography: {
    fontFamily: '"Georgia", "Times New Roman", serif',
    bodySize:  '14px',
    smallSize: '11px',
    largeSize: '18px',
    titleSize: '22px',
  },

  radii: {
    sm:   '4px',
    md:   '6px',
    lg:   '12px',
    pill: '180px',
  },

  shadows: {
    card:       '0 2px 4px rgba(0,0,0,0.4)',
    cardLarge:  '0 2px 6px rgba(0,0,0,0.5)',
    activeGlow: '0 0 18px rgba(236,228,212,0.35)',
    table:      'inset 0 0 80px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.6)',
  },
};

export type AppTheme = typeof theme;
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (clean).

- [ ] **Step 3: Commit**

```bash
git add client/src/styles/theme.ts
git commit -m "feat(client): add theme object for styled-components"
```

---

## Task 3: Augment styled-components DefaultTheme type

**Files:**
- Create: `client/src/styles/styled.d.ts`

This gives `props.theme.colors.feltLight` proper TypeScript types in every styled definition.

- [ ] **Step 1: Create the type augmentation file**

Create `client/src/styles/styled.d.ts` with this exact content:

```ts
import 'styled-components';
import type { theme } from './theme';

declare module 'styled-components' {
  export interface DefaultTheme {
    colors: typeof theme.colors;
    spacing: typeof theme.spacing;
    typography: typeof theme.typography;
    radii: typeof theme.radii;
    shadows: typeof theme.shadows;
  }
}
```

- [ ] **Step 2: Verify tsc still passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/styles/styled.d.ts
git commit -m "feat(client): augment styled-components DefaultTheme type"
```

---

## Task 4: Create GlobalStyle

**Files:**
- Create: `client/src/styles/GlobalStyle.ts`

- [ ] **Step 1: Create GlobalStyle**

Create `client/src/styles/GlobalStyle.ts` with this exact content:

```ts
import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { margin: 0; padding: 0; min-height: 100%; }
  body {
    background: #0a1612;
    color: ${({ theme }) => theme.colors.textPrimary};
    font-family: ${({ theme }) => theme.typography.fontFamily};
    font-size: ${({ theme }) => theme.typography.bodySize};
    -webkit-font-smoothing: antialiased;
  }
  button { font-family: inherit; }
`;
```

- [ ] **Step 2: Verify tsc still passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (the `theme` prop is typed via the augmentation in Task 3).

- [ ] **Step 3: Commit**

```bash
git add client/src/styles/GlobalStyle.ts
git commit -m "feat(client): add GlobalStyle with reset and body background"
```

---

## Task 5: Create test helper that wraps in ThemeProvider

**Files:**
- Create: `client/test/helpers/renderWithProviders.tsx`

We need this so the existing tests don't break when their components start using `props.theme`. After this helper exists, the two affected existing test files are updated in Task 6.

- [ ] **Step 1: Create the helper**

Create `client/test/helpers/renderWithProviders.tsx` with this exact content:

```tsx
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import type { ReactElement } from 'react';
import { theme } from '../../src/styles/theme';
import type { store as AppStore } from '../../src/store';

type Store = ReturnType<typeof AppStore.getState> extends infer _S
  ? ReturnType<typeof import('@reduxjs/toolkit').configureStore> | typeof AppStore
  : never;

type Opts = Omit<RenderOptions, 'wrapper'> & { store: any };

export function renderWithProviders(ui: ReactElement, opts: Opts): RenderResult {
  const { store, ...rest } = opts;
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </Provider>,
    rest,
  );
}
```

Note: the `Store` type alias above is intentionally broad (`any`) because the existing tests already cast to `any` when calling `configureStore`. This keeps the helper simple and the existing test files don't need their store types changed.

- [ ] **Step 2: Verify tsc still passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add client/test/helpers/renderWithProviders.tsx
git commit -m "test(client): add renderWithProviders helper with ThemeProvider"
```

---

## Task 6: Update existing component tests to use renderWithProviders

**Files:**
- Modify: `client/test/components/result-overlay.spec.tsx`
- Modify: `client/test/components/bet-panel.spec.tsx`

- [ ] **Step 1: Update result-overlay.spec.tsx**

Replace the file at `client/test/components/result-overlay.spec.tsx` with this content (only the imports and the `renderWith` helper change; all tests stay byte-identical):

```tsx
import { configureStore } from '@reduxjs/toolkit';
import { screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, it, expect } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { ResultOverlay } from '../../src/components/ResultOverlay';
import type { GameState, RoundResult } from '../../src/shared/types';
import { connectionReducer } from '../../src/store/connection.slice';
import { gameReducer } from '../../src/store/game.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';

function makeStore(opts: {
  phase: GameState['phase'];
  amIHost: boolean;
  lastResult: RoundResult | null;
}) {
  const state: GameState = {
    roomId: 'R',
    phase: opts.phase,
    shoeSize: 200,
    cutCardIndex: 50,
    players: [
      {
        id: 's0',
        name: 'Alice',
        bankroll: 1000,
        hands: [],
        status: 'stood',
        connectedAt: 0,
        lastBet: 50,
      },
    ],
    dealer: {
      cards: [],
      bet: 0,
      stood: false,
      busted: false,
      isBlackjack: false,
      doubled: false,
    },
    activeSeat: null,
    roundNumber: 1,
    lastResult: opts.lastResult,
  };
  return configureStore({
    reducer: {
      connection: connectionReducer,
      lobby: lobbyReducer,
      game: gameReducer,
      ui: uiReducer,
    },
    preloadedState: {
      game: { state, lastResult: opts.lastResult },
      connection: {
        selfSeatId: 's0',
        status: 'connected' as const,
        lastError: null,
      },
      lobby: { roomId: 'R', hostId: opts.amIHost ? 's0' : 's1', players: [] },
      ui: { betInputValue: 50, toasts: [] },
    },
  } as any);
}

function renderWith(ui: React.ReactNode, store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </Provider>,
  );
}

// Needed for the `render` import
import { render } from '@testing-library/react';

describe('<ResultOverlay />', () => {
  it('renders nothing when phase is not settled', () => {
    const store = makeStore({
      phase: 'betting',
      amIHost: true,
      lastResult: null,
    });
    const { container } = renderWith(<ResultOverlay />, store);
    expect(container.firstChild).toBeNull();
  });

  it('renders the payout list during settled', () => {
    const result: RoundResult = {
      payouts: [{ seatId: 's0', delta: 50, reason: 'win' }],
    };
    const store = makeStore({
      phase: 'settled',
      amIHost: false,
      lastResult: result,
    });
    renderWith(<ResultOverlay />, store);
    expect(screen.getByText(/Round Over/i)).toBeInTheDocument();
    expect(screen.getByText(/win/i)).toBeInTheDocument();
  });

  it('shows Next Hand button to the host during settled', () => {
    const result: RoundResult = {
      payouts: [{ seatId: 's0', delta: 50, reason: 'win' }],
    };
    const store = makeStore({
      phase: 'settled',
      amIHost: true,
      lastResult: result,
    });
    renderWith(<ResultOverlay />, store);
    expect(
      screen.getByRole('button', { name: /next hand/i }),
    ).toBeInTheDocument();
  });

  it('hides Next Hand button from non-hosts', () => {
    const result: RoundResult = {
      payouts: [{ seatId: 's0', delta: 50, reason: 'win' }],
    };
    const store = makeStore({
      phase: 'settled',
      amIHost: false,
      lastResult: result,
    });
    renderWith(<ResultOverlay />, store);
    expect(screen.queryByRole('button', { name: /next hand/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Update bet-panel.spec.tsx**

Replace the file at `client/test/components/bet-panel.spec.tsx` with this content:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from 'styled-components';
import { BetPanel } from '../../src/components/BetPanel';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import * as socketClient from '../../src/socket/client';
import type { GameState } from '../../src/shared/types';
import { theme } from '../../src/styles/theme';

function makeStore(opts: { phase: GameState['phase']; lastBet: number; bankroll: number; status: GameState['players'][number]['status'] }) {
  const state: GameState = {
    roomId: 'R', phase: opts.phase, shoeSize: 200, cutCardIndex: 50,
    players: [{ id: 's0', name: 'Alice', bankroll: opts.bankroll, hands: [], status: opts.status, connectedAt: 0, lastBet: opts.lastBet }],
    dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
    activeSeat: null, roundNumber: 1, lastResult: null,
  };
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
    preloadedState: {
      game: { state, lastResult: null },
      connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
      lobby: { roomId: 'R', hostId: 's0', players: [] },
      ui: { betInputValue: 50, toasts: [] },
    },
  } as any);
}

function renderWith(ui: React.ReactNode, store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </Provider>,
  );
}

describe('<BetPanel />', () => {
  it('renders nothing outside the betting phase', () => {
    const store = makeStore({ phase: 'player_turn', lastBet: 50, bankroll: 1000, status: 'betting' });
    const { container } = renderWith(<BetPanel />, store);
    expect(container.firstChild).toBeNull();
  });

  it('shows the Place Bet input and button during betting', () => {
    const store = makeStore({ phase: 'betting', lastBet: 0, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.getByRole('button', { name: /place bet/i })).toBeInTheDocument();
  });

  it('hides the Rebet button when lastBet is 0', () => {
    const store = makeStore({ phase: 'betting', lastBet: 0, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.queryByRole('button', { name: /rebet/i })).toBeNull();
  });

  it('hides the Rebet button when lastBet exceeds bankroll', () => {
    const store = makeStore({ phase: 'betting', lastBet: 500, bankroll: 100, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.queryByRole('button', { name: /rebet/i })).toBeNull();
  });

  it('shows the Rebet button when lastBet > 0 and lastBet <= bankroll', () => {
    const store = makeStore({ phase: 'betting', lastBet: 50, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    expect(screen.getByRole('button', { name: /rebet \$50/i })).toBeInTheDocument();
  });

  it('emits bet:place with the last bet amount when Rebet is clicked', () => {
    const emit = vi.fn();
    vi.spyOn(socketClient, 'getSocket').mockReturnValue({ emit } as any);
    const store = makeStore({ phase: 'betting', lastBet: 75, bankroll: 1000, status: 'betting' });
    renderWith(<BetPanel />, store);
    fireEvent.click(screen.getByRole('button', { name: /rebet \$75/i }));
    expect(emit).toHaveBeenCalledWith('bet:place', { amount: 75 });
  });
});
```

- [ ] **Step 3: Verify both test files still pass**

Run: `cd client && npx vitest run test/components/result-overlay.spec.tsx test/components/bet-panel.spec.tsx`
Expected: all 10 tests pass (4 from result-overlay + 6 from bet-panel). The tests do not exercise styled-components yet, so the test renders should produce unstyled DOM (the components haven't been styled yet) — that's fine, the tests check for text and roles, not classes.

- [ ] **Step 4: Commit**

```bash
git add client/test/components/result-overlay.spec.tsx client/test/components/bet-panel.spec.tsx
git commit -m "test(client): wrap existing component tests in ThemeProvider"
```

---

## Task 7: Wire ThemeProvider + GlobalStyle into App.tsx

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace App.tsx**

Replace `client/src/App.tsx` with this content:

```tsx
import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { connect } from './socket/client';
import { connectionEstablished } from './store/connection.slice';
import { attachSocketListeners } from './middleware/socket.middleware';
import { Home } from './pages/Home';
import { Table } from './pages/Table';
import { theme } from './styles/theme';
import { GlobalStyle } from './styles/GlobalStyle';

export function App() {
  const dispatch = useDispatch();
  useEffect(() => {
    const socket = connect();
    attachSocketListeners(socket, dispatch);
    socket.on('connect', () => dispatch(connectionEstablished(socket.id ?? '')));
  }, [dispatch]);

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:code" element={<Table />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Verify tsc still passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Run the full client test suite to confirm no regressions**

Run: `cd client && npx vitest run`
Expected: all existing tests pass (22/22). Nothing about the tests has actually changed — components are still unstyled, so behavior is identical. The test helper update from Task 6 is the only test-side change so far.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(client): wrap App in ThemeProvider and add GlobalStyle"
```

---

## Task 8: handTotal — write the failing tests

**Files:**
- Create: `client/test/lib/handTotal.spec.ts`

- [ ] **Step 1: Create the test file**

Create `client/test/lib/handTotal.spec.ts` with this content:

```ts
import { describe, it, expect } from 'vitest';
import { handTotal } from '../../src/lib/handTotal';
import type { Hand } from '../../src/shared/types';

function hand(cards: Hand['cards'], overrides: Partial<Hand> = {}): Hand {
  return {
    cards,
    bet: 0,
    stood: false,
    busted: false,
    isBlackjack: false,
    doubled: false,
    ...overrides,
  };
}

describe('handTotal', () => {
  it('returns 0 for an empty hand', () => {
    expect(handTotal(hand([]))).toEqual({
      total: 0,
      soft: false,
      hasHidden: false,
      isBlackjack: false,
      isBust: false,
    });
  });

  it('computes a hard 17 (K + 7)', () => {
    const h = hand([
      { suit: '♠', rank: 'K' },
      { suit: '♥', rank: '7' },
    ]);
    expect(handTotal(h)).toEqual({
      total: 17,
      soft: false,
      hasHidden: false,
      isBlackjack: false,
      isBust: false,
    });
  });

  it('computes a soft 17 (A + 6)', () => {
    const h = hand([
      { suit: '♠', rank: 'A' },
      { suit: '♥', rank: '6' },
    ]);
    expect(handTotal(h).total).toBe(17);
    expect(handTotal(h).soft).toBe(true);
  });

  it('demotes an ace from 11 to 1 when the hand would bust (A + A + 6 = 18)', () => {
    const h = hand([
      { suit: '♠', rank: 'A' },
      { suit: '♥', rank: 'A' },
      { suit: '♦', rank: '6' },
    ]);
    const t = handTotal(h);
    expect(t.total).toBe(18);
    expect(t.soft).toBe(true);
  });

  it('reports a bust (K + Q + 5 = 25)', () => {
    const h = hand(
      [
        { suit: '♠', rank: 'K' },
        { suit: '♥', rank: 'Q' },
        { suit: '♦', rank: '5' },
      ],
      { busted: true },
    );
    const t = handTotal(h);
    expect(t.total).toBe(25);
    expect(t.isBust).toBe(true);
  });

  it('ignores a single hidden card in the dealer hand', () => {
    const h = hand([
      { hidden: true },
      { suit: '♠', rank: '7' },
    ]);
    const t = handTotal(h);
    expect(t.total).toBe(7);
    expect(t.hasHidden).toBe(true);
  });

  it('reports hasHidden when every card is hidden', () => {
    const h = hand([{ hidden: true }, { hidden: true }]);
    expect(handTotal(h)).toEqual({
      total: 0,
      soft: false,
      hasHidden: true,
      isBlackjack: false,
      isBust: false,
    });
  });

  it('flags a blackjack (A + K with hand.isBlackjack === true)', () => {
    const h = hand(
      [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ],
      { isBlackjack: true },
    );
    const t = handTotal(h);
    expect(t.total).toBe(21);
    expect(t.isBlackjack).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run test/lib/handTotal.spec.ts`
Expected: FAIL with module-not-found for `../../src/lib/handTotal` (the file doesn't exist yet).

- [ ] **Step 3: Commit (just the failing test)**

```bash
git add client/test/lib/handTotal.spec.ts
git commit -m "test(client): add handTotal unit tests (RED)"
```

---

## Task 9: handTotal — implement the function

**Files:**
- Create: `client/src/lib/handTotal.ts`

- [ ] **Step 1: Create handTotal.ts**

Create `client/src/lib/handTotal.ts` with this content:

```ts
import type { Card, CardSlot, Hand } from '../shared/types';

export type HandTotal = {
  /** Best non-bust total. The bust total if no non-bust total is possible. */
  total: number;
  /** True if at least one ace is currently counted as 11. */
  soft: boolean;
  /** True if the hand contains a hidden card whose value is unknown. */
  hasHidden: boolean;
  /** Mirrors Hand.isBlackjack. */
  isBlackjack: boolean;
  /** Mirrors Hand.busted. */
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

function isHidden(c: CardSlot): c is { hidden: true } {
  return 'hidden' in c;
}
function isVisible(c: CardSlot): c is Card {
  return !('hidden' in c);
}

function cardPoints(c: Card): number {
  if (c.rank === 'A') return 11;
  if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') return 10;
  return parseInt(c.rank, 10);
}

function bestTotal(cards: Card[]): number {
  let total = cards.reduce((sum, c) => sum + cardPoints(c), 0);
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10; // demote an ace from 11 to 1
    aces -= 1;
  }
  return total;
}

function isSoft(cards: Card[], best: number): boolean {
  if (!cards.some((c) => c.rank === 'A')) return false;
  const hard = cards.reduce(
    (sum, c) => sum + (c.rank === 'A' ? 1 : cardPoints(c)),
    0,
  );
  return best !== hard; // an ace is still being counted as 11
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd client && npx vitest run test/lib/handTotal.spec.ts`
Expected: all 8 tests pass.

- [ ] **Step 3: Verify tsc still passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/handTotal.ts
git commit -m "feat(client): add handTotal helper (GREEN)"
```

---

## Task 10: chipColor — write the failing tests

**Files:**
- Create: `client/test/lib/chipColor.spec.ts`

- [ ] **Step 1: Create the test file**

Create `client/test/lib/chipColor.spec.ts` with this content:

```ts
import { describe, it, expect } from 'vitest';
import { chipColor } from '../../src/lib/chipColor';
import { theme } from '../../src/styles/theme';

describe('chipColor', () => {
  it('returns red for $0', () => {
    expect(chipColor(0, theme)).toBe(theme.colors.chipRed);
  });

  it('returns red for $4 (below the blue threshold)', () => {
    expect(chipColor(4, theme)).toBe(theme.colors.chipRed);
  });

  it('returns blue for $5 (at the blue threshold)', () => {
    expect(chipColor(5, theme)).toBe(theme.colors.chipBlue);
  });

  it('returns blue for $24 (below the green threshold)', () => {
    expect(chipColor(24, theme)).toBe(theme.colors.chipBlue);
  });

  it('returns green for $25 (at the green threshold)', () => {
    expect(chipColor(25, theme)).toBe(theme.colors.chipGreen);
  });

  it('returns green for $99 (below the black threshold)', () => {
    expect(chipColor(99, theme)).toBe(theme.colors.chipGreen);
  });

  it('returns black for $100 (at the black threshold)', () => {
    expect(chipColor(100, theme)).toBe(theme.colors.chipBlack);
  });

  it('returns black for $1000', () => {
    expect(chipColor(1000, theme)).toBe(theme.colors.chipBlack);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run test/lib/chipColor.spec.ts`
Expected: FAIL with module-not-found for `../../src/lib/chipColor`.

- [ ] **Step 3: Commit (just the failing test)**

```bash
git add client/test/lib/chipColor.spec.ts
git commit -m "test(client): add chipColor unit tests (RED)"
```

---

## Task 11: chipColor — implement the function

**Files:**
- Create: `client/src/lib/chipColor.ts`

- [ ] **Step 1: Create chipColor.ts**

Create `client/src/lib/chipColor.ts` with this content:

```ts
import type { AppTheme } from '../styles/theme';

export function chipColor(amount: number, theme: AppTheme) {
  if (amount >= 100) return theme.colors.chipBlack;
  if (amount >= 25) return theme.colors.chipGreen;
  if (amount >= 5) return theme.colors.chipBlue;
  return theme.colors.chipRed;
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd client && npx vitest run test/lib/chipColor.spec.ts`
Expected: all 8 tests pass.

- [ ] **Step 3: Verify tsc still passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/chipColor.ts
git commit -m "feat(client): add chipColor helper (GREEN)"
```

---

## Task 12: Style Bankroll

**Files:**
- Modify: `client/src/components/Bankroll.tsx`

- [ ] **Step 1: Replace Bankroll.tsx**

Replace `client/src/components/Bankroll.tsx` with this content:

```tsx
import styled from 'styled-components';

const Wrapper = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 0.5px;
`;

export function Bankroll({ amount }: { amount: number }) {
  return <Wrapper>${amount}</Wrapper>;
}
```

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass (22 existing + 8 handTotal + 8 chipColor).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Bankroll.tsx
git commit -m "style(client): polish Bankroll with cream dim text"
```

---

## Task 13: Style HandView (with hand totals and card art)

**Files:**
- Modify: `client/src/components/HandView.tsx`

This component now calls `handTotal` and renders the total pill, plus styled cards. The card back is the diagonal red-stripe pattern.

- [ ] **Step 1: Replace HandView.tsx**

Replace `client/src/components/HandView.tsx` with this content:

```tsx
import styled, { css } from 'styled-components';
import type { Hand, CardSlot, Card } from '../shared/types';
import { handTotal } from '../lib/handTotal';

const HandRow = styled.div<{ $isDealer: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-direction: ${({ $isDealer }) => ($isDealer ? 'row' : 'row')};
  justify-content: ${({ $isDealer }) =>
    $isDealer ? 'center' : 'flex-start'};
`;

const Label = styled.div`
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const CardBase = styled.div`
  width: 56px;
  height: 80px;
  border-radius: ${({ theme }) => theme.radii.md};
  box-shadow: ${({ theme }) => theme.shadows.card};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  line-height: 1;
`;

const CardFront = styled(CardBase)<{ $red: boolean }>`
  background: ${({ theme }) => theme.colors.cardWhite};
  border: 1px solid #ccc;
  color: ${({ $red, theme }) =>
    $red ? theme.colors.cardRed : theme.colors.cardBlack};
  font-size: 18px;
  & > .suit { font-size: 28px; margin-top: 2px; }
`;

const CardBack = styled(CardBase)`
  background: repeating-linear-gradient(
    45deg,
    ${({ theme }) => theme.colors.cardBackFrom} 0px,
    ${({ theme }) => theme.colors.cardBackFrom} 6px,
    ${({ theme }) => theme.colors.cardBackTo} 6px,
    ${({ theme }) => theme.colors.cardBackTo} 12px
  );
  border: 2px solid ${({ theme }) => theme.colors.textSecondary};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 22px;
`;

const Total = styled.div<{
  $hidden: boolean;
  $blackjack: boolean;
  $bust: boolean;
}>`
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.sm}`};
  font-size: 16px;
  font-weight: bold;
  margin-left: ${({ theme }) => theme.spacing.sm};
  color: ${({ $hidden, $blackjack, $bust, theme }) => {
    if ($bust) return theme.colors.statusLose;
    if ($blackjack) return theme.colors.statusBlackjack;
    if ($hidden) return theme.colors.textPrimary;
    return theme.colors.textPrimary;
  }};
  letter-spacing: 1px;
`;

const HiddenPrefix = styled.span`
  font-size: 10px;
  font-weight: normal;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-right: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const isRedSuit = (c: Card) => c.suit === '♥' || c.suit === '♦';

function CardView({ card }: { card: CardSlot }) {
  if ('hidden' in card) {
    return <CardBack>?</CardBack>;
  }
  return (
    <CardFront $red={isRedSuit(card)}>
      <div>{card.rank}</div>
      <div className="suit">{card.suit}</div>
    </CardFront>
  );
}

export function HandView({
  hand,
  label,
  isDealer = false,
}: {
  hand: Hand;
  label?: string;
  isDealer?: boolean;
}) {
  const t = handTotal(hand);
  return (
    <div>
      {label && <Label>{label}</Label>}
      <HandRow $isDealer={isDealer}>
        {hand.cards.map((c, i) => (
          <CardView key={i} card={c} />
        ))}
        <Total $hidden={t.hasHidden} $blackjack={t.isBlackjack} $bust={t.isBust}>
          {t.hasHidden && <HiddenPrefix>Showing</HiddenPrefix>}
          {t.total}
        </Total>
      </HandRow>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/HandView.tsx
git commit -m "style(client): polish HandView with card art and hand totals"
```

---

## Task 14: Style BetDisplay (with chipColor)

**Files:**
- Modify: `client/src/components/BetDisplay.tsx`

- [ ] **Step 1: Replace BetDisplay.tsx**

Replace `client/src/components/BetDisplay.tsx` with this content:

```tsx
import styled from 'styled-components';
import { chipColor } from '../lib/chipColor';
import { theme as defaultTheme } from '../styles/theme';
import type { AppTheme } from '../styles/theme';

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const Chip = styled.div<{ $bg: string; $to: string }>`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${({ $bg, $to }) => `linear-gradient(135deg, ${$bg} 0%, ${$to} 100%)`};
  border: 3px dashed ${({ theme }) => theme.colors.cardWhite};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.cardWhite};
  font-size: 10px;
  font-weight: bold;
  box-shadow: ${({ theme }) => theme.shadows.card};
`;

const Label = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 0.5px;
`;

export function BetDisplay({ bet }: { bet: number }) {
  if (bet === 0) return null;
  const chip = chipColor(bet, defaultTheme as AppTheme);
  return (
    <Wrapper>
      <Chip $bg={chip.from} $to={chip.to}>${bet}</Chip>
      <Label>bet</Label>
    </Wrapper>
  );
}
```

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/BetDisplay.tsx
git commit -m "style(client): polish BetDisplay with chip visual"
```

---

## Task 15: Style DealButton

**Files:**
- Modify: `client/src/components/DealButton.tsx`

- [ ] **Step 1: Replace DealButton.tsx**

Replace `client/src/components/DealButton.tsx` with this content:

```tsx
import { useSelector } from 'react-redux';
import styled, { css } from 'styled-components';
import { getSocket } from '../socket/client';
import { selectGameState, selectAmIHost } from '../selectors/self';

const Button = styled.button<{ $enabled: boolean }>`
  background: ${({ theme }) => theme.colors.textPrimary};
  color: ${({ theme }) => theme.colors.feltDark};
  border: 2px solid ${({ theme }) => theme.colors.textSecondary};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.xl}`};
  font-size: ${({ theme }) => theme.typography.largeSize};
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: ${({ theme }) => theme.shadows.cardLarge};
  transition: opacity 120ms ease;
  ${({ $enabled }) =>
    !$enabled &&
    css`
      background: ${({ theme }) => theme.colors.surfaceDimmer};
      color: ${({ theme }) => theme.colors.textDim};
      border-color: ${({ theme }) => theme.colors.surfaceBorder};
      box-shadow: none;
      cursor: not-allowed;
    `}
`;

/**
 * Host-only button shown during the betting phase. Enabled only when every
 * seated player has placed a bet. Emits `round:start` to begin dealing.
 */
export function DealButton() {
  const state = useSelector(selectGameState);
  const amHost = useSelector(selectAmIHost);
  if (!state || state.phase !== 'betting' || !amHost) return null;

  let seatedCount = 0;
  let allSeatedHaveBet = true;
  for (const p of state.players) {
    if (p.status === 'empty') continue;
    seatedCount++;
    if (p.hands[0].bet <= 0) allSeatedHaveBet = false;
  }
  const canDeal = seatedCount >= 2 && allSeatedHaveBet;

  return (
    <Button
      $enabled={canDeal}
      disabled={!canDeal}
      onClick={() => getSocket().emit('round:start')}
    >
      Deal
    </Button>
  );
}
```

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/DealButton.tsx
git commit -m "style(client): polish DealButton with prominent felt-style CTA"
```

---

## Task 16: Style ActionPanel (Hit / Stand / Double / Split)

**Files:**
- Modify: `client/src/components/ActionPanel.tsx`

**Important:** the existing test files don't exercise ActionPanel, but the original behavior must be preserved. Each button emits the same socket event with `{ handIndex: activeHandIndex }` as before. Buttons that aren't legal for the current hand are not rendered (unchanged).

- [ ] **Step 1: Replace ActionPanel.tsx**

Replace `client/src/components/ActionPanel.tsx` with this content:

```tsx
import { useSelector } from 'react-redux';
import styled, { css } from 'styled-components';
import { getSocket } from '../socket/client';
import { selectMySeat } from '../selectors/self';
import { selectIsMyTurn } from '../selectors/turn';
import { makeSelectAvailableActions } from '../selectors/actions';
import type { RootState } from '../store';

const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  flex: 1;
  background: ${({ theme, $primary }) =>
    $primary ? theme.colors.textPrimary : theme.colors.surfaceDim};
  color: ${({ theme, $primary }) =>
    $primary ? theme.colors.feltDark : theme.colors.textPrimary};
  border: 1px solid
    ${({ theme, $primary }) =>
      $primary ? theme.colors.textSecondary : theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} 0`};
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 120ms ease;
  &:hover {
    ${({ $primary, theme }) =>
      !$primary &&
      css`
        background: ${theme.colors.surfaceDimmer};
      `}
  }
`;

export function ActionPanel() {
  const isMyTurn = useSelector(selectIsMyTurn);
  const me = useSelector(selectMySeat);
  const activeHandIndex = me?.hands.length ? me.hands.length - 1 : 0;
  const selectActions = makeSelectAvailableActions(activeHandIndex);
  const actions = useSelector((s: RootState) => selectActions(s));

  if (!isMyTurn) return null;

  return (
    <Row className="action-panel">
      {actions.canHit && (
        <ActionButton
          $primary
          onClick={() => getSocket().emit('hand:hit', { handIndex: activeHandIndex })}
        >
          Hit
        </ActionButton>
      )}
      {actions.canStand && (
        <ActionButton
          onClick={() => getSocket().emit('hand:stand', { handIndex: activeHandIndex })}
        >
          Stand
        </ActionButton>
      )}
      {actions.canDouble && (
        <ActionButton
          onClick={() => getSocket().emit('hand:double', { handIndex: activeHandIndex })}
        >
          Double
        </ActionButton>
      )}
      {actions.canSplit && (
        <ActionButton
          onClick={() => getSocket().emit('hand:split', { handIndex: activeHandIndex })}
        >
          Split
        </ActionButton>
      )}
    </Row>
  );
}
```

Note: `className="action-panel"` is kept on the wrapper for any future Playwright selector — no test currently uses it, but the class is cheap to retain.

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActionPanel.tsx
git commit -m "style(client): polish ActionPanel with primary Hit button"
```

---

## Task 17: Style BetPanel (preserve "Place Bet" and "Rebet $X" text)

**Files:**
- Modify: `client/src/components/BetPanel.tsx`

**Critical:** the existing bet-panel test asserts `getByRole('button', { name: /place bet/i })` and `getByRole('button', { name: /rebet \$50/i })`. The button text must be preserved exactly. Do not rename buttons.

- [ ] **Step 1: Replace BetPanel.tsx**

Replace `client/src/components/BetPanel.tsx` with this content:

```tsx
import { useSelector, useDispatch } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { betInputChanged } from '../store/ui.slice';
import { selectCanRebet, selectMyLastBet } from '../selectors/self';
import type { RootState } from '../store';

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const BetInput = styled.input`
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  width: 80px;
  &:focus { outline: 1px solid ${({ theme }) => theme.colors.textSecondary}; }
`;

const PrimaryButton = styled.button`
  background: ${({ theme }) => theme.colors.textPrimary};
  color: ${({ theme }) => theme.colors.feltDark};
  border: 1px solid ${({ theme }) => theme.colors.textSecondary};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
`;

const SecondaryButton = styled.button`
  background: ${({ theme }) => theme.colors.surfaceDim};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1px;
  cursor: pointer;
`;

export function BetPanel() {
  const phase = useSelector((s: RootState) => s.game.state?.phase);
  const bet = useSelector((s: RootState) => s.ui.betInputValue);
  const canRebet = useSelector(selectCanRebet);
  const lastBet = useSelector(selectMyLastBet);
  const dispatch = useDispatch();

  if (phase !== 'betting') return null;

  return (
    <Wrapper>
      <BetInput
        aria-label="bet-panel"
        type="number"
        min={10}
        max={500}
        value={bet}
        onChange={(e) => dispatch(betInputChanged(Number(e.target.value)))}
      />
      <PrimaryButton onClick={() => getSocket().emit('bet:place', { amount: bet })}>
        Place Bet
      </PrimaryButton>
      {canRebet && (
        <SecondaryButton onClick={() => getSocket().emit('bet:place', { amount: lastBet })}>
          Rebet ${lastBet}
        </SecondaryButton>
      )}
    </Wrapper>
  );
}
```

- [ ] **Step 2: Run the bet-panel test specifically**

Run: `cd client && npx vitest run test/components/bet-panel.spec.tsx`
Expected: all 6 bet-panel tests pass. The "Place Bet" and "Rebet $X" button text is preserved.

- [ ] **Step 3: Run tsc and full test suite**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/BetPanel.tsx
git commit -m "style(client): polish BetPanel with primary/secondary buttons"
```

---

## Task 18: Style PlayerSeat

**Files:**
- Modify: `client/src/components/PlayerSeat.tsx`

PlayerSeat is the per-player container: surface bg, optional active glow, header row (name + status pill), bankroll, hands.

- [ ] **Step 1: Replace PlayerSeat.tsx**

Replace `client/src/components/PlayerSeat.tsx` with this content:

```tsx
import styled, { css } from 'styled-components';
import { HandView } from './HandView';
import { Bankroll } from './Bankroll';
import { BetDisplay } from './BetDisplay';
import type { PlayerSeat as Seat } from '../shared/types';

const SeatBox = styled.div<{ $active: boolean }>`
  background: ${({ theme }) => theme.colors.surfaceDim};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.md};
  ${({ $active, theme }) =>
    $active &&
    css`
      border: 2px solid ${theme.colors.surfaceBorderActive};
      box-shadow: ${theme.shadows.activeGlow};
    `}
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const Name = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-weight: bold;
  font-size: ${({ theme }) => theme.typography.bodySize};
  .me { color: ${({ theme }) => theme.colors.textDim}; font-weight: normal; }
  .turn { color: ${({ theme }) => theme.colors.textPrimary}; font-weight: bold; margin-left: 6px; }
`;

const StatusPill = styled.div<{ $tone: 'active' | 'neutral' | 'good' | 'bad' | 'gold' }>`
  background: ${({ $tone, theme }) => {
    if ($tone === 'active') return theme.colors.textPrimary;
    if ($tone === 'good') return theme.colors.statusWin;
    if ($tone === 'bad') return theme.colors.statusLose;
    if ($tone === 'gold') return theme.colors.statusBlackjack;
    return theme.colors.surfaceDimmer;
  }};
  color: ${({ $tone, theme }) => {
    if ($tone === 'active') return theme.colors.feltDark;
    if ($tone === 'neutral') return theme.colors.textPrimary;
    return theme.colors.feltDark;
  }};
  padding: 2px 8px;
  border-radius: ${({ theme }) => theme.radii.sm};
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-weight: bold;
`;

const HandBlock = styled.div`
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const StatusText = styled.span`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-left: ${({ theme }) => theme.spacing.sm};
`;

type Tone = 'active' | 'neutral' | 'good' | 'bad' | 'gold';

function pillTone(isActive: boolean, status: Seat['status']): Tone {
  if (isActive) return 'active';
  if (status === 'stood') return 'good';
  if (status === 'busted') return 'bad';
  if (status === 'blackjack') return 'gold';
  return 'neutral';
}

function pillLabel(isActive: boolean, status: Seat['status']): string {
  if (isActive) return 'Your Turn';
  if (status === 'stood') return 'Stood';
  if (status === 'busted') return 'Busted';
  if (status === 'blackjack') return 'Blackjack';
  return status.replace('_', ' ');
}

export function PlayerSeatView({ seat, isActive, isMe }: { seat: Seat; isActive: boolean; isMe: boolean }) {
  return (
    <SeatBox $active={isActive}>
      <Header>
        <Name>
          {seat.name}
          {isMe && <span className="me"> (you)</span>}
          {isActive && <span className="turn">— Your turn</span>}
        </Name>
        <StatusPill $tone={pillTone(isActive, seat.status)}>
          {pillLabel(isActive, seat.status)}
        </StatusPill>
      </Header>
      <Bankroll amount={seat.bankroll} />
      {seat.hands.map((h, i) => (
        <HandBlock key={i}>
          {seat.hands.length > 1 && (
            <div style={{ color: 'inherit', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4, color: '#c9bfa8' }}>
              Hand {i + 1}
            </div>
          )}
          <HandView hand={h} />
          <BetDisplay bet={h.bet} />
          <StatusText>{seat.status}</StatusText>
        </HandBlock>
      ))}
    </SeatBox>
  );
}
```

The literal `style={{ color: '#c9bfa8' }}` on the inner Hand label is intentional — it mirrors `theme.colors.textSecondary` but the inline style is fine because the existing test grep `seat.status` would not match against the Hand label.

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/PlayerSeat.tsx
git commit -m "style(client): polish PlayerSeat with active glow and status pill"
```

---

## Task 19: Style DealerArea

**Files:**
- Modify: `client/src/components/DealerArea.tsx`

- [ ] **Step 1: Replace DealerArea.tsx**

Replace `client/src/components/DealerArea.tsx` with this content:

```tsx
import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { HandView } from './HandView';
import type { RootState } from '../store';

const Wrapper = styled.div`
  text-align: center;
  margin-bottom: ${({ theme }) => theme.spacing.xl};
`;

const DealerLabel = styled.div`
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 3px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

export function DealerArea() {
  const dealer = useSelector((s: RootState) => s.game.state?.dealer);
  if (!dealer) return null;
  return (
    <Wrapper>
      <DealerLabel>Dealer</DealerLabel>
      <HandView hand={dealer} isDealer />
    </Wrapper>
  );
}
```

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/DealerArea.tsx
git commit -m "style(client): polish DealerArea with centered hand and label"
```

---

## Task 20: Style TableView (the oval felt table)

**Files:**
- Modify: `client/src/components/TableView.tsx`

- [ ] **Step 1: Replace TableView.tsx**

Replace `client/src/components/TableView.tsx` with this content:

```tsx
import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { DealerArea } from './DealerArea';
import { PlayerSeatView } from './PlayerSeat';
import { ActionPanel } from './ActionPanel';
import { BetPanel } from './BetPanel';
import { DealButton } from './DealButton';
import { ResultOverlay } from './ResultOverlay';
import type { RootState } from '../store';

const Page = styled.div`
  min-height: 100vh;
  padding: ${({ theme }) => theme.spacing.xl};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const TableSurface = styled.div`
  position: relative;
  background: radial-gradient(
    ellipse at center,
    ${({ theme }) => theme.colors.feltLight} 0%,
    ${({ theme }) => theme.colors.feltMid} 75%,
    ${({ theme }) => theme.colors.feltDark} 100%
  );
  border: 8px solid ${({ theme }) => theme.colors.feltBorder};
  border-radius: ${({ theme }) => theme.radii.pill};
  box-shadow: ${({ theme }) => theme.shadows.table};
  padding: ${({ theme }) => theme.spacing.xxl};
  width: min(1100px, 100%);
  font-family: ${({ theme }) => theme.typography.fontFamily};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Stitching = styled.div`
  position: absolute;
  top: 14px; left: 14px; right: 14px; bottom: 14px;
  border: 2px dashed ${({ theme }) => theme.colors.feltStitch};
  border-radius: ${({ theme }) => theme.radii.pill};
  pointer-events: none;
`;

const Brand = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.feltStitch};
  font-size: ${({ theme }) => theme.typography.titleSize};
  letter-spacing: 8px;
  margin: ${({ theme }) => `${theme.spacing.md} 0`};
  font-style: italic;
`;

const Seats = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: ${({ theme }) => theme.spacing.xl};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const BottomRow = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: ${({ theme }) => theme.spacing.xl};
  gap: ${({ theme }) => theme.spacing.md};
`;

const Loading = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: ${({ theme }) => theme.typography.largeSize};
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xxl};
`;

export function TableView() {
  const state = useSelector((s: RootState) => s.game.state);
  const selfSeatId = useSelector((s: RootState) => s.connection.selfSeatId);
  if (!state) return <Loading>Loading…</Loading>;
  return (
    <Page>
      <TableSurface>
        <Stitching />
        <DealerArea />
        <Brand>BLACKJACK PAYS 3 TO 2</Brand>
        <Seats>
          {state.players
            .filter((p) => p.status !== 'empty')
            .map((p) => (
              <PlayerSeatView
                key={p.id}
                seat={p}
                isActive={state.activeSeat !== null && state.players[state.activeSeat]?.id === p.id}
                isMe={p.id === selfSeatId}
              />
            ))}
        </Seats>
        <BottomRow>
          <BetPanel />
          <DealButton />
          <ActionPanel />
        </BottomRow>
        <ResultOverlay />
      </TableSurface>
    </Page>
  );
}
```

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TableView.tsx
git commit -m "style(client): polish TableView with felt table surface"
```

---

## Task 21: Style ConnectionStatus

**Files:**
- Modify: `client/src/components/ConnectionStatus.tsx`

- [ ] **Step 1: Replace ConnectionStatus.tsx**

Replace `client/src/components/ConnectionStatus.tsx` with this content:

```tsx
import { useSelector } from 'react-redux';
import styled from 'styled-components';
import type { RootState } from '../store';

const Banner = styled.div<{ $tone: 'green' | 'amber' | 'red' }>`
  position: fixed;
  top: ${({ theme }) => theme.spacing.md};
  left: ${({ theme }) => theme.spacing.md};
  z-index: 100;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.surfaceBorder};
  border-radius: ${({ theme }) => theme.radii.pill};
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  text-transform: uppercase;
`;

const Dot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  display: inline-block;
`;

const TONE_MAP: Record<string, { dot: string; label: string }> = {
  connected: { dot: '#4ade80', label: 'Connected' },
  reconnecting: { dot: '#fde047', label: 'Reconnecting…' },
  disconnected: { dot: '#f87171', label: 'Disconnected' },
};

export function ConnectionStatus() {
  const status = useSelector((s: RootState) => s.connection.status);
  if (status === 'connected') return null;
  const tone = TONE_MAP[status] ?? { dot: '#94a3b8', label: `${status}…` };
  return (
    <Banner $tone="amber">
      <Dot $color={tone.dot} />
      {tone.label}
    </Banner>
  );
}
```

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ConnectionStatus.tsx
git commit -m "style(client): polish ConnectionStatus with status pill"
```

---

## Task 22: Style ErrorToast

**Files:**
- Modify: `client/src/components/ErrorToast.tsx`

The existing behavior (4-second auto-dismiss via `setTimeout`) is preserved. The new visual adds a 200ms opacity fade-in.

- [ ] **Step 1: Replace ErrorToast.tsx**

Replace `client/src/components/ErrorToast.tsx` with this content:

```tsx
import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import styled, { keyframes } from 'styled-components';
import { toastCleared } from '../store/ui.slice';
import type { RootState } from '../store';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Toast = styled.div`
  position: fixed;
  top: ${({ theme }) => theme.spacing.lg};
  right: ${({ theme }) => theme.spacing.lg};
  z-index: 200;
  background: ${({ theme }) => theme.colors.surfaceDimmer};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.statusLose};
  border-left: 4px solid ${({ theme }) => theme.colors.statusLose};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.typography.bodySize};
  max-width: 320px;
  box-shadow: ${({ theme }) => theme.shadows.cardLarge};
  animation: ${fadeIn} 200ms ease;
`;

export function ErrorToast() {
  const toast = useSelector((s: RootState) => s.ui.lastToast);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => dispatch(toastCleared()), 4000);
    return () => clearTimeout(id);
  }, [toast, dispatch]);

  if (!toast) return null;
  return <Toast role="alert">{toast.message}</Toast>;
}
```

- [ ] **Step 2: Verify tsc passes and tests still pass**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ErrorToast.tsx
git commit -m "style(client): polish ErrorToast with slide-in and red accent"
```

---

## Task 23: Style ResultOverlay (preserve "Round Over" and "Next Hand" text)

**Files:**
- Modify: `client/src/components/ResultOverlay.tsx`

**Critical:** the existing result-overlay test asserts `getByText(/Round Over/i)` and `getByRole('button', { name: /next hand/i })`. Both must be preserved exactly.

- [ ] **Step 1: Replace ResultOverlay.tsx**

Replace `client/src/components/ResultOverlay.tsx` with this content:

```tsx
import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { selectAmIHost } from '../selectors/self';
import type { RootState } from '../store';

const Modal = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  border-radius: ${({ theme }) => theme.radii.pill};
  z-index: 50;
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.feltDark};
  border: 2px solid ${({ theme }) => theme.colors.textSecondary};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.xl};
  min-width: 320px;
  text-align: center;
  box-shadow: ${({ theme }) => theme.shadows.table};
`;

const Title = styled.h2`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: ${({ theme }) => theme.typography.titleSize};
  letter-spacing: 4px;
  text-transform: uppercase;
  margin: 0 0 ${({ theme }) => theme.spacing.md};
`;

const PayoutList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const PayoutRow = styled.li<{ $tone: 'good' | 'bad' | 'neutral' | 'gold' }>`
  padding: ${({ theme }) => `${theme.spacing.xs} 0`};
  font-size: ${({ theme }) => theme.typography.bodySize};
  color: ${({ $tone, theme }) => {
    if ($tone === 'good') return theme.colors.statusWin;
    if ($tone === 'bad') return theme.colors.statusLose;
    if ($tone === 'gold') return theme.colors.statusBlackjack;
    return theme.colors.statusPush;
  }};
  font-weight: bold;
`;

const NextHandButton = styled.button`
  background: ${({ theme }) => theme.colors.textPrimary};
  color: ${({ theme }) => theme.colors.feltDark};
  border: 1px solid ${({ theme }) => theme.colors.textSecondary};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.lg}`};
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
`;

function formatDelta(reason: 'win' | 'lose' | 'push' | 'blackjack', delta: number): string {
  if (reason === 'push' || delta === 0) return '$0';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}$${Math.abs(delta)}`;
}

function toneFor(reason: 'win' | 'lose' | 'push' | 'blackjack', delta: number): 'good' | 'bad' | 'neutral' | 'gold' {
  if (reason === 'blackjack') return 'gold';
  if (reason === 'win' || delta > 0) return 'good';
  if (reason === 'lose' || delta < 0) return 'bad';
  return 'neutral';
}

export function ResultOverlay() {
  const state = useSelector((s: RootState) => s.game.state);
  const amHost = useSelector(selectAmIHost);
  if (!state || state.phase !== 'settled' || !state.lastResult) return null;
  return (
    <Modal className="result-overlay">
      <Card>
        <Title>Round Over</Title>
        <PayoutList>
          {state.lastResult.payouts.map((p) => {
            const seat = state.players.find((s) => s.id === p.seatId);
            return (
              <PayoutRow key={p.seatId} $tone={toneFor(p.reason, p.delta)}>
                {seat?.name ?? p.seatId}: {p.reason} {formatDelta(p.reason, p.delta)}
              </PayoutRow>
            );
          })}
        </PayoutList>
        {amHost && (
          <NextHandButton onClick={() => getSocket().emit('round:advance')}>
            Next Hand
          </NextHandButton>
        )}
      </Card>
    </Modal>
  );
}
```

- [ ] **Step 2: Run the result-overlay test specifically**

Run: `cd client && npx vitest run test/components/result-overlay.spec.tsx`
Expected: all 4 result-overlay tests pass. The "Round Over" title and "Next Hand" button text are preserved.

- [ ] **Step 3: Run tsc and full test suite**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean, all 38 tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ResultOverlay.tsx
git commit -m "style(client): polish ResultOverlay with modal card and color deltas"
```

---

## Task 24: Final verification — tsc, vitest, playwright

**Files:** none modified.

- [ ] **Step 1: Run TypeScript check**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. No `noUnusedLocals` warnings (all dead `className=` attributes were removed in the same commits that removed their associated styled definitions).

- [ ] **Step 2: Run all unit tests**

Run: `cd client && npx vitest run`
Expected: all tests pass.
- 22 pre-existing tests (unchanged behavior).
- 8 new handTotal tests.
- 8 new chipColor tests.
- 4 result-overlay tests (with new ThemeProvider wrapping).
- 6 bet-panel tests (with new ThemeProvider wrapping).
Total: 38 tests, all green.

- [ ] **Step 3: Run Playwright E2E (lobby flow)**

Run: `cd client && npx playwright test`
Expected: 1 passed, 1 skipped (the lobby-only E2E that was already in place; this pass doesn't touch lobby code so behavior is identical).

- [ ] **Step 4: Manual visual check (optional but recommended)**

1. Start the server: `cd /Users/dev/Documents/GitHub/redux-blackjack-21 && npm run dev:server` (in background).
2. Start the client: `cd client && npm run dev`.
3. Open `http://localhost:5173/` in a browser.
4. Create a room, open a second tab and join the same room.
5. Both players place bets. Confirm chip visuals match the screenshot direction.
6. Click "Deal". Confirm cards render with red/black suit coloring and hidden dealer card.
7. Confirm hand total pill shows "Showing N" for the dealer, plain `N` for your hand.
8. Hit, stand, double, split as appropriate. Confirm the active-seat glow follows your turn.
9. After settlement, confirm the result overlay shows color-coded deltas and the "Next Hand" button (host only).

- [ ] **Step 5: Commit any final fixes (if needed)**

If step 1-3 are green, no commit needed. If any test fails or tsc errors, fix the underlying issue, then commit the fix as `fix(client): address [describe the issue]`.

---

## Done

The client now has:
- A casino-felt visual treatment across the table, dealer, player seats, hand cards, chips, buttons, and result overlay.
- Working hand totals that handle soft aces, busts, and the dealer's hidden hole card.
- Cream/ivory text (no gold) on a green felt background.
- A single `theme` object that drives every color, spacing, and typography value.
- 16 new unit tests (8 handTotal + 8 chipColor) covering the two new pure helpers.
- All 22 pre-existing tests + 2 test-file updates + 1 E2E still passing.

Out of scope (backlog): polish the Lobby + Home page, extract reusable primitives, theme switcher, visual regression tooling, a11y audit.

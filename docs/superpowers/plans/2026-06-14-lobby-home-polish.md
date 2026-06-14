# Lobby & Home UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished "casino entrance" visual treatment to the Home page and in-room Lobby, plus a small table-side cleanup (the last inline-styled holdout). Single shared theme extended with new `entrance*` and `gold*` tokens. No game logic, Redux state, or wire protocol changes beyond one new derived selector.

**Architecture:** Extend `client/src/styles/theme.ts` with new tokens for the dark entrance backdrop and gold accent (existing `felt*` / `text*` / `card*` / `status*` / `surface*` / `chip*` tokens all stay and continue to power the table unchanged). Add one new derived selector `selectLobbySeats` so the lobby can show empty seat placeholders. Each of the 5 unpolished components gets `styled-components` definitions added inline at the bottom of its file, following the exact pattern from the previous UI polish pass.

**Tech Stack:** React 18, TypeScript, Vite, Redux Toolkit, styled-components 6, Vitest, Playwright.

**Spec:** [`../specs/2026-06-14-lobby-home-polish-design.md`](../specs/2026-06-14-lobby-home-polish-design.md)

---

## CRITICAL: E2E selector preservation reminder

The prior UI polish pass broke the E2E happy-path test by dropping a `className` that the test selector depended on. **Every task that touches a component used by the E2E test MUST preserve the selectors below verbatim.** Re-read this list before each task.

| Selector | Lives in | Must preserve |
|---|---|---|
| `input[placeholder="Your name"]` | `Home.tsx` | `placeholder="Your name"` |
| `input[placeholder="Room code"]` | `Home.tsx` | `placeholder="Room code"` |
| `button:has-text("Create Room")` | `Home.tsx` | Button text contains `"Create Room"` (case-insensitive) |
| `button:has-text("Join")` | `Home.tsx` | Button text contains `"Join"` (case-insensitive) |
| `button:has-text("Begin Betting")` | `StartButton.tsx` | Button text contains `"Begin Betting"` (case-insensitive) |
| `.bet-panel` | `BetPanel.tsx` | `className="bet-panel"` (already preserved by prior pass) |
| `.action-panel` | `ActionPanel.tsx` | `className="action-panel"` (already preserved) |
| `.result-overlay` | `ResultOverlay.tsx` | `className="result-overlay"` (already preserved) |
| `button:has-text("Place Bet")` | `BetPanel.tsx` | (already preserved) |
| `button:has-text("Deal")` | `DealButton.tsx` | (already preserved) |
| `button:has-text("Next Hand")` | `ResultOverlay.tsx` | (already preserved) |
| `button:has-text("Rebet $50")` | `BetPanel.tsx` | (already preserved) |

**When in doubt: leave the existing `className=` and the existing `placeholder=` text alone. Pass them through to the new styled wrapper via `className={...}`.**

---

## File map

### New files
- `client/src/selectors/lobby.ts` — `selectLobbySeats` (derived selector).
- `client/test/selectors/lobby.spec.ts` — 3 cases for `selectLobbySeats`.

### Modified files
- `client/src/styles/theme.ts` — add `entrance*`, `gold*`, `seated*` color tokens; `seat` radius and shadow.
- `client/src/pages/Home.tsx` — full styled-components rewrite, preserve E2E selectors.
- `client/src/components/Lobby.tsx` — container styled.
- `client/src/components/PlayerList.tsx` — theater seats, reads `selectLobbySeats`.
- `client/src/components/RoomCode.tsx` — compact pill.
- `client/src/components/StartButton.tsx` — gold CTA, disabled hint, non-host "waiting" line. Preserve "Begin Betting" text.
- `client/src/components/PlayerSeat.tsx` — replace inline `style={{}}` (line 103) with `HandLabel` styled.
- `client/src/pages/Table.tsx` — replace `<div className="table-page">` with `styled.div`.

### Out of scope (do NOT touch)
- `ResultOverlay`, `ConnectionStatus`, `ErrorToast`, `ActionPanel`, `BetPanel`, `DealButton`, `HandView`, `BetDisplay`, `Bankroll`, `DealerArea`, `TableView` — already polished.
- `client/src/store/*`, `client/src/socket/*`, `client/src/middleware/*` — no logic changes.
- `client/src/shared/types.ts` — no wire-protocol changes.
- `server/` — no server changes.

---

## Task 1: Add entrance + gold + seated theme tokens

**Files:**
- Modify: `client/src/styles/theme.ts`

- [ ] **Step 1: Add new color tokens**

In `client/src/styles/theme.ts`, add the following keys to `colors` (insert them between the existing `surfaceBorderActive` and `chipRed` so the related `surface*` and new `entrance*` blocks group nicely):

```ts
    // Entrance (Home + Lobby) — dark "lobby" backdrop, gold accent
    entranceBg:         '#0a1612',   // already used by GlobalStyle body
    entranceSurface:    '#122822',   // card / seat background
    entranceSurfaceAlt: '#0e1f1a',   // slightly darker for nested surfaces
    entranceBorder:     'rgba(220,210,190,0.15)',
    entranceBorderSoft: 'rgba(220,210,190,0.08)',

    // Gold accent (primary CTAs, player initials, brand text)
    goldFrom: '#c9a96a',
    goldTo:   '#8b7340',
    goldText: '#0a1612',   // text color when on a gold background

    // Seated (re-uses statusWin color in the entrance context)
    seatedBorder: '#4ade80',
    seatedGlow:   '0 0 16px rgba(74,222,128,0.30)',
```

- [ ] **Step 2: Add a `seat` radius**

In the `radii` block, add a new key after `pill`:

```ts
  radii: { sm: '4px', md: '6px', lg: '12px', pill: '180px', seat: '8px' },
```

- [ ] **Step 3: Add a `seat` shadow**

In the `shadows` block, add a new key after `table`:

```ts
  shadows: {
    card:       '0 2px 4px rgba(0,0,0,0.4)',
    cardLarge:  '0 2px 6px rgba(0,0,0,0.5)',
    activeGlow: '0 0 18px rgba(236,228,212,0.35)',
    table:      'inset 0 0 80px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.6)',
    seat:       '0 4px 10px rgba(0,0,0,0.4)',
  },
```

- [ ] **Step 4: Verify TypeScript still passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/styles/theme.ts
git commit -m "feat(client): add entrance + gold + seated theme tokens"
```

---

## Task 2: Add `selectLobbySeats` selector (TDD)

**Files:**
- Create: `client/src/selectors/lobby.ts`
- Create: `client/test/selectors/lobby.spec.ts`

The lobby needs to render empty seat placeholders, so we need a selector that returns the full `state.players` array (which includes `status: 'empty'` entries) — not just the `s.lobby.players` projection (which only contains seated players).

- [ ] **Step 1: Write the failing test**

Create `client/test/selectors/lobby.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectLobbySeats } from '../../src/selectors/lobby';
import type { RootState } from '../../src/store';
import type { GameState, PlayerSeat, LobbyPlayer } from '../../src/shared/types';

function seat(id: string, status: PlayerSeat['status'] = 'sitting_out'): PlayerSeat {
  return {
    id,
    name: id,
    bankroll: 0,
    hands: [],
    status,
    connectedAt: 0,
    lastBet: 0,
  };
}

function lobbyPlayer(id: string): LobbyPlayer {
  return { id, name: id, ready: true, connectedAt: 0 };
}

function stateWith(opts: { game: GameState | null; lobbyPlayers: LobbyPlayer[] }): RootState {
  return {
    game: { state: opts.game, lastResult: null },
    connection: { selfSeatId: 's0', status: 'connected' as const, lastError: null },
    lobby: { roomId: 'R', hostId: 's0', players: opts.lobbyPlayers },
    ui: { betInputValue: 0, toasts: [] },
  } as unknown as RootState;
}

describe('selectLobbySeats', () => {
  it('returns state.game.state.players (the full SEAT_COUNT array) when game state exists', () => {
    const players = [seat('s0', 'betting'), seat('s1', 'empty')];
    const root = stateWith({
      game: {
        roomId: 'R', phase: 'lobby', shoeSize: 200, cutCardIndex: 50,
        players, dealer: { cards: [], bet: 0, stood: false, busted: false, isBlackjack: false, doubled: false },
        activeSeat: null, roundNumber: 0, lastResult: null,
      },
      lobbyPlayers: [lobbyPlayer('s0')],  // projection only knows about seated
    });
    expect(selectLobbySeats(root)).toHaveLength(2);
    expect(selectLobbySeats(root)[1].status).toBe('empty');
  });

  it('falls back to state.lobby.players when game state is null (pre-snapshot)', () => {
    const root = stateWith({ game: null, lobbyPlayers: [lobbyPlayer('s0'), lobbyPlayer('s1')] });
    expect(selectLobbySeats(root)).toHaveLength(2);
  });

  it('returns an empty array when neither game state nor lobby players exist', () => {
    const root = stateWith({ game: null, lobbyPlayers: [] });
    expect(selectLobbySeats(root)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run test/selectors/lobby.spec.ts`
Expected: FAIL with "Cannot find module '../../src/selectors/lobby'".

- [ ] **Step 3: Implement the selector**

Create `client/src/selectors/lobby.ts`:

```ts
import type { RootState } from '../store';

/**
 * Returns the full lobby-seat array. Prefers the game's authoritative
 * `state.players` (which includes `status: 'empty'` placeholders) and
 * falls back to the lobby-slice projection while the first 'state:update'
 * is still in flight.
 */
export const selectLobbySeats = (s: RootState) => {
  const state = s.game.state;
  if (state) return state.players;
  return s.lobby.players;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run test/selectors/lobby.spec.ts`
Expected: PASS (3 tests, 0 failures).

- [ ] **Step 5: Verify TypeScript still passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/selectors/lobby.ts client/test/selectors/lobby.spec.ts
git commit -m "feat(client): add selectLobbySeats selector with tests"
```

---

## Task 3: Polish `pages/Home.tsx` — Create/Join landing

**Files:**
- Modify: `client/src/pages/Home.tsx`

⚠️ **E2E preservation**: keep `placeholder="Your name"`, `placeholder="Room code"`, button text `"Create Room"`, button text `"Join"`. Do not wrap the inputs/buttons in a way that hides their text from selectors.

- [ ] **Step 1: Replace the entire file**

Overwrite `client/src/pages/Home.tsx` with:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { selfSeatAssigned } from '../store/connection.slice';

const Page = styled.div`
  min-height: 100vh;
  padding: ${({ theme }) => theme.spacing.xxl};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.xl};
  background: ${({ theme }) => theme.colors.entranceBg};
`;

const Brand = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 36px;
  font-style: italic;
  letter-spacing: 6px;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Subtitle = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 4px;
  text-transform: uppercase;
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.entranceSurface};
  border: 1px solid ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.lg};
  padding: ${({ theme }) => theme.spacing.xl};
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Label = styled.label`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 2px;
  text-transform: uppercase;
`;

const Input = styled.input`
  background: ${({ theme }) => theme.colors.entranceBg};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  width: 100%;
  &:focus { outline: 1px solid ${({ theme }) => theme.colors.textSecondary}; }
`;

const CodeInput = styled(Input)`
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  letter-spacing: 4px;
  text-align: center;
  text-transform: uppercase;
`;

const PrimaryButton = styled.button`
  background: linear-gradient(135deg,
    ${({ theme }) => theme.colors.goldFrom} 0%,
    ${({ theme }) => theme.colors.goldTo} 100%);
  color: ${({ theme }) => theme.colors.goldText};
  border: 1px solid ${({ theme }) => theme.colors.goldTo};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.lg}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  width: 100%;
  &:hover { filter: brightness(1.08); }
`;

const OutlineButton = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.textPrimary};
  border: 1px solid ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.sm};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.lg}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: bold;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.entranceSurfaceAlt}; }
`;

const Divider = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  text-align: center;
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  text-transform: uppercase;
  position: relative;
  &::before, &::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 30%;
    height: 1px;
    background: ${({ theme }) => theme.colors.entranceBorder};
  }
  &::before { left: 0; }
  &::after  { right: 0; }
`;

const JoinRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  & > ${CodeInput} { flex: 1; }
`;

const Error = styled.div`
  width: 340px;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  background: rgba(248,113,113,0.12);
  border: 1px solid rgba(248,113,113,0.35);
  border-radius: ${({ theme }) => theme.radii.sm};
  color: ${({ theme }) => theme.colors.statusLose};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 0.5px;
  text-align: center;
`;

export function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const create = () => {
    if (!name.trim()) { setError('Please enter a name'); return; }
    getSocket().emit('room:create', { name: name.trim() }, (resp: { seatId: string; roomId: string } | { ok: false; code: string }) => {
      if ('seatId' in resp) {
        dispatch(selfSeatAssigned(resp.seatId));
        navigate(`/room/${resp.roomId}`);
      } else setError(resp?.code ?? 'Failed to create room');
    });
  };

  const join = () => {
    if (!name.trim()) { setError('Please enter a name'); return; }
    if (!code.trim()) { setError('Please enter a room code'); return; }
    const roomCode = code.trim().toUpperCase();
    getSocket().emit('room:join', { roomId: roomCode, name: name.trim() }, (resp: any) => {
      if (resp?.seatId) {
        dispatch(selfSeatAssigned(resp.seatId));
        navigate(`/room/${roomCode}`);
      } else setError(resp?.code ?? 'Failed to join');
    });
    getSocket().once('error', (err: { message: string }) => setError(err.message));
  };

  return (
    <Page>
      <div>
        <Brand>BLACKJACK 21</Brand>
        <Subtitle>A real-time multiplayer game</Subtitle>
      </div>
      <Card>
        <div>
          <Label htmlFor="home-name">Your name</Label>
          <Input
            id="home-name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <PrimaryButton onClick={create}>Create Room</PrimaryButton>
        <Divider>or join an existing one</Divider>
        <JoinRow>
          <CodeInput
            placeholder="Room code"
            value={code}
            maxLength={5}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <OutlineButton onClick={join}>Join</OutlineButton>
        </JoinRow>
      </Card>
      {error && <Error role="alert">{error}</Error>}
    </Page>
  );
}
```

- [ ] **Step 2: Verify TypeScript passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Run all unit tests**

Run: `cd client && npx vitest run`
Expected: 22 + 3 (new lobby.spec) = 25 tests, all pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Home.tsx
git commit -m "style(client): polish Home page with entrance theme"
```

---

## Task 4: Polish `components/Lobby.tsx` — container

**Files:**
- Modify: `client/src/components/Lobby.tsx`

- [ ] **Step 1: Replace the entire file**

Overwrite `client/src/components/Lobby.tsx` with:

```tsx
import styled from 'styled-components';
import { RoomCode } from './RoomCode';
import { PlayerList } from './PlayerList';
import { StartButton } from './StartButton';

const Page = styled.div`
  min-height: 100vh;
  padding: ${({ theme }) => theme.spacing.xxl};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.xl};
  background: ${({ theme }) => theme.colors.entranceBg};
`;

const Title = styled.h1`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 28px;
  letter-spacing: 6px;
  font-style: italic;
  font-weight: normal;
  font-family: ${({ theme }) => theme.typography.fontFamily};
  text-align: center;
  margin: 0;
`;

const BottomBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  width: 100%;
  max-width: 480px;
`;

export function Lobby() {
  return (
    <Page>
      <Title>WAITING ROOM</Title>
      <PlayerList />
      <BottomBlock>
        <RoomCode />
        <StartButton />
      </BottomBlock>
    </Page>
  );
}
```

- [ ] **Step 2: Verify TypeScript passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Lobby.tsx
git commit -m "style(client): polish Lobby container with entrance theme"
```

---

## Task 5: Polish `components/PlayerList.tsx` — theater seats

**Files:**
- Modify: `client/src/components/PlayerList.tsx`

- [ ] **Step 1: Replace the entire file**

Overwrite `client/src/components/PlayerList.tsx` with:

```tsx
import { useSelector } from 'react-redux';
import styled, { css } from 'styled-components';
import { selectLobbySeats } from '../selectors/lobby';

const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xl};
  justify-content: center;
  align-items: center;
`;

const SeatCard = styled.div<{ $seated: boolean }>`
  width: 140px;
  height: 170px;
  background: ${({ theme }) => theme.colors.entranceSurface};
  border-radius: ${({ theme }) => theme.radii.seat};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  ${({ $seated, theme }) =>
    $seated
      ? css`
          border: 2px solid ${theme.colors.seatedBorder};
          box-shadow: ${theme.shadows.seat}, ${theme.colors.seatedGlow};
        `
      : css`
          border: 2px dashed ${theme.colors.entranceBorder};
          background: transparent;
        `}
`;

const Avatar = styled.div<{ $seated: boolean }>`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 20px;
  font-family: ${({ theme }) => theme.typography.fontFamily};
  ${({ $seated, theme }) =>
    $seated
      ? css`
          background: linear-gradient(135deg, ${theme.colors.goldFrom} 0%, ${theme.colors.goldTo} 100%);
          color: ${theme.colors.goldText};
        `
      : css`
          background: transparent;
          color: ${theme.colors.textDim};
          font-size: 28px;
        `}
`;

const Name = styled.div<{ $seated: boolean }>`
  color: ${({ $seated, theme }) => ($seated ? theme.colors.textPrimary : theme.colors.textDim)};
  font-size: ${({ theme }) => theme.typography.bodySize};
  letter-spacing: 0.5px;
  text-align: center;
`;

const Status = styled.div<{ $seated: boolean }>`
  color: ${({ $seated, theme }) => ($seated ? theme.colors.seatedBorder : theme.colors.textDim)};
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  font-weight: bold;
`;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PlayerList() {
  // selectLobbySeats returns PlayerSeat[] (with status) or LobbyPlayer[] (no status).
  // The lobby projection only contains seated players, so a missing `status` is
  // always "seated" — narrow with 'status' in s.
  const seats = useSelector(selectLobbySeats);
  return (
    <Row>
      {seats.map((s) => {
        const seated = 'status' in s ? s.status !== 'empty' : true;
        return (
          <SeatCard key={s.id} $seated={seated} aria-label={seated ? `seat-${s.name}` : 'empty-seat'}>
            <Avatar $seated={seated}>{seated ? initialsOf(s.name) : '+'}</Avatar>
            <Name $seated={seated}>{seated ? s.name : 'Empty Seat'}</Name>
            <Status $seated={seated}>{seated ? 'Seated' : 'Waiting'}</Status>
          </SeatCard>
        );
      })}
    </Row>
  );
}
```

- [ ] **Step 2: Verify TypeScript passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Run all unit tests**

Run: `cd client && npx vitest run`
Expected: 25 tests, all pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/PlayerList.tsx
git commit -m "style(client): polish PlayerList as theater seats"
```

---

## Task 6: Polish `components/RoomCode.tsx` — compact pill

**Files:**
- Modify: `client/src/components/RoomCode.tsx`

- [ ] **Step 1: Replace the entire file**

Overwrite `client/src/components/RoomCode.tsx` with:

```tsx
import { useSelector } from 'react-redux';
import styled from 'styled-components';
import type { RootState } from '../store';

const Pill = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.entranceSurfaceAlt};
  border: 1px solid ${({ theme }) => theme.colors.entranceBorder};
  border-radius: ${({ theme }) => theme.radii.pill};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.xl}`};
`;

const Label = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  letter-spacing: 3px;
  text-transform: uppercase;
  font-weight: bold;
`;

const Code = styled.span`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 22px;
  letter-spacing: 6px;
`;

export function RoomCode() {
  const roomId = useSelector((s: RootState) => s.lobby.roomId);
  if (!roomId) return null;
  return (
    <Pill>
      <Label>Code</Label>
      <Code>{roomId}</Code>
    </Pill>
  );
}
```

- [ ] **Step 2: Verify TypeScript passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/RoomCode.tsx
git commit -m "style(client): polish RoomCode as compact pill"
```

---

## Task 7: Polish `components/StartButton.tsx` — gold CTA + disabled hint + non-host line

**Files:**
- Modify: `client/src/components/StartButton.tsx`

⚠️ **E2E preservation**: button text MUST contain the substring `"Begin Betting"` (case-insensitive) so `button:has-text("Begin Betting")` matches. Keep the exact text `Begin Betting`.

- [ ] **Step 1: Replace the entire file**

Overwrite `client/src/components/StartButton.tsx` with:

```tsx
import { useSelector } from 'react-redux';
import styled, { css } from 'styled-components';
import { getSocket } from '../socket/client';
import { selectAmIHost } from '../selectors/self';
import { selectLobbySeats } from '../selectors/lobby';
import type { RootState } from '../store';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  width: 100%;
`;

const Hint = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 1.5px;
  text-align: center;
`;

const Waiting = styled.div`
  color: ${({ theme }) => theme.colors.textDim};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 2px;
  text-transform: uppercase;
  text-align: center;
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.xl}`};
`;

const Cta = styled.button<{ $enabled: boolean }>`
  background: linear-gradient(135deg,
    ${({ theme }) => theme.colors.goldFrom} 0%,
    ${({ theme }) => theme.colors.goldTo} 100%);
  color: ${({ theme }) => theme.colors.goldText};
  border: 1px solid ${({ theme }) => theme.colors.goldTo};
  border-radius: ${({ theme }) => theme.radii.md};
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.xxl}`};
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.largeSize};
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  cursor: pointer;
  min-width: 240px;
  &:hover { filter: brightness(1.08); }
  ${({ $enabled, theme }) =>
    !$enabled &&
    css`
      background: ${theme.colors.entranceSurfaceAlt};
      color: ${theme.colors.textDim};
      border-color: ${theme.colors.entranceBorder};
      cursor: not-allowed;
      box-shadow: none;
      &:hover { filter: none; }
    `}
`;

function hintText(seatedCount: number): string {
  if (seatedCount === 0) return 'Waiting for players to join…';
  if (seatedCount === 1) return 'Waiting for 1 more player…';
  return 'Waiting for all players…';
}

export function StartButton() {
  const seats = useSelector(selectLobbySeats);
  const amHost = useSelector(selectAmIHost);

  if (!amHost) {
    return <Waiting>Waiting for host to start…</Waiting>;
  }

  // selectLobbySeats may return PlayerSeat[] (with status) or LobbyPlayer[] (no
  // status). The lobby projection only contains seated players, so a missing
  // `status` is always "seated" — narrow with 'status' in s.
  const seatedCount = seats.filter((s) => ('status' in s ? s.status !== 'empty' : true)).length;
  const canStart = seatedCount >= 2;

  return (
    <Wrap>
      {!canStart && <Hint>{hintText(seatedCount)}</Hint>}
      <Cta
        $enabled={canStart}
        disabled={!canStart}
        onClick={() => getSocket().emit('round:ready')}
      >
        Begin Betting
      </Cta>
    </Wrap>
  );
}
```

- [ ] **Step 2: Verify TypeScript passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Run all unit tests**

Run: `cd client && npx vitest run`
Expected: 25 tests, all pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/StartButton.tsx
git commit -m "style(client): polish StartButton with gold CTA + disabled hint"
```

---

## Task 8: Cleanup inline-styled "Hand N" label in `PlayerSeat.tsx`

**Files:**
- Modify: `client/src/components/PlayerSeat.tsx`

This removes the last inline-styled holdout on the table. The label only renders when a player has split hands (i.e. `seat.hands.length > 1`).

- [ ] **Step 1: Add a `HandLabel` styled-component**

In `client/src/components/PlayerSeat.tsx`, add a new `HandLabel` styled definition to the existing block of styled components (place it right after the existing `HandBlock` definition on line ~56):

```tsx
const HandLabel = styled.div`
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  color: ${({ theme }) => theme.colors.textSecondary};
`;
```

- [ ] **Step 2: Replace the inline-styled `<div>` with `<HandLabel>`**

In the `seat.hands.map((h, i) => (...))` block, change:

```tsx
          {seat.hands.length > 1 && (
            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4, color: '#c9bfa8' }}>
              Hand {i + 1}
            </div>
          )}
```

to:

```tsx
          {seat.hands.length > 1 && <HandLabel>Hand {i + 1}</HandLabel>}
```

- [ ] **Step 3: Verify TypeScript passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Run all unit tests**

Run: `cd client && npx vitest run`
Expected: 25 tests, all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/PlayerSeat.tsx
git commit -m "refactor(client): replace inline-styled Hand N label with HandLabel"
```

---

## Task 9: Cleanup `pages/Table.tsx` `table-page` className

**Files:**
- Modify: `client/src/pages/Table.tsx`

- [ ] **Step 1: Read the current file**

Read `client/src/pages/Table.tsx` to confirm the exact contents.

- [ ] **Step 2: Add a `styled` import and `Page` styled component**

Add `import styled from 'styled-components';` at the top of the file (after the existing imports). Then, anywhere in the file (top of the module is fine), add:

```tsx
const Page = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.entranceBg};
`;
```

- [ ] **Step 3: Replace both `className="table-page"` usages**

Change both:

```tsx
  if (phase === 'lobby') return <div className="table-page"><ConnectionStatus /><Lobby /></div>;
  return <div className="table-page"><ConnectionStatus /><TableView /><ErrorToast /></div>;
```

to:

```tsx
  if (phase === 'lobby') return <Page><ConnectionStatus /><Lobby /></Page>;
  return <Page><ConnectionStatus /><TableView /><ErrorToast /></Page>;
```

- [ ] **Step 4: Verify TypeScript passes**

Run: `cd client && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Run all unit tests**

Run: `cd client && npx vitest run`
Expected: 25 tests, all pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Table.tsx
git commit -m "refactor(client): replace Table.tsx table-page className with styled Page"
```

---

## Task 10: Final end-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Server tests + typecheck**

Run: `cd server && npx jest && npx tsc --noEmit`
Expected: 130/130 jest pass; tsc clean.

- [ ] **Step 2: Client typecheck + unit tests**

Run: `cd client && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc clean; 25 vitest pass (22 existing + 3 new in lobby.spec.ts).

- [ ] **Step 3: Client Playwright happy-path**

Run: `cd client && npx playwright test`
Expected: 1 passed, 1 skipped. The skipped test is the `drop-and-reconnect` placeholder. The happy-path test must:
- Fill `input[placeholder="Your name"]` on `/`
- Click `button:has-text("Create Room")`
- Navigate to `/room/...`
- Click `button:has-text("Begin Betting")`
- Wait for `.bet-panel`
- Fill `.bet-panel input` with `50`
- Click `button:has-text("Place Bet")`
- Click `button:has-text("Deal")`
- Wait for `.action-panel`
- Click `Stand` until settled
- Wait for `.result-overlay`
- Verify `Next Hand` visible to host, hidden from guest

If any step fails with `waitForSelector` timing out, a `className=` / `placeholder=` / button text was likely dropped. Re-check against the **CRITICAL: E2E selector preservation reminder** table at the top of this plan and fix the offending file. (This is exactly the bug class that bit the previous polish pass.)

- [ ] **Step 4: Manual smoke test**

Start the server and client (`npm run dev` from the repo root, or run each side in a separate terminal). Verify visually:
- `/` renders the dark entrance with the brand title and the centered card
- "Create Room" is gold, "Join" is an outline
- Creating a room navigates to `/room/...` and shows the lobby
- The lobby shows 2 seat cards. The host's seat has a gold avatar with initials, a green border, and "Seated" label. The other seat is dashed with a `+` and "Empty Seat"
- The "Begin Betting" button is dimmed with a "Waiting for 1 more player…" hint
- Opening a second tab as a guest, joining the room code: both seats fill with green borders
- "Begin Betting" becomes enabled (gold); clicking it advances to the table view
- The table view is unchanged from the prior polish pass

- [ ] **Step 5: Confirm done**

Once all four steps pass, the lobby & home polish pass is complete. Mark this task done.

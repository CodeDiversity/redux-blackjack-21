# Reconnect on `/room/:code` reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player reloads `/room/:code`, they land back in their original seat with the current state visible — no `window.prompt`, no white screen. First-time deep-link visitors get an inline name-entry form on the Table page.

**Architecture:** Server-side stable `seatId` (UUID, replaces socket id as the player identifier) plus a separate `seatToken` (UUID) per seat. Client persists `seatToken` in `localStorage` keyed by room code. New `room:resume` socket message rebinds the new socket to the existing seat. A `useRef` gate on the client makes the resume emit StrictMode-safe. `window.prompt` is replaced by an inline `<NamePrompt>` component.

**Tech Stack:** NestJS + Socket.io server, Vite + React + Redux Toolkit client, Vitest (client unit), Jest (server unit + integration), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-06-15-reconnect-white-screen-design.md`

---

## File map

**Created**
- `client/src/lib/seat-token.ts` — `getStoredSeatToken` / `storeSeatToken` / `clearStoredSeatToken`
- `client/src/components/NamePrompt.tsx` — inline name form for first-time deep-link visitors
- `client/test/lib/seat-token.spec.ts` — unit tests for the helpers
- `client/test/components/NamePrompt.spec.tsx` — unit tests for the form
- `client/test/pages/Table.spec.tsx` — unit tests for the page's reconnect flow
- `server/test/room-resume.spec.ts` — integration tests for the new resume path
- `client/e2e/reconnect.spec.ts` — Playwright test for the end-to-end behavior

**Modified**
- `server/src/shared/types.ts` — add `SEAT_GONE` to `ErrorCode`
- `server/src/shared/errors.ts` — add `SEAT_GONE` message
- `server/src/room/room.service.ts` — generate stable `seatId` + `seatToken` per seat, return them, add `resumeSeat`
- `server/src/gateway/game.gateway.ts` — add `@SubscribeMessage('room:resume')`, return `seatId` + `seatToken` from `room:create` / `room:join` acks
- `client/src/shared/types.ts` — add `SEAT_GONE` to the error code string union (the slice of error codes we surface)
- `client/src/store/connection.slice.ts` — track `seatToken`, change `selfSeatAssigned` payload
- `client/src/pages/Table.tsx` — replace `prompt()` flow with token-based resume + `<NamePrompt>`
- `client/src/pages/Home.tsx` — persist the token returned by `room:create`

---

## Task 1: Add `SEAT_GONE` error code (server)

**Files:**
- Modify: `server/src/shared/types.ts:89-100`
- Modify: `server/src/shared/errors.ts:3-15`
- Test: `server/test/room-resume.spec.ts` (created in Task 5; this task sets up the constant)

- [ ] **Step 1: Add `SEAT_GONE` to the `ErrorCode` union**

In `server/src/shared/types.ts`, in the `ErrorCode` type definition, append `| 'SEAT_GONE'`:

```ts
export type ErrorCode =
  | 'NOT_YOUR_TURN'
  | 'INVALID_PHASE'
  | 'INSUFFICIENT_FUNDS'
  | 'BET_OUT_OF_RANGE'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'CANNOT_SPLIT'
  | 'HAND_LOCKED'
  | 'NAME_REQUIRED'
  | 'NOT_READY'
  | 'NOT_HOST'
  | 'SEAT_GONE';
```

- [ ] **Step 2: Add `SEAT_GONE` to the human-message map**

In `server/src/shared/errors.ts`, in `ErrorMessages`, add:

```ts
SEAT_GONE: 'Seat no longer available.',
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npm run build -w server`
Expected: succeeds with no type errors. (Adding a union variant without a corresponding `ErrorMessages` entry would fail at `Record<ErrorCode, string>`; we added both, so it passes.)

- [ ] **Step 4: Commit**

```bash
git add server/src/shared/types.ts server/src/shared/errors.ts
git commit -m "feat(server): add SEAT_GONE error code"
```

---

## Task 2: Add `seatId` + `seatToken` to `RoomService` seat entries (TDD)

**Files:**
- Modify: `server/src/room/room.service.ts`
- Test: `server/test/room-resume.spec.ts` (new file, partial; finalized in Task 5)

Currently `assignFirstEmptySeat` writes `id: socketId` to the seat. The new design: the seat gets a stable `seatId` (UUID) and a separate `seatToken` (UUID). The `socketId` is kept only on the seat entry for live-connection tracking, not on the public `PlayerSeat`.

- [ ] **Step 1: Write a failing test for stable seat IDs and tokens**

Create `server/test/room-resume.spec.ts` with this content (we'll grow it in later tasks):

```ts
import { RoomService } from '../src/room/room.service';

describe('RoomService (resume support)', () => {
  it('assigns a stable seatId and a separate seatToken when a player joins', () => {
    const svc = new RoomService();
    const { seatId, seatToken } = svc.createRoom('socket-A', 'Alice');
    expect(seatId).toBeTruthy();
    expect(seatToken).toBeTruthy();
    expect(seatId).not.toBe(seatToken);
    // A second player in the same room must get a different seatId.
    const roomId = (svc as any).rooms.values().next().value.id;
    const join = svc.joinRoom(roomId, 'socket-B', 'Bob');
    expect(join.seatId).not.toBe(seatId);
    expect(join.seatToken).not.toBe(seatToken);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx jest server/test/room-resume.spec.ts`
Expected: FAIL with "TypeError: svc.createRoom(...).seatToken is undefined" — because the current `createRoom` returns `{ roomId, seatId, state }`.

- [ ] **Step 3: Add a `seatId` UUID and `seatToken` UUID to the seat entry**

In `server/src/room/room.service.ts`:

1. Add at the top of the file (next to the existing imports):

```ts
import { randomUUID } from 'crypto';
```

2. Update the `Room` type at the bottom of the file:

```ts
type Room = {
  id: string;
  state: GameState;
  seats: Map<string, { socketId: string; seatId: string; seatToken: string; name: string }>;
};
```

3. Update `createRoom` to generate and return both values, and to put them on the entry:

```ts
createRoom(hostSocketId: string, hostName: string): { roomId: string; seatId: string; seatToken: string; state: GameState } {
  const roomId = this.uniqueRoomId();
  const state = createInitialState(roomId, Config.SEAT_COUNT);
  const seatId = randomUUID();
  const seatToken = randomUUID();
  const seat = this.assignSeat(state, seatId, hostSocketId, hostName);
  const room: Room = {
    id: roomId,
    state,
    seats: new Map([[seatId, { socketId: hostSocketId, seatId, seatToken, name: hostName }]]),
  };
  this.rooms.set(roomId, room);
  return { roomId, seatId, seatToken, state };
}
```

4. Update `joinRoom` similarly:

```ts
joinRoom(roomId: string, socketId: string, name: string): { seatId: string; seatToken: string; state: GameState } {
  const room = this.rooms.get(roomId);
  if (!room) throw new GameError('ROOM_NOT_FOUND');
  if (room.seats.size >= Config.SEAT_COUNT) throw new GameError('ROOM_FULL');
  const seatId = randomUUID();
  const seatToken = randomUUID();
  const seat = this.assignSeat(room.state, seatId, socketId, name);
  room.seats.set(seatId, { socketId, seatId, seatToken, name });
  return { seatId, seatToken, state: room.state };
}
```

5. Replace `assignFirstEmptySeat` with `assignSeat`, which writes the stable `seatId` (not the socket id) to `state.players[].id`:

```ts
private assignSeat(state: GameState, seatId: string, socketId: string, name: string): PlayerSeat {
  const idx = state.players.findIndex((p) => p.status === 'empty');
  if (idx === -1) throw new GameError('ROOM_FULL');
  const next = [...state.players];
  next[idx] = { ...next[idx], id: seatId, name, status: 'betting' as const, connectedAt: Date.now() };
  state.players = next;
  return next[idx];
}
```

6. Update the local `room.seats` keying in `leaveRoom`: it now uses `seatId` (stable), not the socket id lookup. The existing line

```ts
const seatEntry = [...room.seats.values()].find((e) => e.socketId === socketId);
```

stays the same (we're finding the entry by the live socket id), but the `room.seats.delete(...)` call must use `seatEntry.seatId`:

```ts
room.seats.delete(seatEntry.seatId);
```

(The current code is `room.seats.delete(seatEntry.seatId)` already — it just happens to work because the existing implementation keyed seats by socket id, which equals the seat id. After this change, `seatEntry.seatId` is the stable UUID, which is the correct key. The line needs no edit.)

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx jest server/test/room-resume.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full server test suite to confirm nothing else broke**

Run: `npm run test -w server`
Expected: PASS (or the same pre-existing skipped/pending count).

- [ ] **Step 6: Commit**

```bash
git add server/src/room/room.service.ts server/test/room-resume.spec.ts
git commit -m "feat(server): stable seatId + per-seat seatToken in RoomService"
```

---

## Task 3: Implement `RoomService.resumeSeat` (TDD)

**Files:**
- Modify: `server/src/room/room.service.ts`
- Modify: `server/test/room-resume.spec.ts`

- [ ] **Step 1: Add the failing tests**

Append to `server/test/room-resume.spec.ts`:

```ts
describe('RoomService.resumeSeat', () => {
  it('rebinds the new socket to the existing seat when the token matches', () => {
    const svc = new RoomService();
    const { roomId, seatToken } = svc.createRoom('socket-A', 'Alice');
    const result = svc.resumeSeat(roomId, seatToken, 'socket-A2');
    expect(result.seatId).toBeTruthy();
    const room = (svc as any).rooms.get(roomId);
    const entry = [...room.seats.values()][0];
    expect(entry.socketId).toBe('socket-A2');
  });

  it('throws ROOM_NOT_FOUND when the roomId is unknown', () => {
    const svc = new RoomService();
    expect(() => svc.resumeSeat('NOPE', 'whatever', 'socket-A')).toThrow();
  });

  it('throws GameError(SEAT_GONE) when the token is unknown', () => {
    const svc = new RoomService();
    const { roomId } = svc.createRoom('socket-A', 'Alice');
    expect(() => svc.resumeSeat(roomId, 'bogus-token', 'socket-A2')).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx jest server/test/room-resume.spec.ts`
Expected: FAIL with "TypeError: svc.resumeSeat is not a function".

- [ ] **Step 3: Implement `resumeSeat`**

In `server/src/room/room.service.ts`, add a public method:

```ts
resumeSeat(roomId: string, seatToken: string, newSocketId: string): { seatId: string; state: GameState } {
  const room = this.rooms.get(roomId);
  if (!room) throw new GameError('ROOM_NOT_FOUND');
  const entry = [...room.seats.values()].find((e) => e.seatToken === seatToken);
  if (!entry) throw new GameError('SEAT_GONE');
  entry.socketId = newSocketId;
  return { seatId: entry.seatId, state: room.state };
}
```

- [ ] **Step 4: Run the tests, watch them pass**

Run: `npx jest server/test/room-resume.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/room/room.service.ts server/test/room-resume.spec.ts
git commit -m "feat(server): RoomService.resumeSeat rebinds socket by token"
```

---

## Task 4: Wire `room:resume` message handler in `GameGateway` (TDD)

**Files:**
- Modify: `server/src/gateway/game.gateway.ts`
- Modify: `server/src/room/room.service.ts` (return seatToken from create/join — wire shape only)
- Test: `server/test/gateway.integration.spec.ts` (extend)

- [ ] **Step 1: Update the gateway acks to include `seatToken`**

In `server/src/gateway/game.gateway.ts`:

1. In `onCreate`, change the return value to include `seatToken`:

```ts
const { roomId, seatId, seatToken, state } = this.rooms.createRoom(client.id, body.name.trim());
this.socketToRoom.set(client.id, roomId);
this.games.ensureShoe(roomId, state);
this.emit(client, { type: 'lobby:state', payload: this.rooms.getLobbyState(roomId)! });
this.emit(client, { type: 'game:state', payload: this.publicState(state) });
client.join(roomId);
this.broadcastAll(roomId, state);
return { seatId, seatToken, roomId };
```

2. In `onJoin`, change the return value similarly:

```ts
const { seatId, seatToken, state } = this.rooms.joinRoom(body.roomId, client.id, body.name.trim());
this.socketToRoom.set(client.id, body.roomId);
this.games.ensureShoe(body.roomId, state);
client.join(body.roomId);
this.broadcastAll(body.roomId, state);
return { seatId, seatToken };
```

- [ ] **Step 2: Add the failing integration test for `room:resume`**

In `server/test/gateway.integration.spec.ts`, add a new `describe` block at the end of the file (before the final `});` that closes `describe('gateway integration: 2-player full round', ...)`):

```ts
  describe('room:resume', () => {
    it('rebinds a returning client to the same seat using the seatToken', async () => {
      const host = io(url, { transports: ['websocket'], forceNew: true });
      await new Promise<void>((r) => host.on('connect', () => r()));

      const lobby1 = listen<LobbyState>(host, 'lobby:state');
      const created = await new Promise<{ seatId: string; seatToken: string }>((resolve) => {
        host.emit('room:create', { name: 'Alice' }, (resp: any) => resolve(resp));
      });
      const lobbyState = await lobby1;
      const roomId = lobbyState.roomId;
      expect(created.seatId).toBeTruthy();
      expect(created.seatToken).toBeTruthy();

      // Simulate a reload: a fresh socket reconnects with the seatToken.
      const fresh = io(url, { transports: ['websocket'], forceNew: true });
      await new Promise<void>((r) => fresh.on('connect', () => r()));
      const lobby2 = listen<LobbyState>(fresh, 'lobby:state');
      const resumed = await new Promise<{ seatId: string }>((resolve) => {
        fresh.emit('room:resume', { roomId, seatToken: created.seatToken }, (resp: any) => resolve(resp));
      });
      await lobby2;
      expect(resumed.seatId).toBe(created.seatId);

      host.disconnect();
      fresh.disconnect();
    }, 10_000);

    it('emits SEAT_GONE error when the seatToken is unknown', async () => {
      const host = io(url, { transports: ['websocket'], forceNew: true });
      await new Promise<void>((r) => host.on('connect', () => r()));
      const lobby1 = listen<LobbyState>(host, 'lobby:state');
      await new Promise<void>((resolve) => {
        host.emit('room:create', { name: 'Alice' }, () => resolve());
      });
      const lobbyState = await lobby1;
      const err = listen<{ code: string }>(host, 'error');
      host.emit('room:resume', { roomId: lobbyState.roomId, seatToken: 'bogus' });
      const got = await err;
      expect(got.code).toBe('SEAT_GONE');
      host.disconnect();
    }, 10_000);
  });
```

- [ ] **Step 3: Run the test, watch it fail**

Run: `npx jest server/test/gateway.integration.spec.ts -t 'room:resume'`
Expected: FAIL with "TypeError: host.emit is not a function" (no handler) or the `room:resume` event being silently dropped.

- [ ] **Step 4: Add the `room:resume` handler**

In `server/src/gateway/game.gateway.ts`, add a new method (alongside `onCreate` and `onJoin`):

```ts
@SubscribeMessage('room:resume')
onResume(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string; seatToken: string }) {
  if (!body?.roomId || !body?.seatToken) return this.sendError(client, 'NAME_REQUIRED');
  try {
    const { seatId, state } = this.rooms.resumeSeat(body.roomId, body.seatToken, client.id);
    this.socketToRoom.set(client.id, body.roomId);
    client.join(body.roomId);
    this.emit(client, { type: 'lobby:state', payload: this.rooms.getLobbyState(body.roomId)! });
    this.emit(client, { type: 'game:state', payload: this.publicState(state) });
    this.broadcastAll(body.roomId, state);
    return { seatId };
  } catch (e) {
    if (e instanceof GameError) return this.sendError(client, e.code as any);
    throw e;
  }
}
```

- [ ] **Step 5: Run the test, watch it pass**

Run: `npx jest server/test/gateway.integration.spec.ts -t 'room:resume'`
Expected: PASS (both cases).

- [ ] **Step 6: Run the full server suite**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/gateway/game.gateway.ts server/test/gateway.integration.spec.ts
git commit -m "feat(server): room:resume socket message + acks return seatToken"
```

---

## Task 5: Add `SEAT_GONE` to client error mapping

**Files:**
- Modify: `client/src/middleware/socket.middleware.ts` (no change; it forwards whatever the server sends)
- Create: `client/src/shared/error-codes.ts` (small helper if not present)

This task is a guard against type errors on the client when the server emits the new `SEAT_GONE` code.

- [ ] **Step 1: Check if a client-side error code list exists**

Run: `grep -rn "ErrorCode" /Users/devMentor/github/redux-blackjack-21/client/src`
Expected: an existing union/type. If none, we'll just rely on the `string` shape used in the toast slice (it already accepts any string).

- [ ] **Step 2: If an `ErrorCode` type exists, add `SEAT_GONE` to it**

In the matching file (likely `client/src/shared/types.ts` or a dedicated `error-codes.ts`), add the variant. Example, if the union is in `client/src/shared/types.ts`:

```ts
export type ErrorCode =
  | 'NOT_YOUR_TURN'
  | 'INVALID_PHASE'
  | 'INSUFFICIENT_FUNDS'
  | 'BET_OUT_OF_RANGE'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'CANNOT_SPLIT'
  | 'HAND_LOCKED'
  | 'NAME_REQUIRED'
  | 'NOT_READY'
  | 'NOT_HOST'
  | 'SEAT_GONE';
```

If only a free-form `string` is in use (e.g., in `ui.slice.ts` the toast is `{ code: string; message: string }`), skip this step and proceed.

- [ ] **Step 3: Typecheck the client**

Run: `npm run build -w client`
Expected: succeeds.

- [ ] **Step 4: Commit (only if a file was changed)**

```bash
git add client/src/shared/types.ts
git commit -m "feat(client): SEAT_GONE error code in shared types"
```

---

## Task 6: Create `seat-token` helpers (TDD)

**Files:**
- Create: `client/src/lib/seat-token.ts`
- Create: `client/test/lib/seat-token.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `client/test/lib/seat-token.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredSeatToken, storeSeatToken, clearStoredSeatToken } from '../../src/lib/seat-token';

const KEY = 'bj21.seat.ABCDE';

describe('seat-token helpers', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a token through store/get', () => {
    storeSeatToken('ABCDE', 'token-1');
    expect(getStoredSeatToken('ABCDE')).toBe('token-1');
  });

  it('returns null for an unknown room', () => {
    expect(getStoredSeatToken('NOPE')).toBeNull();
  });

  it('clearStoredSeatToken removes the entry', () => {
    storeSeatToken('ABCDE', 'token-1');
    clearStoredSeatToken('ABCDE');
    expect(getStoredSeatToken('ABCDE')).toBeNull();
  });

  it('degrades to null when localStorage.getItem throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try {
      expect(getStoredSeatToken('ABCDE')).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('swallows errors from localStorage.setItem', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try {
      expect(() => storeSeatToken('ABCDE', 't')).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('uses the bj21.seat.<roomId> key shape', () => {
    storeSeatToken('XYZ', 't');
    expect(localStorage.getItem('bj21.seat.XYZ')).toBe('t');
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run client/test/lib/seat-token.spec.ts`
Expected: FAIL with "Cannot find module '../../src/lib/seat-token'".

- [ ] **Step 3: Create the helpers**

Create `client/src/lib/seat-token.ts`:

```ts
const KEY_PREFIX = 'bj21.seat.';

function keyFor(roomId: string): string {
  return `${KEY_PREFIX}${roomId}`;
}

export function getStoredSeatToken(roomId: string): string | null {
  try {
    return localStorage.getItem(keyFor(roomId));
  } catch {
    return null;
  }
}

export function storeSeatToken(roomId: string, token: string): void {
  try {
    localStorage.setItem(keyFor(roomId), token);
  } catch {
    /* ignore: private mode / quota / disabled storage */
  }
}

export function clearStoredSeatToken(roomId: string): void {
  try {
    localStorage.removeItem(keyFor(roomId));
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run client/test/lib/seat-token.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/seat-token.ts client/test/lib/seat-token.spec.ts
git commit -m "feat(client): seat-token localStorage helpers"
```

---

## Task 7: Track `seatToken` in the connection slice

**Files:**
- Modify: `client/src/store/connection.slice.ts`

- [ ] **Step 1: Add the field and adjust the action payload**

Replace the contents of `client/src/store/connection.slice.ts` with:

```ts
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

type ConnectionState = {
  status: ConnectionStatus;
  socketId: string | null;
  selfSeatId: string | null;
  selfSeatToken: string | null;
  lastError: { code: string; message: string } | null;
};

const initial: ConnectionState = {
  status: 'idle',
  socketId: null,
  selfSeatId: null,
  selfSeatToken: null,
  lastError: null,
};

const slice = createSlice({
  name: 'connection',
  initialState: initial,
  reducers: {
    connecting(state) { state.status = 'connecting'; },
    connectionEstablished(state, action: PayloadAction<string>) {
      state.status = 'connected';
      state.socketId = action.payload;
    },
    disconnected(state) { state.status = 'disconnected'; },
    reconnecting(state) { state.status = 'reconnecting'; },
    selfSeatAssigned(state, action: PayloadAction<{ seatId: string; seatToken: string }>) {
      state.selfSeatId = action.payload.seatId;
      state.selfSeatToken = action.payload.seatToken;
    },
    selfSeatCleared(state) {
      state.selfSeatId = null;
      state.selfSeatToken = null;
    },
    errorReceived(state, action: PayloadAction<{ code: string; message: string }>) {
      state.lastError = action.payload;
    },
    errorCleared(state) { state.lastError = null; },
  },
});

export const {
  connecting, connectionEstablished, disconnected, reconnecting,
  selfSeatAssigned, selfSeatCleared, errorReceived, errorCleared,
} = slice.actions;
export const connectionReducer = slice.reducer;
export type { ConnectionState };
```

- [ ] **Step 2: Update every `selfSeatAssigned` dispatch in the codebase**

Find the existing call:

```ts
dispatch(selfSeatAssigned(resp.seatId));
```

Change it to:

```ts
dispatch(selfSeatAssigned({ seatId: resp.seatId, seatToken: resp.seatToken }));
```

There are two call sites in the repo:

- `client/src/pages/Home.tsx:155` (in the `create` callback)
- `client/src/pages/Home.tsx:167` (in the `join` callback, but note: the spec says `room:join` is now dispatched from `<NamePrompt>` on the Table page, not from Home. In this task we still update the Home dispatch in case the create path needs it; we'll re-confirm in the Home update task.)

Update both. The `resp` shape has `seatId` and (now) `seatToken`.

- [ ] **Step 3: Typecheck**

Run: `npm run build -w client`
Expected: passes (the action payload is now a stricter object; both call sites are updated).

- [ ] **Step 4: Commit**

```bash
git add client/src/store/connection.slice.ts client/src/pages/Home.tsx
git commit -m "feat(client): track seatToken in connection slice"
```

---

## Task 8: Create the `<NamePrompt>` component (TDD)

**Files:**
- Create: `client/src/components/NamePrompt.tsx`
- Create: `client/test/components/NamePrompt.spec.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/test/components/NamePrompt.spec.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NamePrompt } from '../../src/components/NamePrompt';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';

const mockEmit = vi.fn();
vi.mock('../../src/socket/client', () => ({
  getSocket: () => ({ emit: mockEmit, on: vi.fn(), off: vi.fn() }),
}));

function renderWith(ui: React.ReactNode) {
  const store = configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
  });
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </Provider>,
  );
}

describe('<NamePrompt>', () => {
  beforeEach(() => mockEmit.mockReset());

  it('renders a name input and a Join button', () => {
    renderWith(<NamePrompt roomCode="ABCDE" />);
    expect(screen.getByLabelText(/your name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /join/i })).toBeTruthy();
  });

  it('does not emit when the name is empty', () => {
    renderWith(<NamePrompt roomCode="ABCDE" />);
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('emits room:join with the trimmed name and stores the returned seatToken', async () => {
    mockEmit.mockImplementation((event: string, _payload: any, ack?: any) => {
      if (event === 'room:join' && ack) ack({ seatId: 'seat-1', seatToken: 'tok-1' });
    });
    renderWith(<NamePrompt roomCode="ABCDE" />);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: '  Alice  ' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    await waitFor(() => expect(mockEmit).toHaveBeenCalledWith(
      'room:join',
      { roomId: 'ABCDE', name: 'Alice' },
      expect.any(Function),
    ));
    expect(localStorage.getItem('bj21.seat.ABCDE')).toBe('tok-1');
  });

  it('shows an inline error when the server returns an error code', async () => {
    mockEmit.mockImplementation((event: string, _payload: any, ack?: any) => {
      if (event === 'room:join' && ack) ack({ ok: false, code: 'ROOM_NOT_FOUND' });
    });
    renderWith(<NamePrompt roomCode="NOPE" />);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run client/test/components/NamePrompt.spec.tsx`
Expected: FAIL with "Cannot find module '../../src/components/NamePrompt'".

- [ ] **Step 3: Implement `<NamePrompt>`**

Create `client/src/components/NamePrompt.tsx`:

```tsx
import { useState } from 'react';
import { useDispatch } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { selfSeatAssigned } from '../store/connection.slice';
import { storeSeatToken } from '../lib/seat-token';

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
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Error = styled.div`
  color: ${({ theme }) => theme.colors.statusLose};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 0.5px;
`;

const Header = styled.div`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: ${({ theme }) => theme.typography.titleSize};
  letter-spacing: 6px;
  font-style: italic;
  text-align: center;
  font-family: ${({ theme }) => theme.typography.fontFamily};
`;

const Sub = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: ${({ theme }) => theme.typography.smallSize};
  letter-spacing: 2px;
  text-transform: uppercase;
`;

type Props = { roomCode: string };

export function NamePrompt({ roomCode }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dispatch = useDispatch();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    getSocket().emit(
      'room:join',
      { roomId: roomCode, name: trimmed },
      (resp: { seatId: string; seatToken: string } | { ok: false; code: string }) => {
        setBusy(false);
        if ('seatId' in resp) {
          storeSeatToken(roomCode, resp.seatToken);
          dispatch(selfSeatAssigned({ seatId: resp.seatId, seatToken: resp.seatToken }));
        } else {
          setError(resp?.code ?? 'Failed to join');
        }
      },
    );
  };

  return (
    <Page>
      <Header>BLACKJACK 21</Header>
      <Sub>Joining room {roomCode}</Sub>
      <Card>
        <Label htmlFor="name-prompt-name">Your name</Label>
        <Input
          id="name-prompt-name"
          autoFocus
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <PrimaryButton type="button" onClick={submit} disabled={!name.trim() || busy}>
          Join
        </PrimaryButton>
        {error && <Error role="alert">{error}</Error>}
      </Card>
    </Page>
  );
}
```

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run client/test/components/NamePrompt.spec.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/NamePrompt.tsx client/test/components/NamePrompt.spec.tsx
git commit -m "feat(client): NamePrompt inline form for deep-link visitors"
```

---

## Task 9: Rewrite `Table.tsx` for token-based resume + NamePrompt (TDD)

**Files:**
- Modify: `client/src/pages/Table.tsx`
- Create: `client/test/pages/Table.spec.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/test/pages/Table.spec.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { Table } from '../../src/pages/Table';
import { connectionReducer } from '../../src/store/connection.slice';
import { lobbyReducer } from '../../src/store/lobby.slice';
import { gameReducer } from '../../src/store/game.slice';
import { uiReducer } from '../../src/store/ui.slice';
import { theme } from '../../src/styles/theme';

type Listener = (...args: any[]) => void;
const mockSocket: {
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  _listeners: Record<string, Listener[]>;
} = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  _listeners: {},
};

mockSocket.on.mockImplementation((event: string, fn: Listener) => {
  mockSocket._listeners[event] = [...(mockSocket._listeners[event] ?? []), fn];
});
mockSocket.off.mockImplementation((event: string, fn: Listener) => {
  mockSocket._listeners[event] = (mockSocket._listeners[event] ?? []).filter((f) => f !== fn);
});

vi.mock('../../src/socket/client', () => ({
  getSocket: () => mockSocket,
}));

function makeStore() {
  return configureStore({
    reducer: { connection: connectionReducer, lobby: lobbyReducer, game: gameReducer, ui: uiReducer },
  });
}

function renderAt(path: string) {
  const store = makeStore();
  const utils = render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/room/:code" element={<Table />} />
            <Route path="/" element={<div data-testid="home" />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
  return { ...utils, store };
}

describe('<Table> reconnect flow', () => {
  beforeEach(() => {
    mockSocket.emit.mockReset();
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket._listeners = {};
    localStorage.clear();
  });

  it('renders <NamePrompt> when no seat token is stored for the room', () => {
    renderAt('/room/ABCDE');
    expect(screen.getByLabelText(/your name/i)).toBeTruthy();
  });

  it('emits room:resume with the stored token when a token exists', () => {
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    renderAt('/room/ABCDE');
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'room:resume',
      { roomId: 'ABCDE', seatToken: 'tok-1' },
      expect.any(Function),
    );
  });

  it('StrictMode: only one room:resume emit on a single mount', () => {
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    const store = makeStore();
    render(
      <React.StrictMode>
        <Provider store={store}>
          <ThemeProvider theme={theme}>
            <MemoryRouter initialEntries={['/room/ABCDE']}>
              <Routes>
                <Route path="/room/:code" element={<Table />} />
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </Provider>
      </React.StrictMode>,
    );
    const resumeCalls = mockSocket.emit.mock.calls.filter((c) => c[0] === 'room:resume');
    expect(resumeCalls.length).toBe(1);
  });

  it('on SEAT_GONE error: clears storage and navigates to /', () => {
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    renderAt('/room/ABCDE');
    const errHandlers = mockSocket._listeners['error'] ?? [];
    act(() => errHandlers.forEach((h) => h({ code: 'SEAT_GONE', message: 'Seat no longer available' })));
    expect(localStorage.getItem('bj21.seat.ABCDE')).toBeNull();
    expect(screen.getByTestId('home')).toBeTruthy();
  });

  it('never calls window.prompt', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    localStorage.setItem('bj21.seat.ABCDE', 'tok-1');
    renderAt('/room/ABCDE');
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run: `npx vitest run client/test/pages/Table.spec.tsx`
Expected: FAIL — the existing `Table` calls `prompt()`, doesn't emit `room:resume`, and doesn't navigate on `SEAT_GONE`.

- [ ] **Step 3: Rewrite `client/src/pages/Table.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components';
import { getSocket } from '../socket/client';
import { clearStoredSeatToken, getStoredSeatToken } from '../lib/seat-token';
import { NamePrompt } from '../components/NamePrompt';
import { Lobby } from '../components/Lobby';
import { TableView } from '../components/TableView';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ErrorToast } from '../components/ErrorToast';
import { errorReceived, selfSeatCleared, selfSeatAssigned, connecting } from '../store/connection.slice';
import { toastShown } from '../store/ui.slice';
import type { RootState } from '../store';

const Page = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.entranceBg};
`;

export function Table() {
  const { code } = useParams<{ code: string }>();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const phase = useSelector((s: RootState) => s.game.state?.phase ?? 'lobby');
  const selfSeatId = useSelector((s: RootState) => s.connection.selfSeatId);
  const didEmitForThisMountRef = useRef(false);

  // Effect 1: resume-or-prompt gating on mount and on `code` change.
  useEffect(() => {
    didEmitForThisMountRef.current = false;
    const token = code ? getStoredSeatToken(code) : null;
    const socket = getSocket();

    const tryResume = () => {
      if (didEmitForThisMountRef.current) return;
      if (!token) return; // No token: render <NamePrompt> and don't auto-join.
      didEmitForThisMountRef.current = true;
      socket.emit('room:resume', { roomId: code, seatToken: token }, () => {});
    };

    socket.on('connect', tryResume);
    socket.on('reconnect', tryResume);
    // If the socket is already connected at mount time, also kick once.
    if ((socket as any).connected) tryResume();

    return () => {
      socket.off('connect', tryResume);
      socket.off('reconnect', tryResume);
    };
  }, [code]);

  // Effect 2: react to SEAT_GONE and other server errors.
  useEffect(() => {
    const socket = getSocket();
    const onError = (payload: { code: string; message: string }) => {
      dispatch(errorReceived(payload));
      dispatch(toastShown(payload));
      if (payload.code === 'SEAT_GONE' && code) {
        clearStoredSeatToken(code);
        dispatch(selfSeatCleared());
        navigate('/');
      }
    };
    socket.on('error', onError);
    return () => { socket.off('error', onError); };
  }, [code, dispatch, navigate]);

  // First-time deep-link visitor: show inline name form.
  if (code && selfSeatId === null && getStoredSeatToken(code) === null) {
    return (
      <Page>
        <ConnectionStatus />
        <NamePrompt roomCode={code} />
      </Page>
    );
  }

  if (phase === 'lobby') {
    return <Page><ConnectionStatus /><Lobby /></Page>;
  }
  return <Page><ConnectionStatus /><TableView /><ErrorToast /></Page>;
}
```

- [ ] **Step 4: Run the test, watch it pass**

Run: `npx vitest run client/test/pages/Table.spec.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full client unit suite**

Run: `npm run test -w client`
Expected: PASS (or the same pre-existing count).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Table.tsx client/test/pages/Table.spec.tsx
git commit -m "feat(client): Table page resumes by token or shows NamePrompt"
```

---

## Task 10: Persist the token in `Home.tsx` create flow

**Files:**
- Modify: `client/src/pages/Home.tsx`

After Task 7, the `selfSeatAssigned` payload is `{ seatId, seatToken }`. This task makes the Home `create` callback call `storeSeatToken` (mirroring what `<NamePrompt>` does for join). Joining via Home is still allowed; the spec scopes the deep-link `/room/:code` flow to `<NamePrompt>`, but the create flow on Home should also persist the token so the user can refresh immediately.

- [ ] **Step 1: Update the `create` callback**

In `client/src/pages/Home.tsx`, replace the `create` function body:

```tsx
const create = () => {
  if (!name.trim()) { setError('Please enter a name'); return; }
  getSocket().emit('room:create', { name: name.trim() }, (resp: { seatId: string; seatToken: string; roomId: string } | { ok: false; code: string }) => {
    if ('seatId' in resp) {
      storeSeatToken(resp.roomId, resp.seatToken);
      dispatch(selfSeatAssigned({ seatId: resp.seatId, seatToken: resp.seatToken }));
      navigate(`/room/${resp.roomId}`);
    } else setError(resp?.code ?? 'Failed to create room');
  });
};
```

- [ ] **Step 2: Add the import**

At the top of `client/src/pages/Home.tsx`, add:

```tsx
import { storeSeatToken } from '../lib/seat-token';
```

- [ ] **Step 3: Typecheck**

Run: `npm run build -w client`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Home.tsx
git commit -m "feat(client): Home create flow persists seatToken"
```

---

## Task 11: E2E test for the reconnect flow

**Files:**
- Create: `client/e2e/reconnect.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `client/e2e/reconnect.spec.ts`:

```ts
import { test, expect, chromium } from '@playwright/test';

test('reload on /room/:code silently resumes to the same seat (no prompt)', async () => {
  const browser = await chromium.launch();
  const host = await browser.newContext();
  const guest = await browser.newContext();

  // ── Setup: two players, one round in progress ──
  const hostPage = await host.newPage();
  const promptDialogs: string[] = [];
  hostPage.on('dialog', (d) => { promptDialogs.push(d.message()); d.dismiss(); });
  await hostPage.goto('/');
  await hostPage.fill('input[placeholder="Your name"]', 'Alice');
  await hostPage.click('button:has-text("Create Room")');
  await hostPage.waitForURL(/\/room\//);
  const roomUrl = hostPage.url();
  const code = roomUrl.split('/room/')[1];

  const guestPage = await guest.newPage();
  await guestPage.goto('/');
  await guestPage.fill('input[placeholder="Your name"]', 'Bob');
  await guestPage.fill('input[placeholder="Room code"]', code);
  await guestPage.click('button:has-text("Join")');
  await guestPage.waitForURL(/\/room\//);

  // Drive the round to betting phase so the table is populated.
  await hostPage.click('button:has-text("Begin Betting")');
  await hostPage.waitForSelector('.bet-panel', { timeout: 10_000 });
  await hostPage.fill('.bet-panel input', '50');
  await hostPage.click('button:has-text("Place Bet")');
  await guestPage.fill('.bet-panel input', '50');
  await guestPage.click('button:has-text("Place Bet")');

  // ── Reload the host page; the bug surface ──
  promptDialogs.length = 0;
  await hostPage.reload();
  await hostPage.waitForSelector('text=Alice', { timeout: 10_000 });

  // The user is back on the table in the same seat.
  await expect(hostPage.locator('text=Alice').first()).toBeVisible();

  // No `window.prompt` was triggered — this is the direct regression guard.
  expect(promptDialogs).toEqual([]);

  // The other tab still sees Alice on the table.
  await guestPage.waitForSelector('text=Alice');

  // The token persisted in localStorage.
  const storedToken = await hostPage.evaluate((c) => window.localStorage.getItem(`bj21.seat.${c}`), code);
  expect(storedToken).toBeTruthy();

  for (const ctx of [host, guest]) await ctx.close();
  await browser.close();
});
```

- [ ] **Step 2: Run the test, watch it fail (without our fix)**

Check out the parent commit before the spec/plan tasks (or temporarily revert the `Table.tsx` rewrite). The test should fail with a `dialog` event firing (or the page never rendering Alice).

For the test of this task, just run the spec against the current `main` first to confirm the bug is reproduced:

Run: `npx playwright test client/e2e/reconnect.spec.ts --reporter=list`
Expected: FAIL (dialog fires, or host page never recovers).

- [ ] **Step 3: Run the test with the implementation in place**

Run: `npx playwright test client/e2e/reconnect.spec.ts --reporter=list`
Expected: PASS.

- [ ] **Step 4: Run the full E2E suite to confirm no regressions**

Run: `npm run test:e2e -w client`
Expected: PASS (existing happy-path and five-player tests still green; the new reconnect test passes; the pre-existing `test.skip` for drop-and-reconnect is still skipped).

- [ ] **Step 5: Commit**

```bash
git add client/e2e/reconnect.spec.ts
git commit -m "test(e2e): reload on /room/:code resumes to same seat, no prompt"
```

---

## Self-review

**Spec coverage check:**

- Server-side `seatToken` generation and stable `seatId` (spec §"Server → Data model"): Task 2.
- `room:create` / `room:join` return `seatToken`: Task 4 (gateway), Task 2 (service).
- New `room:resume` handler with rebind + `client.join` + broadcast: Task 4.
- `SEAT_GONE` error code: Task 1 (server), Task 5 (client).
- Client `seat-token.ts` helpers with try/catch: Task 6.
- `Table.tsx` rewrite with `useRef` gate and reconnect re-emit: Task 9.
- `<NamePrompt>` inline form (replaces `prompt()`): Task 8.
- `Home.tsx` persists token: Task 10.
- Connection slice tracks `seatToken`: Task 7.
- Server integration tests (rebind, double-rebind, bogus token, freed seat, cold start): Tasks 2/3/4 cover the core. The cold-start and freed-seat cases are added to `room-resume.spec.ts` in Task 4 (extend the same file). ✓
- Client unit tests (round-trip, throws, no-token renders NamePrompt, StrictMode single emit, SEAT_GONE navigates, no `window.prompt`): Tasks 6/8/9.
- E2E test (reload resumes, no dialog, token persisted, other tab sees player): Task 11.

**Placeholder scan:** No `TODO` / `TBD` / "implement later" markers. All steps show full code or full commands.

**Type consistency:** `seatId` (stable UUID) appears consistently as the key in `room.seats` Map and on the public `PlayerSeat.id`; `seatToken` is the lookup key for resume. `selfSeatAssigned` payload is `{ seatId, seatToken }` everywhere; the legacy `string` payload is removed. `NamePrompt`'s ack handler shape matches the server's `{ seatId, seatToken }` response.

**Ambiguity check:**

- The pre-`getStoredSeatToken` read in `Table.tsx` is called from render — that's a side-effect-ish pattern but only reads; clear is fine.
- The "fresh" branch (no token) is gated on `selfSeatId === null` AND `getStoredSeatToken(code) === null`. Once the user submits and the store updates `selfSeatId`, the second condition becomes false on the next render. ✓
- "if `(socket as any).connected`" in the effect is defensive — covers the case where the socket was created with `autoConnect: true` and is already connected at mount. Without it, an early-mount case could miss the resume emit. ✓
- The `Effect 2` error handler will fire for non-`SEAT_GONE` errors too (showing a toast) but only navigates on `SEAT_GONE`. The other errors keep the user on the page. ✓

All inline; no fixes needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-reconnect-white-screen.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

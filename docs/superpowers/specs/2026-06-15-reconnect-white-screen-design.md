# Reconnect on `/room/:code` reload — design

Status: approved (brainstorming, 2026-06-15)

## Problem

A player who reloads the browser at the same `/room/:code` URL ends up with
errors and a white screen. Root causes in the current code
(`client/src/pages/Table.tsx:21-33`):

1. The page uses `window.prompt('Your name?')` to recover the player's name.
   `prompt()` is blocking, returns `null` in many test/embedded contexts, and
   is a frequent contributor to React render-blocking failures.
2. The page subscribes to `socket.on('connect', onConnect)` from inside
   `useEffect`, but the socket is created with `autoConnect: true` in
   `client/src/socket/client.ts:7`. By the time the effect runs, `'connect'`
   has already fired; the listener is attached to a connection that has
   already happened, so the `room:join` emit is never sent.
3. The reconnect check uses `(socket as any).socket?.recovered`, which depends
   on socket.io's server-side `connectionStateRecovery`. The server
   (`server/src/gateway/game.gateway.ts`) does not enable it, so the flag is
   always `false` and the code reaches the `prompt()` branch every time.
4. React StrictMode runs effects twice in development. The `onConnect`
   function is recreated on each run; only the latest registration is cleaned
   up, so the first registration leaks.
5. Even if everything above were fixed, the client has no way to identify the
   returning player as "the same person." A reload without a token forces
   them into a fresh seat, disrupting the game.

## Goal

A player who reloads `/room/:code` lands back in their original seat, with
the current game state visible, with no `prompt()` and no white screen. A
first-time deep-link visitor gets an inline name-entry form on the Table
page; submitting it joins the room as today.

## Non-goals

- Server-side persistence of rooms/tokens across server restarts. Tokens are
  in-memory only. After a server restart, all stored tokens become invalid
  and returning clients are bounced to Home.
- Reconnect across different browsers/devices. The token is per-browser,
  keyed by room code in `localStorage`.
- Reconnect when the seat was explicitly vacated and reassigned to someone
  else. The original holder gets `SEAT_GONE` and is bounced to Home.

## Design

### Approach

App-level seat tokens persisted in `localStorage` per room, plus a new
`room:resume` socket message. Rejects alternatives:

- **Socket.io `connectionStateRecovery`** — doesn't survive a hard reload
  (sessionId is in-memory), so it doesn't fix the reported bug.
- **Name-based rejoin** — fragile against name collisions and renames.

### Server (`server/src/`)

**Data model**

- `RoomService` seat entry shape gains a `seatToken: string` field, generated
  with `crypto.randomUUID()` at seat creation. The token never changes for
  the lifetime of the seat.
- Tokens are kept in `room.seats: Map<string, SeatEntry>` where `SeatEntry`
  is `{ socketId, seatId, name, seatToken }`.

**`room:create`**

- Existing behavior, but the callback now returns `{ seatId, seatToken }` in
  addition to `roomId`.

**`room:join`**

- Existing behavior, but the callback now returns `{ seatId, seatToken }`.
- The token is generated at seat assignment time.

**`room:resume` (new)**

- Input: `{ roomId, seatToken }`.
- Looks up the room. If the room doesn't exist, emit
  `error { code: 'ROOM_NOT_FOUND' }`.
- Looks up the seat entry by `seatToken` within the room. If not found,
  emit `error { code: 'SEAT_GONE' }`.
- If found: rebind `entry.socketId = client.id`, update `socketToRoom`,
  re-broadcast `lobby:state` and `game:state` to the room (so the rest of
  the table sees the player is back), and emit both to the resuming client
  so it populates its store.
- Return value: `{ seatId }` (the client already has the token; no need to
  return it again).

**Error codes**

- Add `SEAT_GONE` to `server/src/shared/errors.ts` with message
  "Seat no longer available."

### Client (`client/src/`)

**Token helpers (`client/src/lib/seat-token.ts`, new)**

- `getStoredSeatToken(roomId: string): string | null`
  - Reads `localStorage` under key `bj21.seat.<roomId>`. Returns `null` on
    miss or on any storage exception (private mode, quota, disabled).
- `storeSeatToken(roomId: string, token: string): void`
  - Writes the same key. Swallows storage exceptions.
- `clearStoredSeatToken(roomId: string): void`
  - Removes the key. Swallows storage exceptions.

**`client/src/pages/Table.tsx`**

- Replaces the current `useEffect` that subscribes to `socket.on('connect')`
  and calls `prompt()`.
- On mount:
  - Compute `token = getStoredSeatToken(code)`.
  - If `token` is non-null: emit `room:resume` with `{ roomId: code,
    seatToken: token }` after the socket is connected (use a `'connect'` /
    `'reconnect'` listener; gate with a `useRef` flag so StrictMode
    double-mount and socket reconnects do not fire it twice).
  - If `token` is null: render `<NamePrompt roomCode={code} />` (inline form
    styled like the Home page input card). Submitting it emits
    `room:join` with the entered name; on success, persist the returned
    `seatToken` via `storeSeatToken(code, seatToken)`.
- `connection.status` from Redux gates the resume/join behaviour:
  - On `'reconnect'` events from socket.io (when status was previously
    `'reconnecting'`), re-emit `room:resume` with the stored token.
- `error` listener on the socket: on `SEAT_GONE`, clear stored token, show
  toast, navigate to `/`.

**`<NamePrompt>` component (new, in `client/src/components/NamePrompt.tsx`)**

- Props: `{ roomCode: string }`.
- Renders the same styled `Input` and `PrimaryButton` used on the Home page.
- Local state for the name; non-empty validation; on submit, calls
  `getSocket().emit('room:join', { roomId: roomCode, name }, ack)` and
  handles the ack (`seatId` → store token, dispatch `selfSeatAssigned`,
  transitions to the normal Lobby / TableView render; `ok: false` → show
  inline error).
- Why an inline form, not `prompt()`: `prompt()` blocks the JS thread, is
  suppressed in many embedded contexts and by some extensions, and was a
  contributing cause of the original white screen.

**StrictMode safety**

- A `useRef<boolean>` (`didEmitRef`) is set to `true` on the first emit and
  blocks subsequent emits from the same mount. Combined with effect cleanup
  that resets the ref on unmount, navigating between rooms re-arms it.
- Per-room gating: the ref is keyed on `code` so changing the URL re-runs
  the resume/join flow correctly.

**Token lifecycle**

- Stored: on first successful `room:create` (Home page handler) and
  `room:join` (Table page inline prompt).
- Cleared: on `SEAT_GONE` from the server, on explicit "Leave room" (not
  introduced by this design; nothing to wire), and on cold-start recovery
  failure.

### Wire protocol delta

| Message | Direction | Payload | Returns | Errors |
|---|---|---|---|---|
| `room:create` | C → S | `{ name }` | `{ roomId, seatId, seatToken }` | `NAME_REQUIRED` |
| `room:join` | C → S | `{ roomId, name }` | `{ seatId, seatToken }` | `NAME_REQUIRED`, `ROOM_NOT_FOUND`, `ROOM_FULL` |
| `room:resume` | C → S | `{ roomId, seatToken }` | `{ seatId }` | `ROOM_NOT_FOUND`, `SEAT_GONE` |
| `lobby:state` | S → C | `LobbyState` | — | — |
| `game:state` | S → C | `GameState` | — | — |
| `error` | S → C | `{ code, message }` | — | — |

## Error handling summary

| Scenario | Behavior |
|---|---|
| Reload at `/room/:code` with valid token | Silent re-seat; current state rendered. |
| Reload at `/room/:code` with stale/used token | Toast "Seat no longer available", bounce to `/`. |
| Reload at `/room/:code` with no token | Inline name prompt; submit to join. |
| Server restart | All stored tokens invalid; returning clients get `SEAT_GONE` and are bounced. |
| `localStorage` throws | Helpers return `null`; user gets the name prompt. |
| StrictMode double-mount | Single `room:resume` emit, guarded by `useRef`. |
| Socket reconnect (network blip) | `'reconnect'` event triggers another `room:resume` with the same token. |

## Testing strategy

### Server (`server/test/room-resume.spec.ts`, new)

- Create room from socket A → assert `seatToken` returned and stored.
- Resume from socket B with valid token → assert lobby:state / game:state
  arrive at B, `room.seats[seatId].socketId === B.id`.
- Resume from socket C with same valid token → seat is rebound to C; old
  A→B→C chain leaves no orphan entries.
- Resume with bogus token → `error { code: 'SEAT_GONE' }`.
- Resume after seat is freed (host leaves, seat returns to empty) → `SEAT_GONE`.
- Cold start: fresh `RoomService`, call `resumeSeat` with a token that never
  existed → `SEAT_GONE`.

### Client unit (`client/test/`)

- `seat-token.spec.ts`:
  - Round-trip a token through `store` / `get`.
  - Unknown room → `null`.
  - `localStorage` throw → `get` returns `null`, `store` / `clear` swallow.
- `pages/Table.spec.tsx` (extend or new):
  - No token in storage → renders `<NamePrompt />`.
  - Valid token in storage → emits `room:resume` exactly once, then renders
    Lobby or TableView based on incoming `lobby:state` / `game:state`.
  - `error` with `SEAT_GONE` → navigates to `/` and clears storage.
  - Mounted inside `<React.StrictMode>` with a token → mock socket receives
    exactly one `room:resume`.

### Client E2E (`client/e2e/reconnect.spec.ts`, new)

- Tab 1 creates, tab 2 joins, both get to the table.
- Tab 1 reloads → same URL → asserts: same `seatId` UI, no
  `window.prompt` dialog (Playwright `page.on('dialog', ...)` must not
  fire), tab 2 sees tab 1's name and bankroll unchanged.
- Variant: reload mid-betting → tab 1 lands back in the betting state with
  the room intact.

## Files touched

- New: `client/src/lib/seat-token.ts`, `client/src/components/NamePrompt.tsx`,
  `client/test/seat-token.spec.ts`, `client/test/pages/Table.spec.tsx` (or
  extend existing), `client/e2e/reconnect.spec.ts`,
  `server/test/room-resume.spec.ts`.
- Modified: `client/src/pages/Table.tsx`, `client/src/pages/Home.tsx`
  (persist token on create), `client/src/store/connection.slice.ts` (action
  payload tweak if needed), `client/src/middleware/socket.middleware.ts`
  (no functional change, but verify the `error` listener path is wired),
  `server/src/room/room.service.ts` (token generation, `resumeSeat`),
  `server/src/gateway/game.gateway.ts` (`@SubscribeMessage('room:resume')`,
  callback shapes for `room:create` / `room:join`),
  `server/src/shared/errors.ts` (`SEAT_GONE`),
  `client/src/shared/types.ts` (no new types; existing message types are
  extended inline or via the existing `LobbyState` / `GameState`),
  `client/src/shared/error-codes.ts` (or equivalent) — add `SEAT_GONE`.

## Out of scope / open questions

- Persistent rooms (would require a store and a token registry that survives
  server restart). Deferred.
- Spectator mode for players whose seat is gone. The current design
  redirects them to Home.
- Multi-tab reconnect (two tabs with the same stored token). Last tab wins;
  no concurrent seat sharing introduced.

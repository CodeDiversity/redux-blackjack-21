# Blackjack 21 — Design Spec

**Date:** 2026-06-14
**Status:** Draft, awaiting user review

## Goal

A networked 2-player blackjack game with betting, built with React and Redux. The architecture is explicitly designed to extend to N players (3–6) without component-level rework.

## Non-Goals (v1)

- Real-money gambling, persistence across server restarts, user accounts, or authentication beyond a chosen display name.
- Insurance side bet, surrender, re-splitting aces.
- Reconnect with full state restoration of a hand in progress — players who drop mid-hand auto-stand after a 30s grace and sit out the rest of the round.
- Animations beyond simple CSS transitions; no card-flip or chip-stack effects.
- Mobile-first responsive design — desktop browser is the target.

## Constraints / Decisions Locked In

| Decision | Choice | Why |
|---|---|---|
| Player model | Networked, run locally | Real product foundation, still runs offline |
| Player count | 2 in v1, architected for N | Seats are a list, not a hard-coded pair |
| Actions | Hit, Stand, Double, Split | Classic blackjack, bounded scope |
| Deck | 4–6 deck shoe, cut-card reshuffle | Casino-style, simpler probabilistic model than continuous shuffle |
| Blackjack payout | 3:2 | Player-friendly standard |
| Dealer | Server-controlled, hole card hidden until reveal | Trust model: server is the house |
| Dealer soft 17 | Stand (S17) | Player-friendly; flip via single constant if needed |
| Double after split | Allowed | Standard real-casino rule |
| Language | TypeScript | Game state has many shapes; types catch bugs at compile time |
| Server | NestJS + `@nestjs/websockets` + Socket.io | DI, modules, testability; grows with game logic |
| Client build | Vite | Fast dev, modern default |
| State management | Redux Toolkit (client), single source of truth per slice | Predictable, debuggable, scales with the app |
| State authority | Server-authoritative, broadcasts full snapshots | No desync, no client trust issues, easy to test |
| Lobby | Room codes, host creates and starts | Trivial to extend to N seats with a ready-check |

## Architecture

**Server is the single source of truth for game rules and state.** The client never computes the next state from a local action — it sends an intent (a Socket.io command) and waits for the server's next state snapshot. The client mirrors the server's `GameState` into Redux slices and derives all UI from those slices.

This means:
- The client cannot cheat (it doesn't run the rules).
- The server is the only place that knows the shoe, the dealer's hole card, or the next drawn card.
- All game logic is unit-testable as pure functions on the server.
- The client has zero socket awareness outside a single small middleware that translates events into dispatched actions.

### Data flow

```
Client UI (reads Redux)
   │
   │  dispatch(action) ← local UI intent (e.g. "open bet input")
   │
   ▼
Redux store
   │
   │  useEffect / event handler calls socket.emit('bet:place', { amount })
   │
   ▼
Socket.io middleware (client)  ──── command ────►  NestJS gateway
                                                             │
                                                             ▼
                                                       Game state machine
                                                       (validates, applies, mutates)
                                                             │
                                                             ▼
                                                       socket.emit('game:state', next)
                                                             │
   ┌──── snapshot ◄────────────────────────────────────────┘
   │
   ▼
Socket.io middleware (client)  →  dispatch(gameStateReceived(payload))
   │
   ▼
Redux store (game slice replaces state)
   │
   ▼
Client UI re-renders
```

## Tech Stack

- **Server:** NestJS 10, TypeScript 5, `@nestjs/websockets` with Socket.io adapter, Jest for unit tests, `@nestjs/testing` for integration tests
- **Client:** Vite 5, React 18, TypeScript 5, Redux Toolkit 2, Reselect, React Router 6, Vitest + React Testing Library, Playwright for E2E
- **Shared:** a small `shared/` directory with types and pure-function game logic importable by both server and tests (the client does **not** import from shared at runtime — it only mirrors state)

## State Model

### Server (authoritative)

```ts
type Suit = '♠' | '♥' | '♦' | '♣';
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

type Card = { suit: Suit; rank: Rank };

type Card = { suit: Suit; rank: Rank };

// On the wire, the dealer's hole card is replaced with a placeholder until
// the dealer-turn phase. Player hands always carry real Card values.
type CardSlot = Card | { hidden: true };

type Hand = {
  cards: CardSlot[];
  bet: number;        // 0 when no bet placed
  stood: boolean;
  busted: boolean;
  isBlackjack: boolean;
  doubled: boolean;
};

type SeatStatus =
  | 'empty'        // no player sitting
  | 'betting'      // player has joined but not placed bet
  | 'acting'       // currently this seat's turn
  | 'stood'
  | 'busted'
  | 'blackjack'
  | 'sitting_out'; // dropped mid-hand

type PlayerSeat = {
  id: string;            // socket id, stable across reconnects within a session
  name: string;
  bankroll: number;      // starts at 1000
  hands: Hand[];         // length 1 normally, 2 after a split
  status: SeatStatus;
  connectedAt: number;   // epoch ms; used to pick the new host on host departure
};

type Phase =
  | 'lobby'        // before host starts
  | 'betting'      // placing bets
  | 'dealing'      // cards being dealt (briefly)
  | 'player_turn'  // players acting in order
  | 'dealer_turn'  // dealer revealing and drawing
  | 'settled';     // result visible, awaiting next round

type GameState = {
  roomId: string;
  phase: Phase;
  shoeSize: number;        // cards remaining (no card list shipped to client)
  cutCardIndex: number;    // when shoeSize drops below this, reshuffle next round
  players: PlayerSeat[];   // length is the seat count; starts at 2
  dealer: Hand;            // hole card hidden in the wire payload
  activeSeat: number | null;
  roundNumber: number;
  lastResult: RoundResult | null;
};

type RoundResult = {
  payouts: { seatId: string; delta: number; reason: 'win' | 'lose' | 'push' | 'blackjack' }[];
};
```

**Cards on the wire:** the server sends `CardSlot[]` per hand (not the whole shoe). The dealer's hole card is sent as `{ hidden: true }` in `dealer.cards[1]` until the dealer-turn phase, at which point the slot becomes a real `Card`. Player hands always carry real `Card` values in every phase.

### Client (Redux Toolkit slices)

Four slices, each a single concern:

- **`lobby`** — `{ roomId, hostId, players: { id, name, ready }[], joinError }`
- **`game`** — full `GameState` mirror (no `shoeSize` exposed; only `shoeVisibleSize` for "reshuffle coming" hint if desired)
- **`connection`** — `{ status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting', lastError }`
- **`ui`** — `{ betInputValue, modalsOpen, lastToast }` (purely local, never sent over the wire)

### Selectors (memoized via Reselect)

- `selectSelfSeatId` — from `connection` (set on successful `room:join`)
- `selectMySeat` — `players.find(p => p.id === selfSeatId)`
- `selectIsMyTurn` — `phase === 'player_turn' && activeSeat === selfSeatIndex && mySeat.status === 'acting'`
- `selectAvailableActions(handIndex)` — derives `{ canHit, canStand, canDouble, canSplit }` from the current hand
- `selectPhaseLabel` — human string for the current phase

## Network Protocol

### Client → Server commands

| Event | Payload | Validation |
|---|---|---|
| `room:create` | `{ name }` | name non-empty |
| `room:join` | `{ roomId, name }` | room exists, has empty seat, not in playing phase |
| `room:leave` | — | sender is in a room |
| `round:ready` | — | sender is seated, phase is `lobby` or `settled` |
| `bet:place` | `{ amount }` | amount ∈ [MIN_BET, MAX_BET], amount ≤ bankroll, phase is `betting`, sender is the seat |
| `hand:hit` | `{ handIndex }` | sender is active seat, hand exists, hand not stood/busted/doubled |
| `hand:stand` | `{ handIndex }` | sender is active seat, hand exists, hand not stood/busted |
| `hand:double` | `{ handIndex }` | sender is active seat, hand has ≤ 2 cards, bankroll ≥ bet |
| `hand:split` | `{ handIndex }` | sender is active seat, hand has exactly 2 cards of same rank, bankroll ≥ bet, no aces-already-split rule violated |

### Server → Client broadcasts

| Event | Payload | When |
|---|---|---|
| `lobby:state` | `{ roomId, hostId, players }` | Any room membership change |
| `game:state` | full `GameState` (dealer's hole card hidden until reveal) | After any state change |
| `round:result` | `RoundResult` | Phase transitions to `settled` |
| `error` | `{ code, message }` | Any rejected command |

**Wire shape rule:** every state change ships the full `GameState`, never a delta. With 2–6 players and ≤ 2 hands per player, the payload stays small (sub-2KB). If the player count grows past 6, this should be revisited.

## Round Flow (State Machine)

```
[lobby]
   ↓ host emits `room:start` (covered by `round:ready` from all seats)
[betting]
   ↓ all seated players with bankroll > 0 have placed a bet
[dealing]
   ↓ server deals 2 cards to each seat, 2 to dealer (1 face down)
[player_turn]
   ↓ for each seat in order, for each hand in order:
   ↓   wait for hand:hit / hand:stand / hand:double / hand:split
   ↓ when all hands resolved, peek for dealer natural if upcard is A or 10
[dealer_turn]
   ↓ reveal hole card; if any player hand is still live, hit to S17
[settle]
   ↓ compute payouts, broadcast round:result
[betting]  (next round)
```

**Payouts:**
- Player bust → lose bet, regardless of dealer outcome
- Player blackjack (initial 2 cards = 21) + dealer not blackjack → 3:2 payout
- Player hand > dealer hand (or dealer bust) → 1:1 payout
- Player hand == dealer hand (both 21, no naturals) → push, bet returned
- Player hand < dealer hand → lose bet

**Rules baked in (all single-constant to flip):**
- Dealer stands on soft 17 (S17)
- Double after split allowed
- No re-splitting aces
- Blackjack beats a 21 made of 3+ cards

**Round triggers:**
- Reshuffle when `shoeSize < cutCardIndex` at the start of a round
- Auto-stand disconnected seats after 30s grace

## UI / Components

Component tree (each component reads one slice; only the socket middleware knows the wire):

```
<App>
├── <ConnectionStatus />                 → connection
├── <Lobby />                           → lobby
│   ├── <RoomCode />
│   ├── <PlayerList />
│   └── <StartButton /> (host only, enabled when all seats ready & ≥2 seated)
├── <Table />                           → game
│   ├── <DealerArea />                   → game.dealer
│   ├── <PlayerSeat /> (×N, via .map)    → game.players[i]
│   │   ├── <Hand /> (×splits)
│   │   ├── <Bankroll />
│   │   └── <BetDisplay />
│   ├── <ActionPanel />                  → game.activeSeat, game.players[selfSeatId]
│   │   (only renders if selectIsMyTurn)
│   ├── <BetPanel />                     → ui.betInputValue
│   └── <ResultOverlay />                → game.phase === 'settled'
└── <ErrorToast />                      → connection.lastError
```

**Adding the Nth player is purely additive:** `<PlayerSeat>` is a `.map(players)`. The action panel doesn't change. The lobby gets a third seat entry. No component needs to know "there are exactly 2 of us".

**Routing:** React Router with `/` (home: create or join) and `/room/:code` (table). The socket connection is established when entering `/room/:code` and torn down on leave.

**Visual layout (chosen during brainstorming):**
- Dealer at top-center
- Player seats side-by-side at the bottom; additional seats wrap in a fan for 3+
- Active player gets a glow border and a "Your turn" badge
- Action panel pinned to the bottom, visible only to the active player
- Bet panel shown during the `betting` phase
- Result overlay slides up when `phase === 'settled'`

## Error Handling

### Server validation
Every command is validated. Rejections emit an `error` event with a stable `code`:

| Code | When |
|---|---|
| `NOT_YOUR_TURN` | activeSeat ≠ sender |
| `INVALID_PHASE` | command issued in wrong phase |
| `INSUFFICIENT_FUNDS` | bet or double exceeds bankroll |
| `BET_OUT_OF_RANGE` | amount not in [MIN_BET, MAX_BET] |
| `ROOM_FULL` | join attempt on a room with no empty seats |
| `ROOM_NOT_FOUND` | join with bad code |
| `CANNOT_SPLIT` | hand doesn't meet split criteria |
| `HAND_LOCKED` | hit/double on a stood/busted/doubled hand |

### Client UX
- Validation error → toast (4s auto-dismiss) with human message keyed by `code`
- Connection lost → banner with reconnect status; action buttons disabled
- Server unreachable at boot → full-page error with "Retry" button
- No silent failures anywhere; errors are observable end-to-end

### Constants (single source for tuning)
`MIN_BET = 10`, `MAX_BET = 500`, `STARTING_BANKROLL = 1000`, `SHOE_DECKS = 6`, `CUT_CARD_POSITION_RATIO = 0.25`, `DISCONNECT_GRACE_MS = 30_000`. All in one `config.ts` file, importable by both server tests and the constants displayed in the UI.

## Testing Strategy

### Server unit (Jest) — bulk of coverage
- Deck / shoe: shuffle distribution sanity, cut-card reshuffle
- Hand evaluation: soft vs hard, bust detection, natural blackjack
- Dealer logic: S17, peek-on-A-or-10, deal after all players stand
- Payout math: every combination of player outcome × dealer outcome
- Pure functions, no socket or NestJS wiring

### Server integration (`@nestjs/testing` + fake socket)
- Full round: 2 seats → bet → deal → hit/stand → dealer → settle
- Splitting: hands multiply, both resolve, payouts aggregate
- Doubling: locks hand at one card, bet doubled, payout on resolved total
- Reconnect: drop mid-hand, server auto-stands after grace, round completes

### Client unit (Vitest) — reducers and selectors
- `game` reducer applies `game:state` payloads correctly across phases
- `selectIsMyTurn`, `selectAvailableActions` are correct in every phase
- Socket middleware dispatches the right action for each event
- `bet:place` rejection (e.g. `INSUFFICIENT_FUNDS`) surfaces as a toast

### Client component (React Testing Library)
- `<ActionPanel>` renders only the buttons valid for the current hand
- `<PlayerSeat>` shows the right status badge per `seat.status`
- `<ResultOverlay>` shows the right delta per player
- `<Lobby>` disables start until ≥2 seated and all ready

### E2E (Playwright) — one or two happy paths
- Two browser contexts, real socket, real flow: create room → second tab joins → both bet → one hits, one stands → dealer resolves → both bankrolls update correctly
- Drop-and-reconnect: one tab closes mid-hand, server auto-stands, second tab sees the resolved result

### Out of scope
Performance, load, fuzz, visual regression.

## Extending to N Players

The only places that need to change to support 3–6 players:

1. **Lobby:** the host's room now allows up to N seats; "Start" requires all seated players to be ready. If the host leaves, the longest-connected remaining seat is promoted to host automatically.
2. **Layout:** the `<PlayerSeat>` `.map()` automatically renders more seats; CSS lays them out in a fan.
3. **Game state:** `players` is already an array; turn order is already `activeSeat: number | null`.
4. **Dealer turn:** unchanged — runs after all player hands resolve.
5. **Tests:** the integration suite should parametrize over player count (2, 3, 6) to catch order-of-play bugs.

No component-level rework. No new event types. No new state shapes.

## Open Questions (non-blocking for v1)

- **Display name uniqueness in a room:** simplest rule is "last name wins". Acceptable for v1.
- **Bankroll persistence across server restart:** v1 is in-memory only. If desired, swap in a `Map<roomId, PlayerSeat[]>` in a Redis/Postgres layer behind a `BankrollRepository` interface.
- **Spectators:** out of scope; rooms are seat-or-leave.
- **Sound effects:** out of scope; UI is silent for v1.

## Open Question (blocking — needs user decision)

- **Soft 17:** spec currently says S17. Confirm or change to H17 before implementation.
- **Host leaving mid-game:** if the host leaves the room, the remaining player with the oldest `connectedAt` timestamp is promoted to host. If all players leave, the room is destroyed. The "Start Round" permission transfers automatically; no explicit "promote" UI is needed.

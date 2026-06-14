# Redux Blackjack 21

A networked 2-player blackjack game with betting. React + Redux client, NestJS + Socket.io server, architected to extend to N players.

## Quick start

```bash
npm install
npm run dev
```

This starts the server on `http://localhost:3001` and the client on `http://localhost:5173`. Open two browser tabs to play.

## Play

1. Tab 1: enter a name, click **Create Room**, share the 5-character code.
2. Tab 2: enter a name, type the code, click **Join**.
3. Each player enters a bet (10–500) and clicks **Place Bet**.
4. The host clicks **Start Round**.
5. Each player hits / stands / doubles / splits in turn.
6. Dealer reveals, hand resolves, payouts update the bankrolls.

## Tests

```bash
npm test                # server + client unit tests
npm run test:e2e        # playwright E2E (requires playwright browsers installed)
```

## Project layout

- `server/` — NestJS + Socket.io authoritative game server
- `client/` — Vite + React + Redux Toolkit client
- `docs/superpowers/specs/` — design spec
- `docs/superpowers/plans/` — implementation plan (this file's sibling)

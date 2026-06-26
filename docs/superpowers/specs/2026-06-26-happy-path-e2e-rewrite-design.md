# Rewrite `happy-path.spec.ts` for Current UI

**Date:** 2026-06-26
**Status:** Draft — pending user review

## Problem

`client/e2e/happy-path.spec.ts` is the only red test in the suite. Running
`npx playwright test happy-path.spec.ts` from `client/` fails with a 30s
timeout in round 1.

The test predates two UI simplifications:

1. **Deal button removed (commit `691d934`, 2026-06-15).** A host used to
   click "Deal" after both players placed their bets to fire the dealing
   phase. The button was deleted once the bet-deadline auto-advance
   became the only path out of `betting`.
2. **Fast-deal (commit `1046db9`, 2026-06-25).** When all active players
   have bet, dealing now fires within milliseconds of the last `Place
   Bet` — there is no longer any user-driven "start the deal" action.

`happy-path.spec.ts` lines 32 and 62 still call
`await hostPage.click('button:has-text("Deal")');`. Those clicks time out
silently inside the 30s test budget (the button does not exist), and the
test fails when the subsequent `.action-panel` wait (round 1) or end of
test (round 2) exceeds the budget.

The failure is benign — production behavior is correct — but the test
provides no signal until it's fixed.

## Goal

`client/e2e/happy-path.spec.ts` passes against the current UI flow:

- Round 1: both players bet, dealing fires automatically, both stand,
  `.result-overlay` appears, host clicks "Next Hand".
- Round 2: both players see and click "Rebet $50", dealing fires
  automatically, `.action-panel` appears.

The existing test description — "two players can play two full rounds
with rebet" — remains accurate. (Note: round 2 currently verifies only
that the rebet button starts a hand; it does not play round 2 to a second
result overlay. That is pre-existing scope and not addressed here.)

## Non-Goals

- Extending round 2 to play to a second `.result-overlay`. The current
  scope is the minimal fix. Extending coverage is a separate decision.
- Filling in the `drop-and-reconnect` stub at lines 68–70. That is a
  new test, not a fix to an existing one.
- Rewriting other E2E tests. `early-deal.spec.ts`, `profile.spec.ts`,
  `reconnect.spec.ts`, `animations.spec.ts`, `five-player.spec.ts` all
  pass.
- Touching the server or client production code. This is a test-only
  change.
- The unrelated `socket.middleware.ts` cleanup flagged in earlier
  final-review notes. Out of scope.

## Design

### Single change site

`client/e2e/happy-path.spec.ts` — remove two lines.

```ts
// round 1, after both Place Bet clicks (line 32)
await hostPage.click('button:has-text("Deal")');     // DELETE
await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });
```

```ts
// round 2, after both Rebet clicks (line 62)
await hostPage.click('button:has-text("Deal")');     // DELETE
await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });
```

After the deletion, both `.action-panel` waits resolve from the fast-deal
broadcast. The existing 10s timeout on those waits is far above the
realistic ~2s budget proven by `client/e2e/early-deal.spec.ts:6`.

### Why this is sufficient

- `early-deal.spec.ts` already covers the underlying "fast-deal fires
  and `.action-panel` appears" behavior with two scenarios (solo host at
  `:6`, two players at `:34`). `happy-path.spec.ts` does not need to
  re-prove it — its job is the higher-level round-flow smoke test.
- The `.action-panel` waits are unchanged in shape and timeout, so any
  future regression in the fast-deal path that breaks them will also
  fail `happy-path.spec.ts`. The test still has teeth.
- Round 2's `Rebet $50` click → `.action-panel` wait is the same
  pattern, so removing the second Deal click lets the second wait
  resolve the same way.

### Files touched

- `client/e2e/happy-path.spec.ts` — delete two lines (32 and 62).

No other files change.

## Behavior

End-to-end after the change:

1. Host opens `/`, enters a name, clicks **Create Room**.
2. Guest opens `/`, enters a name, types the room code, clicks **Join**.
3. Host clicks **Begin Betting**.
4. Host fills the bet input with `50`, clicks **Place Bet**.
5. Guest fills the bet input with `50`, clicks **Place Bet**.
6. Server detects all-active-players-have-bet and broadcasts `dealing`.
7. `.action-panel` appears on both clients within ~2s.
8. Both players stand in a 4-iteration polling loop (existing behavior).
9. `.result-overlay` appears on the host within ~10s.
10. Host clicks **Next Hand**.
11. Both clients show **Rebet $50**.
12. Both click **Rebet $50**.
13. Server broadcasts `dealing` again.
14. `.action-panel` appears on the host within ~10s.
15. Test ends. (Round 2 hand is not played to completion — see Non-Goals.)

## Testing

- Run `cd client && npx playwright test happy-path.spec.ts` — must
  pass within 30s.
- Run `cd client && npx playwright test` — full suite must show
  8 passed, 4 skipped, 0 failed.
- No client or server unit tests are affected.

## Risks

- **Minimal.** The Deal-button clicks were dead waits on a non-existent
  element. Removing them lets the existing waits resolve naturally. The
  fast-deal behavior is independently covered by `early-deal.spec.ts`.
- **No production behavior change.** The fix is test-only.
- **Round-2 coverage gap is pre-existing.** The test title claims "two
  full rounds" but only round 1 is played to completion. This gap
  predates this change. Out of scope.
# Happy-Path E2E Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `client/e2e/happy-path.spec.ts` pass against the current UI by removing two stale `button:has-text("Deal")` clicks (lines 32 and 62) and dropping the manual "Next Hand" advance step (lines 46–51), both of which were written assuming behavior that no longer exists.

**Architecture:** Test-only change in a single file. No production code touched. Two fixes:

1. **Deal clicks removed.** Commits `691d934` (Deal button removed) and `1046db9` (fast-deal added) mean dealing now fires automatically when both players have bet. The two `await hostPage.click('button:has-text("Deal")');` calls wait on elements that no longer exist and exhaust the test's 30s budget.
2. **Next Hand click dropped.** After settlement, the server's `SETTLE_PAUSE_MS = 3000` auto-advance moves the room to the next betting phase before the test's 5s Playwright timeout can confirm "Next Hand" was ever visible. Waiting for `.bet-panel` directly races the auto-advance correctly.

**Tech Stack:** Playwright (client E2E), TypeScript end-to-end.

## Global Constraints

- Test-only change. No edits under `server/src/`, `client/src/`, or any shared type/config file.
- The existing 10s timeout on `.action-panel` waits stays as-is. Fast-deal typically resolves in ~2s; the 10s budget is a regression guard, not a timing assumption.
- Do not extend round 2 to play to a second `.result-overlay`. The pre-existing gap is out of scope.
- Do not fill in the `drop-and-reconnect` stub at lines 68–70. Out of scope.
- E2E tests must be run from `client/` so Playwright auto-discovers `client/playwright.config.ts`.
- Dev server (`npm run dev` at workspace root) must be running for E2E tests. Playwright's `webServer.reuseExistingServer: true` will use it if present.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `client/e2e/happy-path.spec.ts` | Two-player E2E smoke test for a full round flow with rebet | Modify: delete the two Deal clicks (lines 32, 62) and replace the Next Hand click block (lines 45–52) with a direct `.bet-panel` wait |

No other files are touched. The Deal button is not coming back; the bet-deadline auto-advance and fast-deal are the only paths out of `betting`. Next Hand auto-advance via `SETTLE_PAUSE_MS` is the only path out of `settled`.

---

## Task 1: Establish the red baseline

**Files:**
- Read-only: `client/e2e/happy-path.spec.ts`
- Read-only: `client/playwright.config.ts`

This task confirms the test is currently failing for the reason the spec describes. Implementation comes in Task 2.

- [ ] **Step 1: Confirm Playwright config and dev server**

The dev server must be running for E2E tests. Verify:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

Expected: `200`. If not 200, start the dev server in another terminal with `npm run dev` from the repo root, wait ~10s, then re-check.

Also confirm Playwright auto-discovers the config when run from `client/`:

```bash
cd client && npx playwright test --list happy-path.spec.ts
```

Expected output includes `client/e2e/happy-path.spec.ts:3:1 › two players can play two full rounds with rebet`. The file path prefix is `client/e2e/...` because `testDir: './e2e'` in `client/playwright.config.ts:10` resolves relative to the config file.

- [ ] **Step 2: Run the failing test and capture the failure mode**

```bash
cd client && npx playwright test happy-path.spec.ts --reporter=line
```

Expected: 1 failed, 1 skipped, error is `Test timeout of 30000ms exceeded` on the "two players can play two full rounds with rebet" test. This is the red baseline we are about to fix.

The failure mode is the Deal-button click waiting on a non-existent element (lines 32 and 62 of `happy-path.spec.ts`), which exhausts the 30s test budget before `.action-panel` (round 1) or end-of-test (round 2) can resolve.

- [ ] **Step 3: No commit — this task only establishes the baseline**

Do not commit anything in Task 1. The only artifact is the captured failure output, which the executor keeps for the task report.

---

## Task 2: Delete the two stale Deal clicks and verify green

**Files:**
- Modify: `client/e2e/happy-path.spec.ts` (delete lines 32 and 62)

The change is two deletions. Both are exact, mechanical removals.

- [ ] **Step 1: Delete the round-1 Deal click**

In `client/e2e/happy-path.spec.ts`, remove line 32:

```ts
  await hostPage.click('button:has-text("Deal")');
```

Round 1 context (lines 27–34) becomes:

```ts
  await hostPage.fill('.bet-panel input', '50');
  await hostPage.click('button:has-text("Place Bet")');
  await guestPage.fill('.bet-panel input', '50');
  await guestPage.click('button:has-text("Place Bet")');

  await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });
```

The `.action-panel` wait now resolves from the fast-deal `dealing` broadcast that arrives within ~2s of both `Place Bet` clicks landing.

- [ ] **Step 2: Replace the Next Hand click block with a direct `.bet-panel` wait**

The current block (lines 45–52) tries to assert that the host sees "Next Hand" and the guest does not, then click it:

```ts
  // ───── ADVANCE TO NEXT HAND ─────
  // Host sees the Next Hand button; guest does not.
  await expect(hostPage.locator('button:has-text("Next Hand")')).toBeVisible();
  await expect(guestPage.locator('button:has-text("Next Hand")')).toHaveCount(0);

  await hostPage.click('button:has-text("Next Hand")');
  await hostPage.waitForSelector('.bet-panel', { timeout: 5_000 });
```

The "Next Hand" button is only visible during the server's `SETTLE_PAUSE_MS = 3000` settle-pause window. By the time the test reaches this block, the Stand loop (lines 36–40) and the `.result-overlay` wait (line 43) have already consumed most of that 3-second window, and the server has often auto-advanced to `betting` before the `toBeVisible` assertion runs.

Replace lines 45–52 with a single `.bet-panel` wait that races the auto-advance correctly:

```ts
  // ───── ADVANCE TO NEXT HAND ─────
  // The server's settle-pause auto-advance moves the room to the next
  // betting phase on its own (SETTLE_PAUSE_MS = 3000). Wait for .bet-panel
  // to reappear on the host instead of trying to catch the "Next Hand"
  // button before the window expires.
  await hostPage.waitForSelector('.bet-panel', { timeout: 10_000 });
```

The 10s timeout covers the worst-case settle-pause + race-condition path. The Next Hand visibility assertions are dropped — the test no longer makes a claim about UI text that the new behavior makes racy.

- [ ] **Step 3: Delete the round-2 Deal click**

In `client/e2e/happy-path.spec.ts`, remove line 62 (the only remaining Deal click):

```ts
  await hostPage.click('button:has-text("Deal")');
```

Round 2 context (lines 59–64) becomes:

```ts
  await hostPage.click('button:has-text("Rebet $50")');
  await guestPage.click('button:has-text("Rebet $50")');

  await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });
```

Same logic: the second `Rebet $50` click triggers fast-deal again, `.action-panel` appears on the host within ~2s.

- [ ] **Step 4: Confirm zero remaining Deal references in the file**

```bash
cd client && grep -n 'Deal' e2e/happy-path.spec.ts
```

Expected: no output (zero matches). The Deal button is gone for good; the test should no longer reference it.

- [ ] **Step 5: Confirm zero remaining Next Hand references in the file**

```bash
cd client && grep -n 'Next Hand' e2e/happy-path.spec.ts
```

Expected: no output (zero matches). The Next Hand click path is gone; auto-advance drives the transition.

- [ ] **Step 6: Run the rewritten test and confirm it passes**

```bash
cd client && npx playwright test happy-path.spec.ts --reporter=line
```

Expected: 1 passed, 1 skipped. The pass should complete well under the 30s budget (the actual fast-deal + Stand-loop + result-overlay round takes ~10s; round 2 is just Rebet → action-panel).

- [ ] **Step 7: Run the full E2E suite to confirm no regression in adjacent flows**

```bash
cd client && npx playwright test --reporter=line
```

Expected: 8 passed, 4 skipped, 0 failed. The four skipped tests are pre-existing `test.skip()` stubs in `auto-advance.spec.ts` and `happy-path.spec.ts:68` (drop-and-reconnect) — they are not affected by this change.

- [ ] **Step 8: Confirm client unit tests are unaffected**

```bash
cd client && npx vitest run
```

Expected: 26 test files, 128 tests, all pass. Vitest is unrelated to the E2E suite but the sanity check costs ~5s.

- [ ] **Step 9: Commit the rewrite**

```bash
cd client && git add e2e/happy-path.spec.ts
git commit -m "test(e2e): drop stale Deal + Next Hand paths from happy-path"
```

The commit subject follows the repo convention (`<type>(<scope>): <verb> <noun>`); see `git log --oneline -10` for examples. Body is unnecessary — the commit is self-explanatory in context.

---

## Final Verification Gate

Run all four commands from the repo root before declaring the plan complete:

- [ ] **Server tests:** `cd server && npx jest` → 298/298 pass. (No server changes expected, but this is the cheapest confirmation that nothing on the server side was disturbed.)
- [ ] **Client unit tests:** `cd client && npx vitest run` → 128/128 pass.
- [ ] **E2E happy-path:** `cd client && npx playwright test happy-path.spec.ts` → 1 passed, 1 skipped.
- [ ] **E2E full suite:** `cd client && npx playwright test` → 8 passed, 4 skipped, 0 failed.

If any of these fail, fix the cause before merging — do not `.skip()` the failing test as a workaround.

## Scope note (added during execution)

When Task 2's implementer applied the Deal-click deletions, the test still failed — but at a *different* line. The Deal-click hang was masking a downstream race: the Next Hand visibility assertions (lines 47–48) lost the 3-second `SETTLE_PAUSE_MS` window to the Stand loop and `.result-overlay` wait above them. The user authorized extending Task 2 to drop those assertions and replace the manual Next Hand click with a direct `.bet-panel` wait. The spec (`docs/superpowers/specs/2026-06-26-happy-path-e2e-rewrite-design.md`) still describes the original "minimal — just remove the Deal clicks" scope; this plan reflects the extended scope.
# Happy-Path E2E Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `client/e2e/happy-path.spec.ts` pass against the current UI by removing the two stale `button:has-text("Deal")` clicks left over from before commits `691d934` (Deal button removed) and `1046db9` (fast-deal added).

**Architecture:** Test-only change in a single file. No production code touched. After both `bet:place` (round 1) and both `rebet` (round 2) clicks, the server's fast-deal branch broadcasts `dealing` immediately, which surfaces `.action-panel` on the clients within ~2s. The existing `waitForSelector('.action-panel', { timeout: 10_000 })` calls already have headroom to resolve from that broadcast.

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
| `client/e2e/happy-path.spec.ts` | Two-player E2E smoke test for a full round flow with rebet | Modify: delete two lines (32 and 62) |

No other files are touched. The Deal button is not coming back; the bet-deadline auto-advance and fast-deal are the only paths out of `betting`.

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

- [ ] **Step 2: Delete the round-2 Deal click**

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

- [ ] **Step 3: Confirm zero remaining Deal references in the file**

```bash
cd client && grep -n 'Deal' e2e/happy-path.spec.ts
```

Expected: no output (zero matches). The Deal button is gone for good; the test should no longer reference it.

- [ ] **Step 4: Run the rewritten test and confirm it passes**

```bash
cd client && npx playwright test happy-path.spec.ts --reporter=line
```

Expected: 1 passed, 1 skipped. The pass should complete well under the 30s budget (the actual fast-deal + Stand-loop + result-overlay round takes ~10s; round 2 is just Rebet → action-panel).

- [ ] **Step 5: Run the full E2E suite to confirm no regression in adjacent flows**

```bash
cd client && npx playwright test --reporter=line
```

Expected: 8 passed, 4 skipped, 0 failed. The four skipped tests are pre-existing `test.skip()` stubs in `auto-advance.spec.ts` and `happy-path.spec.ts:68` (drop-and-reconnect) — they are not affected by this change.

- [ ] **Step 6: Confirm client unit tests are unaffected**

```bash
cd client && npx vitest run
```

Expected: 26 test files, 128 tests, all pass. Vitest is unrelated to the E2E suite but the sanity check costs ~5s.

- [ ] **Step 7: Commit the rewrite**

```bash
cd client && git add e2e/happy-path.spec.ts
git commit -m "test(e2e): remove stale Deal clicks from happy-path"
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
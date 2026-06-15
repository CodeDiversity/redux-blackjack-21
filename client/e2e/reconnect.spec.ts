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

test('reload during the lobby phase lets the host still click "Begin Betting"', async () => {
  // Regression: after a page reload in the lobby with 2 players, the host
  // used to see "Waiting for host to start..." because selfSeatId was null
  // (the room:resume ack was discarded). Fix: dispatch selfSeatAssigned from
  // the resume callback.
  const browser = await chromium.launch();
  const host = await browser.newContext();
  const guest = await browser.newContext();

  const hostPage = await host.newPage();
  await hostPage.goto('/');
  await hostPage.fill('input[placeholder="Your name"]', 'Alice');
  await hostPage.click('button:has-text("Create Room")');
  await hostPage.waitForURL(/\/room\//);
  const code = hostPage.url().split('/room/')[1];

  const guestPage = await guest.newPage();
  await guestPage.goto('/');
  await guestPage.fill('input[placeholder="Your name"]', 'Bob');
  await guestPage.fill('input[placeholder="Room code"]', code);
  await guestPage.click('button:has-text("Join")');
  await guestPage.waitForURL(/\/room\//);

  // Sanity: host sees the gold "Begin Betting" button before reload.
  await expect(hostPage.locator('button:has-text("Begin Betting")')).toBeEnabled();

  // Reload the host page during the lobby phase.
  await hostPage.reload();
  await hostPage.waitForSelector('text=Alice', { timeout: 10_000 });

  // The host still sees the gold "Begin Betting" button — i.e. the host is
  // recognized as the host after a reload (selfSeatId was restored).
  const beginButton = hostPage.locator('button:has-text("Begin Betting")');
  await expect(beginButton).toBeEnabled();
  await expect(hostPage.locator('text=Waiting for host to start')).toHaveCount(0);

  // And clicking it actually transitions to the betting phase.
  await beginButton.click();
  await hostPage.waitForSelector('.bet-panel', { timeout: 10_000 });

  for (const ctx of [host, guest]) await ctx.close();
  await browser.close();
});

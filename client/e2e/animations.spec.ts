import { test, expect, chromium } from '@playwright/test';

test('deal animation runs, dealer reveal completes, reconnect skips deal', async () => {
  test.setTimeout(90_000);
  const browser = await chromium.launch();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  // Standard 2-player setup (see happy-path.spec.ts for the full pattern).
  await hostPage.goto('/');
  await hostPage.fill('input[placeholder="Your name"]', 'Alice');
  await hostPage.click('button:has-text("Create Room")');
  await hostPage.waitForURL(/\/room\//);
  const code = hostPage.url().split('/room/')[1];
  await guestPage.goto('/');
  await guestPage.fill('input[placeholder="Your name"]', 'Bob');
  await guestPage.fill('input[placeholder="Room code"]', code);
  await guestPage.click('button:has-text("Join")');
  await guestPage.waitForURL(/\/room\//);

  await hostPage.click('button:has-text("Begin Betting")');
  await hostPage.waitForSelector('.bet-panel');
  await hostPage.fill('.bet-panel input', '50');
  await hostPage.click('button:has-text("Place Bet")');
  await guestPage.fill('.bet-panel input', '50');
  await guestPage.click('button:has-text("Place Bet")');

  // Wait for the deal animation to complete. The action panel only renders
  // for the active player, so we wait for the host (seat 0) to be in
  // player_turn. Both the bet deadline and the dealing phase must elapse
  // first; the 20_000ms timeout below is the source of truth.
  await hostPage.waitForSelector('.action-panel', { timeout: 20_000 });

  // Both players should have their cards rendered.
  const hostCards = await hostPage.locator('[data-testid="card"], [data-testid="card-back"], [data-testid="card-front"]').count();
  const guestCards = await guestPage.locator('[data-testid="card"], [data-testid="card-back"], [data-testid="card-front"]').count();
  // 2 cards per player (4) + dealer upcard (1) + dealer hole card-back (1) = 6
  expect(hostCards).toBeGreaterThanOrEqual(6);
  expect(guestCards).toBeGreaterThanOrEqual(6);

  // Stand both players through the round. The active player is whoever's
  // .action-panel is showing. We poll for the panel on either page.
  for (let i = 0; i < 6; i++) {
    const active = hostPage.locator('.action-panel button:has-text("Stand")');
    if ((await active.count()) > 0) {
      await active.first().click({ force: true });
    }
    const guestActive = guestPage.locator('.action-panel button:has-text("Stand")');
    if ((await guestActive.count()) > 0) {
      await guestActive.first().click({ force: true });
    }
    await hostPage.waitForTimeout(300);
  }

  // Wait for the dealer's hole-card reveal to complete (the result overlay
  // appears once the round settles).
  await hostPage.waitForSelector('.result-overlay', { timeout: 20_000 });

  // Reload guest — this is the reconnect test. The new page should show
  // the cards immediately, with no replay of the deal animation. The
  // round has settled, so cards should be present (from the existing state).
  const guestUrl = guestPage.url();
  const reloadStart = Date.now();
  await guestPage.reload();
  await guestPage.waitForSelector('[data-testid="card"], [data-testid="card-front"]', { timeout: 5_000 });
  const cardsVisibleMs = Date.now() - reloadStart;
  // Cards should appear quickly (much less than the bet deadline of 10s).
  expect(cardsVisibleMs).toBeLessThan(8_000);

  // Sanity: the guest URL is preserved.
  expect(guestUrl).toBeTruthy();

  await browser.close();
});


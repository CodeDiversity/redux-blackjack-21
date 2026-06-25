import { test, expect, chromium } from '@playwright/test';

const URL = 'http://localhost:5173';

test.describe('fast deal on all bets placed', () => {
  test('solo host: dealing starts within 2s of Place Bet (no 10s wait)', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto(URL);
    await page.fill('input[placeholder="Your name"]', 'Alice');
    await page.click('button:has-text("Create Room")');
    await page.waitForURL(/\/room\//);

    await page.click('button:has-text("Begin Betting")');
    await page.waitForSelector('.bet-panel');

    const betTime = Date.now();
    await page.fill('.bet-panel input', '50');
    await page.click('button:has-text("Place Bet")');

    // The action panel appears when phase reaches 'player_turn', which is
    // after the 2s 'dealing' phase ends. If early-deal is wired, this
    // happens at ~2s. If it isn't, the full path takes BET_DEADLINE_MS (10s)
    // + DEALING_DURATION_MS (2s) ≈ 12s, which is well over the 5s budget.
    await page.waitForSelector('.action-panel', { timeout: 5_000 });
    const elapsed = Date.now() - betTime;
    expect(elapsed).toBeLessThan(5_000);

    await browser.close();
  });

  test('two players: dealing starts within 2s of the second player betting', async () => {
    const browser = await chromium.launch();
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    const guestPage = await guestCtx.newPage();

    await hostPage.goto(URL);
    await hostPage.fill('input[placeholder="Your name"]', 'Alice');
    await hostPage.click('button:has-text("Create Room")');
    await hostPage.waitForURL(/\/room\//);
    const roomUrl = hostPage.url();
    const code = roomUrl.split('/room/')[1];

    await guestPage.goto(URL);
    await guestPage.fill('input[placeholder="Your name"]', 'Bob');
    await guestPage.fill('input[placeholder="Room code"]', code);
    await guestPage.click('button:has-text("Join")');
    await guestPage.waitForURL(/\/room\//);

    await hostPage.click('button:has-text("Begin Betting")');
    await hostPage.waitForSelector('.bet-panel');

    // First bet — phase must still be betting.
    await hostPage.fill('.bet-panel input', '50');
    await hostPage.click('button:has-text("Place Bet")');
    await expect(hostPage.locator('.bet-panel')).toBeVisible();

    // Second bet — dealing should fire promptly.
    const lastBetTime = Date.now();
    await guestPage.fill('.bet-panel input', '50');
    await guestPage.click('button:has-text("Place Bet")');

    await hostPage.waitForSelector('.action-panel', { timeout: 5_000 });
    const elapsed = Date.now() - lastBetTime;
    expect(elapsed).toBeLessThan(5_000);

    await browser.close();
  });
});
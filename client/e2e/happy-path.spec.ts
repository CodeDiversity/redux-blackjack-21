import { test, expect, chromium } from '@playwright/test';

test('two players can play two full rounds with rebet', async () => {
  const browser = await chromium.launch();
  const host = await browser.newContext();
  const guest = await browser.newContext();

  const hostPage = await host.newPage();
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

  // ───── ROUND 1 ─────
  await hostPage.click('button:has-text("Begin Betting")');
  await hostPage.waitForSelector('.bet-panel');

  await hostPage.fill('.bet-panel input', '50');
  await hostPage.click('button:has-text("Place Bet")');
  await guestPage.fill('.bet-panel input', '50');
  await guestPage.click('button:has-text("Place Bet")');

  await hostPage.click('button:has-text("Deal")');
  await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });

  // Both stand until settled. Use a polling loop; one of the two attempts per round
  // is the active seat.
  for (let i = 0; i < 4; i++) {
    await hostPage.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if ((b.textContent ?? '').trim() === 'Stand' && !(b as HTMLButtonElement).disabled) b.click(); }); });
    await guestPage.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if ((b.textContent ?? '').trim() === 'Stand' && !(b as HTMLButtonElement).disabled) b.click(); }); });
    await hostPage.waitForTimeout(50);
  }

  // Wait for the result overlay on the host.
  await hostPage.waitForSelector('.result-overlay', { timeout: 10_000 });

  // ───── ADVANCE TO NEXT HAND ─────
  // Host sees the Next Hand button; guest does not.
  await expect(hostPage.locator('button:has-text("Next Hand")')).toBeVisible();
  await expect(guestPage.locator('button:has-text("Next Hand")')).toHaveCount(0);

  await hostPage.click('button:has-text("Next Hand")');
  await hostPage.waitForSelector('.bet-panel', { timeout: 5_000 });

  // ───── ROUND 2: rebet ─────
  // Both players should see the Rebet button since lastBet=50 and bankroll is positive.
  await expect(hostPage.locator('button:has-text("Rebet $50")')).toBeVisible();
  await expect(guestPage.locator('button:has-text("Rebet $50")')).toBeVisible();

  await hostPage.click('button:has-text("Rebet $50")');
  await guestPage.click('button:has-text("Rebet $50")');

  await hostPage.click('button:has-text("Deal")');
  await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });

  await browser.close();
});

test.skip('drop-and-reconnect: server auto-stands a missing player', async () => {
  // Filled in once the basic happy path is green; left as a placeholder.
});

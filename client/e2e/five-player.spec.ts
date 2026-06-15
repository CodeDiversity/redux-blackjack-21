import { test, expect, chromium } from '@playwright/test';

test('5-seat lobby and table render correctly', async () => {
  const browser = await chromium.launch();
  const host = await browser.newContext();
  const guest = await browser.newContext();

  // Host creates a 5-seat room.
  const hostPage = await host.newPage();
  await hostPage.goto('/');
  await hostPage.fill('input[placeholder="Your name"]', 'Alice');
  await hostPage.click('button:has-text("Create Room")');
  await hostPage.waitForURL(/\/room\//);
  const roomUrl = hostPage.url();
  const code = roomUrl.split('/room/')[1];

  // Guest joins.
  const guestPage = await guest.newPage();
  await guestPage.goto('/');
  await guestPage.fill('input[placeholder="Your name"]', 'Bob');
  await guestPage.fill('input[placeholder="Room code"]', code);
  await guestPage.click('button:has-text("Join")');
  await guestPage.waitForURL(/\/room\//);

  // Both should see 5 seat cards in the lobby (3 empty + 2 seated).
  await hostPage.waitForSelector('[aria-label^="seat-"]');
  const hostSeats = await hostPage.$$eval(
    '[aria-label^="seat-"], [aria-label="empty-seat"]',
    (els) => els.length,
  );
  expect(hostSeats).toBe(5);

  await guestPage.waitForSelector('[aria-label^="seat-"]');
  const guestSeats = await guestPage.$$eval(
    '[aria-label^="seat-"], [aria-label="empty-seat"]',
    (els) => els.length,
  );
  expect(guestSeats).toBe(5);

  // Host starts the round.
  await hostPage.click('button:has-text("Begin Betting")');
  await hostPage.waitForSelector('.bet-panel', { timeout: 10_000 });

  // Table should render 5 seat tiles (3 ghosted + 2 real).
  await hostPage.waitForSelector('[aria-label="empty-seat"]');
  const tableTiles = await hostPage.$$eval(
    '[aria-label^="seat-"], [aria-label="empty-seat"]',
    (els) => els.length,
  );
  expect(tableTiles).toBe(5);

  for (const ctx of [host, guest]) await ctx.close();
  await browser.close();
});

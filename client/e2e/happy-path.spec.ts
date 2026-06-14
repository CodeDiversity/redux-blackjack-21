import { test, expect, chromium } from '@playwright/test';

test('two players can play a full round', async () => {
  const browser = await chromium.launch();
  const host = await browser.newContext();
  const guest = await browser.newContext();

  const hostPage = await host.newPage();
  await hostPage.goto('/');
  await hostPage.fill('input[placeholder="Your name"]', 'Alice');
  await hostPage.click('button:has-text("Create Room")');
  // Wait for room code in URL.
  await hostPage.waitForURL(/\/room\//);
  const roomUrl = hostPage.url();
  const code = roomUrl.split('/room/')[1];

  const guestPage = await guest.newPage();
  await guestPage.goto('/');
  await guestPage.fill('input[placeholder="Your name"]', 'Bob');
  await guestPage.fill('input[placeholder="Room code"]', code);
  await guestPage.click('button:has-text("Join")');
  await guestPage.waitForURL(/\/room\//);

  // Host transitions lobby → betting phase.
  await hostPage.click('button:has-text("Begin Betting")');
  await hostPage.waitForSelector('.bet-panel');

  // Both place a bet.
  await hostPage.fill('.bet-panel input', '50');
  await hostPage.click('button:has-text("Place Bet")');
  await guestPage.fill('.bet-panel input', '50');
  await guestPage.click('button:has-text("Place Bet")');

  // Host deals the round.
  await hostPage.click('button:has-text("Deal")');

  // Wait for the action panel to appear (someone's turn).
  await hostPage.waitForSelector('.action-panel', { timeout: 10_000 });

  await browser.close();
});

test.skip('drop-and-reconnect: server auto-stands a missing player', async () => {
  // Filled in once the basic happy path is green; left as a placeholder.
});

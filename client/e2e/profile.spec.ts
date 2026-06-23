import { test, expect, chromium } from '@playwright/test';

test('two players can play a hand and see it in the profile modal', async () => {
  const browser = await chromium.launch();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto('/');
  await host.fill('input[placeholder="Your name"]', 'Alice');
  await host.click('button:has-text("Create Room")');
  await host.waitForURL(/\/room\//);
  const code = host.url().split('/room/')[1];

  await guest.goto('/');
  await guest.fill('input[placeholder="Your name"]', 'Bob');
  await guest.fill('input[placeholder="Room code"]', code);
  await guest.click('button:has-text("Join")');
  await guest.waitForURL(/\/room\//);

  // Round 1: bet + (auto-advance) deal + stand
  await host.click('button:has-text("Begin Betting")');
  await host.waitForSelector('.bet-panel');
  await host.fill('.bet-panel input', '50');
  await host.click('button:has-text("Place Bet")');
  await guest.fill('.bet-panel input', '50');
  await guest.click('button:has-text("Place Bet")');
  // No Deal button in the current build: the bet deadline auto-advances the
  // round into the dealing phase.
  await host.waitForSelector('.action-panel', { timeout: 20_000 });

  for (let i = 0; i < 4; i++) {
    await host.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => {
        if ((b.textContent ?? '').trim() === 'Stand' && !(b as HTMLButtonElement).disabled) b.click();
      });
    });
    await guest.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => {
        if ((b.textContent ?? '').trim() === 'Stand' && !(b as HTMLButtonElement).disabled) b.click();
      });
    });
    await host.waitForTimeout(50);
  }
  await host.waitForSelector('.result-overlay', { timeout: 20_000 });

  // Open the profile modal on the host.
  await host.click('button[aria-label="Open your profile"]');
  await host.waitForSelector('[role="dialog"]');
  // Wait for the profile fetch to populate the history list.
  await host.waitForSelector('[role="dialog"] [role="listitem"]', { timeout: 5_000 });

  // History tab: 1 hand
  expect(await host.locator('[role="dialog"] [role="listitem"]').count()).toBe(1);

  // Switch to Stats tab and assert headline values are present.
  await host.click('[role="dialog"] [role="tab"]:has-text("Stats")');
  expect(await host.locator('[role="dialog"]').getByText('Headline').count()).toBe(1);
  expect(await host.locator('[role="dialog"]').getByText('Achievements').count()).toBe(1);

  await host.screenshot({ path: 'client/test-results/profile-stats.png', fullPage: true });

  // Close the modal.
  await host.click('button[aria-label="Close profile"]');
  await expect(host.locator('[role="dialog"]')).toHaveCount(0);

  // Open again on the guest — guest should also see the 1 hand.
  await guest.click('button[aria-label="Open your profile"]');
  await guest.waitForSelector('[role="dialog"]');
  await guest.waitForSelector('[role="dialog"] [role="listitem"]', { timeout: 5_000 });
  expect(await guest.locator('[role="dialog"] [role="listitem"]').count()).toBe(1);

  await browser.close();
}, 60_000);

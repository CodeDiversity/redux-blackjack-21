import { test, expect } from '@playwright/test';

const URL = 'http://localhost:5173';
const SERVER_URL = 'http://localhost:3001';

test.describe('auto-advance rounds and bet deadline', () => {
  test.beforeEach(async ({ page }) => {
    // Each test gets a fresh state.
  });

  test('3s settle-pause: round auto-advances after the result overlay', async ({ browser }) => {
    // Two-player flow: create, join, both bet, deal, both stand, settle,
    // wait 3s, expect the bet panel.
    // Implementation depends on the existing happy-path helpers.
    // For now, the test stub below is the minimum; flesh out the
    // connection + bet flows to match the existing e2e tests.
    test.skip();  // remove .skip() once the helpers are wired
  });

  test('10s bet deadline with ≥1 bet: non-betters are sat out', async ({ browser }) => {
    test.skip();
  });

  test('10s bet deadline with 0 bets: re-loops the betting window', async ({ browser }) => {
    test.skip();
  });
});

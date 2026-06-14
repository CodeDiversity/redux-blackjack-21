import { defineConfig } from '@playwright/test';

// Config lives at client/playwright.config.ts (the workspace root) so that
// `npx playwright test` from the client/ cwd auto-discovers it. If it lived
// in client/e2e/, Playwright's config auto-discovery (which only checks the
// cwd and ancestors) would miss it; the default testDir of ./ would then
// pick up client/test/**/*.spec.ts, and those files import vitest directly,
// triggering "Vitest failed to access its internal state" at worker startup.
export default defineConfig({
  testDir: './e2e',
  webServer: [
    {
      command: 'npm run dev -w server',
      port: 3001,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -w client',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
  use: { baseURL: 'http://localhost:5173', headless: true },
});

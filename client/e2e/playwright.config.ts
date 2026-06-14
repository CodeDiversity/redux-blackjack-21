import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
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

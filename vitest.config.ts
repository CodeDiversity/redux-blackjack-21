import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Root-level vitest config so `npx vitest` works from the project root.
// All vitest specs live in `client/test/`. The `client/vite.config.ts` is the
// authoritative config (used when running from `client/`); this one mirrors
// the relevant test settings to make root-level invocations work.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./client/test/setup.ts'],
    include: ['client/test/**/*.spec.{ts,tsx}'],
    exclude: ['client/e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});

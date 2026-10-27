import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PA_E2E_PORT ?? 4391);
// Locally the installed Chrome is used (no browser download); CI installs Chromium (`npx playwright install --with-deps chromium`).
const channel = process.env.PA_E2E_CHANNEL ?? (process.env.CI ? undefined : 'chrome');

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...(channel ? { channel } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    // Serves the bundle built by `npm run build -w pixelagents` over fixtures/claude-code.v1.jsonl.
    command: `node test/e2e/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

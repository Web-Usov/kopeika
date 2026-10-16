import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);
const dbPath = join(tmpdir(), `kopeika-e2e-${process.pid}-${Date.now()}.db`);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    viewport: { width: 375, height: 812 },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'npm run build && node server/dist/index.js',
    url: `http://localhost:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DEV_AUTH: '1', BOT_POLLING: '0', PORT: String(port), DB_PATH: dbPath },
  },
});

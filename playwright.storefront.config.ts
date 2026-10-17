import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Only the store-preview screenshot generator (e2e/storefront.spec.ts); see docs/storefront.md.
const port = Number(process.env.STOREFRONT_PORT ?? 3101);
const dbPath = join(tmpdir(), `kopeika-storefront-${process.pid}-${Date.now()}.db`);

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'storefront.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${port}` },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'npm run build && node server/dist/index.js',
    url: `http://localhost:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DEV_AUTH: '1', BOT_POLLING: '0', PORT: String(port), DB_PATH: dbPath },
  },
});

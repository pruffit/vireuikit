import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/lab',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5179',
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.003, animations: 'disabled' } },
  webServer: {
    command: 'npm run lab',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

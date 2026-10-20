import { defineConfig } from '@playwright/test';

// The frame gate: a headed Chromium with the GPU on. Headless Chromium and software rendering hid the very problem
// this gate exists for, so nothing here runs without a window. Local only, like the visual set.
export default defineConfig({
  testDir: 'tests/lab',
  testMatch: 'perf.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:5179',
    headless: false,
    viewport: { width: 1500, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    launchOptions: {
      args: [
        '--enable-gpu-rasterization',
        '--ignore-gpu-blocklist',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-background-timer-throttling',
      ],
    },
  },
  webServer: {
    command: 'npm run lab',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

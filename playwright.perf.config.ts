import { defineConfig } from '@playwright/test';

const PORT = process.env.VIREUIKIT_LAB_PORT ?? '5180';

// The frame gate: a headed Chromium with the GPU on. Headless Chromium and software rendering hid the very problem
// this gate exists for, so nothing here runs without a window. Local only, like the visual set.
export default defineConfig({
  testDir: 'tests/lab',
  testMatch: 'perf.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
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
  // Its own lab, with reloading off: a dev server that reloads on every save loaded the page mid-replay, and a save
  // that left the tree broken kept the page from ever booting (docs/design.md, "The frame gate").
  webServer: {
    command: 'npm run lab',
    url: `http://127.0.0.1:${PORT}`,
    env: { ...(process.env as Record<string, string>), VIREUIKIT_LAB_PORT: PORT, VIREUIKIT_LAB_STILL: '1' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

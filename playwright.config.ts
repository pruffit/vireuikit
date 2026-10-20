import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/lab',
  testIgnore: 'perf.spec.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${process.env.VIREUIKIT_LAB_PORT ?? 5179}`,
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
  // The default colour threshold (0.2) let a whole resting body through; 0.02 sees it, and the render is stable at it.
  expect: { toHaveScreenshot: { threshold: 0.02, maxDiffPixelRatio: 0.0005, animations: 'disabled' } },
  webServer: {
    command: 'npm run lab',
    url: `http://127.0.0.1:${process.env.VIREUIKIT_LAB_PORT ?? 5179}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

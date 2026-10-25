import { defineConfig } from '@playwright/test';

const PORT = process.env.VIREUIKIT_LAB_PORT ?? '5180';

// Headless on purpose: the recorder reads the compositor's frames through the screencast, and software rendering
// (SwiftShader) presents the same pixels on every run, which is what a gate on pixels needs.
export default defineConfig({
  testDir: 'tests/lab/scenarios',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/scenarios',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['./tests/lab/scenarios/summary-reporter.ts']],
  timeout: 180_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
  webServer: {
    command: `node scripts/check-port-free.mjs ${PORT} && node scripts/serve-lab-build.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    env: { ...(process.env as Record<string, string>), VIREUIKIT_LAB_PORT: PORT, VIREUIKIT_LAB_STILL: '1' },
    reuseExistingServer: process.env.VIREUIKIT_LAB_REUSE === '1',
    timeout: 120_000,
  },
});

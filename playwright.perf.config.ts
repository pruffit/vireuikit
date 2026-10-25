import { defineConfig } from '@playwright/test';

const PORT = process.env.VIREUIKIT_LAB_PORT ?? '5180';

// Headed with the GPU on: headless and software rendering hid the very problem this gate exists for.
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
        '--enable-gpu-service-tracing',
      ],
    },
  },
  // Its own lab, built once and served as built: a save must not reach the page being timed, and a page load is a few
  // requests, not one per module (the dev server's hundreds exhausted the socket buffers of Windows).
  webServer: {
    command: `node scripts/check-port-free.mjs ${PORT} && node scripts/serve-lab-build.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    env: { ...(process.env as Record<string, string>), VIREUIKIT_LAB_PORT: PORT, VIREUIKIT_LAB_STILL: '1' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

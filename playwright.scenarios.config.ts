import { defineConfig } from '@playwright/test';

const PORT = process.env.VIREUIKIT_LAB_PORT ?? '5180';

// Both projects are headless, so nothing opens on the desktop and nothing takes focus. `gpu` renders on the machine's
// adapter through ANGLE/D3D11 (the recorder fails the run if the adapter is a software one) and is the one that judges;
// `swiftshader` renders in software, the same pixels every run, and is the control.
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

// Headless Playwright hides scrollbars by default; the owner's browser shows them, and so must the recording.
const SHOW_SCROLLBARS = ['--hide-scrollbars'];

export default defineConfig({
  testDir: 'tests/lab/scenarios',
  outputDir: 'test-results/scenarios',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['./tests/lab/scenarios/summary-reporter.ts']],
  timeout: 240_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
  projects: [
    { name: 'gpu', testMatch: ['gpu.spec.ts', 'canaries.spec.ts', 'handover.spec.ts'], use: { launchOptions: { args: GPU_ARGS, ignoreDefaultArgs: SHOW_SCROLLBARS } } },
    { name: 'swiftshader', testMatch: ['swiftshader.spec.ts', 'canaries.spec.ts'], use: { launchOptions: { ignoreDefaultArgs: SHOW_SCROLLBARS } } },
  ],
  webServer: {
    command: `node scripts/check-port-free.mjs ${PORT} && node scripts/serve-lab-build.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    env: { ...(process.env as Record<string, string>), VIREUIKIT_LAB_PORT: PORT, VIREUIKIT_LAB_STILL: '1' },
    reuseExistingServer: process.env.VIREUIKIT_LAB_REUSE === '1',
    timeout: 120_000,
  },
});

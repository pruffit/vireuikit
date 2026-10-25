#!/usr/bin/env node
// The perf gate's lab: a build of lab/ made once at start and served as it is. The dev server hands the browser every
// module as its own request, and a gate of ~150 page loads exhausted the socket buffers of Windows
// (net::ERR_NO_BUFFER_SPACE); a built page is a handful of requests, and the tree cannot change under a run.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.VIREUIKIT_LAB_PORT ?? 5180);
const outDir = join(tmpdir(), 'vireuikit-lab-build', String(port));
mkdirSync(outDir, { recursive: true });

const configFile = join(ROOT, 'lab', 'vite.config.ts');
// Unminified and untranspiled, as the dev server serves it, so a trace still names the kit's functions.
await build({
  configFile,
  logLevel: 'error',
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    target: 'esnext',
    rollupOptions: { input: ['index.html', 'early.html', 'early-menu.html'].map((name) => join(ROOT, 'lab', name)) },
  },
});

const server = await preview({ configFile, logLevel: 'info', build: { outDir }, preview: { port, strictPort: true, host: '127.0.0.1' } });
server.printUrls();

#!/usr/bin/env node
// The menu parity gate needs the reference frames, which are third-party and never committed: it runs where they are.
import { spawnSync } from 'node:child_process';

if (!process.env.VIREUIKIT_REFERENCE_DIR) {
  console.log('check:lab:reference skipped: VIREUIKIT_REFERENCE_DIR is not set (the reference frames are local-only).');
  process.exit(0);
}
const run = spawnSync('npx', ['playwright', 'test', 'parity'], { stdio: 'inherit', shell: true });
process.exit(run.status ?? 1);

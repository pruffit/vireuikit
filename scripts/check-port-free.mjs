#!/usr/bin/env node
// The perf gate starts its own lab and never reuses one: a stale server on its port should be named, not left to Playwright's generic "port in use".
import { createServer } from 'node:net';

const port = Number(process.argv[2]);
const server = createServer();
server.once('error', (error) => {
  console.error(
    `Port ${port} is already in use (${(/** @type {NodeJS.ErrnoException} */ (error)).code}), so the perf gate cannot start its own lab there.\n` +
      `Find the owner: Get-NetTCPConnection -LocalPort ${port} -State Listen  (Windows), or lsof -i :${port}.\n` +
      'Stop it if it is yours, or run with another port: VIREUIKIT_LAB_PORT=<port>.',
  );
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => server.close());

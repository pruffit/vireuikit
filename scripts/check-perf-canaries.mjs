#!/usr/bin/env node
// A gate that cannot fail is not a gate: each canary puts a known cost into one row of the frame gate, and the gate has to
// fail on it by the rule the canary is made to break. Local only, like the gate itself: it needs a headed Chromium with a GPU.
import { spawnSync } from 'node:child_process';

const ROW = process.env.VIREUIKIT_PERF_CANARY_ROW ?? 'menu growth';
const KINDS = ['fixed', 'random', 'foreign', 'short', 'gpu', 'compile'];
const results = [];

for (const kind of KINDS) {
  console.log(`\n== ${kind} canary on "${ROW}" ==`);
  const run = spawnSync('npx', ['playwright', 'test', '--config', 'playwright.perf.config.ts', '-g', `"${ROW}"`], {
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, VIREUIKIT_PERF_CANARY: `${kind}:${ROW}` },
  });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const line = out.split('\n').find((l) => l.startsWith('CANARY '));
  const rules = out.split('\n').find((l) => l.startsWith('rules broken:'));
  const failed = run.status !== 0;
  const ok = failed && line !== undefined && line.endsWith(': ok');
  results.push({ kind, ok });
  console.log(`${line ?? 'no CANARY line: the gate did not get as far as judging'}\n${rules ?? ''}\n${ok ? 'ok: failed by its rule' : failed ? 'WRONG: failed, but not by its rule' : 'WRONG: the gate passed'}`);
  if (!ok) console.log(out.split('\n').filter((l) => /counted:|excused:|main-thread task|compiled|no trace|Error/.test(l)).slice(0, 12).join('\n'));
}

console.log(`\n${results.map((r) => `${r.kind}: ${r.ok ? 'ok' : 'WRONG'}`).join(', ')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

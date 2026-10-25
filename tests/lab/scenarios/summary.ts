import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateName } from './gates';
import type { Outcome } from './run';

const GATES: GateName[] = ['seam', 'vanish', 'shape', 'state', 'ghost'];

function cell(out: Outcome, gate: GateName): string {
  const rs = out.results.filter((r) => r.gate === gate);
  if (rs.length === 0) return '-';
  const fails = rs.filter((r) => r.verdict === 'fail');
  if (fails.length === 0) return rs.every((r) => r.verdict === 'skip') ? 'skip' : 'pass';
  const known = out.known[gate];
  return `FAIL${fails.length > 1 ? ` x${fails.length}` : ''}${known ? ` (${known})` : ''}`;
}

export function table(outcomes: Outcome[]): string {
  const rows = outcomes.map((o) => [o.name, String(o.frames), ...GATES.map((g) => cell(o, g))]);
  const head = ['scenario', 'frames', ...GATES];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/** The outcomes written since `since` (ms): a failed test restarts the worker, so the run's results are on disk, not in memory. */
export function collect(dir: string, since: number): Outcome[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name, 'outcome.json'))
    .filter((file) => existsSync(file) && statSync(file).mtimeMs >= since)
    .map((file) => ({ file, mtime: statSync(file).mtimeMs, out: JSON.parse(readFileSync(file, 'utf8')) as Outcome }))
    .sort((a, b) => a.mtime - b.mtime)
    .map((e) => e.out);
}

export function writeSummary(dir: string, outcomes: Outcome[]): string {
  const text = table(outcomes);
  writeFileSync(join(dir, 'summary.txt'), `${text}\n`);
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(outcomes, null, 1));
  return text;
}

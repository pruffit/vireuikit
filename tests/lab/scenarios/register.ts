import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertAdapter, type Project } from './adapter';
import { OUT_DIR } from './report';
import { play, type Outcome } from './run';
import { scenariosFor } from './scenarios';

// `npm run check:lab:scenarios`. What it records and judges: docs/design.md, "Scenario recordings".
// A gate that fails on a finding the acceptance issue names carries a label in `known`: it is reported as such and does
// not fail the run, and goes red the day it passes (the label must go). VIREUIKIT_SCENARIOS_STRICT=1 fails on those too.
const STRICT = process.env.VIREUIKIT_SCENARIOS_STRICT === '1';
// A gate near its limit passes or fails from one run to the next on the GPU, so a label that passes once is reported, and fails the run only with VIREUIKIT_SCENARIOS_STALE=1.
const STALE = process.env.VIREUIKIT_SCENARIOS_STALE === '1';
const only = new RegExp(process.env.VIREUIKIT_SCENARIOS_ONLY ?? '.');

export function registerScenarios(project: Project): void {
  const dir = join(OUT_DIR, project);
  test.beforeAll(async ({ browser }) => {
    const adapter = await assertAdapter(browser, project, dir);
    console.log(`  ${project} renders with ${adapter.renderer}`);
  });
  for (const sc of scenariosFor(project).filter((s) => only.test(s.name))) {
    test(sc.name, async ({ browser, baseURL }) => {
      const sheet = await browser.newPage();
      let out: Outcome;
      try {
        out = await play(browser, baseURL!, sc, sheet, dir, sc.profile ?? project);
      } finally {
        await sheet.close();
      }
      const problems: string[] = [];
      for (const r of out.results) {
        const known = out.known[r.gate];
        if (r.verdict === 'fail' && (!known || STRICT)) problems.push(`${r.gate} fails${known ? ` (known: ${known})` : ''}: ${r.line}`);
      }
      for (const [gate, label] of Object.entries(out.known)) {
        const rs = out.results.filter((r) => r.gate === gate);
        if (rs.length === 0 || !rs.every((r) => r.verdict === 'pass')) continue;
        const stale = `${gate} passes now, so its known label "${label}" may be stale: remove it from known.ts if it passes on every run`;
        if (STALE) problems.push(stale);
        else console.log(`  ${stale}`);
      }
      for (const e of out.pageErrors) problems.push(`page error: ${e}`);
      for (const r of out.results) console.log(`  ${r.gate} ${r.verdict}: ${r.line}`);
      console.log(`  contact sheet: ${out.sheet}`);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
}

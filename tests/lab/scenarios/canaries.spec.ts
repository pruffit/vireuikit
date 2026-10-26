import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CANARIES } from './canaries';
import type { Project } from './adapter';
import { OUT_DIR } from './report';
import { play } from './run';

// What the scenario gates see, proved on pages made to break them: the defect must fail its gate and the same page without it must pass.
for (const canary of CANARIES) {
  for (const [kind, scenario, want] of [['defect', canary.bad, 'fail'], ['clean', canary.clean, 'pass']] as const) {
    test(`${canary.gate} gate: ${kind} (${canary.defect})`, async ({ browser, baseURL }, testInfo) => {
      const sheet = await browser.newPage();
      try {
        const out = await play(browser, baseURL!, scenario, sheet, join(OUT_DIR, testInfo.project.name), testInfo.project.name as Project);
        const result = out.results.find((r) => r.gate === canary.gate);
        expect(result, `${scenario.name} produced no ${canary.gate} verdict`).toBeDefined();
        console.log(`  ${scenario.name}: ${result!.verdict} — ${result!.line}`);
        expect(result!.verdict, `${scenario.name}: ${result!.line}`).toBe(want);
      } finally {
        await sheet.close();
      }
    });
  }
}

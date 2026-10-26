import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter } from '@playwright/test/reporter';
import { OUT_DIR } from './report';
import { collect, writeSummary } from './summary';

/** Prints the table of the scenarios this run recorded, per project, and writes it beside the recordings. */
export default class SummaryReporter implements Reporter {
  #start = 0;
  onBegin(): void {
    this.#start = Date.now();
  }
  onEnd(): void {
    if (!existsSync(OUT_DIR)) return;
    for (const project of readdirSync(OUT_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const dir = join(OUT_DIR, project.name);
      const outcomes = collect(dir, this.#start);
      if (outcomes.length === 0) continue;
      console.log(`\n${project.name}\n${writeSummary(dir, outcomes)}\n\nrecordings: ${dir}`);
    }
  }
}

import type { Reporter } from '@playwright/test/reporter';
import { OUT_DIR } from './report';
import { collect, writeSummary } from './summary';

/** Prints the table of the scenarios this run recorded, and writes it beside the recordings. */
export default class SummaryReporter implements Reporter {
  #start = 0;
  onBegin(): void {
    this.#start = Date.now();
  }
  onEnd(): void {
    const outcomes = collect(OUT_DIR, this.#start);
    if (outcomes.length === 0) return;
    console.log(`\n${writeSummary(OUT_DIR, outcomes)}\n\nrecordings: ${OUT_DIR}`);
  }
}

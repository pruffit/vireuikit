import { expect, test } from '@playwright/test';
import { TRANSITIONS, recordTransition, workReport, type Recording } from './transitions';

// The motion gate (docs/acceptance.md, MO1 to MO3). A glass element that changes shape over frames must not make the
// core probe the backdrop, bake a map or swap a filter on any frame of the change: it holds its lens in interim and
// bakes once when it lands. The counters are the core's own (`renderStats`), so this holds on any machine, headless or
// not; how the frames then run is `check:lab:perf`'s question.

/** What a recording says is wrong, as a list; empty is a pass. */
function violations(rec: Recording, hosted: boolean): string[] {
  const { during, landed } = workReport(rec);
  const out: string[] = [];
  if (rec.active.filter(Boolean).length < 6) out.push(`the transition ran for ${rec.active.filter(Boolean).length} frames`);
  if (rec.surfaces === 0) out.push('no glass surface was attached');
  // A surface the transition creates has its first bake, and only that, on the way.
  if (during.fullBakes > 2 * rec.created) out.push(`${during.fullBakes} full bakes while it ran, ${rec.created} surfaces created`);
  if (during.filterSwaps > rec.created) out.push(`${during.filterSwaps} filter swaps while it ran, ${rec.created} surfaces created`);
  if (during.probes > (hosted ? 0 : rec.created)) out.push(`${during.probes} probes while it ran, ${rec.created} surfaces created`);
  if (hosted && landed.probes > 0) out.push(`${landed.probes} probes with the backdrop handed over`);
  // Landing: one probe and two maps (displacement and spectral) per surface, on top of a created surface's first bake.
  if (landed.probes > rec.surfaces + rec.created) out.push(`${landed.probes} probes for ${rec.surfaces} surfaces`);
  if (landed.fullBakes > 2 * (rec.surfaces + rec.created)) out.push(`${landed.fullBakes} full bakes for ${rec.surfaces} surfaces`);
  return out;
}

for (const transition of TRANSITIONS) {
  test(`${transition.name}: no probe, bake or filter swap on any frame, one landing`, async ({ page }) => {
    const rec = await recordTransition(page, transition, '1', { query: 'backdrop=photo' });
    expect(violations(rec, true)).toEqual([]);
  });

  test(`${transition.name}: the same when the host does not hand over the backdrop`, async ({ page }) => {
    const rec = await recordTransition(page, transition, '1', { query: 'backdrop=photo&sample=0' });
    expect(violations(rec, false)).toEqual([]);
  });
}

test.describe('the canary', () => {
  test('a navigation body that ignores interim fails the gate', async ({ page }) => {
    const morph = TRANSITIONS.find((t) => t.name === 'navigation morph, bar to rail')!;
    const rec = await recordTransition(page, morph, '1', {
      afterOpen: async (p) => void (await p.evaluate(() => (window.__labNoInterim = 'vire-nav > nav'))),
    });
    expect(violations(rec, true).join('\n')).toMatch(/full bakes while it ran/);
  });

  test('a menu that ignores interim fails the gate', async ({ page }) => {
    const growth = TRANSITIONS.find((t) => t.name === 'menu growth')!;
    const rec = await recordTransition(page, growth, '1', {
      afterOpen: async (p) => void (await p.evaluate(() => (window.__labNoInterim = 'vire-menu > [popover]'))),
    });
    expect(violations(rec, true).join('\n')).toMatch(/full bakes while it ran/);
  });
});

import { expect, test, type Page } from '@playwright/test';
import { openCase } from './helpers';
import { TRANSITIONS, drag, lensStates, recordTransition, workReport, type Recording, type Transition } from './transitions';

// The motion gate (docs/acceptance.md, MO1 to MO3). A glass element that changes shape over frames must not make the
// core probe the backdrop, bake a map or swap a filter on any frame of the change: it holds its lens in interim and
// bakes once when it lands. The counters are the core's own (`renderStats`), so this holds on any machine, headless or
// not; how the frames then run is `check:lab:perf`'s question. The upper bounds alone would pass a lens that never
// lands, so the gate also asks that every lens which entered interim has left it, and that a landing baked.

/** What a recording says is wrong, as a list; empty is a pass. */
function violations(rec: Recording, transition: Transition, hosted: boolean): string[] {
  const { during, landed } = workReport(rec);
  const out: string[] = [];
  if (rec.active.filter(Boolean).length < 6) out.push(`the transition ran for ${rec.active.filter(Boolean).length} frames`);
  if (rec.surfaces === 0) out.push('no glass surface was attached');
  // A lens is built for a trigger, a capsule or a popover, not for a frame: the allowances below scale with `created`.
  if (rec.created > transition.created) out.push(`${rec.created} lenses were attached, and the transition needs at most ${transition.created}`);
  // A surface the transition creates has its first bake, and only that, on the way.
  if (during.fullBakes > 2 * rec.created) out.push(`${during.fullBakes} full bakes while it ran, ${rec.created} surfaces created`);
  if (during.filterSwaps > rec.created) out.push(`${during.filterSwaps} filter swaps while it ran, ${rec.created} surfaces created`);
  if (during.probes > (hosted ? 0 : rec.created)) out.push(`${during.probes} probes while it ran, ${rec.created} surfaces created`);
  if (hosted && landed.probes > 0) out.push(`${landed.probes} probes with the backdrop handed over`);
  // Landing: one probe and two maps (displacement and spectral) per surface, on top of a created surface's first bake.
  if (landed.probes > rec.surfaces + rec.created) out.push(`${landed.probes} probes for ${rec.surfaces} surfaces`);
  if (landed.fullBakes > 2 * (rec.surfaces + rec.created)) out.push(`${landed.fullBakes} full bakes for ${rec.surfaces} surfaces`);
  if (rec.interim.entered === 0) out.push('no lens entered interim');
  if (rec.interim.open > 0) out.push(`${rec.interim.open} lenses entered interim and were still in it when the recording ended`);
  if (transition.rebakes !== false && landed.fullBakes <= during.fullBakes) out.push(`the landing baked nothing (${landed.fullBakes} full bakes in all, ${during.fullBakes} while it ran)`);
  return out;
}

for (const transition of TRANSITIONS) {
  test(`${transition.name}: no probe, bake or filter swap on any frame, one landing`, async ({ page }) => {
    const rec = await recordTransition(page, transition, '1', { query: 'backdrop=photo' });
    expect(violations(rec, transition, true)).toEqual([]);
  });

  test(`${transition.name}: the same when the host does not hand over the backdrop`, async ({ page }) => {
    const rec = await recordTransition(page, transition, '1', { query: 'backdrop=photo&sample=0' });
    expect(violations(rec, transition, false)).toEqual([]);
  });
}

const named = (name: string) => TRANSITIONS.find((t) => t.name === name)!;
const switchOn = (key: '__labNoInterim' | '__labNoLand', selector: string) => async (page: Page) =>
  void (await page.evaluate(([k, s]) => ((window as unknown as Record<string, string>)[k!] = s!), [key, selector]));

test.describe('the canary: a surface that bypasses moveGlass fails the gate', () => {
  const bypassed: [string, string, string][] = [
    ['a navigation body', 'navigation morph, bar to rail', 'vire-nav > nav'],
    ['a navigation lens', 'navigation drag of the lens', 'vire-nav > [data-vk-lens]'],
    ['a navigation accessory', 'navigation accessory reshaped by minimising', 'vire-nav > [data-accessory]'],
    ['a menu', 'menu growth', '#more > [popover]'],
    ['a popover', 'popover growth', '#pop > [popover]'],
    ['a sheet', 'sheet growth', '#sup > [popover]'],
    ['a toolbar capsule', 'toolbar stage change, merging', 'vire-toolbar > [data-vk-capsule]'],
  ];
  for (const [what, name, selector] of bypassed) {
    test(`${what} that ignores interim fails`, async ({ page }) => {
      const transition = named(name);
      const rec = await recordTransition(page, transition, '1', { afterOpen: switchOn('__labNoInterim', selector) });
      expect(violations(rec, transition, true).join('\n')).toMatch(/while it ran|no lens entered interim/);
    });
  }
});

test.describe('the canary: a surface that never lands fails the gate', () => {
  const stuck: [string, string, string][] = [
    ['a navigation body', 'navigation morph, bar to rail', 'vire-nav > nav'],
    ['a navigation lens', 'navigation drag of the lens', 'vire-nav > [data-vk-lens]'],
    ['a menu', 'menu growth', '#more > [popover]'],
    ['a sheet', 'sheet growth', '#sup > [popover]'],
    ['a toolbar capsule', 'toolbar stage change, merging', 'vire-toolbar > [data-vk-capsule]'],
  ];
  for (const [what, name, selector] of stuck) {
    test(`${what} whose landing never fires fails`, async ({ page }) => {
      const transition = named(name);
      const rec = await recordTransition(page, transition, '1', { afterOpen: switchOn('__labNoLand', selector) });
      expect(violations(rec, transition, true).join('\n')).toMatch(/still in it when the recording ended/);
    });
  }
});

test.describe('the canary: a lens rebuilt on every frame fails the gate', () => {
  const churn: Transition = {
    name: 'a lens destroyed and attached again on every frame',
    query: 'view=nav&w=390&h=720',
    surfaces: 'vire-nav > nav',
    active: 'window.__labChurn === true',
    created: 0,
    run: (page) =>
      page.evaluate(async () => {
        const w = window as unknown as { __labChurn?: boolean; __labAttachGlass: (el: HTMLElement) => { destroy(): void } };
        const el = document.body.appendChild(document.createElement('div'));
        el.style.cssText = 'position:fixed;left:8px;top:8px;width:80px;height:40px';
        let handle: { destroy(): void } | null = null;
        w.__labChurn = true;
        for (let i = 0; i < 20; i += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          handle?.destroy();
          handle = w.__labAttachGlass(el);
        }
        w.__labChurn = false;
        handle?.destroy();
      }),
  };

  test('re-attaching a lens each frame exceeds what the transition needs', async ({ page }) => {
    const rec = await recordTransition(page, churn, '1');
    expect(rec.created).toBeGreaterThanOrEqual(20);
    expect(violations(rec, churn, true).join('\n')).toMatch(/lenses were attached, and the transition needs at most 0/);
  });
});

// MO5: the final frame is exact. What a lens was last handed once a transition has landed is what it would be handed
// had the page been opened at the end state: no coarse morph, no presence left as a fade of the element.
test.describe('the landing frame is exact', () => {
  const landings: [string, string][] = [
    ['navigation morph, bar to rail', 'view=nav&w=900&h=720'],
    ['navigation morph, rail to bar', 'view=nav&w=390&h=720'],
    ['toolbar stage change, merging', 'view=toolbar&w=370&h=400&toolbar-placement=top&spacer=0'],
    ['toolbar stage change, overflowing', 'view=toolbar&w=300&h=400&toolbar-placement=top&spacer=0'],
    ['toolbar change of place', 'view=toolbar&w=420&h=400&toolbar-placement=bottom&spacer=0'],
  ];
  for (const [name, cold] of landings) {
    test(`${name}: the lenses hold what a cold render of the end state gives them`, async ({ page }) => {
      const transition = named(name);
      await recordTransition(page, transition, '1', { query: 'backdrop=photo' });
      const landed = await lensStates(page, transition.surfaces);
      await openCase(page, `${cold}&glass=1&backdrop=photo`);
      const fresh = await lensStates(page, transition.surfaces);
      expect(landed.length).toBeGreaterThan(0);
      for (const lens of landed) expect(lens.geometry && { width: lens.geometry.width, height: lens.geometry.height }).toEqual(lens.size);
      expect(landed).toEqual(fresh);
    });
  }
});

// A pointer held still sends no geometry, and the core ends an interim that hears nothing for 2 s. The kit tells it once
// a second while the gesture is held (`holdGlass`), so a held drag stays in interim and nothing is baked until it lets go.
// From the start of the hold the shim lets only the heartbeat through (or nothing, for the canary), since in the lab the
// kit repaints every frame and that would keep the lens alive by itself.
test.describe('a gesture held still', () => {
  const HOLD_MS = 2500;
  const hold = async (page: Page, hear: 'beat' | 'none') => {
    await page.evaluate((h) => ((window.__labHear = h), window.__lab.resetRenderStats()), hear);
    await page.waitForTimeout(HOLD_MS);
    await page.evaluate(() => ((window as unknown as { __held: unknown }).__held = window.__lab.renderStats()));
  };
  const held = (page: Page) => page.evaluate(() => (window as unknown as { __held: { probes: number; fullBakes: number; filterSwaps: number } }).__held);

  const navDrag = (hear: 'beat' | 'none'): Transition => ({
    ...named('navigation drag of the lens'),
    async run(page) {
      const box = (await page.locator('vire-nav > nav').boundingBox())!;
      const y = box.y + box.height / 2;
      await drag(page, { x: box.x + box.width * 0.4 + 8, y }, { x: box.x + box.width * 0.7, y }, 12);
      await hold(page, hear);
      await page.mouse.up();
    },
  });
  const sheetDrag = (hear: 'beat' | 'none'): Transition => ({
    ...named('sheet detent drag and spring'),
    async run(page) {
      const box = (await page.locator('#sup [data-vk-grabber]').boundingBox())!;
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await drag(page, from, { x: from.x, y: from.y - 120 }, 12);
      await hold(page, hear);
      await page.mouse.up();
    },
  });

  for (const [what, make] of [['the navigation lens', navDrag], ['the sheet', sheetDrag]] as const) {
    test(`${what} held still for ${HOLD_MS} ms neither probes nor bakes`, async ({ page }) => {
      await recordTransition(page, make('beat'), '1', { query: 'backdrop=photo' });
      expect(await held(page)).toMatchObject({ probes: 0, fullBakes: 0, filterSwaps: 0 });
    });

    test(`canary: ${what} without the heartbeat falls out of interim while held`, async ({ page }) => {
      await recordTransition(page, make('none'), '1', { query: 'backdrop=photo' });
      const stats = await held(page);
      expect(stats.fullBakes + stats.probes + stats.filterSwaps).toBeGreaterThan(0);
    });
  }
});

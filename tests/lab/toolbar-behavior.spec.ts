import { expect, test, type Page } from '@playwright/test';
import { toolbarLayout, toolbarLayoutWithHysteresis, type ToolbarItem, type ToolbarLayout } from '../../src';
import type { ToolbarSnapshot } from '../../lab/toolbar';
import { emulateInput, nextFrame, openCase } from './helpers';

const log = (page: Page) => page.locator('#log').evaluate((el) => (el.textContent ?? '').split('\n').filter(Boolean));
const clicks = async (page: Page) => (await log(page)).filter((line) => line.startsWith('click:'));
const snap = (page: Page) => page.evaluate(() => window.__lab.toolbar!.snapshot());

const settle = async (page: Page) => {
  await page.waitForFunction(() => {
    const bar = document.querySelector('vire-toolbar');
    return bar?.hasAttribute('data-vk') && bar.hasAttribute('data-stage') && !bar.hasAttribute('data-moving');
  });
  await nextFrame(page);
};

/** Opens the sandbox in a window of `w` × `h` dp and waits until the toolbar has settled. */
async function openToolbar(page: Page, query = '', w = 720, h = 500): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openCase(page, `view=toolbar&w=${w}&h=${h}&${query}`);
  await settle(page);
}

const resize = (page: Page, w: number, h: number) => page.evaluate(([width, height]) => window.__lab.toolbar!.resize(width!, height!), [w, h]);

/** Resizes the window and waits for the change to land. */
async function reflow(page: Page, w: number, h: number): Promise<void> {
  await resize(page, w, h);
  await nextFrame(page);
  await nextFrame(page);
  await settle(page);
}

const TOP = 'toolbar-placement=top';
const TIER = 'medium' as const;

/** The sandbox's items as the model sees them; the main action's width is read from the page. */
const items = (done: number): ToolbarItem[] => [
  { id: 'Back', kind: 'icon', priority: 9, group: 'g0' },
  { id: 'Share', kind: 'icon', priority: 5, group: 'g1' },
  { id: 'Like', kind: 'icon', priority: 6, badge: true, group: 'g1' },
  { id: 'Add', kind: 'icon', priority: 4, group: 'g1' },
  { id: 'Info', kind: 'icon', priority: 3, group: 'g1' },
  { id: 'Queue', kind: 'icon', priority: 2, group: 'g1' },
  { id: 'Edit', kind: 'icon', priority: 2, group: 'g2' },
  { id: 'Delete', kind: 'icon', priority: 1, group: 'g2' },
  { id: 'Done', kind: 'text', primary: true, priority: 9, width: done, group: 'g3' },
];

const doneWidth = async (page: Page) => (await snap(page)).items.find((i) => i.label === 'Done')!.box.w;
const SIDE = 32;

const shown = (s: ToolbarSnapshot) => s.items.filter((i) => !i.hidden).map((i) => i.label);
const visibleLabels = (layout: ToolbarLayout, all: ToolbarItem[]) => all.filter((i) => !layout.overflow.includes(i.id)).map((i) => i.id);

// ---- before the upgrade -----------------------------------------------------------------------------------------------

test.describe('before the upgrade', () => {
  test('groups of buttons that wrap, every button its own Tab stop, nothing hidden, no role', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await openCase(page, 'view=toolbar&w=260&h=500&upgrade=0&glass=0');
    const bar = page.locator('vire-toolbar');
    await expect(bar).not.toHaveAttribute('role', /./);
    await expect(bar).not.toHaveAttribute('data-vk', /./);
    const buttons = page.locator('vire-toolbar button');
    const total = await buttons.count();
    const tabbable = await buttons.evaluateAll((els) => els.filter((el) => el.closest('[popover]') === null).length);
    expect(tabbable).toBeGreaterThan(8);
    for (let i = 0; i < total; i += 1) {
      expect(await buttons.nth(i).getAttribute('tabindex')).toBeNull();
      if (!(await buttons.nth(i).evaluate((el) => el.closest('[popover]') !== null))) await expect(buttons.nth(i)).toBeVisible();
    }
    // The groups wrap onto more than one row and nothing scrolls sideways.
    const tops = await page.locator('vire-toolbar [data-group] > *').evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
    expect(tops).toBeGreaterThan(1);
    const scroll = await bar.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(scroll.sw).toBeLessThanOrEqual(scroll.cw);
    // Tab walks all of them.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Tab');
    const seen = new Set<string>();
    for (let i = 0; i < tabbable + 2; i += 1) {
      seen.add(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id || (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || ''));
      await page.keyboard.press('Tab');
    }
    expect(seen.size).toBeGreaterThanOrEqual(tabbable);
  });
});

// ---- roles and keys ---------------------------------------------------------------------------------------------------

test.describe('roles and keys', () => {
  test('the upgrade makes it the APG toolbar: a role, the author\'s label, the orientation and one Tab stop', async ({ page }) => {
    await openToolbar(page, `${TOP}&glass=0`);
    const bar = page.locator('vire-toolbar');
    await expect(bar).toHaveAttribute('role', 'toolbar');
    await expect(bar).toHaveAttribute('aria-label', 'Track actions');
    await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
    const stops = await bar.evaluate((el) => [...el.querySelectorAll('button')].filter((b) => !b.closest('[hidden]') && b.getAttribute('tabindex') === '0').length);
    expect(stops).toBe(1);
    await page.locator('body').click({ position: { x: 900, y: 900 } });
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(first).toBe('Back');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('vire-toolbar'))).toBeNull();
  });

  test('the arrows move along the axis, Home and End go to the ends, a disabled item is passed over, and Tab comes back to the last one', async ({ page }) => {
    await openToolbar(page, `${TOP}&glass=0`);
    await page.evaluate(() => {
      (document.getElementById('toolbar-add-trigger') as HTMLButtonElement).disabled = true;
    });
    await nextFrame(page);
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim());
    await page.locator('vire-toolbar button[aria-label="Share"]').focus();
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('Like');
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('Info');
    await page.keyboard.press('ArrowLeft');
    expect(await active()).toBe('Like');
    await page.keyboard.press('End');
    expect(await active()).toBe('Done');
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('Done');
    await page.keyboard.press('Home');
    expect(await active()).toBe('Back');
    await page.keyboard.press('ArrowDown');
    expect(await active()).toBe('Back');
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('vire-toolbar'))).toBeNull();
    await page.keyboard.press('Shift+Tab');
    expect(await active()).toBe('Done');
    const stops = await page.locator('vire-toolbar').evaluate((el) => [...el.querySelectorAll('button')].filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.getAttribute('aria-label') ?? b.textContent!.trim()));
    expect(stops).toEqual(['Done']);
  });

  test('removing the element gives the markup back', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await openCase(page, 'view=toolbar&w=720&h=500&upgrade=0&glass=1&toolbar-placement=top&surfaces=1');
    // The attributes a menu restores come back in the order it re-adds them, so the markup is compared by what it says.
    const canon = () =>
      page.evaluate(() => {
        const walk = (el: Element): string =>
          `<${el.localName} ${[...el.attributes].map((a) => `${a.name}=${a.value}`).sort().join(' ')}>${[...el.childNodes].map((n) => (n.nodeType === 1 ? walk(n as Element) : n.textContent)).join('')}</${el.localName}>`;
        return walk(document.getElementById('toolbar')!);
      });
    const before = await canon();
    await page.evaluate(() => window.__lab.define());
    await page.waitForFunction(() => document.getElementById('toolbar')!.hasAttribute('data-vk'));
    await nextFrame(page);
    await expect(page.locator('vire-toolbar')).toHaveAttribute('role', 'toolbar');
    expect(await page.locator('vire-toolbar [data-vk-capsule]').count()).toBeGreaterThan(0);
    const after = await page.evaluate(() => {
      const bar = document.getElementById('toolbar')!;
      bar.remove();
      const walk = (el: Element): string =>
        `<${el.localName} ${[...el.attributes].map((a) => `${a.name}=${a.value}`).sort().join(' ')}>${[...el.childNodes].map((n) => (n.nodeType === 1 ? walk(n as Element) : n.textContent)).join('')}</${el.localName}>`;
      return walk(bar);
    });
    expect(after).toBe(before);
  });
});

// ---- the model's layout -----------------------------------------------------------------------------------------------

test.describe('layout', () => {
  test('what shows is the model\'s at every width from 0 to the widest, narrowing and widening', async ({ page }) => {
    await openToolbar(page, `${TOP}&glass=0&rm=1`, 720, 400);
    const all = items(await doneWidth(page));
    const full = toolbarLayout(all, { available: 1e6, tier: TIER });
    let previous: ToolbarLayout | null = null;
    const widths = [...Array.from({ length: 80 }, (_, i) => full.extent + 40 - i * 8), 12, 4, 0];
    const failures: string[] = [];
    const check = async (w: number, down: boolean) => {
      await reflow(page, w + 16, 400);
      const s = await snap(page);
      const options = { available: s.width, tier: TIER, orientation: 'horizontal' as const };
      const expected: ToolbarLayout = down ? toolbarLayout(all, options) : toolbarLayoutWithHysteresis(all, options, previous);
      previous = expected;
      const want = visibleLabels(expected, all);
      const got = shown(s).filter((label) => all.some((i) => i.id === label));
      if (want.join() !== got.join()) failures.push(`${s.width}: want ${want.join(' ')} got ${got.join(' ')}`);
      if ((expected.overflow.length > 0) === s.more!.hidden) failures.push(`${s.width}: "…" ${s.more!.hidden ? 'hidden' : 'shown'} with ${expected.overflow.length} overflowed`);
      if (s.stage !== expected.stage) failures.push(`${s.width}: stage ${s.stage}, want ${expected.stage}`);
    };
    for (const w of widths.filter((x) => x >= 0)) await check(w, true);
    previous = toolbarLayout(all, { available: 0, tier: TIER });
    for (const w of [...widths].reverse()) await check(w, false);
    expect(failures).toEqual([]);
  });

  test('a badged item and the main action never overflow, and "…" has no badge', async ({ page }) => {
    await openToolbar(page, `${TOP}&glass=0&rm=1`, 720, 400);
    for (const w of [300, 200, 120, 80]) {
      await reflow(page, w, 400);
      const s = await snap(page);
      expect(shown(s)).toEqual(expect.arrayContaining(['Like', 'Done']));
      expect(s.more!.hidden).toBe(false);
    }
    expect(await page.locator('[data-vk-more] [data-badge]').count()).toBe(0);
  });

  test('the bottom edge floats 8 dp above the navigation, the top edge stays in flow, and the strip stands at the trailing side with its text in a row at the foot', async ({ page }) => {
    await openToolbar(page, 'glass=0&rm=1', 390, 720);
    const frame = page.locator('#frame');
    const bar = page.locator('vire-toolbar');
    await expect(bar).toHaveAttribute('data-edge', 'bottom');
    await expect(bar).toHaveAttribute('data-orientation', 'horizontal');
    await frame.evaluate((el) => el.style.setProperty('--vire-nav-inset-bottom', '60px'));
    // With no spacer the capsules are centred in what the toolbar has.
    await page.evaluate(() => document.querySelector('vire-toolbar [data-spacer]')!.remove());
    await nextFrame(page);
    await nextFrame(page);
    const f = (await frame.boundingBox())!;
    const b = (await bar.boundingBox())!;
    expect(Math.round(f.y + f.height - (b.y + b.height))).toBe(68);
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
    const centred = await bar.evaluate((el) => {
      const kids = [...el.querySelectorAll<HTMLElement>('[data-vk-item]:not([hidden])')].map((k) => k.getBoundingClientRect());
      const bar = el.getBoundingClientRect();
      const left = Math.min(...kids.map((k) => k.left)) - bar.left;
      const right = bar.right - Math.max(...kids.map((k) => k.right));
      return Math.abs(left - right);
    });
    expect(centred).toBeLessThan(2);

    await reflow(page, 720, 500);
    await expect(bar).toHaveAttribute('data-edge', 'top');
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('relative');
    const top = (await bar.boundingBox())!;
    const topFrame = (await frame.boundingBox())!;
    expect(top.y - topFrame.y).toBeLessThanOrEqual(16);

    await reflow(page, 740, 360);
    await expect(bar).toHaveAttribute('data-edge', 'trailing');
    await expect(bar).toHaveAttribute('data-orientation', 'vertical');
    await expect(bar).toHaveAttribute('aria-orientation', 'vertical');
    const strip = await snap(page);
    const side = (await bar.boundingBox())!;
    const stripFrame = (await frame.boundingBox())!;
    expect(Math.round(stripFrame.x + stripFrame.width - (side.x + side.width))).toBe(8);
    expect(side.height).toBeGreaterThan(side.width * 3);
    const done = strip.items.find((i) => i.label === 'Done')!;
    expect(done.hidden).toBe(false);
    expect(done.box.w).toBeGreaterThan(done.box.h);
    const icons = strip.items.filter((i) => !i.hidden && !i.text);
    for (const icon of icons) expect(done.box.y).toBeGreaterThanOrEqual(icon.box.y + icon.box.h);
    for (const icon of icons) expect(icon.box.w).toBe(icon.box.h);
  });
});

// ---- stage changes, sampled frame by frame ----------------------------------------------------------------------------

type Sample = ToolbarSnapshot & { now: number; lenses: (number | undefined)[] };

/** Samples the toolbar once per animation frame while `steps` resize the window, until it has been still for a few frames. */
async function sampleFrames(page: Page, steps: { at: number; w: number; h: number }[], limit = 4000): Promise<Sample[]> {
  return page.evaluate(
    ([plan, max]) =>
      new Promise<Sample[]>((resolve) => {
        const out: Sample[] = [];
        let start = 0;
        let next = 0;
        let calm = 0;
        const tick = (now: number) => {
          if (!start) start = now;
          const elapsed = now - start;
          while (next < plan.length && elapsed >= plan[next]!.at) {
            window.__lab.toolbar!.resize(plan[next]!.w, plan[next]!.h);
            next += 1;
          }
          const s = window.__lab.toolbar!.snapshot();
          const lenses = ((window as unknown as { __lenses?: { alive: boolean; appear?: number }[] }).__lenses ?? []).filter((l) => l.alive).map((l) => l.appear);
          out.push({ ...s, now: elapsed, lenses });
          calm = next >= plan.length && !s.moving ? calm + 1 : 0;
          if (calm >= 6 || elapsed > max) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [steps, limit] as const,
  );
}

const find = (s: Sample, label: string) => s.items.find((i) => i.label === label)!;
const centre = (g: { x: number; w: number }) => g.x + g.w / 2;
const live = (s: Sample) => s.capsules.filter((c) => !c.hidden);
const drawn = (s: Sample) => live(s).length;

/** A glyph that stays in sight moves continuously and in order, and by no more than the gaps that close. */
function glyphGate(samples: Sample[], options: { travel?: number } = {}): string[] {
  const out: string[] = [];
  const first = samples[0]!;
  const last = samples.at(-1)!;
  const stay = first.items.filter((i) => !i.hidden && i.glyph && !find(last, i.label).hidden).map((i) => i.label);
  for (const label of stay) {
    const series = samples.map((s) => (find(s, label).glyph ? centre(find(s, label).glyph!) : Number.NaN));
    const total = Math.abs(series.at(-1)! - series[0]!);
    if (options.travel !== undefined && total > options.travel + 1) out.push(`${label} travels ${total.toFixed(1)}, more than the ${options.travel} of the gaps that close`);
    if (total < 4) continue;
    for (let i = 1; i < series.length; i += 1) {
      const step = Math.abs(series[i]! - series[i - 1]!);
      if (step > 0.4 * total) out.push(`${label} jumps ${step.toFixed(1)} of ${total.toFixed(1)} at frame ${i}`);
    }
  }
  for (const s of samples) {
    const xs = stay.map((label) => find(s, label).glyph).filter((g): g is NonNullable<typeof g> => g !== null).map(centre);
    for (let i = 1; i < xs.length; i += 1) if (xs[i]! < xs[i - 1]! - 0.01) out.push(`two glyphs cross at ${s.now.toFixed(0)} ms`);
  }
  return out;
}

const defocused = (item: Sample['items'][number]) => item.ink < 0.95 || item.blur > 0.3;

/** A glyph that leaves goes out of focus on the way, over more than a couple of frames. */
function leaversGate(samples: Sample[]): string[] {
  const out: string[] = [];
  const first = samples[0]!;
  const last = samples.at(-1)!;
  for (const { label } of first.items.filter((i) => !i.hidden && find(last, i.label).hidden)) {
    const frames = samples.map((s) => find(s, label)).filter((i) => !i.hidden && defocused(i)).length;
    if (frames < 3) out.push(`${label} defocuses in ${frames} frames`);
  }
  return out;
}

const NO_SPACER = `${TOP}&glass=0&spacer=0`;

/** The window widths, in dp, at which the sandbox's toolbar is separate and merged, at the medium tier. */
async function thresholds(page: Page) {
  const all = items(await doneWidth(page));
  const separate = toolbarLayout(all, { available: 1e6, tier: TIER });
  const merged = toolbarLayout(all, { available: separate.extent - 1, tier: TIER });
  return { all, separate: separate.extent + 16, merged: merged.extent + 16, capsules: { separate: separate.capsules.length, merged: merged.capsules.length } };
}

test.describe('a stage change', () => {
  test('merging closes the gaps through a neck and the glyphs stay put: no frame where a capsule jumps', async ({ page }) => {
    await openToolbar(page, NO_SPACER, 720, 400);
    const t = await thresholds(page);
    await reflow(page, t.separate + 60, 400);
    const samples = await sampleFrames(page, [{ at: 60, w: t.separate - 24, h: 400 }]);
    const last = samples.at(-1)!;
    expect(last.stage).toBe('merged');
    expect(drawn(last)).toBe(t.capsules.merged);
    expect(drawn(samples[0]!)).toBe(t.capsules.separate);
    const necks = samples.filter((s) => live(s).some((c) => c.clipped));
    expect(necks.length).toBeGreaterThanOrEqual(3);
    expect(glyphGate(samples, { travel: (t.capsules.separate - t.capsules.merged) * 8 })).toEqual([]);
  });

  test('a toolbar that swaps its stage in one frame fails it', async ({ page }) => {
    // Reduced motion is the stand-in: every change lands in one frame, so there is no neck and the glyphs jump.
    await openToolbar(page, `${NO_SPACER}&rm=1`, 720, 400);
    const t = await thresholds(page);
    await reflow(page, t.separate + 60, 400);
    const samples = await sampleFrames(page, [{ at: 60, w: t.separate - 24, h: 400 }]);
    const failures = [
      ...(samples.filter((s) => live(s).some((c) => c.clipped)).length < 3 ? ['no neck frames'] : []),
      ...glyphGate(samples),
    ];
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toMatch(/neck|jumps/);
  });

  test('overflow collapses the leaving slot into "…", which buds out of the trailing end and goes back into it', async ({ page }) => {
    await openToolbar(page, NO_SPACER, 720, 400);
    const t = await thresholds(page);
    await reflow(page, t.merged + 30, 400);
    const down = await sampleFrames(page, [{ at: 60, w: t.merged - 40, h: 400 }]);
    const end = down.at(-1)!;
    expect(end.stage).toBe('overflow');
    expect(end.more!.hidden).toBe(false);
    expect(leaversGate(down)).toEqual([]);
    expect(glyphGate(down)).toEqual([]);
    const buds = down.filter((s) => s.more && !s.more.hidden && s.more.ink > 0.01);
    expect(buds.length).toBeGreaterThanOrEqual(4);
    // It starts inside the capsule it comes out of, and comes into focus on the way.
    const inside = down.find((s) => s.more && !s.more.hidden && s.more.ink > 0.01)!;
    const trailing = live(inside)
      .filter((c) => c.kind !== 'primary' && c.kind !== 'more')
      .reduce((a, b) => (b.box.x + b.box.w > a.box.x + a.box.w ? b : a));
    expect(inside.more!.box.x).toBeLessThan(trailing.box.x + trailing.box.w);
    const inks = buds.map((s) => s.more!.ink);
    expect(inks[0]!).toBeLessThan(0.5);
    expect(inks.at(-1)!).toBeCloseTo(1, 1);
    for (let i = 1; i < inks.length; i += 1) expect(inks[i]!).toBeGreaterThanOrEqual(inks[i - 1]! - 0.01);
    expect(buds.some((s) => s.more!.ink > 0.05 && s.more!.ink < 0.95)).toBe(true);
    // A leaving slot shrinks into its neighbour.
    const leaver = down[0]!.items.filter((i) => !i.hidden && find(end, i.label).hidden).at(-1)!.label;
    const widths = down.map((s) => find(s, leaver)).filter((i) => !i.hidden).map((i) => i.box.w);
    expect(Math.min(...widths)).toBeLessThan(SIDE / 2);

    // And back: "…" goes into the trailing end, defocusing, and is gone.
    const up = await sampleFrames(page, [{ at: 60, w: t.merged + 30, h: 400 }]);
    expect(up.at(-1)!.more!.hidden).toBe(true);
    const going = up.filter((s) => s.more && !s.more.hidden && s.more.ink > 0.01);
    expect(going.length).toBeGreaterThanOrEqual(4);
    expect(going.some((s) => s.more!.ink < 0.95 && s.more!.ink > 0.05)).toBe(true);
    const fading = going.map((s) => s.more!.ink);
    for (let i = 1; i < fading.length; i += 1) expect(fading[i]!).toBeLessThanOrEqual(fading[i - 1]! + 0.01);
    expect(glyphGate(up)).toEqual([]);
  });

  test('the whole change takes about 0.35 to 0.4 s: "…" is in focus well inside it, and everything has landed inside a second', async ({ page }) => {
    await openToolbar(page, NO_SPACER, 720, 400);
    const t = await thresholds(page);
    await reflow(page, t.merged + 30, 400);
    const samples = await sampleFrames(page, [{ at: 60, w: t.merged - 40, h: 400 }]);
    const inks = samples.map((s) => (s.more && !s.more.hidden ? s.more.ink : 0));
    const started = samples[inks.findIndex((v) => v > 0.02)]!.now;
    const reached = samples[inks.findIndex((v) => v >= 0.95)]!.now;
    expect(reached - started).toBeGreaterThan(200);
    expect(reached - started).toBeLessThan(460);
    const moving = samples.filter((s) => s.moving);
    expect(moving.at(-1)!.now - moving[0]!.now).toBeLessThan(1000);
  });

  test('a width held just across a threshold does not toggle the stage, and widening waits 8 dp', async ({ page }) => {
    await openToolbar(page, `${NO_SPACER}&rm=1`, 720, 400);
    const t = await thresholds(page);
    await reflow(page, t.separate, 400);
    expect((await snap(page)).stage).toBe('separate');
    await reflow(page, t.separate - 1, 400);
    expect((await snap(page)).stage).toBe('merged');
    await reflow(page, t.separate, 400);
    expect((await snap(page)).stage).toBe('merged');
    await reflow(page, t.separate + 7, 400);
    expect((await snap(page)).stage).toBe('merged');
    await reflow(page, t.separate + 8, 400);
    expect((await snap(page)).stage).toBe('separate');
    for (let i = 0; i < 4; i += 1) {
      await reflow(page, t.separate - 1, 400);
      await reflow(page, t.separate, 400);
    }
    expect((await snap(page)).stage).toBe('merged');
  });

  test('under reduced motion a change lands in one frame', async ({ page }) => {
    await openToolbar(page, `${NO_SPACER}&rm=1`, 720, 400);
    const t = await thresholds(page);
    await reflow(page, t.separate + 60, 400);
    const samples = await sampleFrames(page, [{ at: 60, w: t.merged - 40, h: 400 }]);
    expect(samples.filter((s) => s.moving)).toHaveLength(0);
    const stages = samples.map((s) => s.stage);
    expect(new Set(stages)).toEqual(new Set(['separate', 'overflow']));
    expect(stages.filter((st, i) => i > 0 && st !== stages[i - 1])).toHaveLength(1);
    for (const s of samples) for (const i of s.items) if (!i.hidden) expect(i.ink).toBe(1);
  });

  test('a toolbar that ignores the slot ink fails the glyph gate', async ({ page }) => {
    // The stand-in draws every glyph at full focus until it is removed: nothing defocuses on its way out.
    await openToolbar(page, NO_SPACER, 720, 400);
    await page.addStyleTag({ content: 'vire-toolbar [data-vk-item][data-fading]{opacity:1!important;filter:none!important}' });
    const t = await thresholds(page);
    await reflow(page, t.merged + 30, 400);
    const samples = await sampleFrames(page, [{ at: 60, w: t.merged - 40, h: 400 }]);
    const failures = leaversGate(samples);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toMatch(/defocuses in/);
  });
});

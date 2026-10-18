import { expect, test, type Page } from '@playwright/test';
import { nextFrame, openStage } from './helpers';

type Box = { x: number; y: number; width: number; height: number };
type Decisions = {
  classes: { width: string; height: string };
  nav: { form: string; search: { form: string } | null; secondaryVisible: boolean };
  panes: { panes: number; visible: string[]; split: { kind: string; list?: number } | null };
  supporting: { form: string };
  accessory: { placement: string };
  placement: { edge: string; orientation: string };
  tier: string;
  hit: number;
  surfaces: Record<string, { form: string }>;
  toolbar: { stage: string; overflow: string[]; aside: string[]; extent: number } | null;
};
type NavFrame = { form: string; target: string; x: number; y: number; w: number; h: number; navs: number; id: string };

const decisions = (page: Page) => page.evaluate(() => window.__adaptive.decisions()) as Promise<Decisions>;
const box = async (page: Page, selector: string): Promise<Box> => (await page.locator(selector).boundingBox())!;
const settled = (page: Page) => page.waitForFunction(() => window.__adaptive.settled());
const set = (page: Page, patch: Record<string, unknown>) => page.evaluate((p) => window.__adaptive.set(p), patch);
const slop = (page: Page, id: string) => page.locator(id).evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--vk-slop-y')));
const formsSeen = (frames: NavFrame[]) => frames.map((f) => f.form).filter((f, i, all) => i === 0 || f !== all[i - 1]);

/** The largest share of a form change covered in one frame: a morph spreads it over many, a swap does it in one. */
function largestStep(frames: NavFrame[]): number {
  const distance = (a: NavFrame, b: NavFrame) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h);
  let worst = 0;
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i]!.target === frames[i - 1]!.target) continue;
    let end = i;
    while (end + 1 < frames.length && frames[end + 1]!.target === frames[i]!.target) end += 1;
    const total = distance(frames[i - 1]!, frames[end]!);
    if (total < 100) continue;
    for (let k = i; k <= end; k += 1) worst = Math.max(worst, distance(frames[k - 1]!, frames[k]!) / total);
  }
  return worst;
}

const PRESETS: [string, { w: number; h: number; nav: string; panes: number; tier: string; list?: number; search?: string; toolbar?: string }][] = [
  ['phone-portrait', { w: 360, h: 800, nav: 'bar', panes: 1, tier: 'touch', search: 'button', toolbar: 'bottom' }],
  ['phone-landscape', { w: 915, h: 412, nav: 'rail', panes: 1, tier: 'touch', search: 'item', toolbar: 'trailing' }],
  ['foldable-folded', { w: 412, h: 915, nav: 'bar', panes: 1, tier: 'touch', search: 'button' }],
  ['foldable-unfolded', { w: 673, h: 841, nav: 'rail', panes: 1, tier: 'touch', toolbar: 'top' }],
  ['foldable-book', { w: 673, h: 841, nav: 'rail', panes: 2, tier: 'touch' }],
  ['foldable-tabletop', { w: 841, h: 673, nav: 'bar', panes: 2, tier: 'touch', list: 360 }],
  ['tablet-portrait', { w: 800, h: 1280, nav: 'rail', panes: 1, tier: 'touch' }],
  ['tablet-landscape', { w: 1280, h: 800, nav: 'sidebar', panes: 2, tier: 'touch', list: 412, search: 'field' }],
  ['desktop-narrow', { w: 1024, h: 700, nav: 'rail', panes: 2, tier: 'medium', list: 360 }],
  ['desktop-wide', { w: 1440, h: 900, nav: 'sidebar', panes: 2, tier: 'medium', list: 412, search: 'field' }],
  ['xl', { w: 2560, h: 1080, nav: 'sidebar', panes: 2, tier: 'medium', list: 412 }],
];

test.describe('the stage', () => {
  test('a view is addressed by its URL: the window\'s size, its posture and the input', async ({ page }) => {
    await openStage(page, 'w=673&h=841&posture=book&input=touch', { width: 673, height: 841 });
    const win = await box(page, '#window');
    expect([win.width, win.height]).toEqual([673, 841]);
    await expect(page.locator('#window')).toHaveAttribute('data-width', 'medium');
    await expect(page.locator('#window')).toHaveAttribute('data-posture', 'book');
    await expect(page.locator('#window')).toHaveAttribute('data-tier', 'touch');
    const d = await decisions(page);
    expect(d.nav.form).toBe('rail');
    expect(d.panes.split?.kind).toBe('fold');
  });

  for (const [preset, expected] of PRESETS) {
    test(`${preset}: the model's forms, and the atoms at the input's tier`, async ({ page }) => {
      await openStage(page, `preset=${preset}&selected=2`, { width: expected.w, height: expected.h });
      await expect(page.locator('#nav')).toHaveAttribute('data-form', expected.nav);
      const d = await decisions(page);
      expect(d.panes.panes).toBe(expected.panes);
      await expect(page.locator('#open')).toHaveAttribute('data-size', expected.tier);
      await expect(page.locator('#list-more')).toHaveAttribute('data-size', expected.tier);
      if (expected.list) expect((await box(page, '[data-pane=list]')).width).toBe(expected.list);
      if (expected.search) await expect(page.locator('#nav')).toHaveAttribute('data-search', expected.search);
      if (expected.toolbar) expect(d.placement.edge).toBe(expected.toolbar);
    });
  }

  test('the real atoms take the tier from the primary pointer and the hit area from any coarse input', async ({ page }) => {
    for (const [input, tier, reach] of [
      ['touch', 'touch', 0],
      ['mixed', 'medium', 6],
      ['pointer', 'medium', 0],
      ['tablet-keyboard', 'touch', 0],
    ] as const) {
      await openStage(page, `preset=desktop-wide&input=${input}&selected=2`, { width: 1440, height: 900 });
      await expect(page.locator('#open'), input).toHaveAttribute('data-size', tier);
      await expect(page.locator('#list-more'), input).toHaveAttribute('data-size', tier);
      expect(await slop(page, '#share'), input).toBe(reach);
    }
  });

  test('a half-open posture: tabletop puts the bar in the bottom half, book splits the panes at the fold', async ({ page }) => {
    await openStage(page, 'preset=foldable-tabletop&selected=2', { width: 841, height: 673 });
    const win = await box(page, '#window');
    expect((await box(page, '#nav')).y - win.y).toBeGreaterThan(673 / 2);
    await openStage(page, 'preset=foldable-book&band=20&selected=2', { width: 673, height: 841 });
    const at = await box(page, '#window');
    const fold = { x: 673 / 2 - 10 + at.x, end: 673 / 2 + 10 + at.x };
    const list = await box(page, '[data-pane=list]');
    const detail = await box(page, '[data-pane=detail]');
    expect(list.x + list.width).toBeLessThanOrEqual(fold.x);
    expect(detail.x).toBeGreaterThanOrEqual(fold.end);
  });
});

test.describe('one body', () => {
  test('a sweep across every breakpoint and back keeps one navigation body that flows bar, rail, sidebar and back', async ({ page }) => {
    await openStage(page, 'w=360&h=900&input=touch&selected=2', { width: 1600, height: 900 });
    await page.evaluate(() => window.__adaptive.record());
    const steps = await page.evaluate(() => window.__adaptive.run('sweep'));
    await settled(page);
    const frames = (await page.evaluate(() => window.__adaptive.frames())) as NavFrame[];
    expect(frames.length).toBeGreaterThan(100);
    for (const f of frames) expect([f.navs, f.id]).toEqual([1, 'nav-body']);
    expect(formsSeen(frames)).toEqual(['bar', 'rail', 'sidebar', 'rail', 'bar']);
    expect(steps.every((s) => s.sameNav)).toBe(true);
    expect(largestStep(frames)).toBeLessThan(0.4);
  });

  test('canary: a navigation that swaps form in one frame fails the morph gate', async ({ page }) => {
    await openStage(page, 'w=360&h=900&input=touch&selected=2&rm=1', { width: 1600, height: 900 });
    await page.evaluate(() => window.__adaptive.record());
    await page.evaluate(() => window.__adaptive.run('sweep'));
    const frames = (await page.evaluate(() => window.__adaptive.frames())) as NavFrame[];
    expect(largestStep(frames)).toBeGreaterThan(0.9);
  });

  test('under reduced motion the new form is there in the next frame', async ({ page }) => {
    await openStage(page, 'w=700&h=900&rm=1', { width: 1300, height: 900 });
    const nav = await page.evaluate(
      () =>
        new Promise<{ x: number; width: number; form: string }>((resolve) => {
          window.__adaptive.set({ w: 1300 });
          requestAnimationFrame(() => {
            const el = document.getElementById('nav')!;
            const w = document.getElementById('window')!.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            resolve({ x: r.x - w.x, width: r.width, form: el.dataset.form ?? '' });
          });
        }),
    );
    expect(nav).toEqual({ x: 8, width: 272, form: 'sidebar' });
  });

  test('turned back mid-way, the body runs back from where it is and never reaches the other form', async ({ page }) => {
    await openStage(page, 'w=1100&h=900', { width: 1300, height: 900 });
    await page.evaluate(() => window.__adaptive.record());
    await set(page, { w: 1300 });
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
    await set(page, { w: 1100 });
    await settled(page);
    const widths = ((await page.evaluate(() => window.__adaptive.frames())) as NavFrame[]).map((f) => f.w);
    const peak = widths.indexOf(Math.max(...widths));
    expect(widths[peak]).toBeGreaterThan(80);
    expect(widths[peak]).toBeLessThan(272 - 40);
    for (let i = 1; i <= peak; i += 1) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]! - 0.01);
    for (let i = peak + 1; i < widths.length; i += 1) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]! + 0.01);
    expect(widths.at(-1)).toBe(80);
  });
});

test.describe('state survives', () => {
  test('the section, the selection, the list\'s scroll, typed text and an open sheet survive every threshold, a fold and a rotation', async ({ page }) => {
    await openStage(page, 'preset=desktop-wide&input=touch', { width: 1600, height: 1000 });
    await page.locator('#nav [data-section="2"]').click();
    await page.getByRole('button', { name: 'Item 6', exact: true }).click();
    await page.locator('.list-scroll').evaluate((el) => (el.scrollTop = 200));
    await page.locator('#notes').fill('kept');
    await page.evaluate(() => window.__adaptive.app({ surface: 'sheet' }));
    const before = await page.evaluate(() => window.__adaptive.state());
    expect(before).toMatchObject({ section: 2, selected: 5, showing: 'detail', notes: 'kept', scroll: 200, surface: 'sheet' });
    for (const scenario of ['sweep', 'fold', 'rotate'] as const) {
      const steps = await page.evaluate((name) => window.__adaptive.run(name), scenario);
      for (const step of steps) {
        expect(step.lost, `${scenario} ${step.label}`).toEqual([]);
        expect(step.sameNav).toBe(true);
        expect(step.surface, `${scenario} ${step.label}`).not.toBeNull();
      }
    }
    expect(await page.evaluate(() => window.__adaptive.state())).toEqual(before);
  });

  test('an open sheet changes form at 840 and 1600 and back, and stays open', async ({ page }) => {
    await openStage(page, 'w=700&h=900&surface=sheet&selected=2', { width: 1700, height: 900 });
    const form = () => page.locator('#surface').getAttribute('data-form');
    expect(await form()).toBe('bottom-sheet');
    expect((await box(page, '#surface')).width).toBeLessThanOrEqual(640);
    for (const [w, expected] of [
      [900, 'side-sheet'],
      [1700, 'side-pane'],
      [839, 'bottom-sheet'],
    ] as const) {
      await set(page, { w });
      await settled(page);
      expect(await form()).toBe(expected);
      await expect(page.locator('#surface')).toHaveAttribute('data-shown', expected);
      await expect(page.locator('#surface')).toBeVisible();
      if (expected !== 'bottom-sheet') expect((await box(page, '#surface')).width).toBeLessThanOrEqual(400);
    }
  });

  test('a popover becomes a sheet grown from its source below 600 and full screen on a compact height; a dialog with fields is full screen below 600', async ({ page }) => {
    await openStage(page, 'w=700&h=900&surface=popover', { width: 700, height: 900 });
    const form = () => page.locator('#surface').getAttribute('data-form');
    expect(await form()).toBe('popover');
    await set(page, { w: 599 });
    expect(await form()).toBe('bottom-sheet');
    await set(page, { w: 560, h: 400 });
    expect(await form()).toBe('full-screen');
    await page.evaluate(() => window.__adaptive.app({ surface: 'dialog' }));
    await set(page, { w: 599, h: 900 });
    expect(await form()).toBe('full-screen');
    await set(page, { w: 600 });
    expect(await form()).toBe('basic-dialog');
  });

  test('attaching a keyboard and a trackpad changes neither the layout nor the tier', async ({ page }) => {
    await openStage(page, 'preset=tablet-portrait&selected=2', { width: 800, height: 1280 });
    const steps = await page.evaluate(() => window.__adaptive.run('keyboard'));
    expect(new Set(steps.map((s) => `${s.nav}|${s.panes}|${s.tier}|${s.hit}`)).size).toBe(1);
    expect(steps[0]).toMatchObject({ nav: 'rail', tier: 'touch', hit: 44 });
    expect(steps.every((s) => s.preserved)).toBe(true);
  });

  test('a supporting pane shown beside the content hides below large and comes back, remembered', async ({ page }) => {
    await openStage(page, 'w=1440&h=900&pinned=1&selected=2', { width: 1440, height: 900 });
    const form = () => page.locator('#supporting').getAttribute('data-form');
    expect(await form()).toBe('beside');
    expect((await box(page, '#supporting')).width).toBeLessThanOrEqual(400);
    await set(page, { w: 1100 });
    expect(await form()).toBe('hidden');
    await expect(page.locator('#supporting')).toBeHidden();
    await set(page, { w: 1440 });
    expect(await form()).toBe('beside');
    await set(page, { w: 1100 });
    await page.evaluate(() => window.__adaptive.app({ supportingOpen: true }));
    expect(await form()).toBe('over');
  });
});

type MenuFrame = { x: number; y: number; w: number; h: number };

async function menuRun(page: Page, id: string): Promise<MenuFrame[]> {
  await page.evaluate((id) => {
    const list = document.getElementById(id)!.querySelector<HTMLElement>(':scope > [popover]')!;
    const frames: MenuFrame[] = [];
    (window as unknown as { __menuFrames: MenuFrame[] }).__menuFrames = frames;
    const loop = () => {
      if (list.matches(':popover-open')) {
        const r = list.getBoundingClientRect();
        if (r.width > 0) frames.push({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, id);
  await page.locator(`#${id}-trigger`).click();
  await expect(page.locator(`#${id}`)).toHaveAttribute('data-phase', 'open');
  await nextFrame(page);
  return page.evaluate(() => (window as unknown as { __menuFrames: MenuFrame[] }).__menuFrames);
}

test.describe('a menu on the stage', () => {
  test('in book posture it grows inside its trigger\'s half, every frame', async ({ page }) => {
    await openStage(page, 'preset=foldable-book&selected=2', { width: 673, height: 841 });
    const win = await box(page, '#window');
    const foldX = win.x + 673 / 2;
    const frames = await menuRun(page, 'list-more');
    expect(frames.length).toBeGreaterThan(5);
    for (const f of frames) expect(f.x + f.w).toBeLessThanOrEqual(foldX + 0.5);
  });

  test('in tabletop it grows inside the bottom half, every frame', async ({ page }) => {
    await openStage(page, 'preset=foldable-tabletop&selected=2', { width: 841, height: 673 });
    const win = await box(page, '#window');
    const foldY = win.y + 673 / 2;
    const frames = await menuRun(page, 'accessory-more');
    expect(frames.length).toBeGreaterThan(5);
    for (const f of frames) expect(f.y).toBeGreaterThanOrEqual(foldY - 0.5);
  });

  test('canary: a window that reports no fold lets the same menus cross it', async ({ page }) => {
    await openStage(page, 'preset=foldable-book&selected=2&foldaware=0', { width: 673, height: 841 });
    const book = await box(page, '#window');
    const foldX = book.x + 673 / 2;
    expect((await menuRun(page, 'list-more')).some((f) => f.x < foldX - 0.5 && f.x + f.w > foldX + 0.5)).toBe(true);
    await openStage(page, 'preset=foldable-tabletop&selected=2&foldaware=0', { width: 841, height: 673 });
    const tabletop = await box(page, '#window');
    const foldY = tabletop.y + 673 / 2;
    expect((await menuRun(page, 'accessory-more')).some((f) => f.y < foldY - 0.5 && f.y + f.h > foldY + 0.5)).toBe(true);
  });
});

const RECORDING_LENS = `
const flat = { luma: 0.9, busy: 0, lo: 0.9, hi: 0.9, r: 0.9, g: 0.9, b: 0.9 };
export function probeBackdrop() { return flat; }
export function statsFromSamples() { return flat; }
export function attachGlass(el, opts) {
  window.__attaches = (window.__attaches ?? 0) + 1;
  el.style.setProperty('backdrop-filter', 'blur(1px)');
  return {
    update() { window.__updates = (window.__updates ?? 0) + 1; },
    setMorph() { window.__updates = (window.__updates ?? 0) + 1; },
    setAppear() {}, setSample() {}, setAccent() {}, setNeighbourGlow() {},
    destroy() {},
  };
}`;

test.describe('while the window is dragged', () => {
  test('the lenses are neither rebuilt nor reshaped: the atoms keep their geometry across every class', async ({ page }) => {
    await page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS }));
    await openStage(page, 'w=360&h=900&input=mixed&selected=2', { width: 1600, height: 900 });
    const count = () => page.evaluate(() => ({ attaches: (window as unknown as { __attaches: number }).__attaches, updates: (window as unknown as { __updates?: number }).__updates ?? 0 }));
    const before = await count();
    expect(before.attaches).toBeGreaterThan(3);
    await page.evaluate(() => window.__adaptive.run('sweep'));
    expect(await count()).toEqual(before);
    await page.locator('#open button').click();
    await expect.poll(async () => (await count()).updates).toBeGreaterThan(before.updates);
  });
});

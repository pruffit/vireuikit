import { expect, test, type Page } from '@playwright/test';
import { nextFrame, openStage } from './helpers';

type Box = { x: number; y: number; width: number; height: number };
type Decisions = {
  classes: { width: string; height: string };
  panes: { panes: number; visible: string[]; split: { kind: string; list?: number } | null };
  supporting: { form: string };
  placement: { edge: string; orientation: string };
  tier: string;
  hit: number;
  surfaces: Record<string, { form: string }>;
  toolbar: { stage: string; overflow: string[]; aside: string[]; extent: number } | null;
};
type NavNow = { form: string; target: string; search: string; minimized: boolean; collapsed: boolean; accessory: string; moving: boolean; insets: { bottom: number; start: number } };
type NavFrame = { form: string; target: string; x: number; y: number; w: number; h: number; navs: number; id: string };

const decisions = (page: Page) => page.evaluate(() => window.__adaptive.decisions()) as Promise<Decisions>;
const box = async (page: Page, selector: string): Promise<Box> => (await page.locator(selector).boundingBox())!;
const navNow = (page: Page) => page.evaluate(() => window.__adaptive.nav()) as Promise<NavNow>;
const body = (page: Page) => box(page, '#nav > nav');
const settled = (page: Page) => page.waitForFunction(() => window.__adaptive.settled());
const set = (page: Page, patch: Record<string, unknown>) => page.evaluate((p) => window.__adaptive.set(p), patch);
type Surface = { host: string; form: string | null; phase: string | null; detent: string | null; insetEnd: number };
const surfaceNow = (page: Page) => page.evaluate(() => window.__adaptive.surface()) as Promise<Surface | null>;
const whenOpen = (page: Page) => page.waitForFunction(() => window.__adaptive.settled());
const formOf = (page: Page, host: string) => page.locator(`#${host}`).getAttribute('data-form');
const slop = (page: Page, id: string) => page.locator(id).evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--vk-slop-y')));
const flow = (forms: string[]) => forms.filter((f, i, all) => i === 0 || f !== all[i - 1]);

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

const PRIMARY_LINKS = ['/', '/library', '/friends', '/messages'];
const SECONDARY_LINKS = ['/feed', '/dashboard'];

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

/** The panes keep clear of the navigation's body, its search circle and its accessory. */
async function clears(page: Page): Promise<void> {
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
  const nav = [await body(page), await box(page, '#nav [data-accessory]'), await box(page, '#nav > nav > a[data-search]')];
  for (const pane of ['list', 'detail']) {
    const locator = page.locator(`[data-pane=${pane}]`);
    if (!(await locator.isVisible())) continue;
    const rect = (await locator.boundingBox())!;
    for (const part of nav) expect(overlaps(rect, part), `${pane} ${JSON.stringify(rect)} against ${JSON.stringify(part)}`).toBe(false);
  }
}

test.describe('the stage', () => {
  test('a view is addressed by its URL: the window\'s size, its posture and the input', async ({ page }) => {
    await openStage(page, 'w=673&h=841&posture=book&input=touch', { width: 673, height: 841 });
    const win = await box(page, '#window');
    expect([win.width, win.height]).toEqual([673, 841]);
    await expect(page.locator('#window')).toHaveAttribute('data-width', 'medium');
    await expect(page.locator('#window')).toHaveAttribute('data-posture', 'book');
    await expect(page.locator('#window')).toHaveAttribute('data-tier', 'touch');
    const d = await decisions(page);
    await expect(page.locator('#nav')).toHaveAttribute('data-form', 'rail');
    expect(d.panes.split?.kind).toBe('fold');
  });

  for (const [preset, expected] of PRESETS) {
    test(`${preset}: the model's forms, and the atoms at the input's tier`, async ({ page }) => {
      await openStage(page, `preset=${preset}&selected=2`, { width: expected.w, height: expected.h });
      await expect(page.locator('vire-nav')).toHaveCount(1);
      await expect(page.locator('#nav')).toHaveAttribute('data-form', expected.nav);
      const d = await decisions(page);
      const visible = await page.locator('#nav > nav a:visible').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
      expect(visible, 'secondary links show only in the sidebar, the same primary ones on every form').toEqual([
        ...PRIMARY_LINKS,
        ...(expected.nav === 'sidebar' ? SECONDARY_LINKS : []),
        '/search',
      ]);
      await clears(page);
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
    await expect(page.locator('#nav')).toHaveAttribute('data-form', 'bar');
    expect((await body(page)).y - win.y).toBeGreaterThan(673 / 2);
    await openStage(page, 'preset=foldable-book&band=20&selected=2', { width: 673, height: 841 });
    const at = await box(page, '#window');
    const fold = { x: 673 / 2 - 10 + at.x, end: 673 / 2 + 10 + at.x };
    const list = await box(page, '[data-pane=list]');
    const detail = await box(page, '[data-pane=detail]');
    expect(list.x + list.width).toBeLessThanOrEqual(fold.x);
    expect(detail.x).toBeGreaterThanOrEqual(fold.end);
  });
});

test.describe('the bottom accessory', () => {
  test('sits above the bar, in the minimised bar\'s row between its circles, and along the bottom of the content beside a rail or a sidebar', async ({ page }) => {
    await openStage(page, 'preset=phone-portrait&selected=2', { width: 360, height: 800 });
    const accessory = () => box(page, '#nav [data-accessory]');
    await expect(page.locator('#accessory')).toHaveAttribute('data-placement', 'above-bar');
    const bar = await body(page);
    let acc = await accessory();
    expect(bar.y - (acc.y + acc.height)).toBeCloseTo(8, 0);
    expect(acc.height).toBeCloseTo(48, 0);

    await openStage(page, 'preset=phone-portrait', { width: 360, height: 800 });
    await page.locator('.list-scroll').evaluate((el) => (el.scrollTop = 300));
    await expect(page.locator('#nav')).toHaveAttribute('data-minimized', '');
    await settled(page);
    await expect(page.locator('#accessory')).toHaveAttribute('data-placement', 'in-bar');
    const circle = await body(page);
    const search = await box(page, '#nav > nav > a[data-search]');
    acc = await accessory();
    expect(acc.x).toBeGreaterThanOrEqual(circle.x + circle.width - 0.5);
    expect(acc.x + acc.width).toBeLessThanOrEqual(search.x + 0.5);
    expect(acc.y + acc.height / 2).toBeCloseTo(circle.y + circle.height / 2, 0);

    for (const [preset, size] of [
      ['tablet-portrait', { width: 800, height: 1280 }],
      ['desktop-wide', { width: 1440, height: 900 }],
    ] as const) {
      await openStage(page, `preset=${preset}&selected=2`, size);
      await expect(page.locator('#accessory')).toHaveAttribute('data-placement', 'content-bottom');
      const side = await body(page);
      const win = await box(page, '#window');
      acc = await accessory();
      expect(acc.x).toBeGreaterThanOrEqual(side.x + side.width - 0.5);
      expect(win.y + win.height - (acc.y + acc.height)).toBeLessThanOrEqual(12);
    }
  });
});

test.describe('one body', () => {
  // Glass off: with software-rendered glass a frame lasts longer than the spring's step cap and every step looks bigger.
  const sweep = async (page: Page) => {
    await openStage(page, 'w=360&h=900&input=touch&selected=2&glass=0', { width: 1600, height: 900 });
    await page.evaluate(() => window.__adaptive.record());
    const steps = await page.evaluate(() => window.__adaptive.run('sweep'));
    await settled(page);
    return { steps, frames: (await page.evaluate(() => window.__adaptive.frames())) as NavFrame[] };
  };

  test('a sweep across every breakpoint and back keeps one navigation body, asks for bar, rail, sidebar, rail, bar and never jumps', async ({ page }) => {
    const { steps, frames } = await sweep(page);
    expect(frames.length).toBeGreaterThan(100);
    for (const f of frames) expect([f.navs, f.id]).toEqual([1, 'nav-body']);
    expect(flow(frames.map((f) => f.target))).toEqual(['bar', 'rail', 'sidebar', 'rail', 'bar']);
    expect(steps.every((s) => s.sameNav)).toBe(true);
    expect(largestStep(frames)).toBeLessThan(0.4);
  });

  test('the form it draws flows bar, rail, sidebar, rail, bar', async ({ page }) => {
    const { frames } = await sweep(page);
    expect(flow(frames.map((f) => f.form))).toEqual(['bar', 'rail', 'sidebar', 'rail', 'bar']);
  });

  test('canary: a navigation that swaps form in one frame fails the morph gate', async ({ page }) => {
    await openStage(page, 'w=360&h=900&input=touch&selected=2&glass=0&rm=1', { width: 1600, height: 900 });
    await page.evaluate(() => window.__adaptive.record());
    await page.evaluate(() => window.__adaptive.run('sweep'));
    const frames = (await page.evaluate(() => window.__adaptive.frames())) as NavFrame[];
    expect(largestStep(frames)).toBeGreaterThan(0.9);
  });

  test('under reduced motion the new form is there in the next frame', async ({ page }) => {
    await openStage(page, 'w=700&h=900&rm=1', { width: 1300, height: 900 });
    const nav = await page.evaluate(
      () =>
        new Promise<{ x: number; width: number; form: string; lens: boolean }>((resolve) => {
          window.__adaptive.set({ w: 1300 });
          requestAnimationFrame(() => {
            const el = document.getElementById('nav')!;
            const w = document.getElementById('window')!.getBoundingClientRect();
            const r = el.querySelector(':scope > nav')!.getBoundingClientRect();
            resolve({ x: r.x - w.x, width: r.width, form: el.dataset.form ?? '', lens: el.hasAttribute('data-lens') });
          });
        }),
    );
    expect(nav).toEqual({ x: 8, width: 280, form: 'sidebar', lens: false });
  });

  test('turned back mid-way, the body runs back from where it is and never reaches the other form', async ({ page }) => {
    // Glass off as in the other morph gates: software glass on CI lengthens frames past the spring's step cap.
    await openStage(page, 'w=1100&h=900&glass=0', { width: 1300, height: 900 });
    await page.evaluate(() => window.__adaptive.record());
    await set(page, { w: 1300 });
    // Turn back at the first frame the body has narrowed, not after a count of frames that depends on the renderer.
    await page.waitForFunction(() => {
      const f = window.__adaptive.frames() as { w: number }[];
      return f.length > 0 && f.at(-1)!.w < 79;
    });
    await set(page, { w: 1100 });
    await settled(page);
    const frames = (await page.evaluate(() => window.__adaptive.frames())) as NavFrame[];
    const widths = frames.map((f) => f.w);
    const trough = widths.indexOf(Math.min(...widths));
    expect(widths[trough]).toBeLessThan(80 - 0.5);
    expect(widths[trough]).toBeGreaterThan(40);
    // The lens morph is not monotone in width (the body narrows into the lens, the lens widens as it travels), so
    // running back is checked as no jump and never growing toward the sidebar's 280 dp.
    expect(Math.max(...widths)).toBeLessThanOrEqual(80.01);
    expect(widths.at(-1)).toBe(80);
    expect(new Set(frames.map((f) => f.form))).toEqual(new Set(['rail']));
    expect(largestStep(frames)).toBeLessThan(0.4);
  });
});

test.describe('state survives', () => {
  test('the section, the selection, the list\'s scroll, typed text and an open sheet survive every threshold, a fold and a rotation', async ({ page }) => {
    test.setTimeout(240_000);
    await openStage(page, 'preset=desktop-wide&input=touch', { width: 1600, height: 1000 });
    await page.locator('#nav [data-section="2"]').click();
    await page.getByRole('button', { name: 'Item 6', exact: true }).click();
    await page.locator('.list-scroll').evaluate((el) => (el.scrollTop = 200));
    await page.locator('#notes').fill('kept');
    await page.evaluate(() => window.__adaptive.app({ surface: 'sheet' }));
    await whenOpen(page);
    await page.locator('#sheet-field').fill('typed in the sheet');
    await page.locator('#sheet-surface').evaluate((el) => (el.scrollTop = 120));
    await page.locator('#nav a[data-section="2"]').focus();
    const before = await page.evaluate(() => window.__adaptive.state());
    expect(before).toMatchObject({ section: 2, selected: 5, showing: 'detail', notes: 'kept', scroll: 200, surface: 'sheet', sheetField: 'typed in the sheet', sheetScroll: 120, current: '/friends', focus: '/friends' });
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

  test('an open bottom sheet keeps its detent and its content through every threshold and comes back to it', async ({ page }) => {
    test.setTimeout(240_000);
    await openStage(page, 'w=700&h=900&surface=sheet&selected=2&input=touch', { width: 1700, height: 900 });
    await page.evaluate(() => ((document.getElementById('sheet') as unknown as { detent: string }).detent = 'large'));
    await whenOpen(page);
    await page.locator('#sheet-field').fill('kept');
    const steps = await page.evaluate(() => window.__adaptive.run('sweep'));
    const bottom = steps.filter((s) => s.surface === 'bottom-sheet');
    expect(bottom.length).toBeGreaterThan(10);
    for (const step of bottom) expect(step.detent, step.label).toBe('large');
    expect(new Set(steps.map((s) => s.surface))).toEqual(new Set(['bottom-sheet', 'side-sheet', 'side-pane']));
    for (const step of steps) expect(step.lost, step.label).toEqual([]);
    await whenOpen(page);
    expect(await page.locator('#sheet').evaluate((el) => (el as unknown as { detent: string }).detent)).toBe('large');
    expect(await page.locator('#sheet-field').inputValue()).toBe('kept');
  });

  test('a focused link that is not the selected one keeps focus through every threshold, a fold and a rotation', async ({ page }) => {
    await openStage(page, 'preset=desktop-wide&input=touch&selected=2', { width: 1600, height: 1000 });
    await page.locator('#nav a[data-section="3"]').focus();
    for (const scenario of ['sweep', 'fold', 'rotate'] as const) {
      const steps = await page.evaluate((name) => window.__adaptive.run(name), scenario);
      for (const step of steps) expect(step.lost, `${scenario} ${step.label}`).toEqual([]);
    }
    expect(await page.evaluate(() => window.__adaptive.state())).toMatchObject({ current: '/library', focus: '/messages' });
  });

  test('an open sheet changes form at 840 and 1600 and back, and stays open', async ({ page }) => {
    await openStage(page, 'w=700&h=900&surface=sheet&selected=2', { width: 1700, height: 900 });
    expect(await formOf(page, 'sheet')).toBe('bottom-sheet');
    expect((await box(page, '#sheet-surface')).width).toBeLessThanOrEqual(640);
    for (const [w, expected] of [
      [900, 'side-sheet'],
      [1700, 'side-pane'],
      [839, 'bottom-sheet'],
    ] as const) {
      await set(page, { w });
      await whenOpen(page);
      expect(await formOf(page, 'sheet')).toBe(expected);
      await expect(page.locator('#sheet')).toHaveAttribute('data-phase', 'open');
      await expect(page.locator('#sheet-surface')).toBeVisible();
      if (expected !== 'bottom-sheet') expect((await box(page, '#sheet-surface')).width).toBeLessThanOrEqual(400);
    }
  });

  test('a popover becomes a sheet grown from its source below 600 and full screen on a compact height; a dialog with fields is full screen below 600', async ({ page }) => {
    await openStage(page, 'w=700&h=900&surface=popover', { width: 700, height: 900 });
    expect(await formOf(page, 'popover')).toBe('popover');
    await set(page, { w: 599 });
    await expect(page.locator('#popover')).toHaveAttribute('data-form', 'bottom-sheet');
    await set(page, { w: 560, h: 400 });
    await expect(page.locator('#popover')).toHaveAttribute('data-form', 'full-screen');
    await page.evaluate(() => window.__adaptive.app({ surface: 'dialog' }));
    await set(page, { w: 599, h: 900 });
    await whenOpen(page);
    await expect(page.locator('#modal')).toHaveAttribute('data-form', 'full-screen');
    await set(page, { w: 600 });
    await expect(page.locator('#modal')).toHaveAttribute('data-form', 'basic-dialog');
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

async function surfaceRun(page: Page, host: string): Promise<MenuFrame[]> {
  await page.evaluate((host) => {
    const surface = document.getElementById(`${host}-surface`)!;
    const frames: MenuFrame[] = [];
    (window as unknown as { __menuFrames: MenuFrame[] }).__menuFrames = frames;
    const loop = () => {
      if (surface.matches(':popover-open')) {
        const r = surface.getBoundingClientRect();
        if (r.width > 0) frames.push({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, host);
  await page.locator(`#${host}-trigger`).click();
  await expect(page.locator(`#${host}`)).toHaveAttribute('data-phase', 'open');
  await nextFrame(page);
  return page.evaluate(() => (window as unknown as { __menuFrames: MenuFrame[] }).__menuFrames);
}

test.describe('the real surfaces on the stage', () => {
  test('the window is the surfaces window: they open from the stage triggers and stay inside it', async ({ page }) => {
    await openStage(page, 'preset=tablet-portrait&selected=2', { width: 800, height: 1280 });
    await expect(page.locator('#window')).toHaveAttribute('data-vire-shell', '');
    await expect(page.locator('#stage-outline, #surface')).toHaveCount(0);
    for (const [host, form] of [['popover', 'popover'], ['sheet', 'bottom-sheet'], ['modal', 'centered-sheet']] as const) {
      await page.locator(`#${host}-trigger`).click();
      await expect(page.locator(`#${host}`)).toHaveAttribute('data-phase', 'open');
      await expect(page.locator(`#${host}`)).toHaveAttribute('data-form', form);
      expect((await surfaceNow(page))?.host).toBe(host);
      const win = await box(page, '#window');
      const surface = await box(page, `#${host}-surface`);
      expect(surface.x).toBeGreaterThanOrEqual(win.x - 0.5);
      expect(surface.x + surface.width).toBeLessThanOrEqual(win.x + win.width + 0.5);
      expect(surface.y + surface.height).toBeLessThanOrEqual(win.y + win.height + 12);
      await page.locator(`#${host}-close`).click();
      await expect(page.locator(`#${host}`)).not.toHaveAttribute('data-phase', /./);
      expect(await page.evaluate(() => window.__adaptive.app().surface)).toBeNull();
    }
  });

  test('the stage reads the element: its form, its phase, its detent, and what a side sheet clears', async ({ page }) => {
    await openStage(page, 'w=1000&h=800&surface=sheet&selected=2&input=pointer', { width: 1000, height: 800 });
    const now = await surfaceNow(page);
    const win = await box(page, '#window');
    const sheet = await box(page, '#sheet-surface');
    const clears = Math.round(sheet.width) + 16;
    expect(now).toMatchObject({ host: 'sheet', form: 'side-sheet', phase: 'open', insetEnd: clears });
    await expect(page.locator('[data-key="open surface"]')).toContainText('side-sheet · open');
    await expect(page.locator('[data-key="open surface"]')).toContainText(`clears ${clears} end`);
    for (const pane of ['list', 'detail']) {
      const locator = page.locator(`[data-pane=${pane}]`);
      if (!(await locator.isVisible())) continue;
      const r = (await locator.boundingBox())!;
      expect(r.x + r.width, `${pane} clears the side sheet`).toBeLessThanOrEqual(sheet.x + 0.5);
      expect(r.x + r.width).toBeLessThanOrEqual(win.x + win.width - clears + 0.5);
    }
    await set(page, { w: 700 });
    await whenOpen(page);
    await expect(page.locator('#sheet')).toHaveAttribute('data-form', 'bottom-sheet');
    expect((await surfaceNow(page))?.insetEnd).toBe(0);
    await expect(page.locator('[data-key="open surface"]')).toContainText('bottom-sheet · open · medium');
    const detail = await box(page, '[data-pane=detail]');
    expect(detail.x + detail.width).toBeGreaterThan(win.x + 700 - 40);
  });
});

test.describe('the content accessory beside a side sheet', () => {
  test('ends at the leading edge of a side sheet, and goes back to the margin when it closes', async ({ page }) => {
    await openStage(page, 'preset=tablet-landscape&selected=2&surface=sheet', { width: 1280, height: 800 });
    await whenOpen(page);
    await expect(page.locator('#sheet')).toHaveAttribute('data-form', 'side-sheet');
    await expect(page.locator('#accessory')).toHaveAttribute('data-placement', 'content-bottom');
    const sheet = await box(page, '#sheet-surface');
    const win = await box(page, '#window');
    const acc = await box(page, '#nav [data-accessory]');
    expect(acc.x + acc.width).toBeLessThanOrEqual(sheet.x - 8 + 0.5);
    expect(acc.x + acc.width).toBeGreaterThan(sheet.x - 24);
    await page.locator('#sheet-close').click();
    await expect(page.locator('#sheet')).not.toHaveAttribute('data-phase', /./);
    await settled(page);
    const back = await box(page, '#nav [data-accessory]');
    expect(back.x + back.width).toBeCloseTo(win.x + win.width - 8, 0);
  });
});

test.describe('a surface on a folded stage', () => {
  test('in book posture a popover grows inside the half of its trigger on every frame', async ({ page }) => {
    await openStage(page, 'preset=foldable-book&selected=2', { width: 673, height: 841 });
    const win = await box(page, '#window');
    for (const host of ['popover', 'sheet']) {
      const frames = await surfaceRun(page, host);
      expect(frames.length, host).toBeGreaterThan(5);
      for (const f of frames) expect(f.x + f.w, host).toBeLessThanOrEqual(win.x + 673 / 2 + 0.5);
      await page.locator(`#${host}-close`).click();
      await expect(page.locator(`#${host}`)).not.toHaveAttribute('data-phase', /./);
    }
  });

  test('canary: a window that reports no fold lets the same sheet cross it', async ({ page }) => {
    await openStage(page, 'preset=foldable-book&selected=2&foldaware=0', { width: 673, height: 841 });
    const win = await box(page, '#window');
    const foldX = win.x + 673 / 2;
    expect((await surfaceRun(page, 'sheet')).some((f) => f.x < foldX - 0.5 && f.x + f.w > foldX + 0.5)).toBe(true);
  });
});

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
    // A compact tabletop keeps the bar whether or not the window knows its fold; with the fold low, the half under it is shorter than the menu.
    await openStage(page, 'w=560&h=800&posture=tabletop&fold=560&input=touch&selected=2', { width: 560, height: 800 });
    const aware = await box(page, '#window');
    for (const f of await menuRun(page, 'accessory-more')) expect(f.y).toBeGreaterThanOrEqual(aware.y + 560 - 0.5);
    await openStage(page, 'w=560&h=800&posture=tabletop&fold=560&input=touch&selected=2&foldaware=0', { width: 560, height: 800 });
    const tabletop = await box(page, '#window');
    const foldY = tabletop.y + 560;
    expect((await menuRun(page, 'accessory-more')).some((f) => f.y < foldY - 0.5 && f.y + f.h > foldY + 0.5)).toBe(true);
  });
});

// The recording stand-in for `vireglass/dom` sees which lens is attached to what and which are alive.
const RECORDING_LENS = `
const flat = { luma: 0.9, busy: 0, lo: 0.9, hi: 0.9, r: 0.9, g: 0.9, b: 0.9 };
export function probeBackdrop() { return flat; }
export function statsFromSamples() { return flat; }
export function attachGlass(el, opts) {
  const kind = el.matches('vire-nav > nav') ? 'nav-body' : el.hasAttribute('data-vk-lens') ? 'nav-lens' : el.hasAttribute('data-accessory') ? 'nav-accessory' : 'atom';
  const rec = { kind, alive: true, updates: 0 };
  (window.__lenses ??= []).push(rec);
  el.style.setProperty('backdrop-filter', 'blur(1px)');
  return {
    update() { rec.updates += 1; },
    setMorph() { rec.updates += 1; },
    setAppear() {}, setSample() {}, setInterim() {}, setAccent() {}, setNeighbourGlow() {},
    destroy() { rec.alive = false; },
  };
}`;

type Count = { attached: number; alive: number; updates: number };

/** What each kind of lens has been through: how many were attached, how many are live now, how many reshapes they were handed. */
async function lensCounts(page: Page) {
  const by = await page.evaluate(() => {
    const out: Record<string, { attached: number; alive: number; updates: number }> = {};
    for (const l of (window as unknown as { __lenses?: { kind: string; alive: boolean; updates: number }[] }).__lenses ?? []) {
      const t = (out[l.kind] ??= { attached: 0, alive: 0, updates: 0 });
      t.attached += 1;
      t.alive += l.alive ? 1 : 0;
      t.updates += l.updates;
    }
    return out;
  });
  const none: Count = { attached: 0, alive: 0, updates: 0 };
  return { atom: by['atom'] ?? none, body: by['nav-body'] ?? none, accessory: by['nav-accessory'] ?? none, lens: by['nav-lens'] ?? none };
}

test.describe('while the window is dragged', () => {
  test('no lens is rebuilt: the atoms keep their glass and geometry, the navigation its body and accessory, and the selection\'s lens exists for a form change only', async ({ page }) => {
    await page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS }));
    await openStage(page, 'w=360&h=900&input=mixed&selected=2', { width: 1600, height: 900 });
    const before = await lensCounts(page);
    expect(before.atom.attached).toBeGreaterThan(3);
    expect([before.body.attached, before.accessory.attached, before.lens.attached]).toEqual([1, 1, 1]);
    await page.evaluate(() => window.__adaptive.run('sweep'));
    await settled(page);
    const after = await lensCounts(page);
    expect(after.atom, 'the atoms are neither rebuilt nor reshaped').toEqual(before.atom);
    expect([after.body.attached, after.body.alive], 'the body is not rebuilt').toEqual([1, 1]);
    expect([after.accessory.attached, after.accessory.alive], 'nor the accessory').toEqual([1, 1]);
    expect([after.lens.attached, after.lens.alive], 'the lens of the selection is attached ahead, once, and not rebuilt by a form change').toEqual([1, 1]);
    await page.locator('#open button').click();
    await expect.poll(async () => (await lensCounts(page)).atom.updates).toBeGreaterThan(before.atom.updates);
  });

  test('within a class the window is dragged without reshaping the navigation\'s glass', async ({ page }) => {
    await page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS }));
    await openStage(page, 'w=420&h=900&input=mixed&selected=2', { width: 700, height: 900 });
    const before = await lensCounts(page);
    for (let w = 420; w <= 590; w += 10) {
      await set(page, { w });
      await nextFrame(page);
    }
    await settled(page);
    expect(await lensCounts(page)).toEqual(before);
  });
});

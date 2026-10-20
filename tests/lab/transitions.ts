import type { Page } from '@playwright/test';
import { nextFrame, openCase } from './helpers';

// The transitions of every element whose glass changes shape over frames. The motion gate counts the core's work over
// them (`motion-behavior.spec.ts`, in CI) and the frame gate times their frames (`perf.spec.ts`, local, with a GPU).
// One list, so the two cannot drift apart: what is counted is what is timed.

export type Stats = { probes: number; fullBakes: number; reducedBakes: number; filterSwaps: number };

export type Transition = {
  name: string;
  /** The lab page, without `glass`; the gate adds it. */
  query: string;
  /** The glass surfaces that move or land in this transition, as a selector. */
  surfaces: string;
  /** In-page expression: true while the transition is running. */
  active: string;
  /** Gets the page to where `run` starts, and waits for it to be still. */
  prepare?: (page: Page) => Promise<void>;
  run: (page: Page) => Promise<void>;
  /** The most glass surfaces the transition has any reason to bring into being: its triggers, capsules or popovers, not one per frame. */
  created: number;
  /** False where the landing has nothing to bake: the shape it returns to is the one the lens still holds the maps of. */
  rebakes?: boolean;
};

const VIEW = { width: 1500, height: 1000 };

const rest = (page: Page, expr: string) => page.waitForFunction((e) => !new Function(`return Boolean(${e})`)(), expr);

const NAV_ACTIVE =
  "(() => { const h = document.querySelector('vire-nav'); return h.hasAttribute('data-moving') || !!h.querySelector(':scope > [data-accessory][data-moving]'); })()";
const SHEET_ACTIVE = (id: string) =>
  `(() => { const h = document.getElementById('${id}'); return ['growing', 'morph'].includes(h.getAttribute('data-phase')) || h.hasAttribute('data-height'); })()`;
const TOOLBAR = 'view=toolbar&w=420&h=400&toolbar-placement=top&spacer=0';
const TOOLBAR_ACTIVE = "document.querySelector('vire-toolbar').hasAttribute('data-moving')";
const NAV_SURFACES = 'vire-nav > nav, vire-nav > [data-vk-lens], vire-nav > [data-accessory]';

/** One pointer step per animation frame, so the input arrives at the rate a hand would give it. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps: number): Promise<void> {
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await nextFrame(page);
  }
}

async function navOpen(page: Page, query: string, w: number, h: number, glass: string): Promise<void> {
  await page.setViewportSize(VIEW);
  await openCase(page, `view=nav&w=${w}&h=${h}&${query}&glass=${glass}`);
  await page.waitForFunction(() => document.querySelector('vire-nav')?.hasAttribute('data-vk'));
  await rest(page, NAV_ACTIVE);
  await nextFrame(page);
}

const resizeNav = (page: Page, w: number, h: number) => page.evaluate(([a, b]) => window.__lab.nav!.resize(a!, b!), [w, h]);
const scrollList = (page: Page, top: number) => page.evaluate((y) => (document.getElementById('scroller')!.scrollTop = y), top);

export const TRANSITIONS: Transition[] = [
  {
    name: 'navigation morph, bar to rail',
    query: 'view=nav&w=390&h=720',
    surfaces: NAV_SURFACES,
    active: NAV_ACTIVE,
    created: 0,
    run: (page) => resizeNav(page, 900, 720),
  },
  {
    name: 'navigation morph, rail to bar',
    query: 'view=nav&w=900&h=720',
    surfaces: NAV_SURFACES,
    active: NAV_ACTIVE,
    created: 0,
    run: (page) => resizeNav(page, 390, 720),
  },
  {
    name: 'navigation drag of the lens',
    query: 'view=nav&w=390&h=720',
    surfaces: 'vire-nav > [data-vk-lens]',
    active: "document.querySelector('vire-nav').hasAttribute('data-lens')",
    created: 0,
    async prepare(page) {
      const box = (await page.locator('vire-nav > nav').boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4 + 8, box.y + box.height / 2);
    },
    async run(page) {
      const box = (await page.locator('vire-nav > nav').boundingBox())!;
      const y = box.y + box.height / 2;
      const left = { x: box.x + 30, y };
      const right = { x: box.x + box.width - 30, y };
      await drag(page, { x: box.x + box.width * 0.4 + 8, y }, right, 24);
      await drag(page, right, left, 36);
      await page.mouse.up();
    },
  },
  {
    name: 'navigation minimising',
    query: 'view=nav&w=390&h=720&accessory=0',
    surfaces: NAV_SURFACES,
    active: NAV_ACTIVE,
    created: 0,
    run: (page) => scrollList(page, 240).then(() => undefined),
  },
  {
    name: 'navigation expanding',
    rebakes: false,
    query: 'view=nav&w=390&h=720&accessory=0',
    surfaces: NAV_SURFACES,
    active: NAV_ACTIVE,
    created: 0,
    async prepare(page) {
      await scrollList(page, 240);
      await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
      await rest(page, NAV_ACTIVE);
    },
    run: (page) => scrollList(page, 0).then(() => undefined),
  },
  {
    name: 'navigation accessory reshaped by minimising',
    query: 'view=nav&w=390&h=720',
    surfaces: NAV_SURFACES,
    active: NAV_ACTIVE,
    created: 0,
    run: (page) => scrollList(page, 240).then(() => undefined),
  },
  {
    name: 'menu growth',
    query: 'view=menu',
    surfaces: '#more > [popover], #more vire-icon-button > button',
    active: "document.getElementById('more').getAttribute('data-phase') === 'moving'",
    created: 0,
    run: (page) => page.locator('#more-trigger').click(),
  },
  {
    name: 'menu retraction',
    query: 'view=menu',
    surfaces: '#more > [popover], #more vire-icon-button > button',
    active: "document.getElementById('more').getAttribute('data-phase') === 'moving'",
    created: 1,
    async prepare(page) {
      await page.locator('#more-trigger').click();
      await page.waitForFunction(() => document.getElementById('more')!.getAttribute('data-phase') === 'open');
    },
    run: (page) => page.keyboard.press('Escape'),
  },
  ...(['pop', 'sup'] as const).flatMap((id): Transition[] => {
    const small = id === 'sup';
    const w = small ? 390 : 700;
    const label = id === 'pop' ? 'popover' : 'sheet';
    const surfaces = `#${id} > [popover], #${id} > vire-button > button`;
    return [
      {
        name: `${label} growth`,
        query: `view=sheet&w=${w}&h=720`,
        surfaces,
        active: SHEET_ACTIVE(id),
        created: 0,
        run: (page) => page.locator(`#${id}-trigger`).click(),
      },
      {
        name: `${label} retraction`,
        query: `view=sheet&w=${w}&h=720`,
        surfaces,
        active: SHEET_ACTIVE(id),
        created: 1,
        async prepare(page) {
          await page.locator(`#${id}-trigger`).click();
          await page.waitForFunction((i) => document.getElementById(i)!.getAttribute('data-phase') === 'open', id);
        },
        run: (page) => page.locator(`#${id}-close`).click(),
      },
    ];
  }),
  {
    name: 'popover as a bottom sheet, growth',
    query: 'view=sheet&w=390&h=720',
    surfaces: '#pop > [popover], #pop > vire-button > button',
    active: SHEET_ACTIVE('pop'),
    created: 0,
    run: (page) => page.locator('#pop-trigger').click(),
  },
  {
    name: 'sheet detent drag and spring',
    query: 'view=sheet&w=390&h=720&detents=medium',
    surfaces: '#sup > [popover], #sup > vire-button > button',
    active: SHEET_ACTIVE('sup'),
    created: 0,
    async prepare(page) {
      await page.locator('#sup-trigger').click();
      await page.waitForFunction(() => document.getElementById('sup')!.getAttribute('data-phase') === 'open' && !document.getElementById('sup')!.hasAttribute('data-height'));
    },
    async run(page) {
      const box = (await page.locator('#sup [data-vk-grabber]').boundingBox())!;
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await drag(page, from, { x: from.x, y: from.y - 220 }, 24);
      await page.mouse.up();
    },
  },
  {
    name: 'popover changing form to a sheet',
    query: 'view=sheet&w=700&h=720',
    surfaces: '#pop > [popover], #pop > vire-button > button',
    active: SHEET_ACTIVE('pop'),
    created: 0,
    async prepare(page) {
      await page.locator('#pop-trigger').click();
      await page.waitForFunction(() => document.getElementById('pop')!.getAttribute('data-phase') === 'open');
    },
    run: (page) => page.evaluate(() => window.__lab.sheet!.resize(390, 720)),
  },
  {
    name: 'toolbar stage change, merging',
    query: TOOLBAR,
    surfaces: 'vire-toolbar > [data-vk-capsule]',
    active: TOOLBAR_ACTIVE,
    created: 0,
    run: (page) => page.evaluate(() => window.__lab.toolbar!.resize(370, 400)),
  },
  {
    name: 'toolbar stage change, overflowing',
    query: TOOLBAR.replace('w=420', 'w=370'),
    surfaces: 'vire-toolbar > [data-vk-capsule]',
    active: TOOLBAR_ACTIVE,
    created: 0,
    run: (page) => page.evaluate(() => window.__lab.toolbar!.resize(300, 400)),
  },
  {
    name: 'toolbar change of place',
    rebakes: false,
    query: TOOLBAR,
    surfaces: 'vire-toolbar > [data-vk-capsule]',
    active: TOOLBAR_ACTIVE,
    created: 0,
    run: (page) => page.evaluate(() => document.querySelector('vire-toolbar')!.setAttribute('placement', 'bottom')),
  },
];

export type Recording = {
  /** Frame times, whether the transition was running at each, and the core's counters at each. */
  t: number[];
  active: boolean[];
  stats: Stats[];
  surfaces: number;
  /** Glass surfaces the transition brought into being: their first bake is theirs, not a rebuild of an existing one. */
  created: number;
  /** Lenses that entered interim during the recording, and lenses alive and still in interim when it ended. */
  interim: { entered: number; open: number };
};

const attached = (page: Page) => page.evaluate(() => window.__labAttached ?? 0);

/** Opens the case, gets to the start, then runs the transition under a per-frame recorder. */
export async function recordTransition(
  page: Page,
  transition: Transition,
  glass: '1' | '0',
  options: { query?: string; afterOpen?: (page: Page) => Promise<void> } = {},
): Promise<Recording> {
  await page.setViewportSize(VIEW);
  await openCase(page, `${transition.query}&glass=${glass}${options.query ? `&${options.query}` : ''}`);
  await page.waitForFunction(() => {
    const host = document.querySelector('vire-nav, vire-menu, vire-toolbar, vire-popover, vire-sheet');
    return !host || host.hasAttribute('data-vk');
  });
  if (glass === '1') await page.waitForFunction(() => document.querySelector('[data-glass="on"]') !== null || document.querySelector('vire-popover, vire-sheet') !== null);
  await nextFrame(page);
  await nextFrame(page);
  await rest(page, transition.active);
  await options.afterOpen?.(page);
  await transition.prepare?.(page);
  const before = await attached(page);
  await page.evaluate((expr) => {
    const active = new Function(`return Boolean(${expr})`) as () => boolean;
    const rec = { t: [] as number[], active: [] as boolean[], stats: [] as Stats[], stop: false };
    (window as unknown as { __rec: typeof rec }).__rec = rec;
    window.__lab.resetRenderStats();
    window.__labGlassMark?.();
    const loop = (t: number) => {
      rec.t.push(t);
      rec.active.push(active());
      rec.stats.push(window.__lab.renderStats());
      if (!rec.stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, transition.active);
  await transition.run(page);
  await page.waitForFunction(
    () => {
      const rec = (window as unknown as { __rec: { active: boolean[]; t: number[] } }).__rec;
      const n = rec.active.length;
      return rec.active.some(Boolean) && n > 10 && rec.active.slice(-45).every((a) => !a);
    },
    undefined,
    { timeout: 8000 },
  );
  const created = (await attached(page)) - before;
  const rec = await page.evaluate((selector) => {
    const rec = (window as unknown as { __rec: Omit<Recording, 'created' | 'interim'> & { stop: boolean } }).__rec;
    rec.stop = true;
    const surfaces = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => /url\(/.test(el.style.backdropFilter)).length;
    const lenses = window.__labGlass ?? [];
    const interim = { entered: lenses.filter((l) => l.entered).length, open: lenses.filter((l) => l.alive && l.interim === true).length };
    return { t: rec.t, active: rec.active, stats: rec.stats, surfaces, interim };
  }, transition.surfaces);
  return { ...rec, created };
}

export type FrameReport = { frames: number; p90: number; max: number; over: number };

/** How long after the last active frame the deferred landing is timed: it starts 120 ms later and its bakes are 50 ms apart. */
export const LANDING_WINDOW_MS = 400;

/** The intervals of the frames from the one that began the transition to LANDING_WINDOW_MS past the last active one, which is where the landing's bakes fall. */
export function frameReport(rec: Recording): FrameReport {
  const first = rec.active.indexOf(true);
  const last = rec.active.lastIndexOf(true);
  const until = rec.t[last]! + LANDING_WINDOW_MS;
  const gaps: number[] = [];
  for (let i = Math.max(first, 1); i < rec.t.length && rec.t[i - 1]! <= until; i += 1) gaps.push(rec.t[i]! - rec.t[i - 1]!);
  const sorted = [...gaps].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0;
  return { frames: gaps.length, p90, max: sorted.at(-1) ?? 0, over: gaps.filter((g) => g > 33).length };
}

/** What the core did while the transition ran, and the total once it had landed. */
export function workReport(rec: Recording): { during: Stats; landed: Stats } {
  const last = rec.active.lastIndexOf(true);
  return { during: rec.stats[last]!, landed: rec.stats.at(-1)! };
}

export type LensState = {
  geometry: { width: number; height: number; cornerRadius: number } | null;
  /** The element's own size, to hold the lens's geometry against. */
  size: { width: number; height: number };
  morph: unknown;
  appear: number;
  /** The element's own opacity: a fade used on the way must be gone once it has landed. */
  opacity: string;
};

/** What the live, visible lenses of these elements were last handed, in document order. Waits for every lens to be out of interim. */
export async function lensStates(page: Page, selector: string): Promise<LensState[]> {
  await page.waitForFunction(() => (window.__labGlass ?? []).length > 0 && window.__labGlass!.every((l) => !l.alive || l.interim !== true));
  await nextFrame(page);
  return page.evaluate((sel) => {
    const lenses = window.__labGlass ?? [];
    return [...document.querySelectorAll<HTMLElement>(sel)].flatMap((el) => {
      const lens = lenses.find((l) => l.alive && l.el === el);
      const r = el.getBoundingClientRect();
      // A lens parked out of sight (the navigation's, between drags) is 2 px and holds whatever it last had.
      if (!lens || el.hidden || r.width < 4 || r.height < 4) return [];
      const g = lens.options?.geometry as { width: number; height: number; cornerRadius: number } | undefined;
      return [{ size: { width: Math.round(r.width), height: Math.round(r.height) }, geometry: g ? { width: g.width, height: g.height, cornerRadius: g.cornerRadius } : null, morph: lens.morph && lens.morph.smoothing > 0 ? lens.morph : null, appear: lens.appear ?? 1, opacity: el.style.opacity }];
    });
  }, selector);
}

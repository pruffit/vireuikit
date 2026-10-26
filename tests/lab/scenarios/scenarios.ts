import type { Page } from '@playwright/test';
import { sleep } from './capture';
import { centerOf, click, drag, tap, walk, wheelScroll, type Point } from './inputs';
import type { Project } from './adapter';
import { KNOWN } from './known';
import type { Profile, Scenario } from './run';

const AWAY: Point = { x: 4, y: 4 };

const NAV_ITEMS = 'vire-nav > nav > ul:not([data-secondary]) > li > a';
const NAV_NAMES = ['Home', 'Library', 'Friends', 'Messages'];

const resizeNav = (page: Page, w: number, h: number) => page.evaluate(([a, b]) => window.__lab.nav!.resize(a!, b!), [w, h] as const);

/** Every link of the navigation that is drawn, as pointer targets. */
const navTargets = (page: Page) =>
  page.evaluate((selector) => [...document.querySelectorAll<HTMLElement>(selector)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })), NAV_ITEMS);

const menu: Scenario[] = [
  {

    name: 'menu open, close, open again',
    query: 'view=menu',
    owner: 'chrome=1&view=menu',
    viewport: { width: 520, height: 520 },
    track: { trigger: '#more vire-icon-button:not([data-carried]) > button', trigHost: '#more > vire-icon-button', list: '#more > [popover]', rows: '#more > [popover] > button' },
    view: ['trigger', 'list'],
    async act(ctx) {
      await ctx.page.locator('#more-trigger').click();
      await ctx.quiet();
      await ctx.page.keyboard.press('Escape');
      await ctx.quiet();
      await ctx.page.locator('#more-trigger').click();
    },
    gates: {
      seam: { keys: ['trigger', 'trigHost', 'list'] },
      shape: { keys: ['trigger'] },
      pop: { keys: ['trigHost'], surface: 'list' },
      hole: { target: 'trigHost', surface: 'list' },
      ghost: { surface: 'list', target: 'trigHost', part: 'rows' },
      together: { key: 'trigHost', surface: 'list' },
      box: { key: 'trigHost' },
      landing: {},
    },
  },
];

const popover: Scenario[] = [
  {

    name: 'popover open and close',
    query: 'view=sheet&w=700&h=720',
    viewport: { width: 760, height: 790 },
    track: { trigger: '#pop > vire-button:not([data-carried]) > button', trigHost: '#pop > vire-button', surface: '#pop > [popover]' },
    view: ['trigger', 'surface'],
    async act(ctx) {
      await ctx.page.locator('#pop-trigger').click();
      await ctx.quiet();
      await ctx.page.locator('#pop-close').click();
    },
    gates: { seam: { keys: ['trigger', 'trigHost', 'surface'] }, shape: { keys: ['trigger'] } },
  },
];

const GRABBER = { surface: 'surface', target: 'trigHost', part: 'grabber' };
const SHEET = 'view=sheet&w=390&h=720&detents=medium';
const sheetCase = {
  query: SHEET,
  owner: 'chrome=1&view=sheet',
  viewport: { width: 450, height: 780 },
  track: { trigger: '#sup > vire-button:not([data-carried]) > button', trigHost: '#sup > vire-button', surface: '#sup > [popover]', grabber: '#sup [data-vk-grabber]' },
  view: ['trigger', 'surface'],
  gates: { seam: { keys: ['trigger', 'trigHost', 'surface'] }, shape: { keys: ['trigger'] } },
} satisfies Partial<Scenario>;

const openSheet = async (page: Page) => {
  await page.locator('#sup-trigger').click();
  await page.waitForFunction(() => document.getElementById('sup')!.getAttribute('data-phase') === 'open');
  await sleep(2000);
};

const sheet: Scenario[] = [
  {
    ...sheetCase,

    name: 'sheet grow and collapse into its trigger',
    gates: { ...sheetCase.gates, ghost: GRABBER, pop: { keys: ['trigHost'] }, hole: { target: 'trigHost', surface: 'surface' } },
    async act(ctx) {
      await ctx.page.locator('#sup-trigger').click();
      await ctx.quiet();
      await ctx.page.evaluate(() => document.getElementById('sup-close')!.click());
    },
  },
  {
    ...sheetCase,

    name: 'sheet drag between detents',
    owner: 'chrome=1&view=sheet&detents=medium',
    prepare: openSheet,
    async act(ctx) {
      const { page } = ctx;
      const grab = await centerOf(page.locator('#sup [data-vk-grabber]'));
      await drag(page, grab, [{ x: grab.x, y: grab.y - 220 }]);
      await ctx.quiet();
      const second = await centerOf(page.locator('#sup [data-vk-grabber]'));
      await drag(page, second, [{ x: second.x, y: second.y + 260 }]);
    },
  },
  {
    ...sheetCase,

    name: 'sheet scroll its content',
    gates: { scrollbar: { within: '#sup', at: 'scrolled' } },
    prepare: openSheet,
    async act(ctx) {
      const body = (await ctx.page.locator('#sup > [popover]').boundingBox())!;
      await wheelScroll(ctx.page, { x: body.x + body.width / 2, y: body.y + body.height * 0.7 }, 400);
      await ctx.mark('scrolled');
      await ctx.quiet(800);
      await wheelScroll(ctx.page, { x: body.x + body.width / 2, y: body.y + body.height * 0.7 }, -400);
    },
  },
];

popover.push({

    name: 'popover as a bottom sheet, grow and collapse',
  query: 'view=sheet&w=390&h=720',
  owner: 'chrome=1&view=sheet',
  viewport: { width: 450, height: 780 },
  track: { trigger: '#pop > vire-button:not([data-carried]) > button', trigHost: '#pop > vire-button', surface: '#pop > [popover]', grabber: '#pop [data-vk-grabber]' },
  view: ['trigger', 'surface'],
  async act(ctx) {
    await ctx.page.locator('#pop-trigger').click();
    await ctx.quiet();
    await ctx.page.locator('#pop-close').click();
  },
  gates: { seam: { keys: ['trigger', 'trigHost', 'surface'] }, shape: { keys: ['trigger'] }, ghost: GRABBER, pop: { keys: ['trigHost'] }, hole: { target: 'trigHost', surface: 'surface' } },
});

const adaptiveCase = (id: 'sheet' | 'popover', label: string): Scenario => ({
  name: `adaptive ${label} grow and collapse`,
  query: 'view=adaptive',
  owner: 'chrome=1&view=adaptive',
  viewport: { width: 1000, height: 900 },
  track: { trigger: `#${id} > vire-button:not([data-carried]) > button`, trigHost: `#${id} > vire-button`, surface: `#${id} > [popover], #${id} > dialog`, grabber: `#${id} [data-vk-grabber]` },
  view: ['trigHost', 'surface'],
  async act(ctx) {
    await ctx.page.locator(`#${id}-trigger`).click();
    await ctx.quiet();
    await ctx.page.evaluate((close) => document.getElementById(close)!.click(), `${id}-close`);
  },
  gates: { seam: { keys: ['trigger', 'trigHost', 'surface'] }, shape: { keys: ['trigger'] }, ghost: { surface: 'surface', target: 'trigHost', part: 'grabber' }, pop: { keys: ['trigHost'] }, hole: { target: 'trigHost', surface: 'surface' } },
});

const adaptive: Scenario[] = [adaptiveCase('sheet', 'sheet'), adaptiveCase('popover', 'popover')];

const TOOLBAR = 'view=toolbar&w=420&h=400&toolbar-placement=top&spacer=0';
const resizeToolbar = (page: Page, w: number, h: number) => page.evaluate(([a, b]) => window.__lab.toolbar!.resize(a!, b!), [w, h] as const);
const TB_ITEM = 'vire-toolbar [data-group] > :is(vire-icon-button, vire-button) > button';
const TB_MORE = 'vire-toolbar > vire-menu[data-vk-more] > vire-icon-button';
const toolbar: Scenario[] = [
  {

    name: 'toolbar collapse into its button and expand',
    query: TOOLBAR,
    owner: 'chrome=1&view=toolbar',
    viewport: { width: 480, height: 460 },
    track: { more: TB_MORE, capsule: 'vire-toolbar > [data-vk-capsule]', item: TB_ITEM },
    view: ['more', 'capsule', 'item'],
    async act(ctx) {
      await resizeToolbar(ctx.page, 300, 400);
      await ctx.mark('layout1');
      await ctx.quiet();
      await resizeToolbar(ctx.page, 420, 400);
      await ctx.mark('layout2');
    },
    layouts: [
      { mark: 'layout1', apply: (p) => resizeToolbar(p, 300, 400) },
      { mark: 'layout2', apply: (p) => resizeToolbar(p, 420, 400) },
    ],
    ownerAs: {
      async act(ctx) {
        await resizeToolbar(ctx.page, 700, 720);
        await ctx.mark('layout1');
        await ctx.quiet();
        await resizeToolbar(ctx.page, 390, 720);
        await ctx.mark('layout2');
        await ctx.quiet();
        await resizeToolbar(ctx.page, 700, 720);
        await ctx.mark('layout3');
      },
      layouts: [
        { mark: 'layout1', apply: (p) => resizeToolbar(p, 700, 720) },
        { mark: 'layout2', apply: (p) => resizeToolbar(p, 390, 720) },
        { mark: 'layout3', apply: (p) => resizeToolbar(p, 700, 720) },
      ],
    },
    gates: { seam: { keys: ['more', 'capsule'] }, shape: { keys: ['more', 'capsule'], during: true } },
  },
  {
    name: 'toolbar change of place',
    query: TOOLBAR,
    owner: 'chrome=1&view=toolbar',
    viewport: { width: 480, height: 460 },
    track: { capsule: 'vire-toolbar > [data-vk-capsule]', item: TB_ITEM },
    view: ['capsule'],
    async act(ctx) {
      await ctx.page.evaluate(() => document.querySelector('vire-toolbar')!.setAttribute('placement', 'bottom'));
      await ctx.quiet();
      await ctx.page.evaluate(() => document.querySelector('vire-toolbar')!.setAttribute('placement', 'top'));
    },
    gates: { seam: { keys: ['capsule'] } },
  },
  {

    name: 'toolbar hover each button',
    query: TOOLBAR,
    owner: 'chrome=1&view=toolbar',
    viewport: { width: 480, height: 460 },
    track: { item: TB_ITEM, capsule: 'vire-toolbar > [data-vk-capsule]' },
    view: ['item', 'capsule'],
    async act(ctx) {
      const { page } = ctx;
      await page.mouse.move(AWAY.x, AWAY.y);
      const targets = await page.evaluate((s) => [...document.querySelectorAll<HTMLElement>(s)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })), TB_ITEM);
      let at = AWAY;
      for (const [i, p] of targets.entries()) {
        await walk(page, at, p, 500);
        await ctx.quiet(700);
        await ctx.mark(`hover${i}`);
        at = p;
      }
    },
    gates: { shape: { keys: ['item'], ref: 'rest' } },
    states: 'item',
  },
];

const nav: Scenario[] = [
  {

    name: 'navigation drag the lens across all items and back',
    query: 'view=nav&w=390&h=720',
    owner: 'chrome=1&view=nav',
    viewport: { width: 450, height: 780 },
    track: { items: NAV_ITEMS, lens: 'vire-nav > [data-vk-lens]', bar: 'vire-nav > nav' },
    view: ['bar', 'lens'],
    async act(ctx) {
      const { page } = ctx;
      const targets = await navTargets(page);
      const first = targets[0]!;
      await drag(page, first, [...targets.slice(1), ...targets.slice(0, -1).reverse()], 600);
    },
    gates: { vanish: { key: 'items', label: (i) => NAV_NAMES[i] ?? `#${i}` }, seam: { keys: ['bar', 'lens'] } },
  },
  {
    name: 'navigation tap each item',
    query: 'view=nav&w=390&h=720',
    owner: 'chrome=1&view=nav',
    viewport: { width: 450, height: 780 },
    track: { items: NAV_ITEMS, lens: 'vire-nav > [data-vk-lens]', bar: 'vire-nav > nav' },
    view: ['bar', 'lens'],
    async act(ctx) {
      const targets = await navTargets(ctx.page);
      for (const p of [...targets.slice(1), ...targets.slice(0, 1)]) {
        await tap(ctx.page, p);
        await ctx.quiet(1600);
      }
    },
    gates: { vanish: { key: 'items', label: (i) => NAV_NAMES[i] ?? `#${i}` }, seam: { keys: ['bar', 'lens'] } },
  },
  {
    name: 'navigation tap each item by touch',
    query: 'view=nav&w=390&h=720',
    owner: 'chrome=1&view=nav',
    viewport: { width: 450, height: 780 },
    touch: true,
    track: { items: NAV_ITEMS, lens: 'vire-nav > [data-vk-lens]', bar: 'vire-nav > nav' },
    view: ['bar', 'lens'],
    async act(ctx) {
      const targets = await navTargets(ctx.page);
      for (const p of [...targets.slice(1), ...targets.slice(0, 1)]) {
        await ctx.page.touchscreen.tap(p.x, p.y);
        await ctx.quiet(1600);
      }
    },
    gates: { vanish: { key: 'items', label: (i) => NAV_NAMES[i] ?? `#${i}` }, seam: { keys: ['bar', 'lens'] } },
  },
  {

    name: 'navigation tap during a form morph',
    query: 'view=nav&w=390&h=720',
    owner: 'chrome=1&view=nav',
    viewport: { width: 1000, height: 780 },
    track: { items: NAV_ITEMS, lens: 'vire-nav > [data-vk-lens]', bar: 'vire-nav > nav' },
    view: ['bar', 'lens'],
    async act(ctx) {
      const { page } = ctx;
      await resizeNav(page, 900, 720);
      await sleep(160);
      const targets = await navTargets(page);
      await tap(page, targets[2]!);
      await ctx.quiet();
      await resizeNav(page, 390, 720);
      await sleep(160);
      const back = await navTargets(page);
      await tap(page, back[3]!);
    },
    gates: { seam: { keys: ['bar', 'lens'] } },
  },
  {

    name: 'navigation resize bar, rail, sidebar and back',
    query: 'view=nav&w=390&h=720',
    owner: 'chrome=1&view=nav',
    viewport: { width: 1340, height: 820 },
    track: { bar: 'vire-nav > nav', lens: 'vire-nav > [data-vk-lens]', accessory: 'vire-nav > [data-accessory]' },
    view: ['bar', 'lens', 'accessory'],
    async act(ctx) {
      for (const [w, h] of [[900, 720], [1280, 800], [900, 720], [390, 720]] as const) {
        await resizeNav(ctx.page, w, h);
        await ctx.quiet();
      }
    },
    gates: { seam: { keys: ['bar', 'lens', 'accessory'] } },
  },
  {
    name: 'navigation hover each item',
    query: 'view=nav&w=390&h=720',
    owner: 'chrome=1&view=nav',
    viewport: { width: 450, height: 780 },
    track: { items: NAV_ITEMS, bar: 'vire-nav > nav' },
    view: ['bar'],
    async act(ctx) {
      const { page } = ctx;
      await page.mouse.move(AWAY.x, AWAY.y);
      const targets = await navTargets(page);
      let at = AWAY;
      for (const [i, p] of targets.entries()) {
        await walk(page, at, p, 500);
        await ctx.quiet(700);
        await ctx.mark(`hover${i}`);
        at = p;
      }
    },
    gates: {},
    states: 'items',
  },
];

const navClicks = (name: string, act: Scenario['act']): Scenario => ({
  name,
  query: 'view=nav&w=390&h=720',
  owner: 'chrome=1&view=nav',
  viewport: { width: 450, height: 780 },
  track: { items: NAV_ITEMS, lens: 'vire-nav > [data-vk-lens]', bar: 'vire-nav > nav' },
  view: ['bar', 'lens'],
  act,
  gates: { vanish: { key: 'items', label: (i) => NAV_NAMES[i] ?? `#${i}` }, seam: { keys: ['bar', 'lens'] }, converge: { keys: ['bar'] } },
});

const navClick: Scenario[] = [
  navClicks('navigation click each item at normal speed', async (ctx) => {
    const targets = await navTargets(ctx.page);
    for (const p of [...targets.slice(1), ...targets.slice(0, 1)]) {
      await click(ctx.page, p);
      await ctx.quiet(1600);
    }
  }),
  navClicks('navigation click different items 250 ms apart', async (ctx) => {
    const targets = await navTargets(ctx.page);
    for (const k of [2, 0, 3, 1, 2]) {
      const began = Date.now();
      await click(ctx.page, targets[k]!, { hover: 20, hold: 70, speed: 1800 });
      await sleep(Math.max(0, 250 - (Date.now() - began)));
    }
  }),
  navClicks('navigation click the selected item', async (ctx) => {
    const targets = await navTargets(ctx.page);
    await click(ctx.page, targets[2]!);
    await ctx.quiet(1600);
    await click(ctx.page, targets[2]!);
    await ctx.quiet(1600);
    await click(ctx.page, targets[2]!, { hover: 40 });
  }),
  navClicks('navigation click while the selection is still moving', async (ctx) => {
    const targets = await navTargets(ctx.page);
    await click(ctx.page, targets[3]!, { hover: 60 });
    await sleep(90);
    await click(ctx.page, targets[1]!, { hover: 20, hold: 60, speed: 1800 });
    await sleep(90);
    await click(ctx.page, targets[2]!, { hover: 20, hold: 60, speed: 1800 });
  }),
  navClicks('navigation click each item with a slip of a few px', async (ctx) => {
    const targets = await navTargets(ctx.page);
    for (const [n, p] of [...targets.slice(1), ...targets.slice(0, 1)].entries()) {
      await click(ctx.page, p, { drift: 3 + (n % 4) });
      await ctx.quiet(1600);
    }
  }),
];

const BACKDROPS = ['light', 'dark', 'busy', 'mid', 'split'] as const;
const ATOMS = [
  { id: 'play', label: 'button' },
  { id: 'share', label: 'icon button' },
] as const;

const atoms: Scenario[] = BACKDROPS.flatMap((backdrop) =>
  ATOMS.flatMap(({ id, label }): Scenario[] => {
    const base = {
      query: `view=sandbox&backdrop=${backdrop}&split=%23${id}`,
      owner: `chrome=1&view=sandbox&backdrop=${backdrop}&split=%23${id}`,
      viewport: { width: 800, height: 320 },
      track: { atom: `#${id} > button` },
      view: ['atom'],
    };
    return [
      {
        ...base,
        name: `${label} hover on ${backdrop}`,
        async act(ctx) {
          const { page } = ctx;
          await page.mouse.move(AWAY.x, AWAY.y);
          await walk(page, AWAY, await centerOf(page.locator(`#${id} > button`)), 500);
          await ctx.quiet(1000);
          await ctx.mark('hover');
          await walk(page, await centerOf(page.locator(`#${id} > button`)), AWAY, 500);
        },
        gates: { state: { key: 'atom', at: 'hover' }, ...(backdrop === 'split' ? {} : { highlight: { key: 'atom', at: 'hover' } }), shape: { keys: ['atom'], ref: 'rest' } },
      },
      {
        ...base,
        name: `${label} press on ${backdrop}`,
        async act(ctx) {
          const { page } = ctx;
          await page.mouse.move(AWAY.x, AWAY.y);
          const c = await centerOf(page.locator(`#${id} > button`));
          await walk(page, AWAY, c, 500);
          await ctx.quiet(900);
          await page.mouse.down();
          await ctx.quiet(900);
          await ctx.mark('press');
          await page.mouse.up();
        },
        gates: { state: { key: 'atom', at: 'press' } },
      },
    ];
  }),
);

export const SCENARIOS: Scenario[] = [...menu, ...popover, ...sheet, ...adaptive, ...toolbar, ...nav, ...navClick, ...atoms];

/** A maximised Chrome window on a 1920 × 1080 screen at 100 % scale. */
export const OWNER_VIEWPORT = { width: 1920, height: 960 };

const withKnown = (s: Scenario, profile: Profile): Scenario => ({ ...s, profile, known: KNOWN[s.name.replace(/ @owner$/, '')] ?? {} });

export function scenariosFor(project: Project): Scenario[] {
  if (project === 'swiftshader') return SCENARIOS.map((s) => withKnown(s, 'swiftshader'));
  const owner = SCENARIOS.filter((s) => s.owner).map((s) => ({ ...s, ...s.ownerAs, name: `${s.name} @owner`, query: s.owner!, viewport: OWNER_VIEWPORT }));
  return [...owner.map((s) => withKnown(s, 'gpu@owner')), ...SCENARIOS.map((s) => withKnown(s, 'gpu'))];
}

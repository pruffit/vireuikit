import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import type { RenderStats } from 'vireglass/dom';
import type { Rect } from './color';

/** One tracked element at one frame: its box, the radius it declares (clamped to the box) and whether it is drawn at all. */
export type Box = Rect & { r: number; hidden: boolean };
export type Sample = { t: number; boxes: Record<string, Box[]> };
export type Shot = { t: number; png: Buffer };
export type Segment = { start: number; end: number };

export type Recording = {
  name: string;
  viewport: { width: number; height: number };
  /** Every frame the compositor presented, `t` in epoch milliseconds. */
  shots: Shot[];
  /** When the first input of the scenario was issued. */
  input: number;
  /** The kit's motions, from the first frame requested to the last one run. */
  motion: Segment[];
  /** Named instants the scenario set: the moment a state is meant to have settled, say. */
  marks: Record<string, number>;
  samples: Sample[];
  /** The page behind the kit's elements, for the shape gate: as it is at the start, and again after each layout change the scenario marked. */
  backdrops: { mark: string | null; png: Buffer }[];
  pageErrors: string[];
  scrollers: Scroller[];
  /** The core's work counters over the scenario (`renderStats`), or null on a page that has none. */
  stats: RenderStats | null;
};

/** A scroll container found inside a kit surface: where its content is, how wide the platform's scrollbar is, and what its styles say about the bar. */
export type Scroller = { name: string; x: number; y: number; w: number; h: number; gutter: number; scrollbarWidth: string; webkit: string };

export type Track = Record<string, string>;
export type RecordContext = {
  page: Page;
  /** Waits until no kit motion runs and `ms` have passed since the last one ended (and since this call). */
  quiet(ms?: number): Promise<void>;
  mark(name: string): Promise<void>;
  sleep(ms: number): Promise<void>;
};

export const QUIET_MS = 1500;
const START_STILL_MS = 400;
const LIMIT_MS = 30_000;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Scn = { motion: { s: string; t: number }[]; samples: unknown[]; running: boolean; stop: boolean };

/** In-page, before any script: the probe the kit's motion machinery reports to. */
export async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __scn: Scn };
    w.__scn = { motion: [], samples: [], running: false, stop: false };
    (globalThis as { __vireMotion?: (s: string) => void }).__vireMotion = (s) => {
      w.__scn.running = s === 'start';
      w.__scn.motion.push({ s, t: performance.timeOrigin + performance.now() });
    };
  });
}

/** Reads the tracked boxes after each frame's callbacks (the kit's among them) have run, not before. */
async function startSampler(page: Page, track: Track): Promise<void> {
  await page.evaluate((spec) => {
    const w = window as unknown as { __scn: Scn };
    const channel = new MessageChannel();
    let t = 0;
    channel.port1.onmessage = () => {
      const boxes: Record<string, unknown[]> = {};
      for (const [key, selector] of Object.entries(spec)) {
        boxes[key] = [...document.querySelectorAll<HTMLElement>(selector)].map((el) => {
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, b.width / 2, b.height / 2);
          const hidden = b.width === 0 || b.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0;
          return { x: b.x, y: b.y, w: b.width, h: b.height, r: radius, hidden };
        });
      }
      w.__scn.samples.push({ t, boxes });
    };
    const loop = () => {
      if (w.__scn.stop) return;
      t = performance.timeOrigin + performance.now();
      channel.port2.postMessage(0);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, track);
}

const HIDE = 'vire-button,vire-icon-button,vire-menu,vire-nav,vire-toolbar,vire-popover,vire-sheet,[popover],dialog,[data-scn-hide]{visibility:hidden!important}';

/** A layout change a scenario makes (a resize, say): `apply` repeats it on the page the backdrop is read from, and the scenario marks the instant it makes it. */
export type Layout = { mark: string; apply: (page: Page) => Promise<void> };

/** The page as it is behind the kit: the same case in a second page, every kit element hidden, read again after each layout change. */
async function backdropsOf(context: BrowserContext, open: (page: Page) => Promise<void>, viewport: { width: number; height: number }, layouts: Layout[]): Promise<Recording['backdrops']> {
  const page = await context.newPage();
  const frame = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  try {
    await page.setViewportSize(viewport);
    await open(page);
    await page.addStyleTag({ content: HIDE });
    await frame();
    const out: Recording['backdrops'] = [{ mark: null, png: await page.screenshot({ type: 'png' }) }];
    for (const layout of layouts) {
      await layout.apply(page);
      await sleep(1200);
      await frame();
      out.push({ mark: layout.mark, png: await page.screenshot({ type: 'png' }) });
    }
    return out;
  } finally {
    await page.close();
  }
}

const warmed = new WeakSet<Browser>();

/** The first seconds of a GPU process compile shaders and stall frames; one throw-away page with a filter and a moving backdrop pays that before anything is recorded. */
export async function warmUp(browser: Browser): Promise<void> {
  if (warmed.has(browser)) return;
  warmed.add(browser);
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  try {
    await page.setContent(
      '<body style="margin:0;background:linear-gradient(135deg,#f6e6c4,#223)"><svg width="0" height="0"><filter id="f"><feTurbulence baseFrequency=".02" numOctaves="2"/><feDisplacementMap in="SourceGraphic" scale="20"/></filter></svg><div id="a" style="position:absolute;left:100px;top:100px;width:300px;height:200px;border-radius:40px;backdrop-filter:blur(12px) saturate(1.4);filter:url(#f);background:rgba(255,255,255,.25)"></div><script>let n=0;(function f(){n+=1;document.getElementById("a").style.transform="translate("+(n%300)+"px,"+(n%120)+"px)";requestAnimationFrame(f)})()</script>',
    );
    await sleep(2000);
  } finally {
    await page.close();
  }
}

export type RecordOptions = {
  name: string;
  page: Page;
  context: BrowserContext;
  viewport: { width: number; height: number };
  track: Track;
  act: (ctx: RecordContext) => Promise<void>;
  /** Wanted by the shape gate: opens the same case in another page, to read it with the kit's elements hidden. */
  backdrop?: (page: Page) => Promise<void>;
  layouts?: Layout[];
  /** A selector: every element inside it that scrolls is read at the end of the scenario. */
  scrollers?: string;
};

/**
 * Plays one scenario and keeps every frame the compositor presents, from before the first input until
 * `QUIET_MS` after the last kit motion ends. The screencast delivers a frame per compositor frame that changed, as
 * lossless PNG; a still page delivers none, which is what "nothing changed" is.
 */
export async function record(o: RecordOptions): Promise<Recording> {
  const { page } = o;
  const pageErrors: string[] = [];
  const onError = (e: Error) => pageErrors.push(e.message);
  page.on('pageerror', onError);
  const backdrops = o.backdrop ? await backdropsOf(o.context, o.backdrop, o.viewport, o.layouts ?? []) : [];
  const cdp: CDPSession = await o.context.newCDPSession(page);
  const shots: Shot[] = [];
  cdp.on('Page.screencastFrame', (e) => {
    shots.push({ t: e.metadata.timestamp! * 1000, png: Buffer.from(e.data, 'base64') });
    void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => undefined);
  });
  await page.evaluate(() => (window as unknown as { __lab?: { resetRenderStats?(): void } }).__lab?.resetRenderStats?.());
  await startSampler(page, o.track);
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(START_STILL_MS);

  const marks: Record<string, number> = {};
  const epoch = () => page.evaluate(() => performance.timeOrigin + performance.now());
  const state = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __scn: Scn }).__scn;
      return { running: s.running, lastEnd: [...s.motion].reverse().find((m) => m.s === 'end')?.t ?? 0, now: performance.timeOrigin + performance.now() };
    });
  const ctx: RecordContext = {
    page,
    sleep,
    mark: async (name) => void (marks[name] = await epoch()),
    async quiet(ms = QUIET_MS) {
      const from = await epoch();
      const deadline = Date.now() + LIMIT_MS;
      for (;;) {
        const s = await state();
        if (!s.running && s.now - Math.max(s.lastEnd, from) >= ms) return;
        if (Date.now() > deadline) throw new Error(`${o.name}: the kit never went quiet within ${LIMIT_MS} ms`);
        await sleep(40);
      }
    },
  };
  const input = await epoch();
  marks['input'] = input;
  try {
    await o.act(ctx);
    await ctx.quiet();
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    page.off('pageerror', onError);
  }
  const scrollers = o.scrollers
    ? await page.evaluate((root) => {
        const out: Scroller[] = [];
        for (const host of document.querySelectorAll(root)) {
          for (const el of [host as HTMLElement, ...host.querySelectorAll<HTMLElement>('*')]) {
            const cs = getComputedStyle(el);
            if (!/auto|scroll/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
            const b = el.getBoundingClientRect();
            const bar = getComputedStyle(el, '::-webkit-scrollbar');
            out.push({
              name: `${el.localName}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`,
              x: b.x + el.clientLeft,
              y: b.y + el.clientTop,
              w: el.clientWidth,
              h: el.clientHeight,
              gutter: el.offsetWidth - el.clientWidth - el.clientLeft * 2,
              scrollbarWidth: cs.scrollbarWidth,
              webkit: `${bar.display}/${bar.width}`,
            });
          }
        }
        return out;
      }, o.scrollers)
    : [];
  const stats = await page.evaluate(() => (window as unknown as { __lab?: { renderStats?(): RenderStats } }).__lab?.renderStats?.() ?? null);
  const scn = await page.evaluate(() => {
    const s = (window as unknown as { __scn: Scn }).__scn;
    s.stop = true;
    return { motion: s.motion, samples: s.samples as unknown as Sample[] };
  });
  await cdp.detach().catch(() => undefined);

  const motion: Segment[] = [];
  let open: number | null = null;
  for (const m of scn.motion) {
    if (m.t < input - 1) continue;
    if (m.s === 'start' && open === null) open = m.t;
    else if (m.s === 'end' && open !== null) {
      const last = motion[motion.length - 1];
      if (last && open - last.end < 50) last.end = m.t;
      else motion.push({ start: open, end: m.t });
      open = null;
    }
  }
  return { name: o.name, viewport: o.viewport, shots, input, motion, marks, samples: scn.samples, backdrops, pageErrors, scrollers, stats };
}

/** The sample taken in the frame at or before `t`. */
export function sampleAt(samples: Sample[], t: number): Sample | null {
  let lo = 0;
  let hi = samples.length - 1;
  let found: Sample | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) {
      found = samples[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found ?? samples[0] ?? null;
}

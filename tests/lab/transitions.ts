import type { Page } from '@playwright/test';
import { nextFrame, openCase } from './helpers';

// The transitions of every element whose glass changes shape over frames. The motion gate counts the core's work over
// them (`motion-behavior.spec.ts`, in CI) and the frame gate times their frames (`perf.spec.ts`, local, with a GPU).
// One list, so the two cannot drift apart: what is counted is what is timed.

export type Stats = import('vireglass/dom').RenderStats;

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
  /** The surface announces where it lands (`prepare`) and lands in its last frame: the landing is exact, with no probe, blend or swap of its own. */
  prepares?: boolean;
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
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps: number): Promise<void> {
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
    prepares: true,
    run: (page) => page.locator('#more-trigger').click(),
  },
  {
    name: 'menu retraction',
    query: 'view=menu',
    surfaces: '#more > [popover], #more vire-icon-button > button',
    active: "document.getElementById('more').getAttribute('data-phase') === 'moving'",
    created: 0,
    prepares: true,
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

/** A long animation frame as the page reported it (only frames over 50 ms are reported). */
export type Loaf = {
  startTime: number;
  duration: number;
  renderStart: number;
  styleAndLayoutStart: number;
  blockingDuration: number;
  scripts: { invoker: string; invokerType: string; sourceURL: string; sourceFunctionName: string; startTime: number; duration: number; forcedStyleAndLayoutDuration: number }[];
};

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
  loaf: Loaf[];
  /** `performance.now()` of the `vk-rec` mark set as the recording started, which a trace carries on its own clock. */
  sync: number;
};

/** In-page: a recorder's state, kept on `window.__rec`. */
type PageRecorder = { t: number[]; active: boolean[]; stats: Stats[]; loaf: Loaf[]; sync: number; stop: boolean };

/**
 * A canary, on that frame after the first active one: `block` holds the main thread for `ms` inside the frame,
 * `task` in a task of its own after it, `gpu` draws one expensive fragment shader on a canvas, and `compile` links a
 * WebGL program whose source has never been seen.
 */
export type Busy = { frame: number; kind: 'block' | 'task' | 'gpu' | 'compile'; ms: number };

/** In-page: the canvas and program a `gpu` or `compile` canary draws with, made before the recording so only the canary's own work is in it. */
type CanaryGl = { gl: WebGLRenderingContext; program: WebGLProgram; iterations: WebGLUniformLocation | null };

/** Starts the per-frame recorder in the page. */
const startRecorder = (page: Page, active: string, busy?: Busy) =>
  page.evaluate(
    ([expr, busy]) => {
      const isActive = new Function(`return Boolean(${expr})`) as () => boolean;
      const rec: PageRecorder = { t: [], active: [], stats: [], loaf: [], sync: 0, stop: false };
      (window as unknown as { __rec: PageRecorder }).__rec = rec;
      const observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Loaf[]) {
          const { startTime, duration, renderStart, styleAndLayoutStart, blockingDuration } = e;
          const scripts = e.scripts.map((s) => ({ invoker: s.invoker, invokerType: s.invokerType, sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName, startTime: s.startTime, duration: s.duration, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration }));
          rec.loaf.push({ startTime, duration, renderStart, styleAndLayoutStart, blockingDuration, scripts });
        }
        if (rec.stop) observer.disconnect();
      });
      try {
        observer.observe({ type: 'long-animation-frame' });
      } catch {
        // Not every engine has it; the recording stands without it.
      }
      let canvas: HTMLCanvasElement | null = null;
      let drawn: CanaryGl | null = null;
      const source = (gl: WebGLRenderingContext, type: number, text: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, text);
        gl.compileShader(shader);
        return shader;
      };
      const link = (gl: WebGLRenderingContext, fragment: string): WebGLProgram => {
        const program = gl.createProgram()!;
        gl.attachShader(program, source(gl, gl.VERTEX_SHADER, 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'));
        gl.attachShader(program, source(gl, gl.FRAGMENT_SHADER, fragment));
        gl.linkProgram(program);
        return program;
      };
      if (busy && (busy.kind === 'gpu' || busy.kind === 'compile')) {
        canvas = document.createElement('canvas');
        canvas.width = 1500;
        canvas.height = 1000;
        canvas.dataset.canary = '';
        canvas.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0.99';
        document.body.append(canvas);
        const gl = canvas.getContext('webgl')!;
        const program = link(gl, 'precision highp float; uniform float n; void main() { float v = gl_FragCoord.x; for (float i = 0.0; i < 100000.0; i += 1.0) { if (i >= n) break; v = sin(v) * 1.0001 + cos(v * i); } gl_FragColor = vec4(fract(v), 0.2, 0.3, 1.0); }');
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const at = gl.getAttribLocation(program, 'p');
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
        drawn = { gl, program, iterations: gl.getUniformLocation(program, 'n') };
        gl.uniform1f(drawn.iterations, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      const gpuCanary = () => {
        const { gl, iterations } = drawn!;
        gl.uniform1f(iterations, 1500);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.flush();
      };
      const compileCanary = () => {
        const { gl } = drawn!;
        const unique = `// ${Math.random()}
precision mediump float; void main() { gl_FragColor = vec4(${Math.random().toFixed(6)}, 0.1, 0.2, 1.0); }`;
        const program = link(gl, unique);
        gl.useProgram(program);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.flush();
      };
      window.__lab.resetRenderStats();
      window.__labGlassMark?.();
      rec.sync = performance.mark('vk-rec').startTime;
      let since = -1;
      const loop = (t: number) => {
        rec.t.push(t);
        const on = isActive();
        rec.active.push(on);
        rec.stats.push(window.__lab.renderStats());
        if (on && since < 0) since = rec.t.length - 1;
        if (busy && since >= 0 && rec.t.length - 1 - since === busy.frame) {
          const block = () => {
            const end = performance.now() + busy.ms;
            while (performance.now() < end);
          };
          if (busy.kind === 'task') setTimeout(block, 0);
          else if (busy.kind === 'block') block();
          else if (busy.kind === 'gpu') gpuCanary();
          else compileCanary();
        }
        if (!rec.stop) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    [active, busy] as const,
  );

const takeRecorder = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const rec = (window as unknown as { __rec: PageRecorder }).__rec;
    rec.stop = true;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-canary]')) {
      canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    }
    const surfaces = selector ? [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => /url\(/.test(el.style.backdropFilter)).length : 0;
    const lenses = window.__labGlass ?? [];
    const interim = { entered: lenses.filter((l) => l.entered).length, open: lenses.filter((l) => l.alive && l.interim === true).length };
    return { t: rec.t, active: rec.active, stats: rec.stats, loaf: rec.loaf, sync: rec.sync, surfaces, interim };
  }, selector);

/** The first frames of a recorder over a still page are its own start, not the page: they are left out of the control. */
export const IDLE_LEAD_MS = 100;

/** The control for a replay: the same recorder over a page that is still, for `ms` past its lead, with no transition run. */
export async function recordIdle(page: Page, transition: Transition, ms: number): Promise<Recording> {
  await startRecorder(page, transition.active);
  await page.waitForFunction(
    (ms) => {
      const t = (window as unknown as { __rec: PageRecorder }).__rec.t;
      return t.length > 1 && t.at(-1)! - t[0]! >= ms;
    },
    ms + IDLE_LEAD_MS,
    { timeout: ms + 8000 },
  );
  return { ...(await takeRecorder(page, '')), created: 0 };
}

const attached = (page: Page) => page.evaluate(() => window.__labAttached ?? 0);

/** Opens the case, gets to the start, then runs the transition under a per-frame recorder. */
export async function recordTransition(
  page: Page,
  transition: Transition,
  glass: '1' | '0',
  options: { query?: string; afterOpen?: (page: Page) => Promise<void>; busy?: Busy } = {},
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
  await startRecorder(page, transition.active, options.busy);
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
  return { ...(await takeRecorder(page, transition.surfaces)), created };
}

/** How long after the last active frame the deferred landing is timed: it starts 120 ms later and its bakes are 50 ms apart. */
export const LANDING_WINDOW_MS = 400;

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

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { startTrace, traceFrames, type FrameCost, type TraceEvent } from './frame-trace';
import { watchPage, type PageLog } from './helpers';
import { IDLE_LEAD_MS, LANDING_WINDOW_MS, TRANSITIONS, recordIdle, recordTransition, type Recording, type Transition } from './transitions';

const MAX_FRAME = 33;
const MAX_P90 = 20;
const WARMUPS = 3;
const REPLAYS = 3;
const OFF_REPLAYS = Number(process.env.VIREUIKIT_PERF_OFF_REPLAYS ?? 1);
const TRACE = process.env.VIREUIKIT_PERF_TRACE ?? 'off';
const OUT = process.env.VIREUIKIT_PERF_OUT;
const FRESH = process.env.VIREUIKIT_PERF_FRESH === 'browser';
const CANARY = process.env.VIREUIKIT_PERF_CANARY;
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const TRACE_DIR = join(tmpdir(), 'vireuikit-perf', RUN);
const started = Date.now();
let seq = 0;
let testsInWorker = 0;
let pageLog: PageLog | null = null;

const test = FRESH
  ? base.extend({
      page: async ({ playwright, baseURL, viewport, deviceScaleFactor, colorScheme, launchOptions }, use) => {
        const browser = await playwright.chromium.launch({ ...launchOptions, headless: false });
        const context = await browser.newContext({ baseURL, viewport, deviceScaleFactor, colorScheme });
        await use(await context.newPage());
        await browser.close();
      },
    })
  : base;

type Stall = { index: number; gap: number; at: number; phase: string };
type Window = { from: number; to: number };

function replayWindow(rec: Recording): Window {
  const first = rec.active.indexOf(true);
  const last = rec.active.lastIndexOf(true);
  const until = rec.t[last]! + LANDING_WINDOW_MS;
  let to = Math.max(first, 1);
  while (to + 1 < rec.t.length && rec.t[to]! <= until) to += 1;
  return { from: Math.max(first, 1), to };
}

function idleWindow(rec: Recording): Window {
  let from = 1;
  while (from < rec.t.length - 1 && rec.t[from - 1]! - rec.t[0]! < IDLE_LEAD_MS) from += 1;
  return { from, to: rec.t.length - 1 };
}

function phaseOf(rec: Recording, i: number, idle: boolean): string {
  if (idle) return `idle +${Math.round(rec.t[i]! - rec.t[0]!)} ms`;
  const first = rec.active.indexOf(true);
  const last = rec.active.lastIndexOf(true);
  const bake = rec.stats[i]!.fullBakes > rec.stats[i - 1]!.fullBakes ? ', bake' : '';
  if (i <= last) return `motion ${i - first}/${last - first + 1}${bake}`;
  return `landing +${Math.round(rec.t[i]! - rec.t[last]!)} ms${bake}`;
}

function gapsOf(rec: Recording, w: Window): number[] {
  const gaps: number[] = [];
  for (let i = w.from; i <= w.to; i += 1) gaps.push(rec.t[i]! - rec.t[i - 1]!);
  return gaps;
}

function stallsOf(rec: Recording, w: Window, idle: boolean): Stall[] {
  const out: Stall[] = [];
  for (let i = w.from; i <= w.to; i += 1) {
    const gap = rec.t[i]! - rec.t[i - 1]!;
    if (gap > MAX_FRAME) out.push({ index: i - w.from, gap, at: rec.t[i]! - rec.t[w.from - 1]!, phase: phaseOf(rec, i, idle) });
  }
  return out;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

type Measured = { gaps: number[]; stalls: Stall[]; ms: number; costs: FrameCost[] | null };

function record(kind: 'replay' | 'idle', name: string, glass: string, role: string, rec: Recording, w: Window, events: TraceEvent[] | null, extra: object): Measured {
  const idle = kind === 'idle';
  const gaps = gapsOf(rec, w);
  const stalls = stallsOf(rec, w, idle);
  const traced = events ? traceFrames(events, rec, w) : null;
  const ms = rec.t[w.to]! - rec.t[w.from - 1]!;
  const from = rec.t[w.from - 1]!;
  const loaf = rec.loaf.filter((l) => l.startTime + l.duration >= from && l.startTime <= rec.t[w.to]!);
  if (OUT) {
    const round = (v: number) => Math.round(v * 10) / 10;
    const line = {
      run: RUN,
      seq: (seq += 1),
      wall: Date.now() - started,
      testsInWorker,
      name,
      kind,
      glass,
      role,
      frames: gaps.length,
      ms: round(ms),
      gaps: gaps.map(round),
      stalls,
      loaf,
      costs: traced?.costs.map((c) => [round(c.main), round(c.compositor), round(c.viz), round(c.gpu), round(c.present), c.compiles]) ?? null,
      traceStalls: traced?.stalls ?? null,
      ...extra,
    };
    appendFileSync(OUT, `${JSON.stringify(line)}\n`);
  }
  return { gaps, stalls, ms, costs: traced?.costs ?? null };
}

async function replay(page: Page, transition: Transition, glass: '1' | '0', role: string, idleMs = 0): Promise<{ replay: Measured; idle: Measured | null }> {
  const trace = TRACE === 'all' || (TRACE !== 'off' && role === 'measured');
  let stop: (() => Promise<TraceEvent[]>) | null = null;
  let idle: Recording | null = null;
  const busy = CANARY && role !== 'cold' && glass === '1' && transition.name === CANARY.split('@')[0] ? { frame: Number(CANARY.split('@')[1] ?? 3), ms: 40 } : undefined;
  const rec = await recordTransition(page, transition, glass, {
    busy,
    afterOpen: async (p) => {
      if (trace) {
        stop = await startTrace(p);
        await p.waitForTimeout(250);
      }
      if (idleMs > 0) idle = await recordIdle(p, transition, idleMs);
    },
  });
  const events = stop ? await (stop as () => Promise<TraceEvent[]>)() : null;
  const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  const r = record('replay', transition.name, glass, role, rec, replayWindow(rec), events, { heap });
  const i = idle ? record('idle', transition.name, glass, role, idle, idleWindow(idle), events, { heap }) : null;
  if (events && (r.stalls.length > 0 || (i?.stalls.length ?? 0) > 0)) {
    mkdirSync(TRACE_DIR, { recursive: true });
    const file = join(TRACE_DIR, `${String(seq).padStart(4, '0')}-${transition.name.replace(/[^a-z0-9]+/gi, '-')}-${glass}.json`);
    writeFileSync(file, JSON.stringify({ traceEvents: events, metadata: { sync: rec.sync, t: rec.t, idle: idle ? { sync: (idle as Recording).sync, t: (idle as Recording).t } : null } }));
    console.log(`trace kept: ${file}`);
  }
  return { replay: r, idle: i };
}

type Cell = { frames: number; p90: number; max: number; over: number; replays: number; stalled: number };

function cell(list: Measured[]): Cell {
  const all = list.flatMap((m) => m.gaps);
  const p90s = list.map((m) => pct([...m.gaps].sort((a, b) => a - b), 0.9)).sort((a, b) => a - b);
  return {
    frames: Math.round(all.length / Math.max(list.length, 1)),
    p90: p90s[Math.floor(p90s.length / 2)] ?? 0,
    max: Math.max(0, ...all),
    over: Math.max(0, ...list.map((m) => m.stalls.length)),
    replays: list.length,
    stalled: list.filter((m) => m.stalls.length > 0).length,
  };
}

const rows: { name: string; cold: Cell; on: Cell; off: Cell; idleOn: Cell; idleOff: Cell; headroom: string }[] = [];

function headroom(list: Measured[]): string {
  const costs = list.flatMap((m) => m.costs ?? []);
  if (costs.length === 0) return '';
  const of = (pick: (c: FrameCost) => number) => {
    const s = costs.map(pick).sort((a, b) => a - b);
    return `${pct(s, 0.9).toFixed(1)}/${s.at(-1)!.toFixed(1)}`;
  };
  return `main ${of((c) => c.main)} gpu ${of((c) => c.gpu)} viz ${of((c) => c.viz)} present ${of((c) => c.present)} compiles ${costs.reduce((a, c) => a + c.compiles, 0)}`;
}

base.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/?chrome=0');
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'none';
  });
  await page.close();
  expect(renderer, `the GPU is not in use (${renderer}); this gate does not accept software rendering`).not.toMatch(/swiftshader|software|llvmpipe|basic render|warp|microsoft basic|none/i);
  console.log(`renderer: ${renderer}`);
});

base.afterAll(() => {
  const c = (r: Cell) => `${String(r.frames).padStart(4)} ${r.p90.toFixed(1).padStart(5)} ${r.max.toFixed(1).padStart(6)} ${String(r.stalled).padStart(2)}/${r.replays}`;
  const width = Math.max(...rows.map((r) => r.name.length), 10);
  const lines = [
    `${'transition'.padEnd(width)} | glass on: frames p90    max  stalled | idle on   max stalled | glass off: frames p90    max stalled | idle off  max stalled | cold max | headroom p90/max ms`,
    ...rows.map((r) => `${r.name.padEnd(width)} |          ${c(r.on)} | ${r.idleOn.max.toFixed(1).padStart(10)} ${String(r.idleOn.stalled).padStart(2)}/${r.idleOn.replays} |          ${c(r.off)} | ${r.idleOff.max.toFixed(1).padStart(10)} ${String(r.idleOff.stalled).padStart(2)}/${r.idleOff.replays} | ${r.cold.max.toFixed(1).padStart(8)} | ${r.headroom}`),
  ];
  console.log(`\n${lines.join('\n')}\n`);
});

for (const transition of TRANSITIONS) {
  test(transition.name, async ({ page }) => {
    testsInWorker += 1;
    pageLog = watchPage(page);
    {
      const cold = await replay(page, transition, '1', 'cold');
      let last = cold.replay;
      for (let i = 1; i < WARMUPS; i += 1) last = (await replay(page, transition, '1', 'warm')).replay;
      const on: Measured[] = [];
      const idleOn: Measured[] = [];
      for (let i = 0; i < REPLAYS; i += 1) {
        const r = await replay(page, transition, '1', 'measured', last.ms);
        on.push(r.replay);
        idleOn.push(r.idle!);
      }
      await replay(page, transition, '0', 'warm');
      const off: Measured[] = [];
      const idleOff: Measured[] = [];
      for (let i = 0; i < OFF_REPLAYS; i += 1) {
        const r = await replay(page, transition, '0', 'measured', last.ms);
        off.push(r.replay);
        idleOff.push(r.idle!);
      }
      const row = { name: transition.name, cold: cell([cold.replay]), on: cell(on), off: cell(off), idleOn: cell(idleOn), idleOff: cell(idleOff), headroom: headroom(on) };
      rows.push(row);
      const stalls = on.flatMap((m, i) => m.stalls.map((s) => `replay ${i + 1}: ${s.gap.toFixed(1)} ms at frame ${s.index} (${s.phase})`));
      console.log(`ROW ${transition.name} | on ${JSON.stringify(row.on)} | idle on ${JSON.stringify(row.idleOn)} | off ${JSON.stringify(row.off)} | idle off ${JSON.stringify(row.idleOff)} | ${row.headroom}${stalls.length ? `\n  ${stalls.join('\n  ')}` : ''}`);
      expect.soft(row.on.over, `frames over ${MAX_FRAME} ms with glass on`).toBe(0);
      expect.soft(row.on.max, 'slowest frame with glass on').toBeLessThanOrEqual(MAX_FRAME);
      expect.soft(row.on.p90, 'p90 with glass on').toBeLessThanOrEqual(MAX_P90);
    }
  });
}

base.afterEach(({}, testInfo) => {
  pageLog?.stop();
  if (pageLog && testInfo.status !== testInfo.expectedStatus) console.log(`What the page said during "${testInfo.title}":\n${pageLog.lines.join('\n') || '(nothing)'}`);
  pageLog = null;
});

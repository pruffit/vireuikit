import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { startTrace, traceFrames, type FrameCost, type StallTrace, type TraceEvent } from './frame-trace';
import { watchPage, type PageLog } from './helpers';
import { IDLE_LEAD_MS, LANDING_WINDOW_MS, TRANSITIONS, recordIdle, recordTransition, type Recording, type Transition } from './transitions';

// Local, headed, GPU: `npm run check:lab:perf`. The method, the judgement of a stall and the numbers behind it are in
// docs/design.md, "The frame gate".
const MAX_FRAME = 33;
const MAX_P90 = 20;
const WARMUPS = 3;
const REPLAYS = 3;
const CONFIRM = 3;
const OFF_REPLAYS = Number(process.env.VIREUIKIT_PERF_OFF_REPLAYS ?? 1);
const TRACE = process.env.VIREUIKIT_PERF_TRACE !== '0';
const OUT = process.env.VIREUIKIT_PERF_OUT;
const FRESH = process.env.VIREUIKIT_PERF_FRESH === 'browser';
// `<transition name>@<frame>`: blocks the main thread for 40 ms on that frame of every replay with glass on.
const CANARY = process.env.VIREUIKIT_PERF_CANARY;
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const TRACE_DIR = join(tmpdir(), 'vireuikit-perf', RUN);
/** The kit's own source and the core: a long animation frame whose script is one of these is a cost of ours. */
const OURS = /\/src\/|vireglass/;
const OUR_SCRIPT_MS = 10;

let seq = 0;
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

type Window = { from: number; to: number };
type Stall = { index: number; gap: number; phase: string; ours: string | null; where: StallTrace['where'] | null };
type Measured = { gaps: number[]; stalls: Stall[]; ms: number; costs: FrameCost[] | null };

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
  const bake = rec.stats[i]!.fullBakes > rec.stats[i - 1]!.fullBakes ? ', a bake' : '';
  if (i <= last) return `motion frame ${i - first} of ${last - first + 1}${bake}`;
  return `landing +${Math.round(rec.t[i]! - rec.t[last]!)} ms${bake}`;
}

/** The kit's or the core's script in a long animation frame that overlaps the interval, if it held the main thread long enough to matter. */
function ourScript(rec: Recording, i: number): string | null {
  const [a, b] = [rec.t[i - 1]!, rec.t[i]!];
  for (const loaf of rec.loaf) {
    if (loaf.startTime > b || loaf.startTime + loaf.duration < a) continue;
    const mine = loaf.scripts.filter((s) => OURS.test(s.sourceURL) && s.duration >= OUR_SCRIPT_MS);
    if (mine.length > 0) return mine.map((s) => `${s.sourceFunctionName || s.invoker} in ${s.sourceURL.split('/').pop()} ${s.duration.toFixed(0)} ms`).join(', ');
  }
  return null;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

function measure(rec: Recording, idle: boolean, events: TraceEvent[] | null): Measured {
  const w = idle ? idleWindow(rec) : replayWindow(rec);
  const traced = events ? traceFrames(events, rec, w, MAX_FRAME) : null;
  const gaps: number[] = [];
  const stalls: Stall[] = [];
  for (let i = w.from; i <= w.to; i += 1) {
    const gap = rec.t[i]! - rec.t[i - 1]!;
    gaps.push(gap);
    if (gap <= MAX_FRAME) continue;
    const index = i - w.from;
    stalls.push({ index, gap, phase: phaseOf(rec, i, idle), ours: ourScript(rec, i), where: traced?.stalls.find((s) => s.index === index)?.where ?? null });
  }
  return { gaps, stalls, ms: rec.t[w.to]! - rec.t[w.from - 1]!, costs: traced?.costs ?? null };
}

function write(line: object): void {
  if (OUT) appendFileSync(OUT, `${JSON.stringify({ run: RUN, seq: (seq += 1), ...line })}\n`);
}

/** One replay, after an idle control in the same page when `idleMs` is given; traced when measured. */
async function replay(page: Page, transition: Transition, glass: '1' | '0', role: string, idleMs = 0): Promise<{ replay: Measured; idle: Measured | null }> {
  const trace = TRACE && role === 'measured';
  let stop: (() => Promise<TraceEvent[]>) | null = null;
  let idle: Recording | null = null;
  const [canaryName, canaryFrame] = CANARY?.split('@') ?? [];
  const busy = canaryName === transition.name && role !== 'cold' && glass === '1' ? { frame: Number(canaryFrame ?? 3), ms: 40 } : undefined;
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
  const r = measure(rec, false, events);
  const i = idle ? measure(idle, true, events) : null;
  write({ name: transition.name, kind: 'replay', glass, role, ...r });
  if (i) write({ name: transition.name, kind: 'idle', glass, role, ...i });
  if (events && (r.stalls.length > 0 || (i?.stalls.length ?? 0) > 0)) {
    mkdirSync(TRACE_DIR, { recursive: true });
    const file = join(TRACE_DIR, `${String(seq).padStart(4, '0')}-${transition.name.replace(/[^a-z0-9]+/gi, '-')}-glass-${glass}.json`);
    const idleRec = idle as Recording | null;
    writeFileSync(file, JSON.stringify({ traceEvents: events, metadata: { sync: rec.sync, t: rec.t, idle: idleRec ? { sync: idleRec.sync, t: idleRec.t } : null } }));
    console.log(`  trace kept: ${file}`);
  }
  return { replay: r, idle: i };
}

/** Which stalls are the transition's: one that comes back at the same frame, or the kit's own script in two replays. */
function judge(replays: Measured[]): { counted: (Stall & { replay: number })[]; oneOff: (Stall & { replay: number })[] } {
  const all = replays.flatMap((m, replay) => m.stalls.map((s) => ({ ...s, replay })));
  const oursIn = new Set(all.filter((s) => s.ours).map((s) => s.replay)).size;
  const counted = all.filter((s) => (s.ours && oursIn >= 2) || all.some((o) => o.replay !== s.replay && Math.abs(o.index - s.index) <= 1));
  return { counted, oneOff: all.filter((s) => !counted.includes(s)) };
}

type Cell = { frames: number; p90: number; max: number; replays: number; stalled: number };

function cell(list: Measured[]): Cell {
  const p90s = list.map((m) => pct([...m.gaps].sort((a, b) => a - b), 0.9)).sort((a, b) => a - b);
  return {
    frames: Math.round(list.reduce((a, m) => a + m.gaps.length, 0) / Math.max(list.length, 1)),
    p90: p90s[Math.floor(p90s.length / 2)] ?? 0,
    max: Math.max(0, ...list.flatMap((m) => m.gaps)),
    replays: list.length,
    stalled: list.filter((m) => m.stalls.length > 0).length,
  };
}

/** Busy ms per frame interval, p90 and max, over the measured replays with glass on. */
function headroom(list: Measured[]): { main: string; gpu: string } {
  const costs = list.flatMap((m) => m.costs ?? []);
  const of = (pick: (c: FrameCost) => number) => {
    if (costs.length === 0) return '      -';
    const s = costs.map(pick).sort((a, b) => a - b);
    return `${pct(s, 0.9).toFixed(1).padStart(4)}/${s.at(-1)!.toFixed(1).padStart(4)}`;
  };
  return { main: of((c) => c.main), gpu: of((c) => c.gpu) };
}

type Row = { name: string; cold: Cell; on: Cell; counted: number; off: Cell; idleOn: Cell; idleOff: Cell; headroom: { main: string; gpu: string } };
const rows: Row[] = [];

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
  console.log(`renderer: ${renderer}${CANARY ? `\ncanary: 40 ms on frame ${CANARY.split('@')[1] ?? 3} of "${CANARY.split('@')[0]}", which must fail` : ''}`);
});

base.afterAll(() => {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map((r) => r.name.length), 10);
  const c = (r: Cell) => `${String(r.frames).padStart(4)} ${r.p90.toFixed(1).padStart(5)} ${r.max.toFixed(1).padStart(6)} ${`${r.stalled}/${r.replays}`.padStart(5)}`;
  const idle = (r: Cell) => `${r.max.toFixed(1).padStart(5)} ${`${r.stalled}/${r.replays}`.padStart(5)}`;
  const sum = (pick: (r: Row) => Cell) => `${rows.reduce((a, r) => a + pick(r).stalled, 0)}/${rows.reduce((a, r) => a + pick(r).replays, 0)}`;
  const lines = [
    `${''.padEnd(width)} | glass on                         | idle on     | glass off              | idle off    | cold   | headroom, ms of a frame (p90/max)`,
    `${'transition'.padEnd(width)} | frames   p90    max stall judged | max  stall  | frames   p90    max stall | max  stall  | max    | main      gpu`,
    ...rows.map((r) => `${r.name.padEnd(width)} | ${c(r.on)} ${String(r.counted).padStart(6)} | ${idle(r.idleOn)} | ${c(r.off)} | ${idle(r.idleOff)} | ${r.cold.max.toFixed(0).padStart(6)} | ${r.headroom.main} ${r.headroom.gpu}`),
    `stalled replays: glass on ${sum((r) => r.on)}, idle on ${sum((r) => r.idleOn)}, glass off ${sum((r) => r.off)}, idle off ${sum((r) => r.idleOff)}; judged stalls ${rows.reduce((a, r) => a + r.counted, 0)}`,
  ];
  console.log(`\n${lines.join('\n')}\n`);
});

for (const transition of TRANSITIONS) {
  test(transition.name, async ({ page }) => {
    pageLog = watchPage(page);
    const cold = (await replay(page, transition, '1', 'cold')).replay;
    let warm = cold;
    for (let i = 1; i < WARMUPS; i += 1) warm = (await replay(page, transition, '1', 'warm')).replay;
    const on: Measured[] = [];
    const idleOn: Measured[] = [];
    const measureOn = async (n: number) => {
      for (let i = 0; i < n; i += 1) {
        const r = await replay(page, transition, '1', 'measured', warm.ms);
        on.push(r.replay);
        idleOn.push(r.idle!);
      }
    };
    await measureOn(REPLAYS);
    if (on.some((m) => m.stalls.length > 0) && judge(on).oneOff.length > 0) await measureOn(CONFIRM);
    await replay(page, transition, '0', 'warm');
    const off: Measured[] = [];
    const idleOff: Measured[] = [];
    for (let i = 0; i < OFF_REPLAYS; i += 1) {
      const r = await replay(page, transition, '0', 'measured', warm.ms);
      off.push(r.replay);
      idleOff.push(r.idle!);
    }
    const { counted, oneOff } = judge(on);
    const row: Row = { name: transition.name, cold: cell([cold]), on: cell(on), counted: counted.length, off: cell(off), idleOn: cell(idleOn), idleOff: cell(idleOff), headroom: headroom(on) };
    rows.push(row);
    const describe = (s: Stall & { replay?: number }) =>
      `${s.gap.toFixed(1)} ms at frame ${s.index}${s.replay !== undefined ? ` of replay ${s.replay + 1}` : ''} (${s.phase})${s.ours ? `, our script: ${s.ours}` : ''}${s.where ? `, trace: ${s.where}` : ''}`;
    const notes = [
      ...counted.map((s) => `  judged: ${describe(s)}`),
      ...oneOff.map((s) => `  one-off, not judged: ${describe(s)}`),
      ...[...idleOn, ...idleOff].flatMap((m) => m.stalls.map((s) => `  idle control: ${describe(s)}`)),
      ...off.flatMap((m) => m.stalls.map((s) => `  glass off: ${describe(s)}`)),
    ];
    console.log(`${transition.name}: glass on ${row.on.stalled}/${row.on.replays} replays stalled, ${counted.length} judged; p90 ${row.on.p90.toFixed(1)} ms; headroom main ${row.headroom.main.trim()} gpu ${row.headroom.gpu.trim()}${notes.length ? `\n${notes.join('\n')}` : ''}`);
    expect.soft(counted.map((s) => describe(s)), `stalls over ${MAX_FRAME} ms with glass on that are the transition's own`).toEqual([]);
    expect.soft(row.on.p90, 'p90 with glass on').toBeLessThanOrEqual(MAX_P90);
  });
}

base.afterEach(({}, testInfo) => {
  pageLog?.stop();
  if (pageLog && testInfo.status !== testInfo.expectedStatus) console.log(`What the page said during "${testInfo.title}":\n${pageLog.lines.join('\n') || '(nothing)'}`);
  pageLog = null;
});

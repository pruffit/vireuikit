import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { GPU_QUIET_MS, VSYNC_MS, startTrace, traceFrames, type FrameCost, type LongTask, type TraceEvent } from './frame-trace';
import { watchPage, type PageLog } from './helpers';
import { IDLE_LEAD_MS, LANDING_WINDOW_MS, TRANSITIONS, recordIdle, recordTransition, type Busy, type Loaf, type Recording, type Transition } from './transitions';

// Local, headed, GPU: `npm run check:lab:perf`. What it judges and why: docs/design.md, "The frame gate".
const MAX_FRAME = 33;
const WARMUPS = 3;
const REPLAYS = 3;
const OFF_REPLAYS = Number(process.env.VIREUIKIT_PERF_OFF_REPLAYS ?? 1);
const TRACE = process.env.VIREUIKIT_PERF_TRACE !== '0';
const OUT = process.env.VIREUIKIT_PERF_OUT;
const KEEP_ALL = process.env.VIREUIKIT_PERF_KEEP === 'all';
const FRESH = process.env.VIREUIKIT_PERF_FRESH === 'browser';
const SEED = Number(process.env.VIREUIKIT_PERF_SEED ?? 20241024);
const RUN = new Date().toISOString().replace(/[:.]/g, '-');
const TRACE_DIR = join(tmpdir(), 'vireuikit-perf', RUN);

/** What a run can break: a frame over the bound, a main-thread task over a vsync, a GPU program compiled, a replay with no trace. */
type Rule = 'frame' | 'task' | 'compile' | 'untraced';

const KINDS = ['fixed', 'random', 'foreign', 'short', 'gpu', 'compile'] as const;
type Canary = { kind: (typeof KINDS)[number]; name: string; frame: number };

/** The rule each canary is made to break, among others: a 20 ms task also costs the frame after it. */
const BREAKS: Record<Canary['kind'], Rule> = { fixed: 'frame', random: 'frame', foreign: 'frame', short: 'task', gpu: 'frame', compile: 'compile' };

/** `VIREUIKIT_PERF_CANARY=<kind>:<transition>[@frame]`: a cost the gate must fail on, every run, by the rule of its kind. */
function canaryFor(name: string): Canary | null {
  const m = new RegExp(`^(?:(${KINDS.join('|')}):)?([^@]+)(?:@(\\d+))?$`).exec(process.env.VIREUIKIT_PERF_CANARY ?? '');
  if (!m || m[2] !== name) return null;
  return { kind: (m[1] ?? 'fixed') as Canary['kind'], name, frame: Number(m[3] ?? 3) };
}

/** A small seeded generator, so a random canary lands on the same replay and frame every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
type Stall = { index: number; gap: number; phase: string; evidence: string | null; external: boolean; loaf: string };
type Compile = { index: number; programs: number; phase: string };
type Measured = { gaps: number[]; stalls: Stall[]; compiled: Compile[]; ms: number; traced: boolean; costs: FrameCost[]; longTasks: LongTask[]; longest: number };

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

/** The scripts of the long animation frames over an interval: a diagnosis of a counted stall, never a judgement of it. */
function loafOf(loaf: Loaf[], from: number, to: number): string {
  const frames = loaf.filter((f) => f.startTime < to && f.startTime + f.duration > from);
  const scripts = frames.flatMap((f) => f.scripts).sort((a, b) => b.duration - a.duration).slice(0, 3);
  if (scripts.length === 0) return frames.length ? `${frames.length} long animation frame(s), no script in them` : 'no long animation frame reported (only frames over 50 ms are)';
  return scripts.map((s) => `${s.sourceFunctionName || s.invokerType} (${s.sourceURL.split('/').pop() || 'inline'}) ${s.duration.toFixed(0)} ms`).join(', ');
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

function measure(rec: Recording, idle: boolean, events: TraceEvent[] | null): Measured {
  const w = idle ? idleWindow(rec) : replayWindow(rec);
  const reading = events ? traceFrames(events, rec, w, MAX_FRAME) : null;
  const gaps: number[] = [];
  const stalls: Stall[] = [];
  for (let i = w.from; i <= w.to; i += 1) {
    const gap = rec.t[i]! - rec.t[i - 1]!;
    gaps.push(gap);
    if (gap <= MAX_FRAME) continue;
    const read = reading?.stalls.get(i - w.from);
    stalls.push({ index: i - w.from, gap, phase: phaseOf(rec, i, idle), evidence: read ? `rule "${read.rule}": ${read.evidence}` : null, external: read?.external ?? false, loaf: loafOf(rec.loaf, rec.t[i - 1]!, rec.t[i]!) });
  }
  const compiled = (reading?.costs ?? []).flatMap((c, k): Compile[] => (c.compiles > 0 ? [{ index: k, programs: c.compiles, phase: phaseOf(rec, w.from + k, idle) }] : []));
  return { gaps, stalls, compiled: idle ? [] : compiled, ms: rec.t[w.to]! - rec.t[w.from - 1]!, traced: reading !== null, costs: reading?.costs ?? [], longTasks: idle ? [] : (reading?.longTasks ?? []), longest: reading?.longest ?? 0 };
}

/** Blocks the page's main thread for 40 ms from a script of its own, neither the recorder's nor the kit's. */
function foreignCanary(frame: number): void {
  if (!/[?&]glass=1/.test(location.search)) return;
  let done = false;
  const look = () => {
    const rec = (window as unknown as { __rec?: { t: number[]; active: boolean[] } }).__rec;
    const first = rec ? rec.active.indexOf(true) : -1;
    if (rec && first >= 0 && rec.t.length - 1 - first >= frame && !done) {
      done = true;
      const end = performance.now() + 40;
      while (performance.now() < end);
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/** One replay, after an idle control in the same page when `idleMs` is given; traced when measured. */
async function replay(page: Page, transition: Transition, glass: '1' | '0', role: string, idleMs = 0, busy?: Busy): Promise<{ replay: Measured; idle: Measured | null }> {
  // Warm-ups are traced too, not read: the first traced load of a page pays the trace's own start.
  const trace = TRACE && role !== 'cold';
  let stop: (() => Promise<TraceEvent[]>) | null = null;
  let idle: Recording | null = null;
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
  seq += 1;
  if (OUT) {
    appendFileSync(OUT, `${JSON.stringify({ run: RUN, seq, name: transition.name, kind: 'replay', glass, role, ...r })}\n`);
    if (i) appendFileSync(OUT, `${JSON.stringify({ run: RUN, seq, name: transition.name, kind: 'idle', glass, role, ...i })}\n`);
  }
  if (events && (KEEP_ALL || r.stalls.length > 0 || r.longTasks.length > 0 || r.compiled.length > 0 || (i?.stalls.length ?? 0) > 0)) {
    mkdirSync(TRACE_DIR, { recursive: true });
    const file = join(TRACE_DIR, `${String(seq).padStart(4, '0')}-${transition.name.replace(/[^a-z0-9]+/gi, '-')}-glass-${glass}.json`);
    const idleRec = idle as Recording | null;
    writeFileSync(file, JSON.stringify({ traceEvents: events, metadata: { sync: rec.sync, t: rec.t, idle: idleRec ? { sync: idleRec.sync, t: idleRec.t } : null } }));
    console.log(`  trace kept: ${file}`);
  }
  return { replay: r, idle: i };
}

type Cell = { frames: number; max: number; replays: number; stalled: number };

function cell(list: Measured[]): Cell {
  return {
    frames: Math.round(list.reduce((a, m) => a + m.gaps.length, 0) / Math.max(list.length, 1)),
    max: Math.max(0, ...list.flatMap((m) => m.gaps)),
    replays: list.length,
    stalled: list.filter((m) => m.stalls.length > 0).length,
  };
}

function headroom(list: Measured[]): { main: string; gpu: string; task: string } {
  const costs = list.flatMap((m) => m.costs);
  const of = (pick: (c: FrameCost) => number) => {
    if (costs.length === 0) return '        -';
    const s = costs.map(pick).sort((a, b) => a - b);
    return `${pct(s, 0.9).toFixed(1).padStart(4)}/${s.at(-1)!.toFixed(1).padStart(4)}`;
  };
  const traced = list.filter((m) => m.traced);
  return { main: of((c) => c.main), gpu: of((c) => c.gpu), task: traced.length ? Math.max(...traced.map((m) => m.longest)).toFixed(1) : '-' };
}

type Row = { name: string; cold: Cell; on: Cell; counted: number; excused: number; off: Cell; idleOn: Cell; idleOff: Cell; headroom: ReturnType<typeof headroom> };
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
  const canary = process.env.VIREUIKIT_PERF_CANARY ? `\ncanary: ${process.env.VIREUIKIT_PERF_CANARY}, which must fail by its own rule (seed ${SEED})` : '';
  console.log(`renderer: ${renderer}${canary}${TRACE ? '' : '\nuntraced: no stall can be excused, and the task bound, compiles and traces are not checked'}`);
});

base.afterAll(() => {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map((r) => r.name.length), 10);
  const c = (r: Cell) => `${String(r.frames).padStart(4)} ${r.max.toFixed(1).padStart(6)} ${`${r.stalled}/${r.replays}`.padStart(5)}`;
  const idle = (r: Cell) => `${r.max.toFixed(1).padStart(5)} ${`${r.stalled}/${r.replays}`.padStart(5)}`;
  const sum = (pick: (r: Row) => Cell) => `${rows.reduce((a, r) => a + pick(r).stalled, 0)}/${rows.reduce((a, r) => a + pick(r).replays, 0)}`;
  const lines = [
    `${''.padEnd(width)} | glass on                           | idle on     | glass off        | idle off    | cold   | ms of a frame, p90/max | longest`,
    `${'transition'.padEnd(width)} | frames    max stall counted excused | max  stall  | frames    max stall | max  stall  | max    | main      gpu          | main task`,
    ...rows.map(
      (r) =>
        `${r.name.padEnd(width)} | ${c(r.on)} ${String(r.counted).padStart(7)} ${String(r.excused).padStart(7)} | ${idle(r.idleOn)} | ${c(r.off)} | ${idle(r.idleOff)} | ${r.cold.max.toFixed(0).padStart(6)} | ${r.headroom.main} ${r.headroom.gpu}    | ${r.headroom.task.padStart(9)}`,
    ),
    `stalled replays: glass on ${sum((r) => r.on)}, idle on ${sum((r) => r.idleOn)}, glass off ${sum((r) => r.off)}, idle off ${sum((r) => r.idleOff)}; counted ${rows.reduce((a, r) => a + r.counted, 0)}, excused ${rows.reduce((a, r) => a + r.excused, 0)}`,
    `headroom is printed, not judged; a stall is excused only by a wait in Present with the GPU process quiet (at most ${GPU_QUIET_MS} ms of its own work in the interval and either neighbour)`,
  ];
  console.log(`\n${lines.join('\n')}\n`);
});

for (const transition of TRANSITIONS) {
  test(transition.name, async ({ page }) => {
    pageLog = watchPage(page, 400);
    const canary = canaryFor(transition.name);
    if (canary?.kind === 'foreign') await page.addInitScript(foreignCanary, canary.frame);
    const random = seeded(SEED);
    const at = { replay: Math.floor(random() * REPLAYS), frame: 2 + Math.floor(random() * 16) };
    if (canary?.kind === 'random') console.log(`  random canary: replay ${at.replay + 1}, frame ${at.frame} (seed ${SEED})`);
    const busyFor = (i: number): Busy | undefined => {
      if (canary?.kind === 'fixed') return { frame: canary.frame, kind: 'block', ms: 40 };
      if (canary?.kind === 'short') return { frame: canary.frame, kind: 'task', ms: 20 };
      if (canary?.kind === 'gpu' || canary?.kind === 'compile') return { frame: canary.frame, kind: canary.kind, ms: 0 };
      if (canary?.kind === 'random' && i === at.replay) return { frame: at.frame, kind: 'block', ms: 40 };
      return undefined;
    };
    const cold = (await replay(page, transition, '1', 'cold')).replay;
    let warm = cold;
    for (let i = 1; i < WARMUPS; i += 1) warm = (await replay(page, transition, '1', 'warm')).replay;
    const on: Measured[] = [];
    const idleOn: Measured[] = [];
    for (let i = 0; i < REPLAYS; i += 1) {
      const r = await replay(page, transition, '1', 'measured', warm.ms, busyFor(i));
      on.push(r.replay);
      idleOn.push(r.idle!);
    }
    await replay(page, transition, '0', 'warm');
    const off: Measured[] = [];
    const idleOff: Measured[] = [];
    for (let i = 0; i < OFF_REPLAYS; i += 1) {
      const r = await replay(page, transition, '0', 'measured', warm.ms);
      off.push(r.replay);
      idleOff.push(r.idle!);
    }

    const stalls = on.flatMap((m, replay) => m.stalls.map((s) => ({ ...s, replay })));
    const counted = stalls.filter((s) => !s.external);
    const excused = stalls.filter((s) => s.external);
    const longTasks = on.flatMap((m, replay) => m.longTasks.map((t) => ({ ...t, replay })));
    const compiled = on.flatMap((m, replay) => m.compiled.map((c) => ({ ...c, replay })));
    const untraced = TRACE ? on.flatMap((m, replay) => (m.traced ? [] : [replay + 1])) : [];
    const row: Row = { name: transition.name, cold: cell([cold]), on: cell(on), counted: counted.length, excused: excused.length, off: cell(off), idleOn: cell(idleOn), idleOff: cell(idleOff), headroom: headroom(on) };
    rows.push(row);
    const describe = (s: Stall & { replay?: number }) => `${s.gap.toFixed(1)} ms at frame ${s.index}${s.replay !== undefined ? ` of replay ${s.replay + 1}` : ''} (${s.phase}); ${s.evidence ?? 'no trace'}`;
    const notes = [
      ...counted.map((s) => `  counted: ${describe(s)}${TRACE ? `; long animation frame: ${s.loaf}` : ''}`),
      ...excused.map((s) => `  excused: ${describe(s)}`),
      ...longTasks.map((t) => `  main-thread task over a vsync: ${t.ms.toFixed(1)} ms at +${t.at.toFixed(0)} ms of replay ${t.replay + 1}: ${t.what}`),
      ...compiled.map((c) => `  GPU program compiled in a measured replay: ${c.programs} at frame ${c.index} of replay ${c.replay + 1} (${c.phase})`),
      ...untraced.map((n) => `  replay ${n} has no trace: the page's mark or the GPU process's thread was not in it`),
      ...[...idleOn, ...idleOff].flatMap((m) => m.stalls.map((s) => `  idle control: ${describe(s)}`)),
      ...off.flatMap((m) => m.stalls.map((s) => `  glass off: ${describe(s)}`)),
    ];
    const broken = new Set<Rule>();
    if (counted.length > 0) broken.add('frame');
    if (longTasks.length > 0) broken.add('task');
    if (compiled.length > 0) broken.add('compile');
    if (untraced.length > 0) broken.add('untraced');
    console.log(`${transition.name}: glass on ${row.on.stalled}/${row.on.replays} replays stalled, ${counted.length} counted, ${excused.length} excused; main ${row.headroom.main.trim()} gpu ${row.headroom.gpu.trim()}; longest main task ${row.headroom.task}${notes.length ? `\n${notes.join('\n')}` : ''}`);
    console.log(`rules broken: ${[...broken].join(', ') || 'none'}`);
    if (canary) {
      const wanted = BREAKS[canary.kind];
      const verdict = broken.has(wanted) ? 'ok' : 'wrong';
      console.log(`CANARY ${canary.kind}: must break "${wanted}", broke [${[...broken].join(', ')}]: ${verdict}`);
      expect.soft(broken.has(wanted), `the ${canary.kind} canary must break the "${wanted}" rule`).toBe(true);
    }
    const kept = on.flatMap((m) => m.gaps.filter((_, i) => !m.stalls.some((s) => s.index === i && s.external)));
    expect.soft(counted.length, `frames over ${MAX_FRAME} ms with glass on that the trace does not show outside the page`).toBe(0);
    expect.soft(Math.max(0, ...kept), `slowest frame with glass on, less the ones the trace shows outside the page`).toBeLessThanOrEqual(MAX_FRAME);
    expect.soft(longTasks.map((t) => `${t.ms.toFixed(1)} ms: ${t.what}`), `main-thread tasks over ${VSYNC_MS} ms with glass on`).toEqual([]);
    expect.soft(compiled.map((c) => `${c.programs} at frame ${c.index} of replay ${c.replay + 1}`), 'GPU programs compiled in a measured replay, which the warm-ups should have compiled').toEqual([]);
    expect.soft(untraced, 'measured replays with no trace, which nothing can be excused or checked on').toEqual([]);
  });
}

base.afterEach(({}, testInfo) => {
  pageLog?.stop();
  if (pageLog && testInfo.status !== testInfo.expectedStatus) console.log(`What the page said during "${testInfo.title}":\n${pageLog.lines.join('\n') || '(nothing)'}`);
  pageLog = null;
});

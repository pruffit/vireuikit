import type { Page } from '@playwright/test';

export type TraceEvent = {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string; data?: { startTime?: number; functionName?: string; url?: string; type?: string } };
};

// Light on purpose: every measured replay is traced, and heavier categories load the threads being timed.
const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'gpu', 'disabled-by-default-gpu.device', 'disabled-by-default-gpu.service', 'blink.user_timing'];

/** Starts a trace of the whole browser, the GPU process included; the returned function ends it and hands back its events. */
export async function startTrace(page: Page): Promise<() => Promise<TraceEvent[]>> {
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  cdp.on('Tracing.dataCollected', (e) => {
    for (const ev of e.value) events.push(ev as unknown as TraceEvent);
  });
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: CATEGORIES },
  });
  return async () => {
    const done = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.end');
    await done;
    await cdp.detach().catch(() => undefined);
    return events;
  };
}

/**
 * Busy ms over one frame interval: the page's main thread, the GPU process's main thread less its wait in `Present`
 * (`gpu`), that wait (`present`), and the GPU programs compiled in it: Skia's, which a GPU-process task that overlaps it
 * stored, and the ones a context linked.
 */
export type FrameCost = { main: number; gpu: number; present: number; compiles: number };

/** A renderer main-thread task longer than a vsync, with what ran in it. */
export type LongTask = { at: number; ms: number; what: string };

/** A stalled interval's verdict: `rule` names the test that decided it, `evidence` carries the numbers. */
export type StallReading = { rule: string; evidence: string; external: boolean };

/** The trace's view of a recording: each interval's cost, the verdict on each stalled one, and the long tasks. */
export type TraceReading = { costs: FrameCost[]; stalls: Map<number, StallReading>; longTasks: LongTask[]; longest: number };

export const VSYNC_MS = 16.7;

/**
 * A wait in `Present` is the OS compositor's only when the GPU process itself was quiet in the interval and the one
 * either side of it: its main thread busy for more than this much of a frame is work the kit queued, and `Present`
 * blocks on that backpressure. A quarter of a vsync is well above the few ms of a frame that only presents and well
 * under one that draws.
 */
export const GPU_QUIET_MS = 4;

type Span = [number, number];

const key = (pid: number, tid: number) => `${pid}:${tid}`;
const spanOf = (e: TraceEvent): Span => [e.ts, e.ts + (e.dur ?? 0)];

const overlap = (spans: Span[], a: number, b: number) => {
  let sum = 0;
  for (const [s, e] of spans) sum += Math.max(0, Math.min(e, b) - Math.max(s, a));
  return sum / 1000;
};

/** The length of the union of the spans inside [a, b]. */
function union(spans: Span[], a: number, b: number): number {
  const clipped = spans.map(([s, e]): Span => [Math.max(s, a), Math.min(e, b)]).filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]);
  let sum = 0;
  let end = -Infinity;
  for (const [s, e] of clipped) {
    if (e <= end) continue;
    sum += e - Math.max(s, end);
    end = e;
  }
  return sum / 1000;
}

function gpuThread(events: TraceEvent[]): string | null {
  let gpuPid: number | undefined;
  const names = new Map<string, string>();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'thread_name') names.set(key(e.pid, e.tid), String(e.args?.name));
    if (e.name === 'process_name' && e.args?.name === 'GPU Process') gpuPid = e.pid;
  }
  return [...names].find(([k, n]) => n === 'CrGpuMain' && k.startsWith(`${gpuPid}:`))?.[0] ?? null;
}

function describeTask(events: TraceEvent[], task: TraceEvent): string {
  const end = task.ts + (task.dur ?? 0);
  const label = (e: TraceEvent) => {
    const d = e.args?.data;
    if (e.name === 'FunctionCall') return `${d?.functionName || 'script'} (${(d?.url ?? '').split('/').pop() || 'inline'})`;
    if (e.name === 'EventDispatch') return `${d?.type ?? 'event'} handler`;
    return e.name;
  };
  const inner = events.filter(
    (e) => e.ph === 'X' && e.pid === task.pid && e.tid === task.tid && e.ts >= task.ts && e.ts < end && (e.dur ?? 0) >= 1000 && /FunctionCall|EventDispatch|TimerFire|FireAnimationFrame|GC|Layout|UpdateLayoutTree|Paint/.test(e.name),
  );
  return [...new Set(inner.sort((x, y) => (y.dur ?? 0) - (x.dur ?? 0)).map((e) => `${label(e)} ${((e.dur ?? 0) / 1000).toFixed(1)} ms`))].slice(0, 4).join(', ') || 'no script';
}

/** Reads a recording off the trace of its replay; null when the trace does not hold it. */
export function traceFrames(events: TraceEvent[], rec: { t: number[]; sync: number }, window: { from: number; to: number }, stall: number): TraceReading | null {
  const mark = events.find((e) => e.name === 'vk-rec' && e.cat.includes('blink.user_timing') && Math.abs(Number(e.args?.data?.startTime) - rec.sync) < 0.01);
  const gpu = gpuThread(events);
  if (!mark || !gpu) return null;
  const main = key(mark.pid, mark.tid);
  const offset = mark.ts - rec.sync * 1000;
  const at = (t: number) => t * 1000 + offset;
  const mainTasks: TraceEvent[] = [];
  const gpuTasks: TraceEvent[] = [];
  const presents: Span[] = [];
  const stores: number[] = [];
  const links: number[] = [];
  const gpuPid = gpu.split(':')[0];
  for (const e of events) {
    const k = key(e.pid, e.tid);
    if (e.ph === 'X' && e.name === 'RunTask' && k === main) mainTasks.push(e);
    else if (e.ph === 'X' && e.name === 'RunTask' && k === gpu) gpuTasks.push(e);
    else if (e.name === 'DXGISwapChainImageBacking::Present' && k === gpu) presents.push(spanOf(e));
    else if (e.name === 'GrShaderCache::store') stores.push(e.ts);
    else if (e.name === 'TraceGLAPI::glLinkProgram' && e.ph === 'X' && String(e.pid) === gpuPid) links.push(e.ts);
  }
  const holds = (e: TraceEvent, ts: number) => ts >= e.ts && ts <= e.ts + (e.dur ?? 0);
  const compiling = gpuTasks.filter((e) => stores.some((s) => holds(e, s)));
  const costs: FrameCost[] = [];
  for (let i = window.from; i <= window.to; i += 1) {
    const [a, b] = [at(rec.t[i - 1]!), at(rec.t[i]!)];
    const tasks = compiling.filter((e) => e.ts < b && e.ts + (e.dur ?? 0) > a);
    const present = overlap(presents, a, b);
    costs.push({
      main: overlap(mainTasks.map(spanOf), a, b),
      gpu: overlap(gpuTasks.map(spanOf), a, b) - present,
      present,
      compiles: stores.filter((s) => tasks.some((e) => holds(e, s))).length + links.filter((l) => l >= a && l < b).length,
    });
  }
  const stalls = new Map<number, StallReading>();
  for (let i = window.from; i <= window.to; i += 1) {
    const gap = rec.t[i]! - rec.t[i - 1]!;
    if (gap <= stall) continue;
    const k = i - window.from;
    const cost = costs[k]!;
    const [a, b] = [at(rec.t[i - 1]!), at(rec.t[i]!)];
    const waited = union(presents, a, b);
    const around = Math.max(...[k - 1, k, k + 1].map((j) => costs[j]?.gpu ?? 0));
    const numbers = `main thread ${cost.main.toFixed(1)} ms; GPU process ${waited.toFixed(1)} ms in Present, ${around.toFixed(1)} ms working at most in this interval and its neighbours (quiet is ${GPU_QUIET_MS} ms), ${cost.compiles} programs compiled`;
    let verdict: Omit<StallReading, 'evidence'>;
    if (cost.main >= VSYNC_MS) verdict = { rule: 'main thread busy for a vsync', external: false };
    else if (cost.compiles > 0) verdict = { rule: 'a GPU program was compiled', external: false };
    else if (waited < gap - VSYNC_MS - 1) verdict = { rule: 'the missing time is not in Present', external: false };
    else if (around > GPU_QUIET_MS) verdict = { rule: 'Present waited on a busy GPU process', external: false };
    else verdict = { rule: 'the wait in Present came from outside the page', external: true };
    stalls.set(k, { ...verdict, evidence: `${verdict.external ? 'excused' : 'counted'} by rule "${verdict.rule}": ${numbers}` });
  }
  const [from, to] = [at(rec.t[window.from - 1]!), at(rec.t[window.to]!)];
  const inWindow = mainTasks.filter((e) => e.ts < to && e.ts + (e.dur ?? 0) > from);
  const longTasks = inWindow
    .filter((e) => (e.dur ?? 0) > VSYNC_MS * 1000)
    .map((e) => ({ at: (e.ts - from) / 1000, ms: (e.dur ?? 0) / 1000, what: describeTask(events, e) }));
  return { costs, stalls, longTasks, longest: Math.max(0, ...inWindow.map((e) => (e.dur ?? 0) / 1000)) };
}

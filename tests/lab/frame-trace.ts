import type { Page } from '@playwright/test';

export type TraceEvent = {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string; data?: { startTime?: number } };
};

const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'toplevel',
  'gpu',
  'viz',
  'cc',
  'benchmark',
  'blink.user_timing',
  'v8',
];

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
 * Busy time over one frame interval, in ms: the page's main and compositor threads, the display compositor (`viz`) and
 * the GPU process's main thread (`gpu`, which also replays the page's raster), less the time it sat in `Present`
 * waiting for the OS compositor (`present`). `compiles` counts GPU programs compiled in the interval.
 */
export type FrameCost = { main: number; compositor: number; viz: number; gpu: number; present: number; compiles: number };

export type Slice = { thread: string; name: string; ms: number };

export type StallCause = 'main thread' | 'gpu process' | 'shader compile' | 'presentation' | 'nowhere visible';

/** What the trace holds for one interval over the stall threshold. */
export type StallTrace = FrameCost & {
  index: number;
  gap: number;
  /** Begin-frames the page's compositor got inside the interval that ran no animation frame. */
  beginFrames: number;
  /** The longest work inside the interval on the four threads. */
  longest: Slice[];
  where: StallCause;
};

type Threads = { main: string; compositor: string; viz: string; gpu: string };

const key = (pid: number, tid: number) => `${pid}:${tid}`;

function threads(events: TraceEvent[], mark: TraceEvent): Threads | null {
  const names = new Map<string, string>();
  const procs = new Map<number, string>();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'thread_name') names.set(key(e.pid, e.tid), String(e.args?.name));
    if (e.name === 'process_name') procs.set(e.pid, String(e.args?.name));
  }
  const find = (pid: number | undefined, name: string) => [...names].find(([k, n]) => n === name && k.startsWith(`${pid}:`))?.[0];
  const gpuPid = [...procs].find(([, n]) => n === 'GPU Process')?.[0];
  const compositor = find(mark.pid, 'Compositor');
  const gpu = find(gpuPid, 'CrGpuMain');
  const viz = find(gpuPid, 'VizCompositorThread');
  if (!compositor || !gpu || !viz) return null;
  return { main: key(mark.pid, mark.tid), compositor, viz, gpu };
}

const IGNORED = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'Scheduler::RunTask', 'Graphics.Pipeline', 'LatencyInfo.Flow']);
const PRESENT = 'DXGISwapChainImageBacking::Present';
/** Most of a frame: a thread busy this long inside a missed interval is where the frame went. */
const MOST_OF_A_FRAME = 12;

type Span = [number, number];

const overlap = (spans: Span[], a: number, b: number) => {
  let sum = 0;
  for (const [s, e] of spans) sum += Math.max(0, Math.min(e, b) - Math.max(s, a));
  return sum / 1000;
};

/** The trace's view of a recording: the cost of every frame interval of the window, and the detail of every stalled one. */
export function traceFrames(
  events: TraceEvent[],
  rec: { t: number[]; sync: number },
  window: { from: number; to: number },
  stall = 33,
): { costs: FrameCost[]; stalls: StallTrace[] } | null {
  const mark = events.find((e) => e.name === 'vk-rec' && e.cat.includes('blink.user_timing') && Math.abs(Number(e.args?.data?.startTime) - rec.sync) < 0.01);
  if (!mark) return null;
  const th = threads(events, mark);
  if (!th) return null;
  const offset = mark.ts - rec.sync * 1000;
  const at = (t: number) => t * 1000 + offset;
  const label = new Map<string, string>([[th.main, 'main'], [th.compositor, 'compositor'], [th.viz, 'viz'], [th.gpu, 'gpu']]);
  const tasks = new Map<string, Span[]>([...label.keys()].map((k) => [k, []]));
  const slices: (TraceEvent & { thread: string })[] = [];
  const presents: Span[] = [];
  const compiles: number[] = [];
  const beginFrames: number[] = [];
  for (const e of events) {
    const k = key(e.pid, e.tid);
    const thread = label.get(k);
    if (!thread) continue;
    if (e.ph === 'X' && e.name === 'RunTask') tasks.get(k)!.push([e.ts, e.ts + (e.dur ?? 0)]);
    else if (e.ph === 'X' && !IGNORED.has(e.name) && (e.dur ?? 0) > 500) slices.push({ ...e, thread });
    if (e.name === PRESENT && k === th.gpu) presents.push([e.ts, e.ts + (e.dur ?? 0)]);
    if (e.name === 'GrShaderCache::store') compiles.push(e.ts);
    if (e.ph === 'I' && e.name === 'BeginFrame' && k === th.compositor) beginFrames.push(e.ts);
  }
  const cost = (a: number, b: number): FrameCost => {
    const present = overlap(presents, a, b);
    return {
      main: overlap(tasks.get(th.main)!, a, b),
      compositor: overlap(tasks.get(th.compositor)!, a, b),
      viz: overlap(tasks.get(th.viz)!, a, b),
      gpu: overlap(tasks.get(th.gpu)!, a, b) - present,
      present,
      compiles: compiles.filter((ts) => ts >= a && ts < b).length,
    };
  };
  const costs: FrameCost[] = [];
  const stalls: StallTrace[] = [];
  for (let i = window.from; i <= window.to; i += 1) {
    const a = at(rec.t[i - 1]!);
    const b = at(rec.t[i]!);
    const c = cost(a, b);
    costs.push(c);
    const gap = rec.t[i]! - rec.t[i - 1]!;
    if (gap <= stall) continue;
    const longest = slices
      .map((e) => ({ thread: e.thread, name: e.name, ms: Math.max(0, Math.min(e.ts + e.dur!, b) - Math.max(e.ts, a)) / 1000 }))
      .filter((s) => s.ms > 0.5)
      .sort((x, y) => y.ms - x.ms)
      .slice(0, 6);
    const busiest = Math.max(c.main, c.gpu, c.viz);
    const where: StallCause =
      c.compiles > 0 ? 'shader compile' : busiest >= MOST_OF_A_FRAME ? (busiest === c.main ? 'main thread' : 'gpu process') : c.present >= MOST_OF_A_FRAME ? 'presentation' : 'nowhere visible';
    stalls.push({ index: i - window.from, gap, ...c, beginFrames: beginFrames.filter((ts) => ts > a + 2000 && ts < b - 2000).length, longest, where });
  }
  return { costs, stalls };
}

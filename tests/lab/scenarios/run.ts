import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { openCase } from '../helpers';
import { installProbe, record, sampleAt, sleep, type RecordContext, type Recording, type Track } from './capture';
import { Frames, ghost, seam, shape, state, vanish, type GateName, type GateResult, type GhostSpec, type SeamSpec, type ShapeSpec, type StateSpec, type VanishSpec } from './gates';
import { OUT_DIR, contactSheet, slug, viewOf, writeMetrics } from './report';

export type Gates = {
  seam?: SeamSpec;
  vanish?: VanishSpec;
  shape?: ShapeSpec;
  state?: StateSpec;
  ghost?: GhostSpec;
};

/** A finding of the acceptance issue a gate is expected to fail on the code as it is: the row is labelled, and goes green when it is fixed and the label removed. */
export type Known = Partial<Record<GateName, string>>;

export type Scenario = {
  name: string;
  /** The lab case, as a query string. */
  query: string;
  viewport: { width: number; height: number };
  /** Selector per key; the boxes of these elements are read in every frame. */
  track: Track;
  /** Which keys the contact sheet frames. */
  view: string[];
  /** Brings the page to where the recording starts; not recorded. */
  prepare?: (page: Page) => Promise<void>;
  act: (ctx: RecordContext) => Promise<void>;
  gates: Gates;
  /** A state gate per element of this key: element i is hovered and marked `hover<i>`. */
  states?: string;
  known?: Known;
  /** Opens the page instead of a lab case: a canary brings its own. */
  open?: (page: Page) => Promise<void>;
  touch?: boolean;
  colorScheme?: 'light' | 'dark';
};

export type Outcome = {
  name: string;
  results: GateResult[];
  known: Known;
  frames: number;
  longestGap: number;
  motion: string;
  sheet: string;
  pageErrors: string[];
};

export function judge(rec: Recording, gates: Gates, states?: string): GateResult[] {
  const frames = new Frames(rec);
  const results: GateResult[] = [];
  if (frames.length === 0) throw new Error(`${rec.name}: the screencast delivered no frame`);
  if (gates.seam) results.push(seam(frames, gates.seam));
  if (gates.vanish) results.push(vanish(frames, gates.vanish));
  if (gates.shape) results.push(shape(frames, gates.shape));
  if (gates.state) results.push(state(frames, gates.state));
  if (gates.ghost) results.push(ghost(frames, gates.ghost));
  if (states) {
    const rest = frames.before(rec.input);
    const count = sampleAt(rec.samples, frames.t(rest))?.boxes[states]?.filter((b) => !b.hidden).length ?? 0;
    const visible = (sampleAt(rec.samples, frames.t(rest))?.boxes[states] ?? []).flatMap((b, i) => (b.hidden ? [] : [i]));
    for (const [n, i] of visible.entries()) {
      const r = state(frames, { key: states, index: i, at: `hover${n}` });
      results.push({ ...r, line: `item ${n}: ${r.line}` });
    }
    if (count === 0) results.push({ gate: 'state', verdict: 'skip', line: `no element of "${states}"`, numbers: {}, flagged: [] });
  }
  return results;
}

/** Opens a lab case the way the behaviour tests do, then lets the page's own landings finish. */
export async function openLab(page: Page, query: string): Promise<void> {
  await openCase(page, query);
  await sleep(1200);
}

export async function play(browser: Browser, baseURL: string, sc: Scenario, sheetPage: Page): Promise<Outcome> {
  const context = await browser.newContext({
    baseURL,
    viewport: sc.viewport,
    deviceScaleFactor: 1,
    colorScheme: sc.colorScheme ?? 'light',
    ...(sc.touch ? { hasTouch: true } : {}),
  });
  try {
    const page = await context.newPage();
    await installProbe(page);
    await (sc.open ? sc.open(page) : openLab(page, sc.query));
    await sc.prepare?.(page);
    const wantsBackdrop = Boolean(sc.gates.shape && sc.gates.shape.ref !== 'rest');
    const rec = await record({
      name: sc.name,
      page,
      context,
      viewport: sc.viewport,
      track: sc.track,
      act: sc.act,
      ...(wantsBackdrop ? { backdrop: (p: Page) => (sc.open ? sc.open(p) : openLab(p, sc.query)) } : {}),
    });
    const results = judge(rec, sc.gates, sc.states);
    const dir = join(OUT_DIR, slug(sc.name));
    const sheet = join(dir, 'sheet.png');
    await contactSheet(sheetPage, rec, results, viewOf(rec, sc.view), sheet);
    writeMetrics(dir, rec, results);
    const gaps = rec.shots.map((s, i) => (i ? s.t - rec.shots[i - 1]!.t : 0));
    const outcome: Outcome = {
      name: sc.name,
      results,
      known: sc.known ?? {},
      frames: rec.shots.length,
      longestGap: Math.round(Math.max(0, ...gaps)),
      motion: rec.motion.map((m) => `${Math.round(m.start - rec.input)}..${Math.round(m.end - rec.input)}`).join(' '),
      sheet,
      pageErrors: rec.pageErrors,
    };
    writeFileSync(join(dir, 'outcome.json'), JSON.stringify({ ...outcome, results: outcome.results.map(({ series: _series, ...rest }) => rest) }, null, 1));
    return outcome;
  } finally {
    await context.close();
  }
}

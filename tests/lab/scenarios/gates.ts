import { clip, deltaE, labOf, pad, regionChange, union, type Rect } from './color';
import { deltaOf } from './delta';
import { sampleAt, type Box, type Recording, type Scroller } from './capture';
import { decodePng, type Image } from './png';

/** Every number a gate judges by, with where it comes from (docs/design.md, "Scenario recordings"). */
export const LIMITS = {
  /** A pixel counts as changed above this ΔE76. */
  changed: 3,
  /** Seam: the share of the element's region that may change between two frames after the motion has ended. */
  seamShare: 0.002,
  /** Seam: the mean ΔE over the region between two frames after the motion has ended. */
  seamMean: 0.15,
  /** Seam: the share of the region that may differ between the settled frame and the last one. */
  seamDrift: 0.004,
  /** Seam: the frame that presents a motion's last tick is compared with the one before it only when they are neighbours, at most this many ms apart; across a dropped frame the step holds motion. */
  frameGap: 26,
  /** Pop: the mean ΔE between two consecutive frames in the region of an element whose box did not move between them. */
  popMean: 1.2,
  /** Pop: how long after a surface has left its target's place the target's glyph and focus ring come into focus, which is a ramp of its own and may change the picture faster than an element at rest. */
  handoverMs: 450,
  /** Pop: the frame in which a surface has handed its place back to its target, the mean ΔE it may change by in a frame. */
  popHandover: 3,
  /** Hole and together: a motion's first moments, in which a surface tightens inside its trigger's box and the trigger's glyphs go out of focus, are not judged. */
  contractionMs: 160,
  /** Hole: the ink of a trigger that is alone in its place may fall to this fraction of its ink at rest. */
  holeInk: 0.5,
  /** Converge: how far, in mean ΔE over the region, a motion may turn away from the picture it settles to after it has come closer to it. */
  convergeBounce: 3,
  /** Vanish: the ink of an item may fall to this fraction of its ink at rest. */
  inkKept: 0.5,
  /** Shape: a pixel outside the radius differing from the backdrop by more than this counts as drawn. */
  cornerDrawn: 6,
  /** Shape: the share of the pixels outside the radius that may be drawn. */
  cornerShare: 0.15,
  /** Together: the edge of a trigger that shows its label differs from the page by this fraction of what it does at rest; a hovered body is lifted toward the page, and sits lower than the one at rest. */
  bodyKept: 0.3,
  /** Ghost: the share of a part's pixels that may differ from the settled target while the surface is the size of it. */
  ghostShare: 0.05,
  /** State: the mean ΔE of the element's region between rest and the state that must be seen. */
  stateMean: 2.3,
  /** State: or the 95th percentile of the ΔE of the changed pixels, when at least `stateRim` of the region changed: a thin rim moves the mean little and is seen. */
  stateP95: 8,
  stateRim: 0.01,
  /** State: or the 95th percentile of the relative luminance step of the changed pixels, over the same share: a step that is small in ΔE is large on a dark surface. */
  stateWeber: 0.08,
  /** Highlight: the share of the corners of the changed pixels' capsule that the state may paint. */
  highlightCorners: 0.36,
} as const;

export type Verdict = 'pass' | 'fail' | 'skip';
export type GateName = 'landing' | 'box' | 'together' | 'seam' | 'pop' | 'hole' | 'converge' | 'vanish' | 'shape' | 'state' | 'highlight' | 'ghost' | 'scrollbar';
export type GateResult = {
  gate: GateName;
  verdict: Verdict;
  /** One line with the numbers, printed in the summary. */
  line: string;
  numbers: Record<string, number | string>;
  /** Indices into `shots` of the frames the verdict points at. */
  flagged: number[];
  /** The metric per frame, for the JSON. */
  series?: { index: number; t: number; value: number }[];
};

/** Decodes frames on demand and keeps only a few: a recording decoded whole is hundreds of megabytes. */
export class Frames {
  readonly #cache = new Map<number, Image>();
  constructor(readonly rec: Recording) {}
  at(i: number): Image {
    let img = this.#cache.get(i);
    if (!img) {
      img = decodePng(this.rec.shots[i]!.png);
      this.#cache.set(i, img);
      if (this.#cache.size > 6) this.#cache.delete(this.#cache.keys().next().value!);
    }
    return img;
  }
  get length(): number {
    return this.rec.shots.length;
  }
  t(i: number): number {
    return this.rec.shots[i]!.t;
  }
  /** The index of the last frame at or before `t`, or the first. */
  before(t: number): number {
    let found = 0;
    for (let i = 0; i < this.length; i += 1) if (this.t(i) <= t) found = i;
    return found;
  }
  /** The index of the first frame at or after `t`, or the last. */
  from(t: number): number {
    for (let i = 0; i < this.length; i += 1) if (this.t(i) >= t) return i;
    return this.length - 1;
  }
}

const boxesAt = (rec: Recording, key: string, t: number): Box[] => sampleAt(rec.samples, t)?.boxes[key] ?? [];
const visible = (boxes: Box[]): Rect[] => boxes.filter((b) => !b.hidden).map(({ x, y, w, h }) => ({ x, y, w, h }));

const ms = (v: number) => `${Math.round(v)} ms`;
const f2 = (v: number) => v.toFixed(2);
const f3 = (v: number) => v.toFixed(3);

export type SeamSpec = { keys: string[]; pad?: number };

type Region = { name: string; rect: Rect };

/** One region per element of every key (its boxes at the motion's start and end), and the union of them all: a small element's pop is not diluted by the area of a large one beside it. */
function regionsOf(rec: Recording, keys: string[], t0: number, t1: number, by: number): Region[] {
  const out: Region[] = [];
  for (const key of keys) {
    const a = boxesAt(rec, key, t0);
    const z = boxesAt(rec, key, t1);
    for (let i = 0; i < Math.max(a.length, z.length); i += 1) {
      const u = union(visible([a[i], z[i]].filter((b): b is Box => b !== undefined)));
      if (u) out.push({ name: a.length > 1 || z.length > 1 ? `${key}[${i}]` : key, rect: pad(u, by) });
    }
  }
  const all = union(keys.flatMap((key) => [...visible(boxesAt(rec, key, t1)), ...visible(boxesAt(rec, key, t0))]));
  if (all && out.length > 1) out.push({ name: 'all', rect: pad(all, by) });
  return out;
}

/**
 * From the frame that presents a motion's last tick, nothing inside an element's region may change from the frame before
 * (through 1.5 s after it, or until the next motion starts): the motion ends on the picture it settles to. Every
 * element of the scenario is judged in its own region. Reports the worst frame-to-frame step and the total drift.
 */
export function seam(frames: Frames, spec: SeamSpec): GateResult {
  const rec = frames.rec;
  const quiet = 1500;
  const worst = { t: 0, mean: 0, share: 0, region: '' };
  const flagged = new Set<number>();
  const series: NonNullable<GateResult['series']> = [];
  const hot = new Map<string, number>();
  let drift = 0;
  let driftAt = 0;
  let driftRegion = '';
  let evaluated = 0;
  let pairs = 0;
  let firstLate = '';
  rec.motion.forEach((segment, k) => {
    const next = rec.motion[k + 1]?.start ?? Infinity;
    const until = Math.min(segment.end + quiet, next);
    if (until - segment.end < 300) return;
    const regions = regionsOf(rec, spec.keys, segment.start, segment.end, spec.pad ?? 20);
    if (regions.length === 0) return;
    const first = frames.from(segment.end);
    evaluated += 1;
    let last = first;
    for (let j = Math.max(first, 1); j < frames.length && frames.t(j) <= until; j += 1) {
      if (j === first && frames.t(j) - frames.t(j - 1) > LIMITS.frameGap) continue;
      pairs += 1;
      const after = frames.t(j) - segment.end;
      let step = 0;
      for (const region of regions) {
        const c = regionChange(frames.at(j - 1), frames.at(j), region.rect, LIMITS.changed);
        step = Math.max(step, c.mean);
        if (c.share > LIMITS.seamShare || c.mean > LIMITS.seamMean) {
          flagged.add(j);
          hot.set(region.name, (hot.get(region.name) ?? 0) + 1);
          if (!firstLate) firstLate = `first step at +${ms(after)} in ${region.name}`;
        }
        if (c.share > worst.share || (c.share === worst.share && c.mean > worst.mean)) Object.assign(worst, { t: after, mean: c.mean, share: c.share, region: region.name });
      }
      series.push({ index: j, t: after, value: step });
      last = j;
    }
    if (last > first) {
      for (const region of regions) {
        const d = regionChange(frames.at(first), frames.at(last), region.rect, LIMITS.changed);
        if (d.share >= drift) {
          drift = d.share;
          driftAt = frames.t(last) - segment.end;
          driftRegion = region.name;
        }
      }
    }
  });
  if (evaluated === 0) return { gate: 'seam', verdict: 'skip', line: 'no motion with a region to watch', numbers: {}, flagged: [] };
  const bad = flagged.size > 0 || drift > LIMITS.seamDrift;
  const where = [...hot.entries()].map(([name, n]) => `${name} ${n}`).join(', ');
  return {
    gate: 'seam',
    verdict: bad ? 'fail' : 'pass',
    line: `${pairs} steps after ${evaluated} motion(s); worst +${ms(worst.t)} in ${worst.region}: mean ΔE ${f3(worst.mean)}, ${f3(worst.share * 100)}% changed; drift ${f3(drift * 100)}%${drift > 0 ? ` in ${driftRegion}` : ''}${firstLate ? `; ${firstLate}` : ''}${where ? `; steps over the limit per region: ${where}` : ''}`,
    numbers: { motions: evaluated, steps: pairs, worstAtMs: Math.round(worst.t), worstRegion: worst.region, worstMeanDE: +f3(worst.mean), worstSharePct: +f3(worst.share * 100), flaggedSteps: flagged.size, driftPct: +f3(drift * 100), driftAtMs: Math.round(driftAt) },
    flagged: [...flagged],
    series,
  };
}

const medianOf = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;

/** The ink in a region: the pixels that stand out from the region's median colour by a clear ΔE, which is what a glyph is. */
export function ink(image: Image, region: Rect): number {
  const { x0, y0, x1, y1 } = clip(region, image);
  const lab: [number, number, number][] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * image.width + x) * 4;
      lab.push(labOf(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!));
    }
  }
  if (lab.length === 0) return 0;
  const m: Lab3 = [medianOf(lab.map((c) => c[0])), medianOf(lab.map((c) => c[1])), medianOf(lab.map((c) => c[2]))];
  let n = 0;
  for (const c of lab) if (Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2]) > INK_DE) n += 1;
  return n;
}

type Lab3 = [number, number, number];
const INK_DE = 14;

/** A frame within three of a stall of the compositor, or presented less than half a frame after one, carries the ticks of the stall and is catching up: it is not one tick of the motion. */
/** The time of the last frame at or before `j` in which the surface was out. */
function lastOut(rec: Recording, surface: string, frames: Frames, j: number): number {
  for (let k = j; k >= 0; k -= 1) if (boxesAt(rec, surface, frames.t(k))[0]?.hidden === false) return frames.t(k);
  return Number.NEGATIVE_INFINITY;
}

const stalled = (frames: Frames, j: number): boolean => {
  if (frames.t(j) - frames.t(j - 1) < 8) return true;
  for (let back = 0; back < 3 && j - back >= 2; back += 1) {
    const gap = frames.t(j - back) - frames.t(j - back - 1 < 0 ? 0 : j - back - 1);
    if (gap > LIMITS.frameGap || gap < 8) return true;
  }
  return false;
};

export type PopSpec = { keys: string[]; pad?: number; /** A surface that grows out of the element: a frame in which it is out is not judged, since it changes the region by being there; the frame in which it has left, against the one before, is. */ surface?: string };

/** The surface is closed, or back at the size and place of the target within `tol`; with a negative `tol`, only closed. */
function away(rec: Recording, surface: string | undefined, target: Box, t: number, tol = 8): boolean {
  if (!surface) return true;
  const s = boxesAt(rec, surface, t)[0];
  return !s || s.hidden || (tol >= 0 && Math.abs(s.w - target.w) <= tol && Math.abs(s.h - target.h) <= tol && Math.abs(s.x - target.x) <= tol && Math.abs(s.y - target.y) <= tol);
}

/**
 * A change that comes at once, in the middle of a motion, in a place where nothing moves: the region of an element
 * whose box is the same in two consecutive frames must not change between them by more than `popMean`. It is what a
 * body, a label or a grabber swapped in one frame does, and what the seam gate cannot see because it only looks after the motion's end.
 */
export function pop(frames: Frames, spec: PopSpec): GateResult {
  const rec = frames.rec;
  const flagged: number[] = [];
  const series: NonNullable<GateResult['series']> = [];
  const worst = { mean: 0, t: 0, key: '', gap: 0 };
  let checked = 0;
  for (let j = 1; j < frames.length; j += 1) {
    for (const key of spec.keys) {
      const now = boxesAt(rec, key, frames.t(j));
      const before = boxesAt(rec, key, frames.t(j - 1));
      now.forEach((b, i) => {
        const p = before[i];
        if (!p || b.hidden || p.hidden || stalled(frames, j) || !away(rec, spec.surface, b, frames.t(j), -1) || Math.abs(b.x - p.x) > 0.3 || Math.abs(b.y - p.y) > 0.3 || Math.abs(b.w - p.w) > 0.3 || Math.abs(b.h - p.h) > 0.3) return;
        checked += 1;
        const c = regionChange(frames.at(j - 1), frames.at(j), pad(b, spec.pad ?? 4), LIMITS.changed);
        series.push({ index: j, t: frames.t(j) - rec.input, value: c.mean });
        const left = spec.surface !== undefined && frames.t(j) - lastOut(rec, spec.surface, frames, j) < LIMITS.handoverMs;
        if (c.mean > (left ? LIMITS.popHandover : LIMITS.popMean)) flagged.push(j);
        if (c.mean > worst.mean) Object.assign(worst, { mean: c.mean, t: frames.t(j) - rec.input, key: key, gap: frames.t(j) - frames.t(j - 1) });
      });
    }
  }
  if (checked === 0) return { gate: 'pop', verdict: 'skip', line: 'no element stood still between two frames', numbers: {}, flagged: [] };
  return {
    gate: 'pop',
    verdict: flagged.length > 0 ? 'fail' : 'pass',
    line: `${checked} still regions in consecutive frames; worst +${ms(worst.t)} in ${worst.key} (${ms(worst.gap)} after the frame before): mean ΔE ${f2(worst.mean)}; ${flagged.length} steps over ${LIMITS.popMean}`,
    numbers: { checked, worstMeanDE: +f2(worst.mean), worstAtMs: Math.round(worst.t), worstKey: worst.key, steps: flagged.length },
    flagged: [...new Set(flagged)],
    series,
  };
}

export type HoleSpec = { target: string; surface: string; tol?: number };

/**
 * A trigger that is alone in its place (its surface closed, or back at its size) shows its label: the ink of its box
 * is at least half of what it is at rest. The pill that has arrived with no label on it, and the gap before the
 * button follows, are a hole. Judged by the ink of the box, which the vanish gate defines.
 */
export function hole(frames: Frames, spec: HoleSpec): GateResult {
  const rec = frames.rec;
  const rest = frames.before(rec.input);
  const home = boxesAt(rec, spec.target, frames.t(rest))[0];
  if (!home || home.hidden) return { gate: 'hole', verdict: 'skip', line: `no box of "${spec.target}" at rest`, numbers: {}, flagged: [] };
  const base = ink(frames.at(rest), home);
  if (base === 0) return { gate: 'hole', verdict: 'skip', line: 'the trigger has no ink at rest', numbers: {}, flagged: [] };
  const tol = spec.tol ?? 8;
  const flagged: number[] = [];
  const series: NonNullable<GateResult['series']> = [];
  const worst = { ratio: 1, t: 0 };
  let checked = 0;
  for (let j = rest + 1; j < frames.length; j += 1) {
    const target = boxesAt(rec, spec.target, frames.t(j))[0];
    if (!target || target.hidden) continue;
    const surface = boxesAt(rec, spec.surface, frames.t(j))[0];
    const away = !surface || surface.hidden || (Math.abs(surface.w - target.w) <= tol && Math.abs(surface.h - target.h) <= tol && Math.abs(surface.x - target.x) <= tol && Math.abs(surface.y - target.y) <= tol);
    if (!away) continue;
    // The drop tightens inside the trigger's box for the first moments of a motion, while its glyphs go out of focus.
    if (rec.motion.some((m) => frames.t(j) >= m.start && frames.t(j) < m.start + LIMITS.contractionMs)) continue;
    checked += 1;
    const ratio = ink(frames.at(j), target) / base;
    series.push({ index: j, t: frames.t(j) - rec.input, value: ratio });
    if (ratio < LIMITS.holeInk) flagged.push(j);
    if (ratio < worst.ratio) Object.assign(worst, { ratio, t: frames.t(j) - rec.input });
  }
  if (checked === 0) return { gate: 'hole', verdict: 'skip', line: 'the trigger was never alone in its place', numbers: {}, flagged: [] };
  return {
    gate: 'hole',
    verdict: flagged.length > 0 ? 'fail' : 'pass',
    line: `${checked} frames with the surface closed or back at the trigger; the least ink at +${ms(worst.t)}: ${Math.round(worst.ratio * 100)}% of its ink at rest; ${flagged.length} frames under ${LIMITS.holeInk * 100}%`,
    numbers: { frames: checked, leastInkPct: Math.round(worst.ratio * 100), leastAtMs: Math.round(worst.t), framesEmpty: flagged.length },
    flagged,
    series,
  };
}

export type ConvergeSpec = { keys: string[]; pad?: number };

/**
 * A motion goes to the picture it settles to and stays on the way: the distance (mean ΔE over the elements' region)
 * between a frame and the settled picture of that motion falls, and any rise after it has fallen is the picture
 * turning back, as a selection that leaves one item, starts on another and comes back, or two indicators that trade places.
 */
export function converge(frames: Frames, spec: ConvergeSpec): GateResult {
  const rec = frames.rec;
  const series: NonNullable<GateResult['series']> = [];
  const flagged: number[] = [];
  const worst = { rise: 0, t: 0 };
  let evaluated = 0;
  rec.motion.forEach((segment, k) => {
    const next = rec.motion[k + 1]?.start ?? Infinity;
    const until = Math.min(segment.end + 1500, next);
    if (until - segment.end < 300) return;
    const regions = regionsOf(rec, spec.keys, segment.start, segment.end, spec.pad ?? 8);
    const region = regions.find((r) => r.name === 'all') ?? regions[0];
    if (!region) return;
    const settled = frames.before(until);
    if (frames.t(settled) < segment.end) return;
    const from = frames.from(segment.start - 40);
    evaluated += 1;
    let least = Infinity;
    for (let j = from; j < settled; j += 1) {
      const d = regionChange(frames.at(j), frames.at(settled), region.rect, LIMITS.changed).mean;
      series.push({ index: j, t: frames.t(j) - rec.input, value: d });
      if (d < least) least = d;
      else if (d - least > LIMITS.convergeBounce) flagged.push(j);
      if (least < Infinity && d - least > worst.rise) Object.assign(worst, { rise: d - least, t: frames.t(j) - rec.input });
    }
  });
  if (evaluated === 0) return { gate: 'converge', verdict: 'skip', line: 'no motion with a region to watch', numbers: {}, flagged: [] };
  return {
    gate: 'converge',
    verdict: flagged.length > 0 ? 'fail' : 'pass',
    line: `${evaluated} motion(s); the picture turned back from its settled one by up to ${f2(worst.rise)} ΔE (at +${ms(worst.t)}); ${flagged.length} frames over ${LIMITS.convergeBounce}`,
    numbers: { motions: evaluated, worstRiseDE: +f2(worst.rise), worstAtMs: Math.round(worst.t), framesOver: flagged.length },
    flagged,
    series,
  };
}

export type ScrollbarSpec = { at?: string };

const bareBar = (s: Scroller): boolean => s.scrollbarWidth === 'none' || /^none\//.test(s.webkit) || /\/0(px)?$/.test(s.webkit);

/**
 * What scrolls inside a kit surface shows the kit's own indicator, never the platform's. Judged from the container's
 * styles (`scrollbar-width: none`, or `::-webkit-scrollbar` with no display) and from its pixels: the gutter the
 * platform's bar takes at the container's edge, in a frame while it was scrolled, differs from the content beside it.
 */
export function scrollbar(frames: Frames, spec: ScrollbarSpec): GateResult {
  const rec = frames.rec;
  if (rec.scrollers.length === 0) return { gate: 'scrollbar', verdict: 'skip', line: 'nothing scrolled inside the surface', numbers: {}, flagged: [] };
  const mark = spec.at ? rec.marks[spec.at] : undefined;
  const j = mark === undefined ? frames.length - 1 : frames.before(mark);
  const img = frames.at(j);
  const found = rec.scrollers.map((s) => {
    let drawn = 0;
    let total = 0;
    if (s.gutter > 2) {
      for (let y = Math.ceil(s.y); y < Math.floor(s.y + s.h); y += 1) {
        for (let x = Math.ceil(s.x + s.w); x < Math.floor(s.x + s.w + s.gutter); x += 1) {
          const i = (y * img.width + x) * 4;
          const k = (y * img.width + (x - Math.floor(s.gutter) - 4)) * 4;
          total += 1;
          if (deltaE(img, i, img, k) > LIMITS.cornerDrawn) drawn += 1;
        }
      }
    }
    return { s, platform: !bareBar(s), drawn: total ? drawn / total : 0 };
  });
  const bad = found.filter((f) => f.platform);
  return {
    gate: 'scrollbar',
    verdict: bad.length > 0 ? 'fail' : 'pass',
    line: found.map((f) => `${f.s.name}: scrollbar-width ${f.s.scrollbarWidth}, ::-webkit-scrollbar ${f.s.webkit}, gutter ${f.s.gutter} px (${f2(f.drawn * 100)}% of it drawn unlike the content beside it) -> ${f.platform ? 'the platform bar' : 'no platform bar'}`).join('; '),
    numbers: { scrollers: found.length, platformBars: bad.length, gutterPx: Math.max(0, ...found.map((f) => f.s.gutter)), gutterDrawnPct: +f2(Math.max(0, ...found.map((f) => f.drawn)) * 100) },
    flagged: bad.length > 0 ? [j] : [],
  };
}

export type VanishSpec = { key: string; label?: (index: number) => string };

/** Every item keeps the ink it has at rest, in every frame: the real glyph or the lens's magnified copy of it. */
export function vanish(frames: Frames, spec: VanishSpec): GateResult {
  const rec = frames.rec;
  const rest = frames.before(rec.input);
  const items = boxesAt(rec, spec.key, frames.t(rest)).filter((b) => !b.hidden);
  if (items.length === 0) return { gate: 'vanish', verdict: 'skip', line: `no item of "${spec.key}" at rest`, numbers: {}, flagged: [] };
  const base = items.map((b) => ink(frames.at(rest), b));
  const lost = new Map<number, { frames: number; first: number; lowest: number }>();
  const flagged: number[] = [];
  const series: NonNullable<GateResult['series']> = [];
  for (let j = rest + 1; j < frames.length; j += 1) {
    const now = boxesAt(rec, spec.key, frames.t(j));
    if (now.length !== items.length) continue;
    const img = frames.at(j);
    let low = Infinity;
    let any = false;
    now.forEach((b, i) => {
      if (b.hidden || base[i]! === 0) return;
      const ratio = ink(img, b) / base[i]!;
      low = Math.min(low, ratio);
      if (ratio < LIMITS.inkKept) {
        any = true;
        const e = lost.get(i) ?? { frames: 0, first: j, lowest: 1 };
        e.frames += 1;
        e.lowest = Math.min(e.lowest, ratio);
        lost.set(i, e);
      }
    });
    if (low === Infinity) continue;
    series.push({ index: j, t: frames.t(j) - rec.input, value: low });
    if (any) flagged.push(j);
  }
  const lowest = Math.round(Math.min(...series.map((s) => s.value), 1) * 100);
  const names = [...lost.entries()].map(([i, e]) => `${spec.label?.(i) ?? `#${i}`}: ${e.frames} frames from +${ms(frames.t(e.first) - rec.input)}, down to ${Math.round(e.lowest * 100)}% of its ink`);
  return {
    gate: 'vanish',
    verdict: lost.size > 0 ? 'fail' : 'pass',
    line: lost.size > 0 ? `${lost.size} of ${items.length} items lose their ink (${names.join('; ')})` : `${items.length} items keep their ink in all ${series.length} frames (lowest ${lowest}% of rest)`,
    numbers: { items: items.length, itemsLost: lost.size, framesFlagged: flagged.length, lowestInkPct: lowest },
    flagged,
    series,
  };
}

const sameSize = (a: Box, b: Box | undefined): boolean => b !== undefined && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

export type ShapeSpec = {
  keys: string[];
  /** `capsule` (the default) expects the radius to be half the short side whatever the element declares; `declared` takes what it declares. */
  expect?: 'capsule' | 'declared';
  /** What the corners are compared with: the page behind the kit (the default), or the frame before the input, for an element that sits on glass of its own. */
  ref?: 'backdrop' | 'rest';
  /** Also judges the frames inside the kit's motions, in which an element whose box is the same size as one frame before is the shape drawn in it: a capsule that is square while it moves is seen. */
  during?: boolean;
};

/** Pixels in the corners of a box, outside the arc of its radius and clear of the arc by `clear`, as indices into the image data. */
export function cornerPixels(box: Box, image: Image, clear: number): number[] {
  const out: number[] = [];
  const r = box.r;
  if (r < 6) return out;
  const corners = [
    [box.x, box.y, 1, 1],
    [box.x + box.w, box.y, -1, 1],
    [box.x, box.y + box.h, 1, -1],
    [box.x + box.w, box.y + box.h, -1, -1],
  ] as const;
  for (const [cx, cy, sx, sy] of corners) {
    const ax = cx + sx * r;
    const ay = cy + sy * r;
    for (let dy = 0; dy < r; dy += 1) {
      for (let dx = 0; dx < r; dx += 1) {
        const px = cx + sx * (dx + 0.5);
        const py = cy + sy * (dy + 0.5);
        if (Math.hypot(px - ax, py - ay) < r + clear) continue;
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue;
        out.push((iy * image.width + ix) * 4);
      }
    }
  }
  return out;
}

/** Judged outside the kit's motions: while one runs, an element's box is not the shape drawn in it. The corners of a rounded element show the backdrop, not glass: outside the radius a frame differs from the page behind it by little. */
export function shape(frames: Frames, spec: ShapeSpec): GateResult {
  const rec = frames.rec;
  if (spec.ref !== 'rest' && rec.backdrops.length === 0) return { gate: 'shape', verdict: 'skip', line: 'no backdrop reference', numbers: {}, flagged: [] };
  const rest = frames.before(rec.input);
  const backdrops = rec.backdrops.map((b) => ({ at: b.mark === null ? -Infinity : (rec.marks[b.mark] ?? Infinity), image: spec.ref === 'rest' ? null : decodePng(b.png) }));
  const referenceAt = (t: number): Image => (spec.ref === 'rest' ? frames.at(rest) : [...backdrops].reverse().find((b) => b.at <= t)!.image!);
  const radiusOf = (b: Box): number => (spec.expect === 'declared' ? b.r : Math.min(b.w, b.h) / 2);
  const flagged: number[] = [];
  const series: NonNullable<GateResult['series']> = [];
  let worst = { share: 0, t: 0, r: 0 };
  let checked = 0;
  for (let j = spec.ref === 'rest' ? rest + 1 : 0; j < frames.length; j += 1) {
    const moving = rec.motion.some((m) => frames.t(j) >= m.start && frames.t(j) < m.end);
    if (moving && !spec.during) continue;
    const img = frames.at(j);
    const boxes = spec.keys.flatMap((key) => boxesAt(rec, key, frames.t(j)).filter((b, i) => !moving || sameSize(b, boxesAt(rec, key, frames.t(j) - 17)[i]))).filter((b) => !b.hidden).map((b) => ({ ...b, r: radiusOf(b) })).filter((b) => b.r >= 6);
    if (boxes.length === 0) continue;
    let drawn = 0;
    let total = 0;
    for (const box of boxes) {
      for (const i of cornerPixels(box, img, Math.min(6, box.r * 0.2))) {
        total += 1;
        if (deltaE(img, i, referenceAt(frames.t(j)), i) > LIMITS.cornerDrawn) drawn += 1;
      }
    }
    if (total === 0) continue;
    checked += 1;
    const share = drawn / total;
    series.push({ index: j, t: frames.t(j) - rec.input, value: share });
    if (share > LIMITS.cornerShare) flagged.push(j);
    if (share > worst.share) worst = { share, t: frames.t(j) - rec.input, r: boxes[0]!.r };
  }
  if (checked === 0) return { gate: 'shape', verdict: 'skip', line: `no rounded box of "${spec.keys.join(", ")}" in any frame`, numbers: {}, flagged: [] };
  return {
    gate: 'shape',
    verdict: flagged.length > 0 ? 'fail' : 'pass',
    line: `${checked} frames; worst +${ms(worst.t)} (radius ${Math.round(worst.r)} px): ${f3(worst.share * 100)}% of the pixels outside the radius are drawn; ${flagged.length} frames over ${LIMITS.cornerShare * 100}%`,
    numbers: { frames: checked, worstSharePct: +f3(worst.share * 100), worstAtMs: Math.round(worst.t), framesOver: flagged.length },
    flagged,
    series,
  };
}

export type StateSpec = { key: string; index?: number; at: string };

const stateBox = (frames: Frames, spec: StateSpec): { error: string } | { error?: undefined; rest: number; target: number; box: Box } => {
  const rec = frames.rec;
  const rest = frames.before(rec.input);
  const mark = rec.marks[spec.at];
  if (mark === undefined) return { error: `no mark "${spec.at}"` };
  const box = boxesAt(rec, spec.key, frames.t(rest))[spec.index ?? 0];
  if (!box || box.hidden) return { error: `no box of "${spec.key}"` } as const;
  return { rest, target: frames.before(mark), box } as const;
};

/** The state is seen: the element's region at the mark differs from its region at rest by a mean ΔE of a just noticeable difference, or, over at least 1 % of it, by a clear ΔE or a clear relative luminance step at the 95th percentile of the changed pixels, which is what a thin rim does and what a dark surface shows. */
export function state(frames: Frames, spec: StateSpec): GateResult {
  const at = stateBox(frames, spec);
  if (at.error !== undefined) return { gate: 'state', verdict: 'skip', line: at.error, numbers: {}, flagged: [] };
  const c = deltaOf(frames.at(at.rest), frames.at(at.target), pad(at.box, 2), LIMITS.changed);
  const byMean = c.mean >= LIMITS.stateMean;
  const byRim = c.p95 >= LIMITS.stateP95 && c.share >= LIMITS.stateRim;
  const byWeber = c.weber >= LIMITS.stateWeber && c.share >= LIMITS.stateRim;
  return {
    gate: 'state',
    verdict: byMean || byRim || byWeber ? 'pass' : 'fail',
    line: `${spec.at}: mean ΔE ${f2(c.mean)} (needs ${LIMITS.stateMean}) or p95 of the changed ${f2(c.p95)} over ${f2(c.share * 100)}% of ${Math.round(at.box.w)}×${Math.round(at.box.h)} px (needs ${LIMITS.stateP95} over ${LIMITS.stateRim * 100}%), peak ${f2(c.max)}, relative luminance step p95 ${f3(c.weber)} (needs ${LIMITS.stateWeber})`,
    numbers: { meanDE: +f2(c.mean), p95DE: +f2(c.p95), weber95: +f3(c.weber), sharePct: +f2(c.share * 100), peakDE: +f2(c.max), by: byMean ? 'mean' : byRim ? 'rim' : byWeber ? 'relative' : 'none' },
    flagged: [at.target],
  };
}

/** What a state paints is the element's own shape: the pixels it changes, boxed, leave the corners of a capsule on that box alone. A hover that lights a rectangle inside a capsule paints them. */
export function highlight(frames: Frames, spec: StateSpec): GateResult {
  const at = stateBox(frames, spec);
  if (at.error !== undefined) return { gate: 'highlight', verdict: 'skip', line: at.error, numbers: {}, flagged: [] };
  const c = deltaOf(frames.at(at.rest), frames.at(at.target), pad(at.box, 6), LIMITS.changed);
  if (c.corners === null || !c.box) return { gate: 'highlight', verdict: 'skip', line: `${spec.at}: nothing changed, or too little to have a corner (${c.changed} px)`, numbers: { changedPx: c.changed }, flagged: [] };
  return {
    gate: 'highlight',
    verdict: c.corners > LIMITS.highlightCorners ? 'fail' : 'pass',
    line: `${spec.at}: the changed pixels fill ${Math.round(c.box.w)}×${Math.round(c.box.h)} px and paint ${f2(c.corners * 100)}% of the corners outside a capsule on it (limit ${LIMITS.highlightCorners * 100}%)`,
    numbers: { cornersPct: +f2(c.corners * 100), boxW: Math.round(c.box.w), boxH: Math.round(c.box.h) },
    flagged: [at.target],
  };
}

export type GhostSpec = { surface: string; target: string; part: string; tol?: number };

/** A surface that has shrunk to its target's box looks like the target: the part that belongs to the open surface (a grabber) is gone, not left on the pill. Compared with the last frame, where only the target is. */
export function ghost(frames: Frames, spec: GhostSpec): GateResult {
  const rec = frames.rec;
  const tol = spec.tol ?? 8;
  const last = frames.length - 1;
  const flagged: number[] = [];
  const series: NonNullable<GateResult['series']> = [];
  let worst = { share: 0, t: 0 };
  let checked = 0;
  for (let j = 0; j < last; j += 1) {
    const surface = boxesAt(rec, spec.surface, frames.t(j))[0];
    const target = boxesAt(rec, spec.target, frames.t(j))[0];
    const part = boxesAt(rec, spec.part, frames.t(j))[0];
    if (!surface || !target || !part || surface.hidden || target.hidden || part.hidden) continue;
    if (Math.abs(surface.w - target.w) > tol || Math.abs(surface.h - target.h) > tol) continue;
    const x0 = Math.max(part.x, surface.x);
    const y0 = Math.max(part.y, surface.y);
    const region = { x: x0, y: y0, w: Math.min(part.x + part.w, surface.x + surface.w) - x0, h: Math.min(part.y + part.h, surface.y + surface.h) - y0 };
    if (region.w * region.h < 16) continue;
    checked += 1;
    const c = regionChange(frames.at(j), frames.at(last), region, LIMITS.changed);
    series.push({ index: j, t: frames.t(j) - rec.input, value: c.share });
    if (c.share > LIMITS.ghostShare) flagged.push(j);
    if (c.share > worst.share) worst = { share: c.share, t: frames.t(j) - rec.input };
  }
  if (checked === 0) return { gate: 'ghost', verdict: 'skip', line: 'the surface never shrank to its target', numbers: {}, flagged: [] };
  return {
    gate: 'ghost',
    verdict: flagged.length > 0 ? 'fail' : 'pass',
    line: `${checked} frames with the surface at the size of its target; worst +${ms(worst.t)}: ${f2(worst.share * 100)}% of the part's pixels differ from the settled target; ${flagged.length} frames over ${LIMITS.ghostShare * 100}%`,
    numbers: { frames: checked, worstSharePct: +f2(worst.share * 100), worstAtMs: Math.round(worst.t), framesOver: flagged.length },
    flagged,
    series,
  };
}

export type LandingSpec = { max?: Partial<Record<'landedBlend' | 'probesAtLand' | 'syncSwaps', number>> };

/** The core's own counters over the scenario: a motion lands in its last frame, so no landing blends, probes the backdrop or swaps a filter in its own task. */
export function landing(frames: Frames, spec: LandingSpec): GateResult {
  const stats = frames.rec.stats;
  if (!stats) return { gate: 'landing', verdict: 'skip', line: 'the page has no render stats', numbers: {}, flagged: [] };
  const max = { landedBlend: 0, probesAtLand: 0, syncSwaps: 0, ...spec.max };
  const over = (Object.keys(max) as (keyof typeof max)[]).filter((k) => stats[k] > max[k]);
  return {
    gate: 'landing',
    verdict: over.length > 0 ? 'fail' : 'pass',
    line: `landedExact ${stats.landedExact}, landedBlend ${stats.landedBlend}, probesAtLand ${stats.probesAtLand}, syncSwaps ${stats.syncSwaps} (limits ${max.landedBlend}, ${max.probesAtLand}, ${max.syncSwaps}); probes ${stats.probes}, full bakes ${stats.fullBakes}, filter swaps ${stats.filterSwaps}`,
    numbers: { landedExact: stats.landedExact, landedBlend: stats.landedBlend, probesAtLand: stats.probesAtLand, syncSwaps: stats.syncSwaps },
    flagged: [],
  };
}

export type BoxSpec = { key: string; tol?: number };

/** A trigger does not move or change size while a surface grows out of it and returns: its box in every frame is the box it had at rest. */
export function box(frames: Frames, spec: BoxSpec): GateResult {
  const rec = frames.rec;
  const tol = spec.tol ?? 0.5;
  const rest = frames.before(rec.input);
  const home = boxesAt(rec, spec.key, frames.t(rest))[0];
  if (!home || home.hidden) return { gate: 'box', verdict: 'skip', line: `no box of "${spec.key}" at rest`, numbers: {}, flagged: [] };
  const flagged: number[] = [];
  const worst = { d: 0, t: 0 };
  for (let j = rest + 1; j < frames.length; j += 1) {
    const b = boxesAt(rec, spec.key, frames.t(j))[0];
    if (!b || b.hidden) continue;
    const d = Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y), Math.abs(b.w - home.w), Math.abs(b.h - home.h));
    if (d > tol) flagged.push(j);
    if (d > worst.d) Object.assign(worst, { d, t: frames.t(j) - rec.input });
  }
  return {
    gate: 'box',
    verdict: flagged.length > 0 ? 'fail' : 'pass',
    line: `worst +${ms(worst.t)}: ${f2(worst.d)} px from the box at rest (limit ${tol}); ${flagged.length} frames over`,
    numbers: { worstPx: +f2(worst.d), worstAtMs: Math.round(worst.t), framesOver: flagged.length },
    flagged,
  };
}

export type TogetherSpec = { key: string; surface?: string };

/** Pixels of a rounded box that lie within `width` of its edge, as indices into the image data: the rim and the body's edge, where a label is not. */
function ringPixels(b: Box, image: Image, width: number): number[] {
  const out: number[] = [];
  const hx = b.w / 2;
  const hy = b.h / 2;
  const r = Math.min(b.r, hx, hy);
  const { x0, y0, x1, y1 } = clip(b, image);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const qx = Math.abs(x + 0.5 - (b.x + hx)) - (hx - r);
      const qy = Math.abs(y + 0.5 - (b.y + hy)) - (hy - r);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      if (d < 0 && d >= -width) out.push((y * image.width + x) * 4);
    }
  }
  return out;
}

const RING_PX = 3;

/** A label is never drawn without its body: where the trigger shows at least a fifth of its ink at rest, the rim of its box (the 90th percentile of the pixels along its edge) differs from the page behind it by at least `bodyKept` of what it does at rest. */
export function together(frames: Frames, spec: TogetherSpec): GateResult {
  const rec = frames.rec;
  const backdrop = rec.backdrops[0];
  const rest = frames.before(rec.input);
  const home = boxesAt(rec, spec.key, frames.t(rest))[0];
  if (!backdrop || !home || home.hidden) return { gate: 'together', verdict: 'skip', line: 'no backdrop reference, or no box at rest', numbers: {}, flagged: [] };
  const reference = decodePng(backdrop.png);
  const bodyOf = (image: Image, b: Box): number => {
    const px = ringPixels(b, image, RING_PX);
    if (px.length === 0) return 0;
    const d = px.map((i) => deltaE(image, i, reference, i)).sort((x, y) => x - y);
    return d[Math.floor(d.length * 0.9)]!;
  };
  const inkRest = ink(frames.at(rest), home);
  const bodyRest = bodyOf(frames.at(rest), home);
  if (inkRest === 0 || bodyRest < 1) return { gate: 'together', verdict: 'skip', line: 'the trigger has no ink or no body at rest', numbers: {}, flagged: [] };
  const flagged: number[] = [];
  const series: NonNullable<GateResult['series']> = [];
  const worst = { body: Infinity, t: 0 };
  let checked = 0;
  for (let j = rest + 1; j < frames.length; j += 1) {
    const b = boxesAt(rec, spec.key, frames.t(j))[0];
    if (!b || b.hidden || !away(rec, spec.surface, b, frames.t(j), 4)) continue;
    // The drop tightens inside the trigger's box for the first moments of a motion, and its body is then not on the box's edge.
    if (rec.motion.some((m) => frames.t(j) >= m.start && frames.t(j) < m.start + LIMITS.contractionMs)) continue;
    const image = frames.at(j);
    if (ink(image, b) / inkRest < 0.2) continue;
    checked += 1;
    const body = bodyOf(image, b) / bodyRest;
    series.push({ index: j, t: frames.t(j) - rec.input, value: body });
    if (body < LIMITS.bodyKept) flagged.push(j);
    if (body < worst.body) Object.assign(worst, { body, t: frames.t(j) - rec.input });
  }
  if (checked === 0) return { gate: 'together', verdict: 'skip', line: 'the label was never drawn after the input', numbers: {}, flagged: [] };
  return {
    gate: 'together',
    verdict: flagged.length > 0 ? 'fail' : 'pass',
    line: `${checked} frames with the label drawn; the least body at +${ms(worst.t)}: ${Math.round(worst.body * 100)}% of the edge's difference from the page at rest; ${flagged.length} frames under ${LIMITS.bodyKept * 100}%`,
    numbers: { frames: checked, leastBodyPct: Math.round(worst.body * 100), leastAtMs: Math.round(worst.t), framesWithout: flagged.length },
    flagged,
    series,
  };
}

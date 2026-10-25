import { clip, deltaE, labOf, pad, regionChange, union, type Rect } from './color';
import { sampleAt, type Box, type Recording } from './capture';
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
  /** Vanish: the ink of an item may fall to this fraction of its ink at rest. */
  inkKept: 0.5,
  /** Shape: a pixel outside the radius differing from the backdrop by more than this counts as drawn. */
  cornerDrawn: 6,
  /** Shape: the share of the pixels outside the radius that may be drawn. */
  cornerShare: 0.15,
  /** Ghost: the share of a part's pixels that may differ from the settled target while the surface is the size of it. */
  ghostShare: 0.05,
  /** State: the mean ΔE of the element's region between rest and the state that must be seen. */
  stateMean: 2.3,
} as const;

export type Verdict = 'pass' | 'fail' | 'skip';
export type GateName = 'seam' | 'vanish' | 'shape' | 'state' | 'ghost';
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

/**
 * From the frame that presents a motion's last tick, nothing inside the element's region may change from the frame before
 * (through 1.5 s after it, or until the next motion starts): the motion ends on the picture it settles to. Reports the worst frame-to-frame step and the total drift.
 */
export function seam(frames: Frames, spec: SeamSpec): GateResult {
  const rec = frames.rec;
  const quiet = 1500;
  const worst = { t: 0, mean: 0, share: 0 };
  const flagged: number[] = [];
  const series: NonNullable<GateResult['series']> = [];
  let drift = 0;
  let driftAt = 0;
  let evaluated = 0;
  let pairs = 0;
  let firstLate = '';
  rec.motion.forEach((segment, k) => {
    const next = rec.motion[k + 1]?.start ?? Infinity;
    const until = Math.min(segment.end + quiet, next);
    if (until - segment.end < 300) return;
    const boxes = spec.keys.flatMap((key) => [...visible(boxesAt(rec, key, segment.end)), ...visible(boxesAt(rec, key, segment.start))]);
    const region = union(boxes);
    if (!region) return;
    const area = pad(region, spec.pad ?? 20);
    const first = frames.from(segment.end);
    evaluated += 1;
    const settled = first;
    let last = settled;
    for (let j = Math.max(first, 1); j < frames.length && frames.t(j) <= until; j += 1) {
      pairs += 1;
      const c = regionChange(frames.at(j - 1), frames.at(j), area, LIMITS.changed);
      const after = frames.t(j) - segment.end;
      series.push({ index: j, t: after, value: c.mean });
      if (c.share > LIMITS.seamShare || c.mean > LIMITS.seamMean) {
        flagged.push(j);
        if (!firstLate) firstLate = `first step at +${ms(after)}`;
      }
      if (c.share > worst.share || (c.share === worst.share && c.mean > worst.mean)) Object.assign(worst, { t: after, mean: c.mean, share: c.share });
      last = j;
    }
    if (last > settled) {
      const d = regionChange(frames.at(settled), frames.at(last), area, LIMITS.changed);
      if (d.share >= drift) {
        drift = d.share;
        driftAt = frames.t(last) - segment.end;
      }
    }
  });
  if (evaluated === 0) return { gate: 'seam', verdict: 'skip', line: 'no motion with a region to watch', numbers: {}, flagged: [] };
  const bad = flagged.length > 0 || drift > LIMITS.seamDrift;
  return {
    gate: 'seam',
    verdict: bad ? 'fail' : 'pass',
    line: `${pairs} steps after ${evaluated} motion(s); worst +${ms(worst.t)}: mean ΔE ${f3(worst.mean)}, ${f3(worst.share * 100)}% changed; drift ${f3(drift * 100)}%${firstLate ? `; ${firstLate}` : ''}`,
    numbers: { motions: evaluated, steps: pairs, worstAtMs: Math.round(worst.t), worstMeanDE: +f3(worst.mean), worstSharePct: +f3(worst.share * 100), flaggedSteps: flagged.length, driftPct: +f3(drift * 100), driftAtMs: Math.round(driftAt) },
    flagged,
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

export type ShapeSpec = {
  keys: string[];
  /** `capsule` (the default) expects the radius to be half the short side whatever the element declares; `declared` takes what it declares. */
  expect?: 'capsule' | 'declared';
  /** What the corners are compared with: the page behind the kit (the default), or the frame before the input, for an element that sits on glass of its own. */
  ref?: 'backdrop' | 'rest';
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
  if (spec.ref !== 'rest' && !rec.backdrop) return { gate: 'shape', verdict: 'skip', line: 'no backdrop reference', numbers: {}, flagged: [] };
  const rest = frames.before(rec.input);
  const reference = spec.ref === 'rest' ? frames.at(rest) : decodePng(rec.backdrop!);
  const radiusOf = (b: Box): number => (spec.expect === 'declared' ? b.r : Math.min(b.w, b.h) / 2);
  const flagged: number[] = [];
  const series: NonNullable<GateResult['series']> = [];
  let worst = { share: 0, t: 0, r: 0 };
  let checked = 0;
  for (let j = spec.ref === 'rest' ? rest + 1 : 0; j < frames.length; j += 1) {
    if (rec.motion.some((m) => frames.t(j) >= m.start && frames.t(j) < m.end)) continue;
    const img = frames.at(j);
    const boxes = spec.keys.flatMap((key) => boxesAt(rec, key, frames.t(j))).filter((b) => !b.hidden).map((b) => ({ ...b, r: radiusOf(b) })).filter((b) => b.r >= 6);
    if (boxes.length === 0) continue;
    let drawn = 0;
    let total = 0;
    for (const box of boxes) {
      for (const i of cornerPixels(box, img, Math.min(6, box.r * 0.2))) {
        total += 1;
        if (deltaE(img, i, reference, i) > LIMITS.cornerDrawn) drawn += 1;
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

/** The state is seen: the element's region at the mark differs from its region at rest by more than a just noticeable ΔE. */
export function state(frames: Frames, spec: StateSpec): GateResult {
  const rec = frames.rec;
  const rest = frames.before(rec.input);
  const mark = rec.marks[spec.at];
  if (mark === undefined) return { gate: 'state', verdict: 'skip', line: `no mark "${spec.at}"`, numbers: {}, flagged: [] };
  const target = frames.before(mark);
  const box = boxesAt(rec, spec.key, frames.t(rest))[spec.index ?? 0];
  if (!box || box.hidden) return { gate: 'state', verdict: 'skip', line: `no box of "${spec.key}"`, numbers: {}, flagged: [] };
  const c = regionChange(frames.at(rest), frames.at(target), box, LIMITS.changed);
  return {
    gate: 'state',
    verdict: c.mean >= LIMITS.stateMean ? 'pass' : 'fail',
    line: `${spec.at}: mean ΔE ${f2(c.mean)} over ${Math.round(box.w)}×${Math.round(box.h)} px (needs ${LIMITS.stateMean}), ${f2(c.share * 100)}% of pixels over ΔE ${LIMITS.changed}, peak ${f2(c.max)}`,
    numbers: { meanDE: +f2(c.mean), sharePct: +f2(c.share * 100), peakDE: +f2(c.max) },
    flagged: [target],
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

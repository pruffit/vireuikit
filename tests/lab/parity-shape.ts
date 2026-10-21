// What the overlap, lightness and edge energy of the parity gate cannot see: the silhouette's proportions and taper, where the
// light sits in it, how soft its rim is, and the scale and place of the content inside it. Plain RGBA and masks, no browser.
import { bounds, dilate, erode, type Mask, type Rgba } from './parity-measures';

const luma = (img: Rgba, i: number) => (0.2126 * img.data[i * 4]! + 0.7152 * img.data[i * 4 + 1]! + 0.0722 * img.data[i * 4 + 2]!) / 255;

/** Height over width of the silhouette's bounding box. */
export function aspect(m: Mask): number {
  const b = bounds(m);
  return b ? (b.y1 - b.y0 + 1) / (b.x1 - b.x0 + 1) : 0;
}

function rowExtent(m: Mask, y: number): number {
  let lo = m.width;
  let hi = -1;
  for (let x = 0; x < m.width; x += 1) {
    if (!m.on[y * m.width + x]) continue;
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return hi < 0 ? 0 : hi - lo + 1;
}

/** Width at a quarter of the silhouette's height against width at three quarters (each over a band of a tenth): under 1 is narrower at the top, a pear; over 1 is wider, a bowl. */
export function taper(m: Mask): number {
  const b = bounds(m);
  if (!b) return 1;
  const h = b.y1 - b.y0 + 1;
  const band = (centre: number) => {
    const rows: number[] = [];
    for (let y = Math.round(b.y0 + h * (centre - 0.05)); y <= Math.round(b.y0 + h * (centre + 0.05)); y += 1) rows.push(rowExtent(m, y));
    return rows.reduce((a, c) => a + c, 0) / rows.length;
  };
  const low = band(0.75);
  return low > 0 ? band(0.25) / low : 1;
}

/** Mean lightness of the silhouette's top half minus its bottom half: positive when it is lit from above, negative from below. */
export function verticalLight(img: Rgba, m: Mask): number {
  const b = bounds(m);
  if (!b) return 0;
  const mid = (b.y0 + b.y1) / 2;
  let top = 0;
  let bottom = 0;
  let nt = 0;
  let nb = 0;
  for (let i = 0; i < m.on.length; i += 1) {
    if (!m.on[i]) continue;
    if (Math.floor(i / m.width) < mid) {
      top += luma(img, i);
      nt += 1;
    } else {
      bottom += luma(img, i);
      nb += 1;
    }
  }
  return nt && nb ? top / nt - bottom / nb : 0;
}

const RIM_REACH = 6;

/** How many pixels it takes the lightness to go between what lies outside the silhouette and what lies inside it at its steepest rate,
 *  read on rings of one pixel around the boundary; null where the two are too alike to have a rim. */
export function rimSoftness(img: Rgba, m: Mask): number | null {
  const ring = (a: Mask, b: Mask) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < m.on.length; i += 1) {
      if (a.on[i] && !b.on[i]) {
        sum += luma(img, i);
        n += 1;
      }
    }
    return n ? sum / n : null;
  };
  const outside: (number | null)[] = [];
  const inside: (number | null)[] = [];
  let grown = m;
  let shrunk = m;
  for (let d = 1; d <= RIM_REACH; d += 1) {
    const nextGrown = dilate(grown, 1);
    const nextShrunk = erode(shrunk, 1);
    outside.push(ring(nextGrown, grown));
    inside.push(ring(shrunk, nextShrunk));
    grown = nextGrown;
    shrunk = nextShrunk;
  }
  const mean = (v: (number | null)[]) => {
    const got = v.filter((x): x is number => x !== null);
    return got.length ? got.reduce((a, c) => a + c, 0) / got.length : null;
  };
  const far = mean(outside.slice(-2));
  const deep = mean(inside.slice(-2));
  if (far === null || deep === null || Math.abs(deep - far) < 0.03) return null;
  // Outside to inside along the normal: the contrast over the steepest step, in pixels. A hard edge puts it all in one step.
  const line: number[] = [];
  for (let d = RIM_REACH; d >= 1; d -= 1) if (outside[d - 1] !== null) line.push(outside[d - 1]!);
  for (let d = 1; d <= RIM_REACH; d += 1) if (inside[d - 1] !== null) line.push(inside[d - 1]!);
  let steepest = 0;
  for (let i = 1; i < line.length; i += 1) steepest = Math.max(steepest, Math.abs(line[i]! - line[i - 1]!));
  return steepest > 0 ? Math.abs(deep - far) / steepest : null;
}

const SMALL = 2;
const LARGE = 12;

/** Box blur of a plane, by integral image. */
function boxBlur(plane: Float32Array, w: number, h: number, r: number): Float32Array {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += plane[y * w + x]!;
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(x - r, 0);
      const y0 = Math.max(y - r, 0);
      const x1 = Math.min(x + r + 1, w);
      const y1 = Math.min(y + r + 1, h);
      const total = sum[y1 * (w + 1) + x1]! - sum[y0 * (w + 1) + x1]! - sum[y1 * (w + 1) + x0]! + sum[y0 * (w + 1) + x0]!;
      out[y * w + x] = total / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** The luma with its slow variation taken off (a backdrop, a body's tint, a defocus's wash): what is left is structure. */
export function structure(img: Rgba): Float32Array {
  const { width: w, height: h } = img;
  const plane = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) plane[i] = luma(img, i);
  const fine = boxBlur(plane, w, h, SMALL);
  const coarse = boxBlur(plane, w, h, LARGE);
  for (let i = 0; i < w * h; i += 1) plane[i] = fine[i]! - coarse[i]!;
  return plane;
}

export type Template = { points: { u: number; v: number; t: number }[] };

const STEP = 3;

function centreOf(m: Mask): { x: number; y: number } | null {
  const b = bounds(m);
  return b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : null;
}

/** The settled menu's content as a template: its structure inside the silhouette pulled in by `inset`, in dp from the silhouette's centre. */
export function contentTemplate(img: Rgba, m: Mask, inset: number): Template | null {
  const c = centreOf(m);
  if (!c) return null;
  const plane = structure(img);
  const inner = erode(m, inset);
  const points: Template['points'] = [];
  for (let y = 0; y < img.height; y += STEP) {
    for (let x = 0; x < img.width; x += STEP) if (inner.on[y * img.width + x]) points.push({ u: x - c.x, v: y - c.y, t: plane[y * img.width + x]! });
  }
  return points.length ? { points } : null;
}

export type ContentFit = { scale: number; shift: number; score: number };

const SCALES = Array.from({ length: 11 }, (_, i) => 0.9 + i * 0.1);
const SHIFTS_Y = Array.from({ length: 61 }, (_, i) => -130 + i * 3);
const SHIFTS_X = [-9, 0, 9];
/** A fit with less of the template on the frame than this, or a worse correlation, is not a match. */
const MIN_OVERLAP = 0.3;
const MIN_SCORE = 0.25;

/**
 * Where the settled content is on this frame: the scale and the vertical shift (the content's centre against the body's centre; 0 at rest,
 * negative when it sits high) of the template that correlate best with the frame's structure inside its silhouette. The rows differ in their
 * words and icons, so a row's worth of shift does not fit; null where nothing correlates.
 */
export function matchContent(img: Rgba, m: Mask, template: Template, inset: number): ContentFit | null {
  const c = centreOf(m);
  if (!c) return null;
  const { width: w, height: h } = img;
  const plane = structure(img);
  const inner = erode(m, inset);
  const n = template.points.length;
  const score = (scale: number, dy: number, dx: number): number => {
    let count = 0;
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    for (const p of template.points) {
      const x = Math.round(c.x + dx + scale * p.u);
      const y = Math.round(c.y + dy + scale * p.v);
      if (x < 0 || y < 0 || x >= w || y >= h || !inner.on[y * w + x]) continue;
      const b = plane[y * w + x]!;
      count += 1;
      sa += p.t;
      sb += b;
      saa += p.t * p.t;
      sbb += b * b;
      sab += p.t * b;
    }
    if (count < MIN_OVERLAP * n) return -1;
    const va = saa - (sa * sa) / count;
    const vb = sbb - (sb * sb) / count;
    return va > 0 && vb > 0 ? (sab - (sa * sb) / count) / Math.sqrt(va * vb) : -1;
  };
  let best = { score: -1, scale: 1, dy: 0, dx: 0 };
  for (const scale of SCALES) for (const dy of SHIFTS_Y) for (const dx of SHIFTS_X) {
    const got = score(scale, dy, dx);
    if (got > best.score) best = { score: got, scale, dy, dx };
  }
  const coarse = best;
  for (const scale of [coarse.scale - 0.05, coarse.scale, coarse.scale + 0.05]) for (let dy = coarse.dy - 2; dy <= coarse.dy + 2; dy += 1) for (const dx of [coarse.dx - 4, coarse.dx, coarse.dx + 4]) {
    const got = score(scale, dy, dx);
    if (got > best.score) best = { score: got, scale, dy, dx };
  }
  return best.score >= MIN_SCORE ? { scale: best.scale, shift: best.dy, score: best.score } : null;
}

export type Look = {
  aspect: number;
  taper: number;
  vertical: number;
  rim: number | null;
  content: ContentFit | null;
};

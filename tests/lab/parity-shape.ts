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

/** How many pixels the lightness takes to go from 10 % to 90 % of its way between what lies outside the silhouette and what lies inside it,
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
  // Position along the normal: outside d is -d, inside d is +d; walk from outside to inside.
  const line: { at: number; v: number }[] = [];
  for (let d = RIM_REACH; d >= 1; d -= 1) if (outside[d - 1] !== null) line.push({ at: -d, v: (outside[d - 1]! - far) / (deep - far) });
  for (let d = 1; d <= RIM_REACH; d += 1) if (inside[d - 1] !== null) line.push({ at: d, v: (inside[d - 1]! - far) / (deep - far) });
  const cross = (level: number) => {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1]!;
      const b = line[i]!;
      if ((a.v - level) * (b.v - level) <= 0 && a.v !== b.v) return a.at + ((level - a.v) / (b.v - a.v)) * (b.at - a.at);
    }
    return null;
  };
  const lo = cross(0.1);
  const hi = cross(0.9);
  return lo === null || hi === null ? null : Math.abs(hi - lo);
}

const BAND = 3;

/** The rows' edge energy: for every row, the mean distance of the luma from its 7 x 7 average over the silhouette pulled in by `inset`. */
export function rowProfile(img: Rgba, m: Mask, inset: number): { top: number; rows: number[] } | null {
  const b = bounds(m);
  if (!b) return null;
  const { width: w, height: h } = img;
  const inner = erode(m, inset);
  const rows: number[] = [];
  for (let y = b.y0; y <= b.y1; y += 1) {
    let sum = 0;
    let n = 0;
    if (y >= BAND && y < h - BAND) {
      for (let x = BAND; x < w - BAND; x += 1) {
        if (!inner.on[y * w + x]) continue;
        let mean = 0;
        for (let dy = -BAND; dy <= BAND; dy += 1) for (let dx = -BAND; dx <= BAND; dx += 1) mean += luma(img, (y + dy) * w + x + dx);
        sum += Math.abs(luma(img, y * w + x) - mean / (2 * BAND + 1) ** 2);
        n += 1;
      }
    }
    rows.push(n ? sum / n : 0);
  }
  return { top: b.y0, rows };
}

export type ContentFit = { scale: number; shift: number };

// How near the best fit another has to be to count as the same one shifted by a row.
const ALIAS = 0.93;
const SCALES = Array.from({ length: 41 }, (_, i) => 0.8 + i * 0.04);

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i += 1) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * Where the content is, against where it rests: the scale and the shift of the settled menu's row profile that best matches this
 * one, the shift being the content's centre against the body's centre (0 at rest, negative when the content sits high).
 * Null where the content is not told from its surround.
 */
export function contentFit(now: { top: number; rows: number[] }, settled: { top: number; rows: number[] }): ContentFit | null {
  const height = now.rows.length;
  const rest = settled.rows;
  if (Math.max(...now.rows) < 1e-4) return null;
  const fits: { score: number; scale: number; shift: number }[] = [];
  for (const scale of SCALES) {
    for (let dy = -height; dy <= height; dy += 1) {
      const predicted = new Array<number>(height).fill(0);
      let overlap = 0;
      for (let u = 0; u < height; u += 1) {
        const v = Math.round((u - dy) / scale);
        if (v >= 0 && v < rest.length) {
          predicted[u] = rest[v]!;
          overlap += 1;
        }
      }
      if (overlap < height / 4) continue;
      fits.push({ score: pearson(now.rows, predicted), scale, shift: dy + (scale * rest.length) / 2 - height / 2 });
    }
  }
  const top = Math.max(...fits.map((f) => f.score));
  // Rows repeat, so a shift of a whole row or two fits about as well: of the fits that are nearly the best, the one nearest to rest.
  const near = fits.filter((f) => f.score >= top * ALIAS && f.score > 0.3).sort((p, q) => Math.abs(p.shift) - Math.abs(q.shift))[0];
  return near ? { scale: near.scale, shift: near.shift } : null;
}

export type Look = {
  aspect: number;
  taper: number;
  vertical: number;
  rim: number | null;
  content: ContentFit | null;
};

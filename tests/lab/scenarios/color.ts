import type { Image } from './png';

const LINEAR = new Float64Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export type Lab = [number, number, number];

export function labOf(r: number, g: number, b: number): Lab {
  const lr = LINEAR[r]!;
  const lg = LINEAR[g]!;
  const lb = LINEAR[b]!;
  const fx = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047);
  const fy = f(0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb);
  const fz = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference between two pixels of two images, in Lab units: about 2.3 is a just noticeable difference. */
export function deltaE(a: Image, ai: number, b: Image, bi: number): number {
  const A = a.data;
  const B = b.data;
  if (A[ai] === B[bi] && A[ai + 1] === B[bi + 1] && A[ai + 2] === B[bi + 2]) return 0;
  const [l1, a1, b1] = labOf(A[ai]!, A[ai + 1]!, A[ai + 2]!);
  const [l2, a2, b2] = labOf(B[bi]!, B[bi + 1]!, B[bi + 2]!);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export type Rect = { x: number; y: number; w: number; h: number };

export const union = (rects: Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const pad = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/** The rectangle in whole pixels inside the image. */
export function clip(r: Rect, image: Image): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.max(0, Math.floor(r.x)),
    y0: Math.max(0, Math.floor(r.y)),
    x1: Math.min(image.width, Math.ceil(r.x + r.w)),
    y1: Math.min(image.height, Math.ceil(r.y + r.h)),
  };
}

export type Change = { mean: number; share: number; max: number; pixels: number };

/** How much two frames differ inside `region`: the mean ΔE over it, and the share of its pixels that moved by more than `beyond`. */
export function regionChange(a: Image, b: Image, region: Rect, beyond: number): Change {
  const { x0, y0, x1, y1 } = clip(region, a);
  let sum = 0;
  let over = 0;
  let max = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * a.width + x) * 4;
      const d = deltaE(a, i, b, i);
      sum += d;
      if (d > beyond) over += 1;
      if (d > max) max = d;
      n += 1;
    }
  }
  return { mean: n ? sum / n : 0, share: n ? over / n : 0, max, pixels: n };
}

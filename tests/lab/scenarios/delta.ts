import { clip, deltaE, labOf, type Rect } from './color';
import type { Image } from './png';

export type Delta = {
  /** The mean ΔE over the whole region: a state that changes a thin rim barely moves it. */
  mean: number;
  /** The share of the region's pixels over `beyond`. */
  share: number;
  /** The 95th percentile of the ΔE of the pixels over `beyond` (0 when none): what a thin rim does show. */
  p95: number;
  max: number;
  /** The 95th percentile of the relative change of luminance (the larger of the two taken as the base) of the pixels over `beyond`: a small step on a dark surface is a large one to the eye. */
  weber: number;
  changed: number;
  pixels: number;
  /** The box of the changed pixels, or null when none changed. */
  box: Rect | null;
  /** The share of the pixels in the corners outside the arc of a capsule on that box (radius half its short side) that changed; null when the box is too small to have a corner. */
  corners: number | null;
};

const lum = (l: number): number => (l > 8 ? ((l + 16) / 116) ** 3 : l / 903.3);

export function deltaOf(a: Image, b: Image, region: Rect, beyond: number): Delta {
  const { x0, y0, x1, y1 } = clip(region, a);
  const w = x1 - x0;
  const h = y1 - y0;
  const field = new Float32Array(Math.max(0, w * h));
  const over: number[] = [];
  const rel: number[] = [];
  let sum = 0;
  let max = 0;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * a.width + x) * 4;
      const d = deltaE(a, i, b, i);
      field[(y - y0) * w + (x - x0)] = d;
      sum += d;
      if (d > max) max = d;
      if (d > beyond) {
        over.push(d);
        const ya = lum(labOf(a.data[i]!, a.data[i + 1]!, a.data[i + 2]!)[0]);
        const yb = lum(labOf(b.data[i]!, b.data[i + 1]!, b.data[i + 2]!)[0]);
        rel.push(Math.abs(ya - yb) / (Math.max(ya, yb) + 0.005));
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }
  const n = w * h;
  over.sort((p, q) => p - q);
  const p95 = over.length ? over[Math.min(over.length - 1, Math.floor(over.length * 0.95))]! : 0;
  rel.sort((p, q) => p - q);
  const weber = rel.length ? rel[Math.min(rel.length - 1, Math.floor(rel.length * 0.95))]! : 0;
  const box = over.length ? { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } : null;
  let corners: number | null = null;
  if (box) {
    const r = Math.min(box.w, box.h) / 2;
    if (r >= 6) {
      let outside = 0;
      let drawn = 0;
      for (const [cx, cy, sx, sy] of [[box.x, box.y, 1, 1], [box.x + box.w, box.y, -1, 1], [box.x, box.y + box.h, 1, -1], [box.x + box.w, box.y + box.h, -1, -1]] as const) {
        const ax = cx + sx * r;
        const ay = cy + sy * r;
        for (let dy = 0; dy < r; dy += 1) {
          for (let dx = 0; dx < r; dx += 1) {
            const px = cx + sx * (dx + 0.5);
            const py = cy + sy * (dy + 0.5);
            if (Math.hypot(px - ax, py - ay) < r + 1.5) continue;
            const fx = Math.floor(px) - x0;
            const fy = Math.floor(py) - y0;
            if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
            outside += 1;
            if (field[fy * w + fx]! > beyond) drawn += 1;
          }
        }
      }
      corners = outside ? drawn / outside : null;
    }
  }
  return { mean: n ? sum / n : 0, share: n ? over.length / n : 0, p95, max, weber, changed: over.length, pixels: n, box, corners };
}

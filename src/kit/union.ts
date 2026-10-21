// The outline of two rounded rectangles joined by a smooth neck: what one glass body looks like while a drop
// rises out of its source, or merges back into it. Boxes are in dp.
import type { Rect } from './geometry';

export type UnionShape = Rect & { radius: number };
export type OutlinePoint = { x: number; y: number };

function roundedRectDistance(s: UnionShape, x: number, y: number): number {
  const hw = s.width / 2;
  const hh = s.height / 2;
  const r = Math.min(s.radius, hw, hh);
  const qx = Math.abs(x - (s.x + hw)) - (hw - r);
  const qy = Math.abs(y - (s.y + hh)) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** The smooth minimum: the nearer shape, pulled toward the other where they are within `k` of each other. */
function smoothUnion(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

export const unionBounds = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};

const SCAN_STEPS = 40;
const BISECT_STEPS = 10;

/**
 * The boundary of the smooth union along rays from the centre of `a`, which sits inside the body, relative to `origin`.
 * Each ray takes its farthest point inside the body, so shapes with a gap between them are bridged rather than dropped.
 */
export function unionOutline(a: UnionShape, b: UnionShape, smoothing: number, origin: OutlinePoint, count = 128): OutlinePoint[] {
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  const reach = Math.hypot(Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y));
  const inside = (x: number, y: number) => smoothUnion(roundedRectDistance(a, x, y), roundedRectDistance(b, x, y), smoothing) < 0;
  const stride = reach / SCAN_STEPS;
  const points: OutlinePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let last = 0;
    for (let step = 1; step <= SCAN_STEPS; step += 1) if (inside(cx + dx * step * stride, cy + dy * step * stride)) last = step;
    let lo = last * stride;
    let hi = Math.min(lo + stride, reach);
    for (let step = 0; step < BISECT_STEPS; step += 1) {
      const mid = (lo + hi) / 2;
      if (inside(cx + dx * mid, cy + dy * mid)) lo = mid;
      else hi = mid;
    }
    points.push({ x: cx + dx * lo - origin.x, y: cy + dy * lo - origin.y });
  }
  return points;
}

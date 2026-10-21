// The four measures of the menu parity gate, on plain RGBA buffers (no browser needed).
export type Rgba = { width: number; height: number; data: Uint8Array };
export type Mask = { width: number; height: number; on: Uint8Array };

const luma = (img: Rgba, i: number) =>
  (0.2126 * img.data[i * 4]! + 0.7152 * img.data[i * 4 + 1]! + 0.0722 * img.data[i * 4 + 2]!) / 255;

function erode(m: Mask, r: number): Mask {
  const { width: w, height: h } = m;
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let all = 1;
      for (let dy = -r; dy <= r && all; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !m.on[yy * w + xx]) {
            all = 0;
            break;
          }
        }
      }
      on[y * w + x] = all;
    }
  }
  return { width: w, height: h, on };
}

function dilate(m: Mask, r: number): Mask {
  const { width: w, height: h } = m;
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!m.on[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) on[yy * w + xx] = 1;
        }
      }
    }
  }
  return { width: w, height: h, on };
}

function fillHoles(m: Mask): Mask {
  const { width: w, height: h } = m;
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (!m.on[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x += 1) (push(x, 0), push(x, h - 1));
  for (let y = 0; y < h; y += 1) (push(0, y), push(w - 1, y));
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) on[i] = outside[i] ? 0 : 1;
  return { width: w, height: h, on };
}

/** Specks smaller than `min` pixels are dropped: JPEG noise and the shadow's grain are not glass. */
function dropSpecks(m: Mask, min: number): Mask {
  const { width: w, height: h } = m;
  const seen = new Uint8Array(w * h);
  const on = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start += 1) {
    if (!m.on[start] || seen[start]) continue;
    const part: number[] = [start];
    seen[start] = 1;
    for (let k = 0; k < part.length; k += 1) {
      const i = part[k]!;
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (m.on[j] && !seen[j]) {
          seen[j] = 1;
          part.push(j);
        }
      }
    }
    if (part.length >= min) for (const i of part) on[i] = 1;
  }
  return { width: w, height: h, on };
}

/** The glass silhouette: where the picture differs from the rest frame, cleaned and filled. */
export function silhouette(img: Rgba, rest: Rgba, threshold: number): Mask {
  const { width: w, height: h } = img;
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    let d = 0;
    for (let c = 0; c < 3; c += 1) d = Math.max(d, Math.abs(img.data[i * 4 + c]! - rest.data[i * 4 + c]!));
    raw[i] = d > threshold ? 1 : 0;
  }
  const opened = dilate(erode({ width: w, height: h, on: raw }, 1), 1);
  return fillHoles(dropSpecks(opened, 40));
}

export const area = (m: Mask) => m.on.reduce((a, b) => a + b, 0);

export function iou(a: Mask, b: Mask): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.on.length; i += 1) {
    both += a.on[i]! & b.on[i]!;
    either += a.on[i]! | b.on[i]!;
  }
  return either === 0 ? 1 : both / either;
}

/** Mean lightness (Rec. 709 luma of the sRGB values, 0..1) over the mask. */
export function meanLightness(img: Rgba, m: Mask): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < m.on.length; i += 1) {
    if (!m.on[i]) continue;
    sum += luma(img, i);
    n += 1;
  }
  return n ? sum / n : 0;
}

const BAND = 3;

/** Mean distance of the luma from its (2 * BAND + 1) box average, over the mask pulled in by `inset` pixels, clear of the rim:
 *  a ramp, a flat tint and the lens's grain read near zero; edges and fine structure, sharp or blurred, count. */
export function edgeEnergy(img: Rgba, m: Mask, inset: number): number {
  const { width: w, height: h } = img;
  const inner = erode(m, inset);
  let sum = 0;
  let n = 0;
  for (let y = BAND; y < h - BAND; y += 1) {
    for (let x = BAND; x < w - BAND; x += 1) {
      if (!inner.on[y * w + x]) continue;
      let mean = 0;
      for (let dy = -BAND; dy <= BAND; dy += 1) for (let dx = -BAND; dx <= BAND; dx += 1) mean += luma(img, (y + dy) * w + x + dx);
      sum += Math.abs(luma(img, y * w + x) - mean / (2 * BAND + 1) ** 2);
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

export function centroid(m: Mask): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < m.on.length; i += 1) {
    if (!m.on[i]) continue;
    sx += i % m.width;
    sy += Math.floor(i / m.width);
    n += 1;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

export type Point = { x: number; y: number };

export function shiftMask(m: Mask, dx: number, dy: number): Mask {
  const { width: w, height: h } = m;
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) on[y * w + x] = m.on[sy * w + sx]!;
    }
  }
  return { width: w, height: h, on };
}

/** How far `v` is outside [min, max] of `values`; 0 inside. */
export function distanceToRange(v: number, values: readonly number[]): number {
  return Math.max(Math.min(...values) - v, v - Math.max(...values), 0);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0), 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The distance from `p` to the path through `path`; one point is a disc, none is infinitely far. */
export function distanceToPolyline(p: Point, path: readonly Point[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return Math.hypot(p.x - path[0]!.x, p.y - path[0]!.y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i += 1) best = Math.min(best, distanceToSegment(p, path[i - 1]!, path[i]!));
  return best;
}

export type Measured = { mask: Mask; lightness: number; edge: number; centroid: Point | null };
export type Slack = { iou: number; lightness: number; edge: number; centroid: number };

export type Verdict = {
  /** The best overlap of ours (registered) with any of the reference's frames around the instant. */
  iou: number;
  lightness: number;
  edge: number;
  centroid: number;
  /** Tolerance minus value (the IoU's: value minus floor); negative fails. */
  margin: Slack;
  failed: (keyof Slack)[];
};

/**
 * Ours against the reference's frames at t - 1, t and t + 1 (1/30 s apart): ours may lead or lag by one reference frame, so
 * lightness and relative edge energy must lie within the envelope of the three, the centroid (less `offset`, the layout the kit
 * does not model) on the path through their centroids, and the silhouette (shifted by the same offset) overlap one of them
 * best. `edge` of every measure is already relative to its own settled menu.
 */
export function compareToReference(ours: Measured, around: readonly Measured[], offset: Point, slack: Slack): Verdict {
  const shifted = shiftMask(ours.mask, -Math.round(offset.x), -Math.round(offset.y));
  const best = Math.max(...around.map((r) => iou(shifted, r.mask)));
  const lightness = distanceToRange(ours.lightness, around.map((r) => r.lightness));
  const edge = distanceToRange(ours.edge, around.map((r) => r.edge));
  const path = around.map((r) => r.centroid).filter((c): c is Point => c !== null);
  const centroid = ours.centroid ? distanceToPolyline({ x: ours.centroid.x - offset.x, y: ours.centroid.y - offset.y }, path) : Number.POSITIVE_INFINITY;
  const margin = { iou: best - slack.iou, lightness: slack.lightness - lightness, edge: slack.edge - edge, centroid: slack.centroid - centroid };
  const failed = (Object.keys(margin) as (keyof Slack)[]).filter((k) => !(margin[k] >= 0));
  return { iou: best, lightness, edge, centroid, margin, failed };
}

export function bounds(m: Mask): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = m.width;
  let y0 = m.height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < m.on.length; i += 1) {
    if (!m.on[i]) continue;
    const x = i % m.width;
    const y = Math.floor(i / m.width);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

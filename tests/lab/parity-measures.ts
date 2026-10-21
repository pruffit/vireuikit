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

import type { BackdropSample } from 'vireglass';
import type { ReferenceControl } from './reference-controls';

export const REFERENCE_STAGE = { width: 180, height: 120 } as const;

const SCHEME_CSS = `[data-backdrop='ref-light'] { color-scheme: light; color: #1b1c20; } [data-backdrop='ref-dark'] { color-scheme: dark; color: #f1f1f4; }`;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`reference frame did not load: ${src}`));
    img.src = src;
  });

/** Halves until the target is within a factor of two, so a 4K frame does not alias when it is shrunk. */
function shrink(img: HTMLImageElement, width: number): HTMLCanvasElement {
  let source: CanvasImageSource = img;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  do {
    const next = document.createElement('canvas');
    if (w / 2 > width) {
      w = Math.ceil(w / 2);
      h = Math.ceil(h / 2);
    }
    next.width = w;
    next.height = h;
    const c = next.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(source, 0, 0, w, h);
    source = next;
  } while (w / 2 > width);
  return source as HTMLCanvasElement;
}

/** Fills the control's footprint from its surround; returns the sample under it, since the glass probe reads styles, not pixels. */
export async function paintReferenceStage(
  stage: HTMLElement,
  control: ReferenceControl,
  heightPx: number,
  src: string,
): Promise<BackdropSample> {
  const { width: W, height: H } = REFERENCE_STAGE;
  const style = document.createElement('style');
  style.textContent = SCHEME_CSS;
  document.head.appendChild(style);
  const img = await loadImage(src);
  const R = Math.min(control.hw, control.hh);
  const k = heightPx / (2 * R);
  const sw = W / k;
  const sh = H / k;
  // Slid to stay inside the frame; a frame smaller than the window stays centred and the rest is filled in.
  const origin = (at: number, window: number, size: number) =>
    size >= window ? Math.min(Math.max(at - window / 2, 0), size - window) : at - window / 2;
  const sx = origin(control.cx, sw, img.naturalWidth);
  const sy = origin(control.cy, sh, img.naturalHeight);
  const full = shrink(img, Math.round(img.naturalWidth * k * 2));
  const fk = full.width / img.naturalWidth;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  const x0 = Math.max(sx, 0);
  const y0 = Math.max(sy, 0);
  const x1 = Math.min(sx + sw, img.naturalWidth);
  const y1 = Math.min(sy + sh, img.naturalHeight);
  g.drawImage(full, x0 * fk, y0 * fk, (x1 - x0) * fk, (y1 - y0) * fk, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);

  const px = g.getImageData(0, 0, W, H);
  const cx = (control.cx - sx) * k;
  const cy = (control.cy - sy) * k;
  const hw = control.hw * k;
  const hh = control.hh * k;
  const r = R * k;
  const FOOTPRINT = 1;
  const OUTSIDE_FRAME = 2;
  const masked = new Uint8Array(W * H);
  const MARGIN = 0.18;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const qx = Math.abs(dx) - (hw - r);
      const qy = Math.abs(dy) - (hh - r);
      const d = control.ellipse
        ? (Math.hypot(dx / hw, dy / hh) - 1) * r
        : Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const inFrame = x + 0.5 >= (x0 - sx) * k && x + 0.5 <= (x1 - sx) * k && y + 0.5 >= (y0 - sy) * k && y + 0.5 <= (y1 - sy) * k;
      if (d < MARGIN * r) masked[y * W + x] = FOOTPRINT;
      else if (!inFrame) masked[y * W + x] = OUTSIDE_FRAME;
    }
  }
  const data = px.data;
  const field = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i += 1) {
    for (let c = 0; c < 3; c += 1) field[i * 3 + c] = masked[i] ? 128 : data[i * 4 + c]!;
  }
  const at = (x: number, y: number, c: number) =>
    field[(Math.min(Math.max(y, 0), H - 1) * W + Math.min(Math.max(x, 0), W - 1)) * 3 + c]!;
  for (let pass = 0; pass < 900; pass += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        if (!masked[i]) continue;
        for (let c = 0; c < 3; c += 1) {
          field[i * 3 + c] = (at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c)) / 4;
        }
      }
    }
  }
  const under: { r: number; g: number; b: number }[] = [];
  for (let i = 0; i < W * H; i += 1) {
    if (!masked[i]) continue;
    for (let c = 0; c < 3; c += 1) data[i * 4 + c] = field[i * 3 + c]!;
    if (masked[i] === FOOTPRINT) under.push({ r: data[i * 4]!, g: data[i * 4 + 1]!, b: data[i * 4 + 2]! });
  }
  g.putImageData(px, 0, 0);
  const layer = document.createElement('div');
  layer.style.cssText = `position:absolute;inset:0;z-index:-1;background:url(${canvas.toDataURL('image/png')}) 0 0/100% 100%`;
  stage.prepend(layer);
  const { statsFromSamples } = await import('vireglass/dom');
  const sample = statsFromSamples(under);
  stage.setAttribute('data-backdrop', sample.luma > 0.5 ? 'ref-light' : 'ref-dark');
  return sample;
}

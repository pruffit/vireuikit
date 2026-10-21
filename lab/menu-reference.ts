// Our menu next to the reference menu growing out of its toolbar (M 5:11), frame by frame. The frames
// are third-party material served from VIREUIKIT_REFERENCE_DIR; nothing of them is committed.
import type { VireMenuElement } from 'vireuikit/web';
import { createGrowthState, growthPhase, stepGrowth, type GrowthPhase } from '../src/kit/morph';
import { GLYPHS, makeMenu } from './menu';

const PX_PER_DP = 6.41;
const CROP = { x: 800, y: 380, width: 1300, height: 1420 };
const TOOLBAR = { x: 938, y: 1411, width: 1102, height: 282 };
const REST_FRAME = 311.478;
// Halfway between the last unchanged frame and the first changed one.
const OPENS = 311.561;
const CLOSES = 313.43;
export const MENU_REFERENCE_FRAMES = [311.612, 311.678, 311.745, 311.812, 311.879, 311.945, 312.413, 313.514, 313.614, 313.714];

const frameFile = (t: number) => `/__reference/file?path=${encodeURIComponent(`m511/m${t.toFixed(3)}.jpg`)}`;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`reference frame did not load: ${src}`));
    img.src = src;
  });

const W = Math.round(CROP.width / PX_PER_DP);
const H = Math.round(CROP.height / PX_PER_DP);

function crop(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, CROP.x, CROP.y, CROP.width, CROP.height, 0, 0, W, H);
  return canvas;
}

/** The rest frame with the toolbar filled in from its surround: the backdrop our menu grows over. */
function withoutToolbar(canvas: HTMLCanvasElement): { url: string; rgba: string; pixels: { r: number; g: number; b: number }[] } {
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const px = g.getImageData(0, 0, W, H);
  const hw = TOOLBAR.width / PX_PER_DP / 2;
  const hh = TOOLBAR.height / PX_PER_DP / 2;
  const cx = (TOOLBAR.x - CROP.x) / PX_PER_DP + hw;
  const cy = (TOOLBAR.y - CROP.y) / PX_PER_DP + hh;
  const masked = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const qx = Math.max(Math.abs(x + 0.5 - cx) - (hw - hh), 0);
      if (Math.hypot(qx, y + 0.5 - cy) < hh + 3) masked[y * W + x] = 1;
    }
  }
  const field = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i += 1) for (let c = 0; c < 3; c += 1) field[i * 3 + c] = px.data[i * 4 + c]!;
  const at = (x: number, y: number, c: number) => field[(Math.min(Math.max(y, 0), H - 1) * W + Math.min(Math.max(x, 0), W - 1)) * 3 + c]!;
  for (let pass = 0; pass < 600; pass += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (!masked[y * W + x]) continue;
        for (let c = 0; c < 3; c += 1) field[(y * W + x) * 3 + c] = (at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c)) / 4;
      }
    }
  }
  const pixels: { r: number; g: number; b: number }[] = [];
  for (let i = 0; i < W * H; i += 1) {
    for (let c = 0; c < 3; c += 1) px.data[i * 4 + c] = field[i * 3 + c]!;
    pixels.push({ r: px.data[i * 4]!, g: px.data[i * 4 + 1]!, b: px.data[i * 4 + 2]! });
  }
  g.putImageData(px, 0, 0);
  return { url: canvas.toDataURL('image/png'), rgba: base64(px.data), pixels };
}

function phaseAt(t: number): GrowthPhase {
  const closing = t > CLOSES - 0.05;
  const state = createGrowthState();
  const dt = 1 / 240;
  if (closing) for (let i = 0; i < 480; i += 1) stepGrowth(state, dt, true);
  const since = closing ? t - CLOSES : t - OPENS;
  for (let s = 0; s < since; s += dt) stepGrowth(state, dt, !closing);
  return growthPhase(state);
}

const base64 = (bytes: Uint8ClampedArray) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};

declare global {
  interface Window {
    __menuReference?: {
      width: number;
      height: number;
      opens: number;
      closes: number;
      frames: readonly number[];
      /** RGBA of a reference frame's crop, base64: the parity gate reads the neighbours of each instant from here. */
      frame(t: number): Promise<string>;
      rest(): string;
    };
  }
}

export async function menuReference(stage: HTMLElement, rows: HTMLElement): Promise<void> {
  stage.style.width = `${MENU_REFERENCE_FRAMES.length * (W + 12) + 24}px`;
  rows.style.cssText = `display:grid;grid-template-columns:repeat(${MENU_REFERENCE_FRAMES.length},${W}px);gap:8px 12px;padding:12px;font:12px system-ui`;
  stage.setAttribute('data-backdrop', 'ref-light');
  const rest = withoutToolbar(crop(await loadImage(frameFile(REST_FRAME))));
  const { statsFromSamples } = await import('vireglass/dom');
  const sample = statsFromSamples(rest.pixels.filter((_, i) => i % 7 === 0));
  window.__menuReference = {
    width: W,
    height: H,
    opens: OPENS,
    closes: CLOSES,
    frames: MENU_REFERENCE_FRAMES,
    frame: async (t) => base64(crop(await loadImage(frameFile(t))).getContext('2d')!.getImageData(0, 0, W, H).data),
    rest: () => rest.rgba,
  };
  const frames = await Promise.all(MENU_REFERENCE_FRAMES.map((t) => loadImage(frameFile(t))));
  frames.forEach((img, i) => {
    const t = MENU_REFERENCE_FRAMES[i]!;
    const label = document.createElement('div');
    label.textContent = t < CLOSES ? `open +${(t - OPENS).toFixed(3)} s` : `close +${(t - CLOSES).toFixed(3)} s`;
    label.style.gridRow = '1';
    const ref = crop(img);
    ref.dataset.tile = `ref-${i}`;
    ref.style.cssText = `grid-row:2;width:${W}px;height:${H}px`;
    const ours = document.createElement('div');
    ours.dataset.tile = `ours-${i}`;
    ours.style.cssText = `grid-row:3;position:relative;width:${W}px;height:${H}px;background:url(${rest.url}) 0 0/100% 100%;color:#1b1c20;color-scheme:light;font-size:17px`;
    const phase = phaseAt(t);
    const menu = makeMenu({
      id: `ref-${i}`,
      size: 'touch',
      glass: '1',
      sample,
      trigger: { kind: 'button', label: '' },
      items: [
        { label: 'One', glyph: 'circle' },
        { label: 'Two', glyph: 'triangle' },
        { label: 'Three', glyph: 'square' },
        { label: 'Four', glyph: 'hexagon' },
      ],
      force: `${Math.max(phase.shrink, 0).toFixed(3)} ${Math.max(phase.grow, 0).toFixed(3)}`,
      corner: 'bottom-left',
    });
    menu.style.cssText = `position:absolute;left:${((TOOLBAR.x - CROP.x) / PX_PER_DP).toFixed(1)}px;top:${((TOOLBAR.y - CROP.y) / PX_PER_DP).toFixed(1)}px`;
    const trigger = menu.querySelector<HTMLButtonElement>('vire-button > button')!;
    trigger.setAttribute('aria-label', 'Toolbar');
    trigger.innerHTML = [GLYPHS.triangle, GLYPHS.circle, GLYPHS.square, GLYPHS.hexagon].join('');
    trigger.style.width = `${(TOOLBAR.width / PX_PER_DP).toFixed(1)}px`;
    trigger.style.justifyContent = 'space-around';
    (menu as VireMenuElement).sample = sample;
    ours.append(menu);
    rows.append(label, ref, ours);
  });
}

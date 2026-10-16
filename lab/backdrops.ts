// Backdrops are generated, so the repository carries no third-party images.
export const BACKDROPS = ['light', 'dark', 'text', 'busy', 'photo', 'mid'] as const;
export type Backdrop = (typeof BACKDROPS)[number];

const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Deterministic photo-like texture: layered noise mapped through a warm-to-cool palette. */
function noiseImage(width: number, height: number): { url: string; mean: string } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let n = 0;
      let amp = 0.5;
      let freq = 1 / 70;
      for (let o = 0; o < 5; o += 1) {
        n += amp * valueNoise(x * freq + o * 17, y * freq - o * 9);
        amp /= 2;
        freq *= 2;
      }
      const t = Math.min(Math.max(n * 1.25 - 0.1, 0), 1);
      const i = (y * width + x) * 4;
      const pr = 40 + 200 * t;
      const pg = 70 + 130 * Math.sin(t * Math.PI * 0.9);
      const pb = 150 - 90 * t + 30 * hash(x >> 2, y >> 2);
      img.data[i] = pr;
      img.data[i + 1] = pg;
      img.data[i + 2] = pb;
      img.data[i + 3] = 255;
      r += pr;
      g += pg;
      b += pb;
    }
  }
  ctx.putImageData(img, 0, 0);
  const count = width * height;
  return {
    url: canvas.toDataURL('image/png'),
    mean: `rgb(${Math.round(r / count)} ${Math.round(g / count)} ${Math.round(b / count)})`,
  };
}

const WORDS = 'glass lens edge light rim body ink press lift hover focus rest touch surface material depth blur'.split(' ');
const sentence = (seed: number) =>
  Array.from({ length: 11 }, (_, i) => WORDS[Math.floor(hash(seed, i) * WORDS.length)]).join(' ');

function textPage(): string {
  return Array.from({ length: 16 }, (_, i) => `<p>${sentence(i + 1)}. ${sentence(i + 40)}.</p>`).join('');
}

function busyMock(): string {
  const hues = [12, 48, 150, 210, 275, 330];
  const rows = Array.from({ length: 9 }, (_, i) => {
    const h = hues[i % hues.length]!;
    return `<div class="b-row"><i style="background:hsl(${h} 70% 55%)"></i><b>${sentence(i + 5).slice(0, 26)}</b><s style="background:hsl(${h} 60% 80%)"></s><em>${i + 3}</em></div>`;
  }).join('');
  return `<div class="b-head">${sentence(99).slice(0, 22)}</div>${rows}`;
}

const CSS = `
[data-backdrop] { color-scheme: light; color: #1b1c20; }
[data-backdrop='dark'], [data-backdrop='busy-dark'] { color-scheme: dark; color: #f1f1f4; }
[data-backdrop='light'] { background: radial-gradient(circle at 18% 30%, #fbe3b5 0, transparent 46%), radial-gradient(circle at 82% 70%, #b9d4f4 0, transparent 50%), #f2f2f4; }
[data-backdrop='dark'] { background: radial-gradient(circle at 20% 70%, #4a2e63 0, transparent 48%), radial-gradient(circle at 80% 25%, #1f4a5e 0, transparent 52%), #121216; }
[data-backdrop='text'] { background: #fbfbf8; }
[data-backdrop='mid'] { background: #86868c; }
[data-backdrop='photo'] { color-scheme: dark; color: #fff; }
[data-backdrop='busy'] { background: #eceef2; }
.bd-layer { position: absolute; inset: 0; z-index: -1; overflow: clip; }
.bd-text { padding: 0 24px; font: 15px/1.5 Georgia, serif; color: #2a2a2e; }
.bd-text p { margin: 0 0 12px; }
.b-head { height: 44px; padding: 12px 20px; font: 600 16px system-ui; background: #fff; border-bottom: 1px solid #d6d8de; box-sizing: border-box; }
.b-row { display: flex; align-items: center; gap: 12px; padding: 0 20px; height: 54px; border-bottom: 1px solid #dcdee4; background: #fff; font: 14px system-ui; }
.b-row:nth-child(even) { background: #f6f7fa; }
.b-row i { width: 30px; height: 30px; border-radius: 50%; flex: none; }
.b-row b { font-weight: 600; flex: 1; }
.b-row s { width: 90px; height: 10px; border-radius: 5px; text-decoration: none; }
.b-row em { font-style: normal; color: #6a6e78; }
`;

/** Paints the backdrop into `stage` and tags it so the surrounding colours follow it. */
export function paintBackdrop(stage: HTMLElement, kind: Backdrop): void {
  if (!document.getElementById('lab-backdrop-css')) {
    const style = document.createElement('style');
    style.id = 'lab-backdrop-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  stage.setAttribute('data-backdrop', kind);
  stage.querySelector('.bd-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'bd-layer';
  if (kind === 'text') {
    layer.className += ' bd-text';
    layer.innerHTML = textPage();
  } else if (kind === 'busy') {
    layer.innerHTML = busyMock();
  } else if (kind === 'photo') {
    const { url, mean } = noiseImage(380, 260);
    stage.style.backgroundColor = mean;
    layer.style.cssText = `background:url(${url}) center/cover`;
  }
  if (kind !== 'photo') stage.style.backgroundColor = '';
  stage.prepend(layer);
}

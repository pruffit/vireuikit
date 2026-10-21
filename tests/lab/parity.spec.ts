import { expect, test } from '@playwright/test';
import { openCase } from './helpers';
import { centroid, edgeEnergy, iou, meanLightness, silhouette, type Mask, type Rgba } from './parity-measures';

// Needs the uncommitted reference frames: `npm run check:lab:reference` (VIREUIKIT_REFERENCE_DIR).
test.skip(!process.env.VIREUIKIT_REFERENCE_DIR, 'VIREUIKIT_REFERENCE_DIR is not set: the reference frames are local-only');
// A menu is held inside the viewport, so a window narrower than the stage pushes the right-hand tiles to its edge.
test.use({ viewport: { width: 2400, height: 900 } });

const THRESHOLD = 6;
const INSET = 8;
const SETTLED = 6;
const FRAME = 1 / 30;

// What the reference does not fix, taken from the settled instant where nothing moves (docs/acceptance.md, N16):
// the layout of its menu, the resting body, the noise of a JPEG against a PNG.
const SLACK = { iou: 0.15, lightness: 0.06, edge: 0.05, centroid: 4 };

type Measures = { img: Rgba; mask: Mask; lightness: number; edge: number; centroid: { x: number; y: number } | null };

const fromBase64 = (b64: string, width: number, height: number): Rgba => ({ width, height, data: new Uint8Array(Buffer.from(b64, 'base64')) });
const fixed = (v: number, n = 2) => v.toFixed(n).padStart(8);

test('the menu grows and retracts as the reference does', async ({ page }) => {
  test.setTimeout(180_000);
  await openCase(page, 'view=menu-reference&glass=1');
  await page.waitForFunction(() => !!window.__menuReference && document.querySelectorAll('[data-tile^="ours-"] vire-menu').length === window.__menuReference.frames.length);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-tile^="ours-"] vire-menu')].every((m) => m.getAttribute('data-glass') === 'on'));
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const r = window.__menuReference!;
    return { width: r.width, height: r.height, opens: r.opens, closes: r.closes, frames: [...r.frames], rest: r.rest() };
  });
  const { width, height } = info;
  const rest = fromBase64(info.rest, width, height);
  const list = (await (await page.request.get('/__reference/list')).json()) as { files: string[] };
  const times = list.files
    .map((f) => /m511[\/]m(\d+\.\d+)\.jpg$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);

  const measure = (img: Rgba): Measures => {
    const mask = silhouette(img, rest, THRESHOLD);
    return { img, mask, lightness: meanLightness(img, mask), edge: edgeEnergy(img, mask, INSET), centroid: centroid(mask) };
  };
  const refFrame = async (t: number) => fromBase64(await page.evaluate((x) => window.__menuReference!.frame(x), t), width, height);
  // One tile at a time: a menu's shadow reaches into the next tile otherwise.
  const ours = async (i: number): Promise<Rgba> => {
    await page.evaluate((k) => document.querySelectorAll<HTMLElement>('[data-tile^="ours-"]').forEach((el, n) => (el.style.visibility = n === k ? 'visible' : 'hidden')), i);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const png = await page.locator(`[data-tile="ours-${i}"]`).screenshot();
    const b64 = await page.evaluate(
      (url) =>
        new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.onerror = () => reject(new Error('tile did not decode'));
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const g = c.getContext('2d', { willReadFrequently: true })!;
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            let out = '';
            for (let k = 0; k < d.length; k += 0x8000) out += String.fromCharCode(...d.subarray(k, k + 0x8000));
            resolve(btoa(out));
          };
          img.src = url;
        }),
      `data:image/png;base64,${png.toString('base64')}`,
    );
    await page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-tile^="ours-"]').forEach((el) => (el.style.visibility = '')));
    return fromBase64(b64, width, height);
  };

  const refSettled = measure(await refFrame(info.frames[SETTLED]!));
  const ourSettled = measure(await ours(SETTLED));
  const rel = (m: Measures, settled: Measures) => (settled.edge > 0 ? m.edge / settled.edge : 0);
  const dist = (a: Measures, b: Measures) => (a.centroid && b.centroid ? Math.hypot(a.centroid.x - b.centroid.x, a.centroid.y - b.centroid.y) : Number.POSITIVE_INFINITY);

  const lines = [['instant', 'IoU', 'min IoU', 'L ref', 'L ours', 'L tol', 'edge ref', 'edge ours', 'e tol', 'ref x,y', 'ours x,y', 'off', 'off tol', 'result'].map((h) => h.padStart(10)).join('')];
  const failures: string[] = [];
  for (let i = 0; i < info.frames.length; i += 1) {
    const t = info.frames[i]!;
    const r = i === SETTLED ? refSettled : measure(await refFrame(t));
    const o = i === SETTLED ? ourSettled : measure(await ours(i));
    const at = times.indexOf(Number(t.toFixed(3)));
    const near = [times[at - 1], times[at + 1]].filter((n): n is number => n !== undefined && Math.abs(n - t) < FRAME * 1.5);
    const vary = { iou: 1, lightness: 0, edge: 0, centroid: 0 };
    for (const n of near) {
      const m = measure(await refFrame(n));
      vary.iou = Math.min(vary.iou, iou(r.mask, m.mask));
      vary.lightness = Math.max(vary.lightness, Math.abs(m.lightness - r.lightness));
      vary.edge = Math.max(vary.edge, Math.abs(rel(m, refSettled) - rel(r, refSettled)));
      vary.centroid = Math.max(vary.centroid, dist(r, m));
    }
    const need = { iou: vary.iou - SLACK.iou, lightness: vary.lightness + SLACK.lightness, edge: vary.edge + SLACK.edge, centroid: vary.centroid + SLACK.centroid };
    const got = { iou: iou(r.mask, o.mask), lightness: Math.abs(o.lightness - r.lightness), edge: Math.abs(rel(o, ourSettled) - rel(r, refSettled)), centroid: dist(r, o) };
    const bad = [
      got.iou < need.iou && 'IoU',
      got.lightness > need.lightness && 'lightness',
      got.edge > need.edge && 'edge',
      got.centroid > need.centroid && 'centroid',
    ].filter((b): b is string => !!b);
    const label = t < info.closes ? `o+${(t - info.opens).toFixed(3)}` : `c+${(t - info.closes).toFixed(3)}`;
    const at2 = (m: Measures) => (m.centroid ? `${m.centroid.x.toFixed(0)},${m.centroid.y.toFixed(0)}` : '-');
    lines.push(
      [label, fixed(got.iou), fixed(need.iou), fixed(r.lightness, 3), fixed(o.lightness, 3), fixed(need.lightness, 3), fixed(rel(r, refSettled)), fixed(rel(o, ourSettled)), fixed(need.edge), at2(r), at2(o), fixed(got.centroid, 1), fixed(need.centroid, 1), bad.length ? `  FAIL ${bad.join('+')}` : '  ok']
        .map((v, k) => (k === 0 ? v.padEnd(10) : v.padStart(10)))
        .join(''),
    );
    if (bad.length) failures.push(`${label}: ${bad.join(', ')}`);
  }
  console.log(lines.join('\n'));
  expect(failures, 'instants outside the reference tolerances').toEqual([]);
});

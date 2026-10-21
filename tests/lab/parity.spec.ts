import { expect, test, type Page } from '@playwright/test';
import { openCase } from './helpers';
import {
  area,
  bounds,
  centroid,
  compareToReference,
  edgeEnergy,
  iou,
  meanLightness,
  silhouette,
  type LookSlack,
  type Measure,
  type Measured,
  type Point,
  type Rgba,
  type Slack,
  type Verdict,
} from './parity-measures';
import { aspect, contentFit, rimSoftness, rowProfile, taper, verticalLight, type Look } from './parity-shape';

// Needs the uncommitted reference frames: `npm run check:lab:reference` (VIREUIKIT_REFERENCE_DIR).
test.skip(!process.env.VIREUIKIT_REFERENCE_DIR, 'VIREUIKIT_REFERENCE_DIR is not set: the reference frames are local-only');
// A menu is held inside the viewport: the stage is two rows of five tiles, which a window of 1440 by 1100 holds whole.
test.use({ viewport: { width: 1440, height: 1100 } });

const THRESHOLD = 6;
const INSET = 8;
const SETTLED = 6;
const FRAME = 1 / 30;
// Where the reference's menu sits is layout the kit does not model; registration removes it, and a larger offset is a broken layout.
const MAX_OFFSET = 12;
// Derived in docs/acceptance.md (N29), not from what the settled instant happens to read.
const SLACK: Slack & LookSlack = { iou: 0.8, lightness: 0.057, edge: 0.05, centroid: 2.5, aspect: 0.03, taper: 0.04, vertical: 0.04, rim: 1, scale: 0.12, shift: 9 };
// The content is judged while the menu opens and where the reference's shows: its edge energy, relative to its settled menu's, is at least this.
// (On the way in, the toolbar's own glyphs are what is there, and closing defocuses the rows first.)
const CONTENT_SHOWS = 0.1;
// What the kit cannot follow: the instant, the measure and why (listed in docs/acceptance.md).
const KNOWN: { instant: string; measure: Measure; reason: string }[] = [
  { instant: 'o+0.051', measure: 'iou', reason: 'the reference capsule is 14 dp wider (a critically damped spring contracts 0.01 s early) and has a bud; the union draws neither' },
  { instant: 'c+0.084', measure: 'iou', reason: 'the reference drop has a tail toward the capsule; the union outline draws a round body' },
];
// A reference frame fed in 0.1 s late or early is told from a match at 9 of the 9 moving instants; the gate holds 8.
const CANARY_CAUGHT = 8;
// Ours is measured twice: its look over the reference's backdrop, and its silhouette over this, where a resting body is unmistakable.
const DARK = 'rgb(28 28 28)';

type Raw = Omit<Measured, 'edge' | 'look'> & { edgeRaw: number; img: Rgba; closing: boolean };

const fromBase64 = (b64: string, width: number, height: number): Rgba => ({ width, height, data: new Uint8Array(Buffer.from(b64, 'base64')) });
const fixed = (v: number, n = 2, w = 8) => v.toFixed(n).padStart(w);
const at2 = (p: Point | null | undefined) => (p ? `${p.x.toFixed(0)},${p.y.toFixed(0)}` : '-');

async function tileRgba(page: Page, index: number, width: number, height: number, backdrop?: string): Promise<Rgba> {
  await page.evaluate(([k, over]) => document.querySelectorAll<HTMLElement>('[data-tile^="ours-"]').forEach((el, n) => {
    el.style.visibility = n === k ? 'visible' : 'hidden';
    if (n === k && over) {
      el.dataset.bg = el.style.background;
      el.style.background = over as string;
    }
  }), [index, backdrop ?? '']);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const png = await page.locator(`[data-tile="ours-${index}"]`).screenshot();
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
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-tile^="ours-"]').forEach((el) => {
    el.style.visibility = '';
    if (el.dataset.bg !== undefined) el.style.background = el.dataset.bg;
    delete el.dataset.bg;
  }));
  return fromBase64(b64, width, height);
}

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

  const raw = (img: Rgba, closing = false): Raw => {
    const mask = silhouette(img, rest, THRESHOLD);
    return { img, mask, closing, lightness: meanLightness(img, mask), edgeRaw: edgeEnergy(img, mask, INSET), centroid: centroid(mask) };
  };
  const cache = new Map<number, Raw>();
  const refRaw = async (t: number): Promise<Raw> => {
    const key = Number(t.toFixed(3));
    if (!cache.has(key)) cache.set(key, raw(fromBase64(await page.evaluate((x) => window.__menuReference!.frame(x), key), width, height), key > info.closes - 0.05));
    return cache.get(key)!;
  };
  const refSettled = await refRaw(info.frames[SETTLED]!);
  const dark = { width, height, data: new Uint8Array(width * height * 4).map((_, k) => (k % 4 === 3 ? 255 : 28)) } as Rgba;
  const rawOurs = async (i: number): Promise<Raw> => {
    const real = await tileRgba(page, i, width, height);
    const mask = silhouette(await tileRgba(page, i, width, height, DARK), dark, THRESHOLD);
    return { img: real, mask, closing: info.frames[i]! > info.closes - 0.05, lightness: meanLightness(real, mask), edgeRaw: edgeEnergy(real, mask, INSET), centroid: centroid(mask) };
  };
  const oursSettled = await rawOurs(SETTLED);
  const profiles = new Map<Raw, { top: number; rows: number[] } | null>();
  const profileOf = (settled: Raw) => {
    if (!profiles.has(settled)) profiles.set(settled, rowProfile(settled.img, settled.mask, INSET));
    return profiles.get(settled)!;
  };
  const rel = (m: Raw, settled: Raw): Measured => {
    const edge = settled.edgeRaw > 0 ? m.edgeRaw / settled.edgeRaw : 0;
    const now = edge >= CONTENT_SHOWS && !m.closing ? rowProfile(m.img, m.mask, INSET) : null;
    const rest = profileOf(settled);
    const look: Look = {
      aspect: aspect(m.mask),
      taper: taper(m.mask),
      vertical: verticalLight(m.img, m.mask),
      rim: rimSoftness(m.img, m.mask),
      content: now && rest ? contentFit(now, rest) : null,
    };
    return { mask: m.mask, lightness: m.lightness, edge, centroid: m.centroid, look };
  };
  const measured = new Map<Raw, Measured>();
  const relOf = (m: Raw, settled: Raw): Measured => {
    if (!measured.has(m)) measured.set(m, rel(m, settled));
    return measured.get(m)!;
  };

  const offset: Point =
    oursSettled.centroid && refSettled.centroid
      ? { x: oursSettled.centroid.x - refSettled.centroid.x, y: oursSettled.centroid.y - refSettled.centroid.y }
      : { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
  const offsetSize = Math.hypot(offset.x, offset.y);

  const capsuleArea = area((await refRaw(times[0]!)).mask);
  const settledArea = area(refSettled.mask);
  // The layout offset belongs to the menu, not to the capsule or the drop it grows from: it applies as much as the reference has grown.
  const progress = (centre: Measured) => Math.min(Math.max((area(centre.mask) - capsuleArea) / (settledArea - capsuleArea), 0), 1);
  const registered = (centre: Measured): Point => ({ x: offset.x * progress(centre), y: offset.y * progress(centre) });
  const settledAt = times.indexOf(Number(info.frames[SETTLED]!.toFixed(3)));
  const still = await Promise.all([settledAt - 1, settledAt, settledAt + 1].map((k) => refRaw(times[k]!)));
  const noise = {
    iou: Math.min(iou(still[0]!.mask, still[1]!.mask), iou(still[1]!.mask, still[2]!.mask)),
    lightness: Math.max(Math.abs(still[0]!.lightness - still[1]!.lightness), Math.abs(still[2]!.lightness - still[1]!.lightness)),
    edge: Math.max(...still.map((m) => Math.abs(m.edgeRaw / refSettled.edgeRaw - 1))),
    centroid: Math.max(...still.map((m) => (m.centroid && refSettled.centroid ? Math.hypot(m.centroid.x - refSettled.centroid.x, m.centroid.y - refSettled.centroid.y) : 0))),
  };

  const stillLook = still.map((m) => relOf(m, refSettled).look!);
  const spread = (f: (l: Look) => number | null | undefined) => Math.max(...stillLook.map((l) => Math.abs((f(l) ?? 0) - (f(stillLook[1]!) ?? 0))));
  const lookNoise = { aspect: spread((l) => l.aspect), taper: spread((l) => l.taper), vertical: spread((l) => l.vertical), rim: spread((l) => l.rim) };

  // The reference's frames at t - 1, t and t + 1, and the one `shift` frames from t.
  const around = async (index: number, shift = 0) => {
    const found = times.indexOf(Number(info.frames[index]!.toFixed(3)));
    const refs: Measured[] = [];
    for (const k of [found - 1, found, found + 1]) {
      const t = times[k];
      if (t !== undefined && Math.abs(t - times[found]!) < FRAME * 1.5) refs.push(relOf(await refRaw(t), refSettled));
    }
    const shifted = relOf(await refRaw(times[Math.min(Math.max(found + shift, 0), times.length - 1)]!), refSettled);
    return { refs, at: refs.length === 3 ? 1 : times[found - 1] !== undefined && Math.abs(times[found - 1]! - times[found]!) < FRAME * 1.5 ? 1 : 0, centre: relOf(await refRaw(times[found]!), refSettled), shifted };
  };

  const label = (i: number) => {
    const t = info.frames[i]!;
    return t < info.closes ? `o+${(t - info.opens).toFixed(3)}` : `c+${(t - info.closes).toFixed(3)}`;
  };
  const known = (instant: string, measure: Measure) => KNOWN.some((k) => k.instant === instant && k.measure === measure);

  const failures: string[] = [];
  const knowns: string[] = [];
  const clean = new Set<number>();
  const header = ['instant', 'IoU', 'margin', 'L off', 'margin', 'edge off', 'margin', 'centroid', 'margin', 'ref x,y', 'ours x,y'];
  const look = [['instant', 'aspect ref/ours', 'margin', 'taper ref/ours', 'margin', 'top-bottom ref/ours', 'margin', 'rim px ref/ours', 'margin', 'scale ref/ours', 'margin', 'shift ref/ours', 'margin'].map((h, k) => (k === 0 ? h.padEnd(9) : h.padStart(k % 2 === 1 ? 11 : 7))).join('')];
  const table = [header.map((h, k) => (k === 0 ? h.padEnd(9) : h.padStart(9)) + (k > 0 && k < 9 && k % 2 === 0 ? ' ' : '')).join('') + '  result'];
  for (let i = 0; i < info.frames.length; i += 1) {
    const { refs, at, centre } = await around(i);
    const ours = rel(i === SETTLED ? oursSettled : await rawOurs(i), oursSettled);
    const verdict: Verdict = compareToReference(ours, refs, registered(centre), SLACK, at);
    const name = label(i);
    const bad = verdict.failed.filter((m) => !known(name, m));
    const old = verdict.failed.filter((m) => known(name, m));
    if (!bad.length && !old.length) clean.add(i);
    if (bad.length) failures.push(`${name}: ${bad.join(', ')}`);
    knowns.push(...old.map((m) => `${name}: ${m}`));
    const m = verdict.margin;
    if (process.env.PARITY_DEBUG) {
      const bb = (m: Measured) => JSON.stringify(bounds(m.mask));
      console.log(`BOX ${label(i)} ref ${bb(centre)} ours ${bb(ours)} L ${centre.lightness.toFixed(3)}/${ours.lightness.toFixed(3)} E ${centre.edge.toFixed(2)}/${ours.edge.toFixed(2)}`);
    }
    const range = (f: (m: Measured) => number) => `${Math.min(...refs.map(f)).toFixed(3)}..${Math.max(...refs.map(f)).toFixed(3)}`;
    const why = bad.map((k) => (k === 'lightness' ? `L ours ${ours.lightness.toFixed(3)} ref ${range((m) => m.lightness)}` : k === 'edge' ? `edge ours ${ours.edge.toFixed(2)} ref ${range((m) => m.edge)}` : k)).join(' ');
    const mark = (k: Measure) => (verdict.failed.includes(k) ? (known(name, k) ? '~' : '!') : ' ');
    const num = (v: number | null | undefined, n = 2) => (typeof v === 'number' ? v.toFixed(n) : '-');
    const pair = (a: number | null | undefined, b: number | null | undefined, n = 2) => `${num(a, n)}/${num(b, n)}`.padStart(11);
    const cell = (k: keyof LookSlack, d = 2) => `${num(m[k], d).padStart(6)}${mark(k)}`;
    const o = ours.look!;
    look.push(
      [
        name.padEnd(9),
        pair(centre.look?.aspect, o.aspect),
        cell('aspect'),
        pair(centre.look?.taper, o.taper),
        cell('taper'),
        pair(centre.look?.vertical, o.vertical, 3),
        cell('vertical', 3),
        pair(centre.look?.rim, o.rim, 1),
        cell('rim', 1),
        pair(centre.look?.content?.scale, o.content?.scale),
        cell('scale'),
        pair(centre.look?.content?.shift, o.content?.shift, 0),
        cell('shift', 0),
      ].join(''),
    );
    table.push(
      [
        name.padEnd(9),
        fixed(verdict.iou, 2, 9),
        fixed(m.iou!, 2, 8) + mark('iou'),
        fixed(verdict.lightness, 3, 9),
        fixed(m.lightness!, 3, 8) + mark('lightness'),
        fixed(verdict.edge, 2, 9),
        fixed(m.edge!, 2, 8) + mark('edge'),
        fixed(verdict.centroid, 1, 9),
        fixed(m.centroid!, 1, 8) + mark('centroid'),
        at2(centre.centroid).padStart(9),
        at2(ours.centroid).padStart(9),
        bad.length ? `  FAIL ${why}` : old.length ? `  KNOWN ${old.join('+')}` : '  ok',
      ].join(''),
    );
  }

  const caught: Record<number, number> = {};
  const canary: string[] = [];
  for (const shift of [0, 3, -3]) {
    caught[shift] = 0;
    const slipped: string[] = [];
    for (let i = 0; i < info.frames.length; i += 1) {
      const { refs, at, shifted } = await around(i, shift);
      const v = compareToReference(shifted, refs, { x: 0, y: 0 }, SLACK, at);
      if (!v.failed.length) continue;
      if (shift === 0 || i !== SETTLED) caught[shift]! += 1;
      slipped.push(`${label(i)}(${v.failed.join('+')})`);
    }
    canary.push(`shift ${shift >= 0 ? '+' : ''}${shift} frames: ${caught[shift]} of ${info.frames.length - 1} moving instants fail: ${slipped.join(' ') || '-'}`);
  }

  console.log(
    [
      table.join('\n'),
      look.join(String.fromCharCode(10)),
      `registration, the settled menu's centroid (ours minus the reference's), taken off every centroid and silhouette: ${offset.x.toFixed(1)}, ${offset.y.toFixed(1)} dp (${offsetSize.toFixed(1)}; bound ${MAX_OFFSET})`,
      `noise of the new measures in the same frames: aspect ${lookNoise.aspect.toFixed(3)}, taper ${lookNoise.taper.toFixed(3)}, top-bottom light ${lookNoise.vertical.toFixed(3)}, rim ${lookNoise.rim.toFixed(2)} px`,
      `slack: IoU ${SLACK.iou}, lightness ${SLACK.lightness}, edge ${SLACK.edge}, centroid ${SLACK.centroid} dp`,
      `noise in the reference's own settled frames: IoU ${noise.iou.toFixed(3)}, lightness ${noise.lightness.toFixed(3)}, edge ${noise.edge.toFixed(3)}, centroid ${noise.centroid.toFixed(2)} dp`,
      `canary (the reference's own frames as ours, shifted in time; ~ marks a known measure, ! a failure):\n  ${canary.join('\n  ')}`,
      `summary: ${clean.size} of ${info.frames.length} instants pass clean, ${failures.length} fail, ${knowns.length} measures known${knowns.length ? ` (${knowns.join('; ')})` : ''}`,
    ].join('\n'),
  );

  expect(offsetSize, 'the settled menu sits further from the reference than registration may hide').toBeLessThanOrEqual(MAX_OFFSET);
  expect(failures, 'instants outside the reference tolerances').toEqual([]);
  expect(caught[0], 'the reference against itself').toBe(0);
  expect(caught[3], 'a reference 0.1 s late told from a match').toBeGreaterThanOrEqual(CANARY_CAUGHT);
  expect(caught[-3], 'a reference 0.1 s early told from a match').toBeGreaterThanOrEqual(CANARY_CAUGHT);
});

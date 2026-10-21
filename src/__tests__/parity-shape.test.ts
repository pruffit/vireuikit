import { describe, expect, it } from 'vitest';
import type { Mask, Rgba } from '../../tests/lab/parity-measures';
import { aspect, contentFit, rimSoftness, rowProfile, taper, verticalLight } from '../../tests/lab/parity-shape';

const W = 160;
const H = 160;

const mask = (inside: (x: number, y: number) => boolean): Mask => {
  const on = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) on[y * W + x] = inside(x, y) ? 1 : 0;
  return { width: W, height: H, on };
};
const image = (value: (x: number, y: number) => number): Rgba => {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) data.set([value(x, y), value(x, y), value(x, y), 255], (y * W + x) * 4);
  return { width: W, height: H, data };
};
const box = (x0: number, y0: number, x1: number, y1: number) => mask((x, y) => x >= x0 && x < x1 && y >= y0 && y < y1);

describe('the proportions', () => {
  it('reads the box: height over width', () => {
    expect(aspect(box(10, 10, 50, 90))).toBeCloseTo(2, 9);
    expect(aspect(box(10, 10, 90, 50))).toBeCloseTo(0.5, 9);
  });

  it('reads a pear under 1, a bowl over 1 and a box as 1', () => {
    const half = (top: number, bottom: number) => (y: number) => top + ((bottom - top) * (y - 20)) / 100;
    const body = (top: number, bottom: number) => mask((x, y) => y >= 20 && y < 120 && Math.abs(x - 80) < half(top, bottom)(y) / 2);
    expect(taper(box(20, 20, 100, 120))).toBeCloseTo(1, 2);
    expect(taper(body(30, 70))).toBeLessThan(0.7);
    expect(taper(body(70, 30))).toBeGreaterThan(1.4);
  });

  it('canary: a pear drawn as a pill has the pill\'s taper', () => {
    const pear = mask((x, y) => y >= 20 && y < 120 && Math.abs(x - 80) < (30 + (y - 20) * 0.3) / 2);
    const pill = box(65, 20, 95, 120);
    expect(taper(pill) - taper(pear)).toBeGreaterThan(0.25);
  });
});

describe('where the light sits', () => {
  it('is positive lit from above and negative lit from below', () => {
    const m = box(20, 20, 100, 120);
    expect(verticalLight(image((_, y) => 100 + (120 - y)), m)).toBeGreaterThan(0.1);
    expect(verticalLight(image((_, y) => 100 + y), m)).toBeLessThan(-0.1);
    expect(verticalLight(image(() => 150), m)).toBeCloseTo(0, 9);
  });
});

describe('the rim', () => {
  const m = box(40, 40, 120, 120);
  const edge = (soft: number) => image((x, y) => {
    const d = Math.min(x - 40, 119 - x, y - 40, 119 - y);
    return 60 + 140 * Math.min(Math.max((d + soft) / (2 * soft), 0), 1);
  });

  it('takes more pixels to cross a soft edge than a hard one', () => {
    const hard = rimSoftness(edge(0.5), m)!;
    const soft = rimSoftness(edge(3), m)!;
    expect(hard).toBeLessThan(3);
    expect(soft).toBeGreaterThan(hard + 2);
  });

  it('is null where inside and outside are alike', () => {
    expect(rimSoftness(image(() => 128), m)).toBeNull();
  });
});

describe('the content', () => {
  // Rows of text: bright lines of two pixels, every `pitch` pixels from `first`, on a grey field.
  const rows = (pitch: number, first: number) => image((_, y) => ((y - first) % pitch + pitch) % pitch < 3 && y >= first ? 230 : 90);
  const settledBody = box(20, 20, 140, 100);
  const settled = rowProfile(rows(20, 30), settledBody, 2)!;

  it('finds the rest as scale 1 and no shift', () => {
    const fit = contentFit(settled, settled)!;
    expect(fit.scale).toBeCloseTo(1, 1);
    expect(Math.abs(fit.shift)).toBeLessThan(1);
  });

  it('reads magnified rows as a larger scale and rows that sit high as a negative shift', () => {
    const now = rowProfile(rows(28, 14), box(20, 5, 140, 125), 2)!;
    const fit = contentFit(now, settled)!;
    expect(fit.scale).toBeGreaterThan(1.2);
    expect(fit.scale).toBeLessThan(1.6);
    expect(fit.shift).toBeLessThan(0);
  });

  it('is null without any structure', () => {
    expect(contentFit(rowProfile(image(() => 128), settledBody, 2)!, settled)).toBeNull();
  });
});

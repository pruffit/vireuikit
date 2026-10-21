import { describe, expect, it } from 'vitest';
import type { Mask, Rgba } from '../../tests/lab/parity-measures';
import { aspect, contentTemplate, matchContent, rimSoftness, taper, verticalLight } from '../../tests/lab/parity-shape';

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
  // Four rows that differ: a bar of its own width and a dot of its own place, on a grey field, drawn at a scale and a shift about the centre of the body.
  const WIDTHS = [22, 46, 31, 58];
  const DOTS = [4, 26, 12, 40];
  const body = box(20, 20, 140, 140);
  const draw = (scale: number, shift: number, blur = 0) => {
    const dark = new Float32Array(W * H);
    const bar = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = Math.round(y0); y < Math.round(y1); y += 1) for (let x = Math.round(x0); x < Math.round(x1); x += 1) if (x >= 0 && y >= 0 && x < W && y < H) dark[y * W + x] = 1;
    };
    WIDTHS.forEach((width, k) => {
      const y = 80 + shift + scale * (-37 + k * 25);
      bar(30 + scale * 6 + (80 - 30) * (scale - 1) * -0.5 + 0, y - scale * 3, 30 + scale * (6 + width), y + scale * 3);
      bar(30 + scale * (70 + DOTS[k]!), y - scale * 5, 30 + scale * (76 + DOTS[k]!), y + scale * 5);
    });
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -blur; dy <= blur; dy += 1) for (let dx = -blur; dx <= blur; dx += 1) {
        const xx = Math.min(Math.max(x + dx, 0), W - 1);
        const yy = Math.min(Math.max(y + dy, 0), H - 1);
        sum += dark[yy * W + xx]!;
        n += 1;
      }
      out[y * W + x] = sum / n;
    }
    return image((x, y) => 215 - 150 * out[y * W + x]!);
  };
  const template = contentTemplate(draw(1, 0), body, 4)!;

  it('finds the rest as scale 1 and no shift', () => {
    const fit = matchContent(draw(1, 0), body, template, 4)!;
    expect(fit.scale).toBeCloseTo(1, 1);
    expect(Math.abs(fit.shift)).toBeLessThanOrEqual(3);
  });

  it('reads magnified rows that sit high as a larger scale and a negative shift, blurred or not', () => {
    for (const blur of [0, 3]) {
      const fit = matchContent(draw(1.4, -30, blur), body, template, 4)!;
      expect(fit.scale).toBeGreaterThan(1.25);
      expect(fit.scale).toBeLessThan(1.55);
      expect(fit.shift).toBeLessThan(-18);
      expect(fit.shift).toBeGreaterThan(-42);
    }
  });

  it('is not fooled by a shift of one row: the rows differ, so it reads the shift it is', () => {
    const fit = matchContent(draw(1, -25), body, template, 4)!;
    expect(fit.shift).toBeLessThan(-18);
    expect(fit.shift).toBeGreaterThan(-32);
  });

  it('canary: rows that sit at rest do not read as shifted, and shifted ones do not read as rest', () => {
    const rest = matchContent(draw(1, 0, 2), body, template, 4)!;
    const high = matchContent(draw(1, -40, 2), body, template, 4)!;
    expect(high.shift).toBeLessThan(rest.shift - 25);
  });

  it('is null without any structure', () => {
    expect(matchContent(image(() => 128), body, template, 4)).toBeNull();
  });
});

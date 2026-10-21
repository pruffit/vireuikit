import { describe, expect, it } from 'vitest';
import {
  area,
  centroid,
  compareToReference,
  distanceToPolyline,
  distanceToRange,
  edgeEnergy,
  iou,
  meanLightness,
  shiftMask,
  silhouette,
  type Mask,
  type Rgba,
} from '../../tests/lab/parity-measures';

const W = 120;
const H = 100;

function image(fill: (x: number, y: number) => number): Rgba {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = fill(x, y);
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}

const mask = (inside: (x: number, y: number) => boolean): Mask => {
  const on = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) on[y * W + x] = inside(x, y) ? 1 : 0;
  return { width: W, height: H, on };
};
const box = (x0: number, y0: number, x1: number, y1: number) => mask((x, y) => x >= x0 && x < x1 && y >= y0 && y < y1);

const rest = image(() => 100);
const withBox = (value: number, x0 = 30, y0 = 20, x1 = 90, y1 = 70) => image((x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? value : 100));

describe('silhouette', () => {
  it('takes pixels more than the threshold away from the rest frame, and not those at it', () => {
    expect(area(silhouette(withBox(106), rest, 6))).toBe(0);
    expect(area(silhouette(withBox(107), rest, 6))).toBe(60 * 50);
  });

  it('counts a darker pixel as well as a lighter one', () => {
    expect(area(silhouette(withBox(80), rest, 6))).toBe(60 * 50);
  });

  it('drops specks and fills holes', () => {
    const speck = image((x, y) => (x >= 10 && x < 14 && y >= 10 && y < 14 ? 160 : 100));
    expect(area(silhouette(speck, rest, 6))).toBe(0);
    const ring = image((x, y) => (x >= 30 && x < 90 && y >= 20 && y < 70 && !(x >= 50 && x < 70 && y >= 35 && y < 55) ? 160 : 100));
    expect(area(silhouette(ring, rest, 6))).toBe(60 * 50);
  });
});

describe('iou', () => {
  it('is 1 for the same shape, 0 for disjoint ones and the overlap over the union otherwise', () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
    expect(iou(box(0, 0, 10, 10), box(20, 20, 30, 30))).toBe(0);
    expect(iou(box(0, 0, 10, 10), box(5, 0, 15, 10))).toBeCloseTo(50 / 150, 9);
  });
});

describe('meanLightness', () => {
  it('averages the luma inside the mask only', () => {
    const img = withBox(204);
    expect(meanLightness(img, box(30, 20, 90, 70))).toBeCloseTo(0.8, 6);
    expect(meanLightness(img, box(0, 0, 10, 10))).toBeCloseTo(100 / 255, 6);
  });
});

describe('edgeEnergy', () => {
  const inside = box(10, 10, 110, 90);
  const stripes = (soft: boolean) => image((x) => (soft ? 128 + 60 * Math.sin(x / 8) : x % 4 < 2 ? 40 : 220));

  it('reads a drop or a flat tint as zero', () => {
    expect(edgeEnergy(image(() => 200), inside, 8)).toBeCloseTo(0, 9);
  });

  it('reads sharp structure high, and a blurred copy of it lower', () => {
    const sharp = edgeEnergy(stripes(false), inside, 8);
    expect(sharp).toBeGreaterThan(0.1);
    expect(edgeEnergy(stripes(true), inside, 8)).toBeLessThan(sharp / 2);
  });

  it('keeps clear of the rim: the edge of the shape itself is not content', () => {
    expect(edgeEnergy(withBox(200), box(30, 20, 90, 70), 8)).toBeCloseTo(0, 9);
  });
});

describe('centroid', () => {
  it('is the mean of the mask, and null for none', () => {
    expect(centroid(box(10, 10, 20, 30))).toEqual({ x: 14.5, y: 19.5 });
    expect(centroid(box(0, 0, 0, 0))).toBeNull();
  });

  it('moves by as much as the shape does', () => {
    const a = centroid(box(10, 10, 40, 40))!;
    const b = centroid(shiftMask(box(10, 10, 40, 40), 7, -3))!;
    expect(b.x - a.x).toBeCloseTo(7, 9);
    expect(b.y - a.y).toBeCloseTo(-3, 9);
  });
});

describe('the envelope', () => {
  it('measures the distance to an interval and to a path', () => {
    expect(distanceToRange(5, [3, 9, 6])).toBe(0);
    expect(distanceToRange(1, [3, 9, 6])).toBe(2);
    expect(distanceToRange(12, [3, 9, 6])).toBe(3);
    expect(distanceToPolyline({ x: 5, y: 3 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(3);
    expect(distanceToPolyline({ x: 13, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(3);
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Number.POSITIVE_INFINITY);
  });

  const slack = { iou: 0.8, lightness: 0.05, edge: 0.05, centroid: 2.5 };
  const at = (x0: number, lightness: number, edge: number) => {
    const m = box(x0, 20, x0 + 40, 60);
    return { mask: m, lightness, edge, centroid: centroid(m) };
  };
  const frames = [at(20, 0.5, 0.2), at(30, 0.6, 0.4), at(40, 0.7, 0.6)];

  it('passes ours at any of the three frames and between them, fails it a lag later', () => {
    const none = { x: 0, y: 0 };
    for (const ours of [frames[0]!, frames[1]!, frames[2]!, at(33, 0.65, 0.5)]) expect(compareToReference(ours, frames, none, slack).failed).toEqual([]);
    const late = compareToReference(at(70, 0.9, 0.9), frames, none, slack);
    expect(late.failed).toEqual(['iou', 'lightness', 'edge', 'centroid']);
    expect(late.margin.lightness).toBeLessThan(0);
  });

  it('takes the registered offset off ours before it compares', () => {
    const shifted = at(55, 0.6, 0.4);
    expect(compareToReference(shifted, frames, { x: 0, y: 0 }, slack).failed).toContain('centroid');
    expect(compareToReference(shifted, frames, { x: 15, y: 0 }, slack).failed).toEqual([]);
  });
});

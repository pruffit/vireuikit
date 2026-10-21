import { describe, expect, it } from 'vitest';
import { unionBounds, unionOutline, type UnionShape } from '../kit/union';

const capsule: UnionShape = { x: 0, y: 60, width: 160, height: 40, radius: 20 };
const bud: UnionShape = { x: 60, y: 30, width: 40, height: 40, radius: 20 };

const inside = (points: { x: number; y: number }[], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

describe('the outline of a drop joined to its capsule', () => {
  const both = unionBounds(capsule, bud);
  const outline = unionOutline(capsule, bud, 12, both);

  it('holds both shapes and stays inside their joint bounds', () => {
    expect(both).toEqual({ x: 0, y: 30, width: 160, height: 70 });
    expect(inside(outline, 80, 50)).toBe(true);
    expect(inside(outline, 80, 10)).toBe(true);
    for (const p of outline) {
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.x).toBeLessThanOrEqual(160.5);
      expect(p.y).toBeGreaterThanOrEqual(-0.5);
      expect(p.y).toBeLessThanOrEqual(70.5);
    }
  });

  it('leaves what is outside both shapes outside, and fills the neck between them', () => {
    expect(inside(outline, 10, 5)).toBe(false);
    expect(inside(outline, 150, 5)).toBe(false);
    expect(inside(outline, 57, 29)).toBe(true);
  });

  it('is the capsule alone when the drop lies inside it', () => {
    const alone = unionOutline(capsule, { x: 70, y: 70, width: 20, height: 20, radius: 10 }, 6, capsule);
    const ys = alone.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(0, 0);
    expect(Math.max(...ys)).toBeCloseTo(40, 0);
  });
});

describe('shapes with a gap between them', () => {
  const far: UnionShape = { x: 70, y: -40, width: 20, height: 20, radius: 10 };
  const both = unionBounds(capsule, far);
  const outline = unionOutline(capsule, far, 4, both);

  it('keeps both shapes, bridging the gap instead of losing the far one', () => {
    expect(inside(outline, 80, 80)).toBe(true);
    expect(inside(outline, 80, -30 - both.y)).toBe(true);
    for (const p of outline) {
      expect(p.y).toBeGreaterThanOrEqual(-0.5);
      expect(p.y).toBeLessThanOrEqual(both.height + 0.5);
    }
  });
});

describe('the facets of the outline', () => {
  // The depth of a facet is how far the middle of its chord lies from the true boundary; under half a dp it is not seen.
  it('are shallower than half a dp on the corner of a wide menu', () => {
    const wide: UnionShape = { x: 0, y: 0, width: 250, height: 200, radius: 35 };
    const alone = unionOutline(wide, { x: 100, y: 80, width: 10, height: 10, radius: 5 }, 0, wide);
    const hw = 125;
    const hh = 100;
    const r = 35;
    const depth = (p: { x: number; y: number }) => {
      const qx = Math.abs(p.x - hw) - (hw - r);
      const qy = Math.abs(p.y - hh) - (hh - r);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    };
    let deepest = 0;
    for (let i = 0; i < alone.length; i += 1) {
      const a = alone[i]!;
      const b = alone[(i + 1) % alone.length]!;
      deepest = Math.max(deepest, Math.abs(depth({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })));
    }
    expect(deepest).toBeLessThan(0.5);
  });
});

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

import { describe, expect, it } from 'vitest';
import { toolbarBounds, toolbarClipPath, toolbarClusters, toolbarSilhouette, type MorphBox } from '../index';

const pill = (x: number, width: number, height = 44, y = 0): MorphBox => ({ x, y, width, height, radius: height / 2 });
const point = (x: number): MorphBox => ({ x, y: 22, width: 0, height: 0, radius: 0 });

/** The silhouette's thickness across the axis at a given position along it. */
function thickness(points: [number, number][], at: number): number {
  const half = points.length / 2;
  const top = points.slice(0, half);
  const bottom = points.slice(half).reverse();
  const i = top.findIndex(([x]) => x >= at);
  return bottom[i]![1] - top[i]![1];
}

describe('toolbar clusters', () => {
  it('joins neighbours only when the neck reaches across the gap', () => {
    const boxes = [pill(0, 44), pill(52, 44), pill(140, 44)];
    expect(toolbarClusters(boxes, 0, 'x')).toEqual([[0], [1], [2]]);
    expect(toolbarClusters(boxes, 15, 'x')).toEqual([[0], [1], [2]]);
    expect(toolbarClusters(boxes, 18, 'x')).toEqual([[0, 1], [2]]);
    expect(toolbarClusters([pill(0, 44), pill(44, 44)], 4, 'x')).toEqual([[0, 1]]);
  });

  it('orders a group along the axis whatever the order it is given in', () => {
    const boxes = [pill(100, 44), pill(0, 44), pill(52, 44)];
    expect(toolbarClusters(boxes, 40, 'x')).toEqual([[1, 2, 0]]);
  });

  it('holds a budding point with the capsule it comes out of', () => {
    expect(toolbarClusters([pill(0, 100), point(80)], 12, 'x')).toEqual([[0, 1]]);
  });

  it('works down a vertical strip', () => {
    const column = (y: number): MorphBox => ({ x: 0, y, width: 44, height: 44, radius: 22 });
    expect(toolbarClusters([column(0), column(48)], 20, 'y')).toEqual([[0, 1]]);
  });
});

describe('toolbar silhouette', () => {
  it('is the capsule itself for one shape', () => {
    const points = toolbarSilhouette([pill(0, 100)], 0, 'x');
    expect(thickness(points, 50)).toBeCloseTo(44, 0);
    expect(thickness(points, 1)).toBeLessThan(20);
  });

  it('keeps two capsules apart when the gap is wider than the neck', () => {
    const points = toolbarSilhouette([pill(0, 60), pill(68, 60)], 10, 'x');
    expect(thickness(points, 64)).toBeCloseTo(0, 0);
  });

  it('builds a neck that thickens as the gap closes', () => {
    const neck = (gap: number) => thickness(toolbarSilhouette([pill(0, 60), pill(60 + gap, 60)], 15, 'x'), 60 + gap / 2);
    expect(neck(8)).toBeLessThan(neck(4));
    expect(neck(4)).toBeLessThan(neck(1));
    expect(neck(1)).toBeLessThan(neck(0));
    expect(neck(0)).toBeLessThan(44);
  });

  it('runs down a strip the same way', () => {
    const column = (y: number): MorphBox => ({ x: 0, y, width: 44, height: 44, radius: 22 });
    const points = toolbarSilhouette([column(0), column(48)], 15, 'y');
    const xs = points.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(44, 0);
  });

  it('writes a clip path in the coordinates of the bounds', () => {
    const boxes = [pill(10, 60), pill(70, 60)];
    expect(toolbarBounds(boxes)).toMatchObject({ x: 10, width: 120, height: 44 });
    expect(toolbarClipPath(toolbarSilhouette(boxes, 12, 'x', 4))).toMatch(/^polygon\(0\.0px /);
  });
});

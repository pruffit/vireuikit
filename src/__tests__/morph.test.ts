import { describe, expect, it } from 'vitest';
import { capsuleGeometry, roundedRectGeometry } from 'vireglass';
import {
  createGrowthState,
  growthFrame,
  growthPhase,
  stepGrowth,
  stepSpring,
  type GrowthShape,
  type Spring,
} from '../kit/morph';

const ANCHOR = { x: 400, y: 100 };
const SOURCE_GEOMETRY = capsuleGeometry(84, 40);
const TARGET_GEOMETRY = roundedRectGeometry(206, 184, 26);
const source: GrowthShape = {
  geometry: SOURCE_GEOMETRY,
  center: { x: ANCHOR.x - SOURCE_GEOMETRY.width / 2, y: ANCHOR.y + SOURCE_GEOMETRY.height / 2 },
};
const target: GrowthShape = {
  geometry: TARGET_GEOMETRY,
  center: { x: ANCHOR.x - TARGET_GEOMETRY.width / 2, y: ANCHOR.y + TARGET_GEOMETRY.height / 2 },
};

// The anchor corner is generalized over its sign, so all four quadrants are checked, not just the
// one the mechanism was originally built from.
const QUADRANTS = [
  { name: 'top-right', sx: -1, sy: 1 },
  { name: 'top-left', sx: 1, sy: 1 },
  { name: 'bottom-right', sx: -1, sy: -1 },
  { name: 'bottom-left', sx: 1, sy: -1 },
] as const;

describe('growth works from any corner', () => {
  for (const q of QUADRANTS) {
    it('the target lands in its own corner: ' + q.name, () => {
      const src: GrowthShape = {
        geometry: SOURCE_GEOMETRY,
        center: {
          x: ANCHOR.x + (q.sx * SOURCE_GEOMETRY.width) / 2,
          y: ANCHOR.y + (q.sy * SOURCE_GEOMETRY.height) / 2,
        },
      };
      const dst: GrowthShape = {
        geometry: TARGET_GEOMETRY,
        center: {
          x: ANCHOR.x + (q.sx * TARGET_GEOMETRY.width) / 2,
          y: ANCHOR.y + (q.sy * TARGET_GEOMETRY.height) / 2,
        },
      };
      const frame = growthFrame(src, dst, ANCHOR, { shrink: 1, grow: 1 });
      expect(frame.body.center.x).toBeCloseTo(dst.center.x, 6);
      expect(frame.body.center.y).toBeCloseTo(dst.center.y, 6);
    });
  }

  // The anchor sits exactly on the source's center axis: growth along it centers rather than
  // hugging an edge.
  it('anchor on the same axis as the center — growth centers', () => {
    const src: GrowthShape = { geometry: SOURCE_GEOMETRY, center: { x: ANCHOR.x, y: ANCHOR.y + 60 } };
    const dst: GrowthShape = { geometry: TARGET_GEOMETRY, center: { x: ANCHOR.x, y: ANCHOR.y + 200 } };
    const frame = growthFrame(src, dst, ANCHOR, { shrink: 1, grow: 1 });
    expect(frame.body.center.x).toBeCloseTo(ANCHOR.x, 6);
  });
});

describe("the source's shape isn't swapped out", () => {
  // A field with a partial corner radius at rest has to stay itself, not become a full pill.
  it("the source's radius eases into the drop's rather than being replaced by it", () => {
    const field = roundedRectGeometry(240, 44, 12);
    const src: GrowthShape = { geometry: field, center: { x: ANCHOR.x - 120, y: ANCHOR.y + 22 } };
    const rest = growthFrame(src, target, ANCHOR, { shrink: 0, grow: 0 });
    expect(rest.body.geometry.cornerRadius).toBeCloseTo(field.cornerRadius, 6);
    const drop = growthFrame(src, target, ANCHOR, { shrink: 1, grow: 0 });
    expect(drop.body.geometry.cornerRadius).toBeGreaterThan(field.cornerRadius);
  });
});

describe('two-phase growth: boundaries', () => {
  it('at the start — the source shape', () => {
    const frame = growthFrame(source, target, ANCHOR, { shrink: 0, grow: 0 });
    expect(frame.body.geometry).toEqual(source.geometry);
    expect(frame.body.center).toEqual(source.center);
    expect(frame.merge).toBeUndefined();
    expect(frame.ink.outgoing).toBe(1);
    expect(frame.ink.incoming).toBe(0);
  });

  it('at the end — the target shape', () => {
    const frame = growthFrame(source, target, ANCHOR, { shrink: 1, grow: 1 });
    expect(frame.body.geometry.width).toBeCloseTo(target.geometry.width, 6);
    expect(frame.body.geometry.height).toBeCloseTo(target.geometry.height, 6);
    expect(frame.body.geometry.cornerRadius).toBeCloseTo(target.geometry.cornerRadius, 6);
    expect(frame.body.center.x).toBeCloseTo(target.center.x, 6);
    expect(frame.body.center.y).toBeCloseTo(target.center.y, 6);
    expect(frame.merge).toBeUndefined();
    expect(frame.ink.outgoing).toBe(0);
    expect(frame.ink.incoming).toBe(1);
  });

  it('the neck only grows in the middle of the transition', () => {
    const mid = growthFrame(source, target, ANCHOR, { shrink: 1, grow: 0.15 });
    expect(mid.merge).toBeDefined();
    expect(mid.merge!.smoothing).toBeGreaterThan(0);
  });
});

describe('reverse path', () => {
  it('opening and closing return the body to its source shape', () => {
    const state = createGrowthState();
    for (let i = 0; i < 600; i += 1) stepGrowth(state, 1 / 60, true);
    const opened = growthFrame(source, target, ANCHOR, growthPhase(state));
    expect(opened.body.center.x).toBeCloseTo(target.center.x, 3);
    expect(opened.body.center.y).toBeCloseTo(target.center.y, 3);
    expect(opened.body.geometry.width).toBeCloseTo(target.geometry.width, 3);

    for (let i = 0; i < 600; i += 1) stepGrowth(state, 1 / 60, false);
    const closed = growthFrame(source, target, ANCHOR, growthPhase(state));
    expect(closed.body.geometry.width).toBeCloseTo(source.geometry.width, 3);
    expect(closed.body.geometry.height).toBeCloseTo(source.geometry.height, 3);
    expect(closed.body.center.x).toBeCloseTo(source.center.x, 3);
    expect(closed.body.center.y).toBeCloseTo(source.center.y, 3);
    expect(closed.merge).toBeUndefined();
  });

  it('the same phase gives the same geometry — regardless of how it got there', () => {
    const a = growthFrame(source, target, ANCHOR, { shrink: 0.6, grow: 0.35 });
    const b = growthFrame(source, target, ANCHOR, { shrink: 0.6, grow: 0.35 });
    expect(b).toEqual(a);
  });
});

describe('reduced motion', () => {
  it('the transition is instant: no overshoot and no defocus phase', () => {
    const state = createGrowthState();
    stepGrowth(state, 1 / 60, true, true);
    const phase = growthPhase(state);
    expect(phase.shrink).toBe(1);
    expect(phase.grow).toBe(1);
    const frame = growthFrame(source, target, ANCHOR, phase);
    expect(frame.merge).toBeUndefined();
    expect(frame.ink.outgoing).toBe(0);
    expect(frame.ink.incoming).toBe(1);

    stepGrowth(state, 1 / 60, false, true);
    const closedPhase = growthPhase(state);
    expect(closedPhase.shrink).toBe(0);
    expect(closedPhase.grow).toBe(0);
  });

  it("without reduced motion there is an overshoot — otherwise the contrast can't be checked", () => {
    const state = createGrowthState();
    let sawOvershoot = false;
    for (let i = 0; i < 600; i += 1) {
      stepGrowth(state, 1 / 60, true, false);
      if (state.grow.x > 1) sawOvershoot = true;
    }
    expect(sawOvershoot).toBe(true);
  });

  it('with reduced motion there is never an overshoot, on any frame', () => {
    const state = createGrowthState();
    for (let i = 0; i < 60; i += 1) {
      stepGrowth(state, 1 / 60, true, true);
      expect(state.grow.x).toBeLessThanOrEqual(1);
      expect(state.shrink.x).toBeLessThanOrEqual(1);
    }
  });
});

describe('spring', () => {
  it('converges to the target and stays finite', () => {
    const s: Spring = { x: 0, v: 0, target: 1 };
    for (let i = 0; i < 600; i += 1) {
      stepSpring(s, 1 / 60, 0.4, 1, false);
      expect(Number.isFinite(s.x)).toBe(true);
    }
    expect(s.x).toBeCloseTo(1, 3);
  });

  it('a large frame step does not destabilize the spring', () => {
    const s: Spring = { x: 0, v: 0, target: 1 };
    for (let i = 0; i < 20; i += 1) stepSpring(s, 1, 0.4, 1, false);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThanOrEqual(1.01);
  });

  it('instant transfers immediately, with no overshoot', () => {
    const s: Spring = { x: 0, v: 5, target: 1 };
    const moved = stepSpring(s, 1 / 60, 0.4, 1, true);
    expect(moved).toBe(true);
    expect(s).toEqual({ x: 1, v: 0, target: 1 });
  });
});

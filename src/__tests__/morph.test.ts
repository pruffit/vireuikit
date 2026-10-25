import { describe, expect, it } from 'vitest';
import { capsuleGeometry, roundedRectGeometry } from 'vireglass';
import {
  SPRING_STEP,
  createGrowthState,
  createMotionClock,
  growthFrame,
  growthPhase,
  growthStateAt,
  stepGrowth,
  stepMotion,
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

describe('the growth against the reference (M 5:11, docs/acceptance.md N29)', () => {
  it("the source's glyphs stay in focus into the first quarter of the drop's forming and are gone when it has formed", () => {
    expect(growthFrame(source, target, ANCHOR, { shrink: 0.2, grow: 0 }).ink.outgoing).toBe(1);
    expect(growthFrame(source, target, ANCHOR, { shrink: 0.5, grow: 0 }).ink.outgoing).toBeGreaterThan(0.4);
    expect(growthFrame(source, target, ANCHOR, { shrink: 0.9, grow: 0 }).ink.outgoing).toBe(0);
  });

  it('the drop forms where the source was and rises toward the target as it swells, ahead of it', () => {
    const formed = growthFrame(source, target, ANCHOR, { shrink: 1, grow: 0 }).body.center;
    expect(Math.hypot(formed.x - source.center.x, formed.y - source.center.y)).toBeLessThan(0.15 * SOURCE_GEOMETRY.height * 2);
    const travel = Math.hypot(target.center.x - source.center.x, target.center.y - source.center.y);
    const half = growthFrame(source, target, ANCHOR, { shrink: 1, grow: 0.5 }).body.center;
    expect(Math.hypot(half.x - source.center.x, half.y - source.center.y)).toBeGreaterThan(0.5 * travel);
  });

  it('with its own rise the body overshoots the target\'s centre and goes past the source\'s when closing', () => {
    const over = growthFrame(source, target, ANCHOR, { shrink: 1, grow: 0.95, rise: 1.15 }).body.center;
    expect(over.y).toBeGreaterThan(target.center.y);
    const past = growthFrame(source, target, ANCHOR, { shrink: 0, grow: 0, rise: -0.15 }).body.center;
    expect(past.y).toBeLessThan(source.center.y);
  });

  it('the content follows its own focus once there is one', () => {
    expect(growthFrame(source, target, ANCHOR, { shrink: 1, grow: 1, focus: 0.3 }).ink.incoming).toBeCloseTo(0.3 / 0.97, 6);
    expect(growthFrame(source, target, ANCHOR, { shrink: 1, grow: 1, focus: 1 }).ink.incoming).toBe(1);
  });

  it('closing finds the capsule whole until the drop has swelled a third of the way', () => {
    const closing = growthFrame(source, target, ANCHOR, { shrink: 0, grow: 0.2 });
    expect(closing.merge?.width ?? closing.body.geometry.width).toBeGreaterThanOrEqual(SOURCE_GEOMETRY.width - 1e-6);
  });
});

describe('the drop and the sink', () => {
  const toolbar = capsuleGeometry(172, 44);
  const button = capsuleGeometry(44, 44);
  const at = (g: typeof toolbar, y: number): GrowthShape => ({ geometry: g, center: { x: 100, y } });
  const menu = (height: number): GrowthShape => ({ geometry: roundedRectGeometry(167, height, 35), center: { x: 100, y: 200 - height / 2 } });

  it('is sized from the source\'s area: a wide toolbar gathers more glass, a round button a drop smaller than itself', () => {
    const drop = (g: typeof toolbar) => growthFrame(at(g, 200), menu(200), { x: 20, y: 222 }, { shrink: 1, grow: 0 }).grown.geometry.width;
    expect(drop(toolbar)).toBeGreaterThan(50);
    expect(drop(toolbar)).toBeLessThan(63);
    expect(drop(button)).toBeLessThan(44);
    expect(drop(toolbar)).toBeGreaterThan(drop(button) * 1.5);
  });

  it('sinks as far past the drop for a tall menu as for a short one: the source\'s size bounds it', () => {
    const sunk = (height: number) => {
      const source = at(toolbar, 222);
      const frame = growthFrame(source, menu(height), { x: 20, y: 222 }, { shrink: 0, grow: 0, rise: -0.15 });
      return Math.hypot(frame.body.center.x - source.center.x, frame.body.center.y - source.center.y);
    };
    expect(sunk(600)).toBeCloseTo(sunk(120), 6);
    expect(sunk(600)).toBeLessThan(0.5 * 44);
  });

  it('merges into the side of the capsule towards the menu while it re-forms, and does not hang out of the other', () => {
    const source = at(toolbar, 222);
    const bottom = (shrink: number) => {
      const frame = growthFrame(source, menu(200), { x: 20, y: 222 }, { shrink, grow: 0.09, height: 0.13, rise: -0.11 });
      return frame.grown.center.y + frame.grown.geometry.height / 2;
    };
    expect(bottom(1)).toBeGreaterThan(bottom(0.05) + 5);
    expect(bottom(0.05)).toBeLessThanOrEqual(source.center.y + 22 + 0.15 * 2.5 * 44);
  });

  it('turns back from the dip without a jump when the menu is opened again', () => {
    const state = createGrowthState();
    for (let i = 0; i < 300; i += 1) stepGrowth(state, 1 / 60, true);
    const source = at(toolbar, 222);
    const target = menu(200);
    const centre = () => growthFrame(source, target, { x: 20, y: 222 }, growthPhase(state)).body.center;
    let dipped = false;
    for (let i = 0; i < 120 && !dipped; i += 1) {
      stepGrowth(state, 1 / 60, false);
      dipped = state.rise.x < -0.02;
    }
    expect(dipped).toBe(true);
    let last = centre();
    let widest = 0;
    for (let i = 0; i < 240; i += 1) {
      stepGrowth(state, 1 / 60, true);
      const now = centre();
      widest = Math.max(widest, Math.hypot(now.x - last.x, now.y - last.y));
      last = now;
    }
    const plain = createGrowthState();
    let before = growthFrame(source, target, { x: 20, y: 222 }, growthPhase(plain)).body.center;
    let fastest = 0;
    for (let i = 0; i < 240; i += 1) {
      stepGrowth(plain, 1 / 60, true);
      const now = growthFrame(source, target, { x: 20, y: 222 }, growthPhase(plain)).body.center;
      fastest = Math.max(fastest, Math.hypot(now.x - before.x, now.y - before.y));
      before = now;
    }
    expect(widest).toBeLessThan(fastest * 1.1);
    expect(last.y).toBeCloseTo(target.center.y, 1);
  });
});

describe('holding a surface part of the way open', () => {
  it('is where the live springs are when the width has got that far', () => {
    const held = growthStateAt({ shrink: 1, grow: 0.5 });
    const live = createGrowthState();
    while (live.grow.x < 0.5) stepGrowth(live, 1 / 240, true);
    expect(growthPhase(held)).toEqual(growthPhase(live));
    expect(held.focus.x).toBeLessThan(0.3);
    expect(held.rise.x).toBeGreaterThan(held.grow.x * 0.8);
  });

  it('is at rest closed and at rest open at the ends', () => {
    expect(growthPhase(growthStateAt({ shrink: 0, grow: 0 }))).toEqual(growthPhase(createGrowthState()));
    expect(growthStateAt({ shrink: 1, grow: 1 }).grow).toEqual({ x: 1, v: 0, target: 1 });
  });
});

describe('the clock of a motion', () => {
  const VSYNC = 1000 / 60;
  const growth = (times: readonly number[]) => {
    const state = createGrowthState();
    const clock = createMotionClock();
    return times.map((now) => {
      stepMotion(clock, now, (dt) => stepGrowth(state, dt, true));
      return growthPhase(state);
    });
  };
  const frames = (n: number, at: (k: number) => number) => Array.from({ length: n }, (_, k) => at(k));

  it('draws the same states whatever the jitter of frame times', () => {
    let seed = 7;
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 1.6;
    const exact = growth(frames(90, (k) => 1000 + k * VSYNC));
    expect(growth(frames(90, (k) => 1000 + k * VSYNC + jitter()))).toEqual(exact);
  });

  it('skips the states of a late frame and draws no others', () => {
    const exact = growth(frames(60, (k) => k * VSYNC));
    const late = growth(frames(60, (k) => k * VSYNC).filter((_, k) => k !== 12 && k !== 13));
    expect(late).toEqual(exact.filter((_, k) => k !== 12 && k !== 13));
  });

  it('starts with a sixtieth of a second and advances at most 50 ms a frame', () => {
    const clock = createMotionClock();
    const count = (now: number) => {
      let n = 0;
      stepMotion(clock, now, () => ((n += 1), true));
      return n;
    };
    expect(count(500) * SPRING_STEP).toBeCloseTo(1 / 60, 9);
    expect(count(500 + VSYNC)).toBe(4);
    expect(count(500 + VSYNC + 400) * SPRING_STEP).toBeCloseTo(0.05, 9);
    expect(count(500 + 2 * VSYNC + 400)).toBe(4);
  });

  it('keeps time at a refresh rate that is not a multiple of its step', () => {
    const clock = createMotionClock();
    let steps = 0;
    for (let k = 0; k <= 144; k += 1) stepMotion(clock, k * (1000 / 144), () => ((steps += 1), true));
    expect(Math.abs(steps * SPRING_STEP - (1 + 1 / 60))).toBeLessThanOrEqual(SPRING_STEP);
  });
});

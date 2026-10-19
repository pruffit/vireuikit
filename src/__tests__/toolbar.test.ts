import { describe, expect, it } from 'vitest';
import {
  BUTTON_SIZES,
  MORE_ID,
  TOOLBAR_GAP,
  TOOLBAR_MORPH_TIMING,
  TOOLBAR_PLACE_TIMING,
  aimToolbarMorph,
  createToolbarMorph,
  currentToolbarFrame,
  stepSpring,
  stepToolbarMorph,
  toolbarGeometry,
  toolbarLayout,
  toolbarLayoutWithHysteresis,
  toolbarMorphFrame,
  toolbarPlaceFrame,
  type MorphBox,
  type ToolbarFrame,
  type ToolbarGeometry,
  type ToolbarItem,
  type ToolbarLayout,
} from '../index';

const ITEMS: ToolbarItem[] = [
  { id: 'share', kind: 'icon', priority: 3 },
  { id: 'like', kind: 'icon', priority: 1, badge: true },
  { id: 'download', kind: 'icon', priority: 1 },
  { id: 'add', kind: 'icon', priority: 2 },
  { id: 'edit', kind: 'text', priority: 0, width: 60 },
  { id: 'done', kind: 'text', primary: true, width: 64 },
];
const SIDE = BUTTON_SIZES.touch.height;
const NECK = 0.35 * SIDE;
const SEPARATE = 4 * SIDE + 60 + 64 + 5 * TOOLBAR_GAP;
const MERGED = 4 * SIDE + 60 + 64 + 2 * TOOLBAR_GAP;

const layoutAt = (available: number, items = ITEMS) => toolbarLayout(items, { available, tier: 'touch' });
const geometryAt = (available: number, items = ITEMS) =>
  toolbarGeometry(layoutAt(available, items), { tier: 'touch', available });
const separate = () => geometryAt(SEPARATE);
const merged = () => geometryAt(MERGED);
const overflow = () => geometryAt(MERGED - 1);

const BOX_KEYS = ['x', 'y', 'width', 'height', 'radius'] as const;
const near = (a: MorphBox, b: MorphBox) => {
  for (const key of BOX_KEYS) expect(a[key]).toBeCloseTo(b[key], 6);
};
const sameFrame = (a: ToolbarFrame, b: ToolbarFrame) => {
  expect(a.shapes.length).toBe(b.shapes.length);
  a.shapes.forEach((s, i) => near(s, b.shapes[i]!));
  expect(Object.keys(a.slots).sort()).toEqual(Object.keys(b.slots).sort());
  for (const id of Object.keys(a.slots)) {
    near(a.slots[id]!.box, b.slots[id]!.box);
    expect(a.slots[id]!.ink).toBeCloseTo(b.slots[id]!.ink, 9);
  }
  expect(a.smoothing).toBeCloseTo(b.smoothing, 9);
  expect(Boolean(a.more)).toBe(Boolean(b.more));
  if (a.more && b.more) {
    near(a.more.box, b.more.box);
    expect(a.more.presence).toBeCloseTo(b.more.presence, 9);
  }
};
const rest = (g: ToolbarGeometry): ToolbarFrame => toolbarMorphFrame(g, g, 0);
const framesTo = (from: ToolbarGeometry, to: ToolbarGeometry, n = 400) =>
  Array.from({ length: n + 1 }, (_, i) => toolbarMorphFrame(from, to, i / n));

describe('toolbar geometry', () => {
  it('draws the separate stage as one capsule per item, a gap apart', () => {
    const g = separate();
    expect(g.capsules.map((c) => c.items)).toEqual([['share'], ['like'], ['download'], ['add'], ['edit'], ['done']]);
    expect(g.capsules[0]!.box).toEqual({ x: 0, y: 0, width: SIDE, height: SIDE, radius: SIDE / 2 });
    expect(g.capsules[1]!.box.x).toBe(SIDE + TOOLBAR_GAP);
    expect(g.extent).toBe(layoutAt(SEPARATE).extent);
    expect(g.slots.edit!.width).toBe(60);
    expect(g.more).toBeNull();
  });

  it('spans a merged capsule over its slots with no padding, slots squares of the tier', () => {
    const g = merged();
    const icons = g.capsules[0]!;
    expect(icons.items).toEqual(['share', 'like', 'download', 'add']);
    expect(icons.box).toEqual({ x: 0, y: 0, width: 4 * SIDE, height: SIDE, radius: SIDE / 2 });
    icons.items.forEach((id, i) => expect(g.slots[id]).toEqual({ x: i * SIDE, y: 0, width: SIDE, height: SIDE, radius: SIDE / 2 }));
    expect(g.extent).toBe(MERGED);
  });

  it('puts "…" after the last capsule and the main action at the trailing end', () => {
    const g = overflow();
    const last = g.capsules.at(-2)!;
    expect(g.more).toEqual({ x: last.box.x + last.box.width + TOOLBAR_GAP, y: 0, width: SIDE, height: SIDE, radius: SIDE / 2 });
    const primary = g.capsules.at(-1)!;
    expect(primary.kind).toBe('primary');
    expect(primary.box.x).toBe(g.more!.x + SIDE + TOOLBAR_GAP);
    expect(g.slots[MORE_ID]).toBeUndefined();
  });

  it('uses measured text widths and shares what is left among the unmeasured', () => {
    const items: ToolbarItem[] = [
      { id: 'a', kind: 'text', width: 100, group: 'g' },
      { id: 'b', kind: 'text', width: 80, group: 'g' },
    ];
    const apart = toolbarLayout(items, { available: 1000, tier: 'touch' });
    const measured = toolbarGeometry(apart, { tier: 'touch', available: 1000, textWidths: { a: 120, b: 90 } });
    expect(measured.slots.a!.width).toBe(120);
    expect(measured.slots.b!.width).toBe(90);
    const joined = toolbarLayout(items, { available: 181, tier: 'touch' });
    expect(joined.capsules.length).toBe(1);
    const g = toolbarGeometry(joined, { tier: 'touch', available: 181 });
    expect(g.slots.a!.width + g.slots.b!.width).toBe(180);
    expect(g.capsules[0]!.box.width).toBe(180);
    const one = toolbarGeometry(joined, { tier: 'touch', available: 181, textWidths: { a: 100 } });
    expect(one.slots.b!.width).toBe(80);
    expect(one.slots.b!.x).toBe(100);
  });

  it('packs from the leading edge, or aligns what follows the spacer to the trailing end', () => {
    const items: ToolbarItem[] = [
      { id: 'list', kind: 'icon', group: 'lead' },
      { id: 'search', kind: 'icon', group: 'trail' },
      { id: 'more', kind: 'icon', group: 'trail' },
    ];
    const layout = toolbarLayout(items, { available: 600, tier: 'touch' });
    const packed = toolbarGeometry(layout, { tier: 'touch', available: 600 });
    expect(packed.slots.list!.x).toBe(0);
    expect(packed.slots.search!.x).toBe(SIDE + TOOLBAR_GAP);
    for (const spacerAfter of ['list', 'lead']) {
      const g = toolbarGeometry(layout, { tier: 'touch', available: 600, spacerAfter, items });
      expect(g.slots.list!.x).toBe(0);
      expect(g.slots.more!.x + g.slots.more!.width).toBe(600);
      expect(g.slots.search!.x).toBe(600 - 2 * SIDE - TOOLBAR_GAP);
    }
    const tight = toolbarGeometry(layout, { tier: 'touch', available: 10, spacerAfter: 'list' });
    expect(tight.slots.search!.x).toBe(SIDE + TOOLBAR_GAP);
  });

  it('stacks a vertical toolbar along y and puts the text row at its foot', () => {
    const layout = toolbarLayout(ITEMS, { available: 400, tier: 'touch', orientation: 'vertical' });
    const g = toolbarGeometry(layout, { tier: 'touch', available: 400, items: ITEMS });
    expect(g.orientation).toBe('vertical');
    expect(g.slots.share).toEqual({ x: 0, y: 0, width: SIDE, height: SIDE, radius: SIDE / 2 });
    expect(g.slots.like!.y).toBe(SIDE + TOOLBAR_GAP);
    expect(g.slots.edit).toBeUndefined();
    expect(g.aside!.slots.edit).toEqual({ x: 0, y: 400 - SIDE, width: 60, height: SIDE, radius: SIDE / 2 });
    expect(g.aside!.slots.done!.x).toBe(60);
    expect(g.aside!.box.width).toBe(60 + 64);
    const cramped = toolbarGeometry(toolbarLayout(ITEMS, { available: 100, tier: 'touch', orientation: 'vertical' }), {
      tier: 'touch',
      available: 100,
    });
    const lastEnd = Math.max(...cramped.capsules.map((c) => c.box.y + c.box.height));
    expect(cramped.aside!.box.y).toBeGreaterThanOrEqual(lastEnd + TOOLBAR_GAP);
  });

  it('keeps every visible slot inside its capsule at every width', () => {
    for (let w = 0; w <= SEPARATE + 20; w += 3) {
      const g = geometryAt(w);
      for (const c of g.capsules) {
        for (const id of c.items) {
          const s = g.slots[id]!;
          expect(s.x).toBeGreaterThanOrEqual(c.box.x - 1e-9);
          expect(s.x + s.width).toBeLessThanOrEqual(c.box.x + c.box.width + 1e-9);
        }
      }
    }
  });
});

describe('toolbar hysteresis', () => {
  const options = (available: number) => ({ available, tier: 'touch' as const });
  const key = (l: ToolbarLayout) => `${l.stage}|${l.overflow.join()}`;
  const MAX = SEPARATE + 20;
  const thresholds = () => {
    const out: number[] = [];
    let last = key(layoutAt(0));
    for (let w = 1; w <= MAX; w++) {
      const k = key(layoutAt(w));
      if (k !== last) out.push(w);
      last = k;
    }
    return out;
  };

  it('is exactly toolbarLayout without a previous layout', () => {
    for (let w = 0; w <= MAX; w++) expect(toolbarLayoutWithHysteresis(ITEMS, options(w), null)).toEqual(layoutAt(w));
  });

  it('changes once per crossing, at the threshold narrowing and 8 dp past it widening', () => {
    const ts = thresholds();
    expect(ts.length).toBeGreaterThanOrEqual(3);
    const sweep = (widths: number[]) => {
      let prev: ToolbarLayout | null = null;
      const changes: number[] = [];
      for (const w of widths) {
        const next = toolbarLayoutWithHysteresis(ITEMS, options(w), prev);
        if (prev && key(next) !== key(prev)) changes.push(w);
        prev = next;
      }
      return changes;
    };
    const up = sweep(Array.from({ length: MAX + 1 }, (_, i) => i));
    const down = sweep(Array.from({ length: MAX + 1 }, (_, i) => MAX - i));
    expect(up).toEqual(ts.map((t) => t + 8));
    expect(down).toEqual(ts.map((t) => t - 1).reverse());
    for (const changes of [up, down]) {
      for (let i = 1; i < changes.length; i++) expect(Math.abs(changes[i]! - changes[i - 1]!)).toBeGreaterThanOrEqual(8);
    }
  });

  it('does not toggle for a width held just across a threshold', () => {
    for (const t of thresholds()) {
      let prev = toolbarLayoutWithHysteresis(ITEMS, options(t + 40), null);
      prev = toolbarLayoutWithHysteresis(ITEMS, options(t - 1), prev);
      const held = key(prev);
      for (const w of [t, t + 3, t - 4, t + 7, t - 1, t + 5]) {
        prev = toolbarLayoutWithHysteresis(ITEMS, options(w), prev);
        expect(key(prev)).toBe(held);
      }
    }
  });
});

describe('toolbar timing', () => {
  const t95 = (timing: { response: number; damping: number }) => {
    const s = { x: 0, v: 0, target: 1 };
    let t = 0;
    while (s.x < 0.95) {
      stepSpring(s, 1 / 240, timing.response, timing.damping);
      t += 1 / 240;
    }
    return t;
  };

  it('is critically damped and passes 95 % at 0.38 s', () => {
    expect(TOOLBAR_MORPH_TIMING.damping).toBe(1);
    expect(Math.abs(t95(TOOLBAR_MORPH_TIMING) - 0.38)).toBeLessThanOrEqual(0.04);
  });

  it('takes about 0.3 s to change place', () => {
    expect(TOOLBAR_PLACE_TIMING.damping).toBe(1);
    expect(Math.abs(t95(TOOLBAR_PLACE_TIMING) - 0.3)).toBeLessThanOrEqual(0.04);
  });

  it('leaves the old toolbar in the first half and brings the new one in the second', () => {
    expect(toolbarPlaceFrame(0)).toEqual({ outgoing: 1, incoming: 0 });
    expect(toolbarPlaceFrame(1)).toEqual({ outgoing: 0, incoming: 1 });
    expect(toolbarPlaceFrame(0.5)).toEqual({ outgoing: 0, incoming: 0 });
    for (let i = 0; i <= 100; i++) {
      const f = toolbarPlaceFrame(i / 100);
      if (i < 50) expect(f.incoming).toBe(0);
      if (i > 50) expect(f.outgoing).toBe(0);
    }
    expect(toolbarPlaceFrame(-1)).toEqual({ outgoing: 1, incoming: 0 });
    expect(toolbarPlaceFrame(2)).toEqual({ outgoing: 0, incoming: 1 });
  });
});

describe('toolbar merge frames', () => {
  const a = separate();
  const b = merged();
  const joinedAt = (frames: ToolbarFrame[]) => frames.findIndex((f) => f.shapes.length === b.capsules.length);

  it('is the start at 0 and the end at 1, with no neck and no zero-size shape left over', () => {
    sameFrame(toolbarMorphFrame(a, b, 0), rest(a));
    const end = toolbarMorphFrame(a, b, 1);
    sameFrame(end, rest(b));
    expect(end.smoothing).toBe(0);
    expect(end.shapes.length).toBe(b.capsules.length);
    for (const f of framesTo(a, b, 50)) for (const s of f.shapes) expect(s.width * s.height).toBeGreaterThan(0);
  });

  it('keeps both shapes until they touch, then one, and the neck peaks at contact', () => {
    const frames = framesTo(a, b);
    const first = joinedAt(frames);
    expect(first).toBeGreaterThan(0);
    for (const f of frames.slice(0, first)) expect(f.shapes.length).toBe(a.capsules.length);
    for (const f of frames.slice(first)) expect(f.shapes.length).toBe(b.capsules.length);
    expect(first / 400).toBeGreaterThan(0.5);
    expect(first / 400).toBeLessThan(0.9);
    expect(Math.max(...frames.map((f) => f.smoothing))).toBeCloseTo(NECK, 2);
    expect(frames[first]!.smoothing).toBeCloseTo(NECK, 1);
    expect(frames[0]!.smoothing).toBe(0);
    expect(frames.at(-1)!.smoothing).toBe(0);
    for (let i = 1; i <= first; i++) expect(frames[i]!.smoothing).toBeGreaterThanOrEqual(frames[i - 1]!.smoothing - 1e-9);
    for (let i = first + 1; i < frames.length; i++) expect(frames[i]!.smoothing).toBeLessThanOrEqual(frames[i - 1]!.smoothing + 1e-9);
  });

  it('closes the gap between facing edges monotonically down to touching', () => {
    const frames = framesTo(a, b);
    let previous = Infinity;
    for (const f of frames.slice(0, joinedAt(frames))) {
      const gap = f.shapes[1]!.x - (f.shapes[0]!.x + f.shapes[0]!.width);
      expect(gap).toBeLessThanOrEqual(previous + 1e-9);
      expect(gap).toBeGreaterThanOrEqual(-1e-9);
      previous = gap;
    }
    expect(previous).toBeLessThan(0.2);
  });

  it('runs the same frames backwards when splitting', () => {
    for (const t of [0.05, 0.2, 0.5, 0.69, 0.71, 0.9]) sameFrame(toolbarMorphFrame(b, a, 1 - t), toolbarMorphFrame(a, b, t));
  });

  it('moves a glyph continuously, by at most the gaps that close, and never past a neighbour', () => {
    const order = ['share', 'like', 'download', 'add', 'edit', 'done'];
    const indexIn = (g: ToolbarGeometry, id: string) => g.capsules.findIndex((c) => c.items.includes(id));
    const frames = framesTo(a, b, 1000);
    for (const id of order) {
      const allowed = (indexIn(a, id) - indexIn(b, id)) * TOOLBAR_GAP;
      expect(a.slots[id]!.x - b.slots[id]!.x).toBeCloseTo(allowed, 9);
      frames.forEach((f, i) => {
        const x = f.slots[id]!.box.x;
        expect(a.slots[id]!.x - x).toBeLessThanOrEqual(allowed + 1e-9);
        expect(a.slots[id]!.x - x).toBeGreaterThanOrEqual(-1e-9);
        if (i) expect(Math.abs(x - frames[i - 1]!.slots[id]!.box.x)).toBeLessThan(0.1);
        expect(f.slots[id]!.ink).toBe(1);
      });
    }
    for (const f of frames) {
      for (let i = 1; i < order.length; i++) {
        const prev = f.slots[order[i - 1]!]!.box;
        expect(f.slots[order[i]!]!.box.x).toBeGreaterThanOrEqual(prev.x + prev.width - 1e-9);
      }
    }
  });
});

describe('toolbar overflow frames', () => {
  const a = merged();
  const b = overflow();
  const leaving = Object.keys(a.slots).filter((id) => !(id in b.slots));

  it('has something leaving', () => {
    expect(leaving.length).toBeGreaterThan(0);
    expect(b.more).not.toBeNull();
  });

  it('is the start at 0 and the end at 1', () => {
    sameFrame(toolbarMorphFrame(a, b, 0), rest(a));
    const end = toolbarMorphFrame(a, b, 1);
    sameFrame(end, rest(b));
    expect(end.smoothing).toBe(0);
    expect(end.more!.presence).toBe(1);
    for (const f of framesTo(a, b, 100)) for (const s of f.shapes) expect(s.width * s.height).toBeGreaterThan(0);
  });

  it('shrinks the leaving slot into its capsule, its ink gone by 40 %', () => {
    const id = leaving[0]!;
    const frames = framesTo(a, b, 100);
    let width = a.slots[id]!.width;
    for (const [i, f] of frames.entries()) {
      const slot = f.slots[id];
      if (!slot) continue;
      expect(slot.box.width).toBeLessThanOrEqual(width + 1e-9);
      width = slot.box.width;
      if (i >= 40) expect(slot.ink).toBe(0);
      if (i === 0) expect(slot.ink).toBe(1);
      const capsule = f.capsules.find((c) => c.items.includes(id))!;
      expect(slot.box.x).toBeGreaterThanOrEqual(capsule.box.x - 1e-9);
      expect(slot.box.x + slot.box.width).toBeLessThanOrEqual(capsule.box.x + capsule.box.width + 1e-9);
    }
    expect(frames.at(-1)!.slots[id]).toBeUndefined();
    for (const f of frames) for (const stay of Object.keys(b.slots)) expect(f.slots[stay]!.ink).toBe(1);
  });

  it('contracts the capsule and buds "…" out of its trailing end', () => {
    const frames = framesTo(a, b, 200);
    const widths = frames.map((f) => f.capsules[0]!.box.width);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThanOrEqual(widths[i - 1]! + 1e-9);
    expect(frames[0]!.more).toBeNull();
    const early = frames.find((f) => f.more)!;
    expect(early.more!.box.width).toBeLessThan(SIDE / 2);
    const capsule = early.capsules.filter((c) => c.kind !== 'primary').at(-1)!.box;
    const cx = early.more!.box.x + early.more!.box.width / 2;
    expect(cx).toBeLessThanOrEqual(capsule.x + capsule.width + 1);
    expect(cx).toBeGreaterThanOrEqual(capsule.x + capsule.width - SIDE);
    const presences = frames.filter((f) => f.more).map((f) => f.more!.presence);
    for (let i = 1; i < presences.length; i++) expect(presences[i]!).toBeGreaterThanOrEqual(presences[i - 1]! - 1e-9);
    expect(presences.at(-1)).toBe(1);
    const smoothings = frames.map((f) => f.smoothing);
    expect(Math.max(...smoothings)).toBeGreaterThan(0);
    expect(Math.max(...smoothings)).toBeLessThanOrEqual(NECK + 1e-9);
    expect(smoothings.at(-1)).toBe(0);
    expect(frames.at(-1)!.more!.box).toEqual(b.more);
  });

  it('is the same path backwards when the overflow returns', () => {
    for (const t of [0.1, 0.3, 0.6, 0.85]) sameFrame(toolbarMorphFrame(b, a, 1 - t), toolbarMorphFrame(a, b, t));
    sameFrame(toolbarMorphFrame(b, a, 1), rest(a));
  });

  it('never crosses items and keeps stayers within the distance they travel', () => {
    const order = ['share', 'like', 'download', 'add', 'edit', 'done'];
    for (const f of framesTo(a, b, 300)) {
      const present = order.filter((id) => f.slots[id]);
      for (let i = 1; i < present.length; i++) {
        const prev = f.slots[present[i - 1]!]!.box;
        expect(f.slots[present[i]!]!.box.x).toBeGreaterThanOrEqual(prev.x + prev.width - 1e-9);
      }
      for (const id of Object.keys(b.slots)) {
        const lo = Math.min(a.slots[id]!.x, b.slots[id]!.x);
        const hi = Math.max(a.slots[id]!.x, b.slots[id]!.x);
        expect(f.slots[id]!.box.x).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(f.slots[id]!.box.x).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it('runs a jump from separate to overflow in one path', () => {
    const wide = separate();
    sameFrame(toolbarMorphFrame(wide, b, 1), rest(b));
    const frames = framesTo(wide, b, 200);
    for (const f of frames) for (const s of f.shapes) expect(s.width * s.height).toBeGreaterThan(0);
    expect(Math.max(...frames.map((f) => f.smoothing))).toBeGreaterThan(0);
  });

  it('works along y in a vertical strip', () => {
    const g = (w: number) =>
      toolbarGeometry(toolbarLayout(ITEMS, { available: w, tier: 'touch', orientation: 'vertical' }), { tier: 'touch', available: w });
    const tall = g(4 * SIDE + 3 * TOOLBAR_GAP + 40);
    const short = g(3 * SIDE + 2 * TOOLBAR_GAP + 20);
    expect(tall.capsules.length).not.toBe(short.capsules.length);
    for (const f of framesTo(tall, short, 50)) {
      for (const s of f.shapes) expect(s.width * s.height).toBeGreaterThan(0);
      for (const slot of Object.values(f.slots)) expect(slot.box.x).toBe(0);
    }
    sameFrame(toolbarMorphFrame(tall, short, 1), rest(short));
  });
});

describe('toolbar morph state', () => {
  const drive = (state: ReturnType<typeof createToolbarMorph>, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) stepToolbarMorph(state, 1 / 60);
  };

  it('starts at rest, goes to the target and rests there', () => {
    const state = createToolbarMorph(separate());
    sameFrame(currentToolbarFrame(state), rest(separate()));
    expect(stepToolbarMorph(state, 1 / 60)).toBe(false);
    aimToolbarMorph(state, merged());
    expect(stepToolbarMorph(state, 1 / 60)).toBe(true);
    drive(state, 3);
    expect(stepToolbarMorph(state, 1 / 60)).toBe(false);
    sameFrame(currentToolbarFrame(state), rest(merged()));
  });

  it('lands in one step under reduced motion', () => {
    const state = createToolbarMorph(separate());
    aimToolbarMorph(state, overflow());
    expect(stepToolbarMorph(state, 1 / 60, true)).toBe(true);
    sameFrame(currentToolbarFrame(state), rest(overflow()));
    expect(stepToolbarMorph(state, 1 / 60, true)).toBe(false);
  });

  it('turns back from where it is when aimed at the start again', () => {
    const state = createToolbarMorph(separate());
    aimToolbarMorph(state, merged());
    for (let i = 0; i < 8; i++) stepToolbarMorph(state, 1 / 60);
    const before = currentToolbarFrame(state);
    aimToolbarMorph(state, separate());
    sameFrame(currentToolbarFrame(state), before);
    drive(state, 3);
    sameFrame(currentToolbarFrame(state), rest(separate()));
  });

  it('rebases a new target from the current frame without a jump', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const width = () => Math.floor(random() * 460);
    for (let run = 0; run < 40; run++) {
      const state = createToolbarMorph(geometryAt(width()));
      for (let aim = 0; aim < 12; aim++) {
        const steps = Math.floor(random() * 26);
        for (let i = 0; i < steps; i++) stepToolbarMorph(state, 1 / 60);
        const before = currentToolbarFrame(state);
        aimToolbarMorph(state, geometryAt(width()));
        const after = currentToolbarFrame(state);
        for (const id of Object.keys(before.slots)) {
          const x = before.slots[id]!.box;
          const y = after.slots[id]?.box;
          if (y) for (const key of BOX_KEYS) expect(Math.abs(x[key] - y[key])).toBeLessThan(0.5);
        }
        expect(after.shapes.length).toBe(before.shapes.length);
        after.shapes.forEach((s, i) => {
          for (const key of BOX_KEYS) expect(Math.abs(before.shapes[i]![key] - s[key])).toBeLessThan(0.5);
        });
        expect(after.smoothing).toBeCloseTo(before.smoothing, 9);
      }
      drive(state, 3);
      expect(stepToolbarMorph(state, 1 / 60)).toBe(false);
    }
  });

  it('settles every path on its last target with no shape left over', () => {
    const all = [separate(), merged(), overflow(), geometryAt(0), geometryAt(SEPARATE + 30), geometryAt(MERGED + 10)];
    for (const from of all) {
      for (const to of all) {
        for (const last of all) {
          const state = createToolbarMorph(from);
          aimToolbarMorph(state, to);
          for (let i = 0; i < 6; i++) stepToolbarMorph(state, 1 / 60);
          aimToolbarMorph(state, last);
          drive(state, 3);
          const end = currentToolbarFrame(state);
          expect(end.smoothing).toBe(0);
          for (const s of end.shapes) expect(s.width * s.height).toBeGreaterThan(0);
          expect(Object.keys(end.slots).sort()).toEqual(Object.keys(last.slots).sort());
        }
      }
    }
  });
});

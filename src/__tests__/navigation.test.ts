import { describe, expect, it } from 'vitest';
import {
  MINIMIZE_THRESHOLD,
  NAV_MINIMIZE_TIMING,
  NAV_MORPH_TIMING,
  NAV_SIZES,
  FORM_MORPH_TIMING,
  INPUT_POINTER,
  adaptiveContext,
  fixedNavigationForm,
  navigationForm,
  aimNavMorph,
  cancelNavDrag,
  createMinimize,
  createNavDrag,
  createNavMorph,
  currentNavFrame,
  expandMinimize,
  moveNavDrag,
  navDragFrame,
  navLayout,
  navMorphFrame,
  pressNavDrag,
  releaseNavDrag,
  stepMinimize,
  stepNavDrag,
  stepNavMorph,
  stepSpring,
  type MorphBox,
  type NavLayout,
  type NavLayoutInput,
  type NavMorphFrame,
  type NavMorphState,
  type SearchForm,
} from '../index';

const BUTTON: SearchForm = { form: 'button', place: 'bar', shortcut: false };
const ITEM: SearchForm = { form: 'item', place: 'rail', shortcut: false };
const FIELD: SearchForm = { form: 'field', place: 'sidebar', shortcut: true };

const base: NavLayoutInput = {
  form: 'bar',
  window: { width: 430, height: 932 },
  items: 4,
  secondary: 0,
  search: BUTTON,
  selected: 1,
  tier: 'touch',
  toggle: false,
};

const bar = (over: Partial<NavLayoutInput> = {}) => navLayout({ ...base, ...over });
const rail = (over: Partial<NavLayoutInput> = {}) => navLayout({ ...base, form: 'rail', window: { width: 800, height: 900 }, search: ITEM, toggle: true, ...over });
const sidebar = (over: Partial<NavLayoutInput> = {}) =>
  navLayout({ ...base, form: 'sidebar', window: { width: 1300, height: 900 }, search: FIELD, secondary: 3, toggle: true, tier: 'pointer', ...over });

const area = (b: MorphBox) => b.width * b.height;
const near = (a: MorphBox, b: MorphBox, tol = 1e-6) => {
  for (const key of ['x', 'y', 'width', 'height', 'radius'] as const) expect(Math.abs(a[key] - b[key]), key).toBeLessThanOrEqual(tol);
};
const inflated = (b: MorphBox): MorphBox => {
  const d = NAV_SIZES.lens.inflate;
  return { x: b.x - d, y: b.y - d, width: b.width + 2 * d, height: b.height + 2 * d, radius: b.radius + d };
};

describe('navLayout: the bar', () => {
  it('is a capsule centred at the bottom with its search circle as a group', () => {
    const l = bar();
    expect(l.body).toMatchObject({ width: 4 * 74 + 6, height: 56, radius: 28 });
    expect(l.body.y + l.body.height).toBe(932 - 16);
    expect(l.search).toMatchObject({ width: 56, height: 56, y: l.body.y });
    expect(l.search!.x - (l.body.x + l.body.width)).toBe(8);
    const left = l.body.x;
    const right = 430 - (l.search!.x + l.search!.width);
    expect(left).toBeCloseTo(right, 6);
  });

  it('has 74 dp items 3 dp inside the body and a pill on the selected cell', () => {
    const l = bar();
    expect(l.items).toHaveLength(4);
    expect(l.items[0]).toMatchObject({ x: l.body.x + 3, y: l.body.y + 3, width: 74, height: 50 });
    expect(l.items[2]!.x - l.items[1]!.x).toBe(74);
    expect(l.pill).toEqual(l.items[1]);
    expect(l.pill!.radius).toBe(25);
  });

  it('narrows its items to fit, never under 44 dp, and stays on screen', () => {
    const narrow = bar({ window: { width: 360, height: 700 } });
    expect(narrow.items[0]!.width).toBeCloseTo((360 - 32 - 64 - 6) / 4, 6);
    const tiny = bar({ window: { width: 200, height: 700 }, items: 5 });
    expect(tiny.items[0]!.width).toBe(44);
    expect(tiny.body.x).toBeGreaterThanOrEqual(0);
    expect(tiny.body.width).toBe(5 * 44 + 6);
  });

  it('lifts above the safe area and has no search circle without a button', () => {
    const l = bar({ bottomInset: 34, search: null });
    expect(l.body.y + l.body.height).toBe(932 - 34);
    expect(l.search).toBeNull();
    expect(l.body.x + l.body.width / 2).toBeCloseTo(215, 6);
    expect(l.insets).toEqual({ bottom: 932 - l.body.y, start: 0 });
  });

  it('has no pill for no selection or a secondary one', () => {
    expect(bar({ selected: -1 }).pill).toBeNull();
    expect(bar({ selected: 9 }).pill).toBeNull();
  });

  it('puts the accessory over the bar and its search and raises the inset', () => {
    const l = bar({ accessory: true });
    expect(l.accessoryPlacement).toBe('above-bar');
    expect(l.accessory).toMatchObject({ x: l.body.x, height: 48 });
    expect(l.accessory!.width).toBe(l.body.width + 8 + 56);
    expect(l.accessory!.y + l.accessory!.height).toBe(l.body.y - 8);
    expect(l.insets.bottom).toBe(932 - l.body.y + 56);
    expect(bar().accessory).toBeNull();
    expect(bar().accessoryPlacement).toBeNull();
  });
});

describe('navLayout: the minimised bar', () => {
  it('is a 44 dp circle at the margin on the full bar centre line, every item on it', () => {
    const full = bar();
    const l = bar({ minimized: true });
    const centre = full.body.y + full.body.height / 2;
    expect(l.body).toEqual({ x: 16, y: centre - 22, width: 44, height: 44, radius: 22 });
    for (const item of l.items) expect(item).toEqual(l.body);
    expect(l.pill).toEqual(l.body);
    expect(l.search).toEqual({ x: 430 - 16 - 44, y: l.body.y, width: 44, height: 44, radius: 22 });
  });

  it('puts the accessory in the bar row between the circles', () => {
    const l = bar({ minimized: true, accessory: true });
    expect(l.accessoryPlacement).toBe('in-bar');
    expect(l.accessory).toMatchObject({ x: 16 + 44 + 8, height: 44, y: l.body.y });
    expect(l.accessory!.x + l.accessory!.width).toBe(l.search!.x - 8);
  });

  it('is ignored on the other forms', () => {
    expect(rail({ minimized: true }).minimized).toBe(false);
    expect(sidebar({ minimized: true }).minimized).toBe(false);
  });
});

describe('navLayout: the rail', () => {
  it('is a vertical capsule at the leading edge (radius 24 + 4 around the item)', () => {
    const l = rail({ items: 4 });
    expect(l.body).toMatchObject({ x: 8, y: 8, width: 80, radius: 28 });
    expect(l.body.height).toBe(16 + 48 + 5 * 56 + 4 * 4);
    expect(l.items[0]).toMatchObject({ x: 16, y: 8 + 8 + 48, width: 64, height: 56 });
    expect(l.items[1]!.y - l.items[0]!.y).toBe(60);
    expect(l.search).toMatchObject({ y: l.items[3]!.y + 60, width: 64 });
    expect(l.insets.start).toBe(8 + 80 + 8);
  });

  it('insets the pill by 3 dp', () => {
    const l = rail({ selected: 2 });
    const cell = l.items[2]!;
    expect(l.pill).toEqual({ x: cell.x + 3, y: cell.y + 3, width: 58, height: 50, radius: 25 });
  });

  it('drops the head without a toggle and the search item without a search', () => {
    const l = rail({ toggle: false, search: null, items: 3 });
    expect(l.body.height).toBe(16 + 3 * 56 + 2 * 4);
    expect(l.search).toBeNull();
    expect(l.items[0]!.y).toBe(16);
  });

  it('shows no secondary rows', () => {
    expect(rail({ secondary: 4 }).items).toHaveLength(4);
  });

  it('puts the accessory along the bottom of the content and raises the inset', () => {
    const l = rail({ accessory: true });
    expect(l.accessoryPlacement).toBe('content-bottom');
    expect(l.accessory).toMatchObject({ x: l.insets.start, height: 56 });
    expect(l.accessory!.width).toBe(800 - l.insets.start - 8);
    expect(l.accessory!.y + l.accessory!.height).toBe(900 - 8);
    expect(l.insets.bottom).toBe(8 + 56);
    expect(rail({ accessory: true, bottomInset: 34 }).accessory!.y + 56).toBe(900 - 34);
  });
});

describe('navLayout: the sidebar', () => {
  it('is a 280 dp inset panel the height of the window less its margins', () => {
    const l = sidebar();
    expect(l.body).toEqual({ x: 8, y: 8, width: 280, height: 884, radius: 24 });
    expect(l.insets.start).toBe(8 + 280 + 8);
  });

  it('lays the search field under the head, then primary, a separator and the secondary', () => {
    const l = sidebar();
    const top = 8 + 8 + 48;
    expect(l.search).toMatchObject({ x: 16, y: top, width: 264, height: 36 });
    expect(l.items[0]!.y).toBe(top + 36);
    expect(l.items[4]!.y).toBe(l.items[3]!.y + 36 + 12);
    expect(l.items).toHaveLength(7);
    expect(l.pill).toEqual(l.items[1]);
    expect(l.pill!.radius).toBe(18);
  });

  it('takes the row height from the tier', () => {
    expect(sidebar({ tier: 'touch' }).items[0]!.height).toBe(44);
    expect(sidebar({ tier: 'pointer' }).items[0]!.height).toBe(36);
  });

  it('selects among the secondary rows too', () => {
    const l = sidebar({ selected: 5 });
    expect(l.pill).toEqual(l.items[5]);
  });

  it('lays out rows past the body when there are many', () => {
    const l = sidebar({ items: 5, secondary: 20, window: { width: 1300, height: 600 } });
    const last = l.items[l.items.length - 1]!;
    expect(last.y + last.height).toBeGreaterThan(l.body.y + l.body.height);
  });

  it('puts the accessory along the bottom of the content', () => {
    const l = sidebar({ accessory: true });
    expect(l.accessory).toMatchObject({ x: 296, height: 56 });
    expect(l.insets.bottom).toBe(64);
  });
});

const barA = bar({ selected: 1 });
const railB = navLayout({ ...base, form: 'rail', window: { width: 700, height: 900 }, search: ITEM, toggle: true, selected: 2 });
const sideC = navLayout({ ...base, form: 'sidebar', window: { width: 1300, height: 900 }, search: FIELD, secondary: 3, toggle: true, tier: 'pointer', selected: 3 });
const minBar = bar({ minimized: true });

describe('the form morph', () => {
  it('rests on each end', () => {
    const a = navMorphFrame(barA, railB, 0);
    near(a.body, barA.body);
    expect(a).toMatchObject({ phase: 'rest', lens: null, ink: { outgoing: 1, incoming: 0 }, showing: 'from' });
    expect(a.second).toEqual({ box: barA.search, smoothing: 0 });
    const b = navMorphFrame(barA, railB, 1);
    near(b.body, railB.body);
    expect(b).toMatchObject({ phase: 'rest', lens: null, ink: { outgoing: 0, incoming: 1 }, showing: 'to' });
    expect(b.second).toBeNull();
  });

  it('lifts the lens from the pill to the pill inflated', () => {
    const f = navMorphFrame(barA, railB, 0.12);
    near(f.lens!.box, inflated(barA.pill!));
    expect(f.lens!.lift).toBe(1);
    const early = navMorphFrame(barA, railB, 0.02);
    expect(early.lens!.lift).toBeGreaterThan(0);
    expect(early.lens!.lift).toBeLessThan(0.1);
    expect(early.phase).toBe('lift');
  });

  it('contracts the body into the lens before the lens travels', () => {
    const f = navMorphFrame(barA, railB, 0.38);
    near(f.body, f.lens!.box, 1e-6);
    expect(f.phase).toBe('travel');
    expect(navMorphFrame(barA, railB, 0.2).phase).toBe('contract');
  });

  it('is the lens at the middle of travel: the body is at most 1.1 x its area', () => {
    for (const to of [railB, sideC]) {
      const f = navMorphFrame(barA, to, 0.46);
      expect(area(f.body)).toBeLessThanOrEqual(1.1 * area(f.lens!.box));
    }
    const mid = navMorphFrame(barA, railB, 0.46);
    const a = inflated(barA.pill!);
    const b = inflated(railB.pill!);
    expect(mid.lens!.box.x).toBeGreaterThan(Math.min(a.x, b.x));
    expect(mid.lens!.box.x).toBeLessThan(Math.max(a.x, b.x));
  });

  it('travels from the lifted old pill to the lifted new one', () => {
    near(navMorphFrame(barA, railB, 0.36).lens!.box, inflated(barA.pill!), 1e-6);
    near(navMorphFrame(barA, railB, 0.56).lens!.box, inflated(railB.pill!), 1e-6);
  });

  it('grows the new body out of the lens and settles the lens into the pill', () => {
    const g = navMorphFrame(barA, railB, 0.56);
    expect(area(g.body)).toBeLessThan(area(railB.body));
    const s = navMorphFrame(barA, railB, 0.86);
    near(s.body, railB.body, 1e-6);
    expect(s.phase).toBe('settle');
    expect(navMorphFrame(barA, railB, 0.82).lens!.lift).toBeCloseTo(1, 6);
    expect(navMorphFrame(barA, railB, 0.99).lens!.lift).toBeLessThan(0.01);
    expect(navMorphFrame(barA, railB, 0.999).lens).not.toBeNull();
    expect(navMorphFrame(barA, railB, 1).lens).toBeNull();
  });

  it('never has the lens vanish between the ends', () => {
    for (let i = 1; i < 100; i += 1) expect(navMorphFrame(barA, sideC, i / 100).lens).not.toBeNull();
  });

  it('moves the body continuously: no step covers 40 % of the change', () => {
    for (const [a, b] of [[barA, railB], [railB, sideC], [sideC, barA], [barA, sideC]] as const) {
      let prev = navMorphFrame(a, b, 0).body;
      const span = Math.max(Math.abs(a.body.x - b.body.x), Math.abs(a.body.y - b.body.y), Math.abs(a.body.width - b.body.width), Math.abs(a.body.height - b.body.height));
      for (let i = 1; i <= 200; i += 1) {
        const body = navMorphFrame(a, b, i / 200).body;
        const step = Math.max(Math.abs(body.x - prev.x), Math.abs(body.y - prev.y), Math.abs(body.width - prev.width), Math.abs(body.height - prev.height));
        expect(step).toBeLessThan(0.4 * span);
        prev = body;
      }
    }
  });

  it('defocuses the old content before the middle and focuses the new after it', () => {
    const ink = (t: number) => navMorphFrame(barA, railB, t).ink;
    expect(ink(0.05).outgoing).toBe(1);
    expect(ink(0.08).outgoing).toBe(1);
    expect(ink(0.28).outgoing).toBe(0);
    expect(ink(0.18).outgoing).toBeGreaterThan(0);
    expect(ink(0.18).outgoing).toBeLessThan(1);
    expect(ink(0.62).incoming).toBe(0);
    expect(ink(0.86).incoming).toBe(1);
    const mid = ink(0.46);
    expect(mid).toEqual({ outgoing: 0, incoming: 0 });
    for (let i = 0; i <= 100; i += 1) {
      const f = ink(i / 100);
      expect(f.outgoing * f.incoming).toBe(0);
    }
    expect(navMorphFrame(barA, railB, 0.45).showing).toBe('from');
    expect(navMorphFrame(barA, railB, 0.46).showing).toBe('to');
  });

  it('merges the bar search circle into the contracting body', () => {
    let last = 0;
    for (const t of [0.1, 0.2, 0.3, 0.37]) {
      const f = navMorphFrame(barA, railB, t);
      expect(f.second!.smoothing).toBeGreaterThan(last);
      last = f.second!.smoothing;
    }
    const f = navMorphFrame(barA, railB, 0.3);
    expect(f.second!.box.width).toBeLessThan(barA.search!.width);
    expect(navMorphFrame(barA, railB, 0.38).second).toBeNull();
    expect(navMorphFrame(barA, railB, 0.45).second).toBeNull();
  });

  it('buds the new search circle off the growing body and parts with smoothing 0', () => {
    const toBar = barA;
    const frames = [0.53, 0.6, 0.7, 0.8].map((t) => navMorphFrame(railB, toBar, t));
    let previous = Infinity;
    for (const f of frames) {
      expect(f.second).not.toBeNull();
      expect(f.second!.smoothing).toBeLessThan(previous);
      previous = f.second!.smoothing;
    }
    expect(frames[0]!.second!.box.width).toBeLessThan(20);
    const end = navMorphFrame(railB, toBar, 0.86);
    expect(end.second!.smoothing).toBe(0);
    near(end.second!.box, toBar.search!, 1e-6);
    expect(navMorphFrame(railB, toBar, 0.99).second!.smoothing).toBe(0);
  });

  it('has no second shape between forms that keep search inside the body', () => {
    for (let i = 0; i <= 20; i += 1) expect(navMorphFrame(railB, sideC, i / 20).second).toBeNull();
  });

  it('stands a 44 dp pill in for no selection', () => {
    const none = rail({ selected: -1 });
    const f = navMorphFrame(barA, none, 0.56);
    expect(f.lens!.box.width).toBe(44 + 12);
  });
});

describe('the contraction to the minimised bar', () => {
  it('mixes the body directly and moves the search circle as a separate shape', () => {
    const f = navMorphFrame(barA, minBar, 0.5, 'contract');
    near(f.body, { x: (barA.body.x + 16) / 2, y: (barA.body.y + minBar.body.y) / 2, width: (barA.body.width + 44) / 2, height: 50, radius: 25 });
    expect(f.lens).toBeNull();
    expect(f.second!.smoothing).toBe(0);
    expect(f.second!.box.width).toBeCloseTo(50, 6);
    for (const t of [0, 0.3, 0.7, 1]) expect(navMorphFrame(barA, minBar, t, 'contract').second!.smoothing).toBe(0);
  });

  it('defocuses over the first 45 % and focuses from 55 %', () => {
    const ink = (t: number) => navMorphFrame(barA, minBar, t, 'contract').ink;
    expect(ink(0.45).outgoing).toBe(0);
    expect(ink(0.55).incoming).toBe(0);
    expect(ink(0.99).incoming).toBeGreaterThan(0.99);
  });

  it('runs on the form morph timing', () => {
    expect(NAV_MINIMIZE_TIMING).toBe(FORM_MORPH_TIMING);
  });
});

function drive(state: NavMorphState, seconds: number, dt = 1 / 120): void {
  for (let t = 0; t < seconds; t += dt) stepNavMorph(state, dt);
}

describe('the morph state', () => {
  it('passes 95 % of the change at 0.8 s', () => {
    const s = { x: 0, v: 0, target: 1 };
    let t = 0;
    const dt = 1 / 240;
    while (s.x < 0.95) {
      stepSpring(s, dt, NAV_MORPH_TIMING.response, NAV_MORPH_TIMING.damping);
      t += dt;
    }
    expect(Math.abs(t - 0.8)).toBeLessThanOrEqual(0.05);
    expect(NAV_MORPH_TIMING.damping).toBe(1);
  });

  it('starts from rest and lands on the new form', () => {
    const state = createNavMorph(barA);
    near(currentNavFrame(state).body, barA.body);
    aimNavMorph(state, railB);
    expect(stepNavMorph(state, 1 / 60)).toBe(true);
    expect(currentNavFrame(state).lens).not.toBeNull();
    drive(state, 3);
    expect(stepNavMorph(state, 1 / 60)).toBe(false);
    near(currentNavFrame(state).body, railB.body);
    expect(currentNavFrame(state).phase).toBe('rest');
  });

  it('turns back from where it is, retracing the frames', () => {
    const state = createNavMorph(barA);
    aimNavMorph(state, railB);
    drive(state, 0.3);
    const x = state.t.x;
    const before = currentNavFrame(state);
    aimNavMorph(state, barA);
    near(currentNavFrame(state).body, before.body, 1e-9);
    expect(state.t.target).toBe(0);
    drive(state, 3);
    expect(state.t.x).toBe(0);
    near(currentNavFrame(state).body, barA.body);
    expect(x).toBeGreaterThan(0.1);
    expect(currentNavFrame(state).lens).toBeNull();
  });

  it('lands in one step under reduced motion', () => {
    const state = createNavMorph(barA);
    aimNavMorph(state, railB);
    expect(stepNavMorph(state, 1 / 60, true)).toBe(true);
    near(currentNavFrame(state).body, railB.body);
    expect(stepNavMorph(state, 1 / 60, true)).toBe(false);
  });

  it('starts the next morph from the resting form and swaps a same-form layout at rest', () => {
    const state = createNavMorph(barA);
    aimNavMorph(state, railB);
    drive(state, 3);
    aimNavMorph(state, sideC);
    expect(state.from).toBe(railB);
    expect(state.t.x).toBe(0);
    drive(state, 3);
    aimNavMorph(state, sideC);
    expect(state.to).toBe(sideC);
  });

  it('swaps the target for a third form before the lens travels', () => {
    const state = createNavMorph(barA);
    aimNavMorph(state, railB);
    drive(state, 0.2);
    expect(state.t.x).toBeLessThan(0.36);
    aimNavMorph(state, sideC);
    expect(state.pivot).toBeNull();
    expect(state.to).toBe(sideC);
    drive(state, 3);
    near(currentNavFrame(state).body, sideC.body);
  });

  it('freezes the lens as a pivot for a third form mid-travel and heads to the new pill', () => {
    const state = createNavMorph(barA);
    aimNavMorph(state, railB);
    for (let i = 0; i < 500 && state.t.x < 0.44; i += 1) stepNavMorph(state, 1 / 240);
    expect(state.t.x).toBeGreaterThanOrEqual(0.36);
    expect(state.t.x).toBeLessThan(0.52);
    aimNavMorph(state, sideC);
    expect(state.pivot).not.toBeNull();
    for (let i = 0; i < 60; i += 1) {
      const f = currentNavFrame(state);
      if (state.t.x < 0.52) expect(area(f.body)).toBeLessThanOrEqual(1.1 * area(f.lens!.box));
      stepNavMorph(state, 1 / 120);
    }
    drive(state, 3);
    near(currentNavFrame(state).body, sideC.body);
    expect(state.pivot).toBeNull();
  });

  it('rebases from the current frame for a third form once it grows', () => {
    const state = createNavMorph(barA);
    aimNavMorph(state, railB);
    for (let i = 0; i < 1000 && state.t.x < 0.7; i += 1) stepNavMorph(state, 1 / 240);
    const before = currentNavFrame(state);
    expect(before.phase).toBe('grow');
    aimNavMorph(state, sideC);
    expect(state.t.x).toBe(0);
    const after = currentNavFrame(state);
    near(after.body, before.body, 1e-9);
    near(after.lens!.box, before.lens!.box, 1e-9);
    expect(after.ink.outgoing).toBeCloseTo(Math.max(before.ink.outgoing, before.ink.incoming), 9);
    expect(after.showing).toBe('from');
    stepNavMorph(state, 0.1);
    expect(currentNavFrame(state).lens).not.toBeNull();
    drive(state, 3);
    near(currentNavFrame(state).body, sideC.body);
    expect(currentNavFrame(state).second).toBeNull();
  });

  it('never jumps across an aim and never loses the lens', () => {
    const layouts: NavLayout[] = [barA, railB, sideC, minBar];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 40; run += 1) {
      const state = createNavMorph(layouts[run % 3]!);
      for (let i = 0; i < 12; i += 1) {
        const prev: NavMorphFrame = currentNavFrame(state);
        const next = layouts[Math.floor(rnd() * 3)]!;
        aimNavMorph(state, next);
        const frame = currentNavFrame(state);
        near(frame.body, prev.body, 0.5);
        if (prev.lens) {
          expect(frame.lens).not.toBeNull();
          near(frame.lens!.box, prev.lens.box, 0.5);
        }
        const steps = 1 + Math.floor(rnd() * 90);
        for (let k = 0; k < steps; k += 1) {
          stepNavMorph(state, 1 / 120);
          const f = currentNavFrame(state);
          if (state.t.x > 0 && state.t.x < 1) expect(f.lens).not.toBeNull();
        }
      }
    }
  });

  it('runs the bar to its minimised form on the contraction', () => {
    const state = createNavMorph(barA);
    aimNavMorph(state, minBar, 'contract');
    stepNavMorph(state, 1 / 60);
    expect(currentNavFrame(state).lens).toBeNull();
    drive(state, 3);
    near(currentNavFrame(state).body, minBar.body);
    aimNavMorph(state, barA, 'contract');
    drive(state, 3);
    near(currentNavFrame(state).body, barA.body);
  });
});

describe('the drag', () => {
  const cell = barA.items[0]!;
  const lensWidth = cell.width + 12;

  it('follows the pointer continuously, not snapped to items', () => {
    const drag = createNavDrag();
    pressNavDrag(drag, barA, barA.items[1]!.x + 20);
    const xs = [barA.items[1]!.x + 30, barA.items[1]!.x + 61, barA.items[2]!.x + 5, barA.items[2]!.x + 40, barA.items[3]!.x + 11];
    for (const x of xs) {
      moveNavDrag(drag, barA, x, 1 / 60);
      const frame = navDragFrame(drag, barA)!;
      expect(frame.lens.x + frame.lens.width / 2).toBeCloseTo(x, 6);
      expect(frame.lens.y + frame.lens.height / 2).toBeCloseTo(barA.body.y + 28, 6);
    }
  });

  it('lifts on press and reports the item under the lens', () => {
    const drag = createNavDrag();
    expect(navDragFrame(drag, barA)).toBeNull();
    pressNavDrag(drag, barA, barA.items[2]!.x + 10);
    stepNavDrag(drag, barA, 1 / 60);
    const frame = navDragFrame(drag, barA)!;
    expect(frame.lift).toBeGreaterThan(0);
    expect(frame.hover).toBe(2);
    for (let i = 0; i < 60; i += 1) stepNavDrag(drag, barA, 1 / 60);
    expect(navDragFrame(drag, barA)!.lift).toBe(1);
    moveNavDrag(drag, barA, barA.items[0]!.x + 5, 1 / 60);
    expect(navDragFrame(drag, barA)!.hover).toBe(0);
  });

  it('clamps at both ends, bulging 4 dp past the capsule', () => {
    const drag = createNavDrag();
    pressNavDrag(drag, barA, 200);
    moveNavDrag(drag, barA, -500, 1 / 60);
    let f = navDragFrame(drag, barA)!;
    expect(f.lens.x + f.lens.width / 2).toBeCloseTo(barA.body.x + lensWidth / 2 - 4, 6);
    moveNavDrag(drag, barA, 5000, 1 / 60);
    f = navDragFrame(drag, barA)!;
    expect(f.lens.x + f.lens.width / 2).toBeCloseTo(barA.body.x + barA.body.width - lensWidth / 2 + 4, 6);
    expect(f.hover).toBe(3);
  });

  it('stretches with speed and not at rest', () => {
    const drag = createNavDrag();
    pressNavDrag(drag, barA, 150);
    expect(drag.stretch).toBe(0);
    let x = 150;
    for (let i = 0; i < 6; i += 1) moveNavDrag(drag, barA, (x += 6), 1 / 60);
    const slow = drag.stretch;
    for (let i = 0; i < 20; i += 1) moveNavDrag(drag, barA, (x += 40), 1 / 60);
    const fast = drag.stretch;
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThanOrEqual(0.25);
    const f = navDragFrame(drag, barA)!;
    expect(f.lens.width).toBeCloseTo(lensWidth * (1 + fast), 6);
    expect(f.lens.height).toBeCloseTo((cell.height + 12) * (1 - fast / 2), 6);
    for (let i = 0; i < 30; i += 1) stepNavDrag(drag, barA, 1 / 60);
    expect(drag.stretch).toBe(0);
  });

  it('settles on the nearest item on release and lets the lift go', () => {
    const drag = createNavDrag();
    pressNavDrag(drag, barA, barA.items[0]!.x + 10);
    for (let i = 0; i < 20; i += 1) stepNavDrag(drag, barA, 1 / 60);
    moveNavDrag(drag, barA, barA.items[2]!.x + 20, 1 / 60);
    expect(releaseNavDrag(drag, barA)).toBe(2);
    expect(drag.active).toBe(false);
    let moving = true;
    for (let i = 0; i < 240 && moving; i += 1) moving = stepNavDrag(drag, barA, 1 / 120);
    expect(moving).toBe(false);
    expect(navDragFrame(drag, barA)).toBeNull();
    expect(drag.x.x).toBeCloseTo(barA.items[2]!.x + barA.items[2]!.width / 2, 6);
  });

  it('release picks the nearer of two items around the boundary', () => {
    const drag = createNavDrag();
    pressNavDrag(drag, barA, barA.items[1]!.x + 74 - 1);
    expect(releaseNavDrag(drag, barA)).toBe(1);
    pressNavDrag(drag, barA, barA.items[1]!.x + 74 + 1);
    expect(releaseNavDrag(drag, barA)).toBe(2);
  });

  it('cancels back to the selected item', () => {
    const drag = createNavDrag();
    pressNavDrag(drag, barA, barA.items[3]!.x + 10);
    cancelNavDrag(drag, barA, 1);
    expect(drag.active).toBe(false);
    for (let i = 0; i < 240; i += 1) stepNavDrag(drag, barA, 1 / 120);
    expect(drag.x.x).toBeCloseTo(barA.items[1]!.x + 37, 6);
    expect(navDragFrame(drag, barA)).toBeNull();
  });

  it('lands in one step under reduced motion', () => {
    const drag = createNavDrag();
    pressNavDrag(drag, barA, barA.items[0]!.x + 10);
    moveNavDrag(drag, barA, barA.items[3]!.x + 10, 1 / 60);
    releaseNavDrag(drag, barA);
    expect(stepNavDrag(drag, barA, 1 / 60, true)).toBe(true);
    expect(navDragFrame(drag, barA)).toBeNull();
    expect(stepNavDrag(drag, barA, 1 / 60, true)).toBe(false);
  });

  it('is for the full bar only', () => {
    for (const layout of [railB, sideC, minBar]) {
      const drag = createNavDrag();
      pressNavDrag(drag, layout, 40);
      expect(drag.active).toBe(false);
      expect(navDragFrame(drag, layout)).toBeNull();
    }
  });
});

describe('minimising on scroll', () => {
  it('needs the full threshold in one direction', () => {
    expect(MINIMIZE_THRESHOLD).toBe(24);
    const a = createMinimize(100);
    expect(stepMinimize(a, 123)).toBe(false);
    const b = createMinimize(100);
    expect(stepMinimize(b, 124)).toBe(true);
  });

  it('accumulates over several steps', () => {
    const s = createMinimize(50);
    let top = 50;
    for (let i = 0; i < 7; i += 1) expect(stepMinimize(s, (top += 3))).toBe(false);
    expect(stepMinimize(s, (top += 3))).toBe(true);
    expect(stepMinimize(s, (top += 1))).toBe(true);
  });

  it('is not toggled by jitter', () => {
    const s = createMinimize(100);
    let top = 100;
    for (let i = 0; i < 100; i += 1) expect(stepMinimize(s, (top += i % 2 === 0 ? 5 : -5))).toBe(false);
    stepMinimize(s, (top += 40));
    expect(s.minimized).toBe(true);
    for (let i = 0; i < 100; i += 1) expect(stepMinimize(s, (top += i % 2 === 0 ? 5 : -5))).toBe(true);
  });

  it('expands after 24 up, at the top, and on a tap', () => {
    const s = createMinimize(100);
    stepMinimize(s, 200);
    expect(s.minimized).toBe(true);
    expect(stepMinimize(s, 177)).toBe(true);
    expect(stepMinimize(s, 176)).toBe(false);
    stepMinimize(s, 300);
    expect(s.minimized).toBe(true);
    expect(stepMinimize(s, 0)).toBe(false);
    stepMinimize(s, 100);
    expect(s.minimized).toBe(true);
    expandMinimize(s);
    expect(s.minimized).toBe(false);
    expect(s.run).toBe(0);
    expect(stepMinimize(s, 110)).toBe(false);
  });

  it('expands on an overscroll above the top', () => {
    const s = createMinimize(100);
    stepMinimize(s, 200);
    expect(stepMinimize(s, -12)).toBe(false);
  });
});

describe('navLayout: the toggle', () => {
  const layout = (form: 'bar' | 'rail' | 'sidebar', toggle = true) =>
    navLayout({ ...base, form, window: form === 'sidebar' ? { width: 1280, height: 800 } : base.window, secondary: 2, toggle });

  it('sits in the head strip: centred in the rail, at the trailing end of the sidebar', () => {
    const rail = layout('rail');
    expect(rail.toggle).toMatchObject({ width: 44, height: 44 });
    expect(rail.toggle!.x + 22).toBeCloseTo(rail.body.x + rail.body.width / 2, 6);
    expect(rail.toggle!.y + 22).toBeCloseTo(rail.body.y + 8 + 24, 6);
    const side = layout('sidebar');
    expect(side.toggle!.x + 44).toBe(side.body.x + side.body.width - 8);
    expect(side.toggle!.y).toBe(rail.toggle!.y);
  });

  it('is absent where the head holds none, and on the bar', () => {
    expect(layout('rail', false).toggle).toBeNull();
    expect(layout('sidebar', false).toggle).toBeNull();
    expect(layout('bar').toggle).toBeNull();
    expect(navLayout({ ...base, minimized: true }).toggle).toBeNull();
  });
});

describe('fixedNavigationForm', () => {
  const ctx = adaptiveContext({ window: { width: 1280, height: 800 }, input: INPUT_POINTER });
  const model = navigationForm(ctx, { primary: 4, secondary: 2, search: true });

  it('keeps the destinations and gives the search and the toggle the form they belong to', () => {
    expect(model.form).toBe('sidebar');
    const bar = fixedNavigationForm(model, 'bar');
    expect(bar).toMatchObject({ form: 'bar', edge: 'bottom', primary: 4, secondary: 2, secondaryVisible: false, collapsible: false, expandable: null });
    expect(bar.search).toEqual({ form: 'button', place: 'bar', shortcut: true });
    const rail = fixedNavigationForm(model, 'rail');
    expect(rail).toMatchObject({ form: 'rail', edge: 'leading', collapsible: false });
    expect(rail.search).toMatchObject({ form: 'item', place: 'rail' });
  });

  it('returns the model itself when it already is that form, and a search-less model stays so', () => {
    expect(fixedNavigationForm(model, 'sidebar')).toBe(model);
    const none = navigationForm(ctx, { primary: 4 });
    expect(fixedNavigationForm(none, 'bar').search).toBeNull();
  });
});

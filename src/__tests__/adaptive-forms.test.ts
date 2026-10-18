import { describe, expect, it } from 'vitest';
import {
  FORM_MORPH_TIMING,
  MORE_ID,
  TOOLBAR_GAP,
  adaptiveContext,
  createFormMorph,
  formMorph,
  formMorphFrame,
  rebaseFormMorph,
  stepFormMorph,
  toolbarLayout,
  toolbarPlacement,
  type MorphBox,
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

const visibleIds = (layout: ToolbarLayout) => layout.capsules.flatMap((c) => c.items).filter((id) => id !== MORE_ID);

describe('toolbar layout', () => {
  // At the touch tier: four icons of 44, two text items of 60 and 64, gaps of 8.
  const separate = 4 * 44 + 60 + 64 + 5 * TOOLBAR_GAP;
  const merged = 4 * 44 + 60 + 64 + 2 * TOOLBAR_GAP;

  it('with room, every item is its own capsule, the main action at the trailing end', () => {
    const layout = toolbarLayout(ITEMS, { available: separate, tier: 'touch' });
    expect(layout.stage).toBe('separate');
    expect(layout.capsules.map((c) => c.items.join('+'))).toEqual(['share', 'like', 'download', 'add', 'edit', 'done']);
    expect(layout.capsules.at(-1)).toMatchObject({ kind: 'primary', items: ['done'] });
    expect(layout.extent).toBe(separate);
    expect(layout.overflow).toEqual([]);
  });

  it('a pixel short, neighbours merge into one capsule; text never merges with symbols', () => {
    const layout = toolbarLayout(ITEMS, { available: separate - 1, tier: 'touch' });
    expect(layout.stage).toBe('merged');
    expect(layout.capsules.map((c) => `${c.kind}:${c.items.join('+')}`)).toEqual(['icon:share+like+download+add', 'text:edit', 'primary:done']);
    expect(layout.extent).toBe(merged);
  });

  it('shorter still, the lowest priority goes into "…" first, the trailing one among equals; "…" exists only for that', () => {
    const layout = toolbarLayout(ITEMS, { available: merged - 1, tier: 'touch' });
    expect(layout.stage).toBe('overflow');
    expect(layout.overflow).toEqual(['edit']);
    expect(layout.capsules.some((c) => c.kind === 'more')).toBe(true);
    const tighter = toolbarLayout(ITEMS, { available: 4 * 44 + 64 + 44 + 2 * TOOLBAR_GAP - 1, tier: 'touch' });
    expect(tighter.overflow).toEqual(['download', 'edit']);
    expect(tighter.capsules.at(-2)).toMatchObject({ kind: 'more', items: [MORE_ID] });
  });

  it('a badged item and the main action never overflow; when they alone are too wide it says so', () => {
    const layout = toolbarLayout(ITEMS, { available: 0, tier: 'touch' });
    expect(visibleIds(layout).sort()).toEqual(['done', 'like']);
    expect(layout.overflow).toEqual(['share', 'download', 'add', 'edit']);
    expect(layout.fits).toBe(false);
  });

  it('every item stays reachable at every width, and what is laid out fits whenever it can', () => {
    for (let available = 0; available <= 520; available += 1) {
      const layout = toolbarLayout(ITEMS, { available, tier: 'touch' });
      const reachable = [...visibleIds(layout), ...layout.overflow, ...layout.aside].sort();
      expect(reachable, String(available)).toEqual(ITEMS.map((i) => i.id).sort());
      expect(layout.overflow.length > 0, String(available)).toBe(layout.capsules.some((c) => c.kind === 'more'));
      if (layout.fits) expect(layout.extent).toBeLessThanOrEqual(available);
      for (const id of ['like', 'done']) expect(layout.overflow).not.toContain(id);
    }
  });

  it('it never hides more than it must: a wider container shows at least as many items', () => {
    let shown = 0;
    for (let available = 0; available <= 520; available += 4) {
      const now = visibleIds(toolbarLayout(ITEMS, { available, tier: 'touch' })).length;
      expect(now).toBeGreaterThanOrEqual(shown);
      shown = now;
    }
  });

  it('groups merge only within themselves', () => {
    const items: ToolbarItem[] = [
      { id: 'a', kind: 'icon', group: 'edit' },
      { id: 'b', kind: 'icon', group: 'edit' },
      { id: 'c', kind: 'icon', group: 'view' },
      { id: 'd', kind: 'icon', group: 'view' },
    ];
    const layout = toolbarLayout(items, { available: 4 * 44 + 3 * TOOLBAR_GAP - 1, tier: 'touch' });
    expect(layout.capsules.map((c) => c.items.join('+'))).toEqual(['a+b', 'c+d']);
  });

  it('a compact window holds at most three groups', () => {
    const items: ToolbarItem[] = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, kind: 'icon', group: id, priority: i }));
    const layout = toolbarLayout(items, { available: 1000, tier: 'touch', maxGroups: 3 });
    expect(layout.capsules.length).toBeLessThanOrEqual(3);
    expect(layout.overflow).toEqual(['a', 'b']);
  });

  it('vertical: symbols stand in the strip, text stays in a horizontal row', () => {
    const layout = toolbarLayout(ITEMS, { available: 400, tier: 'touch', orientation: 'vertical' });
    expect(layout.orientation).toBe('vertical');
    expect(layout.aside).toEqual(['edit', 'done']);
    for (const capsule of layout.capsules) expect(capsule.kind === 'text' || (capsule.kind === 'primary' && capsule.items[0] === 'done')).toBe(false);
  });

  it('the tier sets the icon\'s square', () => {
    const icons: ToolbarItem[] = [{ id: 'a', kind: 'icon' }, { id: 'b', kind: 'icon' }];
    expect(toolbarLayout(icons, { available: 1000, tier: 'medium' }).extent).toBe(32 + TOOLBAR_GAP + 32);
    expect(toolbarLayout(icons, { available: 1000, tier: 'touch' }).extent).toBe(44 + TOOLBAR_GAP + 44);
  });

  it('the window places it: bottom on compact with three groups, the pane\'s top above, a trailing strip on a compact height', () => {
    expect(toolbarPlacement(adaptiveContext({ window: { width: 360, height: 800 } }))).toEqual({ edge: 'bottom', orientation: 'horizontal', maxGroups: 3 });
    expect(toolbarPlacement(adaptiveContext({ window: { width: 700, height: 900 } }))).toMatchObject({ edge: 'top', orientation: 'horizontal' });
    expect(toolbarPlacement(adaptiveContext({ window: { width: 1440, height: 900 } }))).toMatchObject({ edge: 'top' });
    expect(toolbarPlacement(adaptiveContext({ window: { width: 915, height: 412 } }))).toMatchObject({ edge: 'trailing', orientation: 'vertical' });
  });
});

describe('form morph', () => {
  const ctx = { reduceMotion: false };

  it('describes what flows into what: one body reshaped, coming and going by its lens, or retracting when its anchor is gone', () => {
    expect(formMorph({ body: 'navigation', from: 'bar', to: 'rail' }, ctx)).toMatchObject({ mode: 'reshape', staysOpen: true, instant: false });
    expect(formMorph({ body: 'surface', from: 'popover', to: 'bottom-sheet' }, ctx)).toMatchObject({ mode: 'reshape', staysOpen: true });
    expect(formMorph({ body: 'supporting', from: 'hidden', to: 'beside' }, ctx).mode).toBe('appear');
    expect(formMorph({ body: 'supporting', from: 'beside', to: 'hidden' }, ctx)).toMatchObject({ mode: 'disappear', staysOpen: false });
    expect(formMorph({ body: 'navigation', from: 'rail', to: 'rail' }, ctx).mode).toBe('none');
    expect(formMorph({ body: 'surface', from: 'grown', to: 'grown' }, ctx, { anchorGone: true })).toMatchObject({ mode: 'retract', staysOpen: false });
    expect(formMorph({ body: 'navigation', from: 'bar', to: 'rail' }, { reduceMotion: true }).instant).toBe(true);
  });

  const bar: MorphBox = { x: 16, y: 820, width: 380, height: 64, radius: 32 };
  const rail: MorphBox = { x: 8, y: 8, width: 80, height: 884, radius: 24 };

  const run = (state = createFormMorph(), toward: 0 | 1 = 1, frames = 120) => {
    const xs: number[] = [];
    for (let i = 0; i < frames; i += 1) {
      stepFormMorph(state, 1 / 60, toward);
      xs.push(state.t.x);
    }
    return { state, xs };
  };

  it('moves at the growth\'s pace, settles on the new form and never overshoots it', () => {
    const { state, xs } = run();
    expect(FORM_MORPH_TIMING.damping).toBe(1);
    expect(state.t.x).toBe(1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
    const halfway = xs.findIndex((x) => x >= 0.5);
    expect(halfway / 60).toBeGreaterThan(0.05);
    expect(halfway / 60).toBeLessThan(0.3);
  });

  it('turned back mid-way it runs back from where it is, without a jump', () => {
    const state = createFormMorph();
    run(state, 1, 8);
    const turnedAt = state.t.x;
    expect(turnedAt).toBeGreaterThan(0.05);
    expect(turnedAt).toBeLessThan(0.95);
    const back = run(state, 0, 120).xs;
    expect(Math.abs(back[0]! - turnedAt)).toBeLessThan(0.1);
    expect(Math.max(...back)).toBeLessThan(turnedAt + 0.1);
    expect(state.t.x).toBe(0);
  });

  it('under reduced motion the new form is there in one frame', () => {
    const state = createFormMorph();
    stepFormMorph(state, 1 / 60, 1, true);
    expect(state.t.x).toBe(1);
    expect(formMorphFrame(bar, rail, state).box).toEqual(rail);
  });

  it('every frame is one box between the two, and the old content leaves before the new arrives', () => {
    const state = createFormMorph();
    expect(formMorphFrame(bar, rail, state)).toMatchObject({ box: bar, ink: { outgoing: 1, incoming: 0 }, showing: 'from' });
    let last = formMorphFrame(bar, rail, state).box;
    for (let i = 0; i < 60; i += 1) {
      stepFormMorph(state, 1 / 60, 1);
      const frame = formMorphFrame(bar, rail, state);
      expect(Math.abs(frame.box.width - last.width)).toBeLessThan(60);
      expect(frame.ink.outgoing === 0 || frame.ink.incoming === 0).toBe(true);
      last = frame.box;
    }
    state.t.x = 0.5;
    expect(formMorphFrame(bar, rail, state).ink).toEqual({ outgoing: 0, incoming: 0 });
  });

  it('a third form mid-way starts from where the body is', () => {
    const state = createFormMorph();
    run(state, 1, 6);
    const now = formMorphFrame(bar, rail, state).box;
    rebaseFormMorph(state);
    const sidebar: MorphBox = { x: 8, y: 8, width: 264, height: 884, radius: 24 };
    expect(formMorphFrame(now, sidebar, state).box).toEqual(now);
  });
});

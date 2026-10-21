import { describe, expect, it } from 'vitest';
import { VIREGLASS_CONTROL_MATERIAL, VIREGLASS_SHEET_MATERIAL, resolveOptics } from 'vireglass';
import {
  ATOM_AT_REST,
  MENU_CLOSED,
  MENU_CORNERS,
  MENU_DROP_BODY,
  atomBody,
  createGrowthState,
  growthPhase,
  menuActivity,
  menuLit,
  menuTaper,
  menuCapsule,
  menuBody,
  menuCorner,
  menuGlass,
  menuItemFill,
  menuMaterial,
  menuPlacement,
  menuSurfaceFrame,
  stepGrowth,
  stepMenu,
  type MenuEvent,
  type MenuItem,
  type MenuState,
  type RoundedRect,
} from '../index';

// Delete is a native disabled button (focus cannot land on it); Pin is aria-disabled (it can, WAI-ARIA APG).
const ITEMS: MenuItem[] = [
  { label: 'Copy link', disabled: false },
  { label: 'Rename', disabled: false },
  { label: 'Delete', disabled: true },
  { label: 'Remove from list', disabled: false },
  { label: 'Pin', disabled: true, focusable: true },
  { label: 'Copy text', disabled: false },
];

const open = (focus: 'menu' | 'first' | 'last' = 'menu'): MenuState => stepMenu(MENU_CLOSED, { type: 'open', focus }, ITEMS).state;
const at = (state: MenuState, active: number): MenuState => ({ ...state, active });

describe('the menu-button keyboard', () => {
  it('opens on the first or last item it can reach, or on the menu itself', () => {
    expect(stepMenu(MENU_CLOSED, { type: 'open', focus: 'first' }, ITEMS).focus).toEqual({ to: 'item', index: 0 });
    expect(stepMenu(MENU_CLOSED, { type: 'open', focus: 'last' }, ITEMS).focus).toEqual({ to: 'item', index: 5 });
    const pointer = stepMenu(MENU_CLOSED, { type: 'open', focus: 'menu' }, ITEMS);
    expect(pointer.focus).toEqual({ to: 'menu' });
    expect(pointer.state).toMatchObject({ open: true, active: -1 });
  });

  it('a natively disabled item at either end is passed over, an aria-disabled one is landed on', () => {
    const native = [{ label: 'A', disabled: true }, { label: 'B', disabled: false }, { label: 'C', disabled: true }];
    expect(stepMenu(MENU_CLOSED, { type: 'open', focus: 'first' }, native).focus).toEqual({ to: 'item', index: 1 });
    expect(stepMenu(MENU_CLOSED, { type: 'open', focus: 'last' }, native).focus).toEqual({ to: 'item', index: 1 });
    const aria = native.map((item) => ({ ...item, focusable: true }));
    expect(stepMenu(MENU_CLOSED, { type: 'open', focus: 'first' }, aria).focus).toEqual({ to: 'item', index: 0 });
    expect(stepMenu(MENU_CLOSED, { type: 'open', focus: 'last' }, aria).focus).toEqual({ to: 'item', index: 2 });
  });

  it('an empty menu, or one of natively disabled items only, opens on itself', () => {
    expect(stepMenu(MENU_CLOSED, { type: 'open', focus: 'first' }, []).focus).toEqual({ to: 'menu' });
    expect(stepMenu(open(), { type: 'move', to: 'next' }, []).focus).toEqual({ to: 'stay' });
    expect(stepMenu(MENU_CLOSED, { type: 'open', focus: 'first' }, [{ label: 'A', disabled: true }]).focus).toEqual({ to: 'menu' });
  });

  it('arrows pass over a natively disabled item, land on an aria-disabled one, and wrap', () => {
    expect(stepMenu(at(open(), 1), { type: 'move', to: 'next' }, ITEMS).state.active).toBe(3);
    expect(stepMenu(at(open(), 3), { type: 'move', to: 'previous' }, ITEMS).state.active).toBe(1);
    expect(stepMenu(at(open(), 3), { type: 'move', to: 'next' }, ITEMS).state.active).toBe(4);
    expect(stepMenu(at(open(), 5), { type: 'move', to: 'next' }, ITEMS).state.active).toBe(0);
    expect(stepMenu(at(open(), 0), { type: 'move', to: 'previous' }, ITEMS).state.active).toBe(5);
  });

  it('from the menu itself the arrows land on the first and the last item', () => {
    expect(stepMenu(open(), { type: 'move', to: 'next' }, ITEMS).state.active).toBe(0);
    expect(stepMenu(open(), { type: 'move', to: 'previous' }, ITEMS).state.active).toBe(5);
  });

  it('Home and End go to the first and last item', () => {
    expect(stepMenu(at(open(), 3), { type: 'move', to: 'first' }, ITEMS).focus).toEqual({ to: 'item', index: 0 });
    expect(stepMenu(at(open(), 0), { type: 'move', to: 'last' }, ITEMS).focus).toEqual({ to: 'item', index: 5 });
  });

  it('the pointer makes the item under it active, an aria-disabled one too, but not a natively disabled one', () => {
    expect(stepMenu(open(), { type: 'point', index: 3 }, ITEMS).focus).toEqual({ to: 'item', index: 3 });
    expect(stepMenu(at(open(), 1), { type: 'point', index: 4 }, ITEMS).focus).toEqual({ to: 'item', index: 4 });
    expect(stepMenu(at(open(), 1), { type: 'point', index: 2 }, ITEMS).focus).toEqual({ to: 'stay' });
    expect(stepMenu(at(open(), 4), { type: 'point', index: 4 }, ITEMS).focus).toEqual({ to: 'stay' });
    expect(stepMenu(at(open(), 4), { type: 'point', index: 9 }, ITEMS).focus).toEqual({ to: 'stay' });
  });

  it('typeahead goes to the next item starting with the letter, and a repeated letter cycles', () => {
    const c = stepMenu(at(open(), 0), { type: 'type', key: 'c', at: 10 }, ITEMS);
    expect(c.state.active).toBe(5);
    const cc = stepMenu(c.state, { type: 'type', key: 'c', at: 10.2 }, ITEMS);
    expect(cc.state.active).toBe(0);
  });

  it('letters typed close together refine the match, and a pause starts over', () => {
    const r = stepMenu(open(), { type: 'type', key: 'r', at: 1 }, ITEMS);
    expect(r.state.active).toBe(1);
    const re = stepMenu(r.state, { type: 'type', key: 'e', at: 1.1 }, ITEMS);
    expect(re.state.active).toBe(1);
    const rem = stepMenu(re.state, { type: 'type', key: 'm', at: 1.2 }, ITEMS);
    expect(rem.state.active).toBe(3);
    const later = stepMenu(rem.state, { type: 'type', key: 'c', at: 2 }, ITEMS);
    expect(later.state.typed).toBe('c');
    expect(later.state.active).toBe(5);
  });

  it('an arrow or the pointer ends a typed word, so the next letter starts a new one', () => {
    const c = stepMenu(at(open(), 0), { type: 'type', key: 'c', at: 1 }, ITEMS);
    const home = stepMenu(c.state, { type: 'move', to: 'first' }, ITEMS);
    expect(home.state.typed).toBe('');
    expect(stepMenu(home.state, { type: 'type', key: 'r', at: 1.1 }, ITEMS).state.active).toBe(1);
    const pointed = stepMenu(c.state, { type: 'point', index: 3 }, ITEMS);
    expect(stepMenu(pointed.state, { type: 'type', key: 'r', at: 1.1 }, ITEMS).state.active).toBe(1);
  });

  it('typeahead reaches an aria-disabled item, passes over a natively disabled one, and stays put without a match', () => {
    expect(stepMenu(at(open(), 1), { type: 'type', key: 'p', at: 0 }, ITEMS).focus).toEqual({ to: 'item', index: 4 });
    expect(stepMenu(at(open(), 1), { type: 'type', key: 'd', at: 0 }, ITEMS).focus).toEqual({ to: 'stay' });
    const none = stepMenu(at(open(), 1), { type: 'type', key: 'x', at: 0 }, ITEMS);
    expect(none.state.active).toBe(1);
    expect(none.focus).toEqual({ to: 'stay' });
  });

  it('a choice closes the menu, returns focus to the trigger and names the item', () => {
    const step = stepMenu(at(open(), 1), { type: 'choose', index: 3 }, ITEMS);
    expect(step.state.open).toBe(false);
    expect(step.focus).toEqual({ to: 'trigger' });
    expect(step.chosen).toBe(3);
  });

  it('neither kind of disabled item can be chosen, and choosing one closes nothing', () => {
    for (const index of [2, 4]) {
      const step = stepMenu(at(open(), 1), { type: 'choose', index }, ITEMS);
      expect(step.state.open).toBe(true);
      expect(step.chosen).toBeNull();
    }
  });

  it('Escape, Tab and the trigger return focus to the trigger; a press outside leaves it alone', () => {
    for (const reason of ['escape', 'tab', 'trigger'] as const) {
      const step = stepMenu(open('first'), { type: 'dismiss', reason }, ITEMS);
      expect(step.state.open).toBe(false);
      expect(step.focus).toEqual({ to: 'trigger' });
    }
    const outside = stepMenu(open('first'), { type: 'dismiss', reason: 'outside' }, ITEMS);
    expect(outside.state.open).toBe(false);
    expect(outside.focus).toEqual({ to: 'none' });
  });

  it('a closed menu ignores everything but opening', () => {
    const events: MenuEvent[] = [
      { type: 'move', to: 'next' },
      { type: 'point', index: 0 },
      { type: 'type', key: 'c', at: 0 },
      { type: 'choose', index: 0 },
      { type: 'dismiss', reason: 'escape' },
    ];
    for (const event of events) {
      const step = stepMenu(MENU_CLOSED, event, ITEMS);
      expect(step.state).toBe(MENU_CLOSED);
      expect(step.focus).toEqual({ to: 'stay' });
      expect(step.chosen).toBeNull();
    }
  });

  // A menu that stayed open after a choice would be a popover, another atom.
  it('no event chooses an item and leaves the menu open', () => {
    const events: MenuEvent[] = [
      ...ITEMS.map((_, index) => ({ type: 'choose', index }) as const),
      ...ITEMS.map((_, index) => ({ type: 'point', index }) as const),
      { type: 'move', to: 'next' },
      { type: 'type', key: 'r', at: 0 },
      { type: 'open', focus: 'first' },
    ];
    for (const event of events) {
      const step = stepMenu(open('first'), event, ITEMS);
      if (step.chosen !== null) expect(step.state.open).toBe(false);
    }
  });
});

describe('placement under the finger', () => {
  const viewport = { width: 800, height: 600 };
  const menu = { width: 180, height: 200 };
  const trigger = (x: number, y: number) => ({ x, y, width: 44, height: 44 });

  it('the corner is the trigger\'s nearest viewport corner', () => {
    expect(menuCorner(trigger(20, 20), viewport)).toEqual(MENU_CORNERS['top-left']);
    expect(menuCorner(trigger(700, 20), viewport)).toEqual(MENU_CORNERS['top-right']);
    expect(menuCorner(trigger(20, 500), viewport)).toEqual(MENU_CORNERS['bottom-left']);
    expect(menuCorner(trigger(700, 500), viewport)).toEqual(MENU_CORNERS['bottom-right']);
  });

  it('the menu shares that corner with the trigger and covers it', () => {
    for (const [x, y] of [[20, 20], [700, 20], [20, 500], [700, 500]] as const) {
      const t = trigger(x, y);
      const { rect, corner, anchor } = menuPlacement(t, menu, viewport);
      expect(rect.width).toBe(menu.width);
      expect(rect.height).toBe(menu.height);
      expect(rect.x <= t.x && rect.x + rect.width >= t.x + t.width).toBe(true);
      expect(rect.y <= t.y && rect.y + rect.height >= t.y + t.height).toBe(true);
      expect(anchor).toEqual({ x: corner.x < 0 ? t.x : t.x + t.width, y: corner.y < 0 ? t.y : t.y + t.height });
    }
  });

  it('a fixed corner is kept, and the menu slides in rather than leaving the viewport', () => {
    const t = trigger(20, 20);
    const { rect, corner } = menuPlacement(t, menu, viewport, { corner: MENU_CORNERS['bottom-left'] });
    expect(corner).toEqual(MENU_CORNERS['bottom-left']);
    expect(rect.y).toBe(8);
  });

  it('an automatic corner flips on an axis where the menu would not fit', () => {
    const t = trigger(380, 120);
    const { corner, rect } = menuPlacement(t, { width: 180, height: 400 }, viewport);
    expect(corner.y).toBe(-1);
    expect(rect.y).toBe(120);
  });

  it('a menu larger than the viewport is cut to it, inside the margin', () => {
    const { rect } = menuPlacement(trigger(20, 20), { width: 1000, height: 900 }, viewport);
    expect(rect).toEqual({ x: 8, y: 8, width: 784, height: 584 });
  });
});

describe('the surface on each frame of the growth', () => {
  const trigger: RoundedRect = { x: 20, y: 20, width: 44, height: 44, radius: 22 };
  const menu: RoundedRect = { x: 20, y: 20, width: 180, height: 202, radius: 35 };
  const anchor = { x: 20, y: 20 };

  it('starts as the trigger\'s body and ends as the menu, one body at both ends', () => {
    const start = menuSurfaceFrame(trigger, menu, anchor, { shrink: 0, grow: 0 });
    expect(start.box).toEqual(trigger);
    expect(start.morph).toBeUndefined();
    expect(start.ink).toEqual({ outgoing: 1, incoming: 0 });
    const end = menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow: 1 });
    for (const key of ['x', 'y', 'width', 'height', 'radius'] as const) expect(end.box[key]).toBeCloseTo(menu[key], 6);
    expect(end.morph).toBeUndefined();
    expect(end.content.x).toBeCloseTo(0, 6);
    expect(end.content.y).toBeCloseTo(0, 6);
    expect(end.ink).toEqual({ outgoing: 0, incoming: 1 });
  });

  it('contracts into a drop smaller than the trigger on the way', () => {
    let smallest = Infinity;
    for (let s = 0; s <= 1; s += 0.05) {
      const { box } = menuSurfaceFrame(trigger, menu, anchor, { shrink: s, grow: 0 });
      smallest = Math.min(smallest, Math.max(box.width, box.height));
    }
    expect(smallest).toBeLessThan(trigger.height * 0.9);
  });

  it('hands the lens the second shape while the drop and the menu are joined, from the box\'s centre', () => {
    const mid = menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow: 0.15 });
    expect(mid.morph).toBeDefined();
    expect(mid.morph!.smoothing).toBeGreaterThan(0);
    const cx = mid.box.x + mid.box.width / 2 + mid.morph!.offsetX;
    const cy = mid.box.y + mid.box.height / 2 + mid.morph!.offsetY;
    expect(cx).toBeGreaterThan(trigger.x);
    expect(cy).toBeGreaterThan(trigger.y);
    expect(cx).toBeLessThan(menu.x + menu.width);
  });

  it('the content keeps its final place while the box moves', () => {
    const mid = menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow: 0.4 });
    expect(mid.box.x + mid.content.x).toBeCloseTo(menu.x, 6);
    expect(mid.box.y + mid.content.y).toBeCloseTo(menu.y, 6);
  });

  it('an overshoot makes the surface briefly larger than the menu', () => {
    const over = menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow: 1.03 });
    expect(over.box.height).toBeGreaterThan(menu.height);
  });

  // M 5:11: no content until 95 % of the height, blurred at first, sharp by the overshoot.
  it('the content comes into focus only near size', () => {
    const ink = (grow: number) => menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow }).ink.incoming;
    expect(ink(0.85)).toBe(0);
    expect(ink(0.95)).toBeGreaterThan(0.2);
    expect(ink(0.95)).toBeLessThan(0.8);
    expect(ink(1)).toBe(1);
  });

  it('the drop is the active medium and the menu is at rest', () => {
    expect(menuActivity({ shrink: 0, grow: 0 })).toBe(0);
    expect(menuActivity({ shrink: 1, grow: 1 })).toBe(0);
    expect(menuActivity({ shrink: 1, grow: 1.03 })).toBe(0);
    expect(menuActivity({ shrink: 1, grow: 0.1 })).toBeGreaterThan(0.8);
    expect(menuBody(VIREGLASS_CONTROL_MATERIAL, 0)).toEqual(atomBody(VIREGLASS_CONTROL_MATERIAL, ATOM_AT_REST));
    expect(menuBody(VIREGLASS_CONTROL_MATERIAL, 1)).toEqual(MENU_DROP_BODY);
  });

  // M 5:11: the drop is bright white and nearly opaque (0.97 inside its silhouette against 0.78 for the menu at rest).
  it('the drop is a bright, nearly opaque body, far above the resting one', () => {
    const drop = menuBody(VIREGLASS_CONTROL_MATERIAL, 1);
    const rest = menuBody(VIREGLASS_CONTROL_MATERIAL, 0);
    expect(drop.alpha).toBeGreaterThan(0.9);
    expect(drop.alpha).toBeGreaterThan(rest.alpha * 3);
    expect(drop.lift).toBeGreaterThanOrEqual(0.25);
    expect(drop.lift).toBeGreaterThan(rest.lift * 2);
  });

  it('the glass is still lit once the body has its size, until the content is in focus', () => {
    const sized = { shrink: 1, grow: 1, glow: 1 };
    expect(menuActivity({ ...sized, focus: 0 })).toBeGreaterThan(0.3);
    expect(menuActivity({ ...sized, focus: 0.5 })).toBeLessThan(menuActivity({ ...sized, focus: 0 }));
    expect(menuActivity({ ...sized, focus: 1 })).toBe(0);
  });

  it('a capsule that has re-formed is still lit: the glow lets go of the shrink slowly', () => {
    expect(menuActivity({ shrink: 0.02, grow: 0.1, glow: 0.9 })).toBeGreaterThan(0.8);
    expect(menuActivity({ shrink: 0.02, grow: 0.1 })).toBeLessThan(0.1);
  });

  it('while the surface is the capsule its glyphs are seen through lightly scattering glass, and once the drop has formed through the sheet scattering', () => {
    expect(menuCapsule({ shrink: 0, grow: 0 })).toBe(1);
    expect(menuCapsule({ shrink: 0.47, grow: 0 })).toBeGreaterThan(0.9);
    expect(menuCapsule({ shrink: 1, grow: 0.5 })).toBe(0);
    const glyphs = resolveOptics(menuMaterial(VIREGLASS_CONTROL_MATERIAL, 0, 1)).blur;
    expect(glyphs).toBeCloseTo(resolveOptics(VIREGLASS_CONTROL_MATERIAL).blur, 6);
    expect(resolveOptics(menuMaterial(VIREGLASS_CONTROL_MATERIAL, 0, 0)).blur).toBeGreaterThan(glyphs * 3);
  });

  it('the surface is one body of the capsule and the drop rising out of it, and of the drop and the capsule merging back', () => {
    const bud = menuSurfaceFrame(trigger, menu, anchor, { shrink: 0.5, grow: 0, glow: 0.5 }, undefined, { outline: true });
    expect(bud.outline).toBeDefined();
    expect(bud.morph).toBeUndefined();
    expect(bud.box.width).toBeGreaterThan(menuSurfaceFrame(trigger, menu, anchor, { shrink: 0.5, grow: 0, glow: 0.5 }).box.width - 1);
    const rest = menuSurfaceFrame(trigger, menu, anchor, { shrink: 0, grow: 0 }, undefined, { outline: true });
    expect(rest.outline).toBeUndefined();
    const settled = menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow: 1 }, undefined, { outline: true });
    expect(settled.outline).toBeUndefined();
  });

  it('the content rides inside the lens while the body is still growing, and is blurred and out of its place until it settles', () => {
    const s = createGrowthState();
    let seen = false;
    let sharpAtSize = false;
    for (let i = 0; i < 480; i += 1) {
      stepGrowth(s, 1 / 240, true);
      const f = menuSurfaceFrame(trigger, menu, anchor, growthPhase(s));
      if (f.ink.incoming > 0.1 && f.ink.incoming < 0.9 && s.grow.x < 1.06) seen = true;
      if (s.grow.x > 1 && f.ink.incoming === 1) sharpAtSize = true;
    }
    expect(seen).toBe(true);
    expect(sharpAtSize).toBe(true);
  });

  it('closing takes the content out of focus first', () => {
    const s = createGrowthState();
    for (let i = 0; i < 480; i += 1) stepGrowth(s, 1 / 240, true);
    expect(growthPhase(s).focus).toBe(1);
    for (let i = 0; i < 12; i += 1) stepGrowth(s, 1 / 240, false);
    expect(growthPhase(s).focus!).toBeLessThan(0.5);
    expect(growthPhase(s).grow).toBeGreaterThan(0.8);
  });

  it('closing runs back to where the drop formed, a little past it away from the menu, and ends on the trigger', () => {
    const s = createGrowthState();
    for (let i = 0; i < 480; i += 1) stepGrowth(s, 1 / 240, true);
    const centre = (r: RoundedRect) => r.y + r.height / 2;
    const travel = centre(menu) - centre(trigger);
    let past = 0;
    for (let i = 0; i < 480; i += 1) {
      stepGrowth(s, 1 / 240, false);
      if (s.grow.x < 0.2) past = Math.max(past, centre(trigger) - centre(menuSurfaceFrame(trigger, menu, anchor, growthPhase(s)).box));
    }
    expect(menuSurfaceFrame(trigger, menu, anchor, growthPhase(s)).box).toEqual({ ...trigger });
    expect(past).toBeGreaterThan(0.03 * travel);
    expect(past).toBeLessThan(0.25 * travel);
  });

  // M 7:19: a menu presented from a toolbar button scatters light more softly than the button.
  it('a menu scatters like the core\'s sheets, several times more than a control', () => {
    expect(menuGlass(VIREGLASS_CONTROL_MATERIAL).roughness).toBe(VIREGLASS_SHEET_MATERIAL.roughness);
    expect(resolveOptics(menuMaterial(VIREGLASS_CONTROL_MATERIAL, 0)).blur).toBeGreaterThan(
      resolveOptics(VIREGLASS_CONTROL_MATERIAL).blur * 3,
    );
    expect(menuGlass(VIREGLASS_CONTROL_MATERIAL).ior).toBe(VIREGLASS_CONTROL_MATERIAL.ior);
  });

  it('under reduced transparency the drop is the frosted body', () => {
    expect(menuBody(VIREGLASS_CONTROL_MATERIAL, 1, true)).toEqual(atomBody(VIREGLASS_CONTROL_MATERIAL, ATOM_AT_REST, true));
  });
});

describe('items', () => {
  it('the active item is ink on the glass, the nearer half of a press; a disabled one has none', () => {
    const active = menuItemFill({ active: true, pressed: false, disabled: false });
    const pressed = menuItemFill({ active: true, pressed: true, disabled: false });
    expect(menuItemFill({ active: false, pressed: false, disabled: false })).toBe(0);
    expect(active).toBeGreaterThan(0);
    expect(active / pressed).toBeGreaterThan(0.4);
    expect(active / pressed).toBeLessThan(0.7);
    expect(menuItemFill({ active: true, pressed: true, disabled: true })).toBe(0);
  });
});

// Reference: M 5:11 frame by frame at 29.97 fps (docs/acceptance.md, N9, N29).
describe('timing against the reference', () => {
  const dt = 1 / 240;

  function opening() {
    const s = createGrowthState();
    let t = 0;
    let growStart = -1;
    let atSize = -1;
    let peak = 0;
    let peakAt = 0;
    let settled = -1;
    for (let i = 0; i < 480; i += 1) {
      stepGrowth(s, dt, true);
      t += dt;
      if (growStart < 0 && s.grow.target === 1) growStart = t;
      if (atSize < 0 && s.grow.x > 0.95) atSize = t;
      if (s.grow.x > peak) [peak, peakAt] = [s.grow.x, t];
      if (settled < 0 && t > peakAt + 0.05 && Math.abs(s.grow.x - 1) < 0.005) settled = t;
    }
    return { growStart, atSize, peak, peakAt, settled };
  }

  function closing() {
    const s = createGrowthState();
    for (let i = 0; i < 480; i += 1) stepGrowth(s, dt, true);
    let t = 0;
    let drop = -1;
    let back = -1;
    for (let i = 0; i < 480; i += 1) {
      stepGrowth(s, dt, false);
      t += dt;
      if (drop < 0 && s.grow.x < 0.12) drop = t;
      if (back < 0 && growthPhase(s).shrink < 0.05 && s.grow.x < 0.05) back = t;
    }
    return { drop, back };
  }

  it('the drop forms in about 0.10 s and the menu is at size at about 0.3 s', () => {
    const o = opening();
    expect(o.growStart).toBeGreaterThan(0.065);
    expect(o.growStart).toBeLessThan(0.135);
    expect(o.atSize).toBeGreaterThan(0.25);
    expect(o.atSize).toBeLessThan(0.35);
  });

  // The width of the reference's menu peaks at 1.054 of its settled size 0.45 s after the first frame that changes.
  it('it overshoots by about 4 % at about 0.43 s and settles by about 0.7 s', () => {
    const o = opening();
    expect(o.peak).toBeGreaterThan(1.02);
    expect(o.peak).toBeLessThan(1.06);
    expect(o.peakAt).toBeGreaterThan(0.36);
    expect(o.peakAt).toBeLessThan(0.48);
    expect(o.settled).toBeLessThan(0.8);
  });

  it('the content is sharp at about 0.5 s, well after the body is at size', () => {
    const s = createGrowthState();
    let t = 0;
    let atSize = -1;
    let sharp = -1;
    for (let i = 0; i < 480; i += 1) {
      stepGrowth(s, dt, true);
      t += dt;
      if (atSize < 0 && s.grow.x > 0.95) atSize = t;
      if (sharp < 0 && s.focus.x / 0.97 >= 1) sharp = t;
    }
    expect(sharp).toBeGreaterThan(0.45);
    expect(sharp).toBeLessThan(0.65);
    expect(sharp).toBeGreaterThan(atSize + 0.1);
  });

  it('closing reaches the drop at about 0.28 s and is back in the trigger at about 0.42 s', () => {
    const c = closing();
    expect(c.drop).toBeGreaterThan(0.2);
    expect(c.drop).toBeLessThan(0.33);
    expect(c.back).toBeGreaterThan(0.3);
    expect(c.back).toBeLessThan(0.5);
  });

  // The reference's height reaches 95 % of its size at about 0.45 s, the width at about 0.33 s.
  it('the height trails the width and does not overshoot', () => {
    const s = createGrowthState();
    let t = 0;
    let widthAt = -1;
    let heightAt = -1;
    let tallest = 0;
    for (let i = 0; i < 480; i += 1) {
      stepGrowth(s, dt, true);
      t += dt;
      if (widthAt < 0 && s.grow.x > 0.95) widthAt = t;
      if (heightAt < 0 && s.height.x > 0.95) heightAt = t;
      tallest = Math.max(tallest, s.height.x);
    }
    expect(heightAt).toBeGreaterThan(widthAt + 0.08);
    expect(heightAt).toBeGreaterThan(0.38);
    expect(heightAt).toBeLessThan(0.5);
    expect(tallest).toBeLessThanOrEqual(1 + 1e-6);
  });
});

describe('the drop is a pear, then a bowl, and lit from below', () => {
  const trigger = { x: 100, y: 400, width: 172, height: 44, radius: 22 };
  const menu = { x: 100, y: 240, width: 167, height: 204, radius: 35 };
  const anchor = { x: 100, y: 444 };
  const widthAt = (outline: { x: number; y: number }[], at: number, height: number) => {
    const row = outline.filter((p) => Math.abs(p.y - at * height) < height * 0.06).map((p) => p.x);
    return Math.max(...row) - Math.min(...row);
  };

  it('narrows the top of the drop as it forms and widens it as it swells, and is square once the menu is out', () => {
    expect(menuTaper({ shrink: 1, grow: 0.02, height: 0.02 })).toBeGreaterThan(0.2);
    expect(menuTaper({ shrink: 1, grow: 0.5, height: 0.3 })).toBeLessThan(-0.08);
    expect(menuTaper({ shrink: 1, grow: 1, height: 1 })).toBeCloseTo(0, 9);
    expect(menuTaper({ shrink: 0, grow: 0 })).toBeCloseTo(0, 9);
  });

  it('draws the taper in the outline even where there is one shape only', () => {
    const pear = menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow: 0.02, height: 0.02 }, undefined, { outline: true });
    expect(pear.outline).toBeDefined();
    expect(widthAt(pear.outline!, 0.25, pear.box.height)).toBeLessThan(widthAt(pear.outline!, 0.75, pear.box.height));
    const bowl = menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow: 0.5, height: 0.3 }, undefined, { outline: true });
    expect(widthAt(bowl.outline!, 0.25, bowl.box.height)).toBeGreaterThan(widthAt(bowl.outline!, 0.75, bowl.box.height));
    expect(menuSurfaceFrame(trigger, menu, anchor, { shrink: 1, grow: 1, height: 1 }, undefined, { outline: true }).outline).toBeUndefined();
  });

  it('is lit from below while the body swells and the content is out of focus, and not otherwise', () => {
    expect(menuLit({ shrink: 1, grow: 0, height: 0 })).toBe(0);
    expect(menuLit({ shrink: 1, grow: 0.7, height: 0.6, focus: 0 })).toBeGreaterThan(0.8);
    expect(menuLit({ shrink: 1, grow: 1, height: 1, focus: 1 })).toBe(0);
  });
});

// The menu: the menu-button keyboard as a pure state machine, where the menu sits relative to its
// trigger, and what its glass surface is on each frame of the growth. Boxes are in dp.
import { VIREGLASS_SHEET_MATERIAL, type VireGlassMaterial, type VireGlassMorph } from 'vireglass';
import { ATOM_AT_REST, atomBody, atomMaterial, type AtomBody } from './atom';
import { growthFrame, type GrowthInk, type GrowthPhase, type GrowthPoint } from './morph';

export type MenuItem = { label: string; disabled: boolean };

export type MenuState = {
  open: boolean;
  /** The active item, or -1 while the menu itself holds focus. */
  active: number;
  typed: string;
  /** Seconds, on whatever clock the events carry. */
  typedAt: number;
};

export const MENU_CLOSED: MenuState = { open: false, active: -1, typed: '', typedAt: Number.NEGATIVE_INFINITY };

export type MenuDismissal = 'escape' | 'outside' | 'tab' | 'trigger';

export type MenuEvent =
  | { type: 'open'; focus: 'menu' | 'first' | 'last' }
  | { type: 'move'; to: 'next' | 'previous' | 'first' | 'last' }
  | { type: 'point'; index: number }
  | { type: 'type'; key: string; at: number }
  | { type: 'choose'; index: number }
  | { type: 'dismiss'; reason: MenuDismissal };

/** Where focus goes after a step. `none` leaves it where the person put it (a press outside). */
export type MenuFocus =
  | { to: 'item'; index: number }
  | { to: 'menu' }
  | { to: 'trigger' }
  | { to: 'none' }
  | { to: 'stay' };

export type MenuStep = { state: MenuState; focus: MenuFocus; chosen: number | null };

export const TYPEAHEAD_SECONDS = 0.5;

// WAI-ARIA APG: a disabled item stays in the arrows' and typeahead's way; it only cannot be chosen.
const exists = (items: readonly MenuItem[], i: number) => i >= 0 && i < items.length;
const enabled = (items: readonly MenuItem[], i: number) => exists(items, i) && !items[i]!.disabled;

function seek(items: readonly MenuItem[], from: number, step: 1 | -1): number {
  const n = items.length;
  if (n === 0) return -1;
  return (((from + step) % n) + n) % n;
}

const first = (items: readonly MenuItem[]) => seek(items, -1, 1);
const last = (items: readonly MenuItem[]) => seek(items, items.length, -1);

const toItem = (index: number): MenuFocus => (index < 0 ? { to: 'menu' } : { to: 'item', index });

function typeahead(state: MenuState, items: readonly MenuItem[], key: string, at: number): MenuStep {
  const fresh = at - state.typedAt > TYPEAHEAD_SECONDS;
  const typed = (fresh ? '' : state.typed) + key.toLowerCase();
  // Repeating one letter cycles through the items that start with it instead of asking for "aa".
  const repeated = typed.length > 1 && [...typed].every((c) => c === typed[0]);
  const needle = repeated ? typed[0]! : typed;
  const start = needle.length > 1 ? state.active - 1 : state.active;
  const n = items.length;
  for (let k = 1; k <= n; k += 1) {
    const i = (((start + k) % n) + n) % n;
    if (items[i]!.label.trim().toLowerCase().startsWith(needle)) {
      return { state: { ...state, active: i, typed, typedAt: at }, focus: { to: 'item', index: i }, chosen: null };
    }
  }
  return { state: { ...state, typed, typedAt: at }, focus: { to: 'stay' }, chosen: null };
}

export function stepMenu(state: MenuState, event: MenuEvent, items: readonly MenuItem[]): MenuStep {
  const stay: MenuStep = { state, focus: { to: 'stay' }, chosen: null };
  if (event.type === 'open') {
    const active = event.focus === 'first' ? first(items) : event.focus === 'last' ? last(items) : -1;
    return { state: { ...MENU_CLOSED, open: true, active }, focus: toItem(active), chosen: null };
  }
  if (!state.open) return stay;
  switch (event.type) {
    case 'move': {
      const active =
        event.to === 'first'
          ? first(items)
          : event.to === 'last'
            ? last(items)
            : seek(items, state.active < 0 && event.to === 'previous' ? items.length : state.active, event.to === 'next' ? 1 : -1);
      if (active < 0) return stay;
      // Moving by other means ends a typed word: the next letter starts a new one.
      return { state: { ...state, active, typed: '' }, focus: { to: 'item', index: active }, chosen: null };
    }
    case 'point':
      if (!exists(items, event.index) || event.index === state.active) return stay;
      return { state: { ...state, active: event.index, typed: '' }, focus: { to: 'item', index: event.index }, chosen: null };
    case 'type':
      return typeahead(state, items, event.key, event.at);
    case 'choose':
      if (!enabled(items, event.index)) return stay;
      return { state: MENU_CLOSED, focus: { to: 'trigger' }, chosen: event.index };
    case 'dismiss':
      return { state: MENU_CLOSED, focus: event.reason === 'outside' ? { to: 'none' } : { to: 'trigger' }, chosen: null };
  }
}

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
/** -1 is left or top, 1 is right or bottom. */
export type MenuCorner = { x: -1 | 1; y: -1 | 1 };

export const MENU_CORNERS = {
  'top-left': { x: -1, y: -1 },
  'top-right': { x: 1, y: -1 },
  'bottom-left': { x: -1, y: 1 },
  'bottom-right': { x: 1, y: 1 },
} as const satisfies Record<string, MenuCorner>;

export type MenuPlacement = {
  rect: Rect;
  corner: MenuCorner;
  /** The menu's corner on the pinned side: where its growth ends. */
  anchor: GrowthPoint;
};

/** The trigger's corner nearest the viewport corner it sits in: the open space lies away from it. */
export function menuCorner(trigger: Rect, viewport: Size): MenuCorner {
  return {
    x: trigger.x + trigger.width / 2 <= viewport.width / 2 ? -1 : 1,
    y: trigger.y + trigger.height / 2 <= viewport.height / 2 ? -1 : 1,
  };
}

function along(start: number, length: number, size: number, side: -1 | 1): number {
  return side < 0 ? start : start + length - size;
}

function fits(at: number, size: number, limit: number, margin: number): boolean {
  return at >= margin && at + size <= limit - margin;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The menu shares a corner with its trigger and covers it. An automatic corner flips on an axis
 * where the menu would leave the viewport and the other side fits; then it slides in.
 */
export function menuPlacement(
  trigger: Rect,
  menu: Size,
  viewport: Size,
  options: { corner?: MenuCorner | undefined; margin?: number } = {},
): MenuPlacement {
  const margin = options.margin ?? 8;
  const width = Math.min(menu.width, viewport.width - 2 * margin);
  const height = Math.min(menu.height, viewport.height - 2 * margin);
  const corner: { x: -1 | 1; y: -1 | 1 } = { ...(options.corner ?? menuCorner(trigger, viewport)) };
  let x = along(trigger.x, trigger.width, width, corner.x);
  let y = along(trigger.y, trigger.height, height, corner.y);
  if (!options.corner) {
    const fx = along(trigger.x, trigger.width, width, corner.x === -1 ? 1 : -1);
    if (!fits(x, width, viewport.width, margin) && fits(fx, width, viewport.width, margin)) {
      corner.x = corner.x === -1 ? 1 : -1;
      x = fx;
    }
    const fy = along(trigger.y, trigger.height, height, corner.y === -1 ? 1 : -1);
    if (!fits(y, height, viewport.height, margin) && fits(fy, height, viewport.height, margin)) {
      corner.y = corner.y === -1 ? 1 : -1;
      y = fy;
    }
  }
  x = clamp(x, margin, viewport.width - margin - width);
  y = clamp(y, margin, viewport.height - margin - height);
  const rect = { x, y, width, height };
  return {
    rect,
    corner,
    anchor: { x: corner.x < 0 ? x : x + width, y: corner.y < 0 ? y : y + height },
  };
}

export type RoundedRect = Rect & { radius: number };

export type MenuSurfaceFrame = {
  /** The surface's box this frame: the growth frame's body. */
  box: RoundedRect;
  /** The second shape for the lens's `setMorph`, offset from the box's centre; undefined once there is one body. */
  morph: VireGlassMorph | undefined;
  /** Where the content's origin sits relative to the box's: it keeps its final place while the box moves. */
  content: { x: number; y: number };
  ink: GrowthInk;
  /** How much of a drop the surface is: 0 as the trigger and as the menu, highest in between. */
  activity: number;
};

const center = (r: Rect): GrowthPoint => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function menuActivity(phase: GrowthPhase): number {
  const shrink = Math.min(Math.max(phase.shrink, 0), 1);
  const grow = Math.min(Math.max(phase.grow, 0), 1);
  return shrink * (1 - grow);
}

export function menuSurfaceFrame(
  trigger: RoundedRect,
  menu: RoundedRect,
  anchor: GrowthPoint,
  phase: GrowthPhase,
): MenuSurfaceFrame {
  const frame = growthFrame(
    { geometry: { width: trigger.width, height: trigger.height, cornerRadius: trigger.radius }, center: center(trigger) },
    { geometry: { width: menu.width, height: menu.height, cornerRadius: menu.radius }, center: center(menu) },
    anchor,
    phase,
  );
  const { geometry, center: c } = frame.body;
  const box = {
    x: c.x - geometry.width / 2,
    y: c.y - geometry.height / 2,
    width: geometry.width,
    height: geometry.height,
    radius: geometry.cornerRadius,
  };
  return {
    box,
    morph: frame.merge,
    content: { x: menu.x - box.x, y: menu.y - box.y },
    ink: frame.ink,
    activity: menuActivity(phase),
  };
}

/** A menu is a larger piece of the same glass, and a larger piece scatters light more softly (M 7:19): it
 *  takes the core's sheet scattering, which turns text under it into soft spots without turning it to mush. */
export function menuGlass(base: VireGlassMaterial): VireGlassMaterial {
  return { ...base, roughness: Math.max(base.roughness, VIREGLASS_SHEET_MATERIAL.roughness) };
}

/** The drop is the medium at its active end, the menu at rest is the resting glass. */
export function menuMaterial(base: VireGlassMaterial, activity: number): VireGlassMaterial {
  return atomMaterial(menuGlass(base), 'menu', { ...ATOM_AT_REST, pressed: activity });
}

/** The gathered medium lit by a concentrate of its surroundings: about 0.2 lighter than what it covers at
 *  M 5:11, so white over a light backdrop, and only brighter over a dark one. */
export const MENU_DROP_BODY: AtomBody = { alpha: 0.9, white: 0.1, lift: 0.2 };

export function menuBody(base: VireGlassMaterial, activity: number, frost = false): AtomBody {
  const rest = atomBody(base, ATOM_AT_REST, frost);
  if (frost) return rest;
  const k = Math.min(Math.max(activity, 0), 1);
  const mix = (key: keyof AtomBody) => rest[key] + (MENU_DROP_BODY[key] - rest[key]) * k;
  return { alpha: mix('alpha'), white: mix('white'), lift: mix('lift') };
}

export type MenuItemState = { active: boolean; pressed: boolean; disabled: boolean };

/** Ink laid on the glass under an item, as a fraction of the ink colour. */
export const MENU_ITEM_FILL = { active: 0.1, pressed: 0.18 } as const;

export function menuItemFill(state: MenuItemState): number {
  if (state.disabled) return 0;
  if (state.pressed) return MENU_ITEM_FILL.pressed;
  return state.active ? MENU_ITEM_FILL.active : 0;
}

// The menu: the menu-button keyboard as a pure state machine, where the menu sits relative to its
// trigger, and what its glass surface is on each frame of the growth. Boxes are in dp.
import { VIREGLASS_SHEET_MATERIAL, type VireGlassMaterial, type VireGlassMorph } from 'vireglass';
import { ATOM_AT_REST, atomBody, atomMaterial, type AtomBody } from './atom';
import { intersectRect, type Rect, type Size } from './geometry';
import { growthFrame, smoothstep, type GrowthInk, type GrowthPhase, type GrowthPoint } from './morph';
import { unionBounds, unionOutline, type OutlinePoint } from './union';

/**
 * `disabled`: cannot be chosen. `focusable` (default: not disabled): whether focus can land on it. A native
 * disabled button cannot take focus, so the keyboard passes over it; an aria-disabled one can (WAI-ARIA APG).
 */
export type MenuItem = { label: string; disabled: boolean; focusable?: boolean };

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

const exists = (items: readonly MenuItem[], i: number) => i >= 0 && i < items.length;
const enabled = (items: readonly MenuItem[], i: number) => exists(items, i) && !items[i]!.disabled;
const reachable = (items: readonly MenuItem[], i: number) => exists(items, i) && (items[i]!.focusable ?? !items[i]!.disabled);

function seek(items: readonly MenuItem[], from: number, step: 1 | -1): number {
  const n = items.length;
  for (let k = 1; k <= n; k += 1) {
    const i = (((from + step * k) % n) + n) % n;
    if (reachable(items, i)) return i;
  }
  return -1;
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
    if (reachable(items, i) && items[i]!.label.trim().toLowerCase().startsWith(needle)) {
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
      if (!reachable(items, event.index) || event.index === state.active) return stay;
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

/** Where a menu must stay: its trigger's segment of the window, the whole viewport when nothing folds it. A size
 *  alone is a region at the origin. */
export type MenuRegion = Size & { x?: number; y?: number };

/** The trigger's corner nearest the corner of its region it sits in: the open space lies away from it. */
export function menuCorner(trigger: Rect, region: MenuRegion): MenuCorner {
  const x0 = region.x ?? 0;
  const y0 = region.y ?? 0;
  return {
    x: trigger.x + trigger.width / 2 <= x0 + region.width / 2 ? -1 : 1,
    y: trigger.y + trigger.height / 2 <= y0 + region.height / 2 ? -1 : 1,
  };
}

function along(start: number, length: number, size: number, side: -1 | 1): number {
  return side < 0 ? start : start + length - size;
}

function fits(at: number, size: number, lo: number, hi: number, margin: number): boolean {
  return at >= lo + margin && at + size <= hi - margin;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The menu shares a corner with its trigger and covers it. An automatic corner flips on an axis where the menu would
 * leave its region and the other side fits; then it slides in. The region is the trigger's segment, so a menu never
 * crosses a fold.
 */
export function menuPlacement(
  trigger: Rect,
  menu: Size,
  region: MenuRegion,
  options: { corner?: MenuCorner | undefined; margin?: number } = {},
): MenuPlacement {
  const margin = options.margin ?? 8;
  const x0 = region.x ?? 0;
  const y0 = region.y ?? 0;
  const x1 = x0 + region.width;
  const y1 = y0 + region.height;
  const width = Math.max(0, Math.min(menu.width, region.width - 2 * margin));
  const height = Math.max(0, Math.min(menu.height, region.height - 2 * margin));
  const corner: { x: -1 | 1; y: -1 | 1 } = { ...(options.corner ?? menuCorner(trigger, region)) };
  let x = along(trigger.x, trigger.width, width, corner.x);
  let y = along(trigger.y, trigger.height, height, corner.y);
  if (!options.corner) {
    const fx = along(trigger.x, trigger.width, width, corner.x === -1 ? 1 : -1);
    if (!fits(x, width, x0, x1, margin) && fits(fx, width, x0, x1, margin)) {
      corner.x = corner.x === -1 ? 1 : -1;
      x = fx;
    }
    const fy = along(trigger.y, trigger.height, height, corner.y === -1 ? 1 : -1);
    if (!fits(y, height, y0, y1, margin) && fits(fy, height, y0, y1, margin)) {
      corner.y = corner.y === -1 ? 1 : -1;
      y = fy;
    }
  }
  x = clamp(x, x0 + margin, x1 - margin - width);
  y = clamp(y, y0 + margin, y1 - margin - height);
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
  /** The second shape for the lens's `setMorph`, offset from the box's centre; undefined once there is one body, and
   *  when the outline is asked for, which draws the second shape into the silhouette instead. */
  morph: VireGlassMorph | undefined;
  /** The silhouette of one body made of two shapes (a drop rising out of its source or merging back into it), relative to
   *  `box`, which then holds both; undefined while one shape is the body. */
  outline: OutlinePoint[] | undefined;
  /** Where the content's origin sits relative to the box's: it keeps its final place while the box moves. */
  content: { x: number; y: number };
  ink: GrowthInk;
  /** How much of a drop the surface is: 0 as the trigger and as the menu, highest in between. */
  activity: number;
  /** 1 while the surface is still the trigger's capsule, whose glyphs show through its glass: 0 once the drop has formed. */
  capsule: number;
};

const center = (r: Rect): GrowthPoint => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** The lens's smoothing is a fusion margin; the outline's neck is the distance over which two shapes blend. */
const OUTLINE_NECK = 2;

// The drop is brightest as it forms and has lost its lift by the time the menu has reached size.
const ACTIVITY_FALLS_FROM = 0.45;
const ACTIVITY_FALLS_TO = 1;

// What is left of the lift once the body has its size, until the content is in focus.
const ACTIVITY_TAIL = 0.5;

// The capsule's glyphs are seen through the lens until the drop has formed.
const CAPSULE_FROM = 0.45;
const CAPSULE_TO = 0.9;

export function menuCapsule(phase: GrowthPhase): number {
  return 1 - smoothstep(CAPSULE_FROM, CAPSULE_TO, Math.min(Math.max(phase.shrink, 0), 1));
}

export function menuActivity(phase: GrowthPhase): number {
  const shrink = Math.min(Math.max(phase.glow ?? phase.shrink, 0), 1);
  const unfocused = 1 - Math.min(Math.max(phase.focus ?? 1, 0), 1);
  const sized = smoothstep(ACTIVITY_FALLS_FROM, ACTIVITY_FALLS_TO, Math.max(phase.grow, 0));
  return shrink * (1 - sized * (1 - ACTIVITY_TAIL * unfocused));
}

/** `bounds`, the menu's region, holds every frame inside it: the overshoot runs away from the anchor and could
 *  otherwise reach over a fold for a few frames. */
export function menuSurfaceFrame(
  trigger: RoundedRect,
  menu: RoundedRect,
  anchor: GrowthPoint,
  phase: GrowthPhase,
  bounds?: Rect,
  options: { outline?: boolean } = {},
): MenuSurfaceFrame {
  const frame = growthFrame(
    { geometry: { width: trigger.width, height: trigger.height, cornerRadius: trigger.radius }, center: center(trigger) },
    { geometry: { width: menu.width, height: menu.height, cornerRadius: menu.radius }, center: center(menu) },
    anchor,
    phase,
  );
  const { geometry, center: c } = frame.body;
  let box = {
    x: c.x - geometry.width / 2,
    y: c.y - geometry.height / 2,
    width: geometry.width,
    height: geometry.height,
    radius: geometry.cornerRadius,
  };
  let morph = frame.merge;
  let outline: OutlinePoint[] | undefined;
  if (options.outline && morph) {
    const other = {
      x: c.x + morph.offsetX - morph.width / 2,
      y: c.y + morph.offsetY - morph.height / 2,
      width: morph.width,
      height: morph.height,
      radius: morph.cornerRadius,
    };
    const both = unionBounds(box, other);
    outline = unionOutline(box, other, morph.smoothing * OUTLINE_NECK, both);
    box = { ...both, radius: box.radius };
    morph = undefined;
  }
  const held = bounds ? intersectRect(box, bounds) : null;
  if (held && (held.width < box.width || held.height < box.height)) {
    const was = center(box);
    const now = center(held);
    const shift = { x: held.x - box.x, y: held.y - box.y };
    box = { ...held, radius: Math.min(box.radius, held.width / 2, held.height / 2) };
    if (morph) morph = { ...morph, offsetX: morph.offsetX + was.x - now.x, offsetY: morph.offsetY + was.y - now.y };
    if (outline) outline = outline.map((p) => ({ x: p.x - shift.x, y: p.y - shift.y }));
  }
  return {
    box,
    morph,
    outline,
    content: { x: menu.x - box.x, y: menu.y - box.y },
    ink: frame.ink,
    activity: menuActivity(phase),
    capsule: menuCapsule(phase),
  };
}

/** A menu is a larger piece of the same glass, and a larger piece scatters light more softly (M 7:19): it
 *  takes the core's sheet scattering, which turns text under it into soft spots without turning it to mush. */
export function menuGlass(base: VireGlassMaterial): VireGlassMaterial {
  return { ...base, roughness: Math.max(base.roughness, VIREGLASS_SHEET_MATERIAL.roughness) };
}

/** The drop is the medium at its active end, the menu at rest is the resting glass. While the surface is still the
 *  trigger's capsule (`capsule` 1) it scatters as the trigger's own glass does, so its glyphs stay legible. */
export function menuMaterial(base: VireGlassMaterial, activity: number, capsule = 0): VireGlassMaterial {
  const sheet = menuGlass(base);
  const roughness = sheet.roughness + (base.roughness - sheet.roughness) * capsule;
  return atomMaterial({ ...sheet, roughness }, 'menu', { ...ATOM_AT_REST, pressed: activity });
}

/** The drop: opaque, a fifth white and lifted over what it covers, so white over a light backdrop and only brighter over a dark one. */
export const MENU_DROP_BODY: AtomBody = { alpha: 1, white: 0.2, lift: 0.3 };

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

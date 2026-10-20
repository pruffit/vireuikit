// The selection is a knob on the bar: a press lifts it into a lens under the finger, it follows the finger
// continuously, stretched along the motion, and lands on the nearest item when let go.
import type { MorphBox } from '../adaptive/form-morph';
import { stepSpring, type Spring } from '../morph';
import { NAV_SIZES, type NavLayout } from './layout';

export type NavDragState = {
  active: boolean;
  /** The lens's centre. */
  x: Spring;
  lift: Spring;
  /** 0..MAX_STRETCH: how much wider (and half as much lower) the lens is for the pointer's speed. */
  stretch: number;
  /** The item under the lens. */
  index: number;
  lastX: number;
};

const MAX_STRETCH = 0.25;
const SATURATION_SPEED = 1500;
const STRETCH_TAU = 0.05;
const OVERHANG = 4;
// Half the widest glyph an item draws, badge and label included; what the lens covers is measured against it.
const GLYPH_HALF = 26;
const LAND = { response: 0.2, damping: 0.8 } as const;
const LIFT = { response: 0.2, damping: 1 } as const;

export const createNavDrag = (): NavDragState => ({
  active: false,
  x: { x: 0, v: 0, target: 0 },
  lift: { x: 0, v: 0, target: 0 },
  stretch: 0,
  index: 0,
  lastX: 0,
});

const draggable = (layout: NavLayout) => layout.form === 'bar' && !layout.minimized && layout.items.length > 0;

function lensSize(layout: NavLayout) {
  const cell = layout.items[0]!;
  const pad = 2 * NAV_SIZES.lens.inflate;
  return { width: cell.width + pad, height: cell.height + pad };
}

function clampCentre(layout: NavLayout, x: number): number {
  const half = lensSize(layout).width / 2;
  const { body } = layout;
  return Math.min(Math.max(x, body.x + half - OVERHANG), body.x + body.width - half + OVERHANG);
}

function indexAt(layout: NavLayout, x: number): number {
  const first = layout.items[0]!;
  const i = Math.floor((x - first.x) / first.width);
  return Math.min(Math.max(i, 0), layout.items.length - 1);
}

const centreOf = (layout: NavLayout, index: number) => layout.items[index]!.x + layout.items[index]!.width / 2;

function drop(state: NavDragState): void {
  state.active = false;
  state.lift.x = 0;
  state.lift.v = 0;
  state.lift.target = 0;
}

function settleTowards(state: NavDragState, layout: NavLayout, index: number): void {
  state.active = false;
  state.index = index;
  state.x.target = centreOf(layout, index);
  state.lift.target = 0;
}

/** Bar form only; elsewhere a press is just a press. */
export function pressNavDrag(state: NavDragState, layout: NavLayout, pointerX: number): void {
  if (!draggable(layout)) return;
  const x = clampCentre(layout, pointerX);
  state.active = true;
  state.x.x = x;
  state.x.v = 0;
  state.x.target = x;
  state.lift.target = 1;
  state.stretch = 0;
  state.lastX = pointerX;
  state.index = indexAt(layout, x);
}

export function moveNavDrag(state: NavDragState, layout: NavLayout, pointerX: number, dt: number): void {
  if (!state.active || !draggable(layout)) return;
  const x = clampCentre(layout, pointerX);
  state.x.x = x;
  state.x.v = 0;
  state.x.target = x;
  const speed = dt > 0 ? Math.abs(pointerX - state.lastX) / dt : 0;
  const goal = MAX_STRETCH * Math.min(speed / SATURATION_SPEED, 1);
  state.stretch += (goal - state.stretch) * (dt > 0 ? 1 - Math.exp(-dt / STRETCH_TAU) : 1);
  state.lastX = pointerX;
  state.index = indexAt(layout, x);
}

/** The nearest item; the lens springs to it and its lift falls to 0. Where the layout is not a bar the press just ends. */
export function releaseNavDrag(state: NavDragState, layout: NavLayout): number {
  if (!draggable(layout)) {
    drop(state);
    return state.index;
  }
  const index = indexAt(layout, state.x.x);
  settleTowards(state, layout, index);
  return index;
}

/** A cancelled press settles back where it was. */
export function cancelNavDrag(state: NavDragState, layout: NavLayout, selected: number): void {
  if (!draggable(layout)) {
    drop(state);
    return;
  }
  const index = selected >= 0 && selected < layout.items.length ? selected : indexAt(layout, state.x.x);
  settleTowards(state, layout, index);
}

/** True while the lens is held or still moving. */
export function stepNavDrag(state: NavDragState, dt: number, reduceMotion = false): boolean {
  let moving = state.active;
  if (state.stretch > 0) {
    state.stretch *= Math.exp(-Math.max(dt, 0) / STRETCH_TAU);
    if (reduceMotion || state.stretch < 1e-3) state.stretch = 0;
    else moving = true;
  }
  if (!state.active && stepSpring(state.x, dt, LAND.response, LAND.damping, reduceMotion)) moving = true;
  if (stepSpring(state.lift, dt, LIFT.response, LIFT.damping, reduceMotion)) moving = true;
  return moving;
}

export function navDragFrame(state: NavDragState, layout: NavLayout): { lens: MorphBox; lift: number; hover: number } | null {
  if (!draggable(layout)) return null;
  const lift = Math.min(Math.max(state.lift.x, 0), 1);
  if (!state.active && lift === 0 && state.x.x === state.x.target) return null;
  const size = lensSize(layout);
  const width = size.width * (1 + state.stretch);
  const height = size.height * (1 - state.stretch / 2);
  const cy = layout.body.y + layout.body.height / 2;
  return {
    lens: { x: state.x.x - width / 2, y: cy - height / 2, width, height, radius: height / 2 },
    lift,
    hover: indexAt(layout, state.x.x),
  };
}

/** The items whose glyph lies under the lens: none is drawn there, so the lens's bevel never refracts a real glyph. */
export function itemsUnderLens(layout: NavLayout, lens: MorphBox): number[] {
  const under: number[] = [];
  layout.items.forEach((item, i) => {
    const centre = item.x + item.width / 2;
    if (lens.x < centre + GLYPH_HALF && lens.x + lens.width > centre - GLYPH_HALF) under.push(i);
  });
  return under;
}

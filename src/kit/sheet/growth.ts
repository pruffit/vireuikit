import type { MorphBox } from '../adaptive/form-morph';
import type { Size } from '../geometry';
import { menuSurfaceFrame, type MenuSurfaceFrame, type RoundedRect } from '../menu';
import { smoothstep, stepSpring, type GrowthInk, type GrowthPhase, type GrowthPoint, type Spring } from '../morph';
import { SHEET_GROWTH_TIMING, SHEET_SIZES } from './sizes';

/** A popover grows as the menu does: the trigger's body, a drop, the panel; one name for the element to call per kind. */
export function popoverGrowthFrame(
  trigger: RoundedRect,
  panel: RoundedRect,
  anchor: GrowthPoint,
  phase: GrowthPhase,
  bounds?: { x: number; y: number; width: number; height: number },
): MenuSurfaceFrame {
  return menuSurfaceFrame(trigger, panel, anchor, phase, bounds);
}

export type SheetGrowthFrame = {
  box: MorphBox;
  /** Where the content's origin sits relative to the box's: it keeps its final place while the box moves. */
  content: { x: number; y: number };
  /** `outgoing` is the trigger's glyph, `incoming` the sheet's content. */
  ink: GrowthInk;
};

const INK_OUT_END = 0.3;
const INK_IN_START = 0.9;
const INK_IN_END = 1;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Straight from the trigger's body to the sheet's box, with no drop; `t` is 0 at the trigger, 1 at the sheet, and may overshoot. */
export function sheetGrowthFrame(from: MorphBox, to: MorphBox, t: number): SheetGrowthFrame {
  const box = {
    x: mix(from.x, to.x, t),
    y: mix(from.y, to.y, t),
    width: Math.max(0, mix(from.width, to.width, t)),
    height: Math.max(0, mix(from.height, to.height, t)),
    radius: 0,
  };
  box.radius = Math.min(mix(from.radius, to.radius, smoothstep(0, 1, t)), box.width / 2, box.height / 2);
  return {
    box,
    content: { x: to.x - box.x, y: to.y - box.y },
    ink: { outgoing: 1 - smoothstep(0, INK_OUT_END, t), incoming: smoothstep(INK_IN_START, INK_IN_END, t) },
  };
}

/** The growth's single spring: 0 is the trigger, 1 the open sheet. */
export type SheetGrowthState = Spring;

export const createSheetGrowth = (): SheetGrowthState => ({ x: 0, v: 0, target: 0 });

/** Steps toward open or closed; true while moving. Closing runs the same path back with no overshoot. */
export function stepSheetGrowth(state: SheetGrowthState, dt: number, open: boolean, reduceMotion = false): boolean {
  const t = SHEET_GROWTH_TIMING;
  state.target = open ? 1 : 0;
  return stepSpring(state, dt, open ? t.growOpen : t.growClose, open ? t.growDampingOpen : 1, reduceMotion);
}

export type SheetEntryFrame = {
  box: MorphBox;
  ink: GrowthInk;
  /** 0 to 1: how far the scrim has come in. */
  scrim: number;
};

/** A surface with no trigger: from below the window's edge, or from 96 % of its size with the content coming in. */
export function sheetEntryFrame(box: MorphBox, t: number, from: 'bottom' | 'scale', window: Size): SheetEntryFrame {
  const scrim = Math.min(Math.max(t, 0), 1);
  if (from === 'bottom') {
    const hidden = window.height - box.y;
    return { box: { ...box, y: box.y + (1 - t) * hidden }, ink: { outgoing: 0, incoming: 1 }, scrim };
  }
  const s = mix(SHEET_SIZES.entryScale, 1, t);
  const width = box.width * s;
  const height = box.height * s;
  return {
    box: {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
      radius: box.radius * s,
    },
    ink: { outgoing: 0, incoming: smoothstep(0.2, 1, t) },
    scrim,
  };
}

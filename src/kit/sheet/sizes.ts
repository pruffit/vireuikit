// The sheet's numbers in dp. Fractions are of the window's height.
import { POPOVER_GROWTH_TIMING, smoothstep, type GrowthTiming } from '../morph';

export const SHEET_SIZES = {
  /** Detents closer than `merge` are one. */
  detent: { medium: 0.5, largeTopGap: 56, peekMin: 120, merge: 24 },
  /** 12 dp up to 30 % of the window, 6 dp at 55 %, flush from 90 %; linear between. */
  inset: { rest: 12, mid: 6, restUntil: 0.3, midAt: 0.55, flushAt: 0.9 },
  radius: { inset: 32, flush: 28 },
  /** Glass up to a quarter of the window, opaque from 90 %; any surface over a scrim, a popover as a sheet included, is never thinner than `overScrim`. */
  opacity: { glassUntil: 0.25, opaqueFrom: 0.9, overScrim: 0.6 },
  grabber: { width: 32, height: 4, hit: 44, top: 8 },
  /** The content's inset from the surface, and the strip at the top where a drag moves the sheet. */
  content: { pad: 16, handle: 28 },
  /** `stale`: a release this long after the last move is a finger that stopped, not a fling. */
  drag: { distance: 56, velocity: 125, zone: 125, stale: 0.1 },
  /** Fitted: about 0.4 s to rest on a 300 dp move, under 2 % overshoot (see the tests). */
  detentSpring: { response: 0.45, damping: 0.8 },
  side: { width: 360, min: 280, max: 400, fraction: 1 / 3, inset: 8, radius: 24 },
  dialog: { width: 560, alertWidth: 320, radius: 28 },
  /** The window minus this is the widest and tallest a centred surface gets. */
  windowGap: 48,
  entryScale: 0.96,
  growthSlowdown: 1.25,
  scrimAlpha: 0.32,
  popover: { maxWidth: 400, margin: 8, radius: 28 },
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const unit = (x: number) => Math.min(Math.max(x, 0), 1);

/** The side and bottom gap of a bottom sheet at `fraction` of the window's height. */
export function sheetInset(fraction: number): number {
  const { rest, mid, restUntil, midAt, flushAt } = SHEET_SIZES.inset;
  if (fraction <= restUntil) return rest;
  if (fraction <= midAt) return lerp(rest, mid, (fraction - restUntil) / (midAt - restUntil));
  if (fraction <= flushAt) return lerp(mid, 0, (fraction - midAt) / (flushAt - midAt));
  return 0;
}

/** 32 dp while inset, 28 dp flush; it follows the inset so the change is continuous. */
export function sheetRadius(fraction: number): number {
  const { inset, flush } = SHEET_SIZES.radius;
  return lerp(flush, inset, unit(sheetInset(fraction) / SHEET_SIZES.inset.rest));
}

/** 0 is glass, 1 is opaque. */
export function sheetOpacity(fraction: number): number {
  return smoothstep(SHEET_SIZES.opacity.glassUntil, SHEET_SIZES.opacity.opaqueFrom, fraction);
}

const SLOWED = Object.fromEntries(
  Object.entries(POPOVER_GROWTH_TIMING).map(([key, value]) => [key, key.includes('Damping') ? value : value * SHEET_SIZES.growthSlowdown]),
) as GrowthTiming;

/** The popover's pace slowed by a quarter, because a sheet's path is longer; it overshoots less on open. */
export const SHEET_GROWTH_TIMING: GrowthTiming = { ...SLOWED, growDampingOpen: 0.8, heightDampingOpen: 0.8, riseDampingOpen: 0.8 };

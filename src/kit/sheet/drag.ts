// The sheet follows the finger between its detents, meets resistance past the largest and springs to a detent on release.
import { stepSpring, type Spring } from '../morph';
import type { Size } from '../geometry';
import { SHEET_SIZES } from './sizes';

export type SheetDragState = {
  active: boolean;
  /** The sheet's height: the finger's while dragging, the detent spring's after. */
  height: Spring;
  /** dp/s, positive upward, smoothed over the last few moves. */
  velocity: number;
  startHeight: number;
  startPointer: number;
  lastPointer: number;
};

const VELOCITY_TAU = 0.05;

export const createSheetDrag = (): SheetDragState => ({
  active: false,
  height: { x: 0, v: 0, target: 0 },
  velocity: 0,
  startHeight: 0,
  startPointer: 0,
  lastPointer: 0,
});

export function pressSheetDrag(state: SheetDragState, height: number, pointerY: number): void {
  state.active = true;
  state.height.x = height;
  state.height.v = 0;
  state.height.target = height;
  state.velocity = 0;
  state.startHeight = height;
  state.startPointer = pointerY;
  state.lastPointer = pointerY;
}

/** What the zone makes of an overshoot: the finger's own at first, then less, never more than the zone. */
export function sheetResistance(over: number): number {
  const zone = SHEET_SIZES.drag.zone;
  return over <= 0 ? 0 : zone * (1 - Math.exp(-over / zone));
}

/** Moves the height with the finger (y grows downward); returns the height. `detents` ascend. */
export function moveSheetDrag(
  state: SheetDragState,
  pointerY: number,
  dt: number,
  detents: readonly number[],
  window: Size,
): number {
  if (!state.active) return state.height.x;
  const largest = detents.length > 0 ? detents[detents.length - 1]! : window.height;
  const raw = state.startHeight + state.startPointer - pointerY;
  const height = raw > largest ? largest + sheetResistance(raw - largest) : raw;
  const clamped = Math.min(Math.max(height, 0), window.height);
  if (dt > 0) {
    const instant = (state.lastPointer - pointerY) / dt;
    state.velocity += (instant - state.velocity) * Math.min(dt / VELOCITY_TAU, 1);
  }
  state.lastPointer = pointerY;
  state.height.x = clamped;
  state.height.v = 0;
  state.height.target = clamped;
  return clamped;
}

export type SheetRelease = { target: number } | { close: true };

/** The detent a release lands on, or a close; the height spring is left moving there with the finger's velocity. */
export function releaseSheetDrag(state: SheetDragState, detents: readonly number[], dismissible: boolean): SheetRelease {
  state.active = false;
  const { distance, velocity: fling } = SHEET_SIZES.drag;
  const h = state.height.x;
  const v = state.velocity;
  const lowest = detents[0] ?? h;
  const largest = detents[detents.length - 1] ?? h;
  const settle = (target: number): SheetRelease => {
    state.height.target = target;
    state.height.v = v;
    return { target };
  };
  if (h < lowest) {
    const below = lowest - h;
    if (dismissible && (below >= distance || v <= -fling)) return { close: true };
    return settle(lowest);
  }
  if (h >= largest) return settle(largest);
  if (Math.abs(v) >= fling) {
    const next = v > 0 ? detents.find((d) => d > h) : [...detents].reverse().find((d) => d < h);
    return settle(next ?? (v > 0 ? largest : lowest));
  }
  return settle(detents.reduce((best, d) => (Math.abs(d - h) < Math.abs(best - h) ? d : best), lowest));
}

/** Steps the height toward its detent on the detent spring; true while moving. */
export function stepSheetHeight(spring: Spring, dt: number, reduceMotion = false): boolean {
  return stepSpring(spring, dt, SHEET_SIZES.detentSpring.response, SHEET_SIZES.detentSpring.damping, reduceMotion);
}

export type SheetTouchAction = 'none' | 'pan-up' | 'pan-y';

/**
 * What the browser may do with a touch that starts in the content: scroll it while it has somewhere to go, and leave
 * the sheet the rest. At its top and below the largest detent both directions move the sheet; at the largest only a
 * downward drag does, upward is the content's.
 */
export function sheetTouchAction(scrollTop: number, height: number, detents: readonly number[]): SheetTouchAction {
  if (scrollTop > 0) return 'pan-y';
  const largest = detents[detents.length - 1] ?? height;
  return height < largest ? 'none' : 'pan-up';
}

/** Whether a drag that began in the content (`dy` positive downward) is the sheet's rather than the content's. */
export function sheetContentDrag(scrollTop: number, dy: number, height: number, detents: readonly number[]): boolean {
  if (scrollTop > 0 || dy === 0) return false;
  const largest = detents[detents.length - 1] ?? height;
  return dy > 0 || height < largest;
}

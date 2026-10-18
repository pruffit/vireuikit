import type { Rect, Size } from '../geometry';
import { SHEET_SIZES } from './sizes';

export type SheetKeyboard = {
  /** The height the sheet takes while the keyboard is up. */
  height: number;
  /** The y of the sheet's bottom edge: the visual viewport's bottom. */
  bottom: number;
  /** The detent to go back to when the keyboard leaves. */
  restore: number;
};

/** With the keyboard up the sheet rises to its largest detent that fits above it; `heights` ascend. */
export function sheetForKeyboard(heights: readonly number[], current: number, window: Size, visualViewport: Rect): SheetKeyboard {
  const bottom = Math.min(visualViewport.y + visualViewport.height, window.height);
  if (bottom >= window.height) return { height: current, bottom: window.height, restore: current };
  const largest = heights.length > 0 ? heights[heights.length - 1]! : current;
  return {
    height: Math.max(0, Math.min(largest, bottom - SHEET_SIZES.detent.largeTopGap)),
    bottom,
    restore: current,
  };
}

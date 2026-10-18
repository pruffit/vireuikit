import type { SurfaceKind } from '../adaptive/presentation';
import type { Size } from '../geometry';
import { SHEET_SIZES } from './sizes';

export type SheetDetent = 'peek' | 'medium' | 'large';

export type SheetDetentOptions = {
  /** Overrides the kind's own detents. */
  detents?: readonly SheetDetent[] | undefined;
  /** The content's own height, which is what `peek` is. */
  content?: number | undefined;
};

const DEFAULTS: Partial<Record<SurfaceKind, readonly SheetDetent[]>> = {
  sheet: ['medium', 'large'],
  popover: ['peek'],
};

/** The resting heights in dp of the detents a kind has, ascending and without repeats. */
export function sheetDetents(kind: SurfaceKind, window: Size, options: SheetDetentOptions = {}): number[] {
  const { detent } = SHEET_SIZES;
  const large = Math.max(0, window.height - detent.largeTopGap);
  const wanted = options.detents ?? DEFAULTS[kind] ?? ['large'];
  const heights: number[] = [];
  for (const name of wanted) {
    if (name === 'large') heights.push(large);
    else if (name === 'medium') heights.push(window.height * detent.medium);
    else if (options.content !== undefined) heights.push(Math.min(Math.max(options.content, detent.peekMin), large));
  }
  return [...new Set(heights)].sort((a, b) => a - b);
}

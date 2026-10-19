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

/** A resting height and every name that lands on it; `name` is the largest of them. */
export type NamedSheetDetent = { name: SheetDetent; height: number; names: SheetDetent[] };

const ORDER: readonly SheetDetent[] = ['peek', 'medium', 'large'];

const DEFAULTS: Partial<Record<SurfaceKind, readonly SheetDetent[]>> = {
  sheet: ['medium', 'large'],
  popover: ['peek'],
};

/** The detents a kind has before an author names any. */
export const defaultSheetDetents = (kind: SurfaceKind): readonly SheetDetent[] => DEFAULTS[kind] ?? ['large'];

/** What to hand `sheetDetents` as `content` so that `peek` shows all of it: the content and the gap the sheet floats above the window's edge. */
export const sheetPeekContent = (content: number): number => content + SHEET_SIZES.inset.rest;

/** The detents of a kind in a bottom sheet's region, ascending; `large` is always the tallest, and detents under 24 dp apart are one. */
export function namedSheetDetents(kind: SurfaceKind, extent: Size, options: SheetDetentOptions = {}): NamedSheetDetent[] {
  const { detent } = SHEET_SIZES;
  const wanted = options.detents ?? defaultSheetDetents(kind);
  const medium = extent.height * detent.medium;
  const large = Math.max(extent.height - detent.largeTopGap, wanted.includes('medium') ? medium : 0, 0);
  const found: { name: SheetDetent; height: number }[] = [];
  for (const name of wanted) {
    if (name === 'large') found.push({ name, height: large });
    else if (name === 'medium') found.push({ name, height: medium });
    else if (options.content !== undefined) found.push({ name, height: Math.min(Math.max(options.content, detent.peekMin), large) });
  }
  const list: NamedSheetDetent[] = [];
  for (const d of found.sort((a, b) => a.height - b.height)) {
    const last = list[list.length - 1];
    if (!last || d.height - last.height >= detent.merge) {
      list.push({ name: d.name, height: d.height, names: [d.name] });
      continue;
    }
    if (!last.names.includes(d.name)) last.names.push(d.name);
    if (ORDER.indexOf(d.name) > ORDER.indexOf(last.name)) {
      last.name = d.name;
      last.height = d.height;
    }
  }
  return list;
}

/** The resting heights in dp of the detents a kind has, ascending and without repeats. */
export const sheetDetents = (kind: SurfaceKind, extent: Size, options: SheetDetentOptions = {}): number[] =>
  namedSheetDetents(kind, extent, options).map((d) => d.height);

/** The words of a `detent-labels` attribute, `peek=Small; medium=Half; large=Full`, by detent. */
export function parseDetentLabels(value: string | null): Partial<Record<SheetDetent, string>> {
  const labels: Partial<Record<SheetDetent, string>> = {};
  for (const part of (value ?? '').split(';')) {
    const at = part.indexOf('=');
    const name = part.slice(0, at).trim() as SheetDetent;
    const text = part.slice(at + 1).trim();
    if (at > 0 && ORDER.includes(name) && text) labels[name] = text;
  }
  return labels;
}

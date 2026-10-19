// A toolbar layout drawn in the toolbar's own coordinates: (0, 0) is its leading-top corner, a vertical one stacks along y.
import type { MorphBox } from '../adaptive/form-morph';
import {
  TOOLBAR_GAP,
  type ToolbarCapsule,
  type ToolbarItem,
  type ToolbarLayout,
} from '../adaptive/toolbar';
import { BUTTON_SIZES, type ControlSize } from '../sizes';

export type ToolbarGeometryOptions = {
  tier: ControlSize;
  /** The container's extent along the toolbar, dp. */
  available: number;
  gap?: number;
  /** Capsules after the one holding this item (or group) align to the trailing end; without it they pack from the leading edge. */
  spacerAfter?: string;
  /** Resolves a group id in `spacerAfter` and the default width of an unmeasured text item in the strip's row. */
  items?: readonly ToolbarItem[];
  /** Measured text widths by item id; unmeasured ones share what the layout left. */
  textWidths?: Readonly<Record<string, number>>;
};

export type ToolbarCapsuleBox = { kind: ToolbarCapsule['kind']; items: readonly string[]; box: MorphBox };

/** What a frame leaves behind for a morph that goes on from it (see `aimToolbarMorph`); absent on a layout at rest. */
export type ToolbarCarry = { ink: Readonly<Record<string, number>>; morePresence: number; smoothing: number };

export type ToolbarGeometry = {
  orientation: ToolbarLayout['orientation'];
  extent: number;
  /** The tier's height: a slot's cross size and an icon slot's length. */
  side: number;
  /** The capsules and the main action, in layout order; "…" is `more`. */
  capsules: readonly ToolbarCapsuleBox[];
  slots: Readonly<Record<string, MorphBox>>;
  more: MorphBox | null;
  /** The text row at a vertical strip's foot. */
  aside: { box: MorphBox; slots: Readonly<Record<string, MorphBox>> } | null;
  carry?: ToolbarCarry;
};

export function toolbarGeometry(layout: ToolbarLayout, options: ToolbarGeometryOptions): ToolbarGeometry {
  const side = BUTTON_SIZES[options.tier].height;
  const gap = options.gap ?? TOOLBAR_GAP;
  const vertical = layout.orientation === 'vertical';
  const box = (start: number, length: number): MorphBox =>
    vertical
      ? { x: 0, y: start, width: side, height: length, radius: side / 2 }
      : { x: start, y: 0, width: length, height: side, radius: side / 2 };

  const widthsOf = (c: ToolbarCapsule): number[] => {
    if (c.kind === 'more' || c.kind === 'icon') return c.items.map(() => side);
    const measured = c.items.map((id) => options.textWidths?.[id]);
    const known = measured.reduce<number>((sum, w) => sum + (w ?? 0), 0);
    const unknown = measured.filter((w) => w === undefined).length;
    const rest = unknown ? Math.max(c.extent - known, 0) / unknown : 0;
    return measured.map((w) => w ?? rest);
  };

  const widths = layout.capsules.map(widthsOf);
  const lengths = widths.map((ws) => ws.reduce((sum, w) => sum + w, 0));
  const groupOf = new Map((options.items ?? []).map((i) => [i.id, i.group]));
  const itemWidths = new Map((options.items ?? []).map((i) => [i.id, i.width]));
  let spacer = -1;
  if (options.spacerAfter !== undefined) {
    layout.capsules.forEach((c, i) => {
      if (c.items.some((id) => id === options.spacerAfter || groupOf.get(id) === options.spacerAfter)) spacer = i;
    });
  }

  const starts: number[] = [];
  let cursor = 0;
  for (let i = 0; i <= spacer || (spacer < 0 && i < lengths.length); i++) {
    starts[i] = cursor;
    cursor += lengths[i]! + gap;
  }
  if (spacer >= 0 && spacer < lengths.length - 1) {
    const trail = lengths.slice(spacer + 1);
    const total = trail.reduce((sum, l) => sum + l, 0) + gap * (trail.length - 1);
    cursor = Math.max(cursor, options.available - total);
    for (let i = spacer + 1; i < lengths.length; i++) {
      starts[i] = cursor;
      cursor += lengths[i]! + gap;
    }
  }

  const capsules: ToolbarCapsuleBox[] = [];
  const slots: Record<string, MorphBox> = {};
  let more: MorphBox | null = null;
  let end = 0;
  layout.capsules.forEach((c, i) => {
    const start = starts[i]!;
    end = Math.max(end, start + lengths[i]!);
    if (c.kind === 'more') {
      more = box(start, lengths[i]!);
      return;
    }
    capsules.push({ kind: c.kind, items: c.items, box: box(start, lengths[i]!) });
    let at = start;
    c.items.forEach((id, k) => {
      slots[id] = box(at, widths[i]![k]!);
      at += widths[i]![k]!;
    });
  });

  let aside: ToolbarGeometry['aside'] = null;
  if (layout.aside.length) {
    const asideWidths = layout.aside.map((id) => options.textWidths?.[id] ?? itemWidths.get(id) ?? 3 * side);
    const foot = Math.max(end + (layout.capsules.length ? gap : 0), options.available - side);
    const asideSlots: Record<string, MorphBox> = {};
    let x = 0;
    layout.aside.forEach((id, k) => {
      asideSlots[id] = { x, y: foot, width: asideWidths[k]!, height: side, radius: side / 2 };
      x += asideWidths[k]!;
    });
    aside = { box: { x: 0, y: foot, width: x, height: side, radius: side / 2 }, slots: asideSlots };
  }

  return { orientation: layout.orientation, extent: end, side, capsules, slots, more, aside };
}


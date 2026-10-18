// A toolbar fits its container: neighbours merge into one capsule first, then the lowest priorities go into "…".
// Functions stay; only how many are visible changes, so every item is on the toolbar, in "…" or in the text row.
import { BUTTON_SIZES, type ControlSize } from '../sizes';
import { classifyWindow } from './classes';
import type { AdaptiveContext } from './context';

export type ToolbarItem = {
  id: string;
  kind: 'icon' | 'text';
  /** Higher stays visible longer; 0 by default. */
  priority?: number;
  /** A status on the item: it stays visible at any width. */
  badge?: boolean;
  /** The one tinted main action. It goes to the trailing end and never overflows. */
  primary?: boolean;
  /** Items of one group merge into one capsule; without it, neighbours of a kind share a group. */
  group?: string;
  /** A text item's width in dp, measured by the target; three tier heights by default. An icon is the tier's square. */
  width?: number;
};

export type ToolbarOrientation = 'horizontal' | 'vertical';

export type ToolbarOptions = {
  /** The container's extent along the toolbar, dp. */
  available: number;
  tier: ControlSize;
  orientation?: ToolbarOrientation;
  maxGroups?: number;
  gap?: number;
};

export type ToolbarCapsule = { kind: 'icon' | 'text' | 'more' | 'primary'; items: readonly string[]; extent: number };

export type ToolbarLayout = {
  orientation: ToolbarOrientation;
  stage: 'separate' | 'merged' | 'overflow';
  capsules: readonly ToolbarCapsule[];
  /** In "…", in their order. "…" exists only when this is not empty. */
  overflow: readonly string[];
  /** Text items of a vertical toolbar: text does not stand vertical, so they stay in a horizontal row. */
  aside: readonly string[];
  extent: number;
  /** False only when what may not overflow (status, the main action) is wider than the container. */
  fits: boolean;
};

export const TOOLBAR_GAP = 8;
export const MORE_ID = '…';

export type ToolbarPlacement = { edge: 'bottom' | 'top' | 'trailing'; orientation: ToolbarOrientation; maxGroups: number };

/** The window decides where a toolbar sits; its layout then follows its own container. */
export function toolbarPlacement(ctx: AdaptiveContext): ToolbarPlacement {
  const { width, height } = classifyWindow(ctx.window);
  if (height === 'compact') {
    return { edge: 'trailing', orientation: 'vertical', maxGroups: Number.POSITIVE_INFINITY };
  }
  if (width === 'compact') return { edge: 'bottom', orientation: 'horizontal', maxGroups: 3 };
  return { edge: 'top', orientation: 'horizontal', maxGroups: Number.POSITIVE_INFINITY };
}

type Entry = { item: ToolbarItem; index: number };

export function toolbarLayout(items: readonly ToolbarItem[], options: ToolbarOptions): ToolbarLayout {
  const orientation = options.orientation ?? 'horizontal';
  const gap = options.gap ?? TOOLBAR_GAP;
  const maxGroups = options.maxGroups ?? Number.POSITIVE_INFINITY;
  const side = BUTTON_SIZES[options.tier].height;
  const vertical = orientation === 'vertical';
  const aside = vertical ? items.filter((i) => i.kind === 'text').map((i) => i.id) : [];
  const pool: Entry[] = items.map((item, index) => ({ item, index })).filter((e) => !vertical || e.item.kind === 'icon');
  const extentOf = (item: ToolbarItem) => (item.kind === 'icon' ? side : (item.width ?? 3 * side));

  const lay = (visible: readonly Entry[], merge: boolean, more: boolean) => {
    const ordered = [...visible.filter((e) => !e.item.primary)];
    const capsules: ToolbarCapsule[] = [];
    let open: { kind: 'icon' | 'text'; group: string; items: string[]; extent: number } | null = null;
    const close = () => {
      if (open) capsules.push({ kind: open.kind, items: open.items, extent: open.extent });
      open = null;
    };
    for (const { item } of ordered) {
      const kind = item.kind;
      const group = item.group ?? `kind:${kind}`;
      if (merge && open && open.kind === kind && open.group === group) {
        open.items.push(item.id);
        open.extent += extentOf(item);
      } else {
        close();
        open = { kind, group, items: [item.id], extent: extentOf(item) };
      }
    }
    close();
    if (more) capsules.push({ kind: 'more', items: [MORE_ID], extent: side });
    for (const { item } of visible) if (item.primary) capsules.push({ kind: 'primary', items: [item.id], extent: extentOf(item) });
    const extent = capsules.reduce((sum, c) => sum + c.extent, 0) + gap * Math.max(capsules.length - 1, 0);
    return { capsules, extent, fits: extent <= options.available && capsules.length <= maxGroups };
  };

  const done = (stage: ToolbarLayout['stage'], laid: ReturnType<typeof lay>, overflow: readonly string[]): ToolbarLayout => ({
    orientation,
    stage,
    capsules: laid.capsules,
    overflow,
    aside,
    extent: laid.extent,
    fits: laid.fits,
  });

  const separate = lay(pool, false, false);
  if (separate.fits) return done('separate', separate, []);
  const merged = lay(pool, true, false);
  if (merged.fits) return done('merged', merged, []);

  // Lowest priority first; among equals, the one nearest the trailing end.
  const candidates = pool
    .filter((e) => !e.item.badge && !e.item.primary)
    .sort((a, b) => (a.item.priority ?? 0) - (b.item.priority ?? 0) || b.index - a.index);
  let visible = pool;
  const hidden: Entry[] = [];
  let laid = merged;
  for (const candidate of candidates) {
    visible = visible.filter((e) => e !== candidate);
    hidden.push(candidate);
    laid = lay(visible, true, true);
    if (laid.fits) break;
  }
  if (!hidden.length) return done('merged', merged, []);
  return done('overflow', laid, hidden.sort((a, b) => a.index - b.index).map((e) => e.item.id));
}

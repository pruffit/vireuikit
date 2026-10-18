// The navigation's boxes: where the bar, the rail and the sidebar put their body, items, pill, search and accessory.
// All in window coordinates, dp; the morph and the drag read these and invent no geometry of their own.
import type { MorphBox } from '../adaptive/form-morph';
import { bottomAccessory, type BottomAccessoryForm, type NavigationFormKind, type SearchForm } from '../adaptive/navigation';
import type { Size } from '../geometry';

export const NAV_SIZES = {
  bar: { height: 56, item: 74, minItem: 44, inset: 3, margin: 16, searchGap: 8, minimized: 44 },
  rail: { width: 80, item: 56, gap: 4, padding: 8, margin: 8, head: 48 },
  sidebar: { width: 280, row: { touch: 44, pointer: 36 }, padding: 8, margin: 8, head: 48, separator: 12 },
  accessory: { height: 48, gap: 8, inline: 44, content: 56, margin: 8 },
  lens: { inflate: 6 },
  toggle: 44,
} as const;

export type NavLayoutInput = {
  form: NavigationFormKind;
  /** The bar as a circle with the search circle; ignored on the other forms. */
  minimized?: boolean;
  window: Size;
  /** Primary destinations shown. */
  items: number;
  /** Rows shown only in the sidebar. */
  secondary: number;
  search: SearchForm | null;
  /** Index into the primary destinations, then the secondary; -1 for none. */
  selected: number;
  tier: 'touch' | 'pointer';
  /** The rail's or sidebar's head holds a toggle. */
  toggle: boolean;
  accessory?: boolean;
  /** The safe area at the bottom. */
  bottomInset?: number;
};

export type NavLayout = {
  form: NavigationFormKind;
  minimized: boolean;
  body: MorphBox;
  /** Primary, then secondary; the bar has only primary. A minimised bar's items all lie on its circle. */
  items: MorphBox[];
  pill: MorphBox | null;
  /** The bar's separate circle, or the search item (rail) or field (sidebar) inside the body. */
  search: MorphBox | null;
  accessory: MorphBox | null;
  /** The toggle in the head of the rail or sidebar; null where the head holds none. */
  toggle: MorphBox | null;
  accessoryPlacement: BottomAccessoryForm['placement'] | null;
  /** What the content must clear. */
  insets: { bottom: number; start: number };
};

const box = (x: number, y: number, width: number, height: number, radius: number): MorphBox => ({ x, y, width, height, radius });

function barLayout(input: NavLayoutInput, items: number, minimized: boolean): NavLayout {
  const { bar, accessory } = NAV_SIZES;
  const { width, height } = input.window;
  const bottom = Math.max(input.bottomInset ?? 0, bar.margin);
  const hasSearch = input.search?.form === 'button';
  const placement = input.accessory ? bottomAccessory({ form: 'bar' }, { barMinimized: minimized }).placement : null;
  const selected = input.selected >= 0 && input.selected < items ? input.selected : -1;

  if (minimized) {
    const centre = height - bottom - bar.height / 2;
    const d = bar.minimized;
    const body = box(bar.margin, centre - d / 2, d, d, d / 2);
    const search = hasSearch ? box(width - bar.margin - d, body.y, d, d, d / 2) : null;
    let acc: MorphBox | null = null;
    if (placement) {
      const x = body.x + d + accessory.gap;
      const right = search ? search.x - accessory.gap : width - bar.margin;
      acc = box(x, body.y, Math.max(0, right - x), accessory.inline, accessory.inline / 2);
    }
    return {
      form: 'bar',
      minimized: true,
      body,
      items: Array.from({ length: items }, () => ({ ...body })),
      pill: selected >= 0 ? { ...body } : null,
      search,
      accessory: acc,
      toggle: null,
      accessoryPlacement: placement,
      insets: { bottom: height - body.y, start: 0 },
    };
  }

  const searchBlock = hasSearch ? bar.height + bar.searchGap : 0;
  const fit = items > 0 ? (width - 2 * bar.margin - searchBlock - 2 * bar.inset) / items : bar.item;
  const itemWidth = Math.max(bar.minItem, Math.min(bar.item, fit));
  const bodyWidth = items * itemWidth + 2 * bar.inset;
  const x = Math.max(bar.margin, (width - bodyWidth - searchBlock) / 2);
  const body = box(x, height - bottom - bar.height, bodyWidth, bar.height, bar.height / 2);
  const cellHeight = bar.height - 2 * bar.inset;
  const cells = Array.from({ length: items }, (_, i) =>
    box(x + bar.inset + i * itemWidth, body.y + bar.inset, itemWidth, cellHeight, cellHeight / 2),
  );
  const search = hasSearch ? box(x + bodyWidth + bar.searchGap, body.y, bar.height, bar.height, bar.height / 2) : null;
  let acc: MorphBox | null = null;
  if (placement) {
    acc = box(body.x, body.y - accessory.gap - accessory.height, bodyWidth + searchBlock, accessory.height, accessory.height / 2);
  }
  return {
    form: 'bar',
    minimized: false,
    body,
    items: cells,
    pill: selected >= 0 ? { ...cells[selected]! } : null,
    search,
    accessory: acc,
    toggle: null,
    accessoryPlacement: placement,
    insets: { bottom: height - body.y + (acc ? accessory.height + accessory.gap : 0), start: 0 },
  };
}

function contentAccessory(input: NavLayoutInput, start: number): { box: MorphBox | null; bottom: number } {
  const { accessory } = NAV_SIZES;
  const base = input.bottomInset ?? 0;
  if (!input.accessory) return { box: null, bottom: base };
  const bottom = Math.max(base, accessory.margin);
  const width = Math.max(0, input.window.width - start - accessory.margin);
  const acc = box(start, input.window.height - bottom - accessory.content, width, accessory.content, accessory.content / 2);
  return { box: acc, bottom: bottom + accessory.content };
}

/** A square centred in the head strip, `dx` from the body's leading edge. */
function headToggle(body: MorphBox, padding: number, head: number, dx: number): MorphBox {
  const d = NAV_SIZES.toggle;
  return box(body.x + dx, body.y + padding + (head - d) / 2, d, d, d / 2);
}

function inset(b: MorphBox, d: number): MorphBox {
  return box(b.x + d, b.y + d, b.width - 2 * d, b.height - 2 * d, (Math.min(b.width, b.height) - 2 * d) / 2);
}

function railLayout(input: NavLayoutInput, items: number): NavLayout {
  const { rail, bar } = NAV_SIZES;
  const hasSearch = input.search?.form === 'item';
  const n = items + (hasSearch ? 1 : 0);
  const head = input.toggle ? rail.head : 0;
  const natural = rail.padding * 2 + head + n * rail.item + Math.max(n - 1, 0) * rail.gap;
  // A rail taller than its window stops at the window's edge, as the sidebar does; the rows run past it and scroll.
  const height = Math.min(natural, Math.max(input.window.height - 2 * rail.margin, 0));
  // The item's radius 24 plus the 4 dp the body keeps around its corner: concentric with the item.
  const body = box(rail.margin, rail.margin, rail.width, height, 28);
  const cell = (i: number) =>
    box(body.x + rail.padding, body.y + rail.padding + head + i * (rail.item + rail.gap), rail.width - 2 * rail.padding, rail.item, 24);
  const cells = Array.from({ length: items }, (_, i) => cell(i));
  const selected = input.selected >= 0 && input.selected < items ? input.selected : -1;
  const start = body.x + body.width + rail.margin;
  const acc = contentAccessory(input, start);
  return {
    form: 'rail',
    minimized: false,
    body,
    items: cells,
    pill: selected >= 0 ? inset(cells[selected]!, bar.inset) : null,
    search: hasSearch ? cell(items) : null,
    accessory: acc.box,
    toggle: input.toggle ? headToggle(body, rail.padding, rail.head, (rail.width - NAV_SIZES.toggle) / 2) : null,
    accessoryPlacement: acc.box ? 'content-bottom' : null,
    insets: { bottom: acc.bottom, start },
  };
}

function sidebarLayout(input: NavLayoutInput, items: number, secondary: number): NavLayout {
  const { sidebar } = NAV_SIZES;
  const row = sidebar.row[input.tier];
  const body = box(sidebar.margin, sidebar.margin, sidebar.width, input.window.height - 2 * sidebar.margin, 24);
  const rowWidth = sidebar.width - 2 * sidebar.padding;
  const rowAt = (y: number) => box(body.x + sidebar.padding, y, rowWidth, row, row / 2);
  let y = body.y + sidebar.padding + (input.toggle ? sidebar.head : 0);
  let search: MorphBox | null = null;
  if (input.search?.form === 'field') {
    search = rowAt(y);
    y += row;
  }
  const cells: MorphBox[] = [];
  for (let i = 0; i < items; i += 1, y += row) cells.push(rowAt(y));
  if (secondary > 0) y += sidebar.separator;
  for (let i = 0; i < secondary; i += 1, y += row) cells.push(rowAt(y));
  const selected = input.selected >= 0 && input.selected < cells.length ? input.selected : -1;
  const start = body.x + body.width + sidebar.margin;
  const acc = contentAccessory(input, start);
  return {
    form: 'sidebar',
    minimized: false,
    body,
    items: cells,
    pill: selected >= 0 ? { ...cells[selected]! } : null,
    search,
    accessory: acc.box,
    toggle: input.toggle ? headToggle(body, sidebar.padding, sidebar.head, sidebar.width - sidebar.padding - NAV_SIZES.toggle) : null,
    accessoryPlacement: acc.box ? 'content-bottom' : null,
    insets: { bottom: acc.bottom, start },
  };
}

export function navLayout(input: NavLayoutInput): NavLayout {
  const items = Math.max(0, Math.floor(input.items));
  const secondary = Math.max(0, Math.floor(input.secondary));
  if (input.form === 'bar') return barLayout(input, items, !!input.minimized);
  return input.form === 'rail' ? railLayout(input, items) : sidebarLayout(input, items, secondary);
}

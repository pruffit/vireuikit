import type { BackdropSample } from 'vireglass';
import type { VireControlElement, VireMenuElement } from 'vireuikit/web';

export const MENU_STATES = ['closed', 'growing', 'open', 'active', 'retracting'] as const;
export type MenuLabState = (typeof MENU_STATES)[number];

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const GLYPHS = {
  more: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>'),
  folder: svg('<path d="M3 7h6l2 2h10v10H3z"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  circle: svg('<circle cx="12" cy="12" r="8"/>'),
  triangle: svg('<path d="M12 4l9 16H3z"/>'),
  square: svg('<rect x="4" y="4" width="16" height="16" rx="2"/>'),
  hexagon: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>'),
  pin: svg('<path d="M9 3h6l-1 6 3 3H7l3-3zM12 12v9"/>'),
} as const;

export type MenuItemSpec = {
  label: string;
  log?: string;
  glyph?: keyof typeof GLYPHS;
  disabled?: boolean;
  /** Disabled the WAI-ARIA APG way: still focusable. */
  ariaDisabled?: boolean;
  force?: 'hover' | 'pressed';
};

export type MenuSpec = {
  id: string;
  size: string;
  glass: '1' | '0' | 'touch';
  sample: BackdropSample | null;
  trigger: { kind: 'icon' | 'button' | 'bare'; label: string; glyph?: keyof typeof GLYPHS };
  items: readonly MenuItemSpec[];
  force?: string | undefined;
  corner?: string | undefined;
};

export const SHARE_ITEMS: readonly MenuItemSpec[] = [
  { label: 'Copy link', log: 'copy', glyph: 'link' },
  { label: 'Rename', log: 'rename', glyph: 'pencil' },
  { label: 'Delete', log: 'delete', glyph: 'trash', disabled: true },
  { label: 'Remove from list', log: 'remove', glyph: 'folder' },
  { label: 'Pin', log: 'pin', glyph: 'pin', ariaDisabled: true },
  { label: 'Copy text', log: 'text', glyph: 'link' },
];

/** The first HTML of a menu: a platform popover that works with nothing defined. */
export function makeMenu(spec: MenuSpec): HTMLElement {
  const menu = document.createElement('vire-menu');
  menu.id = spec.id;
  // An empty size leaves the tier to the input, as a host that sets none would.
  if (spec.size) menu.setAttribute('size', spec.size);
  if (spec.glass !== '0') menu.setAttribute('glass', '');
  if (spec.force) menu.setAttribute('data-vire-force-state', spec.force);
  if (spec.corner) menu.setAttribute('corner', spec.corner);
  const listId = `${spec.id}-list`;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = `${spec.id}-trigger`;
  trigger.setAttribute('popovertarget', listId);
  if (spec.trigger.kind === 'icon') {
    trigger.setAttribute('aria-label', spec.trigger.label);
    trigger.innerHTML = GLYPHS[spec.trigger.glyph ?? 'more'];
  } else {
    trigger.textContent = spec.trigger.label;
  }
  if (spec.trigger.kind === 'bare') {
    menu.append(trigger);
  } else {
    const host = document.createElement(spec.trigger.kind === 'icon' ? 'vire-icon-button' : 'vire-button');
    if (spec.size) host.setAttribute('size', spec.size);
    if (spec.glass !== '0') host.setAttribute('glass', spec.glass === 'touch' ? 'touch' : 'present');
    host.append(trigger);
    if (spec.sample) (host as VireControlElement).sample = spec.sample;
    menu.append(host);
  }

  const list = document.createElement('div');
  list.id = listId;
  list.setAttribute('popover', '');
  for (const item of spec.items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('popovertarget', listId);
    button.setAttribute('popovertargetaction', 'hide');
    button.innerHTML = item.glyph ? GLYPHS[item.glyph] : '';
    button.append(item.label);
    if (item.log) button.dataset.log = item.log;
    if (item.disabled) button.disabled = true;
    if (item.ariaDisabled) button.setAttribute('aria-disabled', 'true');
    if (item.force) button.setAttribute('data-vire-force-state', item.force);
    list.append(button);
  }
  menu.append(list);
  if (spec.sample) (menu as VireMenuElement).sample = spec.sample;
  return menu;
}

const GALLERY_ITEMS: readonly MenuItemSpec[] = [
  { label: 'Copy link', glyph: 'link' },
  { label: 'Rename', glyph: 'pencil' },
  { label: 'Move', glyph: 'folder' },
  { label: 'Delete', glyph: 'trash', disabled: true },
];

/** A cell per state, the trigger at its bottom-left, so every menu grows up and to the right inside its own cell. */
export function menuGallery(rows: HTMLElement, states: readonly MenuLabState[], common: Pick<MenuSpec, 'size' | 'glass' | 'sample'>): void {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.atom = 'menu';
  const cells = document.createElement('div');
  cells.className = 'cells';
  for (const state of states) {
    const cell = document.createElement('div');
    cell.className = 'cell menu-cell';
    cell.dataset.state = state;
    const items = GALLERY_ITEMS.map((item, i) =>
      state === 'active' && i < 2 ? { ...item, force: i === 0 ? ('hover' as const) : ('pressed' as const) } : item,
    );
    cell.append(
      makeMenu({
        ...common,
        id: `menu-${state}`,
        trigger: { kind: 'icon', label: 'More', glyph: 'more' },
        items,
        force: state === 'active' ? 'open' : state,
        corner: 'bottom-left',
      }),
    );
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = state;
    cell.append(cap);
    cells.append(cell);
  }
  row.append(cells);
  rows.append(row);
}

/** Three menus to drive by hand and from the behaviour tests, with a focusable button on either side. */
export function menuSandbox(rows: HTMLElement, note: (text: string) => void, common: Pick<MenuSpec, 'size' | 'glass' | 'sample'>): void {
  const box = document.createElement('div');
  box.className = 'sandbox menu-sandbox';
  const plain = (id: string, label: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.textContent = label;
    b.addEventListener('click', () => note(`click:${id}`));
    return b;
  };
  const more = makeMenu({ ...common, id: 'more', trigger: { kind: 'icon', label: 'More', glyph: 'more' }, items: SHARE_ITEMS });
  const sort = makeMenu({
    ...common,
    id: 'sort',
    trigger: { kind: 'button', label: 'Sort' },
    items: [
      { label: 'Name', log: 'name' },
      { label: 'Date added', log: 'date' },
      { label: 'Size', log: 'size' },
    ],
  });
  const bare = makeMenu({
    ...common,
    id: 'bare',
    trigger: { kind: 'bare', label: 'Bare' },
    items: [
      { label: 'One', log: 'one' },
      { label: 'Two', log: 'two' },
    ],
  });
  box.append(plain('before', 'Before'), more, sort, bare, plain('after', 'After'));
  box.addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('[data-log]');
    if (item) note(`click:${item.dataset.log}`);
  });
  rows.append(box);
}

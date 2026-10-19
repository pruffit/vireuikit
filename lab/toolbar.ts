import type { BackdropSample } from 'vireglass';
import type { VireControlElement, VireMenuElement, VireSurfaceElement, VireToolbarElement } from 'vireuikit/web';

export const TOOLBAR_STAGES = ['separate', 'merged', 'overflow'] as const;
export type ToolbarLabStage = (typeof TOOLBAR_STAGES)[number];
export const TOOLBAR_PLACES = ['bottom', 'top', 'trailing'] as const;
export type ToolbarLabPlace = (typeof TOOLBAR_PLACES)[number];

/** The window each place is drawn in, in dp: a phone for the bottom, a pane for the top, a landscape phone for the strip. */
export const TOOLBAR_FRAMES: Record<ToolbarLabPlace, { width: number; height: number }> = {
  bottom: { width: 390, height: 460 },
  top: { width: 720, height: 300 },
  trailing: { width: 740, height: 360 },
};

type Glass = '1' | '0' | 'touch';

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICONS = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  share: svg('<path d="M12 15V4M8 8l4-4 4 4M5 12v7h14v-7"/>'),
  like: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  info: svg('<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.01"/>'),
  queue: svg('<path d="M5 6h14M5 12h14M5 18h8"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
} as const;

export type ToolbarSpec = {
  id: string;
  glass: Glass;
  sample: BackdropSample | null;
  place?: ToolbarLabPlace | undefined;
  /** The three surfaces as items: a menu, a popover and a sheet. Without them every item is a plain button. */
  surfaces?: boolean;
  /** Plain `<button>`s in place of the kit's controls. */
  bare?: boolean;
  attrs?: Record<string, string>;
};

const control = (spec: ToolbarSpec, tag: 'vire-button' | 'vire-icon-button', inner: HTMLButtonElement, attrs: Record<string, string> = {}): HTMLElement => {
  const host = document.createElement(tag);
  if (spec.glass !== '0') host.setAttribute('glass', spec.glass === 'touch' ? 'touch' : 'present');
  for (const [name, value] of Object.entries(attrs)) host.setAttribute(name, value);
  host.append(inner);
  if (spec.sample) (host as VireControlElement).sample = spec.sample;
  return host;
};

const button = (label: string | null, glyph: keyof typeof ICONS | null, text?: string, extra = ''): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.innerHTML = `${glyph ? ICONS[glyph] : ''}${text ?? ''}${extra}`;
  return b;
};

const group = (...children: Node[]): HTMLElement => {
  const g = document.createElement('div');
  g.setAttribute('data-group', '');
  g.append(...children);
  return g;
};

/** The first HTML of a toolbar: groups of buttons that work with nothing defined. */
export function makeToolbar(spec: ToolbarSpec): HTMLElement {
  const bar = document.createElement('vire-toolbar') as VireToolbarElement;
  bar.id = spec.id;
  bar.setAttribute('aria-label', 'Track actions');
  if (spec.glass !== '0') bar.setAttribute('glass', '');
  if (spec.place) bar.setAttribute('placement', spec.place);
  for (const [name, value] of Object.entries(spec.attrs ?? {})) bar.setAttribute(name, value);
  const withAttrs = (el: HTMLElement, attrs: Record<string, string>): HTMLElement => {
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  };
  const icon = (label: string, glyph: keyof typeof ICONS, attrs: Record<string, string> = {}, extra = ''): HTMLElement => {
    const b = button(label, glyph, undefined, extra);
    b.dataset.log = label;
    return spec.bare ? withAttrs(b, attrs) : control(spec, 'vire-icon-button', b, attrs);
  };
  const text = (label: string, attrs: Record<string, string> = {}): HTMLElement => {
    const b = button(null, null, label);
    b.dataset.log = label;
    return spec.bare ? withAttrs(b, attrs) : control(spec, 'vire-button', b, attrs);
  };

  const back = icon('Back', 'back', { 'data-priority': '9' });
  const share = icon('Share', 'share', { 'data-priority': '5' });
  const like = icon('Like', 'like', { 'data-priority': '6' }, '<span data-badge>2</span>');
  const edit = icon('Edit', 'edit', { 'data-priority': '2' });
  const trash = icon('Delete', 'trash', { 'data-priority': '1' });
  const done = text('Done', { 'data-primary': '', 'data-priority': '9' });

  let add: HTMLElement;
  const extras: HTMLElement[] = [];
  if (spec.surfaces) {
    const menu = document.createElement('vire-menu');
    menu.id = `${spec.id}-add`;
    if (spec.glass !== '0') menu.setAttribute('glass', '');
    const trigger = button('Add', 'add');
    trigger.id = `${spec.id}-add-trigger`;
    trigger.dataset.log = 'Add';
    trigger.setAttribute('popovertarget', `${spec.id}-add-list`);
    menu.append(spec.bare ? trigger : control(spec, 'vire-icon-button', trigger));
    const list = document.createElement('div');
    list.id = `${spec.id}-add-list`;
    list.setAttribute('popover', '');
    for (const [label, glyph] of [['New playlist', 'add'], ['Copy link', 'link']] as const) {
      const row = button(null, glyph, label);
      row.dataset.log = label;
      row.setAttribute('popovertarget', list.id);
      row.setAttribute('popovertargetaction', 'hide');
      list.append(row);
    }
    menu.append(list);
    menu.dataset.priority = '4';
    if (spec.sample) (menu as VireMenuElement).sample = spec.sample;
    add = menu;

    const surface = (tag: 'vire-popover' | 'vire-sheet', id: string, label: string, glyph: keyof typeof ICONS, priority: string): HTMLElement => {
      const host = document.createElement(tag);
      host.id = id;
      if (spec.glass !== '0') host.setAttribute('glass', '');
      if (tag === 'vire-sheet') host.setAttribute('kind', 'sheet');
      const trig = button(label, glyph);
      trig.id = `${id}-trigger`;
      trig.dataset.log = label;
      trig.setAttribute('popovertarget', `${id}-surface`);
      host.append(spec.bare ? trig : control(spec, 'vire-icon-button', trig));
      const body = document.createElement('div');
      body.id = `${id}-surface`;
      body.setAttribute('popover', '');
      body.innerHTML = `<h2>${label}</h2><p>${label} for this track.</p><button type="button" popovertarget="${id}-surface" popovertargetaction="hide" id="${id}-close">Close</button>`;
      host.append(body);
      host.dataset.priority = priority;
      if (spec.sample) (host as VireSurfaceElement).sample = spec.sample;
      return host;
    };
    extras.push(surface('vire-popover', `${spec.id}-info`, 'Info', 'info', '3'), surface('vire-sheet', `${spec.id}-queue`, 'Queue', 'queue', '2'));
  } else {
    add = icon('Add', 'add', { 'data-priority': '4' });
  }

  const spacer = document.createElement('div');
  spacer.setAttribute('data-spacer', '');
  bar.append(group(back), spacer, group(share, like, add, ...extras), group(edit, trash), group(done));
  if (spec.sample) (bar as VireToolbarElement).sample = spec.sample;
  return bar;
}

/** Content for the glass to refract, behind the toolbar wherever it stands. */
function content(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tb-content';
  const hues = [12, 48, 150, 210, 275, 330, 30, 190, 90, 250];
  el.innerHTML = `<h2>Night Drive</h2>${hues
    .map((h, i) => `<section style="background:hsl(${h} 62% ${i % 2 ? 58 : 72}%)"><b>Track ${i + 1}</b><small>${3 + i}:2${i} min</small></section>`)
    .join('')}`;
  return el;
}

const CSS = `
.tb-frame { position: relative; overflow: clip; border-radius: 24px; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.12); font: 14px system-ui; }
.tb-content { position: absolute; inset: 0; overflow: clip; padding: 24px 16px; display: grid; align-content: start; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); color: #1b1c20; }
.tb-content h2 { grid-column: 1 / -1; margin: 0; font: 600 22px system-ui; }
.tb-content section { height: 84px; border-radius: 16px; padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-end; }
.tb-content small { opacity: 0.7; }
.tb-frame vire-toolbar { --vire-toolbar-accent: color-mix(in srgb, #0a64ff 46%, transparent); }
.tb-frame vire-toolbar[data-edge='top'] { margin: 8px; }
.tb-frame vire-toolbar:not([data-vk]) { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 8px; position: absolute; inset-inline: 0; bottom: 0; }
.tb-frame vire-toolbar:not([data-vk]) svg { width: 18px; height: 18px; }
.tb-frame vire-toolbar:not([data-vk]) [data-group] { display: flex; flex-wrap: wrap; gap: 8px; }
.tb-frame [popover]:not([data-vk]) h2, .tb-frame [popover] h2 { margin: 0 0 8px; font: 600 18px system-ui; }
.tb-frame [popover] p { margin: 0 0 12px; }
.tb-frame [popover] button:not([data-vk]) { font: inherit; }
.tb-sandbox { margin: 24px; }
.tb-frame[data-resizable] { resize: both; overflow: auto; }
`;

export function ensureCss(): void {
  if (document.getElementById('lab-toolbar-css')) return;
  const style = document.createElement('style');
  style.id = 'lab-toolbar-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export type ToolbarGalleryOptions = {
  stage: ToolbarLabStage;
  place: ToolbarLabPlace;
  glass: Glass;
  sample: BackdropSample | null;
  /** A forced state beyond the stage: `morph:0.5`, `place:0.3`. */
  force?: string | null;
  surfaces?: boolean;
};

/** One toolbar in a window frame over the backdrop, held at a stage. */
export function toolbarGallery(stage: HTMLElement, rows: HTMLElement, options: ToolbarGalleryOptions): void {
  ensureCss();
  const size = TOOLBAR_FRAMES[options.place];
  stage.style.width = `${size.width + 72}px`;
  const frame = document.createElement('div');
  frame.className = 'tb-frame';
  frame.id = 'frame';
  frame.dataset.vireShell = '';
  frame.dataset.place = options.place;
  frame.style.cssText = `width:${size.width}px;height:${size.height}px`;
  const bar = makeToolbar({
    id: 'toolbar',
    glass: options.glass,
    sample: options.sample,
    place: options.place,
    surfaces: options.surfaces ?? false,
  });
  bar.setAttribute('data-vire-force-state', [`stage:${options.stage}`, options.force].filter(Boolean).join(','));
  frame.append(content(), bar);
  rows.append(frame);
}

export type ToolbarSandboxOptions = {
  glass: Glass;
  sample: BackdropSample | null;
  width: number;
  height: number;
  attrs: Record<string, string>;
  bare: boolean;
  surfaces: boolean;
};

type Box = { x: number; y: number; w: number; h: number };
export type ToolbarSnapshot = {
  edge: string | null;
  orientation: string | null;
  stage: string | null;
  moving: boolean;
  width: number;
  height: number;
  items: { label: string; hidden: boolean; box: Box; glyph: Box | null; ink: number; blur: number; text: boolean }[];
  more: { hidden: boolean; box: Box; ink: number; blur: number; glyph: Box | null } | null;
  capsules: { hidden: boolean; box: Box; kind: string; clipped: boolean }[];
};

const num = (el: HTMLElement, name: string) => parseFloat(el.style.getPropertyValue(name)) || 0;

/** What a test needs to know of a toolbar at one frame, read from what the element wrote. */
export function snapshot(bar: HTMLElement): ToolbarSnapshot {
  const box = (el: HTMLElement): Box => ({ x: num(el, '--vk-ix'), y: num(el, '--vk-iy'), w: num(el, '--vk-iw'), h: num(el, '--vk-ih') });
  const glyph = (el: HTMLElement): Box | null => {
    const svgEl = el.querySelector('svg');
    if (!svgEl) return null;
    const r = svgEl.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return { x: r.x - b.x, y: r.y - b.y, w: r.width, h: r.height };
  };
  // What is drawn, not what was written: a toolbar whose ink is ignored fails the gates built on this.
  const ink = (el: HTMLElement) => Number(getComputedStyle(el).opacity);
  const blur = (el: HTMLElement) => parseFloat(/blur(([d.]+)px)/.exec(getComputedStyle(el).filter)?.[1] ?? '0');
  const more = bar.querySelector<HTMLElement>('[data-vk-more] > vire-icon-button');
  const r = bar.getBoundingClientRect();
  return {
    edge: bar.getAttribute('data-edge'),
    orientation: bar.getAttribute('data-orientation'),
    stage: bar.getAttribute('data-stage'),
    moving: bar.hasAttribute('data-moving'),
    width: r.width,
    height: r.height,
    items: [...bar.querySelectorAll<HTMLElement>('[data-vk-item]')]
      .filter((el) => el !== more)
      .map((el) => {
        const b = el.matches('button') ? el : el.querySelector('button')!;
        return {
          label: b.getAttribute('aria-label') ?? b.textContent!.trim(),
          hidden: el.hidden,
          box: box(el),
          glyph: el.hidden ? null : glyph(el),
          ink: ink(el),
          blur: blur(el),
          text: !b.hasAttribute('aria-label'),
        };
      }),
    more: more ? { hidden: more.hidden, box: box(more), ink: ink(more), blur: blur(more), glyph: more.hidden ? null : glyph(more) } : null,
    capsules: [...bar.querySelectorAll<HTMLElement>(':scope > [data-vk-capsule]')].map((el) => ({
      hidden: el.hidden,
      box: { x: num(el, '--vk-x'), y: num(el, '--vk-y'), w: num(el, '--vk-w'), h: num(el, '--vk-h') },
      kind: el.getAttribute('data-kind') ?? '',
      clipped: el.style.clipPath !== '',
    })),
  };
}

export type ToolbarSandboxHandle = {
  frame: HTMLElement;
  toolbar: HTMLElement;
  resize(width: number, height: number): void;
  snapshot(): ToolbarSnapshot;
  /** Removes the item with this label from the toolbar and returns a way to put it back. */
  remove(label: string, what?: 'item' | 'trigger'): () => void;
};

/** A resizable window with a toolbar among content, the events and the clicks logged. */
export function toolbarSandbox(rows: HTMLElement, note: (text: string) => void, options: ToolbarSandboxOptions): ToolbarSandboxHandle {
  ensureCss();
  const frame = document.createElement('div');
  frame.className = 'tb-frame tb-sandbox';
  frame.id = 'frame';
  frame.dataset.vireShell = '';
  frame.style.cssText = `width:${options.width}px;height:${options.height}px`;
  const bar = makeToolbar({ id: 'toolbar', glass: options.glass, sample: options.sample, surfaces: options.surfaces, bare: options.bare, attrs: options.attrs });
  frame.append(content(), bar);
  frame.addEventListener('click', (e) => {
    const target = (e.target as Element).closest<HTMLElement>('[data-log]');
    if (target) note(`click:${target.dataset.log}`);
  });
  bar.addEventListener('vire-toolbar-layout', (e) => {
    const d = (e as CustomEvent<{ edge: string; stage: string; overflow: number }>).detail;
    note(`layout:${d.edge}:${d.stage}:${d.overflow}`);
  });
  rows.append(frame);
  return {
    frame,
    toolbar: bar,
    resize(width, height) {
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
    },
    snapshot: () => snapshot(bar),
    remove(label, what = 'item') {
      const button = [...bar.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;
      const host = button.closest<HTMLElement>('[data-group] > *')!;
      const node = what === 'trigger' ? (button.parentElement!.matches('vire-icon-button, vire-button') ? button.parentElement! : button) : host;
      const parent = node.parentElement!;
      const next = node.nextSibling;
      node.remove();
      return () => parent.insertBefore(node, next);
    },
  };
}

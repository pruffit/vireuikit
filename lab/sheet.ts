import type { BackdropSample } from 'vireglass';
import type { VireControlElement, VireSurfaceElement } from 'vireuikit/web';

/** One case per form: the kind that gives it and the window it is drawn in, in dp (the model picks the form from it). */
export const SHEET_FORMS = [
  'popover',
  'popover-sheet',
  'bottom-sheet',
  'side-sheet',
  'side-pane',
  'centered-sheet',
  'full-screen',
  'basic-dialog',
  'alert',
] as const;
export type SheetLabForm = (typeof SHEET_FORMS)[number];

type SheetKind = 'popover' | 'sheet' | 'modal-sheet' | 'picker' | 'dialog' | 'alert';

export const SHEET_FRAMES: Record<SheetLabForm, { width: number; height: number; kind: SheetKind; trigger: 'top' | 'bottom' }> = {
  popover: { width: 700, height: 720, kind: 'popover', trigger: 'top' },
  'popover-sheet': { width: 390, height: 720, kind: 'popover', trigger: 'bottom' },
  'bottom-sheet': { width: 390, height: 720, kind: 'sheet', trigger: 'bottom' },
  'side-sheet': { width: 1000, height: 720, kind: 'sheet', trigger: 'top' },
  'side-pane': { width: 1700, height: 800, kind: 'sheet', trigger: 'top' },
  'centered-sheet': { width: 900, height: 720, kind: 'modal-sheet', trigger: 'top' },
  'full-screen': { width: 390, height: 720, kind: 'dialog', trigger: 'bottom' },
  'basic-dialog': { width: 900, height: 720, kind: 'dialog', trigger: 'top' },
  alert: { width: 390, height: 720, kind: 'alert', trigger: 'top' },
};

type Glass = '1' | '0' | 'touch';
type Body = 'filters' | 'list' | 'rename' | 'alert';
type Surface = 'popover' | 'manual' | 'dialog';

export type SheetSpec = {
  id: string;
  tag: 'vire-popover' | 'vire-sheet';
  kind?: SheetKind | undefined;
  surface: Surface;
  body: Body;
  /** No trigger: the host opens it by script. */
  trigger: string | null;
  glass: Glass;
  sample: BackdropSample | null;
  attrs?: Record<string, string> | undefined;
  force?: string | null | undefined;
};

const ROWS = ['Road Trip', 'Late Night', 'Focus', 'Morning Run', 'Sunday', 'Deep Cuts', 'Roots', 'Instrumentals', 'Throwbacks', 'Study', 'Evening', 'Weekend'];

export function bodyOf(spec: SheetSpec): string {
  const { id, surface } = spec;
  const hide = (label: string, extra = '') =>
    surface === 'dialog'
      ? `<button type="button" commandfor="${id}-surface" command="close" id="${id}-close"${extra}>${label}</button>`
      : `<button type="button" popovertarget="${id}-surface" popovertargetaction="hide" id="${id}-close"${extra}>${label}</button>`;
  switch (spec.body) {
    case 'filters':
      return `<h2 id="${id}-title">Filters</h2><label><input type="checkbox" checked> Downloaded</label><label><input type="checkbox"> Explicit</label><label><input type="checkbox"> New this week</label>${hide('Done')}`;
    case 'list':
      return `<h2 id="${id}-title">Add to playlist</h2><input type="search" id="${id}-field" placeholder="Search playlists" aria-label="Search playlists"><ul class="sh-list">${ROWS.concat(ROWS)
        .map((name, i) => `<li><label><input type="checkbox"${i === 1 ? ' checked' : ''}> ${name}</label></li>`)
        .join('')}</ul>${hide('Close')}`;
    case 'rename':
      return `<form method="dialog"><h2 id="${id}-title">Rename playlist</h2><input type="text" id="${id}-field" value="Road Trip" aria-label="Name"><div class="sh-actions">${hide('Cancel')}<button type="submit" value="save" id="${id}-save">Save</button></div></form>`;
    case 'alert':
      return `<h2 id="${id}-title">Delete playlist?</h2><p>This removes Road Trip for everyone who follows it.</p><div class="sh-actions">${hide('Cancel')}<button type="button" id="${id}-delete" commandfor="${id}-surface" command="close">Delete</button></div>`;
  }
}

/** The first HTML of a surface: the platform's own markup, which works with nothing defined. */
export function makeSheet(spec: SheetSpec): HTMLElement {
  const host = document.createElement(spec.tag);
  host.id = spec.id;
  if (spec.kind) host.setAttribute('kind', spec.kind);
  if (spec.glass !== '0') host.setAttribute('glass', '');
  for (const [name, value] of Object.entries(spec.attrs ?? {})) host.setAttribute(name, value);
  if (spec.force) host.setAttribute('data-vire-force-state', spec.force);
  const surfaceId = `${spec.id}-surface`;

  if (spec.trigger !== null) {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = `${spec.id}-trigger`;
    trigger.textContent = spec.trigger;
    if (spec.surface === 'dialog') {
      trigger.setAttribute('commandfor', surfaceId);
      trigger.setAttribute('command', 'show-modal');
    } else {
      trigger.setAttribute('popovertarget', surfaceId);
    }
    const control = document.createElement('vire-button');
    if (spec.glass !== '0') control.setAttribute('glass', spec.glass === 'touch' ? 'touch' : 'present');
    control.setAttribute('size', 'touch');
    control.append(trigger);
    if (spec.sample) (control as VireControlElement).sample = spec.sample;
    host.append(control);
  }

  const surface = document.createElement(spec.surface === 'dialog' ? 'dialog' : 'div');
  surface.id = surfaceId;
  if (spec.surface === 'popover') surface.setAttribute('popover', '');
  if (spec.surface === 'manual') surface.setAttribute('popover', 'manual');
  surface.setAttribute('aria-labelledby', `${spec.id}-title`);
  surface.innerHTML = bodyOf(spec);
  host.append(surface);
  if (spec.sample) (host as VireSurfaceElement).sample = spec.sample;
  return host;
}

const CSS = `
.sh-frame { position: relative; overflow: clip; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.14); font: 14px system-ui; }
.sh-page { position: absolute; inset: 0; overflow: clip; padding: 24px 20px; box-sizing: border-box; display: grid; align-content: start; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); padding-inline-end: calc(var(--vire-sheet-inset-end, 0px) + 20px); }
.sh-page h2 { grid-column: 1 / -1; margin: 0; font: 600 22px system-ui; }
.sh-page section { height: 96px; border-radius: 18px; padding: 14px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-end; color: #1b1c20; }
.sh-page small { opacity: 0.7; }
.sh-page[data-cards='dark'] section { background: hsl(var(--h) 28% 15%) !important; color: #f1f1f4; }
.sh-page > :is(vire-popover, vire-sheet) > vire-button { position: absolute; left: 24px; }
.sh-page[data-at='top'] > :is(vire-popover, vire-sheet) > vire-button { top: 64px; }
.sh-page[data-at='bottom'] > :is(vire-popover, vire-sheet) > vire-button { bottom: 56px; }
.sh-page > :is(vire-popover, vire-sheet) > button { position: absolute; left: 24px; }
.sh-scroll { position: absolute; inset: 0; overflow-y: auto; padding: 16px 20px; box-sizing: border-box; }
.sh-scroll .row { height: 46px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid rgb(0 0 0 / 0.08); }
.sh-scroll .row i { width: 30px; height: 30px; border-radius: 8px; flex: none; }
.sh-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
:is(vire-popover, vire-sheet) h2 { margin: 0 0 8px; font: 600 18px system-ui; }
:is(vire-popover, vire-sheet) label { display: flex; align-items: center; gap: 10px; min-height: 40px; }
:is(vire-popover, vire-sheet) p { margin: 0 0 12px; }
:is(vire-popover, vire-sheet) input[type='search'], :is(vire-popover, vire-sheet) input[type='text'] { box-sizing: border-box; width: 100%; height: 40px; padding: 0 12px; margin: 0 0 8px; border-radius: 12px; border: 1px solid rgb(127 127 127 / 0.5); background: transparent; color: inherit; font: inherit; }
:is(vire-popover, vire-sheet) .sh-list { list-style: none; margin: 0 0 8px; padding: 0; }
:is(vire-popover, vire-sheet) .sh-actions { display: flex; gap: 12px; justify-content: flex-end; }
:is(vire-popover, vire-sheet) :is(dialog, [popover]) button:not([data-vk-grabber]) { font: inherit; height: 40px; padding: 0 16px; border-radius: 20px; border: 1px solid rgb(127 127 127 / 0.5); background: transparent; color: inherit; }
`;

export function ensureCss(): void {
  if (document.getElementById('lab-sheet-css')) return;
  const style = document.createElement('style');
  style.id = 'lab-sheet-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function page(trigger: HTMLElement, at: 'top' | 'bottom', cards: string | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'sh-page';
  if (cards) el.dataset.cards = cards;
  const hues = [12, 48, 150, 210, 275, 330, 30, 190, 90, 250, 340, 170];
  el.innerHTML = `<h2>Library</h2>${hues.map((h, i) => `<section style="--h:${h};background:hsl(${h} 62% ${i % 2 ? 58 : 72}%)"><b>Mix ${i + 1}</b><small>${12 + i * 3} tracks</small></section>`).join('')}`;
  el.dataset.at = at;
  el.append(trigger);
  return el;
}

export type SheetGalleryOptions = {
  glass: Glass;
  sample: BackdropSample | null;
  detent?: string | null;
  /** The platform's own markup, no kit, to see the first HTML. */
  force?: string | null;
  kind?: string | null;
  /** `filters` is a short body, `list` a tall one that scrolls. */
  content?: string | null;
  /** `dark` draws the page's cards dark, so what lies under the surface is dark whatever the backdrop. */
  cards?: string | null;
  attrs?: Record<string, string>;
};

/** One open surface in a window frame over the backdrop, the form given by the frame's size. */
export function sheetGallery(stage: HTMLElement, rows: HTMLElement, form: SheetLabForm, options: SheetGalleryOptions): void {
  ensureCss();
  const frameSpec = SHEET_FRAMES[form];
  stage.style.width = `${frameSpec.width + 72}px`;
  const frame = document.createElement('div');
  frame.className = 'sh-frame';
  frame.id = 'frame';
  frame.dataset.vireShell = '';
  frame.dataset.form = form;
  frame.style.cssText = `width:${frameSpec.width}px;height:${frameSpec.height}px`;
  const kind = (options.kind as SheetKind | null) ?? frameSpec.kind;
  const popover = kind === 'popover';
  const supplementary = kind === 'sheet';
  const host = makeSheet({
    id: 'sheet',
    tag: popover ? 'vire-popover' : 'vire-sheet',
    kind: popover ? undefined : kind,
    surface: popover ? 'popover' : supplementary ? 'manual' : 'dialog',
    body: options.content === 'filters' ? 'filters' : popover ? 'filters' : kind === 'alert' ? 'alert' : kind === 'dialog' ? 'rename' : 'list',
    trigger: 'Open',
    glass: options.glass,
    sample: options.sample,
    attrs: { ...(options.detent ? { detent: options.detent, detents: 'peek medium large' } : {}), ...(options.attrs ?? {}) },
    force: options.force ?? `open${options.detent ? `:${options.detent}` : ''}`,
  });
  frame.append(page(host, frameSpec.trigger, options.cards ?? null));
  rows.append(frame);
}

export type SheetSandboxOptions = {
  glass: Glass;
  sample: BackdropSample | null;
  width: number;
  height: number;
  detents?: string | null;
};

export type SheetSandboxHandle = {
  frame: HTMLElement;
  resize(width: number, height: number): void;
  /** Samples a surface's box on every animation frame into `window.__frames`. */
  record(id: string): void;
  setViewport(next: { height?: number; offsetTop?: number }): void;
  open(id: string): void;
};

type Frame = Record<string, number | string | boolean | null>;

class FakeViewport extends EventTarget {
  offsetLeft = 0;
  offsetTop = 0;
  pageLeft = 0;
  pageTop = 0;
  scale = 1;
  width = window.innerWidth;
  height = window.innerHeight;
}

/** A resizable window with a scrolling list and a trigger for every kind, the events logged. */
export function sheetSandbox(rows: HTMLElement, note: (text: string) => void, options: SheetSandboxOptions): SheetSandboxHandle {
  ensureCss();
  let fake: FakeViewport | null = null;
  if (new URLSearchParams(location.search).get('stubvv') === '1') {
    fake = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
  }
  const frame = document.createElement('div');
  frame.className = 'sh-frame';
  frame.id = 'frame';
  frame.dataset.vireShell = '';
  frame.style.cssText = `width:${options.width}px;height:${options.height}px;margin:24px`;
  const scroll = document.createElement('div');
  scroll.className = 'sh-scroll';
  scroll.id = 'page';
  const bar = document.createElement('div');
  bar.className = 'sh-bar';
  const base = { glass: options.glass, sample: options.sample };
  const detents: Record<string, string> = options.detents ? { detents: options.detents } : {};
  const specs: SheetSpec[] = [
    { ...base, id: 'pop', tag: 'vire-popover', surface: 'popover', body: 'filters', trigger: 'Filters' },
    { ...base, id: 'sup', tag: 'vire-sheet', surface: 'manual', body: 'list', trigger: 'Playlists', attrs: detents },
    { ...base, id: 'modal', tag: 'vire-sheet', surface: 'dialog', body: 'list', trigger: 'Add to playlist', attrs: detents },
    { ...base, id: 'picker', tag: 'vire-sheet', kind: 'picker', surface: 'dialog', body: 'list', trigger: 'Pick', attrs: detents },
    { ...base, id: 'dlg', tag: 'vire-sheet', kind: 'dialog', surface: 'dialog', body: 'rename', trigger: 'Rename' },
    { ...base, id: 'alert', tag: 'vire-sheet', kind: 'alert', surface: 'dialog', body: 'alert', trigger: 'Delete' },
    { ...base, id: 'hosted', tag: 'vire-sheet', surface: 'dialog', body: 'list', trigger: null, attrs: detents },
  ];
  const hosts = new Map<string, HTMLElement>();
  for (const spec of specs) {
    const host = makeSheet(spec);
    hosts.set(spec.id, host);
    bar.append(host);
    const surface = host.querySelector<HTMLElement>(':scope > dialog, :scope > [popover]')!;
    surface.addEventListener('toggle', (e) => note(`toggle:${spec.id}:${(e as ToggleEvent).newState}`));
    surface.addEventListener('close', () => note(`close:${spec.id}`));
    surface.addEventListener('cancel', () => note(`cancel:${spec.id}`));
    host.addEventListener('vire-sheet-detent', (e) => note(`detent:${spec.id}:${(e as CustomEvent<{ detent: string }>).detail.detent}`));
  }
  const manual = document.createElement('button');
  manual.type = 'button';
  manual.id = 'host-open';
  manual.textContent = 'Open by script';
  manual.addEventListener('click', () => (hosts.get('hosted')!.querySelector('dialog') as HTMLDialogElement).showModal());
  const manualPopover = document.createElement('button');
  manualPopover.type = 'button';
  manualPopover.id = 'host-pop';
  manualPopover.textContent = 'Show popover by script';
  manualPopover.addEventListener('click', () => (hosts.get('pop')!.querySelector('[popover]') as HTMLElement).showPopover());
  const before = document.createElement('button');
  before.type = 'button';
  before.id = 'before';
  before.textContent = 'Before';
  before.addEventListener('click', () => note('click:before'));
  bar.prepend(before);
  bar.append(manual, manualPopover);
  scroll.append(bar);
  const list = document.createElement('div');
  list.innerHTML = Array.from({ length: 30 }, (_, i) => `<div class="row"><i style="background:hsl(${(i * 37) % 360} 60% 70%)"></i>Track ${i + 1}</div>`).join('');
  scroll.append(list);
  frame.append(scroll);
  rows.append(frame);

  return {
    frame,
    resize(width, height) {
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
    },
    record(id) {
      const host = document.getElementById(id)!;
      const surface = host.querySelector<HTMLElement>(':scope > dialog, :scope > [popover]')!;
      const control = host.querySelector('vire-button');
      const frames: Frame[] = [];
      (window as unknown as { __frames: Frame[] }).__frames = frames;
      const snap = (source: string) => {
        const r = surface.getBoundingClientRect();
        const ink = surface.style.getPropertyValue('--vk-ink-in');
        frames.push({
          source,
          t: performance.now(),
          open: surface instanceof HTMLDialogElement ? surface.open : surface.matches(':popover-open'),
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          radius: parseFloat(getComputedStyle(surface).borderTopLeftRadius),
          opaque: Number(surface.style.getPropertyValue('--vk-opaque') || 0),
          scrim: Number(surface.style.getPropertyValue('--vk-scrim') || 0),
          ink: ink === '' ? 1 : Number(ink),
          phase: host.getAttribute('data-phase'),
          form: host.getAttribute('data-form'),
          carried: control?.hasAttribute('data-carried') ?? false,
          lens: control ? getComputedStyle(control.querySelector('button')!).backdropFilter : 'none',
          body: control ? getComputedStyle(control.querySelector('button')!).backgroundColor : 'rgba(0, 0, 0, 0)',
          rim: control ? getComputedStyle(control.querySelector('button')!, '::after').visibility : 'hidden',
        });
      };
      document.addEventListener('click', () => snap('click'));
      document.addEventListener('keydown', () => snap('key'));
      const loop = () => {
        snap('frame');
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    setViewport(next) {
      if (!fake) throw new Error('open the lab with stubvv=1');
      if (next.height !== undefined) fake.height = next.height;
      if (next.offsetTop !== undefined) fake.offsetTop = next.offsetTop;
      fake.dispatchEvent(new Event('resize'));
    },
    open(id) {
      const surface = document.getElementById(id)!.querySelector<HTMLElement>(':scope > dialog, :scope > [popover]')!;
      if (surface instanceof HTMLDialogElement) surface.showModal();
      else surface.showPopover();
    },
  };
}

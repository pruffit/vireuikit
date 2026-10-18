// The adaptive stage: a resizable window in which the real atoms take their adaptive forms and the patterns not built
// yet (navigation, panes, sheets, the toolbar) are outlines placed by the model. Every view is addressable by URL.
import {
  INPUT_MIXED,
  INPUT_POINTER,
  INPUT_TABLET_KEYBOARD,
  INPUT_TOUCH,
  POSTURE_FLAT,
  SUPPORTING_PANE_MAX_WIDTH,
  SURFACE_KINDS,
  bottomAccessory,
  classifyWindow,
  createFormMorph,
  formMorphFrame,
  halfOpen,
  hitTarget,
  navigationForm,
  paneLayout,
  presentationForm,
  rebaseFormMorph,
  sizeTier,
  stepFormMorph,
  supportingPane,
  toolbarLayout,
  toolbarPlacement,
  windowSegments,
  type AdaptiveContext,
  type InputLayers,
  type MorphBox,
  type PresentationForm,
  type SurfaceKind,
  type ToolbarItem,
} from '../src/kit/adaptive';
import type { Rect } from '../src/kit/geometry';
import { BUTTON_SIZES } from '../src/kit/sizes';
import { setInputOverride, setViewportOverride, watchAdaptiveContext } from 'vireuikit/web';
import { paintBackdrop, type Backdrop } from './backdrops';
import { GLYPHS, makeMenu, type MenuItemSpec } from './menu';

export type InputName = 'touch' | 'pointer' | 'mixed' | 'tablet-keyboard';
export type PostureName = 'flat' | 'book' | 'tabletop';

const INPUTS: Record<InputName, InputLayers> = {
  touch: INPUT_TOUCH,
  pointer: INPUT_POINTER,
  mixed: INPUT_MIXED,
  'tablet-keyboard': INPUT_TABLET_KEYBOARD,
};

/** What the stage simulates: the window in dp, the fold, the input. */
export type Sim = {
  w: number;
  h: number;
  posture: PostureName;
  /** The fold's centre line along its axis; the middle when null. */
  fold: number | null;
  band: number;
  occluding: boolean | null;
  input: InputName;
  keyboard: boolean | null;
};

export const PRESETS = {
  'phone-portrait': { w: 360, h: 800, input: 'touch' },
  'phone-landscape': { w: 915, h: 412, input: 'touch' },
  'foldable-folded': { w: 412, h: 915, input: 'touch' },
  'foldable-unfolded': { w: 673, h: 841, input: 'touch' },
  'foldable-book': { w: 673, h: 841, posture: 'book', input: 'touch' },
  'foldable-tabletop': { w: 841, h: 673, posture: 'tabletop', input: 'touch' },
  'tablet-portrait': { w: 800, h: 1280, input: 'touch' },
  'tablet-landscape': { w: 1280, h: 800, input: 'touch' },
  'desktop-narrow': { w: 1024, h: 700, input: 'pointer' },
  'desktop-wide': { w: 1440, h: 900, input: 'pointer' },
  xl: { w: 2560, h: 1080, input: 'pointer' },
} as const satisfies Record<string, Partial<Sim>>;

export type PresetName = keyof typeof PRESETS;

type App = {
  section: number;
  selected: number | null;
  showing: 'list' | 'detail';
  pinned: boolean;
  supportingOpen: boolean;
  surface: SurfaceKind | null;
  barMinimized: boolean;
  sidebarCollapsed: boolean;
};

const SECTIONS = ['Home', 'Library', 'People', 'Inbox'];
const SECONDARY = ['Activity', 'Studio'];
const ROWS = 30;
const PAD = 8;
const RAIL_W = 80;
const SIDEBAR_W = 272;
const BAR_H = 64;
const BAR_ITEM_W = 76;
const SEARCH_D = 64;
const ACC_H = 48;
const HEADER_H = 60;

const TOOLBAR_ITEMS: ToolbarItem[] = [
  { id: 'share', kind: 'icon', priority: 3 },
  { id: 'like', kind: 'icon', priority: 1, badge: true },
  { id: 'download', kind: 'icon', priority: 1 },
  { id: 'add', kind: 'icon', priority: 2 },
  { id: 'edit', kind: 'text', priority: 0, width: 60 },
  { id: 'done', kind: 'text', primary: true, width: 64 },
];

const MENU_ITEMS: readonly MenuItemSpec[] = [
  { label: 'Copy link', glyph: 'link', log: 'copy' },
  { label: 'Rename', glyph: 'pencil', log: 'rename' },
  { label: 'Move', glyph: 'folder', log: 'move' },
  { label: 'Pin', glyph: 'pin', log: 'pin' },
  { label: 'Delete', glyph: 'trash', disabled: true },
  { label: 'Copy text', glyph: 'link', log: 'text' },
];

const CSS = `
#adaptive-controls{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin:0 0 12px;font:12px system-ui}
#adaptive-controls label{display:inline-flex;gap:4px;align-items:center}
#adaptive-controls input[type=number]{width:64px}
#adaptive-body{display:flex;gap:16px;align-items:flex-start}
#window{position:relative;flex:none;overflow:clip;isolation:isolate;outline:1px solid #555;font:13px/1.3 system-ui}
#window .ol{position:absolute;box-sizing:border-box;border:1.5px dashed color-mix(in srgb,currentColor 55%,transparent);border-radius:12px}
#window .ol>.tag{position:absolute;left:8px;top:-1px;transform:translateY(-50%);padding:0 5px;font:600 10px/16px ui-monospace,monospace;letter-spacing:.02em;background:color-mix(in srgb,Canvas 85%,transparent);color:CanvasText;border-radius:4px;white-space:nowrap;pointer-events:none}
#window .pane{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:16px;background:color-mix(in srgb,Canvas 70%,transparent);overflow:clip}
#window [hidden]:not(.pane){display:none!important}
#window .pane[hidden]{visibility:hidden;pointer-events:none}
#window .pane>header{display:flex;align-items:center;gap:8px;padding:0 10px;min-height:${HEADER_H}px;flex:none}
#window .pane>header>h2{flex:1;margin:0;font:600 15px system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#window .list-scroll{flex:1;overflow-y:auto;min-height:0;padding:0 6px 6px}
#window .row{display:block;width:100%;box-sizing:border-box;text-align:start;font:inherit;color:inherit;padding:0 12px;height:44px;border:0;border-radius:10px;background:transparent;cursor:pointer}
#window .row[aria-current=true]{background:color-mix(in srgb,currentColor 12%,transparent)}
#window .detail-body{flex:1;padding:calc(12px + var(--room-top,0px)) 12px calc(12px + var(--room-bottom,0px));display:grid;align-content:start;gap:8px}
#window .detail-body input{font:inherit;padding:8px 10px;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 30%,transparent);background:Canvas;color:CanvasText}
#window .placeholder{flex:1;display:grid;place-items:center;opacity:.6}
#window .back{font:inherit;border:0;background:transparent;color:inherit;cursor:pointer;padding:6px}
#nav{position:absolute;box-sizing:border-box;z-index:3;border:1.5px dashed color-mix(in srgb,currentColor 55%,transparent);background:color-mix(in srgb,Canvas 55%,transparent);display:flex;gap:4px;padding:8px}
#nav>.tag{position:absolute;left:12px;top:-1px;transform:translateY(-50%);padding:0 5px;font:600 10px/16px ui-monospace,monospace;background:color-mix(in srgb,Canvas 85%,transparent);color:CanvasText;border-radius:4px;white-space:nowrap}
#nav .items{display:flex;gap:4px;flex:1;min-width:0;filter:blur(calc((1 - var(--ink,1))*6px));opacity:var(--ink,1)}
#nav .dest{font:500 11px system-ui;color:inherit;border:0;border-radius:14px;background:transparent;cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 8px;white-space:nowrap}
#nav .dest svg{width:20px;height:20px;flex:none}
#nav .dest[aria-current=page]{background:color-mix(in srgb,currentColor 14%,transparent)}
#nav .secondary,#nav .search-field,#nav .collapse{display:none}
#nav[data-form=bar] .items{flex-direction:row;justify-content:space-around;align-items:center}
#nav[data-form=bar] .dest{flex-direction:column;gap:2px;flex:1;padding:4px 0}
#nav[data-form=rail] .items{flex-direction:column;align-items:stretch;padding-top:32px}
#nav[data-form=rail] .dest{flex-direction:column;gap:2px;padding:8px 0}
#nav[data-form=sidebar] .items{flex-direction:column;align-items:stretch;padding-top:28px}
#nav[data-form=sidebar] .secondary{display:flex}
#nav[data-form=sidebar] .collapse,#nav[data-expand=beside] .collapse{display:flex}
#nav[data-search=field][data-form=sidebar] .search-field{display:block}
#nav .search-field{margin:0 0 6px;padding:8px 10px;border-radius:12px;border:1px dashed color-mix(in srgb,currentColor 40%,transparent);font:12px system-ui;opacity:.8}
#nav .search-button{position:absolute;display:none;box-sizing:border-box;width:${SEARCH_D}px;height:${SEARCH_D}px;border-radius:50%;border:1.5px dashed color-mix(in srgb,currentColor 55%,transparent);background:color-mix(in srgb,Canvas 55%,transparent);align-items:center;justify-content:center;font:600 10px ui-monospace,monospace}
#nav[data-search=button] .search-button{display:flex;left:calc(100% + ${PAD}px);top:0}
#nav[data-search=item] .search-item{display:flex}
#nav .search-item{display:none}
#nav[data-minimized] .dest:not([aria-current=page]),#nav[data-minimized] .search-button{display:none}
#accessory{z-index:2;display:flex;align-items:center;justify-content:flex-end;padding:0 4px;background:color-mix(in srgb,Canvas 55%,transparent)}
#toolbar{border:0;z-index:1}
#toolbar>.cap{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:0;border:1.5px dashed color-mix(in srgb,currentColor 55%,transparent);background:color-mix(in srgb,Canvas 60%,transparent);font:600 10px ui-monospace,monospace}
#toolbar>.cap[data-kind=primary]{background:color-mix(in srgb,#3a7bff 30%,Canvas)}
#toolbar .it{position:relative;display:grid;place-items:center;flex:none}
#toolbar .it[data-badge]::after{content:'';position:absolute;top:4px;right:4px;width:7px;height:7px;border-radius:50%;background:#e5484d}
#toolbar[data-orientation=vertical]>.cap{flex-direction:column}
#supporting,#surface{z-index:5;background:color-mix(in srgb,Canvas 80%,transparent);display:flex;align-items:center;justify-content:center;font:12px system-ui}
#surface{z-index:6;flex-direction:column;gap:8px}
#surface button{font:inherit}
#scrim{position:absolute;inset:0;z-index:4;background:color-mix(in srgb,#000 28%,transparent);display:none}
#fold{position:absolute;z-index:7;pointer-events:none;display:none;background:repeating-linear-gradient(45deg,#d33a 0 6px,#d332 6px 12px);outline:1px solid #d33}
#fold[data-occluding=false]{background:#d33}
#handle{position:absolute;right:0;bottom:0;width:18px;height:18px;z-index:9;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,color-mix(in srgb,currentColor 50%,transparent) 50%)}
#readout{font:12px/1.45 ui-monospace,monospace;flex:none;width:340px;margin:0;color:#e8e8ec}
#readout dt{font-weight:700;margin-top:6px}
#readout dd{margin:0 0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}
#app[data-chrome='0'] #readout{display:none}
`;

const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const NAV_GLYPHS = [
  svg('<path d="M4 11l8-7 8 7v9H4z"/>'),
  svg('<path d="M5 4h4v16H5zM11 4h4v16h-4zM17 5l3 1-3 14"/>'),
  svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 1 0 0-6M21 20c0-2-1.5-4-4-4.6"/>'),
  svg('<path d="M4 6h16v12H4zM4 7l8 6 8-6"/>'),
];
const SEARCH_GLYPH = svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>');

type Frame = { form: string; target: string; x: number; y: number; w: number; h: number; navs: number; id: string; morphing: boolean };

declare global {
  interface Window {
    __adaptive: {
      ctx(): AdaptiveContext | null;
      decisions(): Record<string, unknown>;
      set(patch: Partial<Sim>): void;
      app(patch?: Partial<App>): App;
      state(): Record<string, unknown>;
      run(name: ScenarioName, options?: { hold?: number }): Promise<StepLog[]>;
      record(): void;
      frames(): Frame[];
      settled(): boolean;
    };
  }
}

type StepLog = {
  label: string;
  w: number;
  h: number;
  posture: string;
  width: string;
  height: string;
  nav: string;
  panes: number;
  tier: string;
  hit: number;
  preserved: boolean;
  lost: string[];
  sameNav: boolean;
  /** The open surface's form as drawn, or null when none shows. */
  surface: string | null;
};

type ScenarioName = 'sweep' | 'fold' | 'rotate' | 'keyboard';

/** One body changing form: it reshapes from where it is, turns back mid-way, and starts afresh from its current box for a third form. */
class BodyMorph {
  from: { form: string; box: MorphBox; fixed: boolean } | null = null;
  to: { form: string; box: MorphBox } | null = null;
  state = createFormMorph();
  toward: 0 | 1 = 1;

  aim(form: string, boxOf: (form: string) => MorphBox): void {
    if (!this.from || !this.to) {
      const box = boxOf(form);
      this.from = { form, box, fixed: false };
      this.to = { form, box };
      this.state.t = { x: 1, v: 0, target: 1 };
      this.toward = 1;
      return;
    }
    if (form === this.to.form) this.toward = 1;
    else if (form === this.from.form && !this.from.fixed) this.toward = 0;
    else {
      const now = this.frame().box;
      this.from = { form: this.shown(), box: now, fixed: true };
      this.to = { form, box: boxOf(form) };
      rebaseFormMorph(this.state);
      this.toward = 1;
    }
    this.to.box = boxOf(this.to.form);
    if (!this.from.fixed) this.from.box = boxOf(this.from.form);
  }

  step(dt: number, instant: boolean): boolean {
    return stepFormMorph(this.state, dt, this.toward, instant);
  }

  frame() {
    return formMorphFrame(this.from!.box, this.to!.box, this.state);
  }

  shown(): string {
    return this.frame().showing === 'to' ? this.to!.form : this.from!.form;
  }

  target(): string {
    return this.toward === 1 ? this.to!.form : this.from!.form;
  }

  moving(): boolean {
    if (!this.to) return false;
    return this.state.t.x !== this.toward || this.state.t.v !== 0;
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
  if (html) node.innerHTML = html;
  return node;
};

const place = (node: HTMLElement, r: Rect, radius?: number) => {
  node.style.left = `${r.x}px`;
  node.style.top = `${r.y}px`;
  node.style.width = `${Math.max(r.width, 0)}px`;
  node.style.height = `${Math.max(r.height, 0)}px`;
  if (radius !== undefined) node.style.borderRadius = `${radius}px`;
};

const num = (v: string | null, fallback: number | null) => (v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

function simFromParams(params: URLSearchParams): Sim {
  const preset: Partial<Sim> = PRESETS[(params.get('preset') ?? '') as PresetName] ?? PRESETS['desktop-wide'];
  const posture = params.get('posture');
  const input = params.get('input');
  const occluding = params.get('occluding');
  const keyboard = params.get('keyboard');
  return {
    w: num(params.get('w'), null) ?? preset.w ?? 1440,
    h: num(params.get('h'), null) ?? preset.h ?? 900,
    posture: posture === 'book' || posture === 'tabletop' || posture === 'flat' ? posture : (preset.posture ?? 'flat'),
    fold: num(params.get('fold'), null),
    band: num(params.get('band'), 0) ?? 0,
    occluding: occluding === '1' ? true : occluding === '0' ? false : null,
    input: input && input in INPUTS ? (input as InputName) : (preset.input ?? 'pointer'),
    keyboard: keyboard === '1' ? true : keyboard === '0' ? false : null,
  };
}

function postureOf(sim: Sim) {
  if (sim.posture === 'flat') return POSTURE_FLAT;
  return halfOpen(sim.posture, { width: sim.w, height: sim.h }, {
    ...(sim.fold === null ? {} : { at: sim.fold }),
    band: sim.band,
    ...(sim.occluding === null ? {} : { occluding: sim.occluding }),
  });
}

export async function adaptiveStage(
  stage: HTMLElement,
  rows: HTMLElement,
  params: URLSearchParams,
  options: { glass: '1' | '0' | 'touch'; backdrop: Backdrop; chrome: boolean },
): Promise<void> {
  if (!document.getElementById('adaptive-css')) document.head.append(el('style', { id: 'adaptive-css' }, CSS));
  stage.style.width = 'max-content';
  stage.style.overflow = 'visible';
  rows.style.cssText = 'display:block;padding:0;gap:0';

  const sim = simFromParams(params);
  const foldAware = params.get('foldaware') !== '0';
  const surfaceParam = params.get('surface');
  const selectedParam = num(params.get('selected'), null);
  const app: App = {
    section: num(params.get('section'), 1) ?? 1,
    selected: selectedParam,
    showing: params.get('showing') === 'list' || selectedParam === null ? 'list' : 'detail',
    pinned: params.get('pinned') === '1',
    supportingOpen: params.get('supporting') === '1',
    surface: surfaceParam && (SURFACE_KINDS as readonly string[]).includes(surfaceParam) ? (surfaceParam as SurfaceKind) : null,
    barMinimized: params.get('barmin') === '1',
    sidebarCollapsed: params.get('collapsed') === '1',
  };

  const controls = el('div', { id: 'adaptive-controls' });
  const body = el('div', { id: 'adaptive-body' });
  const win = el('div', { id: 'window' });
  const readout = el('dl', { id: 'readout' });
  body.append(win, readout);
  if (options.chrome) (document.getElementById('bar') ?? rows).after(controls);
  rows.append(body);
  await paintBackdrop(win, options.backdrop);

  const glassAttr = options.glass === '0' ? null : options.glass === '1' ? 'present' : 'touch';
  const control = (tag: 'vire-button' | 'vire-icon-button', id: string, label: string, glyph?: string) => {
    const host = document.createElement(tag);
    host.id = id;
    if (glassAttr) host.setAttribute('glass', glassAttr);
    const button = el('button', { type: 'button' });
    if (glyph) {
      button.setAttribute('aria-label', label);
      button.innerHTML = glyph;
    } else button.textContent = label;
    host.append(button);
    return host;
  };
  const menu = (id: string, label: string) => {
    const m = makeMenu({ id, size: '', glass: options.glass, sample: null, trigger: { kind: 'icon', label, glyph: 'more' }, items: MENU_ITEMS });
    return m;
  };

  // Panes: built once; class changes move them and never rebuild them, so their state lives on.
  const list = el('section', { class: 'pane', 'data-pane': 'list' });
  const listHeader = el('header');
  const listTitle = el('h2');
  listHeader.append(listTitle, control('vire-button', 'filters', 'Filters'), menu('list-more', 'More'));
  const listScroll = el('div', { class: 'list-scroll' });
  for (let i = 0; i < ROWS; i += 1) listScroll.append(el('button', { class: 'row', type: 'button', 'data-index': String(i) }, `Item ${i + 1}`));
  list.append(listHeader, listScroll);

  const detail = el('section', { class: 'pane', 'data-pane': 'detail' });
  const detailHeader = el('header');
  const back = el('button', { class: 'back', type: 'button', 'aria-label': 'Back' }, '‹ Back');
  const detailTitle = el('h2');
  detailHeader.append(back, detailTitle, control('vire-button', 'open', 'Open'), control('vire-icon-button', 'share', 'Share', GLYPHS.link));
  const detailBody = el('div', { class: 'detail-body' });
  const notes = el('input', { id: 'notes', type: 'text', placeholder: 'Notes', 'aria-label': 'Notes' });
  detailBody.append(notes);
  const placeholder = el('div', { class: 'placeholder' }, 'Nothing selected');
  detail.append(detailHeader, detailBody, placeholder);

  const nav = el('nav', { id: 'nav', 'aria-label': 'Sections' });
  const navTag = el('span', { class: 'tag' });
  const items = el('div', { class: 'items' });
  const searchField = el('div', { class: 'search-field' }, 'Search  ⌘K');
  items.append(searchField);
  SECTIONS.forEach((name, i) => items.append(el('button', { class: 'dest', type: 'button', 'data-section': String(i) }, `${NAV_GLYPHS[i]}<span>${name}</span>`)));
  items.append(el('button', { class: 'dest search-item', type: 'button', 'data-search': '' }, `${SEARCH_GLYPH}<span>Search</span>`));
  SECONDARY.forEach((name) => items.append(el('button', { class: 'dest secondary', type: 'button' }, `<span>${name}</span>`)));
  const collapse = el('button', { class: 'dest collapse', type: 'button' }, '<span>⇤ Collapse</span>');
  items.append(collapse);
  const searchButton = el('div', { class: 'search-button', 'aria-hidden': 'true' }, SEARCH_GLYPH);
  nav.append(navTag, items, searchButton);

  const accessory = el('div', { id: 'accessory', class: 'ol' }, '<span class="tag"></span>');
  accessory.append(menu('accessory-more', 'Options'));
  const supporting = el('aside', { id: 'supporting', class: 'ol' }, '<span class="tag"></span><span>supporting pane</span>');
  const toolbar = el('div', { id: 'toolbar', class: 'ol' }, '<span class="tag"></span>');
  const surface = el('div', { id: 'surface', class: 'ol' }, '<span class="tag"></span><span class="what"></span>');
  const closeSurface = el('button', { type: 'button', id: 'close-surface' }, 'Close');
  surface.append(closeSurface);
  const scrim = el('div', { id: 'scrim' });
  const fold = el('div', { id: 'fold' });
  const handle = el('div', { id: 'handle', title: 'Drag to resize' });
  win.append(list, detail, toolbar, supporting, accessory, nav, scrim, surface, fold, handle);

  const navMorph = new BodyMorph();
  const surfaceMorph = new BodyMorph();
  let ctx: AdaptiveContext | null = null;
  let decisions: ReturnType<typeof decide> | null = null;
  let frame = 0;
  let lastTime = 0;
  let recording: Frame[] | null = null;
  let toolbarNow: ReturnType<typeof toolbarLayout> | null = null;

  const navId = 'nav-body';
  (nav as HTMLElement & { __body?: string }).__body = navId;

  function listState() {
    return { selected: app.selected !== null, showing: app.showing } as const;
  }

  function decide(c: AdaptiveContext) {
    const panes = paneLayout(c, listState());
    const navForm = navigationForm(c, { primary: SECTIONS.length, secondary: SECONDARY.length, search: true, sidebarCollapsed: app.sidebarCollapsed, panes: panes.panes });
    const placement = toolbarPlacement(c);
    const surfaces = Object.fromEntries(SURFACE_KINDS.map((k) => [k, presentationForm(k, c, sourceRect())])) as Record<SurfaceKind, PresentationForm>;
    return {
      classes: classifyWindow(c.window),
      panes,
      nav: navForm,
      accessory: bottomAccessory(navForm, { barMinimized: app.barMinimized }),
      supporting: supportingPane(c, { pinned: app.pinned, open: app.supportingOpen }),
      placement,
      tier: sizeTier(c.input),
      hit: hitTarget(c.input),
      surfaces,
      segments: windowSegments(c),
    };
  }

  function sourceRect(): Rect | undefined {
    const source = document.getElementById('filters');
    if (!source || list.hidden) return undefined;
    const r = source.getBoundingClientRect();
    const w = win.getBoundingClientRect();
    return { x: r.x - w.x, y: r.y - w.y, width: r.width, height: r.height };
  }

  function navBox(form: string, c: AdaptiveContext): MorphBox {
    const { width: W, height: H } = c.window;
    if (form === 'bar') {
      const d = decisions!;
      if (app.barMinimized) return { x: 16, y: H - 16 - BAR_H, width: BAR_H, height: BAR_H, radius: BAR_H / 2 };
      const search = d.nav.search?.form === 'button' ? SEARCH_D + PAD : 0;
      const barW = Math.max(BAR_H, Math.min(W - 32 - search, d.nav.primary * BAR_ITEM_W + 16));
      return { x: (W - barW - search) / 2, y: H - 16 - BAR_H, width: barW, height: BAR_H, radius: BAR_H / 2 };
    }
    if (form === 'rail') return { x: PAD, y: PAD, width: RAIL_W, height: H - 2 * PAD, radius: 28 };
    return { x: PAD, y: PAD, width: SIDEBAR_W, height: H - 2 * PAD, radius: 28 };
  }

  function render(): void {
    if (!ctx) return;
    const c = ctx;
    decisions = decide(c);
    const d = decisions;
    const { width: W, height: H } = c.window;
    const segments = d.segments;
    const tierH = BUTTON_SIZES[d.tier].height;

    navMorph.aim(d.nav.form, (f) => navBox(f, c));
    nav.dataset.target = d.nav.form;
    nav.dataset.search = d.nav.search?.form ?? 'none';
    nav.toggleAttribute('data-minimized', d.nav.form === 'bar' && app.barMinimized);
    if (d.nav.expandable) nav.dataset.expand = d.nav.expandable;
    else delete nav.dataset.expand;
    collapse.innerHTML = d.nav.form === 'sidebar' ? '<span>⇤ Collapse</span>' : '<span>⇥</span>';
    navTag.textContent = `navigation · ${d.nav.form}${d.nav.search ? ` · search ${d.nav.search.form}` : ''}`;
    for (const b of items.querySelectorAll<HTMLElement>('[data-section]')) {
      if (Number(b.dataset.section) === app.section) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }

    const lead = d.nav.form === 'bar' ? 0 : PAD + (d.nav.form === 'rail' ? RAIL_W : SIDEBAR_W);
    const barStack = d.nav.form === 'bar' ? 16 + BAR_H + (d.accessory.placement === 'above-bar' ? PAD + ACC_H : 0) + PAD : 0;
    const bottom = d.nav.form === 'bar' ? barStack : ACC_H + 2 * PAD;
    const sheet = app.surface ? d.surfaces[app.surface] : null;
    const sideSheet = sheet && (sheet.form === 'side-sheet' || sheet.form === 'side-pane');
    const sheetW = sideSheet ? Math.min(sheet!.maxWidth ?? 400, Math.round((W - lead) * 0.34)) : 0;
    const supW = Math.min(SUPPORTING_PANE_MAX_WIDTH, Math.round((W - lead) * 0.3));
    const strip = d.placement.orientation === 'vertical' ? tierH + 2 * PAD : 0;
    let right = W - PAD - strip;
    if (sideSheet) right -= sheetW + PAD;
    if (d.supporting.form === 'beside') right -= supW + PAD;
    const area: Rect = { x: lead + PAD, y: PAD, width: right - lead - PAD, height: H - PAD - bottom };

    let listBox: Rect = area;
    let detailBox: Rect = area;
    const split = d.panes.split;
    if (split?.kind === 'fixed') {
      listBox = { ...area, width: split.list };
      detailBox = { ...area, x: area.x + split.list + PAD, width: area.width - split.list - PAD };
    } else if (split?.kind === 'half') {
      const half = (area.width - PAD) / 2;
      listBox = { ...area, width: half };
      detailBox = { ...area, x: area.x + half + PAD, width: half };
    } else if (split?.kind === 'fold') {
      const [a, b] = segments as [Rect, Rect];
      listBox = { ...area, width: a.x + a.width - PAD - area.x };
      detailBox = { ...area, x: b.x + PAD, width: area.x + area.width - b.x - PAD };
    }
    place(list, listBox);
    place(detail, detailBox);
    list.hidden = !d.panes.visible.includes('list');
    detail.hidden = !d.panes.visible.includes('detail');
    list.inert = list.hidden;
    detail.inert = detail.hidden;
    listTitle.textContent = SECTIONS[app.section] ?? '';
    back.hidden = !d.panes.back;
    detailTitle.textContent = app.selected === null ? 'Detail' : `Item ${app.selected + 1}`;
    detailBody.hidden = d.panes.placeholder;
    placeholder.hidden = !d.panes.placeholder;
    for (const row of listScroll.querySelectorAll<HTMLElement>('.row')) {
      if (d.panes.selectionShown && Number(row.dataset.index) === app.selected) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
    list.dataset.box = `${Math.round(listBox.width)}`;

    // Bottom accessory.
    const accTag = accessory.querySelector<HTMLElement>('.tag')!;
    accTag.textContent = `bottom accessory · ${d.accessory.placement}`;
    accessory.dataset.placement = d.accessory.placement;
    if (d.accessory.placement === 'content-bottom') place(accessory, { x: lead + PAD, y: H - PAD - ACC_H, width: W - lead - 2 * PAD, height: ACC_H }, ACC_H / 2);
    else {
      const bar = navBox('bar', c);
      const search = d.nav.search?.form === 'button' && !app.barMinimized ? SEARCH_D + PAD : 0;
      if (d.accessory.placement === 'in-bar') place(accessory, { x: bar.x + bar.width + PAD, y: bar.y + (BAR_H - ACC_H) / 2, width: W - 16 - (bar.x + bar.width + PAD), height: ACC_H }, ACC_H / 2);
      else place(accessory, { x: bar.x, y: bar.y - PAD - ACC_H, width: bar.width + search, height: ACC_H }, ACC_H / 2);
    }

    // Supporting pane.
    const supTag = supporting.querySelector<HTMLElement>('.tag')!;
    supTag.textContent = `supporting pane · ${d.supporting.form}${d.supporting.remembered ? ' · remembered' : ''}`;
    supporting.dataset.form = d.supporting.form;
    supporting.hidden = d.supporting.form === 'hidden';
    if (d.supporting.form === 'beside') place(supporting, { x: right + PAD + (sideSheet ? sheetW + PAD : 0), y: PAD, width: supW, height: area.height });
    else if (d.supporting.form === 'over') place(supporting, { x: W - PAD - Math.min(SUPPORTING_PANE_MAX_WIDTH, W - lead - 56), y: PAD, width: Math.min(SUPPORTING_PANE_MAX_WIDTH, W - lead - 56), height: H - 2 * PAD });

    // Toolbar: placed by the window, laid out by its own container.
    const host = detail.hidden ? null : detailBox;
    toolbar.hidden = !host;
    toolbarNow = null;
    if (host) {
      const vertical = d.placement.orientation === 'vertical';
      const available = vertical ? area.height - 2 * PAD : host.width - 2 * PAD;
      const layout = toolbarLayout(TOOLBAR_ITEMS, { available, tier: d.tier, orientation: d.placement.orientation, maxGroups: d.placement.maxGroups });
      toolbarNow = layout;
      const origin = vertical
        ? { x: W - PAD - strip + PAD, y: PAD + PAD }
        : d.placement.edge === 'bottom'
          ? { x: host.x + PAD, y: host.y + host.height - PAD - tierH }
          : { x: host.x + PAD, y: host.y + HEADER_H + 4 };
      const box = vertical ? { x: origin.x - 2, y: origin.y - 2, width: tierH + 4, height: available + 4 } : { x: origin.x - 2, y: origin.y - 2, width: available + 4, height: tierH + 4 };
      place(toolbar, box);
      detail.style.setProperty('--room-top', !vertical && d.placement.edge === 'top' ? `${tierH + 8}px` : '0px');
      detail.style.setProperty('--room-bottom', !vertical && d.placement.edge === 'bottom' ? `${tierH + 8}px` : '0px');
      toolbar.dataset.stage = layout.stage;
      toolbar.dataset.orientation = layout.orientation;
      toolbar.dataset.overflow = layout.overflow.join(',');
      toolbar.dataset.extent = String(layout.extent);
      toolbar.dataset.available = String(available);
      toolbar.querySelector<HTMLElement>('.tag')!.textContent =
        `toolbar · ${d.placement.edge} · ${layout.stage}${layout.overflow.length ? ` · … ${layout.overflow.join(', ')}` : ''}${layout.aside.length ? ` · text row ${layout.aside.join(', ')}` : ''}`;
      for (const cap of toolbar.querySelectorAll('.cap')) cap.remove();
      let at = 0;
      for (const capsule of layout.capsules) {
        const cap = el('div', { class: 'cap', 'data-kind': capsule.kind });
        for (const id of capsule.items) {
          const item = TOOLBAR_ITEMS.find((i) => i.id === id);
          const extent = item?.kind === 'text' ? (item.width ?? 3 * tierH) : tierH;
          const it = el('span', { class: 'it' }, item?.kind === 'text' ? id : id === '…' ? '…' : id.slice(0, 2));
          it.style.width = vertical ? `${tierH}px` : `${extent}px`;
          it.style.height = vertical ? `${extent}px` : `${tierH}px`;
          if (item?.badge) it.dataset.badge = '';
          cap.append(it);
        }
        const r = vertical ? { x: 2, y: 2 + at, width: tierH, height: capsule.extent } : { x: 2 + at, y: 2, width: capsule.extent, height: tierH };
        place(cap, r, tierH / 2);
        toolbar.append(cap);
        at += capsule.extent + 8;
      }
    }

    // An open surface takes the model's form for the window, and keeps it open across classes.
    surface.hidden = !sheet;
    scrim.style.display = (sheet?.scrim || d.supporting.form === 'over') ? 'block' : 'none';
    if (sheet && app.surface) {
      const side = { x: right + PAD, y: PAD, width: sheetW, height: area.height, radius: 20 };
      const boxOf = (form: string): MorphBox => surfaceBox(form, sheet, side);
      surfaceMorph.aim(sheet.form, boxOf);
      surface.dataset.form = sheet.form;
      surface.dataset.kind = app.surface;
      surface.querySelector<HTMLElement>('.tag')!.textContent = `${app.surface} · ${sheet.form}${sheet.fromSource ? ' · from source' : ''}${sheet.scrim ? ' · scrim' : ''}`;
      surface.querySelector<HTMLElement>('.what')!.textContent = `${app.surface} (model)`;
    } else {
      surfaceMorph.from = surfaceMorph.to = null;
    }

    // The fold. In the canary only the atoms are told of no fold; the stage still lays out for it.
    const posture = c.posture;
    fold.toggleAttribute('data-unknown', !foldAware);
    fold.style.display = posture.kind === 'flat' ? 'none' : 'block';
    if (posture.kind !== 'flat') {
      const b = posture.fold.bounds;
      const line = 2;
      const r = posture.kind === 'tabletop' ? { x: 0, y: b.y - (b.height ? 0 : line / 2), width: W, height: b.height || line } : { x: b.x - (b.width ? 0 : line / 2), y: 0, width: b.width || line, height: H };
      place(fold, r);
      fold.dataset.occluding = String(posture.fold.occluding);
    }

    writeReadout(c, d);
    paintMorphs();
    kick();
  }

  function surfaceBox(form: string, f: PresentationForm, side: MorphBox): MorphBox {
    const region = f.region;
    const cx = region.x + region.width / 2;
    const cy = region.y + region.height / 2;
    switch (form) {
      case 'popover': {
        const s = sourceRect() ?? { x: region.x + 16, y: region.y + 16, width: 80, height: 44 };
        const w = Math.min(320, region.width - 16);
        const h = Math.min(240, region.height - 16);
        const x = Math.min(Math.max(s.x, region.x + PAD), region.x + region.width - PAD - w);
        const below = s.y + s.height + PAD;
        const y = below + h <= region.y + region.height - PAD ? below : Math.max(region.y + PAD, s.y - PAD - h);
        return { x, y, width: w, height: h, radius: 24 };
      }
      case 'bottom-sheet': {
        const w = Math.min(f.maxWidth ?? region.width, region.width);
        const h = Math.round(region.height * 0.5);
        return { x: cx - w / 2, y: region.y + region.height - h, width: w, height: h, radius: 28 };
      }
      case 'centered-sheet':
      case 'basic-dialog': {
        const w = Math.min(f.maxWidth ?? 560, region.width - 48);
        const h = form === 'basic-dialog' ? Math.min(280, region.height - 48) : Math.min(520, region.height - 96);
        return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, radius: 28 };
      }
      case 'alert': {
        const w = Math.min(300, region.width - 48);
        return { x: cx - w / 2, y: cy - 90, width: w, height: 180, radius: 28 };
      }
      case 'side-sheet':
      case 'side-pane':
        return side;
      default:
        return { ...region, radius: 0 };
    }
  }

  function paintMorphs(): void {
    if (navMorph.to) {
      const f = navMorph.frame();
      place(nav, f.box, f.box.radius);
      nav.dataset.form = navMorph.shown();
      nav.toggleAttribute('data-morphing', navMorph.moving());
      items.style.setProperty('--ink', String(f.showing === 'from' ? f.ink.outgoing : f.ink.incoming));
    }
    if (surfaceMorph.to && !surface.hidden) {
      const f = surfaceMorph.frame();
      place(surface, f.box, f.box.radius);
      surface.dataset.shown = surfaceMorph.shown();
    }
    if (recording) {
      const r = nav.getBoundingClientRect();
      recording.push({
        form: nav.dataset.form ?? '',
        target: nav.dataset.target ?? '',
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        navs: win.querySelectorAll('nav').length,
        id: (win.querySelector('nav') as (HTMLElement & { __body?: string }) | null)?.__body ?? '',
        morphing: nav.hasAttribute('data-morphing'),
      });
    }
  }

  function kick(): void {
    if (frame) return;
    lastTime = 0;
    frame = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    frame = 0;
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
    lastTime = now;
    const instant = ctx?.reduceMotion ?? false;
    const a = navMorph.to ? navMorph.step(dt, instant) : false;
    const b = surfaceMorph.to ? surfaceMorph.step(dt, instant) : false;
    paintMorphs();
    if (a || b || recording) frame = requestAnimationFrame(tick);
  }

  function writeReadout(c: AdaptiveContext, d: NonNullable<typeof decisions>): void {
    const yes = (v: boolean) => (v ? 'yes' : 'no');
    const along = (b: Rect, k: 'x' | 'y') => `${k} ${roundRect(b)[k]} to ${Math.round((b[k] + (k === 'x' ? b.width : b.height)) * 10) / 10}`;
    const posture = c.posture.kind === 'flat' ? 'flat' : `${c.posture.kind} · fold at ${along(c.posture.fold.bounds, c.posture.kind === 'book' ? 'x' : 'y')} · ${c.posture.fold.occluding ? 'occluding' : 'not occluding'}`;
    const rows: [string, string][] = [
      ['window', `${Math.round(c.window.width)} × ${Math.round(c.window.height)} dp · ${d.classes.width} / ${d.classes.height}`],
      ['posture', posture],
      ['segments', d.segments.map((s) => JSON.stringify(roundRect(s))).join('\n')],
      ['input', `primary ${c.input.primary} · any coarse ${yes(c.input.anyCoarse)} · hover ${yes(c.input.hover)} · keyboard ${yes(c.input.keyboard)}`],
      ['atoms', `tier ${d.tier} · hit area ${d.hit} dp · hover by the event`],
      ['navigation', `${d.nav.form} · ${d.nav.edge} · ${d.nav.primary} primary · ${d.nav.secondary} secondary ${d.nav.secondaryVisible ? 'shown' : 'hidden'}${d.nav.search ? ` · search ${d.nav.search.form} in ${d.nav.search.place}${d.nav.search.shortcut ? ' + shortcut' : ''}` : ''}${d.nav.expandable ? ` · expands ${d.nav.expandable}` : ''}`],
      ['panes', `${d.panes.panes} · ${d.panes.visible.join(' + ')}${d.panes.split ? ` · ${d.panes.split.kind}` : ''}${d.panes.back ? ' · back' : ''}${d.panes.placeholder ? ' · placeholder' : ''}${d.panes.selectionShown ? ' · selection shown' : ''}`],
      ['supporting', `${d.supporting.form}${d.supporting.remembered ? ' · remembered' : ''}`],
      ['accessory', d.accessory.placement],
      ['toolbar', `${d.placement.edge} · ${d.placement.orientation}${Number.isFinite(d.placement.maxGroups) ? ` · ≤ ${d.placement.maxGroups} groups` : ''}`],
      ['toolbar layout', toolbarNow ? `${toolbarNow.stage} : ${toolbarNow.capsules.map((c) => c.items.join('+')).join(' | ')}${toolbarNow.overflow.length ? ` : overflow ${toolbarNow.overflow.join(', ')}` : ''}${toolbarNow.aside.length ? ` : text row ${toolbarNow.aside.join(', ')}` : ''}` : 'no detail shown'],
      ['surfaces', SURFACE_KINDS.map((k) => `${k} → ${d.surfaces[k].form}`).join('\n')],
    ];
    readout.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd data-key="${k}">${v.replace(/</g, '&lt;')}</dd>`).join('');
    win.dataset.width = d.classes.width;
    win.dataset.height = d.classes.height;
    win.dataset.posture = c.posture.kind;
    win.dataset.tier = d.tier;
  }

  // The simulated window: its size, the segments it reports and the input the elements read.
  let current = sim;
  function apply(next: Sim): void {
    current = next;
    win.style.width = `${next.w}px`;
    win.style.height = `${next.h}px`;
    const input = INPUTS[next.input];
    setInputOverride({ ...input, keyboard: next.keyboard ?? input.keyboard });
    const posture = postureOf(next);
    setViewportOverride({ root: win, segments: foldAware ? windowSegments({ window: { width: next.w, height: next.h }, posture }) : undefined });
    if (ctx && !foldAware) ctx = { ...ctx, posture };
    if (ctx) render();
  }

  function writeUrl(): void {
    const next = new URLSearchParams(location.search);
    next.set('view', 'adaptive');
    next.delete('preset');
    next.set('w', String(current.w));
    next.set('h', String(current.h));
    next.set('posture', current.posture);
    next.set('input', current.input);
    for (const [key, value] of [['fold', current.fold], ['keyboard', current.keyboard === null ? null : current.keyboard ? '1' : '0']] as const) {
      if (value === null) next.delete(key);
      else next.set(key, String(value));
    }
    if (current.band) next.set('band', String(current.band));
    else next.delete('band');
    history.replaceState(null, '', `?${next.toString()}`);
  }

  // Interaction inside the window.
  listScroll.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.row');
    if (!row) return;
    app.selected = Number(row.dataset.index);
    app.showing = 'detail';
    render();
  });
  back.addEventListener('click', () => {
    app.showing = 'list';
    render();
  });
  items.addEventListener('click', (e) => {
    const dest = (e.target as Element).closest<HTMLElement>('[data-section]');
    if (dest) {
      app.section = Number(dest.dataset.section);
      render();
    }
  });
  collapse.addEventListener('click', () => {
    app.sidebarCollapsed = !app.sidebarCollapsed;
    render();
  });
  document.getElementById('filters')!.addEventListener('click', () => {
    app.surface = app.surface === 'popover' ? null : 'popover';
    render();
  });
  closeSurface.addEventListener('click', () => {
    app.surface = null;
    render();
  });

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, w: current.w, h: current.h };
    const move = (m: PointerEvent) => apply({ ...current, w: Math.max(280, Math.round(start.w + m.clientX - start.x)), h: Math.max(280, Math.round(start.h + m.clientY - start.y)) });
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      writeUrl();
      syncControls();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  // Scenarios: each step is applied, held for a few frames, and checked against what the person had.
  const snapshot = () => ({
    section: app.section,
    selected: app.selected,
    showing: app.showing,
    notes: notes.value,
    scroll: listScroll.scrollTop,
    surface: app.surface,
    pinned: app.pinned,
    collapsed: app.sidebarCollapsed,
  });
  const frames = (n: number) =>
    new Promise<void>((resolve) => {
      let left = n;
      const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });

  const SCENARIOS: Record<ScenarioName, () => { label: string; sim: Partial<Sim> }[]> = {
    sweep: () => {
      const out: { label: string; sim: Partial<Sim> }[] = [];
      for (let w = 360; w <= 1600; w += 20) out.push({ label: `→ ${w}`, sim: { w, h: 900 } });
      for (let w = 1600; w >= 360; w -= 20) out.push({ label: `← ${w}`, sim: { w, h: 900 } });
      return out;
    },
    fold: () => [
      { label: 'folded', sim: { w: 412, h: 915, posture: 'flat', input: 'touch' } },
      { label: 'unfolded', sim: { w: 673, h: 841, posture: 'flat' } },
      { label: 'book', sim: { w: 673, h: 841, posture: 'book', fold: null, band: 0 } },
      { label: 'unfolded landscape', sim: { w: 841, h: 673, posture: 'flat' } },
      { label: 'tabletop', sim: { w: 841, h: 673, posture: 'tabletop' } },
      { label: 'flat again', sim: { w: 841, h: 673, posture: 'flat' } },
      { label: 'folded again', sim: { w: 412, h: 915, posture: 'flat' } },
    ],
    rotate: () => [
      { label: 'portrait', sim: { w: 412, h: 915, posture: 'flat', input: 'touch' } },
      { label: 'landscape', sim: { w: 915, h: 412 } },
      { label: 'portrait again', sim: { w: 412, h: 915 } },
    ],
    keyboard: () => [
      { label: 'tablet', sim: { w: 800, h: 1280, posture: 'flat', input: 'touch', keyboard: null } },
      { label: 'keyboard and trackpad attached', sim: { input: 'tablet-keyboard', keyboard: true } },
      { label: 'detached', sim: { input: 'touch', keyboard: null } },
    ],
  };

  async function run(name: ScenarioName, opts: { hold?: number } = {}): Promise<StepLog[]> {
    const before = snapshot();
    const log: StepLog[] = [];
    const firstNav = win.querySelector('nav');
    for (const step of SCENARIOS[name]()) {
      apply({ ...current, ...step.sim });
      await frames(opts.hold ?? (name === 'sweep' ? 1 : 3));
      const now = snapshot();
      const lost = (Object.keys(before) as (keyof typeof before)[]).filter((k) => now[k] !== before[k]);
      const d = decisions!;
      log.push({
        label: step.label,
        w: current.w,
        h: current.h,
        posture: ctx?.posture.kind ?? '',
        width: d.classes.width,
        height: d.classes.height,
        nav: d.nav.form,
        panes: d.panes.panes,
        tier: d.tier,
        hit: d.hit,
        preserved: lost.length === 0,
        lost,
        sameNav: win.querySelector('nav') === firstNav && win.querySelectorAll('nav').length === 1,
        surface: surface.hidden ? null : (surface.dataset.form ?? null),
      });
    }
    writeUrl();
    syncControls();
    return log;
  }

  function roundRect(r: Rect): Rect {
    const k = (v: number) => Math.round(v * 10) / 10;
    return { x: k(r.x), y: k(r.y), width: k(r.width), height: k(r.height) };
  }

  // Chrome: the same knobs as the URL.
  const syncControls = () => {
    for (const input of controls.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-sim]')) {
      const key = input.dataset.sim as keyof Sim;
      const value = current[key];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value === true;
      else input.value = value === null ? '' : String(value);
    }
    for (const input of controls.querySelectorAll<HTMLInputElement>('[data-app]')) input.checked = (app as unknown as Record<string, boolean>)[input.dataset.app!] === true;
    const surfacePick = controls.querySelector<HTMLSelectElement>('[data-surface]');
    if (surfacePick) surfacePick.value = app.surface ?? '';
  };
  if (options.chrome) {
    const select = (key: string, values: readonly string[], label = key) =>
      `<label>${label}<select data-sim="${key}">${values.map((v) => `<option>${v}</option>`).join('')}</select></label>`;
    const number = (key: string, label = key) => `<label>${label}<input type="number" data-sim="${key}"></label>`;
    const check = (key: string, label: string) => `<label><input type="checkbox" data-app="${key}">${label}</label>`;
    controls.innerHTML = [
      `<label>preset<select data-preset><option value="">—</option>${Object.keys(PRESETS).map((p) => `<option>${p}</option>`).join('')}</select></label>`,
      number('w'),
      number('h'),
      select('posture', ['flat', 'book', 'tabletop']),
      number('fold'),
      number('band'),
      `<label><input type="checkbox" data-sim="occluding">occluding</label>`,
      select('input', Object.keys(INPUTS)),
      `<label><input type="checkbox" data-sim="keyboard">keyboard</label>`,
      check('barMinimized', 'bar minimised'),
      check('sidebarCollapsed', 'sidebar collapsed'),
      check('pinned', 'supporting pinned'),
      check('supportingOpen', 'supporting open'),
      `<label>surface<select data-surface><option value="">none</option>${SURFACE_KINDS.filter((k) => k !== 'menu').map((k) => `<option>${k}</option>`).join('')}</select></label>`,
      ...(['sweep', 'fold', 'rotate', 'keyboard'] as const).map((s) => `<button type="button" data-run="${s}">run ${s}</button>`),
    ].join('');
    controls.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t.dataset.preset !== undefined && t.value) {
        const p = PRESETS[t.value as PresetName] as Partial<Sim>;
        apply({ ...current, posture: 'flat', fold: null, band: 0, occluding: null, keyboard: null, ...p });
      } else if (t.dataset.sim) {
        const key = t.dataset.sim as keyof Sim;
        const raw = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t.value;
        const value = typeof raw === 'boolean' ? raw : key === 'posture' || key === 'input' ? raw : raw === '' ? null : Number(raw);
        apply({ ...current, [key]: value } as Sim);
      } else if (t.dataset.app) {
        (app as unknown as Record<string, boolean>)[t.dataset.app] = (t as HTMLInputElement).checked;
        render();
      } else if (t.dataset.surface !== undefined) {
        app.surface = (t.value || null) as SurfaceKind | null;
        render();
      }
      writeUrl();
      syncControls();
    });
    controls.addEventListener('click', (e) => {
      const name = (e.target as HTMLElement).dataset.run as ScenarioName | undefined;
      if (name) void run(name, { hold: name === 'sweep' ? 1 : 30 });
    });
  }

  window.__adaptive = {
    ctx: () => ctx,
    decisions: () => (decisions ? JSON.parse(JSON.stringify({ ...decisions, toolbar: toolbarNow })) : {}),
    set: (patch) => apply({ ...current, ...patch }),
    app: (patch) => {
      if (patch) {
        Object.assign(app, patch);
        render();
      }
      return { ...app };
    },
    state: () => snapshot(),
    run,
    record: () => {
      recording = [];
      kick();
    },
    frames: () => recording ?? [],
    settled: () => !navMorph.moving() && !surfaceMorph.moving(),
  };

  apply(sim);
  watchAdaptiveContext(win, (next) => {
    ctx = foldAware ? next : { ...next, posture: postureOf(current) };
    render();
  });
  syncControls();
}

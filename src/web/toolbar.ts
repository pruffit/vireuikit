import { VIREGLASS_CONTROL_MATERIAL, type BackdropSample, type VireGlassMaterial } from 'vireglass';
import { presentationFor, sameA11y, type A11yMode, type A11yOverride, type Presentation } from '../kit/a11y';
import type { AdaptiveContext } from '../kit/adaptive/context';
import type { MorphBox } from '../kit/adaptive/form-morph';
import { hitTarget, sizeTier } from '../kit/adaptive/input';
import {
  MORE_ID,
  toolbarLayout,
  toolbarPlacement,
  type ToolbarItem,
  type ToolbarLayout,
  type ToolbarPlacement,
} from '../kit/adaptive/toolbar';
import { ATOM_AT_REST, atomBody, atomMaterial } from '../kit/atom';
import { createMotionClock, stepMotion, stepSpring, type Spring } from '../kit/morph';
import { probeFramePeriod } from './refresh';
import { BUTTON_SIZES, hitSlop, iconButtonSize, type ControlSize } from '../kit/sizes';
import {
  TOOLBAR_PLACE_TIMING,
  aimToolbarMorph,
  createToolbarMorph,
  currentToolbarFrame,
  stepToolbarMorph,
  toolbarBounds,
  toolbarClipPath,
  toolbarClusters,
  toolbarGeometry,
  toolbarLayoutWithHysteresis,
  toolbarMorphFrame,
  toolbarPlaceFrame,
  toolbarSilhouette,
  type ToolbarFrame,
  type ToolbarGeometry,
  type ToolbarMorphState,
} from '../kit/toolbar';
import { effectiveA11y, watchA11yOverride, watchSystemA11y } from './a11y';
import { dropEmptyStyle, deepActive } from './dom';
import { effectiveInput, shellOf, watchAdaptiveContext, watchPointerInput } from './environment';
import { attachControlGlassNow, ensureGlass, glassLoaded, moveGlass, probeRect, type GlassSession } from './glass';
import { createScrollEdge, type ScrollEdge } from './scroll-edge';
import { ensureStyles } from './styles';

const FORCE_ATTRIBUTE = 'data-vire-force-state';
const GLASS_ON = new Set(['', 'present']);
const TRIGGER = ':scope > button, :scope > vire-button > button, :scope > vire-icon-button > button';
const SURFACES = 'vire-menu, vire-popover, vire-sheet';
const MORE_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
const CHOOSE_WAIT_MS = 900;

type Edge = ToolbarPlacement['edge'];
const PLACEMENTS: Record<Edge, ToolbarPlacement> = {
  bottom: { edge: 'bottom', orientation: 'horizontal', maxGroups: 3 },
  top: { edge: 'top', orientation: 'horizontal', maxGroups: Number.POSITIVE_INFINITY },
  trailing: { edge: 'trailing', orientation: 'vertical', maxGroups: Number.POSITIVE_INFINITY },
};

type Stage = ToolbarLayout['stage'];
type Forced = { stage: Stage | null; morph: number | null; place: number | null };

type SurfaceLike = HTMLElement & {
  readonly open?: boolean;
  anchor?: Element | null;
  retractInto?(el: Element | null): void;
  follow?(): void;
};

type Item = {
  id: string;
  group: string;
  host: HTMLElement;
  el: HTMLElement;
  button: HTMLButtonElement;
  surface: SurfaceLike | null;
  kind: 'icon' | 'text';
  priority: number;
  badge: boolean;
  primary: boolean;
  label: string;
  icon: Element | null;
  shown: boolean | null;
  box: string;
  ink: number;
};

type More = {
  menu: HTMLElement;
  host: HTMLElement;
  button: HTMLButtonElement;
  list: HTMLElement;
  rows: Map<string, HTMLButtonElement>;
  shown: boolean | null;
  box: string;
  ink: number;
};

type Capsule = {
  el: HTMLElement;
  session: GlassSession | null;
  last: string;
  appear: number;
  clip: string;
  box: string;
  used: boolean;
};

export interface VireToolbarElement extends HTMLElement {
  a11y: A11yOverride;
  sample: BackdropSample | null;
  /** The element the toolbar floats over; the `scroller` attribute names it by id instead. */
  scroller: Element | null;
}

export type ToolbarElementOptions = { nonce?: string | undefined };

const px = (v: number) => `${v.toFixed(2)}px`;
const round = Math.round;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const firstAttr = (name: string, els: readonly Element[]) => els.map((el) => el.getAttribute(name)).find((v) => v !== null) ?? null;

/** The text a button shows, leaving out its badge and its glyphs. */
function visibleText(root: Element): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[data-badge], [data-badge-label], svg, [aria-hidden=true]')) continue;
    text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function parseForced(value: string | null): Forced | null {
  if (!value) return null;
  const forced: Forced = { stage: null, morph: null, place: null };
  for (const token of value.split(',')) {
    const [name, rest] = token.trim().split(':');
    if (name === 'stage' && (rest === 'separate' || rest === 'merged' || rest === 'overflow')) forced.stage = rest;
    else if ((name === 'morph' || name === 'place') && rest !== undefined && /^\d*\.?\d+$/.test(rest)) forced[name] = clamp01(Number(rest));
  }
  return forced.stage || forced.morph !== null || forced.place !== null ? forced : null;
}

let ids = 0;

export function createToolbarElementClass(options: ToolbarElementOptions = {}) {
  return class VireToolbar extends HTMLElement implements VireToolbarElement {
    static observedAttributes = ['placement', 'more-label', 'glass', 'scroller', 'scroll-edge', FORCE_ATTRIBUTE];

    #upgraded = false;
    #cleanups: (() => void)[] = [];
    #restore: (() => void)[] = [];
    #hadStyle = false;
    #own: A11yOverride = {};
    #mode: A11yMode | null = null;
    #modeKey = '';
    #presentation: Presentation | null = null;
    #glassBroken = false;
    #sample: BackdropSample | null = null;
    #scrollerProp: Element | null = null;
    #edge: ScrollEdge | null = null;
    #probed: BackdropSample | null = null;
    #ctx: AdaptiveContext | null = null;

    #items: Item[] = [];
    #byHost = new Map<HTMLElement, Item>();
    #idOf = new WeakMap<Element, string>();
    #spacerAfter: string | undefined;
    #more: More | null = null;
    #capsules = new Map<string, Capsule>();
    #styleWas = new Map<HTMLElement, boolean>();
    #hiddenWas = new Map<HTMLElement, boolean>();
    #tabWas = new Map<HTMLElement, string | null>();
    #glassWas = new Map<HTMLElement, string | null>();
    #textWidths: Record<string, number> = {};
    #size: ControlSize = 'touch';

    #placement: ToolbarPlacement | null = null;
    #placing: { t: Spring; pending: ToolbarPlacement; swapped: boolean } | null = null;
    #layout: ToolbarLayout | null = null;
    #geometry: ToolbarGeometry | null = null;
    #morph: ToolbarMorphState | null = null;
    #extent = 0;
    #forced: Forced | null = null;
    #forcedFrame: ToolbarFrame | null = null;
    #widthWas: string | null = null;
    #frame = 0;
    #clock = createMotionClock();
    #remeasureFrame = 0;
    #wasMoving = false;
    #stepping = false;
    #rtl: boolean | null = null;

    #current: HTMLButtonElement | null = null;
    #lastFocus: Element | null = null;
    #lastOwner: Item | null = null;
    #focusMore = false;
    #choosing: (() => void) | null = null;

    get a11y(): A11yOverride {
      return this.#own;
    }

    set a11y(next: A11yOverride) {
      this.#own = { ...next };
      if (this.#upgraded) this.#refreshMode();
    }

    get sample(): BackdropSample | null {
      return this.#sample;
    }

    set sample(next: BackdropSample | null) {
      this.#sample = next;
      for (const capsule of this.#capsules.values()) capsule.session?.setSample(this.#sampleNow());
      if (this.#upgraded) this.#publishInk();
    }

    get scroller(): Element | null {
      return this.#scrollerProp;
    }

    set scroller(next: Element | null) {
      this.#scrollerProp = next;
      this.#syncEdge();
    }

    connectedCallback(): void {
      probeFramePeriod();
      for (const key of ['a11y', 'sample', 'scroller']) {
        if (!Object.prototype.hasOwnProperty.call(this, key)) continue;
        const value: unknown = Reflect.get(this, key);
        Reflect.deleteProperty(this, key);
        Reflect.set(this, key, value);
      }
      this.#hadStyle = this.hasAttribute('style');
      ensureStyles(this, options.nonce);
      this.#forced = parseForced(this.getAttribute(FORCE_ATTRIBUTE));
      this.#awaitParts();
    }

    disconnectedCallback(): void {
      for (const cleanup of this.#cleanups.splice(0)) cleanup();
      cancelAnimationFrame(this.#frame);
      cancelAnimationFrame(this.#remeasureFrame);
      this.#frame = this.#remeasureFrame = 0;
      this.#choosing?.();
      for (const capsule of this.#capsules.values()) {
        capsule.session?.destroy();
        capsule.el.remove();
      }
      this.#capsules.clear();
      this.#edge?.destroy();
      this.#edge = null;
      const more = this.#more;
      if (more) {
        more.menu.remove();
        this.#more = null;
      }
      for (const item of this.#items) {
        item.el.removeAttribute('data-vk-item');
        item.el.removeAttribute('data-vk-kind');
        item.el.removeAttribute('data-fading');
        for (const name of Array.from(item.el.style)) if (/^--vk-(i[xywh]|ink|slop)/.test(name)) item.el.style.removeProperty(name);
      }
      for (const [el, had] of this.#styleWas) dropEmptyStyle(el, had);
      for (const [el, was] of this.#hiddenWas) el.toggleAttribute('hidden', was);
      for (const restore of this.#restore.splice(0).reverse()) restore();
      this.#styleWas.clear();
      this.#hiddenWas.clear();
      this.#tabWas.clear();
      this.#glassWas.clear();
      if (this.#widthWas !== null) this.style.width = this.#widthWas;
      this.#widthWas = null;
      for (const name of ['aria-orientation', 'data-vk', 'data-surface', 'data-glass', 'data-frost', 'data-contrast', 'data-edge', 'data-orientation', 'data-stage', 'data-moving', 'data-forced']) {
        this.removeAttribute(name);
      }
      for (const name of Array.from(this.style)) if (name.startsWith('--vk-') || name.startsWith('--vireglass-')) this.style.removeProperty(name);
      dropEmptyStyle(this, this.#hadStyle);
      this.#upgraded = false;
      this.#items = [];
      this.#byHost.clear();
      this.#placement = this.#layout = this.#geometry = this.#morph = this.#placing = null;
      this.#forcedFrame = null;
      this.#ctx = this.#probed = null;
      this.#presentation = this.#mode = null;
      this.#modeKey = '';
      this.#current = this.#lastFocus = this.#lastOwner = null;
      this.#focusMore = false;
      this.#textWidths = {};
      this.#spacerAfter = undefined;
    }

    attributeChangedCallback(name: string): void {
      if (name === FORCE_ATTRIBUTE) {
        this.#forced = parseForced(this.getAttribute(name));
        if (this.#upgraded) this.#applyForced();
        return;
      }
      if (!this.#upgraded) return;
      if (name === 'glass') this.#refreshMode(true);
      else if (name === 'scroller' || name === 'scroll-edge') this.#syncEdge();
      else if (name === 'more-label') this.#syncMoreLabel();
      else this.#relayout();
    }

    // The parser connects the element before its children exist, so the markup is waited for, not made up.
    #awaitParts(): void {
      if (this.#tryUpgrade()) return;
      const observer = new MutationObserver(() => {
        if (this.#tryUpgrade()) observer.disconnect();
      });
      observer.observe(this, { childList: true, subtree: true });
      this.#cleanups.push(() => observer.disconnect());
    }

    #tryUpgrade(): boolean {
      if (!this.querySelector(':scope > [data-group] button')) return false;
      this.#upgrade();
      return true;
    }

    #keep(el: Element, name: string, value: string | null): void {
      const was = el.getAttribute(name);
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
      this.#restore.push(() => (was === null ? el.removeAttribute(name) : el.setAttribute(name, was)));
    }

    #upgrade(): void {
      this.#upgraded = true;
      this.setAttribute('data-vk', '');
      this.#edge = createScrollEdge(this, 'band', (el) => this.prepend(el));
      this.#keep(this, 'role', 'toolbar');
      this.#cleanups.push(watchSystemA11y(() => this.#refreshMode()));
      this.#cleanups.push(watchA11yOverride(() => this.#refreshMode()));
      this.#cleanups.push(
        watchPointerInput(() => {
          this.#remeasure();
          cancelAnimationFrame(this.#remeasureFrame);
          this.#remeasureFrame = requestAnimationFrame(() => this.#remeasure());
        }),
      );
      this.#createMore();
      this.#scan();
      this.#applySizes();
      this.#measure();
      this.#listen();
      this.#mode = null;
      this.#modeKey = '';
      this.#refreshMode();

      const shell = shellOf(this);
      this.#cleanups.push(
        watchAdaptiveContext(shell, (ctx) => {
          this.#ctx = ctx;
          this.#relayout();
        }),
      );
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => this.#relayout());
        observer.observe(this);
        this.#cleanups.push(() => observer.disconnect());
      }
      const fonts = this.ownerDocument.fonts;
      if (fonts) {
        void fonts.ready.then(() => this.#upgraded && this.#remeasure());
        const loaded = () => this.#remeasure();
        fonts.addEventListener('loadingdone', loaded);
        this.#cleanups.push(() => fonts.removeEventListener('loadingdone', loaded));
      }
      if (this.#forced) this.#applyForced();
    }

    // ---- the markup ---------------------------------------------------------------------------------------------

    #idFor(el: Element, prefix: string): string {
      let id = this.#idOf.get(el);
      if (!id) {
        ids += 1;
        id = `${prefix}${ids}`;
        this.#idOf.set(el, id);
      }
      return id;
    }

    #itemOf(host: HTMLElement, group: string): Item | null {
      let button: HTMLButtonElement | null = null;
      let surface: SurfaceLike | null = null;
      if (host.matches(SURFACES)) {
        surface = host as SurfaceLike;
        button = host.querySelector<HTMLButtonElement>(TRIGGER);
      } else if (host instanceof HTMLButtonElement) {
        button = host;
      } else if (host.matches('vire-button, vire-icon-button')) {
        button = host.querySelector<HTMLButtonElement>(':scope > button');
      }
      if (!button) return null;
      const parent = button.parentElement;
      const el = parent?.matches('vire-button, vire-icon-button') ? parent : button;
      if ((host.hidden || el.hidden) && !this.#hiddenWas.has(el)) return null;
      const text = visibleText(button);
      const label = button.getAttribute('aria-label') ?? text;
      const known = this.#byHost.get(host);
      const own = [host, el, button];
      const item: Item = {
        id: this.#idFor(host, 'i'),
        group,
        host,
        el,
        button,
        surface,
        kind: text === '' ? 'icon' : 'text',
        priority: Number(firstAttr('data-priority', own)) || 0,
        badge: host.querySelector('[data-badge]') !== null,
        primary: own.some((e) => e.hasAttribute('data-primary')),
        label,
        icon: button.querySelector('svg, img'),
        shown: known?.button === button ? known.shown : null,
        box: known?.button === button ? known.box : '',
        ink: known?.button === button ? known.ink : 1,
      };
      return item;
    }

    #scan(): void {
      const items: Item[] = [];
      let spacerAfter: string | undefined;
      for (const child of Array.from(this.children)) {
        if (child.hasAttribute('data-spacer')) {
          const before = child.previousElementSibling;
          if (before?.hasAttribute('data-group')) spacerAfter = this.#idFor(before, 'g');
          continue;
        }
        if (!child.hasAttribute('data-group')) continue;
        const group = this.#idFor(child, 'g');
        for (const host of Array.from(child.children)) {
          const item = host instanceof HTMLElement ? this.#itemOf(host, group) : null;
          if (item) items.push(item);
        }
      }
      this.#spacerAfter = spacerAfter;
      const was = this.#items;
      const now = new Set(items.map((i) => i.host));
      for (const item of was) {
        if (now.has(item.host)) continue;
        this.#release(item);
      }
      this.#items = items;
      this.#byHost = new Map(items.map((i) => [i.host, i]));
      for (const item of items) this.#adopt(item);
    }

    /** What an item needs to stand in the toolbar: placed by the model, drawn without a lens of its own. */
    #adopt(item: Item): void {
      const { el, button } = item;
      if (!this.#styleWas.has(el)) this.#styleWas.set(el, el.hasAttribute('style'));
      if (!this.#hiddenWas.has(el)) this.#hiddenWas.set(el, el.hidden);
      el.setAttribute('data-vk-item', '');
      el.setAttribute('data-vk-kind', item.kind);
      if (el !== button && !this.#glassWas.has(el) && el.getAttribute('glass') !== 'off') {
        this.#glassWas.set(el, el.getAttribute('glass'));
        this.#keep(el, 'glass', 'off');
      }
      if (!this.#tabWas.has(button)) {
        this.#tabWas.set(button, button.getAttribute('tabindex'));
        this.#restore.push(() => {
          const was = this.#tabWas.get(button);
          if (was === undefined) return;
          if (was === null) button.removeAttribute('tabindex');
          else button.setAttribute('tabindex', was);
        });
      }
    }

    #release(item: Item): void {
      const { el } = item;
      el.removeAttribute('data-vk-item');
      el.removeAttribute('data-vk-kind');
      el.removeAttribute('data-fading');
      for (const name of Array.from(el.style)) if (/^--vk-(i[xywh]|ink|slop)/.test(name)) el.style.removeProperty(name);
      const had = this.#styleWas.get(el);
      if (had !== undefined) dropEmptyStyle(el, had);
      this.#styleWas.delete(el);
      const hidden = this.#hiddenWas.get(el);
      if (hidden !== undefined) el.toggleAttribute('hidden', hidden);
      this.#hiddenWas.delete(el);
      const tab = this.#tabWas.get(item.button);
      if (tab !== undefined) {
        if (tab === null) item.button.removeAttribute('tabindex');
        else item.button.setAttribute('tabindex', tab);
      }
      this.#tabWas.delete(item.button);
    }

    #model(): ToolbarItem[] {
      return this.#items.map((i) => {
        const model: ToolbarItem = { id: i.id, kind: i.kind, priority: i.priority, group: i.group };
        if (i.badge) model.badge = true;
        if (i.primary) model.primary = true;
        const width = this.#textWidths[i.id];
        if (i.kind === 'text' && width !== undefined) model.width = width;
        return model;
      });
    }

    #byId(id: string): Item | undefined {
      return this.#items.find((i) => i.id === id);
    }

    /** The natural width of each text item, read with the item let go of its slot. */
    #measure(): void {
      const widths: Record<string, number> = {};
      for (const item of this.#items) {
        if (item.kind !== 'text') continue;
        const { el } = item;
        const hidden = el.hidden;
        const was = el.style.getPropertyValue('--vk-iw');
        el.hidden = false;
        el.style.setProperty('--vk-iw', 'auto');
        widths[item.id] = el.getBoundingClientRect().width;
        if (was) el.style.setProperty('--vk-iw', was);
        else el.style.removeProperty('--vk-iw');
        el.hidden = hidden;
      }
      this.#textWidths = widths;
    }

    #applySizes(): void {
      const tier = sizeTier(effectiveInput());
      this.#size = tier;
      const spec = BUTTON_SIZES[tier];
      const set = (name: string, value: string) => this.style.setProperty(name, value);
      set('--vk-height', `${iconButtonSize(tier).height}px`);
      set('--vk-pad-x', `${spec.paddingX}px`);
      set('--vk-icon', `${spec.icon}px`);
      set('--vk-radius', `${spec.radius}px`);
      const floor = hitTarget(effectiveInput());
      for (const item of this.#items) {
        if (item.el !== item.button) continue;
        const width = item.kind === 'icon' ? spec.height : (this.#textWidths[item.id] ?? spec.height);
        item.el.style.setProperty('--vk-slop-x', String(hitSlop(width, floor)));
        item.el.style.setProperty('--vk-slop-y', String(hitSlop(spec.height, floor)));
      }
    }

    #remeasure(): void {
      if (!this.#upgraded) return;
      this.#applySizes();
      this.#measure();
      this.#relayout();
    }

    // ---- "…" ------------------------------------------------------------------------------------------------------

    #createMore(): void {
      const doc = this.ownerDocument;
      const menu = doc.createElement('vire-menu');
      menu.setAttribute('data-vk-more', '');
      const host = doc.createElement('vire-icon-button');
      host.setAttribute('glass', 'off');
      host.hidden = true;
      const button = doc.createElement('button');
      button.type = 'button';
      button.innerHTML = MORE_GLYPH;
      host.append(button);
      const list = doc.createElement('div');
      list.setAttribute('popover', '');
      menu.append(host, list);
      this.append(menu);
      this.#more = { menu, host, button, list, rows: new Map(), shown: null, box: '', ink: 0 };
      this.#syncMoreLabel();
    }

    #syncMoreLabel(): void {
      this.#more?.button.setAttribute('aria-label', this.getAttribute('more-label') || 'More');
    }

    /** One row for each overflowed item, in toolbar order. */
    #syncRows(overflow: readonly string[]): void {
      const more = this.#more;
      if (!more) return;
      const wanted = overflow.map((id) => this.#byId(id)).filter((i): i is Item => i !== undefined);
      const same =
        wanted.length === more.rows.size &&
        wanted.every((item, i) => {
          const row = [...more.rows.entries()][i];
          return row !== undefined && row[0] === item.id && row[1].textContent === item.label && row[1].disabled === item.button.disabled;
        });
      if (same) return;
      more.rows.clear();
      more.list.replaceChildren();
      for (const item of wanted) {
        const row = this.ownerDocument.createElement('button');
        row.type = 'button';
        if (item.icon) row.append(item.icon.cloneNode(true));
        row.append(item.label);
        row.disabled = item.button.disabled;
        row.addEventListener('click', () => this.#choose(item));
        more.rows.set(item.id, row);
        more.list.append(row);
      }
    }

    /** Choosing a row clicks the original; a surface the original opens grows from "…" once the menu has put it back. */
    #choose(item: Item): void {
      const more = this.#more;
      const surface = item.surface;
      if (!more || !surface) {
        item.button.click();
        return;
      }
      this.#choosing?.();
      const go = () => {
        this.#choosing?.();
        if (!this.#more || !this.isConnected) return;
        surface.anchor = more.host;
        item.button.click();
      };
      if (!more.list.matches(':popover-open')) {
        go();
        return;
      }
      const timer = window.setTimeout(go, CHOOSE_WAIT_MS);
      const onToggle = (e: Event) => {
        if ((e as ToggleEvent).newState === 'closed') go();
      };
      more.list.addEventListener('toggle', onToggle);
      this.#choosing = () => {
        window.clearTimeout(timer);
        more.list.removeEventListener('toggle', onToggle);
        this.#choosing = null;
      };
    }

    // ---- the window and the layout --------------------------------------------------------------------------------

    #wantedPlacement(): ToolbarPlacement | null {
      const wanted = this.getAttribute('placement');
      if (wanted && Object.hasOwn(PLACEMENTS, wanted)) return PLACEMENTS[wanted as Edge];
      return this.#ctx ? toolbarPlacement(this.#ctx) : null;
    }

    #applyPlacement(next: ToolbarPlacement): void {
      this.#placement = next;
      this.setAttribute('data-edge', next.edge);
      this.setAttribute('data-orientation', next.orientation);
      this.setAttribute('aria-orientation', next.orientation);
      this.#probed = null;
      this.#syncEdge();
    }

    #syncEdge(): void {
      const edge = this.#edge;
      if (!edge) return;
      const mode = this.getAttribute('scroll-edge');
      const side = this.#placement?.edge === 'top' ? 'top' : this.#placement?.edge === 'bottom' ? 'bottom' : null;
      const scroller = this.#presentation?.glass && side && mode !== 'off' ? this.#lookupScroller() : null;
      edge.set(
        scroller && side
          ? {
              scroller,
              side,
              bar: this,
              hard: mode === 'hard',
              ink: () => {
                const ink = this.style.getPropertyValue('--vireglass-ink');
                return ink === '' ? 0 : Number(ink);
              },
            }
          : null,
      );
    }

    #lookupScroller(): Element | null {
      if (this.#scrollerProp?.isConnected) return this.#scrollerProp;
      const id = this.getAttribute('scroller');
      const root = this.getRootNode() as Document | ShadowRoot;
      return id && 'getElementById' in root ? root.getElementById(id) : null;
    }

    #vertical(): boolean {
      return this.#placement?.orientation === 'vertical';
    }

    /** The container's extent along the toolbar, to the fraction: a threshold is crossed by a fraction of a dp. */
    #measureExtent(): number {
      const style = getComputedStyle(this);
      if (!this.#stepping) this.#rtl = style.direction === 'rtl';
      const vertical = this.#vertical();
      const size = parseFloat(vertical ? style.height : style.width);
      if (!Number.isFinite(size)) return vertical ? this.clientHeight : this.clientWidth;
      if (style.boxSizing !== 'border-box') return size;
      const edge = (sides: string[]) => sides.reduce((sum, side) => sum + (parseFloat(style.getPropertyValue(side)) || 0), 0);
      return size - edge(vertical ? ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'] : ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']);
    }

    /** The extents at which the layout is each stage, for a lab that wants a stage rather than a width. */
    #stageExtents(orientation: ToolbarPlacement['orientation']): Record<Stage, number> {
      const model = this.#model();
      const tier = this.#size;
      const side = BUTTON_SIZES[tier].height;
      const lay = (available: number) => toolbarLayout(model, { available, tier, orientation });
      const separate = lay(1e6).extent;
      const merged = lay(separate - 1);
      const mergedExtent = merged.stage === 'merged' ? merged.extent : separate;
      const overflow = Math.max(mergedExtent - 1.5 * (side + 8), side);
      // A little room past the threshold, so a spacer shows as one.
      return { separate: separate + 24, merged: Math.min(mergedExtent + 12, separate - 1), overflow };
    }

    #relayout(): void {
      if (!this.#upgraded || !this.#ctx) return;
      this.#syncEdge();
      const wanted = this.#wantedPlacement();
      if (!wanted) return;
      if (!this.#placement) {
        this.#applyPlacement(wanted);
        this.#compute(true);
        return;
      }
      if (wanted.edge !== this.#placement.edge) {
        const instant = this.#presentation?.instantSprings ?? false;
        if (instant || this.#forced) {
          this.#applyPlacement(wanted);
          this.#compute(true);
          return;
        }
        if (!this.#placing || this.#placing.swapped) this.#placing = { t: { x: 0, v: 0, target: 1 }, pending: wanted, swapped: false };
        else this.#placing.pending = wanted;
      } else if (this.#placing && !this.#placing.swapped && wanted.edge === this.#placement.edge) {
        this.#placing = null;
      }
      this.#compute(false);
    }

    #layoutFor(available: number, model: ToolbarItem[], previous: ToolbarLayout | null, uncapped: boolean): ToolbarLayout {
      const placement = this.#placement!;
      const options = {
        available,
        tier: this.#size,
        orientation: placement.orientation,
        maxGroups: uncapped ? Number.POSITIVE_INFINITY : placement.maxGroups,
      };
      return uncapped ? toolbarLayout(model, options) : toolbarLayoutWithHysteresis(model, options, previous);
    }

    #geometryFor(layout: ToolbarLayout, available: number, model: ToolbarItem[]): ToolbarGeometry {
      const options: Parameters<typeof toolbarGeometry>[1] = { tier: this.#size, available, items: model, textWidths: this.#textWidths };
      if (this.#spacerAfter !== undefined) options.spacerAfter = this.#spacerAfter;
      return toolbarGeometry(layout, options);
    }

    /** `rest` lays the toolbar out for the container it is in now, with nothing to morph from. */
    #compute(rest: boolean): void {
      const placement = this.#placement;
      if (!placement) return;
      this.#applySizes();
      const model = this.#model();
      const forced = this.#forced;
      let available: number;
      let layout: ToolbarLayout;
      this.#forcedFrame = null;
      if (forced?.stage) {
        this.#rtl = getComputedStyle(this).direction === 'rtl';
        const extents = this.#stageExtents(placement.orientation);
        available = extents[forced.stage];
        this.#fixExtent(available);
        layout = this.#layoutFor(available, model, null, true);
        if (forced.morph !== null) {
          const before: Record<Stage, Stage> = { separate: 'merged', merged: 'separate', overflow: 'merged' };
          const fromAvailable = extents[before[forced.stage]];
          const from = this.#geometryFor(this.#layoutFor(fromAvailable, model, null, true), fromAvailable, model);
          const to = this.#geometryFor(layout, available, model);
          this.#forcedFrame = toolbarMorphFrame(from, to, forced.morph);
          this.#geometry = to;
          this.#morph = createToolbarMorph(to);
        }
      } else {
        this.#fixExtent(null);
        this.#extent = this.#measureExtent();
        available = this.#extent;
        layout = this.#layoutFor(available, model, rest ? null : this.#layout, false);
      }
      this.#extent = available;
      const geometry = this.#geometryFor(layout, available, model);
      const previous = this.#layout;
      this.#layout = layout;
      this.#geometry = geometry;
      if (!this.#forcedFrame) {
        if (!this.#morph || rest || forced) this.#morph = createToolbarMorph(geometry);
        else aimToolbarMorph(this.#morph, geometry);
      }
      this.setAttribute('data-stage', layout.stage);
      this.#syncRows(layout.overflow);
      this.#run();
      this.#afterLayout(previous, layout);
      if (this.#focusMore) this.#paint();
      this.#rove();
      if (!previous || previous.stage !== layout.stage || previous.overflow.join() !== layout.overflow.join()) {
        this.dispatchEvent(
          new CustomEvent('vire-toolbar-layout', {
            detail: { edge: placement.edge, orientation: placement.orientation, stage: layout.stage, overflow: layout.overflow.length },
          }),
        );
      }
    }

    #fixExtent(extent: number | null): void {
      if (extent === null) {
        if (this.#widthWas !== null) {
          this.style.width = this.#widthWas;
          this.#widthWas = null;
        }
        return;
      }
      if (this.#widthWas === null) this.#widthWas = this.style.width;
      if (this.#vertical()) this.style.height = px(extent);
      else this.style.width = px(extent);
    }

    /** What the change means for what the person is doing: focus, and an open surface whose trigger left. */
    #afterLayout(previous: ToolbarLayout | null, layout: ToolbarLayout): void {
      const more = this.#more;
      if (!previous || !more) return;
      const before = new Set(previous.overflow);
      const active = deepActive(this.ownerDocument);
      for (const id of layout.overflow) {
        if (before.has(id)) continue;
        const item = this.#byId(id);
        if (!item) continue;
        if (active && item.host.contains(active) && !item.surface?.contains(active)) this.#focusMore = true;
        if (item.surface?.open) {
          this.#focusMore = true;
          item.surface.retractInto?.(more.host);
        }
      }
      const now = new Set(layout.overflow);
      for (const item of this.#items) {
        if (now.has(item.id) || !item.surface || item.surface.anchor !== more.host) continue;
        item.surface.retractInto?.(item.el);
      }
    }

    // ---- drawing --------------------------------------------------------------------------------------------------

    #moving(): boolean {
      const morph = this.#morph;
      const morphing = morph !== null && !(morph.t.v === 0 && morph.t.x === morph.t.target && (morph.t.x === 0 || morph.t.x === 1));
      return morphing || this.#placing !== null;
    }

    #run(): void {
      const instant = this.#presentation?.instantSprings ?? false;
      let swept = false;
      if (instant && !this.#forced) {
        if (this.#morph) stepToolbarMorph(this.#morph, 0, true);
        swept = this.#stepPlace(0, true);
      }
      if (!this.#stepping) {
        this.#rtl ??= getComputedStyle(this).direction === 'rtl';
        this.#paint(swept);
      }
      if (this.#frame || this.#forced || this.#stepping) return;
      if (!this.#moving()) {
        this.toggleAttribute('data-moving', false);
        return;
      }
      this.#clock = createMotionClock();
      this.#frame = requestAnimationFrame((t) => this.#tick(t));
    }

    #tick(now: number): void {
      this.#frame = 0;
      if (!this.isConnected || this.#forced) return;
      const instant = this.#presentation?.instantSprings ?? false;
      this.#stepping = true;
      let swept = false;
      try {
        stepMotion(this.#clock, now, (dt) => {
          if (this.#morph) stepToolbarMorph(this.#morph, dt, instant);
          if (this.#stepPlace(dt, instant)) swept = true;
          return true;
        });
      } finally {
        this.#stepping = false;
      }
      this.#paint(swept);
      if (this.#moving()) this.#frame = requestAnimationFrame((t) => this.#tick(t));
      else this.toggleAttribute('data-moving', false);
    }

    /** Whether the form was swapped, which leaves the old form's lenses to be dropped by the next paint. */
    #stepPlace(dt: number, instant: boolean): boolean {
      const placing = this.#placing;
      if (!placing) return false;
      let swapped = false;
      const moving = stepSpring(placing.t, dt, TOOLBAR_PLACE_TIMING.response, TOOLBAR_PLACE_TIMING.damping, instant);
      if (!placing.swapped && placing.t.x >= 0.5) {
        placing.swapped = true;
        this.#applyPlacement(placing.pending);
        this.#computeAfterSwap();
        swapped = true;
      }
      if (!moving) {
        if (!placing.swapped) {
          placing.swapped = true;
          this.#applyPlacement(placing.pending);
          this.#computeAfterSwap();
          swapped = true;
        }
        this.#placing = null;
      }
      return swapped;
    }

    #computeAfterSwap(): void {
      const placing = this.#placing;
      this.#placing = null;
      this.#compute(true);
      this.#placing = placing;
    }

    #appearNow(): number {
      if (this.#forced?.place !== null && this.#forced?.place !== undefined) {
        const frame = toolbarPlaceFrame(this.#forced.place);
        return this.#forced.place < 0.5 ? frame.outgoing : frame.incoming;
      }
      const placing = this.#placing;
      if (!placing) return 1;
      const frame = toolbarPlaceFrame(clamp01(placing.t.x));
      return placing.swapped ? frame.incoming : frame.outgoing;
    }

    #paint(sweep = false): void {
      const geometry = this.#geometry;
      const layout = this.#layout;
      const morph = this.#morph;
      const placement = this.#placement;
      if (!geometry || !layout || !morph || !placement) return;
      const frame = this.#forcedFrame ?? currentToolbarFrame(morph);
      const appear = this.#appearNow();
      const moving = this.#forcedFrame === null && this.#moving();
      this.toggleAttribute('data-moving', moving);

      const vertical = placement.orientation === 'vertical';
      const rtl = this.#rtl === true;
      const side = geometry.side;
      const span = frame.shapes.length ? toolbarBounds(frame.shapes) : null;
      const shift = placement.edge === 'bottom' && this.#spacerAfter === undefined && span ? (this.#extent - span.width) / 2 - span.x : 0;
      const aside = geometry.aside;
      const asideShift = aside ? aside.box.width - side : 0;
      const flipAbout = vertical ? side : this.#extent;
      const fit = (b: MorphBox, inAside = false): MorphBox => {
        let x = b.x + (vertical ? 0 : shift) - (vertical && inAside ? asideShift : 0);
        if (rtl) x = flipAbout - x - b.width;
        return { ...b, x };
      };

      for (const item of this.#items) {
        const slot = frame.slots[item.id];
        const row = aside?.slots[item.id];
        if (slot) this.#placeItem(item, fit(slot.box), slot.ink * appear);
        else if (row) this.#placeItem(item, fit(row, true), appear);
        else this.#placeItem(item, null, 0);
      }
      const follow = moving || this.#wasMoving;
      this.#wasMoving = moving;
      const more = this.#more;
      if (more) {
        const target = geometry.more;
        if (frame.more) this.#placeMore(more, fit(frame.more.box), frame.more.presence * appear);
        else if (target && this.#forcedFrame === null) this.#placeMore(more, fit(target), 0);
        else this.#placeMore(more, null, 0);
      }
      this.#paintCapsules(frame, aside ? fit(aside.box, true) : null, appear, fit, moving, sweep);
      if (follow) for (const item of this.#items) item.surface?.follow?.();
      if (this.#focusMore && more && more.shown && more.ink > 0.05) {
        this.#focusMore = false;
        more.button.focus({ preventScroll: true });
      }
    }

    #placeItem(item: Item, box: MorphBox | null, ink: number): void {
      const { el } = item;
      const shown = box !== null;
      if (item.shown !== shown) {
        item.shown = shown;
        el.toggleAttribute('hidden', !shown);
      }
      if (!box) return;
      const key = `${box.x.toFixed(2)},${box.y.toFixed(2)},${box.width.toFixed(2)},${box.height.toFixed(2)}`;
      if (key !== item.box) {
        item.box = key;
        const s = el.style;
        s.setProperty('--vk-ix', px(box.x));
        s.setProperty('--vk-iy', px(box.y));
        s.setProperty('--vk-iw', px(box.width));
        s.setProperty('--vk-ih', px(box.height));
      }
      const fading = ink < 0.999;
      if (fading) {
        if (Math.abs(item.ink - ink) > 1e-3 || !el.hasAttribute('data-fading')) el.style.setProperty('--vk-ink', clamp01(ink).toFixed(3));
        el.setAttribute('data-fading', '');
      } else if (el.hasAttribute('data-fading')) {
        el.removeAttribute('data-fading');
        el.style.removeProperty('--vk-ink');
      }
      item.ink = ink;
    }

    #placeMore(more: More, box: MorphBox | null, ink: number): void {
      const { host } = more;
      const shown = box !== null;
      if (more.shown !== shown) {
        more.shown = shown;
        if (shown) host.hidden = false;
        host.setAttribute('data-vk-item', '');
      }
      if (!box) {
        if (!more.list.matches(':popover-open')) host.hidden = true;
        return;
      }
      const key = `${box.x.toFixed(2)},${box.y.toFixed(2)},${box.width.toFixed(2)},${box.height.toFixed(2)}`;
      if (key !== more.box) {
        more.box = key;
        const s = host.style;
        s.setProperty('--vk-ix', px(box.x));
        s.setProperty('--vk-iy', px(box.y));
        s.setProperty('--vk-iw', px(box.width));
        s.setProperty('--vk-ih', px(box.height));
      }
      if (ink < 0.999) {
        host.style.setProperty('--vk-ink', clamp01(ink).toFixed(3));
        host.setAttribute('data-fading', '');
      } else if (host.hasAttribute('data-fading')) {
        host.removeAttribute('data-fading');
        host.style.removeProperty('--vk-ink');
      }
      more.ink = ink;
    }

    // ---- the lenses -----------------------------------------------------------------------------------------------

    #capsule(key: string): Capsule {
      let capsule = this.#capsules.get(key);
      if (!capsule) {
        const el = this.ownerDocument.createElement('div');
        el.setAttribute('data-vk-capsule', '');
        el.setAttribute('aria-hidden', 'true');
        el.inert = true;
        if (this.#edge) this.#edge.after(el);
        else this.prepend(el);
        capsule = { el, session: null, last: '', appear: -1, clip: '', box: '', used: false };
        this.#capsules.set(key, capsule);
      }
      return capsule;
    }

    #sampleNow(): BackdropSample | null {
      return this.#sample ?? this.#probed;
    }

    #lensMaterial(): VireGlassMaterial {
      return atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'iconButton', ATOM_AT_REST);
    }

    /** What lies behind the toolbar as a whole, read once so every capsule agrees on its ink. */
    #probeBehind(): void {
      if (this.#probed || this.#sample || !glassLoaded()) return;
      const r = this.getBoundingClientRect();
      const was = this.style.visibility;
      this.style.visibility = 'hidden';
      try {
        this.#probed = probeRect(this.ownerDocument, { x: r.x, y: r.y, width: r.width, height: r.height });
      } finally {
        if (was) this.style.visibility = was;
        else this.style.removeProperty('visibility');
      }
    }

    #attach(capsule: Capsule, box: MorphBox): void {
      if (capsule.session || !this.#presentation?.glass || !this.#mode) return;
      if (!glassLoaded()) return;
      this.#probeBehind();
      const mode = this.#mode;
      const session = attachControlGlassNow(capsule.el, {
        material: this.#lensMaterial(),
        geometry: { width: round(box.width), height: round(box.height), cornerRadius: round(box.radius) },
        accessibility: mode,
        onTouch: false,
        sample: this.#sampleNow(),
        interactive: false,
      });
      if (!session) return;
      capsule.session = session;
      capsule.last = '';
      capsule.appear = -1;
      capsule.el.style.removeProperty('opacity');
      this.#publishInk();
      this.dispatchEvent(new CustomEvent('vire-glass-ready'));
    }

    #detachAll(): void {
      for (const capsule of this.#capsules.values()) {
        capsule.session?.destroy();
        capsule.session = null;
        capsule.last = '';
        capsule.appear = -1;
      }
    }

    /** The items stand on the capsules but are not inside them, so they take the ink the lens chose. */
    #publishInk(): void {
      for (const capsule of this.#capsules.values()) {
        if (!capsule.session) continue;
        for (const name of ['--vireglass-ink-color', '--vireglass-tint-color', '--vireglass-ink']) {
          const value = capsule.el.style.getPropertyValue(name);
          if (value) this.style.setProperty(name, value);
        }
        this.#edge?.update();
        return;
      }
    }

    #paintCapsules(frame: ToolbarFrame, asideBox: MorphBox | null, appear: number, fit: (b: MorphBox) => MorphBox, live: boolean, sweep: boolean): void {
      const placement = this.#placement!;
      const axis = placement.orientation === 'vertical' ? 'y' : 'x';
      const shapes: { key: string; box: MorphBox }[] = frame.capsules.map((c, i) => ({ key: c.items[0] ?? `c${i}`, box: fit(c.box) }));
      if (frame.more) shapes.push({ key: MORE_ID, box: fit(frame.more.box) });
      for (const capsule of this.#capsules.values()) capsule.used = false;

      const groups = toolbarClusters(
        shapes.map((s) => s.box),
        frame.smoothing,
        axis,
      );
      const draw: { key: string; box: MorphBox; clip: string; kind: string }[] = [];
      const kinds = [...frame.capsules.map((c) => c.kind), 'more'];
      for (const group of groups) {
        const boxes = group.map((i) => shapes[i]!.box);
        const lead = shapes[group[0]!]!;
        if (group.length === 1) {
          if (lead.box.width > 0 && lead.box.height > 0) draw.push({ key: lead.key, box: lead.box, clip: '', kind: kinds[group[0]!]! });
          continue;
        }
        const bounds = toolbarBounds(boxes);
        draw.push({ key: lead.key, box: bounds, clip: toolbarClipPath(toolbarSilhouette(boxes, frame.smoothing, axis)), kind: kinds[group[0]!]! });
      }
      // A capsule is a lens by position, not by item, so a stage or place that regroups the items finds its lenses waiting.
      draw.forEach((d, i) => (d.key = `d${i}`));
      if (asideBox) draw.push({ key: 'aside', box: asideBox, clip: '', kind: 'text' });

      const moving = this.#moving();
      for (const { key, box, clip, kind } of draw) {
        const capsule = this.#capsule(key);
        capsule.used = true;
        capsule.el.hidden = false;
        if (capsule.el.getAttribute('data-kind') !== kind) capsule.el.setAttribute('data-kind', kind);
        const boxKey = `${box.x.toFixed(2)},${box.y.toFixed(2)},${box.width.toFixed(2)},${box.height.toFixed(2)},${box.radius.toFixed(2)}`;
        if (boxKey !== capsule.box) {
          capsule.box = boxKey;
          const s = capsule.el.style;
          s.setProperty('--vk-x', px(box.x));
          s.setProperty('--vk-y', px(box.y));
          s.setProperty('--vk-w', px(box.width));
          s.setProperty('--vk-h', px(box.height));
          s.setProperty('--vk-r', px(box.radius));
        }
        if (clip !== capsule.clip) {
          capsule.clip = clip;
          if (clip) capsule.el.style.setProperty('clip-path', clip);
          else capsule.el.style.removeProperty('clip-path');
        }
        this.#attach(capsule, box);
        this.#pushLens(capsule, box, appear, live);
      }
      for (const [key, capsule] of this.#capsules) {
        if (capsule.used) continue;
        if ((!moving && !this.#placing) || sweep) {
          capsule.session?.destroy();
          capsule.el.remove();
          this.#capsules.delete(key);
        } else {
          capsule.el.hidden = true;
        }
      }
    }

    /** Hands a lens only what changed: a moved box needs nothing, a new size rebuilds its filter and a new presence only writes it. While the toolbar moves the lens is in interim. */
    #pushLens(capsule: Capsule, box: MorphBox, appear: number, moving: boolean): void {
      const session = capsule.session;
      if (!session) {
        capsule.el.style.opacity = appear < 0.999 ? appear.toFixed(3) : '';
        return;
      }
      moveGlass(session, moving, () => {
        const geometry = { width: round(box.width), height: round(box.height), cornerRadius: round(box.radius) };
        const key = `${geometry.width}x${geometry.height}r${geometry.cornerRadius}`;
        if (key !== capsule.last) {
          capsule.last = key;
          session.setGeometry(geometry);
        }
        const presence = Math.round(appear * 100) / 100;
        if (presence !== capsule.appear) {
          capsule.appear = presence;
          session.setAppear(presence);
        }
      });
    }

    // ---- modes ----------------------------------------------------------------------------------------------------

    #wantsGlass(): boolean {
      const wanted = this.getAttribute('glass');
      return wanted !== null && GLASS_ON.has(wanted);
    }

    #refreshMode(force = false, afterFailure = false): void {
      if (!this.#upgraded) return;
      if (!afterFailure) this.#glassBroken = false;
      const mode = effectiveA11y(this.#own);
      let next = presentationFor(mode, this.#wantsGlass());
      if (this.#glassBroken && next.glass) next = { ...next, glass: false, surface: next.frost ? 'frosted' : 'plain' };
      const changed = force || !this.#mode || !sameA11y(this.#mode, mode) || next.surface !== this.#presentation?.surface;
      this.#mode = mode;
      this.#modeKey = JSON.stringify(mode);
      this.#presentation = next;
      this.setAttribute('data-surface', next.surface);
      this.toggleAttribute('data-contrast', next.contrastBorder);
      this.toggleAttribute('data-frost', next.frost);
      this.setAttribute('data-glass', next.glass ? 'on' : 'off');
      this.#syncEdge();
      const body = atomBody(VIREGLASS_CONTROL_MATERIAL, ATOM_AT_REST, next.frost);
      this.style.setProperty('--vk-body-alpha', body.alpha.toFixed(3));
      this.style.setProperty('--vk-body-white', body.white.toFixed(3));
      this.style.setProperty('--vk-body-lift', body.lift.toFixed(3));
      const more = this.#more;
      if (more) {
        if (this.#wantsGlass()) more.menu.setAttribute('glass', '');
        else more.menu.removeAttribute('glass');
        (more.menu as HTMLElement & { sample: BackdropSample | null }).sample = this.#sample;
      }
      if (changed) {
        this.#detachAll();
        this.#probed = null;
        if (next.glass && !glassLoaded()) {
          void ensureGlass().then(
            () => this.#upgraded && this.#paint(),
            () => {
              this.#glassBroken = true;
              this.#refreshMode(false, true);
            },
          );
        }
      }
      if (this.#ctx) this.#run();
    }

    // ---- keyboard and focus ---------------------------------------------------------------------------------------

    /** The buttons in sight, in toolbar order. */
    #order(): HTMLButtonElement[] {
      const layout = this.#layout;
      if (!layout) return [];
      const out: HTMLButtonElement[] = [];
      for (const capsule of layout.capsules) {
        for (const id of capsule.items) {
          if (id === MORE_ID) {
            if (this.#more) out.push(this.#more.button);
          } else {
            const item = this.#byId(id);
            if (item) out.push(item.button);
          }
        }
      }
      for (const id of layout.aside) {
        const item = this.#byId(id);
        if (item) out.push(item.button);
      }
      return out;
    }

    #setTab(button: HTMLElement, value: '0' | '-1'): void {
      if (button.getAttribute('tabindex') !== value) button.setAttribute('tabindex', value);
    }

    /** One Tab stop: the last one focused while it is in sight, else the first. */
    #rove(): void {
      const order = this.#order();
      if (!this.#current || !order.includes(this.#current) || this.#current.disabled) {
        this.#current = order.find((b) => !b.disabled) ?? order[0] ?? null;
      }
      for (const item of this.#items) this.#setTab(item.button, item.button === this.#current ? '0' : '-1');
      if (this.#more) this.#setTab(this.#more.button, this.#more.button === this.#current ? '0' : '-1');
    }

    #listen(): void {
      const on = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, capture = false) => {
        target.addEventListener(type, handler as EventListener, capture);
        this.#cleanups.push(() => target.removeEventListener(type, handler as EventListener, capture));
      };
      on<FocusEvent>(this, 'focusin', (e) => {
        this.#lastFocus = e.target as Element;
        this.#lastOwner = this.#items.find((i) => i.host.contains(e.target as Node)) ?? null;
        const order = this.#order();
        if (e.target instanceof HTMLButtonElement && order.includes(e.target) && this.#current !== e.target) {
          this.#current = e.target;
          this.#rove();
        }
      });
      on<KeyboardEvent>(
        this,
        'keydown',
        (e) => {
          if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
          const vertical = this.#vertical();
          const rtl = getComputedStyle(this).direction === 'rtl';
          const along = vertical ? { next: 'ArrowDown', previous: 'ArrowUp' } : { next: rtl ? 'ArrowLeft' : 'ArrowRight', previous: rtl ? 'ArrowRight' : 'ArrowLeft' };
          const order = this.#order();
          const at = order.indexOf(e.target as HTMLButtonElement);
          if (at < 0) return;
          const reachable = order.filter((b) => !b.disabled);
          const here = reachable.indexOf(order[at]!);
          let to: HTMLButtonElement | undefined;
          if (e.key === along.next) to = reachable[Math.min(here + 1, reachable.length - 1)];
          else if (e.key === along.previous) to = reachable[Math.max(here - 1, 0)];
          else if (e.key === 'Home') to = reachable[0];
          else if (e.key === 'End') to = reachable.at(-1);
          else return;
          e.preventDefault();
          e.stopPropagation();
          to?.focus();
        },
        true,
      );

      const markup = new MutationObserver((records) => {
        const order = this.#order();
        const owner = this.#lastOwner;
        const index = owner ? order.indexOf(owner.button) : -1;
        let changed = false;
        for (const record of records) {
          if (this.#isOwn(record.target)) continue;
          if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((n) => this.#isOwn(n))) continue;
          changed = true;
        }
        this.#syncEdge();
        if (!changed) return;
        this.#scan();
        this.#applySizes();
        this.#measure();
        this.#relayout();
        // An item that held the focus, or whose surface did, is gone: the neighbour that takes its place gets it,
        // once the surface has let go of it.
        if (owner && !this.#items.some((i) => i.host === owner.host && i.button === owner.button)) {
          const handOver = (frames: number) => {
            const active = deepActive(this.ownerDocument);
            if (!this.isConnected) return;
            if (active && active !== this.ownerDocument.body) {
              // Still with the surface of the item that went: it lets go once it has closed.
              if (owner.host.contains(active) && frames > 0) requestAnimationFrame(() => handOver(frames - 1));
              return;
            }
            const next = this.#order();
            next[Math.min(Math.max(index, 0), next.length - 1)]?.focus({ preventScroll: true });
          };
          requestAnimationFrame(() => handOver(30));
        }
      });
      markup.observe(this, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-priority', 'data-primary', 'aria-label', 'disabled', 'data-vk', 'data-group', 'data-spacer'],
      });
      this.#cleanups.push(() => markup.disconnect());
    }

    #isOwn(node: Node): boolean {
      const more = this.#more;
      if (node === more?.menu) return true;
      if (node instanceof Element && (node.hasAttribute('data-vk-capsule') || node.hasAttribute('data-vk-edge'))) return true;
      return more !== null && more.menu.contains(node);
    }

    // ---- forced states --------------------------------------------------------------------------------------------

    #applyForced(): void {
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.toggleAttribute('data-forced', this.#forced !== null);
      this.#placing = null;
      this.#fixExtent(null);
      this.#layout = null;
      this.#morph = null;
      this.#relayoutForced();
    }

    #relayoutForced(): void {
      if (!this.#ctx) return;
      const wanted = this.#wantedPlacement();
      if (wanted) this.#applyPlacement(wanted);
      this.#compute(true);
    }
  };
}

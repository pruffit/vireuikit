import { VIREGLASS_CONTROL_MATERIAL, type BackdropSample, type VireGlassMaterial } from 'vireglass';
import type { GlassMorph } from 'vireglass/dom';
import { presentationFor, sameA11y, type A11yMode, type A11yOverride, type Presentation } from '../kit/a11y';
import type { AdaptiveContext } from '../kit/adaptive/context';
import {
  FORM_MORPH_TIMING,
  createFormMorph,
  formMorphFrame,
  stepFormMorph,
  type FormMorphState,
  type MorphBox,
} from '../kit/adaptive/form-morph';
import { hitTarget, sizeTier } from '../kit/adaptive/input';
import { navigationForm, type NavigationForm, type NavigationFormKind } from '../kit/adaptive/navigation';
import { ATOM_AT_REST, atomBody, atomMaterial } from '../kit/atom';
import { menuMaterial } from '../kit/menu';
import { createMotionClock, stepMotion } from '../kit/morph';
import { probeFramePeriod } from './refresh';
import {
  aimNavMorph,
  cancelNavDrag,
  clampScrollTop,
  createMinimize,
  createNavDrag,
  createNavMorph,
  currentNavFrame,
  expandMinimize,
  fixedNavigationForm,
  itemsUnderLens,
  moveNavDrag,
  navDragFrame,
  navLayout,
  pressNavDrag,
  releaseNavDrag,
  stepMinimize,
  stepNavDrag,
  stepNavMorph,
  type NavLayout,
  type NavMorphState,
} from '../kit/nav';
import { effectiveA11y, watchA11yOverride, watchSystemA11y } from './a11y';
import { SHEET_INSET_EVENT, SHEET_INSET_PROPERTY, effectiveInput, isEditable, shellOf, watchAdaptiveContext } from './environment';
import { cancelMotionFrame, deepActive, dropEmptyStyle, requestMotionFrame } from './dom';
import { attachControlGlass, holdGlass, landGlass, moveGlass, type GlassSession } from './glass';
import { createScrollEdge, type ScrollEdge } from './scroll-edge';
import { ensureStyles } from './styles';

const FORCE_ATTRIBUTE = 'data-vire-force-state';
const GLASS_ON = new Set(['', 'present']);
const FORMS: readonly string[] = ['bar', 'rail', 'sidebar'];
const MATERIAL_STEPS = 10;
const DRAG_SLOP = 6;
const LENS_MAGNIFY = 0.15;
const SWALLOW_MS = 100;
const DEFAULT_TOGGLE_LABEL = 'Sidebar';
const TOGGLE_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>';

type Forced =
  | { kind: 'minimized' }
  | { kind: 'morph'; from: NavigationFormKind | 'minimized'; t: number }
  | { kind: 'drag'; at: number };

type Plan = {
  nav: NavigationForm;
  layout: NavLayout;
  /** The destinations in layout order: the primary ones shown, then the rest. */
  order: HTMLAnchorElement[];
  search: HTMLAnchorElement | null;
  selected: number;
  visible: Set<HTMLAnchorElement>;
  secondaryShown: boolean;
  /** What the content must clear: an open sidebar covers it, so the rail's insets stay. */
  insets: { bottom: number; start: number };
  /** Whether the sidebar has been opened over the content (a rail that the person expanded). */
  over: boolean;
};

type Slot = {
  el: HTMLElement;
  session: GlassSession | null;
  token: number;
  key: string;
  last: { material: string; morph: MorphKey; geometry: string };
  /** The presence last handed to the lens, for a slot whose presence moves. */
  appear?: number;
};

type MorphKey = GlassMorph | 'none' | '-' | '';

type Press = { id: number; startX: number; left: number; dragging: boolean; last: number; onLink: boolean };

export interface VireNavElement extends HTMLElement {
  a11y: A11yOverride;
  sample: BackdropSample | null;
  /** The element whose scrolling minimises the bar; the `scroller` attribute names it by id instead. */
  scroller: Element | null;
}

export type NavElementOptions = { nonce?: string | undefined };

const px = (v: number) => `${v.toFixed(2)}px`;
const round = Math.round;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const emptyLast = (): Slot['last'] => ({ material: '', morph: '', geometry: '' });
const sameMorph = (a: MorphKey, b: MorphKey): boolean => {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  const p = a.shape;
  const q = b.shape;
  return (
    a.smoothing === b.smoothing &&
    p?.offsetX === q?.offsetX &&
    p?.offsetY === q?.offsetY &&
    p?.width === q?.width &&
    p?.height === q?.height &&
    p?.cornerRadius === q?.cornerRadius
  );
};
const newSlot = (el: HTMLElement): Slot => ({ el, session: null, token: 0, key: '', last: emptyLast() });
const isCurrent = (link: Element) => {
  const value = link.getAttribute('aria-current');
  return value !== null && value !== 'false';
};

function restoreAria(badge: Element, was: string | null): void {
  if (was === null) badge.removeAttribute('aria-hidden');
  else badge.setAttribute('aria-hidden', was);
}

function stripPlacement(link: HTMLElement, hadStyle: boolean): void {
  for (const name of Array.from(link.style)) if (name.startsWith('--vk-')) link.style.removeProperty(name);
  dropEmptyStyle(link, hadStyle);
}

function parseForced(value: string | null): Forced | null {
  if (!value) return null;
  if (value === 'minimized') return { kind: 'minimized' };
  const morph = /^morph:(bar|rail|sidebar|minimized):(\d*\.?\d+)$/.exec(value);
  if (morph) return { kind: 'morph', from: morph[1] as NavigationFormKind | 'minimized', t: clamp01(Number(morph[2])) };
  const drag = /^drag:(\d*\.?\d+)$/.exec(value);
  return drag ? { kind: 'drag', at: clamp01(Number(drag[1])) } : null;
}

const sameBox = (a: MorphBox | null, b: MorphBox | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.radius === b.radius);

export function createNavElementClass(options: NavElementOptions = {}) {
  return class VireNav extends HTMLElement implements VireNavElement {
    static observedAttributes = [
      'glass',
      'form',
      'collapsed',
      'panes',
      'minimize',
      'scroller',
      'scroll-edge',
      'search-key',
      'toggle-label',
      FORCE_ATTRIBUTE,
    ];

    #navEl: HTMLElement | null = null;
    #pill: HTMLElement | null = null;
    #lens: HTMLElement | null = null;
    #lensInner: HTMLElement | null = null;
    #toggle: HTMLButtonElement | null = null;
    #scrim: HTMLElement | null = null;
    #accessory: HTMLElement | null = null;
    #cleanups: (() => void)[] = [];
    #hadStyle = { host: false, nav: false, parent: false };
    #linkStyle = new Map<HTMLElement, boolean>();
    #hiddenWas = new Map<HTMLElement, boolean>();
    #badgeWas = new Map<HTMLElement, string | null>();
    #mine = new Set<Node>();
    #own: A11yOverride = {};
    #mode: A11yMode | null = null;
    #modeKey = '';
    #presentation: Presentation | null = null;
    #glassBroken = false;
    #body: Slot | null = null;
    #lensSlot: Slot | null = null;
    #accSlot: Slot | null = null;
    #sample: BackdropSample | null = null;
    #ctx: AdaptiveContext | null = null;
    #plan: Plan | null = null;
    #plans = new WeakMap<NavLayout, Plan>();
    #shown: Plan | null = null;
    #morph: NavMorphState | null = null;
    #drag = createNavDrag();
    #press: Press | null = null;
    #minState = createMinimize();
    #scrollerProp: Element | null = null;
    #scrollerEl: Element | null = null;
    #unbindScroller: (() => void) | null = null;
    #edge: ScrollEdge | null = null;
    #over = false;
    #pillAnim: { state: FormMorphState; from: MorphBox | null; to: MorphBox | null } = {
      state: { ...createFormMorph(), t: { x: 1, v: 0, target: 1 } },
      from: null,
      to: null,
    };
    #accAnim: {
      state: FormMorphState;
      from: { box: MorphBox; placement: string } | null;
      to: { box: MorphBox; placement: string } | null;
    } = { state: { ...createFormMorph(), t: { x: 1, v: 0, target: 1 } }, from: null, to: null };
    #accHeld = false;
    #frame = 0;
    #clock = createMotionClock();
    #lensFor: Element | null = null;
    #lastKey = '';
    #parent: HTMLElement | null = null;
    #parentWas: { bottom: string; start: string } | null = null;
    // Leaving the scrolling state resets the offset, and that reset's own scroll event must not overwrite what is remembered.
    #scrollReset = false;
    #scrollTops = new Map<NavigationFormKind, number>();
    #dirty = false;
    #swallow: (() => void) | null = null;
    #tapping = false;
    #tapTimer = 0;

    get a11y(): A11yOverride {
      return this.#own;
    }

    set a11y(next: A11yOverride) {
      this.#own = { ...next };
      if (this.#navEl) this.#refreshMode();
    }

    get sample(): BackdropSample | null {
      return this.#sample;
    }

    set sample(next: BackdropSample | null) {
      this.#sample = next;
      for (const slot of [this.#body, this.#lensSlot, this.#accSlot]) slot?.session?.setSample(next);
      this.#edge?.update();
    }

    get scroller(): Element | null {
      return this.#scrollerProp;
    }

    set scroller(next: Element | null) {
      this.#scrollerProp = next;
      if (!this.#navEl) return;
      this.#bindScroller();
      this.#replan();
    }

    connectedCallback(): void {
      probeFramePeriod();
      for (const key of ['a11y', 'sample', 'scroller']) {
        if (!Object.prototype.hasOwnProperty.call(this, key)) continue;
        const value: unknown = Reflect.get(this, key);
        Reflect.deleteProperty(this, key);
        Reflect.set(this, key, value);
      }
      this.#hadStyle.host = this.hasAttribute('style');
      ensureStyles(this, options.nonce);
      this.#cleanups.push(watchSystemA11y(() => this.#navEl && this.#refreshMode()));
      this.#cleanups.push(watchA11yOverride(() => this.#navEl && this.#refreshMode()));
      this.#awaitParts();
    }

    disconnectedCallback(): void {
      for (const cleanup of this.#cleanups.splice(0)) cleanup();
      cancelMotionFrame(this.#frame);
      this.#frame = 0;
      this.#swallow?.();
      this.#unhold?.();
      window.clearTimeout(this.#tapTimer);
      this.#tapping = false;
      this.#unbindScroller?.();
      this.#unbindScroller = null;
      this.#edge?.destroy();
      this.#edge = null;
      for (const slot of [this.#body, this.#lensSlot, this.#accSlot]) if (slot) this.#detach(slot);
      this.#releaseShortcut();
      this.#markUnder([], null);
      this.#accessory?.removeAttribute('data-placement');
      this.#accessory?.removeAttribute('data-moving');
      for (const el of [this.#accessory, this.#lens]) {
        if (!el) continue;
        for (const name of Array.from(el.style)) if (name.startsWith('--vk-')) el.style.removeProperty(name);
      }
      if (this.#accessory) dropEmptyStyle(this.#accessory, this.#accessoryHadStyle);
      for (const [el, was] of this.#hiddenWas) el.toggleAttribute('hidden', was);
      this.#hiddenWas.clear();
      for (const [badge, was] of this.#badgeWas) restoreAria(badge, was);
      this.#badgeWas.clear();
      for (const [link, had] of this.#linkStyle) stripPlacement(link, had);
      this.#linkStyle.clear();
      for (const node of [this.#pill, this.#lens, this.#toggle, this.#scrim]) node?.remove();
      if (this.#navEl) {
        for (const name of Array.from(this.#navEl.style)) if (name.startsWith('--vk-')) this.#navEl.style.removeProperty(name);
        dropEmptyStyle(this.#navEl, this.#hadStyle.nav);
      }
      this.#clearInsets();
      for (const name of [
        'data-vk',
        'data-surface',
        'data-glass',
        'data-frost',
        'data-contrast',
        'data-form',
        'data-search',
        'data-minimized',
        'data-moving',
        'data-defocus',
        'data-lens',
        'data-scroll',
      ]) {
        this.removeAttribute(name);
      }
      for (const name of Array.from(this.style)) if (name.startsWith('--vk-')) this.style.removeProperty(name);
      dropEmptyStyle(this, this.#hadStyle.host);
      this.#navEl = this.#pill = this.#lens = this.#lensInner = this.#toggle = this.#scrim = this.#accessory = null;
      this.#body = this.#lensSlot = this.#accSlot = null;
      this.#ctx = this.#plan = this.#shown = this.#morph = null;
      this.#plans = new WeakMap();
      this.#scrollTops.clear();
      this.#drag = createNavDrag();
      this.#press = null;
      this.#minState = createMinimize();
      this.#scrollerEl = null;
      this.#over = false;
      this.#lensFor = null;
      this.#lastKey = '';
      this.#mine.clear();
      this.#probe = null;
      this.#safeBottom = 0;
      this.#endInset = 0;
      this.#linkStyle = new Map();
      this.#presentation = null;
      this.#mode = null;
      this.#modeKey = '';
      this.#frame = 0;
      this.#clock = createMotionClock();
    }

    attributeChangedCallback(name: string): void {
      if (name === FORCE_ATTRIBUTE) this.#forcedState = parseForced(this.getAttribute(name));
      if (!this.#navEl) return;
      if (name === 'glass') this.#refreshMode(true);
      else if (name === FORCE_ATTRIBUTE) this.#applyForced();
      else if (name === 'minimize' || name === 'scroller') {
        this.#bindScroller();
        this.#replan();
      } else if (name === 'scroll-edge') this.#syncEdge();
      else if (name === 'toggle-label') this.#syncToggle();
      else this.#replan();
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
      const nav = this.querySelector<HTMLElement>(':scope > nav');
      if (!nav || !nav.querySelector('a')) return false;
      this.#upgrade(nav);
      return true;
    }

    #accessoryHadStyle = false;

    #upgrade(nav: HTMLElement): void {
      this.#navEl = nav;
      this.#hadStyle.nav = nav.hasAttribute('style');
      this.setAttribute('data-vk', '');
      const own = <T extends HTMLElement>(el: T): T => {
        this.#mine.add(el);
        return el;
      };
      const pill = own(this.ownerDocument.createElement('span'));
      pill.setAttribute('data-vk-pill', '');
      pill.setAttribute('aria-hidden', 'true');
      nav.prepend(pill);
      this.#pill = pill;
      this.#edge = createScrollEdge(this, 'band', (el) => this.prepend(el));

      const toggle = own(this.ownerDocument.createElement('button'));
      toggle.type = 'button';
      toggle.setAttribute('data-vk-toggle', '');
      toggle.hidden = true;
      toggle.innerHTML = TOGGLE_GLYPH;
      nav.append(toggle);
      this.#toggle = toggle;

      const lens = own(this.ownerDocument.createElement('div'));
      lens.setAttribute('data-vk-lens', '');
      lens.setAttribute('aria-hidden', 'true');
      lens.inert = true;
      const inner = own(this.ownerDocument.createElement('div'));
      lens.append(inner);
      this.append(lens);
      this.#lens = lens;
      this.#lensInner = inner;

      const accessory = this.querySelector<HTMLElement>(':scope > [data-accessory]');
      this.#accessory = accessory;
      if (accessory) this.#accessoryHadStyle = accessory.hasAttribute('style');

      this.#body = newSlot(nav);
      this.#lensSlot = newSlot(lens);
      this.#accSlot = accessory ? newSlot(accessory) : null;

      this.#listen(nav, toggle);
      const markup = new MutationObserver((records) => {
        let changed = false;
        const selected = this.#plan?.order[this.#plan.selected] ?? null;
        for (const record of records) {
          if (this.#isOwn(record.target)) continue;
          if (record.type === 'attributes') {
            this.#lensFor = null;
            changed = true;
          } else if (record.type === 'characterData' || (selected && selected.contains(record.target))) {
            if (selected?.contains(record.target)) this.#lensFor = null;
            changed = true;
          } else if (![...record.addedNodes, ...record.removedNodes].every((node) => this.#mine.has(node) || node === this.#edge?.el)) {
            changed = true;
          }
        }
        if (this.#syncScroller()) changed = true;
        this.#syncEdge();
        if (changed) this.#scheduleReplan();
      });
      markup.observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-current'] });
      this.#cleanups.push(() => markup.disconnect());
      let ink = nav.style.getPropertyValue('--vireglass-ink');
      const inkWatch = new MutationObserver(() => {
        const next = nav.style.getPropertyValue('--vireglass-ink');
        if (next === ink) return;
        ink = next;
        this.#edge?.update();
      });
      inkWatch.observe(nav, { attributes: true, attributeFilter: ['style'] });
      this.#cleanups.push(() => inkWatch.disconnect());

      this.#mode = null;
      this.#modeKey = '';
      this.#refreshMode();
      this.#bindScroller();
      const shell = shellOf(this);
      const inset = (e: Event) => e.target === shell && this.#insetChanged();
      shell.addEventListener(SHEET_INSET_EVENT, inset);
      this.#cleanups.push(() => shell.removeEventListener(SHEET_INSET_EVENT, inset));
      this.#endInset = this.#readEndInset();
      this.#cleanups.push(
        watchAdaptiveContext(this, (ctx) => {
          this.#ctx = ctx;
          this.#replan();
        }),
      );
    }

    #isOwn(node: Node): boolean {
      return node === this.#pill || node === this.#edge?.el || [this.#lens, this.#toggle, this.#scrim, this.#probe].some((own) => own?.contains(node));
    }

    #scheduleReplan(): void {
      if (this.#dirty) return;
      this.#dirty = true;
      queueMicrotask(() => {
        this.#dirty = false;
        this.#replan();
      });
    }

    #listen(nav: HTMLElement, toggle: HTMLButtonElement): void {
      const on = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, options?: AddEventListenerOptions | boolean) => {
        target.addEventListener(type, handler as EventListener, options);
        this.#cleanups.push(() => target.removeEventListener(type, handler as EventListener, options));
      };
      const doc = this.ownerDocument;

      on<PointerEvent>(nav, 'pointerdown', (e) => {
        // A tap focuses the link before it clicks; focus that comes with a press is not the keyboard arriving.
        this.#tapping = true;
        window.clearTimeout(this.#tapTimer);
        this.#tapTimer = window.setTimeout(() => (this.#tapping = false), 600);
        this.#pressDown(e);
      });
      on<PointerEvent>(nav, 'pointercancel', () => (this.#tapping = false));
      on<Event>(nav, 'dragstart', (e) => e.preventDefault());
      on<MouseEvent>(
        nav,
        'click',
        (e) => {
          const link = e.target instanceof Element ? e.target.closest('a') : null;
          this.#tapping = false;
          if (!link || this.#forced()) return;
          const plan = this.#plan;
          if (plan && plan.layout.minimized && plan.visible.has(link as HTMLAnchorElement) && link !== plan.search) {
            e.preventDefault();
            expandMinimize(this.#minState);
            this.#replan();
          } else if (this.#over) {
            this.#setOver(false);
          }
        },
        true,
      );
      on<FocusEvent>(nav, 'focusin', () => {
        if (this.#handing || !this.#minState.minimized || this.#forced() || this.#tapping) return;
        expandMinimize(this.#minState);
        this.#replan();
      });
      this.#cleanups.push(() => this.#endPress?.());
      on<MouseEvent>(toggle, 'click', () => this.#toggleClick());
      on<Event>(nav, 'scroll', () => {
        const form = this.#shown?.layout.form;
        if (this.#scrollReset && nav.scrollTop === 0) {
          this.#scrollReset = false;
          return;
        }
        if (form && this.hasAttribute('data-scroll')) this.#scrollTops.set(form, nav.scrollTop);
      });

      on<KeyboardEvent>(doc, 'keydown', (e) => {
        if (e.key === 'Escape' && this.#over) {
          e.preventDefault();
          this.#closeOver();
          return;
        }
        const plan = this.#plan;
        if (!plan?.search || !plan.nav.search?.shortcut) return;
        if (e.key !== this.#searchKey() || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat) return;
        if (isEditable(e.composedPath()[0] ?? e.target)) return;
        e.preventDefault();
        plan.search.click();
      });
    }

    #searchKey(): string {
      return this.getAttribute('search-key') || '/';
    }

    // ---- the form -----------------------------------------------------------------------------------------------

    #collect() {
      const nav = this.#navEl!;
      const lists = Array.from(nav.querySelectorAll<HTMLElement>(':scope > ul'));
      const links = (list: HTMLElement) => Array.from(list.querySelectorAll<HTMLAnchorElement>('a'));
      const secondaryList = lists.filter((list) => list.hasAttribute('data-secondary'));
      const primary = lists.filter((list) => !list.hasAttribute('data-secondary')).flatMap(links);
      const secondary = secondaryList.flatMap(links);
      const search = nav.querySelector<HTMLAnchorElement>(':scope > a[data-search]');
      return { lists, secondaryList, primary, secondary, search };
    }

    /** What the element did to a node that has left the navigation is undone and forgotten, so nothing retains it. */
    #forgetGone(): void {
      const nav = this.#navEl;
      if (!nav) return;
      const gone = (node: Node) => node !== this.#accessory && !nav.contains(node);
      for (const [el, was] of this.#hiddenWas) {
        if (!gone(el)) continue;
        el.toggleAttribute('hidden', was);
        this.#hiddenWas.delete(el);
      }
      for (const [badge, was] of this.#badgeWas) {
        if (!gone(badge)) continue;
        restoreAria(badge, was);
        this.#badgeWas.delete(badge);
      }
      for (const [link, had] of this.#linkStyle) {
        if (!gone(link)) continue;
        stripPlacement(link, had);
        this.#linkStyle.delete(link);
      }
      for (const link of this.#under) {
        if (!gone(link)) continue;
        link.removeAttribute('data-lens-under');
        this.#under.delete(link);
      }
    }

    /** A badge is a picture; what it says reaches a screen reader through a [data-badge-label] the author puts in the link. */
    #hideBadges(): void {
      for (const badge of this.#navEl!.querySelectorAll<HTMLElement>('a [data-badge]')) {
        if (!this.#badgeWas.has(badge)) this.#badgeWas.set(badge, badge.getAttribute('aria-hidden'));
        if (badge.getAttribute('aria-hidden') !== 'true') badge.setAttribute('aria-hidden', 'true');
      }
    }

    /** The bottom safe area, read through a probe that is in the element only while it is read. */
    #readSafeBottom(): number {
      const probe = (this.#probe ??= this.#makeProbe());
      this.append(probe);
      const value = parseFloat(getComputedStyle(probe).paddingBottom);
      probe.remove();
      return Number.isFinite(value) ? Math.max(value, 0) : 0;
    }

    #makeProbe(): HTMLElement {
      const probe = this.ownerDocument.createElement('div');
      probe.setAttribute('data-vk-probe', '');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px)';
      this.#mine.add(probe);
      return probe;
    }

    #probe: HTMLElement | null = null;
    #safeBottom = 0;
    #endInset = 0;

    #tier(): 'touch' | 'pointer' {
      return sizeTier(effectiveInput()) === 'touch' ? 'touch' : 'pointer';
    }

    #makePlan(ctx: AdaptiveContext, as: { form?: NavigationFormKind; minimized: boolean; over: boolean }): Plan {
      const { primary, secondary, search } = this.#collect();
      let nav = navigationForm(ctx, {
        primary: primary.length,
        secondary: secondary.length,
        search: search !== null,
        sidebarCollapsed: this.hasAttribute('collapsed'),
        panes: Number(this.getAttribute('panes')) || 1,
      });
      const attr = this.getAttribute('form');
      if (attr && FORMS.includes(attr)) nav = fixedNavigationForm(nav, attr as NavigationFormKind);
      const over = as.over && nav.form === 'rail' && nav.expandable === 'over';
      const resting = nav;
      if (over) nav = fixedNavigationForm(nav, 'sidebar');
      if (as.form) nav = fixedNavigationForm(nav, as.form);
      const order = [...primary, ...secondary];
      const selected = order.findIndex(isCurrent);
      const layout = this.#layoutOf(ctx, nav, selected, as.minimized);
      const rail = over ? this.#layoutOf(ctx, resting, selected, as.minimized) : layout;
      const visible = new Set<HTMLAnchorElement>();
      if (layout.minimized) {
        const at = selected >= 0 && selected < nav.primary ? selected : 0;
        const link = order[at];
        if (link) visible.add(link);
      } else {
        const count = nav.form === 'sidebar' ? order.length : nav.primary;
        for (const link of order.slice(0, count)) visible.add(link);
      }
      return { nav, layout, order, search, selected, visible, secondaryShown: nav.form === 'sidebar', insets: rail.insets, over };
    }

    #layoutOf(ctx: AdaptiveContext, nav: NavigationForm, selected: number, minimized: boolean): NavLayout {
      return navLayout({
        form: nav.form,
        minimized: minimized && nav.form === 'bar',
        window: ctx.window,
        items: nav.primary,
        secondary: nav.secondary,
        search: nav.search,
        selected,
        tier: this.#tier(),
        toggle: nav.collapsible || nav.expandable !== null,
        accessory: this.#accessory !== null,
        bottomInset: this.#safeBottom,
        endInset: this.#endInset,
      });
    }

    #readEndInset(): number {
      return parseFloat(getComputedStyle(this).getPropertyValue(SHEET_INSET_PROPERTY)) || 0;
    }

    #insetChanged(): void {
      const next = this.#readEndInset();
      if (next === this.#endInset) return;
      this.#endInset = next;
      this.#replan();
    }

    #forcedState: Forced | null = null;

    #forced(): Forced | null {
      return this.#forcedState;
    }

    #replan(): void {
      const ctx = this.#ctx;
      if (!this.#navEl || !ctx) return;
      this.#syncScroller();
      this.#forgetGone();
      this.#hideBadges();
      this.#safeBottom = this.#readSafeBottom();
      const forced = this.#forced();
      const minimized = forced?.kind === 'minimized' || this.#minState.minimized;
      const plan = this.#makePlan(ctx, { minimized, over: this.#over });
      if (this.#over && !plan.over) this.#setOver(false, false);
      const prev = this.#plan;
      this.#plans.set(plan.layout, plan);
      this.#plan = plan;

      if (forced?.kind === 'morph') {
        const from =
          forced.from === 'minimized'
            ? this.#makePlan(ctx, { form: 'bar', minimized: true, over: false })
            : this.#makePlan(ctx, { form: forced.from, minimized: false, over: false });
        this.#plans.set(from.layout, from);
        const state = createNavMorph(from.layout);
        const via = from.layout.form === 'bar' && plan.layout.form === 'bar' ? 'contract' : 'lens';
        aimNavMorph(state, plan.layout, via);
        state.t.x = forced.t;
        state.t.v = 0;
        state.t.target = forced.t;
        this.#morph = state;
      } else if (!this.#morph || forced?.kind === 'drag' || forced?.kind === 'minimized') {
        this.#morph = createNavMorph(plan.layout);
      } else if (prev) {
        const contract = prev.layout.form === 'bar' && plan.layout.form === 'bar' && prev.layout.minimized !== plan.layout.minimized;
        aimNavMorph(this.#morph, plan.layout, contract ? 'contract' : 'lens');
      } else {
        this.#morph = createNavMorph(plan.layout);
      }

      this.#retargetPill(prev, plan);
      this.#retargetAccessory(prev, plan);
      if (forced?.kind === 'drag') {
        this.#drag = createNavDrag();
        const body = plan.layout.body;
        pressNavDrag(this.#drag, plan.layout, body.x + forced.at * body.width);
        this.#drag.lift.x = 1;
        this.#drag.lift.target = 1;
      }
      this.#syncKeyShortcut(plan);
      this.#ensureGlass();
      this.#syncEdge();
      this.#publish(plan);
      this.#run();
    }

    #retargetPill(prev: Plan | null, next: Plan): void {
      const anim = this.#pillAnim;
      const to = next.layout.pill;
      const sameForm = prev !== null && prev.layout.form === next.layout.form && prev.layout.minimized === next.layout.minimized;
      const instant = this.#presentation?.instantSprings ?? false;
      if (sameForm && prev.selected !== next.selected && prev.layout.pill && to && !instant) {
        anim.from = this.#pillBox() ?? prev.layout.pill;
        anim.to = to;
        anim.state.t = { x: 0, v: 0, target: 1 };
      } else if (sameForm && anim.state.t.x < 1 && to) {
        anim.to = to;
      } else {
        anim.from = anim.to = to;
        anim.state.t = { x: 1, v: 0, target: 1 };
      }
    }

    #pillBox(): MorphBox | null {
      const { from, to, state } = this.#pillAnim;
      if (!to) return null;
      return from && state.t.x < 1 ? formMorphFrame(from, to, state).box : to;
    }

    #retargetAccessory(prev: Plan | null, next: Plan): void {
      const anim = this.#accAnim;
      const box = next.layout.accessory;
      const placement = next.layout.accessoryPlacement;
      if (!box || !placement) {
        anim.from = anim.to = null;
        anim.state.t = { x: 1, v: 0, target: 1 };
        return;
      }
      const target = { box, placement };
      const instant = this.#presentation?.instantSprings ?? false;
      if (anim.to && anim.to.placement !== placement && !instant && prev) {
        anim.from = this.#accBox() ?? anim.to;
        anim.to = target;
        anim.state.t = { x: 0, v: 0, target: 1 };
        anim.state.fromInk = 1;
        this.#accHeld = !!this.#morph && this.#lifting(this.#morph);
      } else if (anim.to && anim.state.t.x < 1 && anim.to.placement === placement) {
        anim.to = target;
      } else {
        anim.from = anim.to = target;
        anim.state.t = { x: 1, v: 0, target: 1 };
      }
    }

    #accBox(): { box: MorphBox; placement: string } | null {
      const { from, to, state } = this.#accAnim;
      if (!to) return null;
      if (!from || state.t.x >= 1) return to;
      const frame = formMorphFrame(from.box, to.box, state);
      return { box: frame.box, placement: frame.showing === 'from' ? from.placement : to.placement };
    }

    // ---- what the content must clear ----------------------------------------------------------------------------

    #publish(plan: Plan): void {
      const { layout } = plan;
      const bottom = round(plan.insets.bottom);
      const start = round(plan.insets.start);
      const key = JSON.stringify([layout.form, layout.minimized, bottom, start, layout.accessoryPlacement]);
      if (key === this.#lastKey) return;
      this.#lastKey = key;
      const parent = this.parentElement;
      if (parent) {
        if (this.#parent !== parent) {
          this.#clearInsets();
          this.#parent = parent;
          this.#hadStyle.parent = parent.hasAttribute('style');
          this.#parentWas = {
            bottom: parent.style.getPropertyValue('--vire-nav-inset-bottom'),
            start: parent.style.getPropertyValue('--vire-nav-inset-start'),
          };
        }
        parent.style.setProperty('--vire-nav-inset-bottom', `${bottom}px`);
        parent.style.setProperty('--vire-nav-inset-start', `${start}px`);
      }
      this.dispatchEvent(
        new CustomEvent('vire-nav-layout', {
          bubbles: true,
          detail: { form: layout.form, minimized: layout.minimized, insets: { bottom, start }, accessoryPlacement: layout.accessoryPlacement },
        }),
      );
    }

    #clearInsets(): void {
      const parent = this.#parent;
      if (!parent) return;
      const was = this.#parentWas;
      for (const [name, value] of [
        ['--vire-nav-inset-bottom', was?.bottom],
        ['--vire-nav-inset-start', was?.start],
      ] as const) {
        if (value) parent.style.setProperty(name, value);
        else parent.style.removeProperty(name);
      }
      dropEmptyStyle(parent, this.#hadStyle.parent);
      this.#parent = null;
      this.#parentWas = null;
    }

    // ---- scrolling ----------------------------------------------------------------------------------------------

    /** The property wins while its node is in the document; the id is looked up again each time, as the node may be parsed late or replaced. */
    #lookupScroller(): Element | null {
      if (this.#scrollerProp?.isConnected) return this.#scrollerProp;
      const id = this.getAttribute('scroller');
      const root = this.getRootNode() as Document | ShadowRoot;
      return id && 'getElementById' in root ? root.getElementById(id) : null;
    }

    #wantedScroller(): Element | null {
      return this.getAttribute('minimize') === 'scroll' ? this.#lookupScroller() : null;
    }

    #syncEdge(): void {
      const edge = this.#edge;
      const nav = this.#navEl;
      if (!edge || !nav) return;
      const mode = this.getAttribute('scroll-edge');
      const scroller = this.#presentation?.glass && this.#plan?.layout.form === 'bar' && mode !== 'off' ? this.#lookupScroller() : null;
      edge.set(
        scroller
          ? {
              scroller,
              side: 'bottom',
              bar: nav,
              beside: this.#accessory,
              hard: mode === 'hard',
              ink: () => {
                const ink = nav.style.getPropertyValue('--vireglass-ink');
                return ink === '' ? 0 : Number(ink);
              },
            }
          : null,
      );
    }

    #isPage(el: Element): boolean {
      const doc = this.ownerDocument;
      return el === doc.documentElement || el === doc.body || el === doc.scrollingElement;
    }

    #bindScroller(): void {
      this.#unbindScroller?.();
      this.#unbindScroller = null;
      const el = this.#wantedScroller();
      this.#scrollerEl = el;
      this.#minState = createMinimize(el ? this.#scrollPosition(el) : 0);
      if (!el) return;
      const target: EventTarget = this.#isPage(el) ? this.ownerDocument.defaultView! : el;
      const onScroll = () => {
        const was = this.#minState.minimized;
        stepMinimize(this.#minState, this.#scrollPosition(el));
        if (this.#minState.minimized !== was) this.#replan();
      };
      target.addEventListener('scroll', onScroll, { passive: true });
      this.#unbindScroller = () => target.removeEventListener('scroll', onScroll);
    }

    #scrollPosition(el: Element): number {
      const source = this.#isPage(el) ? (this.ownerDocument.scrollingElement ?? el) : el;
      return clampScrollTop(source.scrollTop, source.scrollHeight, source.clientHeight);
    }

    /** Follows the scroller to what it is now; true when that took the bar out of the minimised state. */
    #syncScroller(): boolean {
      if (this.#wantedScroller() === this.#scrollerEl) return false;
      const was = this.#minState.minimized;
      this.#bindScroller();
      return was;
    }

    // ---- the toggle and the sidebar over the content ------------------------------------------------------------

    #toggleClick(): void {
      const plan = this.#plan;
      if (!plan) return;
      if (this.#over) {
        this.#setOver(false);
      } else if (plan.nav.collapsible) {
        this.setAttribute('collapsed', '');
        this.#fireCollapse(true);
      } else if (plan.nav.expandable === 'beside') {
        this.removeAttribute('collapsed');
        this.#fireCollapse(false);
      } else if (plan.nav.expandable === 'over') {
        this.#setOver(true);
      }
    }

    #fireCollapse(collapsed: boolean): void {
      this.dispatchEvent(new CustomEvent('vire-nav-collapse', { bubbles: true, detail: { collapsed } }));
    }

    /** Closing by Escape or the scrim hands focus back to the toggle that opened the sidebar. */
    #closeOver(pressed = false): void {
      const inside = this.#navEl?.contains(this.#activeElement()) ?? false;
      this.#setOver(false);
      if (!inside || !this.#toggle || this.#toggle.hidden) return;
      this.#focusQuietly(this.#toggle);
      if (pressed) this.#holdFocus();
    }

    // The scrim is gone by the time the press's mousedown lands on the content, whose default would blur the toggle.
    #holdFocus(): void {
      this.#unhold?.();
      const doc = this.ownerDocument;
      const hold = (e: Event) => e.preventDefault();
      const timer = window.setTimeout(() => off(), 300);
      const off = () => {
        doc.removeEventListener('mousedown', hold, true);
        window.clearTimeout(timer);
        this.#unhold = null;
      };
      doc.addEventListener('mousedown', hold, { capture: true, once: true });
      this.#unhold = off;
    }

    #unhold: (() => void) | null = null;

    #activeElement(): Element | null {
      return deepActive(this.getRootNode() as Document | ShadowRoot);
    }

    #focusQuietly(el: HTMLElement): void {
      this.#handing = true;
      try {
        el.focus({ preventScroll: true });
      } finally {
        this.#handing = false;
      }
    }

    #handing = false;

    #setOver(open: boolean, replan = true): void {
      if (this.#over === open) return;
      this.#over = open;
      if (open && this.#navEl) {
        const scrim = this.ownerDocument.createElement('div');
        scrim.setAttribute('data-vk-scrim', '');
        scrim.addEventListener('pointerdown', () => this.#closeOver(true));
        this.#mine.add(scrim);
        this.insertBefore(scrim, this.#navEl);
        this.#scrim = scrim;
      } else {
        this.#scrim?.remove();
        this.#scrim = null;
      }
      if (replan) this.#replan();
    }

    #syncToggle(): void {
      const toggle = this.#toggle;
      const shown = this.#shown;
      if (!toggle || !shown) return;
      const expanded = shown.nav.form === 'sidebar';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', this.getAttribute('toggle-label') || DEFAULT_TOGGLE_LABEL);
    }

    #syncKeyShortcut(plan: Plan): void {
      const link = plan.search && plan.nav.search?.shortcut && plan.layout.search ? plan.search : null;
      if (link !== this.#shortcut) this.#releaseShortcut();
      if (!link) return;
      if (!this.#shortcut) {
        this.#shortcut = link;
        this.#shortcutWas = link.getAttribute('aria-keyshortcuts');
      }
      link.setAttribute('aria-keyshortcuts', this.#searchKey());
    }

    #releaseShortcut(): void {
      const link = this.#shortcut;
      if (link) {
        if (this.#shortcutWas === null) link.removeAttribute('aria-keyshortcuts');
        else link.setAttribute('aria-keyshortcuts', this.#shortcutWas);
      }
      this.#shortcut = null;
      this.#shortcutWas = null;
    }

    #shortcut: HTMLAnchorElement | null = null;
    #shortcutWas: string | null = null;

    // ---- applying a form to the markup --------------------------------------------------------------------------

    #setHidden(el: HTMLElement, hidden: boolean): void {
      if (!this.#hiddenWas.has(el)) this.#hiddenWas.set(el, el.hasAttribute('hidden'));
      el.toggleAttribute('hidden', hidden);
    }

    #slotOf(link: HTMLAnchorElement): HTMLElement {
      const item = link.closest('li');
      return item && this.#navEl!.contains(item) ? item : link;
    }

    #place(el: HTMLElement, box: MorphBox, hit: number): void {
      if (!this.#linkStyle.has(el)) this.#linkStyle.set(el, el.hasAttribute('style'));
      const s = el.style;
      s.setProperty('--vk-lx', px(box.x));
      s.setProperty('--vk-ly', px(box.y));
      s.setProperty('--vk-lw', px(box.width));
      s.setProperty('--vk-lh', px(box.height));
      s.setProperty('--vk-lr', px(box.radius));
      s.setProperty('--vk-slop-x', String(Math.max(0, (hit - box.width) / 2)));
      s.setProperty('--vk-slop-y', String(Math.max(0, (hit - box.height) / 2)));
    }

    /** Turns the markup into this plan's form: which links show, where each sits, what the head holds. */
    #applyShown(shown: Plan): void {
      this.#shown = shown;
      const { layout, nav } = shown;
      const { lists, secondaryList, primary, secondary, search } = this.#collect();
      const focused = this.#navEl?.contains(this.#activeElement()) ? (this.#activeElement() as HTMLElement) : null;
      this.setAttribute('data-form', layout.form);
      if (nav.search) this.setAttribute('data-search', nav.search.form);
      else this.removeAttribute('data-search');
      this.toggleAttribute('data-minimized', layout.minimized);
      const hit = hitTarget(effectiveInput());
      for (const link of [...primary, ...secondary]) {
        this.#setHidden(this.#slotOf(link), !shown.visible.has(link));
        const box = layout.items[shown.order.indexOf(link)];
        if (box && shown.visible.has(link)) this.#place(link, box, hit);
      }
      for (const list of lists) {
        const secondaryOnly = secondaryList.includes(list);
        this.#setHidden(list, secondaryOnly && !shown.secondaryShown);
      }
      if (search) {
        this.#setHidden(search, layout.search === null);
        if (layout.search) this.#place(search, layout.search, hit);
      }
      const toggle = this.#toggle;
      if (toggle) {
        toggle.hidden = layout.toggle === null;
        if (layout.toggle) this.#place(toggle, layout.toggle, hit);
        this.#syncToggle();
      }
      const rows = layout.form === 'bar' ? [] : [...layout.items, ...(layout.search ? [layout.search] : [])];
      const bottom = Math.max(0, ...rows.map((row) => row.y + row.height)) + 8;
      this.#fits = rows.length === 0 || bottom <= layout.body.y + layout.body.height + 0.5;
      if (focused && this.#loses(focused, shown)) this.#handFocus(shown);
    }

    #loses(el: HTMLElement, shown: Plan): boolean {
      if (el === this.#toggle) return shown.layout.toggle === null;
      if (el === shown.search) return shown.layout.search === null;
      return shown.order.includes(el as HTMLAnchorElement) && !shown.visible.has(el as HTMLAnchorElement);
    }

    /** A link the form hides hands focus to the selected link, else the toggle, else the first link shown. */
    #handFocus(shown: Plan): void {
      const selected = shown.order[shown.selected];
      const first = shown.order.find((link) => shown.visible.has(link));
      const target = selected && shown.visible.has(selected) ? selected : shown.layout.toggle ? this.#toggle : (first ?? null);
      if (target) this.#focusQuietly(target);
    }

    #fits = true;

    // ---- drawing ------------------------------------------------------------------------------------------------

    #restLayout(): NavLayout | null {
      const morph = this.#morph;
      if (!morph || currentNavFrame(morph).phase !== 'rest') return null;
      return morph.t.x >= 1 ? morph.to : morph.from;
    }

    #run(): void {
      const instant = this.#presentation?.instantSprings ?? false;
      if (instant && this.#morph && !this.#forced()) {
        stepNavMorph(this.#morph, 0, true);
        const layout = this.#restLayout();
        if (layout) stepNavDrag(this.#drag, 0, true);
        stepFormMorph(this.#pillAnim.state, 0, 1, true);
        stepFormMorph(this.#accAnim.state, 0, 1, true);
        this.#accHeld = false;
      }
      this.#paint();
      if (this.#frame || this.#forced()) return;
      this.#clock = createMotionClock();
      this.#frame = requestMotionFrame((t) => this.#tick(t));
    }

    #tick(now: number): void {
      this.#frame = 0;
      const morph = this.#morph;
      if (!this.isConnected || !morph || this.#forced()) return;
      const instant = this.#presentation?.instantSprings ?? false;
      const drag = this.#drag;
      const pill = this.#pillAnim.state;
      const acc = this.#accAnim.state;
      const moving = stepMotion(this.#clock, now, (dt) => {
        let moved = stepNavMorph(morph, dt, instant);
        if (this.#restLayout() && stepNavDrag(drag, dt, instant)) moved = true;
        if (stepFormMorph(pill, dt, 1, instant)) moved = true;
        if (this.#accHeld && (instant || !this.#lifting(morph))) this.#accHeld = false;
        if (this.#accHeld) moved = true;
        else if (stepFormMorph(acc, dt, 1, instant)) moved = true;
        return moved;
      });
      this.#paint();
      if (moving) this.#frame = requestMotionFrame((t) => this.#tick(t));
    }

    #paint(): void {
      const plan = this.#plan;
      const morph = this.#morph;
      const nav = this.#navEl;
      if (!plan || !morph || !nav) return;
      const frame = currentNavFrame(morph);
      const shownLayout = frame.showing === 'from' ? morph.from : morph.to;
      const shown = this.#plans.get(shownLayout) ?? plan;
      if (shown !== this.#shown) this.#applyShown(shown);
      const rest = frame.phase === 'rest';
      const still = this.#forced() !== null;
      // The accessory lands with the body: its own reshape is shorter, and a surface that lands mid-morph is a bake mid-morph.
      const live = !still && (!rest || this.#accMoving());
      const dragFrame = rest ? navDragFrame(this.#drag, shownLayout) : null;
      const lens = frame.lens
        ? { box: frame.lens.box, lift: frame.lens.lift, dragging: false, hover: -1 }
        : dragFrame
          ? { box: dragFrame.lens, lift: dragFrame.lift, dragging: true, hover: dragFrame.hover }
          : null;

      this.toggleAttribute('data-moving', !rest || dragFrame !== null);
      const scrolls = rest && dragFrame === null && !this.#fits;
      let restore = false;
      if (this.hasAttribute('data-scroll') !== scrolls) {
        this.toggleAttribute('data-scroll', scrolls);
        this.#scrollReset = !scrolls;
        restore = scrolls;
      }
      const ink = frame.showing === 'from' ? frame.ink.outgoing : frame.ink.incoming;
      const inkText = clamp01(ink).toFixed(3);
      this.style.setProperty('--vk-ink', inkText);
      this.toggleAttribute('data-defocus', inkText !== '1.000');

      const box = frame.body;
      const s = nav.style;
      s.setProperty('--vk-x', px(box.x));
      s.setProperty('--vk-y', px(box.y));
      s.setProperty('--vk-w', px(box.width));
      s.setProperty('--vk-h', px(box.height));
      s.setProperty('--vk-r', px(box.radius));
      if (restore) nav.scrollTop = this.#scrollTops.get(shown.layout.form) ?? 0;

      const pill = shown === plan ? this.#pillBox() : shownLayout.pill;
      this.#paintPill(shown.layout.minimized ? null : pill, ink * (1 - (lens?.lift ?? 0)));
      this.#paintLens(lens, shown, plan, live || (!still && dragFrame !== null));
      this.#paintAccessory(live);

      if (this.#body?.session) {
        const second = frame.second;
        const centre = (b: MorphBox) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
        const morphShape: GlassMorph | null = second
          ? {
              smoothing: round(second.smoothing),
              shape: {
                offsetX: round(centre(second.box).x - centre(box).x),
                offsetY: round(centre(second.box).y - centre(box).y),
                width: round(second.box.width),
                height: round(second.box.height),
                cornerRadius: round(second.box.radius),
              },
            }
          : null;
        const soft = shown.layout.form === 'sidebar';
        // A new second shape is a map to rebuild, and the bar does not need it to be right for the few frames it is joined.
        this.#push(this.#body, box, soft ? 's' : 'c', () => this.#bodyMaterial(soft), live ? undefined : morphShape, live);
      }
    }

    #bodyMaterial(soft: boolean): VireGlassMaterial {
      return soft ? menuMaterial(VIREGLASS_CONTROL_MATERIAL, 0) : atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'iconButton', ATOM_AT_REST);
    }

    #paintPill(box: MorphBox | null, opacity: number): void {
      const pill = this.#pill;
      if (!pill) return;
      pill.hidden = box === null;
      if (!box) return;
      const s = pill.style;
      s.setProperty('--vk-px', px(box.x));
      s.setProperty('--vk-py', px(box.y));
      s.setProperty('--vk-pw', px(box.width));
      s.setProperty('--vk-ph', px(box.height));
      s.setProperty('--vk-pr', px(box.radius));
      s.setProperty('--vk-pill-op', clamp01(opacity).toFixed(3));
    }

    #paintLens(lens: { box: MorphBox; lift: number; dragging: boolean; hover: number } | null, shown: Plan, plan: Plan, moving: boolean): void {
      const el = this.#lens;
      const slot = this.#lensSlot;
      if (!el || !slot) return;
      const shownLens = lens !== null && (lens.dragging || round(clamp01(lens.lift) * 100) / 100 > 0);
      this.toggleAttribute('data-lens', shownLens);
      if (!lens || !shownLens) {
        if (!moving && slot.session) landGlass(slot.session);
        this.#markUnder([], null);
        return;
      }
      const s = el.style;
      s.setProperty('--vk-x', px(lens.box.x));
      s.setProperty('--vk-y', px(lens.box.y));
      s.setProperty('--vk-w', px(lens.box.width));
      s.setProperty('--vk-h', px(lens.box.height));
      s.setProperty('--vk-r', px(lens.box.radius));
      s.setProperty('--vk-lift', clamp01(lens.lift).toFixed(3));
      el.setAttribute('data-form', shown.layout.form);
      el.toggleAttribute('data-dragging', lens.dragging);
      this.#markUnder(lens.dragging ? itemsUnderLens(shown.layout, lens.box) : [], shown, lens.lift);
      const held = lens.dragging ? (shown.order[lens.hover] ?? null) : (plan.order[plan.selected] ?? null);
      if (held !== this.#lensFor) {
        this.#lensFor = held;
        const inner = this.#lensInner!;
        inner.replaceChildren(...(held ? Array.from(held.childNodes).map((node) => node.cloneNode(true)) : []));
        for (const withId of Array.from(inner.querySelectorAll('[id]'))) withId.removeAttribute('id');
      }
      if (this.#presentation?.glass && !this.#glassBroken) {
        const key = this.#modeKey;
        if (slot.key !== key) this.#attach(slot, key, () => this.#lensMaterial(0), lens.box);
        const step = round(clamp01(lens.lift) * MATERIAL_STEPS) / MATERIAL_STEPS;
        if (slot.session) {
          const body = atomBody(VIREGLASS_CONTROL_MATERIAL, { ...ATOM_AT_REST, pressed: step }, this.#presentation.frost);
          const lift = clamp01(lens.lift);
          s.setProperty('--vk-body-alpha', (body.alpha * lift).toFixed(3));
          s.setProperty('--vk-body-white', body.white.toFixed(3));
          s.setProperty('--vk-body-lift', body.lift.toFixed(3));
          this.#push(slot, lens.box, String(step), () => this.#lensMaterial(step), undefined, moving, round(lift * 100) / 100);
        }
      }
    }

    #lensMaterial(step: number): VireGlassMaterial {
      return atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'iconButton', { ...ATOM_AT_REST, pressed: step });
    }

    #under = new Set<HTMLAnchorElement>();

    /** What the lens covers is not drawn, and what it holds is a copy of: the real glyph is never under its bevel. */
    #markUnder(indexes: number[], shown: Plan | null, lift = 1): void {
      if (this.#under.size === 0 && indexes.length === 0) return;
      const links = new Set<HTMLAnchorElement>();
      for (const i of indexes) {
        const link = shown?.order[i];
        if (link) links.add(link);
      }
      for (const link of this.#under) if (!links.has(link)) link.removeAttribute('data-lens-under');
      for (const link of links) if (!this.#under.has(link)) link.setAttribute('data-lens-under', '');
      this.#under = links;
      if (links.size > 0) this.style.setProperty('--vk-under', clamp01(lift).toFixed(3));
      else this.style.removeProperty('--vk-under');
    }

    /** The body has not begun to contract; the accessory reshapes only once it has (M 8:35-8:47 phase order). */
    #lifting(morph: NavMorphState): boolean {
      const { x, target } = morph.t;
      return x < 1 && target === 1 && (x <= 0 || currentNavFrame(morph).phase === 'lift');
    }

    #accMoving(): boolean {
      return this.#accAnim.state.t.x < 1 && this.#accAnim.from !== null;
    }

    #paintAccessory(live: boolean): void {
      const el = this.#accessory;
      const slot = this.#accSlot;
      if (!el || !slot) return;
      const anim = this.#accAnim;
      const frame = anim.to ? this.#accBox() : null;
      if (!frame || !anim.to) {
        this.#setHidden(el, true);
        return;
      }
      this.#setHidden(el, false);
      const moving = this.#accMoving();
      el.toggleAttribute('data-moving', moving);
      el.setAttribute('data-placement', frame.placement);
      const box = frame.box;
      const s = el.style;
      s.setProperty('--vk-x', px(box.x));
      s.setProperty('--vk-y', px(box.y));
      s.setProperty('--vk-w', px(box.width));
      s.setProperty('--vk-h', px(box.height));
      s.setProperty('--vk-r', px(box.radius));
      if (moving && anim.from) {
        const f = formMorphFrame(anim.from.box, anim.to.box, anim.state);
        s.setProperty('--vk-ink', clamp01(f.showing === 'from' ? f.ink.outgoing : f.ink.incoming).toFixed(3));
      }
      this.#push(slot, box, 'c', () => this.#bodyMaterial(false), undefined, live);
    }

    // ---- the glass ----------------------------------------------------------------------------------------------

    #detach(slot: Slot): void {
      slot.token += 1;
      slot.session?.destroy();
      slot.session = null;
      slot.key = '';
      slot.last = emptyLast();
      slot.appear = undefined;
    }

    #attach(slot: Slot, key: string, material: () => VireGlassMaterial, box: MorphBox): void {
      if (key === slot.key) return;
      this.#detach(slot);
      slot.key = key;
      if (!key || !this.#mode) return;
      const token = slot.token;
      void attachControlGlass(
        slot.el,
        {
          material: material(),
          geometry: { width: round(box.width), height: round(box.height), cornerRadius: round(box.radius) },
          accessibility: this.#mode,
          onTouch: false,
          sample: this.#sample,
          interactive: false,
        },
        () => token === slot.token && this.isConnected,
      )
        .then((session) => {
          if (!session) return;
          slot.session = session;
          slot.last = emptyLast();
          slot.appear = undefined;
          this.#paint();
          if (slot === this.#body) {
            this.#edge?.update();
            this.dispatchEvent(new CustomEvent('vire-glass-ready'));
          }
        })
        .catch(() => {
          if (token !== slot.token) return;
          slot.key = '';
          this.#glassBroken = true;
          this.#refreshMode(false, true);
        });
    }

    /** Hands the lens only what changed: a new morph or material rebuilds its filter, a moved box needs nothing. While the element moves the lens is in interim. */
    #push(
      slot: Slot,
      box: MorphBox,
      materialKey: string,
      material: () => VireGlassMaterial,
      lens: GlassMorph | null | undefined,
      moving: boolean,
      appear?: number,
    ): void {
      const session = slot.session;
      if (!session) return;
      moveGlass(session, moving, () => {
        if (appear !== undefined && appear !== slot.appear) {
          slot.appear = appear;
          session.setAppear(appear);
        }
        const geometry = { width: round(box.width), height: round(box.height), cornerRadius: round(box.radius) };
        // A morph that was never sent needs no null to take it away.
        if (lens === null && slot.last.morph === '-') lens = undefined;
        const key = {
          material: materialKey,
          morph: (lens === undefined ? '-' : (lens ?? 'none')) as MorphKey,
          geometry: `${geometry.width}x${geometry.height}r${geometry.cornerRadius}`,
        };
        const last = slot.last;
        if (key.material === last.material && sameMorph(key.morph, last.morph) && key.geometry === last.geometry) return;
        const next: Parameters<GlassSession['frame']>[0] = {};
        if (key.geometry !== last.geometry) next.geometry = geometry;
        if (key.material !== last.material) next.material = material();
        if (lens !== undefined && !sameMorph(key.morph, last.morph)) next.morph = lens;
        slot.last = key;
        session.frame(next);
      });
    }

    // ---- modes --------------------------------------------------------------------------------------------------

    #wantsGlass(): boolean {
      const wanted = this.getAttribute('glass');
      return wanted !== null && GLASS_ON.has(wanted);
    }

    #refreshMode(force = false, afterFailure = false): void {
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
      const body = atomBody(VIREGLASS_CONTROL_MATERIAL, ATOM_AT_REST, next.frost);
      this.style.setProperty('--vk-body-alpha', body.alpha.toFixed(3));
      this.style.setProperty('--vk-body-white', body.white.toFixed(3));
      this.style.setProperty('--vk-body-lift', body.lift.toFixed(3));
      if (changed) {
        for (const slot of [this.#body, this.#lensSlot, this.#accSlot]) if (slot) this.#detach(slot);
        this.#ensureGlass();
      }
      this.#syncEdge();
      if (this.#ctx) this.#run();
    }

    /** Attaches the glass of every surface once the first form is known; the lens waits, parked where the pill rests, so a morph or a drag finds it ready. */
    #ensureGlass(): void {
      const plan = this.#plan;
      const layout = plan?.layout;
      if (!plan || !layout) return;
      const key = this.#presentation?.glass && this.#mode ? this.#modeKey : '';
      if (this.#body) this.#attach(this.#body, key, () => this.#bodyMaterial(false), layout.body);
      if (this.#accSlot && layout.accessory) this.#attach(this.#accSlot, key, () => this.#bodyMaterial(false), layout.accessory);
      const lens = this.#lensSlot;
      if (lens && key && lens.key !== key) {
        const park = layout.pill ?? layout.items[plan.selected] ?? layout.body;
        const s = this.#lens!.style;
        s.setProperty('--vk-x', px(park.x));
        s.setProperty('--vk-y', px(park.y));
        s.setProperty('--vk-w', px(park.width));
        s.setProperty('--vk-h', px(park.height));
        s.setProperty('--vk-r', px(park.radius));
        this.#attach(lens, key, () => this.#lensMaterial(0), park);
      }
    }

    // ---- the drag -----------------------------------------------------------------------------------------------

    #pressDown(e: PointerEvent): void {
      if (e.button !== 0 || !e.isPrimary || this.#forced() || this.#press) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('button, a[data-search]')) return;
      const layout = this.#restLayout();
      if (!layout || layout.form !== 'bar' || layout.minimized) return;
      const left = this.getBoundingClientRect().left;
      pressNavDrag(this.#drag, layout, e.clientX - left);
      if (!this.#drag.active) return;
      this.#press = { id: e.pointerId, startX: e.clientX, left, dragging: false, last: e.timeStamp, onLink: target?.closest('a') != null };
      const win = this.ownerDocument.defaultView!;
      const move = (ev: PointerEvent) => this.#pressMove(ev);
      const up = (ev: PointerEvent) => this.#pressUp(ev, false);
      const cancel = (ev: PointerEvent) => this.#pressUp(ev, true);
      win.addEventListener('pointermove', move);
      win.addEventListener('pointerup', up);
      win.addEventListener('pointercancel', cancel);
      const release = holdGlass(() => this.#press !== null, () => [this.#body?.session, this.#lensSlot?.session, this.#accSlot?.session]);
      this.#endPress = () => {
        release();
        win.removeEventListener('pointermove', move);
        win.removeEventListener('pointerup', up);
        win.removeEventListener('pointercancel', cancel);
        this.#endPress = null;
      };
      this.#run();
    }

    #endPress: (() => void) | null = null;

    #pressMove(e: PointerEvent): void {
      const press = this.#press;
      const layout = this.#restLayout();
      if (!press || e.pointerId !== press.id || !layout) return;
      if (!press.dragging) {
        if (Math.abs(e.clientX - press.startX) <= DRAG_SLOP) return;
        press.dragging = true;
        try {
          this.#navEl?.setPointerCapture(e.pointerId);
        } catch {
          // A pointer that is already gone cannot be captured; the window listeners carry on.
        }
      }
      const dt = Math.min(Math.max((e.timeStamp - press.last) / 1000, 1 / 240), 0.05);
      press.last = e.timeStamp;
      moveNavDrag(this.#drag, layout, e.clientX - press.left, dt);
      this.#run();
    }

    #pressUp(e: PointerEvent, cancelled: boolean): void {
      const press = this.#press;
      const plan = this.#plan;
      const layout = this.#restLayout();
      if (!press || e.pointerId !== press.id) return;
      this.#press = null;
      this.#endPress?.();
      try {
        this.#navEl?.releasePointerCapture(e.pointerId);
      } catch {
        // Nothing was captured on a tap.
      }
      if (!plan) return;
      const bar = layout !== null && layout.form === 'bar' && !layout.minimized;
      if (cancelled || !bar || (!press.dragging && !press.onLink)) {
        cancelNavDrag(this.#drag, layout ?? plan.layout, plan.selected);
      } else {
        const index = releaseNavDrag(this.#drag, layout);
        if (press.dragging) {
          // The native click that follows a drag belongs to the drag, so the link is activated once, here.
          plan.order[index]?.click();
          this.#swallowClick();
        }
      }
      this.#run();
    }

    #swallowClick(): void {
      this.#swallow?.();
      const win = this.ownerDocument.defaultView!;
      const swallow = (e: Event) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        off();
      };
      const timer = win.setTimeout(() => off(), SWALLOW_MS);
      const off = () => {
        win.removeEventListener('click', swallow, true);
        win.clearTimeout(timer);
        this.#swallow = null;
      };
      win.addEventListener('click', swallow, true);
      this.#swallow = off;
    }

    // ---- forced states ------------------------------------------------------------------------------------------

    #applyForced(): void {
      cancelMotionFrame(this.#frame);
      this.#frame = 0;
      this.#drag = createNavDrag();
      this.#morph = null;
      this.#shown = null;
      this.#replan();
    }
  };
}

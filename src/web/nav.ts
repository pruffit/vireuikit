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
import {
  aimNavMorph,
  cancelNavDrag,
  createMinimize,
  createNavDrag,
  createNavMorph,
  currentNavFrame,
  expandMinimize,
  fixedNavigationForm,
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
import { effectiveInput, isEditable, watchAdaptiveContext } from './environment';
import { attachControlGlass, type GlassSession } from './glass';
import { ensureStyles } from './styles';

const FORCE_ATTRIBUTE = 'data-vire-force-state';
const GLASS_ON = new Set(['', 'present']);
const FORMS: readonly string[] = ['bar', 'rail', 'sidebar'];
const MATERIAL_STEPS = 10;
const DRAG_SLOP = 6;
const LENS_MAGNIFY = 0.15;
const SWALLOW_MS = 100;
const DEFAULT_COLLAPSE = 'Collapse sidebar';
const DEFAULT_EXPAND = 'Show sidebar';
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
  last: { material: string; morph: string; geometry: string };
  appear: number;
};

type Press = { id: number; startX: number; left: number; dragging: boolean; last: number };

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
const emptyLast = () => ({ material: '', morph: '', geometry: '' });
const newSlot = (el: HTMLElement): Slot => ({ el, session: null, token: 0, key: '', last: emptyLast(), appear: -1 });
const isCurrent = (link: Element) => {
  const value = link.getAttribute('aria-current');
  return value !== null && value !== 'false';
};

function dropEmptyStyle(el: Element, hadStyle: boolean): void {
  if (!hadStyle && el.getAttribute('style') === '') el.removeAttribute('style');
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
      'search-key',
      'collapse-label',
      'expand-label',
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
    #restore: (() => void)[] = [];
    #hadStyle = { host: false, nav: false, parent: false };
    #linkStyle = new Map<HTMLElement, boolean>();
    #hiddenWas = new Map<HTMLElement, boolean>();
    #mine = new Set<Node>();
    #own: A11yOverride = {};
    #mode: A11yMode | null = null;
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
    #frame = 0;
    #lastFrame = 0;
    #lensFor: Element | null = null;
    #lastKey = '';
    #parent: HTMLElement | null = null;
    #parentWas: { bottom: string; start: string } | null = null;
    #scrollTop = 0;
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
    }

    get scroller(): Element | null {
      return this.#scrollerProp;
    }

    set scroller(next: Element | null) {
      this.#scrollerProp = next;
      if (this.#navEl) this.#bindScroller();
    }

    connectedCallback(): void {
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
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#swallow?.();
      this.#unhold?.();
      window.clearTimeout(this.#tapTimer);
      this.#tapping = false;
      this.#unbindScroller?.();
      this.#unbindScroller = null;
      for (const slot of [this.#body, this.#lensSlot, this.#accSlot]) if (slot) this.#detach(slot);
      this.#releaseShortcut();
      this.#hovered?.removeAttribute('data-lens-over');
      this.#hovered = null;
      this.#accessory?.removeAttribute('data-placement');
      this.#accessory?.removeAttribute('data-moving');
      for (const el of [this.#accessory, this.#lens]) {
        if (!el) continue;
        for (const name of Array.from(el.style)) if (name.startsWith('--vk-')) el.style.removeProperty(name);
      }
      if (this.#accessory) dropEmptyStyle(this.#accessory, this.#accessoryHadStyle);
      for (const [el, was] of this.#hiddenWas) el.toggleAttribute('hidden', was);
      this.#hiddenWas.clear();
      for (const [link, had] of this.#linkStyle) {
        for (const name of Array.from(link.style)) if (name.startsWith('--vk-')) link.style.removeProperty(name);
        dropEmptyStyle(link, had);
      }
      this.#linkStyle.clear();
      for (const restore of this.#restore.splice(0).reverse()) restore();
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
      this.#drag = createNavDrag();
      this.#press = null;
      this.#minState = createMinimize();
      this.#scrollerEl = null;
      this.#over = false;
      this.#lensFor = null;
      this.#lastKey = '';
      this.#mine.clear();
      this.#linkStyle = new Map();
      this.#presentation = null;
      this.#mode = null;
      this.#frame = 0;
      this.#lastFrame = 0;
    }

    attributeChangedCallback(name: string): void {
      if (!this.#navEl) return;
      if (name === 'glass') this.#refreshMode(true);
      else if (name === FORCE_ATTRIBUTE) this.#applyForced();
      else if (name === 'minimize' || name === 'scroller') {
        this.#bindScroller();
        this.#replan();
      } else if (name === 'collapse-label' || name === 'expand-label') this.#syncToggle();
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
        for (const record of records) {
          if (record.type === 'attributes') {
            this.#lensFor = null;
            changed = true;
          } else if (![...record.addedNodes, ...record.removedNodes].every((node) => this.#mine.has(node))) {
            changed = true;
          }
        }
        if (changed) this.#scheduleReplan();
      });
      markup.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
      this.#cleanups.push(() => markup.disconnect());

      this.#mode = null;
      this.#refreshMode();
      this.#bindScroller();
      this.#cleanups.push(
        watchAdaptiveContext(this, (ctx) => {
          this.#ctx = ctx;
          this.#replan();
        }),
      );
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
        if (this.hasAttribute('data-scroll')) this.#scrollTop = nav.scrollTop;
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
      const order = [...primary.slice(0, nav.primary), ...primary.slice(nav.primary), ...secondary];
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
      });
    }

    #forced(): Forced | null {
      return parseForced(this.getAttribute(FORCE_ATTRIBUTE));
    }

    #replan(): void {
      const ctx = this.#ctx;
      if (!this.#navEl || !ctx) return;
      this.#rebindScrollerIfMissing();
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

    #bindScroller(): void {
      this.#unbindScroller?.();
      this.#unbindScroller = null;
      this.#scrollerEl = null;
      if (this.getAttribute('minimize') !== 'scroll') {
        this.#minState = createMinimize();
        return;
      }
      const id = this.getAttribute('scroller');
      const root = this.getRootNode() as Document | ShadowRoot;
      const el = this.#scrollerProp ?? (id ? root.getElementById(id) : null);
      if (!el) return;
      this.#scrollerEl = el;
      this.#minState = createMinimize(el.scrollTop);
      const onScroll = () => {
        const was = this.#minState.minimized;
        stepMinimize(this.#minState, el.scrollTop);
        if (this.#minState.minimized !== was) this.#replan();
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      this.#unbindScroller = () => el.removeEventListener('scroll', onScroll);
    }

    /** The scroller named by id may be parsed after the navigation. */
    #rebindScrollerIfMissing(): void {
      if (this.#scrollerEl || this.getAttribute('minimize') !== 'scroll') return;
      if (this.#scrollerProp || this.getAttribute('scroller')) this.#bindScroller();
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
      return (this.getRootNode() as Document | ShadowRoot).activeElement;
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
      toggle.setAttribute(
        'aria-label',
        expanded ? this.getAttribute('collapse-label') || DEFAULT_COLLAPSE : this.getAttribute('expand-label') || DEFAULT_EXPAND,
      );
    }

    #syncKeyShortcut(plan: Plan): void {
      const link = plan.search && plan.nav.search?.shortcut ? plan.search : null;
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
      const last = layout.items[layout.items.length - 1];
      const bottom = last ? last.y + last.height + 8 : 0;
      this.#fits = layout.form !== 'sidebar' || bottom <= layout.body.y + layout.body.height;
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
      }
      this.#paint();
      if (this.#frame || this.#forced()) return;
      this.#lastFrame = 0;
      this.#frame = requestAnimationFrame((t) => this.#tick(t));
    }

    #tick(now: number): void {
      this.#frame = 0;
      const morph = this.#morph;
      if (!this.isConnected || !morph || this.#forced()) return;
      const dt = this.#lastFrame ? Math.min((now - this.#lastFrame) / 1000, 0.05) : 1 / 60;
      this.#lastFrame = now;
      const instant = this.#presentation?.instantSprings ?? false;
      let moving = stepNavMorph(morph, dt, instant);
      const layout = this.#restLayout();
      if (layout && stepNavDrag(this.#drag, dt, instant)) moving = true;
      if (stepFormMorph(this.#pillAnim.state, dt, 1, instant)) moving = true;
      if (stepFormMorph(this.#accAnim.state, dt, 1, instant)) moving = true;
      this.#paint();
      if (moving) this.#frame = requestAnimationFrame((t) => this.#tick(t));
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
      const dragFrame = rest ? navDragFrame(this.#drag, shownLayout) : null;
      const lens = frame.lens
        ? { box: frame.lens.box, lift: frame.lens.lift, dragging: false, hover: -1 }
        : dragFrame
          ? { box: dragFrame.lens, lift: dragFrame.lift, dragging: true, hover: dragFrame.hover }
          : null;

      this.toggleAttribute('data-moving', !rest || dragFrame !== null);
      const scrolls = rest && dragFrame === null && !this.#fits;
      if (this.hasAttribute('data-scroll') !== scrolls) {
        this.toggleAttribute('data-scroll', scrolls);
        if (scrolls) nav.scrollTop = this.#scrollTop;
      }
      const ink = frame.showing === 'from' ? frame.ink.outgoing : frame.ink.incoming;
      this.style.setProperty('--vk-ink', clamp01(ink).toFixed(3));

      const box = frame.body;
      const s = nav.style;
      s.setProperty('--vk-x', px(box.x));
      s.setProperty('--vk-y', px(box.y));
      s.setProperty('--vk-w', px(box.width));
      s.setProperty('--vk-h', px(box.height));
      s.setProperty('--vk-r', px(box.radius));

      const pill = shown === plan ? this.#pillBox() : shownLayout.pill;
      this.#paintPill(shown.layout.minimized ? null : pill, ink * (1 - (lens?.lift ?? 0)));
      this.#paintLens(lens, shown, plan);
      this.#paintAccessory();

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
        this.#push(this.#body, box, soft ? 's' : 'c', () => this.#bodyMaterial(soft), morphShape);
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

    #paintLens(lens: { box: MorphBox; lift: number; dragging: boolean; hover: number } | null, shown: Plan, plan: Plan): void {
      const el = this.#lens;
      const slot = this.#lensSlot;
      if (!el || !slot) return;
      const visible = lens !== null;
      this.toggleAttribute('data-lens', visible);
      if (!lens) {
        this.#detach(slot);
        this.#markHover(-1, shown);
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
      this.#markHover(lens.dragging ? lens.hover : -1, shown);
      const selected = plan.order[plan.selected] ?? null;
      if (selected !== this.#lensFor) {
        this.#lensFor = selected;
        const inner = this.#lensInner!;
        inner.replaceChildren(...(selected ? Array.from(selected.childNodes).map((node) => node.cloneNode(true)) : []));
        for (const withId of Array.from(inner.querySelectorAll('[id]'))) withId.removeAttribute('id');
      }
      if (this.#presentation?.glass && !this.#glassBroken) {
        const key = JSON.stringify(this.#mode);
        if (slot.key !== key) this.#attach(slot, key, () => this.#lensMaterial(0), lens.box);
        const step = round(clamp01(lens.lift) * MATERIAL_STEPS) / MATERIAL_STEPS;
        if (slot.session) {
          const body = atomBody(VIREGLASS_CONTROL_MATERIAL, { ...ATOM_AT_REST, pressed: step }, this.#presentation.frost);
          s.setProperty('--vk-body-alpha', body.alpha.toFixed(3));
          s.setProperty('--vk-body-white', body.white.toFixed(3));
          s.setProperty('--vk-body-lift', body.lift.toFixed(3));
          if (Math.abs(slot.appear - lens.lift) > 0.02) {
            slot.appear = lens.lift;
            slot.session.setAppear(clamp01(lens.lift));
          }
          this.#push(slot, lens.box, String(step), () => this.#lensMaterial(step), undefined);
        }
      }
    }

    #lensMaterial(step: number): VireGlassMaterial {
      return atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'iconButton', { ...ATOM_AT_REST, pressed: step });
    }

    #hovered: HTMLAnchorElement | null = null;

    #markHover(index: number, shown: Plan): void {
      const link = index >= 0 ? (shown.order[index] ?? null) : null;
      if (link === this.#hovered) return;
      this.#hovered?.removeAttribute('data-lens-over');
      this.#hovered = link;
      link?.setAttribute('data-lens-over', '');
    }

    #paintAccessory(): void {
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
      const moving = anim.state.t.x < 1 && anim.from !== null;
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
      this.#push(slot, box, 'c', () => this.#bodyMaterial(false), undefined);
    }

    // ---- the glass ----------------------------------------------------------------------------------------------

    #detach(slot: Slot): void {
      slot.token += 1;
      slot.session?.destroy();
      slot.session = null;
      slot.key = '';
      slot.last = emptyLast();
      slot.appear = -1;
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
          this.#paint();
          if (slot === this.#body) this.dispatchEvent(new CustomEvent('vire-glass-ready'));
        })
        .catch(() => {
          if (token !== slot.token) return;
          slot.key = '';
          this.#glassBroken = true;
          this.#refreshMode(false, true);
        });
    }

    /** Hands the lens only what changed: a new morph or material rebuilds its filter, a moved box needs nothing. */
    #push(slot: Slot, box: MorphBox, materialKey: string, material: () => VireGlassMaterial, lens: GlassMorph | null | undefined): void {
      const session = slot.session;
      if (!session) return;
      const geometry = { width: round(box.width), height: round(box.height), cornerRadius: round(box.radius) };
      const key = {
        material: materialKey,
        morph: lens === undefined ? '-' : lens ? JSON.stringify(lens) : 'none',
        geometry: `${geometry.width}x${geometry.height}r${geometry.cornerRadius}`,
      };
      const last = slot.last;
      if (key.material === last.material && key.morph === last.morph && key.geometry === last.geometry) return;
      const next: Parameters<GlassSession['frame']>[0] = {};
      if (key.geometry !== last.geometry) next.geometry = geometry;
      if (key.material !== last.material) next.material = material();
      if (lens !== undefined && key.morph !== last.morph) next.morph = lens;
      slot.last = key;
      session.frame(next);
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
      if (this.#ctx) this.#run();
    }

    /** Attaches the body's and the accessory's glass once the first form is known; the lens waits for its first move. */
    #ensureGlass(): void {
      const layout = this.#plan?.layout;
      if (!layout) return;
      const key = this.#presentation?.glass && this.#mode ? JSON.stringify(this.#mode) : '';
      if (this.#body) this.#attach(this.#body, key, () => this.#bodyMaterial(false), layout.body);
      if (this.#accSlot && layout.accessory) this.#attach(this.#accSlot, key, () => this.#bodyMaterial(false), layout.accessory);
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
      this.#press = { id: e.pointerId, startX: e.clientX, left, dragging: false, last: e.timeStamp };
      const win = this.ownerDocument.defaultView!;
      const move = (ev: PointerEvent) => this.#pressMove(ev);
      const up = (ev: PointerEvent) => this.#pressUp(ev, false);
      const cancel = (ev: PointerEvent) => this.#pressUp(ev, true);
      win.addEventListener('pointermove', move);
      win.addEventListener('pointerup', up);
      win.addEventListener('pointercancel', cancel);
      this.#endPress = () => {
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
      if (cancelled || !bar) {
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
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#drag = createNavDrag();
      this.#morph = null;
      this.#shown = null;
      this.#replan();
    }
  };
}

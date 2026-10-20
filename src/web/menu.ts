import { VIREGLASS_CONTROL_MATERIAL, type BackdropSample, type VireGlassMorph } from 'vireglass';
import type { GlassMorph } from 'vireglass/dom';
import { presentationFor, sameA11y, type A11yMode, type A11yOverride, type Presentation } from '../kit/a11y';
import {
  MENU_CLOSED,
  MENU_CORNERS,
  MENU_ITEM_FILL,
  menuBody,
  menuMaterial,
  menuPlacement,
  menuSurfaceFrame,
  stepMenu,
  type MenuCorner,
  type MenuEvent,
  type MenuFocus,
  type MenuItem,
  type MenuState,
  type RoundedRect,
} from '../kit/menu';
import { createGrowthState, growthPhase, stepGrowth, type GrowthPhase, type GrowthPoint } from '../kit/morph';
import { segmentOf } from '../kit/adaptive/context';
import { sizeTier } from '../kit/adaptive/input';
import type { Rect, Size } from '../kit/geometry';
import { CONTROL_SIZES, menuSize, type ControlSize } from '../kit/sizes';
import { effectiveA11y, watchA11yOverride, watchSystemA11y } from './a11y';
import { effectiveInput, viewportSegments, watchPointerInput, watchViewport } from './environment';
import { deepActive, dropEmptyStyle, rootsOf, type Root } from './dom';
import { attachControlGlass, glassMorph, landGlass, moveGlass, type GlassFrame, type GlassSession } from './glass';
import { ensureStyles } from './styles';

const FORCE_ATTRIBUTE = 'data-vire-force-state';
const FORCED: Record<string, GrowthPhase | null> = {
  closed: null,
  growing: { shrink: 1, grow: 0.3 },
  open: { shrink: 1, grow: 1 },
  retracting: { shrink: 0.55, grow: 0 },
};
// A phase given as "<shrink> <grow>", for putting a frame next to a reference frame.
const FORCED_PHASE = /^\d*\.?\d+ \d*\.?\d+$/;
const GLASS_ON = new Set(['', 'present', 'touch']);
const MATERIAL_STEPS = 10;
const VIEWPORT_MARGIN = 8;
const TRIGGER = ':scope > button, :scope > vire-button > button, :scope > vire-icon-button > button';
const ACTIVATION_KEYS = new Set(['Enter', ' ']);

type Carrier = HTMLElement & { setCarried?: (ink: number | null) => void };

export interface VireMenuElement extends HTMLElement {
  a11y: A11yOverride;
  sample: BackdropSample | null;
  readonly open: boolean;
  /** The box the menu grows from and returns into instead of its trigger; cleared once the menu has closed. */
  anchor: Element | null;
  /** Runs the growth back into `el` and closes; `null` closes at once, for an anchor that is gone. */
  retractInto(el: Element | null): void;
  /** Puts the menu back on its anchor; a host that moves the trigger calls it. */
  follow(): void;
}

export type MenuElementOptions = { nonce?: string | undefined };

let ids = 0;

// Both stay the author's: a native disabled item cannot take focus, an aria-disabled one can (WAI-ARIA APG).
const nativelyDisabled = (item: Element) => item.hasAttribute('disabled');
const isDisabled = (item: Element) => nativelyDisabled(item) || item.getAttribute('aria-disabled') === 'true';

export function createMenuElementClass(options: MenuElementOptions = {}) {
  return class VireMenu extends HTMLElement implements VireMenuElement {
    static observedAttributes = ['glass', 'size', 'corner', FORCE_ATTRIBUTE];

    #trigger: HTMLButtonElement | null = null;
    #carrier: Carrier | null = null;
    #list: HTMLElement | null = null;
    #restore: (() => void)[] = [];
    #itemRestore = new Map<Element, () => void>();
    #hadStyle = { host: false, list: false };
    #cleanups: (() => void)[] = [];
    #state: MenuState = MENU_CLOSED;
    #growth = createGrowthState();
    #from: RoundedRect | null = null;
    #to: RoundedRect | null = null;
    #anchor: GrowthPoint | null = null;
    #region: Rect | null = null;
    #natural: Size | null = null;
    #out = false;
    #viaPointer = false;
    #frame = 0;
    #placeFrame = 0;
    #inertTimer = 0;
    #lastFrame = 0;
    /** When the content was last fully in focus; null while it is still arriving or leaving. */
    #readySince: number | null = null;
    /** When the content came into focus, which is when a deliberate key may choose. */
    #inSince: number | null = null;
    #downAt = Number.NEGATIVE_INFINITY;
    #own: A11yOverride = {};
    #mode: A11yMode | null = null;
    #presentation: Presentation | null = null;
    #glass: GlassSession | null = null;
    #glassToken = 0;
    #glassKey = '';
    #glassBroken = false;
    #lastLens = { material: '', morph: '', geometry: '' };
    #sample: BackdropSample | null = null;
    #held: BackdropSample | null = null;
    #anchorEl: Element | null = null;

    get a11y(): A11yOverride {
      return this.#own;
    }

    set a11y(next: A11yOverride) {
      this.#own = { ...next };
      if (this.#list) this.#refreshMode();
    }

    get sample(): BackdropSample | null {
      return this.#sample;
    }

    set sample(next: BackdropSample | null) {
      this.#sample = next;
      if (!this.#glass) return;
      if (this.#out) this.#holdSample();
      else this.#glass.setSample(next);
    }

    get open(): boolean {
      return this.#state.open;
    }

    get anchor(): Element | null {
      return this.#anchorEl;
    }

    set anchor(next: Element | null) {
      if (next === this.#anchorEl) return;
      const was = this.#liveCarrier();
      this.#anchorEl = next;
      if (!this.#out) return;
      if (was !== this.#liveCarrier()) was?.setCarried?.(null);
      this.#follow();
    }

    retractInto(el: Element | null): void {
      if (!this.#out || !this.#list) return;
      if (el === null) {
        this.#dismissNow();
        return;
      }
      this.anchor = el;
      this.#place();
      this.#close({ type: 'dismiss', reason: 'trigger' });
    }

    follow(): void {
      this.#follow();
    }

    connectedCallback(): void {
      for (const key of ['a11y', 'sample']) {
        if (!Object.prototype.hasOwnProperty.call(this, key)) continue;
        const value: unknown = Reflect.get(this, key);
        Reflect.deleteProperty(this, key);
        Reflect.set(this, key, value);
      }
      this.#hadStyle.host = this.hasAttribute('style');
      ensureStyles(this, options.nonce);
      this.#cleanups.push(watchPointerInput(() => this.#list && this.#refreshMode(true)));
      this.#cleanups.push(watchSystemA11y(() => this.#list && this.#refreshMode()));
      this.#cleanups.push(watchA11yOverride(() => this.#list && this.#refreshMode()));
      this.#awaitParts();
    }

    disconnectedCallback(): void {
      for (const cleanup of this.#cleanups.splice(0)) cleanup();
      cancelAnimationFrame(this.#frame);
      cancelAnimationFrame(this.#placeFrame);
      clearTimeout(this.#inertTimer);
      this.#frame = this.#placeFrame = this.#inertTimer = 0;
      this.#dropGlass();
      const list = this.#list;
      if (list) {
        if (list.matches(':popover-open')) list.hidePopover();
        list.inert = false;
        list.removeAttribute('data-scroll');
        for (const name of Array.from(list.style)) if (name.startsWith('--vk-')) list.style.removeProperty(name);
        for (const item of this.#items()) item.removeAttribute('data-pressed');
      }
      this.#liveCarrier()?.setCarried?.(null);
      this.#anchorEl = null;
      for (const restore of this.#itemRestore.values()) restore();
      this.#itemRestore.clear();
      for (const restore of this.#restore.splice(0).reverse()) restore();
      if (list) dropEmptyStyle(list, this.#hadStyle.list);
      this.#trigger = null;
      this.#carrier = null;
      this.#list = null;
      this.#state = MENU_CLOSED;
      this.#growth = createGrowthState();
      this.#out = false;
      this.#from = this.#to = this.#anchor = this.#region = null;
      this.#natural = null;
      this.#held = null;
      this.#readySince = null;
      this.#inSince = null;
      for (const name of ['data-vk', 'data-surface', 'data-glass', 'data-frost', 'data-contrast', 'data-size', 'data-phase', 'data-measure']) {
        this.removeAttribute(name);
      }
      for (const name of Array.from(this.style)) if (name.startsWith('--vk-')) this.style.removeProperty(name);
      dropEmptyStyle(this, this.#hadStyle.host);
      this.#presentation = null;
      this.#mode = null;
    }

    attributeChangedCallback(name: string): void {
      if (!this.#list) return;
      if (name === FORCE_ATTRIBUTE) this.#applyForced();
      else if (name === 'corner') this.#out && this.#place();
      else this.#refreshMode(true);
    }

    // The parser connects the element before its children exist, so the parts are waited for, not made up.
    #awaitParts(): void {
      if (this.#tryUpgrade()) return;
      const observer = new MutationObserver(() => {
        if (this.#tryUpgrade()) observer.disconnect();
      });
      observer.observe(this, { childList: true, subtree: true });
      this.#cleanups.push(() => observer.disconnect());
    }

    #tryUpgrade(): boolean {
      const list = this.querySelector<HTMLElement>(':scope > [popover]');
      const trigger = this.querySelector<HTMLButtonElement>(TRIGGER);
      if (!list || !trigger) return false;
      this.#upgrade(trigger, list);
      return true;
    }

    #keep(el: Element, name: string, value: string | null, into: (() => void)[] = this.#restore): void {
      const was = el.getAttribute(name);
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
      into.push(() => (was === null ? el.removeAttribute(name) : el.setAttribute(name, was)));
    }

    #upgrade(trigger: HTMLButtonElement, list: HTMLElement): void {
      this.#trigger = trigger;
      this.#list = list;
      this.#hadStyle.list = list.hasAttribute('style');
      const parent = trigger.parentElement;
      this.#carrier = parent && parent !== this ? (parent as Carrier) : null;
      const wasOpen = list.matches(':popover-open');
      this.setAttribute('data-vk', '');
      ids += 1;
      if (!list.id) this.#keep(list, 'id', `vire-menu-${ids}`);
      if (!trigger.id) this.#keep(trigger, 'id', `vire-menu-trigger-${ids}`);
      // The platform would hide the list at once; the growth has to run back before it leaves the top layer.
      this.#keep(trigger, 'popovertarget', null);
      this.#keep(trigger, 'popovertargetaction', null);
      this.#keep(trigger, 'aria-haspopup', 'menu');
      this.#keep(trigger, 'aria-expanded', 'false');
      this.#keep(trigger, 'aria-controls', list.id);
      this.#keep(list, 'popover', 'manual');
      this.#keep(list, 'role', 'menu');
      this.#keep(list, 'tabindex', '-1');
      this.#keep(list, 'aria-labelledby', trigger.id);
      this.#adoptItems();
      const items = new MutationObserver((records) => {
        let changed = false;
        for (const record of records) {
          if (record.type === 'childList' && record.target === list) {
            changed = true;
            for (const node of record.removedNodes) this.#releaseItem(node);
          } else if (record.type === 'attributes') {
            this.#keepFocusOff(record.target as Element);
          }
        }
        if (!changed) return;
        this.#adoptItems();
        if (this.#out) {
          this.#natural = null;
          this.#place();
        }
      });
      // Read, never rewritten: the disabled attribute stays the author's.
      items.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
      this.#cleanups.push(() => items.disconnect());
      this.#listen(trigger, list);
      this.#mode = null;
      this.#refreshMode();
      if (this.#forced()) this.#applyForced();
      else if (wasOpen) this.#show('menu');
    }

    #adoptItems(): void {
      for (const item of this.#items()) {
        if (this.#itemRestore.has(item)) continue;
        const restore: (() => void)[] = [];
        this.#keep(item, 'popovertarget', null, restore);
        this.#keep(item, 'popovertargetaction', null, restore);
        this.#keep(item, 'role', 'menuitem', restore);
        this.#keep(item, 'tabindex', '-1', restore);
        this.#itemRestore.set(item, () => {
          for (const undo of restore.reverse()) undo();
        });
      }
    }

    /** A focused item that turns natively disabled loses focus to the page; the menu keeps it instead. */
    #keepFocusOff(item: Element): void {
      const list = this.#list;
      if (!list || !this.#state.open || item.parentElement !== list || !nativelyDisabled(item)) return;
      const active = deepActive(list.getRootNode() as Root);
      if (active !== item && list.contains(active)) return;
      this.#state = { ...this.#state, active: -1 };
      list.focus({ preventScroll: true });
    }

    #releaseItem(node: Node): void {
      const restore = this.#itemRestore.get(node as Element);
      if (!restore) return;
      this.#itemRestore.delete(node as Element);
      restore();
    }

    #items(): HTMLButtonElement[] {
      return this.#list ? Array.from(this.#list.querySelectorAll<HTMLButtonElement>(':scope > button')) : [];
    }

    #model(): MenuItem[] {
      return this.#items().map((item) => ({
        label: item.getAttribute('aria-label') ?? item.textContent ?? '',
        disabled: isDisabled(item),
        focusable: !nativelyDisabled(item),
      }));
    }

    #listen(trigger: HTMLButtonElement, list: HTMLElement): void {
      const on = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, capture = false) => {
        target.addEventListener(type, handler as EventListener, capture);
        this.#cleanups.push(() => target.removeEventListener(type, handler as EventListener, capture));
      };
      const itemOf = (target: EventTarget | null) => {
        const item = target instanceof Element ? target.closest('button') : null;
        return item && item.parentElement === list ? (item as HTMLButtonElement) : null;
      };
      const drop = (e: Event) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };

      on<PointerEvent>(this.#carrier ?? trigger, 'pointerdown', () => (this.#viaPointer = true));
      on<KeyboardEvent>(trigger, 'keydown', (e) => {
        this.#viaPointer = false;
        if (this.#forced()) return;
        // A held key would open, choose the first item and open again, round and round.
        if (e.repeat && ACTIVATION_KEYS.has(e.key)) {
          e.preventDefault();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          this.#show(e.key === 'ArrowDown' ? 'first' : 'last');
        } else if (e.key === 'Escape' && this.#state.open) {
          e.preventDefault();
          this.#close({ type: 'dismiss', reason: 'escape' });
        }
      });
      on<MouseEvent>(trigger, 'click', (e) => {
        if (this.#forced()) return;
        // The menu covers its trigger, yet a press can still land on it while the surface grows: a second click
        // there belongs to the press that opened the menu, as it would on the first item.
        const pointer = e.detail > 0 || this.#viaPointer;
        const early = e.detail > 1 || (pointer && this.#readySince === null);
        if (this.#state.open && !early) this.#close({ type: 'dismiss', reason: 'trigger' });
        else if (!this.#state.open) this.#show(this.#viaPointer ? 'menu' : 'first');
        this.#viaPointer = false;
      });

      on<KeyboardEvent>(list, 'keydown', (e) => {
        if (!this.#state.open || this.#forced()) return;
        const move = { ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last' } as const;
        if (e.repeat && ACTIVATION_KEYS.has(e.key)) {
          e.preventDefault();
        } else if (e.key in move) {
          e.preventDefault();
          this.#step({ type: 'move', to: move[e.key as keyof typeof move] });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.#close({ type: 'dismiss', reason: 'escape' });
        } else if (e.key === 'Tab') {
          // Focus is put on the trigger before the browser moves it, so Tab carries on from there.
          this.#close({ type: 'dismiss', reason: 'tab' });
        } else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          this.#step({ type: 'type', key: e.key, at: e.timeStamp / 1000 });
        } else if (ACTIVATION_KEYS.has(e.key)) {
          const item = itemOf(e.target);
          if (item && !isDisabled(item)) item.setAttribute('data-pressed', '');
        }
      });
      on<KeyboardEvent>(list, 'keyup', (e) => itemOf(e.target)?.removeAttribute('data-pressed'));

      // Captured, so a choice closes the menu even when an item's own handler stops the click.
      on<MouseEvent>(
        list,
        'click',
        (e) => {
          const item = itemOf(e.target);
          if (!item || this.#forced()) return;
          if (isDisabled(item)) return drop(e);
          if (!this.#state.open) {
            if (this.#out) drop(e);
            return;
          }
          // Not what the person chose: the second click of a double click, a pointer click before the menu has
          // arrived or whose press began earlier (the item grew in under the pointer), or a key before the content shows.
          const ready = this.#readySince;
          const pointerEarly = e.detail > 0 && (ready === null || this.#downAt < ready);
          if (e.detail > 1 || pointerEarly || this.#inSince === null) return drop(e);
          this.#close({ type: 'choose', index: this.#items().indexOf(item) });
        },
        true,
      );
      on<PointerEvent>(
        list,
        'pointerdown',
        (e) => {
          this.#downAt = e.timeStamp;
          const item = itemOf(e.target);
          if (e.button === 0 && item && !isDisabled(item) && !this.#forced()) item.setAttribute('data-pressed', '');
        },
        true,
      );
      on<PointerEvent>(list, 'pointermove', (e) => {
        const item = itemOf(e.target);
        if (item && this.#state.open && !this.#forced()) this.#step({ type: 'point', index: this.#items().indexOf(item) });
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerout']) {
        on<PointerEvent>(list, type, (e) => itemOf(e.target)?.removeAttribute('data-pressed'));
      }
      on<FocusEvent>(list, 'focusout', (e) => {
        const to = e.relatedTarget as Node | null;
        if (!this.#state.open || !to || this.#forced()) return;
        if (list.contains(to) || trigger.contains(to) || this.#carrier?.contains(to)) return;
        this.#close({ type: 'dismiss', reason: 'outside' });
      });

      // A press is judged in the innermost tree that can see it: a closed shadow root hides the menu from the document.
      const roots = rootsOf(this);
      roots.forEach((root, i) => {
        const inner = i === 0 ? null : (roots[i - 1] as ShadowRoot).host;
        on<PointerEvent>(
          root,
          'pointerdown',
          (e) => {
            if (!this.#state.open || this.#forced()) return;
            const path = e.composedPath();
            if (inner && path.includes(inner)) return;
            if ([list, trigger, this.#carrier].some((node) => node !== null && path.includes(node))) return;
            this.#close({ type: 'dismiss', reason: 'outside' });
          },
          true,
        );
        on(root, 'scroll', (e: Event) => this.#follow(e), true);
      });
      this.#cleanups.push(watchViewport(() => this.#follow()));
      // A trigger taken out of the document has nothing to grow back into.
      const gone = new MutationObserver(() => {
        if (this.#out && !this.#anchorEl && !trigger.isConnected) this.#dismissNow();
      });
      gone.observe(this, { childList: true, subtree: true });
      this.#cleanups.push(() => gone.disconnect());
      // A trigger inside an element that upgrades after this one changes size under the menu.
      if (typeof ResizeObserver !== 'undefined') {
        const resized = new ResizeObserver(() => this.#out && this.#follow());
        resized.observe(this.#carrier ?? trigger);
        this.#cleanups.push(() => resized.disconnect());
      }
    }

    /** Puts the menu back over its trigger after a scroll or a resize, once per frame. */
    #follow(e?: Event): void {
      if (!this.#out || this.#placeFrame) return;
      if (e?.target instanceof Node && this.#list?.contains(e.target)) return;
      this.#placeFrame = requestAnimationFrame(() => {
        this.#placeFrame = 0;
        if (this.#out) this.#place();
      });
    }

    #step(event: MenuEvent): void {
      const step = stepMenu(this.#state, event, this.#model());
      this.#state = step.state;
      this.#applyFocus(step.focus);
    }

    #applyFocus(focus: MenuFocus): void {
      const list = this.#list!;
      if (focus.to === 'item') this.#items()[focus.index]?.focus({ preventScroll: true });
      else if (focus.to === 'menu') list.focus({ preventScroll: true });
      else if (focus.to === 'trigger') this.#anchorButton()?.focus({ preventScroll: true });
      else if (focus.to === 'none') {
        const active = deepActive(list.getRootNode() as Root);
        if (active instanceof HTMLElement && list.contains(active)) active.blur();
      }
    }

    #show(focus: 'menu' | 'first' | 'last'): void {
      const list = this.#list!;
      const step = stepMenu(this.#state, { type: 'open', focus }, this.#model());
      this.#state = step.state;
      this.#readySince = null;
      this.#inSince = null;
      clearTimeout(this.#inertTimer);
      list.inert = false;
      this.#trigger!.setAttribute('aria-expanded', 'true');
      this.#comeOut();
      this.#run();
      this.#applyFocus(step.focus);
    }

    #close(event: MenuEvent): void {
      const step = stepMenu(this.#state, event, this.#model());
      const closing = this.#state.open && !step.state.open;
      this.#state = step.state;
      this.#applyFocus(step.focus);
      if (!closing) return;
      this.#readySince = null;
      this.#inSince = null;
      this.#trigger!.setAttribute('aria-expanded', 'false');
      for (const item of this.#items()) item.removeAttribute('data-pressed');
      // Not inside the click that chose: the item still owes its own handlers that click.
      clearTimeout(this.#inertTimer);
      this.#inertTimer = window.setTimeout(() => {
        if (this.#list && !this.#state.open && this.#out) this.#list.inert = true;
      });
      this.#run();
    }

    #comeOut(): void {
      const list = this.#list!;
      const wasOut = this.#out;
      if (!list.matches(':popover-open')) list.showPopover();
      this.#out = true;
      if (!wasOut) this.#natural = null;
      this.#place();
      if (wasOut) return;
      // Read while the trigger still has its glass, which the probe sees through.
      this.#holdSample();
      this.#liveCarrier()?.setCarried?.(1);
    }

    #triggerBox(): RoundedRect {
      const trigger = this.#trigger!;
      // The host's box is the unscaled one; a pressed button is still growing when the menu opens.
      const r = (this.#anchorEl ?? this.#carrier ?? trigger).getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(this.#anchorButton() ?? trigger).borderTopLeftRadius) || 0;
      return { x: r.x, y: r.y, width: r.width, height: r.height, radius: Math.min(radius, r.width / 2, r.height / 2) };
    }

    #corner(): MenuCorner | undefined {
      const wanted = this.getAttribute('corner');
      return wanted && Object.hasOwn(MENU_CORNERS, wanted) ? MENU_CORNERS[wanted as keyof typeof MENU_CORNERS] : undefined;
    }

    #measure(): Size {
      const list = this.#list!;
      this.setAttribute('data-measure', '');
      const natural = { width: list.offsetWidth, height: list.offsetHeight };
      this.removeAttribute('data-measure');
      return natural;
    }

    #place(): void {
      const list = this.#list!;
      const spec = menuSize(this.#size());
      this.#natural ??= this.#measure();
      const natural = this.#natural;
      const trigger = this.#triggerBox();
      const { viewport, segments } = viewportSegments();
      const region = segmentOf(trigger, segments) ?? viewport;
      this.#region = region;
      const placement = menuPlacement(trigger, natural, region, { corner: this.#corner(), margin: VIEWPORT_MARGIN });
      this.#from = trigger;
      this.#to = { ...placement.rect, radius: spec.radius };
      this.#anchor = placement.anchor;
      list.style.setProperty('--vk-content-w', `${placement.rect.width - 2 * spec.padding}px`);
      list.toggleAttribute('data-scroll', placement.rect.height < natural.height);
      this.#paint();
    }

    #holdSample(): void {
      const glass = this.#glass;
      if (!glass || !this.#to) return;
      let sample = this.#sample;
      if (!sample) {
        this.#setBox(this.#to);
        sample = glass.probe();
      }
      this.#held = sample;
      glass.setSample(sample);
      this.#paint();
    }

    #setBox(box: RoundedRect): void {
      const s = this.#list!.style;
      const px = (v: number) => `${v.toFixed(2)}px`;
      s.setProperty('--vk-x', px(box.x));
      s.setProperty('--vk-y', px(box.y));
      s.setProperty('--vk-w', px(box.width));
      s.setProperty('--vk-h', px(box.height));
      s.setProperty('--vk-r', px(box.radius));
    }

    #run(): void {
      const instant = this.#presentation?.instantSprings ?? false;
      if (instant) stepGrowth(this.#growth, 0, this.#state.open, true);
      this.#paint();
      if (instant) {
        this.#settle();
        return;
      }
      if (this.#frame) return;
      this.#lastFrame = 0;
      this.#frame = requestAnimationFrame((t) => this.#tick(t));
    }

    #tick(now: number): void {
      this.#frame = 0;
      if (!this.isConnected || this.#forced()) return;
      const dt = this.#lastFrame ? Math.min((now - this.#lastFrame) / 1000, 0.05) : 1 / 60;
      this.#lastFrame = now;
      const instant = this.#presentation?.instantSprings ?? false;
      const moving = stepGrowth(this.#growth, dt, this.#state.open, instant);
      this.#paint();
      if (moving) this.#frame = requestAnimationFrame((t) => this.#tick(t));
      else this.#settle();
    }

    #settle(): void {
      if (this.#state.open) {
        this.#paint();
        return;
      }
      const list = this.#list!;
      if (this.#glass) landGlass(this.#glass);
      // The list's own toggle event fires here, once the growth has run back; aria-expanded turned false as it began.
      if (list.matches(':popover-open')) list.hidePopover();
      clearTimeout(this.#inertTimer);
      list.inert = false;
      list.removeAttribute('data-scroll');
      for (const name of Array.from(list.style)) if (name.startsWith('--vk-')) list.style.removeProperty(name);
      this.removeAttribute('data-phase');
      this.#out = false;
      this.#held = null;
      this.#from = this.#to = this.#anchor = this.#region = null;
      this.#glass?.setSample(this.#sample);
      this.#liveCarrier()?.setCarried?.(null);
      this.#anchorEl = null;
    }

    /** What carries the menu's body while it is out: the anchor if it can, else the trigger's control. */
    #liveCarrier(): Carrier | null {
      const anchor = this.#anchorEl as Carrier | null;
      if (!anchor) return this.#carrier;
      if (typeof anchor.setCarried === 'function') return anchor;
      const parent = anchor.parentElement as Carrier | null;
      return parent && typeof parent.setCarried === 'function' ? parent : null;
    }

    #anchorButton(): HTMLElement | null {
      const anchor = this.#anchorEl;
      if (!anchor) return this.#trigger;
      return anchor instanceof HTMLButtonElement ? anchor : (anchor.querySelector<HTMLButtonElement>('button') ?? (anchor as HTMLElement));
    }

    /** The anchor is gone with nothing to retract into: the menu leaves where it stands. */
    #dismissNow(): void {
      const step = stepMenu(this.#state, { type: 'dismiss', reason: 'outside' }, this.#model());
      this.#state = step.state;
      this.#trigger?.setAttribute('aria-expanded', 'false');
      for (const item of this.#items()) item.removeAttribute('data-pressed');
      stepGrowth(this.#growth, 0, false, true);
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#settle();
    }

    #paint(): void {
      const list = this.#list;
      if (!list || !this.#out || !this.#from || !this.#to || !this.#anchor) return;
      const phase = growthPhase(this.#growth);
      const f = menuSurfaceFrame(this.#from, this.#to, this.#anchor, phase, this.#region ?? undefined);
      const settled = phase.shrink === 1 && phase.grow === 1;
      // The ink as drawn decides it, so what shows in focus is what can be chosen.
      const inkIn = Math.round(f.ink.incoming * 1000) / 1000;
      // Arrived: the content in focus and the surface no longer growing (past its overshoot).
      if (this.#state.open && inkIn >= 1) {
        this.#inSince ??= performance.now();
        if (this.#growth.grow.v <= 0) this.#readySince ??= performance.now();
      }
      this.setAttribute('data-phase', settled ? 'open' : 'moving');
      this.#setBox(f.box);
      const s = list.style;
      s.setProperty('--vk-cx', `${f.content.x.toFixed(2)}px`);
      s.setProperty('--vk-cy', `${f.content.y.toFixed(2)}px`);
      s.setProperty('--vk-ink-in', inkIn.toFixed(3));
      const body = menuBody(VIREGLASS_CONTROL_MATERIAL, f.activity, this.#presentation?.frost ?? false);
      s.setProperty('--vk-body-alpha', body.alpha.toFixed(3));
      s.setProperty('--vk-body-white', body.white.toFixed(3));
      s.setProperty('--vk-body-lift', body.lift.toFixed(3));
      this.#liveCarrier()?.setCarried?.(f.ink.outgoing);
      this.#pushGlass(f.box, f.morph, f.activity, !settled && this.#forced() === null);
    }

    /** Hands the lens only what changed: a new morph or material rebuilds its filter, a moved box needs nothing. */
    #pushGlass(box: RoundedRect, morph: VireGlassMorph | undefined, activity: number, moving: boolean): void {
      const glass = this.#glass;
      if (!glass) return;
      // Whole pixels, so a repeated open finds its displacement maps in the core's cache.
      const round = Math.round;
      const step = round(Math.min(Math.max(activity, 0), 1) * MATERIAL_STEPS) / MATERIAL_STEPS;
      const geometry = { width: round(box.width), height: round(box.height), cornerRadius: round(box.radius) };
      const lens = glassMorph(morph, moving);
      const key = {
        material: String(step),
        morph: lens ? JSON.stringify(lens) : 'none',
        geometry: `${geometry.width}x${geometry.height}r${geometry.cornerRadius}`,
      };
      moveGlass(glass, moving, () => {
        const last = this.#lastLens;
        if (key.material === last.material && key.morph === last.morph && key.geometry === last.geometry) return;
        const next: GlassFrame = {};
        if (key.geometry !== last.geometry) next.geometry = geometry;
        if (key.material !== last.material) next.material = menuMaterial(VIREGLASS_CONTROL_MATERIAL, step);
        if (key.morph !== last.morph) next.morph = lens;
        this.#lastLens = key;
        glass.frame(next);
      });
    }

    #forced(): string | null {
      const wanted = this.getAttribute(FORCE_ATTRIBUTE);
      return wanted !== null && (Object.hasOwn(FORCED, wanted) || FORCED_PHASE.test(wanted)) ? wanted : null;
    }

    #applyForced(): void {
      const forced = this.#forced();
      const [shrink, grow] = (forced ?? '').split(' ').map(Number);
      const phase = !forced ? null : Object.hasOwn(FORCED, forced) ? FORCED[forced]! : { shrink: shrink!, grow: grow! };
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      if (!phase) {
        this.#state = MENU_CLOSED;
        this.#growth = createGrowthState();
        this.#trigger!.setAttribute('aria-expanded', 'false');
        if (this.#out) this.#settle();
        return;
      }
      this.#state = { ...MENU_CLOSED, open: forced !== 'retracting' };
      this.#growth = {
        shrink: { x: phase.shrink, v: 0, target: phase.shrink },
        grow: { x: phase.grow, v: 0, target: phase.grow },
      };
      this.#trigger!.setAttribute('aria-expanded', String(this.#state.open));
      this.#list!.inert = true;
      this.#comeOut();
    }

    #size(): ControlSize {
      const wanted = this.getAttribute('size');
      if (wanted && (CONTROL_SIZES as readonly string[]).includes(wanted)) return wanted as ControlSize;
      return sizeTier(effectiveInput());
    }

    #wantsGlass(): boolean {
      const wanted = this.getAttribute('glass');
      return wanted !== null && GLASS_ON.has(wanted);
    }

    #refreshMode(force = false, afterFailure = false): void {
      if (!afterFailure) this.#glassBroken = false;
      const mode = effectiveA11y(this.#own);
      let next = presentationFor(mode, this.#wantsGlass());
      if (this.#glassBroken && next.glass) next = { ...next, glass: false, surface: next.frost ? 'frosted' : 'plain' };
      const changed =
        force || !this.#mode || !sameA11y(this.#mode, mode) || next.surface !== this.#presentation?.surface;
      this.#mode = mode;
      this.#presentation = next;
      this.#applySize();
      this.setAttribute('data-surface', next.surface);
      this.toggleAttribute('data-contrast', next.contrastBorder);
      this.toggleAttribute('data-frost', next.frost);
      this.setAttribute('data-glass', next.glass ? 'on' : 'off');
      if (changed) this.#reattachGlass(mode);
      if (this.#out) {
        this.#natural = null;
        this.#place();
      }
    }

    #applySize(): void {
      const spec = menuSize(this.#size());
      const set = (name: string, value: string) => this.style.setProperty(name, value);
      set('--vk-menu-row', `${spec.row}px`);
      set('--vk-menu-pad', `${spec.padding}px`);
      set('--vk-menu-radius', `${spec.radius}px`);
      set('--vk-item-radius', `${spec.itemRadius}px`);
      set('--vk-menu-icon', `${spec.icon}px`);
      set('--vk-label-pad', `${spec.labelPad}px`);
      set('--vk-fill-active', String(MENU_ITEM_FILL.active));
      set('--vk-fill-pressed', String(MENU_ITEM_FILL.pressed));
      this.setAttribute('data-size', this.#size());
    }

    #dropGlass(): void {
      this.#glassToken += 1;
      this.#glass?.destroy();
      this.#glass = null;
      this.#glassKey = '';
      this.#lastLens = { material: '', morph: '', geometry: '' };
    }

    #reattachGlass(mode: A11yMode): void {
      const list = this.#list;
      const want = this.#presentation?.glass === true && list !== null;
      const key = want ? `${JSON.stringify(mode)}|${this.#size()}` : '';
      if (key === this.#glassKey) return;
      this.#dropGlass();
      this.#glassKey = key;
      if (!want || !list) return;
      const token = this.#glassToken;
      const box: Rect = this.#from ?? this.#triggerBox();
      void attachControlGlass(
        list,
        {
          material: menuMaterial(VIREGLASS_CONTROL_MATERIAL, 0),
          geometry: { width: Math.round(box.width), height: Math.round(box.height), cornerRadius: menuSize(this.#size()).radius },
          accessibility: mode,
          onTouch: false,
          sample: this.#held ?? this.#sample,
          interactive: false,
        },
        () => token === this.#glassToken && this.isConnected,
      )
        .then((session) => {
          if (!session) return;
          this.#glass = session;
          this.#lastLens = { material: '', morph: '', geometry: '' };
          if (this.#out) this.#holdSample();
          this.dispatchEvent(new CustomEvent('vire-glass-ready'));
        })
        .catch(() => {
          if (token !== this.#glassToken) return;
          this.#glassKey = '';
          this.#glassBroken = true;
          this.#refreshMode(false, true);
        });
    }
  };
}

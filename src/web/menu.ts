import { VIREGLASS_CONTROL_MATERIAL, type BackdropSample, type VireGlassGeometry, type VireGlassMaterial, type VireGlassMorph } from 'vireglass';
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
import { createGrowthState, createMotionClock, growthPhase, heldGrowthState, smoothstep, stepGrowth, stepMotion, type GrowthPhase, type GrowthPoint } from '../kit/morph';
import { probeFramePeriod } from './refresh';
import { segmentOf } from '../kit/adaptive/context';
import { sizeTier } from '../kit/adaptive/input';
import type { Rect, Size } from '../kit/geometry';
import { CONTROL_SIZES, menuSize, type ControlSize } from '../kit/sizes';
import { effectiveA11y, watchA11yOverride, watchSystemA11y } from './a11y';
import { effectiveInput, viewportSegments, watchPointerInput, watchViewport } from './environment';
import { cancelMotionFrame, deepActive, dropEmptyStyle, requestMotionFrame, rootsOf, whenIdle, type Root } from './dom';
import type { RestLens } from './element';
import { attachControlGlass, glassMorph, moveGlass, type GlassFrame, type GlassSession } from './glass';
import { ensureStyles } from './styles';

const FORCE_ATTRIBUTE = 'data-vire-force-state';
const FORCED: Record<string, GrowthPhase | null> = {
  closed: null,
  growing: { shrink: 1, grow: 0.3 },
  open: { shrink: 1, grow: 1 },
  retracting: { shrink: 0.55, grow: 0 },
};
// A phase given as "<shrink> <grow> [<focus> [<rise> [<glow> [<height>]]]]", for putting a frame next to a reference frame.
const FORCED_PHASE = /^-?\d*\.?\d+( -?\d*\.?\d+){1,5}$/;
const GLASS_ON = new Set(['', 'present', 'touch']);
const MATERIAL_STEPS = 10;
// The medium counts as at rest below this activity: the last step of its tail is then taken while the surface still moves, not as its last frame.
const ACTIVITY_AT_REST = 0.15;
// The rows are this much larger while the lens still holds them out of focus.
const CONTENT_MAGNIFY = 0.6;
// From here the content is in focus as far as the eye can tell, and is drawn as sharp.
const CONTENT_SHARP = 0.99;
// The content is fully opaque from here (styles: opacity is the ink three times over).
const CONTENT_DRAWN = 0.34;
// How much of the light of the lit body goes to the halo, besides the drop's own.
const HALO_LIT = 0.15;
// The content comes in this many rows high and slides down into place as it comes into focus.
const CONTENT_RISE = 2.2;
const VIEWPORT_MARGIN = 8;
const TRIGGER = ':scope > button, :scope > vire-button > button, :scope > vire-icon-button > button';
const ACTIVATION_KEYS = new Set(['Enter', ' ']);

// Once the closing drop is the size of its trigger, the trigger's glyph and focus ring come into focus over this long, from this much.
const RING_MS = 360;
const HAND_INK = 0.9;
// How long the closing drop takes to cover what is left of the way to its trigger once it is the trigger's size.
const SLIDE_MS = 70;
// How long a menu takes to move to a size found stale while it is open.
const RETARGET_MS = 220;
// Within this many pixels of the box it lands on, the lens is given that box.
const LENS_SNAP_PX = 1.5;

type Carrier = HTMLElement & { setCarried?: (ink: number | null, ring?: number, bodyBack?: boolean) => void; restLens?: (probe?: boolean) => RestLens | null };

type Lens = { geometry: VireGlassGeometry; morph: GlassMorph | null; material: VireGlassMaterial; materialKey: string };

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

/** The open box on whole pixels, so text drawn on the growth's transform and text laid out in the box land on the same ones. */
const wholePixels = (r: Rect, radius: number): RoundedRect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), radius });

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
    /** The list was measured while the page was idle, and nothing has changed it since. */
    #premeasured = false;
    #cancelIdle: (() => void) | null = null;
    #cancelVerify: (() => void) | null = null;
    /** The open used the idle measure, so one more measure when the page is idle after it checks that it was current. */
    #verify = false;
    #out = false;
    #viaPointer = false;
    #frame = 0;
    #placeFrame = 0;
    #inertTimer = 0;
    #clock = createMotionClock();
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
    /** What the trigger shows by now, with the backdrop it was read over when the menu came out: hover may have moved it since. */
    #refreshRest(): void {
      const fresh = this.#liveCarrier()?.restLens?.(false);
      if (fresh && this.#rest) this.#rest = { ...fresh, sample: this.#rest.sample };
    }

    /** The trigger's lens as it was when the menu came out: what the drop closes into. */
    #rest: RestLens | null = null;
    #homeAt: number | null = null;
    #tintAt = -1;
    #slideAt: number | null = null;
    /** The box the lens is to land on, as `prepare` was told. */
    #dest: VireGlassGeometry | null = null;
    /** A size found stale while open: the box the menu was drawn at, and when it began to move to the new one. */
    #retarget: { from: RoundedRect; at: number } | null = null;
    #anchorEl: Element | null = null;
    #buttonRect: Rect | null = null;
    #clip: { el: HTMLElement; had: string } | null = null;
    #halo: HTMLElement | null = null;

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
      if (this.#out) {
        this.#holdSample();
        this.#prepareDestination();
      } else this.#glass.setSample(next);
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
      if (was !== this.#liveCarrier()) {
        was?.setCarried?.(null);
        this.#rest = this.#liveCarrier()?.restLens?.() ?? null;
      }
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
      probeFramePeriod();
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
      cancelMotionFrame(this.#frame);
      cancelAnimationFrame(this.#placeFrame);
      this.#cancelIdle?.();
      this.#cancelVerify?.();
      this.#cancelIdle = this.#cancelVerify = null;
      this.#verify = this.#premeasured = false;
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
      this.#unclipTrigger();
      this.#unshine();
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
      this.#rest = null;
      this.#retarget = null;
      this.#readySince = null;
      this.#inSince = null;
      for (const name of ['data-vk', 'data-surface', 'data-glass', 'data-frost', 'data-contrast', 'data-size', 'data-phase', 'data-joined', 'data-arrived', 'data-sharp', 'data-measure']) {
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
      else if (name === 'corner') this.#out && this.#replace();
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
          if (record.type === 'childList' || record.type === 'characterData') {
            changed = true;
            if (record.target === list) for (const node of record.removedNodes) this.#releaseItem(node);
          } else if (record.type === 'attributes') {
            this.#keepFocusOff(record.target as Element);
          }
        }
        if (!changed) return;
        this.#adoptItems();
        this.#invalidate();
      });
      // Read, never rewritten: the disabled attribute stays the author's.
      items.observe(list, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
      this.#cleanups.push(() => items.disconnect());
      this.#listen(trigger, list);
      // A closed list's own styles change its size unseen, so they say so for the idle measure.
      const restyled = new MutationObserver(() => {
        if (this.#out) return;
        this.#premeasured = false;
        this.#premeasureSoon();
      });
      restyled.observe(list, { attributes: true, subtree: true, attributeFilter: ['class', 'style', 'hidden'] });
      this.#cleanups.push(() => restyled.disconnect());
      // A late font or image resizes the list without any mutation.
      const fonts = this.ownerDocument.fonts;
      const stale = () => this.#invalidate();
      fonts?.addEventListener('loadingdone', stale);
      list.addEventListener('load', stale, true);
      this.#cleanups.push(() => {
        fonts?.removeEventListener('loadingdone', stale);
        list.removeEventListener('load', stale, true);
      });
      this.#premeasureSoon();
      this.#mode = null;
      this.#refreshMode();
      if (this.#forced()) this.#applyForced();
      else if (wasOpen) this.#show('menu');
    }

    #adoptItems(): void {
      this.#items().forEach((item, index) => {
        const known = this.#itemRestore.has(item);
        const had = item.hasAttribute('style');
        item.style.setProperty('--vk-i', String(index));
        if (known) return;
        const restore: (() => void)[] = [() => {
          item.style.removeProperty('--vk-i');
          dropEmptyStyle(item, had);
        }];
        this.#keep(item, 'popovertarget', null, restore);
        this.#keep(item, 'popovertargetaction', null, restore);
        this.#keep(item, 'role', 'menuitem', restore);
        this.#keep(item, 'tabindex', '-1', restore);
        this.#itemRestore.set(item, () => {
          for (const undo of restore.reverse()) undo();
        });
      });
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
        if (this.#out) this.#replace();
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
      this.#homeAt = null;
      this.#slideAt = null;
      clearTimeout(this.#inertTimer);
      list.inert = false;
      this.#trigger!.setAttribute('aria-expanded', 'true');
      this.#comeOut();
      this.#prepareDestination(true);
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
      this.#refreshRest();
      this.#prepareDestination(true);
      this.#run();
    }

    /** Measures the list while the page is idle, so the click that opens it does not lay it out. */
    #premeasureSoon(): void {
      if (this.#cancelIdle) return;
      const list = this.#list;
      this.#cancelIdle = whenIdle(() => {
        this.#cancelIdle = null;
        if (this.#out || !list || this.#list !== list || !this.isConnected) return;
        this.#natural = this.#measure();
        this.#premeasured = true;
        this.#prepareIdle();
      });
    }

    /** What the list measured is no longer known to be current. */
    #invalidate(): void {
      this.#natural = null;
      this.#premeasured = false;
      if (this.#out) this.#replace();
      else this.#premeasureSoon();
    }

    #verifyMeasure(): void {
      if (!this.#verify) return;
      this.#verify = false;
      const list = this.#list;
      this.#cancelVerify?.();
      this.#cancelVerify = whenIdle(() => {
        this.#cancelVerify = null;
        if (!list || this.#list !== list || !this.#out || !this.#state.open || this.#frame) return;
        const now = this.#measure();
        const was = this.#natural;
        if (was && Math.abs(now.width - was.width) < 1 && Math.abs(now.height - was.height) < 1) return;
        this.#natural = now;
        const from = this.#toNow();
        this.#place(false);
        // Reduced motion has no motion to carry the change in: the menu is at its new size at once.
        this.#retarget = this.#presentation?.instantSprings ? null : { from, at: performance.now() };
        this.#prepareDestination(true);
        this.#run();
      });
    }

    #comeOut(): void {
      const list = this.#list!;
      const wasOut = this.#out;
      // Read before the list is in the top layer, which the probe would see.
      if (!wasOut) this.#rest = this.#liveCarrier()?.restLens?.() ?? null;
      if (!list.matches(':popover-open')) list.showPopover();
      this.#out = true;
      if (!wasOut && !this.#premeasured) this.#natural = null;
      if (!wasOut) {
        this.#verify = this.#premeasured;
        this.#premeasured = false;
      }
      this.#place(wasOut);
      if (wasOut) return;
      // Read while the trigger still has its glass, which the probe sees through.
      this.#holdSample(false);
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

    #layout(natural: Size) {
      const trigger = this.#triggerBox();
      const { viewport, segments } = viewportSegments();
      const region = segmentOf(trigger, segments) ?? viewport;
      return { trigger, region, placement: menuPlacement(trigger, natural, region, { corner: this.#corner(), margin: VIEWPORT_MARGIN }) };
    }

    #replace(): void {
      this.#place();
      this.#prepareDestination();
    }

    #place(paint = true): void {
      const list = this.#list!;
      const spec = menuSize(this.#size());
      this.#natural ??= this.#measure();
      const { trigger, region, placement } = this.#layout(this.#natural);
      const natural = this.#natural;
      this.#region = region;
      this.#from = trigger;
      this.#buttonRect = this.#anchorButton()?.getBoundingClientRect() ?? trigger;
      this.#to = wholePixels(placement.rect, spec.radius);
      this.#anchor = placement.anchor;
      list.style.setProperty('--vk-content-w', `${this.#to.width - 2 * spec.padding}px`);
      list.toggleAttribute('data-scroll', placement.rect.height < natural.height);
      if (paint) this.#paint();
    }

    #holdSample(paint = true): void {
      const glass = this.#glass;
      if (!glass || !this.#to) return;
      let sample = this.#sample;
      if (!sample) {
        this.#setBox(this.#to);
        sample = glass.probe();
      }
      this.#held = sample;
      this.#tintAt = -1;
      // Colours change at once in a lens that is moving, and ease in one that is not: the drop is coming out.
      if (!paint) glass.setInterim(true);
      glass.setSample(sample);
      if (paint) this.#paint();
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
      this.#paint(instant);
      if (instant) {
        this.#settle();
        return;
      }
      if (this.#frame) return;
      this.#clock = createMotionClock();
      this.#frame = requestMotionFrame((t) => this.#tick(t));
    }

    #tick(now: number): void {
      this.#frame = 0;
      if (!this.isConnected || this.#forced()) return;
      const instant = this.#presentation?.instantSprings ?? false;
      const growing = stepMotion(this.#clock, now, (dt) => stepGrowth(this.#growth, dt, this.#state.open, instant));
      this.#paint(!growing && this.#retarget === null);
      if (growing || this.#retarget) this.#frame = requestMotionFrame((t) => this.#tick(t));
      else this.#settle();
    }

    #settle(): void {
      if (this.#state.open) {
        this.#paint();
        this.#verifyMeasure();
        return;
      }
      const list = this.#list!;
      this.#glass?.land();
      // The list's own toggle event fires here, once the growth has run back; aria-expanded turned false as it began.
      if (list.matches(':popover-open')) list.hidePopover();
      clearTimeout(this.#inertTimer);
      list.inert = false;
      list.removeAttribute('data-scroll');
      for (const name of Array.from(list.style)) if (name.startsWith('--vk-')) list.style.removeProperty(name);
      list.style.removeProperty('visibility');
      this.removeAttribute('data-phase');
      this.removeAttribute('data-sharp');
      this.removeAttribute('data-joined');
      this.removeAttribute('data-arrived');
      this.#unshine();
      this.#out = false;
      this.#held = null;
      this.#rest = null;
      this.#retarget = null;
      this.#homeAt = null;
      this.#slideAt = null;
      this.#tintAt = -1;
      this.#dest = null;
      this.#from = this.#to = this.#anchor = this.#region = null;
      this.#unclipTrigger();
      if (this.#sample) this.#glass?.setSample(this.#sample);
      this.#liveCarrier()?.setCarried?.(null);
      this.#anchorEl = null;
      this.#premeasureSoon();
    }

    /** The light that bleeds past a drop's edge: a blurred copy of its outline under the surface, which the surface's own clip path cannot draw. */
    #shine(box: RoundedRect, clip: string | null, amount: number): void {
      if (!clip) {
        if (this.#halo) this.#unshine();
        return;
      }
      if (!this.#halo) {
        const halo = document.createElement('span');
        halo.setAttribute('data-vk-halo', '');
        halo.setAttribute('aria-hidden', 'true');
        halo.append(document.createElement('i'));
        this.append(halo);
        this.#halo = halo;
      }
      const s = this.style;
      const px = (v: number) => `${v.toFixed(2)}px`;
      s.setProperty('--vk-halo-x', px(box.x));
      s.setProperty('--vk-halo-y', px(box.y));
      s.setProperty('--vk-halo-w', px(box.width));
      s.setProperty('--vk-halo-h', px(box.height));
      s.setProperty('--vk-halo-clip', clip);
      s.setProperty('--vk-halo-amount', amount.toFixed(3));
    }

    #unshine(): void {
      this.#halo?.remove();
      this.#halo = null;
      for (const name of Array.from(this.style)) if (name.startsWith('--vk-halo')) this.style.removeProperty(name);
    }

    /** The trigger's glyphs stay inside the body while it contracts: they are drawn under the surface, and would show beside it. */
    #clipTrigger(box: RoundedRect): void {
      const rect = this.#buttonRect;
      const el = this.#anchorButton();
      if (!rect || !el) return;
      if (this.#clip && this.#clip.el !== el) this.#unclipTrigger();
      const cut = {
        top: Math.max(box.y - rect.y, 0),
        left: Math.max(box.x - rect.x, 0),
        bottom: Math.max(rect.y + rect.height - (box.y + box.height), 0),
        right: Math.max(rect.x + rect.width - (box.x + box.width), 0),
      };
      if (cut.top + cut.left + cut.bottom + cut.right === 0) {
        this.#unclipTrigger();
        return;
      }
      this.#clip ??= { el, had: el.style.clipPath };
      const px = (v: number) => `${v.toFixed(1)}px`;
      el.style.clipPath = `inset(${px(cut.top)} ${px(cut.right)} ${px(cut.bottom)} ${px(cut.left)} round ${px(box.radius)})`;
    }

    #unclipTrigger(): void {
      if (!this.#clip) return;
      const { el, had } = this.#clip;
      this.#clip = null;
      if (had) el.style.clipPath = had;
      else {
        el.style.removeProperty('clip-path');
        if (el.getAttribute('style') === '') el.removeAttribute('style');
      }
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
      cancelMotionFrame(this.#frame);
      this.#frame = 0;
      this.#settle();
    }

    /**
     * Closing, the trigger takes its body back the frame the drop is the size of its capsule, and the drop leaves: the
     * glyph is then drawn on the trigger itself, out of focus as it was under the glass, and comes into focus together
     * with the focus ring, while the drop's slow tail still runs. It all ends before the motion does.
     */
    #closing(final: boolean, outgoing: number): { ink: number; ring: number; back: boolean } {
      if (this.#state.open || !this.#from) return { ink: outgoing, ring: 1, back: false };
      const now = performance.now();
      if (!final && (this.#slideAt === null || now - this.#slideAt < SLIDE_MS)) return { ink: outgoing, ring: 0, back: false };
      this.#homeAt ??= now;
      const k = final ? 1 : Math.min((now - this.#homeAt) / RING_MS, 1);
      return { ink: HAND_INK + (1 - HAND_INK) * k, ring: k, back: true };
    }

    /** Once the closing drop is the size of its trigger, whatever is left of the way to it is covered over a moment, so the trigger takes its body back from a drop that is where it is. */
    #slide(box: RoundedRect): RoundedRect {
      const home = this.#from!;
      const now = performance.now();
      if (this.#slideAt === null) {
        if (Math.max(Math.abs(box.width - home.width), Math.abs(box.height - home.height)) > 0.5) return box;
        this.#slideAt = now;
      }
      const e = smoothstep(0, 1, (now - this.#slideAt) / SLIDE_MS);
      const mix = (a: number, b: number) => a + (b - a) * e;
      return { x: mix(box.x, home.x), y: mix(box.y, home.y), width: mix(box.width, home.width), height: mix(box.height, home.height), radius: mix(box.radius, home.radius) };
    }

    /** The box the menu is drawn at: its place, or the way from the size it was drawn at to a size found stale while it is open. */
    #toNow(): RoundedRect {
      const to = this.#to!;
      const r = this.#retarget;
      if (!r) return to;
      const k = smoothstep(0, 1, (performance.now() - r.at) / RETARGET_MS);
      if (k >= 1) {
        this.#retarget = null;
        return to;
      }
      const mix = (a: number, b: number) => a + (b - a) * k;
      return { x: mix(r.from.x, to.x), y: mix(r.from.y, to.y), width: mix(r.from.width, to.width), height: mix(r.from.height, to.height), radius: mix(r.from.radius, to.radius) };
    }

    /** `final` is the motion's last frame: the lens gets what it rests on and lands in this frame. */
    #paint(final = false): void {
      const list = this.#list;
      if (!list || !this.#out || !this.#from || !this.#to || !this.#anchor) return;
      const phase = growthPhase(this.#growth);
      const to = this.#toNow();
      const f = menuSurfaceFrame(this.#from, to, this.#anchor, phase, this.#region ?? undefined, { outline: true });
      const settled = phase.shrink === 1 && phase.grow === 1 && (phase.focus ?? 1) === 1 && (phase.rise ?? 1) === 1;
      // The ink as drawn decides it, so what shows in focus is what can be chosen.
      const inkIn = f.ink.incoming >= CONTENT_SHARP ? 1 : Math.round(f.ink.incoming * 1000) / 1000;
      // A key may choose once the content is drawn; a pointer waits until it is in focus and the surface past its overshoot.
      if (this.#state.open && inkIn >= CONTENT_DRAWN) this.#inSince ??= performance.now();
      if (this.#state.open && inkIn >= 1 && this.#growth.grow.v <= 0) this.#readySince ??= performance.now();
      this.toggleAttribute('data-arrived', this.#readySince !== null);
      // The content is laid out in the box, not placed on a transform, from the frame it can no longer be told apart: switching in the last frame would change how its text is drawn after the motion.
      const near = this.#state.open && inkIn === 1 && [f.box.x - to.x, f.box.y - to.y, f.box.width - to.width, f.box.height - to.height].every((d) => Math.abs(d) <= LENS_SNAP_PX);
      this.setAttribute('data-phase', settled || near ? 'open' : 'moving');
      // Over the last pixel or two the box is where it lands: the text laid out in it would otherwise move by fractions of a pixel, which is seen as its edges changing.
      let box = near ? to : f.box;
      if (!this.#state.open && this.#from) box = this.#slide(box);
      const content = near ? { x: 0, y: 0 } : f.content;
      this.toggleAttribute('data-sharp', inkIn === 1);
      this.#setBox(box);
      const s = list.style;
      // The content rides inside the lens, magnified about the box's centre while it is out of focus.
      const scale = 1 + CONTENT_MAGNIFY * (1 - inkIn);
      // Once the content is in focus it sits on whole pixels, where the open menu lays it out: the tail of the spring moves it by fractions of one, which is seen as the text's edges changing.
      const place = (v: number) => (inkIn === 1 ? Math.round(v) : v);
      const { padding: pad, row } = menuSize(this.#size());
      s.setProperty('--vk-tx', `${place(box.width / 2 + scale * (content.x + pad - box.width / 2)).toFixed(2)}px`);
      s.setProperty('--vk-ty', `${place(box.height / 2 + scale * (content.y + pad - box.height / 2) - CONTENT_RISE * row * (1 - inkIn)).toFixed(2)}px`);
      s.setProperty('--vk-s', scale.toFixed(3));
      this.toggleAttribute('data-joined', f.outline !== undefined);
      const clip = f.outline ? `polygon(${f.outline.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',')})` : null;
      if (clip) s.setProperty('--vk-outline', clip);
      else s.removeProperty('--vk-outline');
      s.setProperty('--vk-ink-in', inkIn.toFixed(3));
      s.setProperty('--vk-lit', f.lit.toFixed(3));
      const halo = Math.min(f.activity + HALO_LIT * f.lit, 1) * (1 - f.capsule);
      s.setProperty('--vk-halo', halo.toFixed(3));
      this.#shine(box, clip, halo);
      const drop = menuBody(VIREGLASS_CONTROL_MATERIAL, f.activity, this.#presentation?.frost ?? false);
      // The drop is the trigger's body while it is its capsule, so the handover, going out and coming back, finds the same body.
      const rest = this.#rest?.body;
      const k = Math.min(Math.max(f.capsule, 0), 1);
      const body = rest ? { alpha: drop.alpha + (rest.alpha - drop.alpha) * k, white: drop.white + (rest.white - drop.white) * k, lift: drop.lift + (rest.lift - drop.lift) * k } : drop;
      s.setProperty('--vk-body-alpha', body.alpha.toFixed(3));
      s.setProperty('--vk-body-white', body.white.toFixed(3));
      s.setProperty('--vk-body-lift', body.lift.toFixed(3));
      const closing = this.#closing(final, f.ink.outgoing);
      list.style.visibility = closing.back ? 'hidden' : '';
      this.#liveCarrier()?.setCarried?.(closing.ink, closing.ring, closing.back);
      if (closing.back) this.#unclipTrigger();
      else this.#clipTrigger(box);
      // The lens lands once the picture can no longer be told from where it ends, and the tail of the springs runs on with nothing left to change in it.
      const landed = near && f.activity < ACTIVITY_AT_REST && this.#retarget === null;
      this.#tint(this.#state.open || !final ? f.capsule : 1);
      const moving = !final && !landed && !closing.back && (!settled || !this.#state.open || this.#retarget !== null) && this.#forced() === null;
      this.#pushGlass(box, f.morph, f.activity, f.capsule, moving, !this.#state.open && (final || closing.back), this.#state.open && f.capsule >= 0.95);
    }

    /** Hands the lens only what changed: a new morph or material rebuilds its filter, a moved box needs nothing. */
    #pushGlass(box: RoundedRect, morph: VireGlassMorph | undefined, activity: number, capsule: number, moving: boolean, closed: boolean, capsule1 = false): void {
      const glass = this.#glass;
      if (!glass) return;
      let lens = closed ? this.#closedLens() : this.#lensOf(box, morph, activity, capsule, moving);
      if (capsule1 && this.#rest) lens = { ...lens, material: this.#rest.material, materialKey: 'rest' };
      // The tail of the springs moves the box by a pixel or two over the last stretch: the lens is already at the box it is to land on, whose maps are ready, instead of asking for a map for each of those sizes.
      const dest = this.#dest;
      if (dest && Math.abs(lens.geometry.width - dest.width) <= LENS_SNAP_PX && Math.abs(lens.geometry.height - dest.height) <= LENS_SNAP_PX) lens = { ...lens, geometry: dest };
      const key = {
        material: lens.materialKey,
        morph: lens.morph ? JSON.stringify(lens.morph) : 'none',
        geometry: `${lens.geometry.width}x${lens.geometry.height}r${lens.geometry.cornerRadius}`,
      };
      moveGlass(glass, moving, () => {
        const last = this.#lastLens;
        if (key.material === last.material && key.morph === last.morph && key.geometry === last.geometry) return;
        const next: GlassFrame = {};
        if (key.geometry !== last.geometry) next.geometry = lens.geometry;
        if (key.material !== last.material) next.material = lens.material;
        // A morph never sent needs no null to take it away; sent, it costs the lens an interim map.
        if (key.morph !== last.morph && !(lens.morph === null && last.morph === '')) next.morph = lens.morph;
        this.#lastLens = key;
        glass.frame(next);
      });
    }

    #lensOf(box: RoundedRect, morph: VireGlassMorph | undefined, activity: number, capsule: number, moving: boolean): Lens {
      // Whole pixels, so a repeated open finds its displacement maps in the core's cache.
      const round = Math.round;
      const step = activity < ACTIVITY_AT_REST ? 0 : round(Math.min(activity, 1) * MATERIAL_STEPS) / MATERIAL_STEPS;
      const cap = round(capsule * MATERIAL_STEPS);
      return {
        geometry: { width: round(box.width), height: round(box.height), cornerRadius: round(box.radius) },
        morph: glassMorph(morph, moving),
        material: menuMaterial(VIREGLASS_CONTROL_MATERIAL, step, cap / MATERIAL_STEPS),
        materialKey: `${step}/${cap}`,
      };
    }

    /** The lens's colours follow the motion: the trigger's backdrop while the drop is its capsule, the menu's while it is the menu, and between them as far as it has become either. */
    #tint(capsule: number): void {
      const glass = this.#glass;
      const rest = this.#rest?.sample;
      const held = this.#held;
      if (!glass || !rest || !held || this.#sample) return;
      const k = Math.round(Math.min(Math.max(capsule, 0), 1) * 20) / 20;
      if (k === this.#tintAt) return;
      this.#tintAt = k;
      const mix = (key: keyof BackdropSample) => held[key] + (rest[key] - held[key]) * k;
      glass.setSample(k === 0 ? held : k === 1 ? rest : { luma: mix('luma'), busy: mix('busy'), lo: mix('lo'), hi: mix('hi'), r: mix('r'), g: mix('g'), b: mix('b') });
    }

    /** What the drop ends as when it closes: the trigger's own lens, or the growth's closed frame when the trigger has none. */
    #closedLens(): Lens & { sample: BackdropSample | null } {
      const rest = this.#rest;
      if (rest) return { geometry: rest.geometry, morph: null, material: rest.material, materialKey: 'rest', sample: rest.sample };
      const f = menuSurfaceFrame(this.#from!, this.#to!, this.#anchor!, growthPhase(heldGrowthState(0)), this.#region ?? undefined, { outline: true });
      return { ...this.#lensOf(f.box, f.morph, f.activity, f.capsule, false), sample: this.#held ?? this.#sample };
    }

    /** Tells the lens where the motion that is starting ends, so its maps and colours are ready by the last frame. */
    #prepareDestination(motion = false): void {
      const glass = this.#glass;
      if (!glass || !this.#out || !this.#from || !this.#to || !this.#anchor) return;
      // The colours start easing to the destination's backdrop only for a lens that is moving.
      if (motion) glass.setInterim(true);
      if (this.#state.open) {
        const f = menuSurfaceFrame(this.#from, this.#to, this.#anchor, growthPhase(heldGrowthState(1)), this.#region ?? undefined, { outline: true });
        const l = this.#lensOf(f.box, f.morph, f.activity, f.capsule, false);
        const sample = this.#held ?? this.#sample;
        this.#dest = l.geometry;
        glass.prepare({ geometry: l.geometry, morph: l.morph, material: l.material, ...(sample ? { sample } : {}) });
      } else {
        const l = this.#closedLens();
        this.#dest = l.geometry;
        glass.prepare({ geometry: l.geometry, morph: null, material: l.material, ...(l.sample ? { sample: l.sample } : {}) });
      }
    }

    /** While the page is idle: the open box with its maps and the backdrop behind it, so the first open lands on a pair that is already built. */
    #prepareIdle(): void {
      const glass = this.#glass;
      const natural = this.#natural;
      if (!glass || !natural || this.#out || !this.#list?.isConnected) return;
      const { trigger, region, placement } = this.#layout(natural);
      const to = wholePixels(placement.rect, menuSize(this.#size()).radius);
      const f = menuSurfaceFrame(trigger, to, placement.anchor, growthPhase(heldGrowthState(1)), region, { outline: true });
      const l = this.#lensOf(f.box, f.morph, f.activity, f.capsule, false);
      glass.prepare({ geometry: l.geometry, morph: l.morph, material: l.material, rect: { left: f.box.x, top: f.box.y, width: f.box.width, height: f.box.height } });
    }

    #forced(): string | null {
      const wanted = this.getAttribute(FORCE_ATTRIBUTE);
      return wanted !== null && (Object.hasOwn(FORCED, wanted) || FORCED_PHASE.test(wanted)) ? wanted : null;
    }

    #applyForced(): void {
      const forced = this.#forced();
      const [shrink, grow, focus, rise, glow, tall] = (forced ?? '').split(' ').map(Number);
      const phase: GrowthPhase | null = !forced
        ? null
        : Object.hasOwn(FORCED, forced)
          ? FORCED[forced]!
          : {
            shrink: shrink!,
            grow: grow!,
            ...(focus === undefined ? {} : { focus }),
            ...(rise === undefined ? {} : { rise }),
            ...(glow === undefined ? {} : { glow }),
            ...(tall === undefined ? {} : { height: tall }),
          };
      cancelMotionFrame(this.#frame);
      this.#frame = 0;
      if (!phase) {
        this.#state = MENU_CLOSED;
        this.#growth = createGrowthState();
        this.#trigger!.setAttribute('aria-expanded', 'false');
        if (this.#out) this.#settle();
        return;
      }
      this.#state = { ...MENU_CLOSED, open: forced !== 'retracting' };
      const focus1 = phase.focus ?? smoothstep(0.9, 1, phase.grow);
      const rise1 = phase.rise ?? Math.min(Math.max(phase.grow, 0), 1);
      this.#growth = {
        shrink: { x: phase.shrink, v: 0, target: phase.shrink },
        grow: { x: phase.grow, v: 0, target: phase.grow },
        height: { x: phase.height ?? phase.grow, v: 0, target: phase.height ?? phase.grow },
        focus: { x: focus1, v: 0, target: focus1 },
        rise: { x: rise1, v: 0, target: rise1 },
        glow: { x: phase.glow ?? phase.shrink, v: 0, target: phase.glow ?? phase.shrink },
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
      this.#natural = null;
      this.#premeasured = false;
      if (this.#out) this.#replace();
      else this.#premeasureSoon();
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
          if (this.#out) {
            this.#holdSample();
            this.#prepareDestination();
          } else this.#prepareIdle();
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

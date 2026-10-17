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
  type Rect,
  type RoundedRect,
} from '../kit/menu';
import { createGrowthState, growthPhase, stepGrowth, type GrowthPhase, type GrowthPoint } from '../kit/morph';
import { CONTROL_SIZES, defaultSize, menuSize, type ControlSize } from '../kit/sizes';
import { effectiveA11y, watchA11yOverride, watchSystemA11y } from './a11y';
import { attachControlGlass, type GlassSession } from './glass';
import { isCoarsePointer, watchCoarsePointer } from './input';
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
const MATERIAL_STEPS = 10;
const VIEWPORT_MARGIN = 8;
const TRIGGER = ':scope > button, :scope > vire-button > button, :scope > vire-icon-button > button';

type Carrier = HTMLElement & { setCarried?: (ink: number | null) => void };

export interface VireMenuElement extends HTMLElement {
  a11y: A11yOverride;
  sample: BackdropSample | null;
  readonly open: boolean;
}

export type MenuElementOptions = { nonce?: string | undefined };

let ids = 0;

export function createMenuElementClass(options: MenuElementOptions = {}) {
  return class VireMenu extends HTMLElement implements VireMenuElement {
    static observedAttributes = ['glass', 'size', 'corner', FORCE_ATTRIBUTE];

    #trigger: HTMLButtonElement | null = null;
    #carrier: Carrier | null = null;
    #list: HTMLElement | null = null;
    #adopted = new WeakSet<Element>();
    #restore: (() => void)[] = [];
    #cleanups: (() => void)[] = [];
    #state: MenuState = MENU_CLOSED;
    #growth = createGrowthState();
    #from: RoundedRect | null = null;
    #to: RoundedRect | null = null;
    #anchor: GrowthPoint | null = null;
    #out = false;
    #viaPointer = false;
    #frame = 0;
    #lastFrame = 0;
    #own: A11yOverride = {};
    #mode: A11yMode | null = null;
    #presentation: Presentation | null = null;
    #glass: GlassSession | null = null;
    #glassToken = 0;
    #glassKey = '';
    #glassBroken = false;
    #lastMaterialKey = '';
    #sample: BackdropSample | null = null;
    #held: BackdropSample | null = null;

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

    connectedCallback(): void {
      for (const key of ['a11y', 'sample']) {
        if (!Object.prototype.hasOwnProperty.call(this, key)) continue;
        const value: unknown = Reflect.get(this, key);
        Reflect.deleteProperty(this, key);
        Reflect.set(this, key, value);
      }
      ensureStyles(this, options.nonce);
      this.#cleanups.push(watchCoarsePointer(() => this.#list && this.#refreshMode(true)));
      this.#cleanups.push(watchSystemA11y(() => this.#list && this.#refreshMode()));
      this.#cleanups.push(watchA11yOverride(() => this.#list && this.#refreshMode()));
      this.#awaitParts();
    }

    disconnectedCallback(): void {
      for (const cleanup of this.#cleanups.splice(0)) cleanup();
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#dropGlass();
      const list = this.#list;
      if (list) {
        if (list.matches(':popover-open')) list.hidePopover();
        list.inert = false;
        for (const name of Array.from(list.style)) if (name.startsWith('--vk-')) list.style.removeProperty(name);
        for (const item of this.#items()) item.removeAttribute('data-pressed');
      }
      this.#carrier?.setCarried?.(null);
      for (const restore of this.#restore.splice(0).reverse()) restore();
      this.#adopted = new WeakSet();
      this.#trigger = null;
      this.#carrier = null;
      this.#list = null;
      this.#state = MENU_CLOSED;
      this.#growth = createGrowthState();
      this.#out = false;
      this.#from = this.#to = this.#anchor = null;
      this.#held = null;
      for (const name of ['data-vk', 'data-surface', 'data-glass', 'data-frost', 'data-contrast', 'data-size', 'data-phase']) {
        this.removeAttribute(name);
      }
      for (const name of Array.from(this.style)) if (name.startsWith('--vk-')) this.style.removeProperty(name);
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

    #keep(el: Element, name: string, value: string | null): void {
      const was = el.getAttribute(name);
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
      this.#restore.push(() => (was === null ? el.removeAttribute(name) : el.setAttribute(name, was)));
    }

    #upgrade(trigger: HTMLButtonElement, list: HTMLElement): void {
      this.#trigger = trigger;
      this.#list = list;
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
      const items = new MutationObserver(() => {
        this.#adoptItems();
        if (this.#out) this.#place();
      });
      items.observe(list, { childList: true });
      this.#cleanups.push(() => items.disconnect());
      this.#listen(trigger, list);
      this.#mode = null;
      this.#refreshMode();
      if (this.#forced()) this.#applyForced();
      else if (wasOpen) this.#show('menu');
    }

    #adoptItems(): void {
      for (const item of this.#items()) {
        if (this.#adopted.has(item)) continue;
        this.#adopted.add(item);
        this.#keep(item, 'popovertarget', null);
        this.#keep(item, 'popovertargetaction', null);
        this.#keep(item, 'role', 'menuitem');
        this.#keep(item, 'tabindex', '-1');
      }
    }

    #items(): HTMLButtonElement[] {
      return this.#list ? Array.from(this.#list.querySelectorAll<HTMLButtonElement>(':scope > button')) : [];
    }

    #model(): MenuItem[] {
      return this.#items().map((item) => ({
        label: item.getAttribute('aria-label') ?? item.textContent ?? '',
        disabled: item.disabled,
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
      const inside = (path: EventTarget[], ...nodes: (Node | null)[]) => nodes.some((n) => n !== null && path.includes(n));

      on<PointerEvent>(this.#carrier ?? trigger, 'pointerdown', () => (this.#viaPointer = true));
      on<KeyboardEvent>(trigger, 'keydown', (e) => {
        this.#viaPointer = false;
        if (this.#forced()) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          this.#show(e.key === 'ArrowDown' ? 'first' : 'last');
        } else if (e.key === 'Escape' && this.#state.open) {
          e.preventDefault();
          this.#close({ type: 'dismiss', reason: 'escape' });
        }
      });
      on<MouseEvent>(trigger, 'click', () => {
        if (this.#forced()) return;
        if (this.#state.open) this.#close({ type: 'dismiss', reason: 'trigger' });
        else this.#show(this.#viaPointer ? 'menu' : 'first');
        this.#viaPointer = false;
      });

      on<KeyboardEvent>(list, 'keydown', (e) => {
        if (!this.#state.open || this.#forced()) return;
        const move = { ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last' } as const;
        if (e.key in move) {
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
        } else if ((e.key === ' ' || e.key === 'Enter') && itemOf(e.target)) {
          itemOf(e.target)!.setAttribute('data-pressed', '');
        }
      });
      on<KeyboardEvent>(list, 'keyup', (e) => itemOf(e.target)?.removeAttribute('data-pressed'));
      on<MouseEvent>(list, 'click', (e) => {
        const item = itemOf(e.target);
        if (!item || !this.#state.open || this.#forced()) return;
        this.#close({ type: 'choose', index: this.#items().indexOf(item) });
      });
      on<PointerEvent>(list, 'pointermove', (e) => {
        const item = itemOf(e.target);
        if (item && this.#state.open && !this.#forced()) this.#step({ type: 'point', index: this.#items().indexOf(item) });
      });
      on<PointerEvent>(list, 'pointerdown', (e) => {
        if (e.button === 0 && !this.#forced()) itemOf(e.target)?.setAttribute('data-pressed', '');
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
      on<PointerEvent>(
        document,
        'pointerdown',
        (e) => {
          if (!this.#state.open || this.#forced()) return;
          if (inside(e.composedPath(), list, trigger, this.#carrier)) return;
          this.#close({ type: 'dismiss', reason: 'outside' });
        },
        true,
      );
      const follow = (e: Event) => {
        if (this.#out && !(e.target instanceof Node && list.contains(e.target))) this.#place();
      };
      on(window, 'resize', follow);
      on(document, 'scroll', follow, true);
      // A trigger inside an element that upgrades after this one changes size under the menu.
      if (typeof ResizeObserver !== 'undefined') {
        const resized = new ResizeObserver(() => this.#out && this.#place());
        resized.observe(this.#carrier ?? trigger);
        this.#cleanups.push(() => resized.disconnect());
      }
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
      else if (focus.to === 'trigger') this.#trigger!.focus({ preventScroll: true });
      else if (focus.to === 'none') {
        const active = document.activeElement;
        if (active instanceof HTMLElement && list.contains(active)) active.blur();
      }
    }

    #show(focus: 'menu' | 'first' | 'last'): void {
      const list = this.#list!;
      const step = stepMenu(this.#state, { type: 'open', focus }, this.#model());
      this.#state = step.state;
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
      this.#trigger!.setAttribute('aria-expanded', 'false');
      for (const item of this.#items()) item.removeAttribute('data-pressed');
      this.#list!.inert = true;
      this.#run();
    }

    #comeOut(): void {
      const list = this.#list!;
      const wasOut = this.#out;
      if (!list.matches(':popover-open')) list.showPopover();
      this.#out = true;
      this.#place();
      if (wasOut) return;
      this.#carrier?.setCarried?.(1);
      this.#holdSample();
    }

    #triggerBox(): RoundedRect {
      const trigger = this.#trigger!;
      // The host's box is the unscaled one; a pressed button is still growing when the menu opens.
      const r = (this.#carrier ?? trigger).getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(trigger).borderTopLeftRadius) || 0;
      return { x: r.x, y: r.y, width: r.width, height: r.height, radius: Math.min(radius, r.width / 2, r.height / 2) };
    }

    #corner(): MenuCorner | undefined {
      const wanted = this.getAttribute('corner');
      return wanted && Object.hasOwn(MENU_CORNERS, wanted) ? MENU_CORNERS[wanted as keyof typeof MENU_CORNERS] : undefined;
    }

    #place(): void {
      const list = this.#list!;
      const spec = menuSize(this.#size());
      this.setAttribute('data-measure', '');
      const natural = { width: list.offsetWidth, height: list.offsetHeight };
      this.removeAttribute('data-measure');
      const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
      const trigger = this.#triggerBox();
      const placement = menuPlacement(trigger, natural, viewport, { corner: this.#corner(), margin: VIEWPORT_MARGIN });
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
      if (list.matches(':popover-open')) list.hidePopover();
      list.inert = false;
      for (const name of Array.from(list.style)) if (name.startsWith('--vk-')) list.style.removeProperty(name);
      this.removeAttribute('data-phase');
      this.#out = false;
      this.#held = null;
      this.#from = this.#to = this.#anchor = null;
      this.#glass?.frame({ morph: null });
      this.#glass?.setSample(this.#sample);
      this.#carrier?.setCarried?.(null);
    }

    #paint(): void {
      const list = this.#list;
      if (!list || !this.#out || !this.#from || !this.#to || !this.#anchor) return;
      const phase = growthPhase(this.#growth);
      const f = menuSurfaceFrame(this.#from, this.#to, this.#anchor, phase);
      const settled = phase.shrink === 1 && phase.grow === 1;
      this.setAttribute('data-phase', settled ? 'open' : 'moving');
      this.#setBox(f.box);
      const s = list.style;
      s.setProperty('--vk-cx', `${f.content.x.toFixed(2)}px`);
      s.setProperty('--vk-cy', `${f.content.y.toFixed(2)}px`);
      s.setProperty('--vk-ink-in', f.ink.incoming.toFixed(3));
      const body = menuBody(VIREGLASS_CONTROL_MATERIAL, f.activity, this.#presentation?.frost ?? false);
      s.setProperty('--vk-body-alpha', body.alpha.toFixed(3));
      s.setProperty('--vk-body-white', body.white.toFixed(3));
      s.setProperty('--vk-body-lift', body.lift.toFixed(3));
      this.#carrier?.setCarried?.(f.ink.outgoing);
      this.#pushGlass(f.box, f.morph, f.activity);
    }

    #pushGlass(box: RoundedRect, morph: VireGlassMorph | undefined, activity: number): void {
      const glass = this.#glass;
      if (!glass) return;
      // Whole pixels, so a repeated open finds its displacement maps in the core's cache.
      const round = Math.round;
      const step = Math.round(Math.min(Math.max(activity, 0), 1) * MATERIAL_STEPS) / MATERIAL_STEPS;
      const key = `${step}`;
      const lens: GlassMorph | null = morph
        ? {
            smoothing: round(morph.smoothing),
            shape: {
              offsetX: round(morph.offsetX),
              offsetY: round(morph.offsetY),
              width: round(morph.width),
              height: round(morph.height),
              cornerRadius: round(morph.cornerRadius),
            },
          }
        : null;
      const next: Parameters<GlassSession['frame']>[0] = {
        geometry: { width: round(box.width), height: round(box.height), cornerRadius: round(box.radius) },
        morph: lens,
      };
      if (key !== this.#lastMaterialKey) {
        this.#lastMaterialKey = key;
        next.material = menuMaterial(VIREGLASS_CONTROL_MATERIAL, step);
      }
      glass.frame(next);
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
      return defaultSize({ touch: isCoarsePointer() });
    }

    #wantsGlass(): boolean {
      return this.hasAttribute('glass');
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
      if (this.#out) this.#place();
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
      this.#lastMaterialKey = '';
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
          this.#lastMaterialKey = '';
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

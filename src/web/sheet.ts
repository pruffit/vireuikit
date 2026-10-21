import { VIREGLASS_CONTROL_MATERIAL, type BackdropSample, type VireGlassMorph } from 'vireglass';
import type { GlassMorph } from 'vireglass/dom';
import { presentationFor, sameA11y, type A11yMode, type A11yOverride, type Presentation } from '../kit/a11y';
import type { AdaptiveContext } from '../kit/adaptive/context';
import {
  createFormMorph,
  formMorphFrame,
  rebaseFormMorph,
  stepFormMorph,
  type FormMorphState,
  type MorphBox,
} from '../kit/adaptive/form-morph';
import { presentationForm, type PresentationForm, type SurfaceKind } from '../kit/adaptive/presentation';
import type { Rect, Size } from '../kit/geometry';
import { menuBody, menuMaterial, type RoundedRect } from '../kit/menu';
import { createGrowthState, growthPhase, heldGrowthState, smoothstep, stepGrowth, type GrowthPoint } from '../kit/morph';
import {
  POPOVER_GROWTH_TIMING,
  SHEET_SIZES,
  createSheetDrag,
  createSheetGrowth,
  cancelSheetDrag,
  defaultSheetDetents,
  moveSheetDrag,
  namedSheetDetents,
  popoverGrowthFrame,
  popoverPlacement,
  pressSheetDrag,
  releaseSheetDrag,
  parseDetentLabels,
  scrimCloses,
  sheetClipBottom,
  sheetContentDrag,
  sheetEntryFrame,
  sheetForKeyboard,
  sheetGrowthFrame,
  sheetLayout,
  sheetPeekContent,
  sheetTouchAction,
  sheetUsesGlass,
  surfaceInk,
  stepSheetGrowth,
  stepSheetHeight,
  type NamedSheetDetent,
  type SheetDetent,
  type SheetLayout,
} from '../kit/sheet';
import { effectiveA11y, watchA11yOverride, watchSystemA11y } from './a11y';
import { deepActive, dropEmptyStyle, rootsOf } from './dom';
import { SHEET_INSET_EVENT, SHEET_INSET_PROPERTY, isEditable, shellOf, watchAdaptiveContext, windowRect } from './environment';
import { attachControlGlass, ensureGlass, glassLoaded, glassMorph, holdGlass, landGlass, moveGlass, probeRect, type GlassFrame, type GlassSession } from './glass';
import { createScrollEdge, type ScrollEdge } from './scroll-edge';
import { ensureStyles } from './styles';

const FORCE_ATTRIBUTE = 'data-vire-force-state';
const GLASS_ON = new Set(['', 'present', 'touch']);
const MATERIAL_STEPS = 10;
const DRAG_SLOP = 4;
const DETENTS: readonly SheetDetent[] = ['peek', 'medium', 'large'];
const SHEET_KINDS: readonly SurfaceKind[] = ['sheet', 'modal-sheet', 'picker', 'dialog', 'alert'];
const SWALLOW_MS = 600;
const WIDGET =
  'button, a[href], input, select, textarea, summary, [contenteditable]:not([contenteditable=false]), ' +
  ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'textbox', 'combobox', 'searchbox']
    .map((role) => `[role=${role}]`)
    .join(', ');

type Carrier = HTMLElement & { setCarried?: (ink: number | null) => void };
type Forced = { kind: 'open'; detent: SheetDetent | null } | { kind: 'grow'; t: number };
type CommandLike = Event & { command: string; source: Element | null };
type Shown = { box: MorphBox; opacity: number; scrim: number };
type Lifted = { action: string; restore: () => void };

export interface VireSurfaceElement extends HTMLElement {
  a11y: A11yOverride;
  sample: BackdropSample | null;
  /** The bottom sheet's current detent; setting it moves the sheet there. */
  detent: string;
  readonly open: boolean;
  /** The box the surface grows from and returns into instead of its trigger; cleared once it has closed. */
  anchor: Element | null;
  /** Runs the growth back into `el` and closes; `null` closes at once, for an anchor that is gone. */
  retractInto(el: Element | null): void;
  /** Puts the surface back on its anchor; a host that moves the trigger calls it. */
  follow(): void;
}
export type VirePopoverElement = VireSurfaceElement;
export type VireSheetElement = VireSurfaceElement;

export type SurfaceElementOptions = { nonce?: string | undefined };

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const px = (v: number) => `${v.toFixed(2)}px`;

function parseForced(value: string | null): Forced | null {
  if (!value) return null;
  if (value === 'open') return { kind: 'open', detent: null };
  const detent = /^open:(peek|medium|large)$/.exec(value);
  if (detent) return { kind: 'open', detent: detent[1] as SheetDetent };
  const grow = /^grow:(\d*\.?\d+)$/.exec(value);
  return grow ? { kind: 'grow', t: Math.min(Number(grow[1]), 1.2) } : null;
}

type InsetRegistry = { owners: Map<object, number>; was: string; hadStyle: boolean; value: string };
const insets = new WeakMap<Element, InsetRegistry>();

function announceInset(shell: Element, inset: number): void {
  shell.dispatchEvent(new CustomEvent(SHEET_INSET_EVENT, { bubbles: true, detail: { inset } }));
}

function settleInset(shell: HTMLElement, registry: InsetRegistry): void {
  const widest = Math.max(0, ...registry.owners.values());
  if (widest > 0) {
    const value = `${widest}px`;
    if (value === registry.value) return;
    registry.value = value;
    shell.style.setProperty(SHEET_INSET_PROPERTY, value);
    announceInset(shell, widest);
    return;
  }
  insets.delete(shell);
  if (registry.was) shell.style.setProperty(SHEET_INSET_PROPERTY, registry.was);
  else shell.style.removeProperty(SHEET_INSET_PROPERTY);
  dropEmptyStyle(shell, registry.hadStyle);
  if (registry.value) announceInset(shell, parseFloat(registry.was) || 0);
}

/** A shell carries the widest inset of the side sheets open in it; the last one to go gives back what the shell had. */
function setInset(shell: Element, owner: object, inset: number): void {
  const target = shell as HTMLElement;
  let registry = insets.get(target);
  if (inset <= 0) {
    if (registry?.owners.delete(owner)) settleInset(target, registry);
    return;
  }
  if (!registry) {
    registry = { owners: new Map(), was: target.style.getPropertyValue(SHEET_INSET_PROPERTY), hadStyle: target.hasAttribute('style'), value: '' };
    insets.set(target, registry);
  }
  if (registry.owners.get(owner) === inset) return;
  registry.owners.set(owner, inset);
  settleInset(target, registry);
}

export function createSurfaceElementClass(tag: 'popover' | 'sheet', options: SurfaceElementOptions = {}) {
  return class VireSurface extends HTMLElement implements VireSurfaceElement {
    static observedAttributes = ['glass', 'kind', 'detents', 'detent', 'persistent', 'grabber-label', 'detent-labels', 'scroll-edge', FORCE_ATTRIBUTE];

    #surface: HTMLElement | null = null;
    #dialog: HTMLDialogElement | null = null;
    #grabber: HTMLElement | null = null;
    #edge: ScrollEdge | null = null;
    #cleanups: (() => void)[] = [];
    #restore: (() => void)[] = [];
    #lifted = new Map<HTMLButtonElement, Lifted>();
    #hadStyle = { host: false, surface: false };
    #hadDetent: string | null = null;
    #shell: Element | null = null;
    #ctx: AdaptiveContext | null = null;
    #origin: Rect = { x: 0, y: 0, width: 0, height: 0 };
    #own: A11yOverride = {};
    #mode: A11yMode | null = null;
    #presentation: Presentation | null = null;
    #opaque = false;
    #glass: GlassSession | null = null;
    #glassToken = 0;
    #glassKey = '';
    #glassBroken = false;
    #lastLens = { material: '', morph: '', geometry: '' };
    #sample: BackdropSample | null = null;
    #held: BackdropSample | null = null;
    #probed: BackdropSample | null = null;
    #probe: HTMLElement | null = null;
    #safeBottom = 0;
    #canvasLuma: number | null = null;

    #open = false;
    #out = false;
    #showing = false;
    #hiding = false;
    #reflecting = false;
    #swallow = false;
    #swallowTimer = 0;
    #envDirty = false;
    #forcedWaited = false;
    #focused = false;
    #pg = createGrowthState();
    #sg = createSheetGrowth();
    #morph: { state: FormMorphState; from: Shown } | null = null;
    #shown: Shown | null = null;
    #form: PresentationForm | null = null;
    #layout: SheetLayout | null = null;
    #anchor: GrowthPoint | null = null;
    #content: Size = { width: 0, height: 0 };
    #contentKey = '';
    #maxContent: number | null = null;
    #detents: NamedSheetDetent[] = [];
    #grabKey = '';
    #scrollTop = 0;
    #touchTop: number | null = null;
    #sizes = new Map<Element, string>();
    #resizer: ResizeObserver | null = null;
    #contentShown = false;
    #detent: SheetDetent | null = null;
    #drag = createSheetDrag();
    #press: { id: number; y: number; grab: boolean; started: boolean; scroller: Element | null } | null = null;
    #lastMove = 0;
    #kb: { restore: number; moved: boolean; lift: number } | null = null;
    #source: HTMLButtonElement | null = null;
    #sourceLocal: RoundedRect | null = null;
    #anchorEl: Element | null = null;
    #touch = '';
    #frame = 0;
    #followFrame = 0;
    #lastFrame = 0;
    #forcedState: Forced | null = null;

    get a11y(): A11yOverride {
      return this.#own;
    }

    set a11y(next: A11yOverride) {
      this.#own = { ...next };
      if (this.#surface) this.#refreshMode();
    }

    get sample(): BackdropSample | null {
      return this.#sample;
    }

    set sample(next: BackdropSample | null) {
      this.#sample = next;
      if (this.#out) this.#probed = this.#backdrop();
      if (!this.#glass) return;
      if (this.#out) this.#holdSample();
      else this.#glass.setSample(next);
    }

    get open(): boolean {
      return this.#open;
    }

    get anchor(): Element | null {
      return this.#anchorEl;
    }

    set anchor(next: Element | null) {
      if (next === this.#anchorEl) return;
      if (this.#out) this.#setCarried(null);
      this.#anchorEl = next;
      if (!this.#out) return;
      this.#place();
      this.#run();
    }

    retractInto(el: Element | null): void {
      if (!this.#out || !this.#surface) return;
      if (el === null) {
        this.#open = false;
        this.#settle();
        return;
      }
      this.anchor = el;
      this.#close();
    }

    follow(): void {
      this.#follow();
    }

    get detent(): string {
      return this.#detent ?? this.getAttribute('detent') ?? '';
    }

    set detent(name: string) {
      this.setAttribute('detent', name);
    }

    connectedCallback(): void {
      for (const key of ['a11y', 'sample', 'detent']) {
        if (!Object.prototype.hasOwnProperty.call(this, key)) continue;
        const value: unknown = Reflect.get(this, key);
        Reflect.deleteProperty(this, key);
        Reflect.set(this, key, value);
      }
      this.#hadStyle.host = this.hasAttribute('style');
      this.#hadDetent = this.getAttribute('detent');
      ensureStyles(this, options.nonce);
      this.#cleanups.push(watchSystemA11y(() => this.#surface && this.#refreshMode()));
      this.#cleanups.push(watchA11yOverride(() => this.#surface && this.#refreshMode()));
      this.#awaitParts();
    }

    disconnectedCallback(): void {
      for (const cleanup of this.#cleanups.splice(0)) cleanup();
      cancelAnimationFrame(this.#frame);
      cancelAnimationFrame(this.#followFrame);
      this.#frame = this.#followFrame = 0;
      this.#dropGlass();
      const surface = this.#surface;
      this.#setCarried(null);
      this.#clearInset();
      if (surface) {
        this.#hiding = true;
        if (this.#dialog?.open) this.#dialog.close();
        else if (surface.matches(':popover-open')) surface.hidePopover();
        this.#hiding = false;
        this.#grabber?.remove();
        this.#edge?.destroy();
        for (const name of ['data-form', 'data-scrim', 'data-vk-touch']) surface.removeAttribute(name);
        for (const name of Array.from(surface.style)) if (name.startsWith('--vk-')) surface.style.removeProperty(name);
      }
      for (const lifted of this.#lifted.values()) lifted.restore();
      this.#lifted.clear();
      for (const restore of this.#restore.splice(0).reverse()) restore();
      if (surface) dropEmptyStyle(surface, this.#hadStyle.surface);
      for (const name of ['data-vk', 'data-kind', 'data-form', 'data-surface', 'data-glass', 'data-frost', 'data-contrast', 'data-ink', 'data-phase', 'data-height', 'data-measure']) {
        this.removeAttribute(name);
      }
      for (const name of Array.from(this.style)) if (name.startsWith('--vk-')) this.style.removeProperty(name);
      dropEmptyStyle(this, this.#hadStyle.host);
      this.#surface = this.#dialog = this.#grabber = this.#shell = this.#ctx = this.#edge = null;
      this.#open = this.#out = this.#focused = false;
      this.#pg = createGrowthState();
      this.#sg = createSheetGrowth();
      this.#morph = this.#shown = this.#form = this.#layout = this.#anchor = null;
      this.#sourceLocal = this.#source = this.#anchorEl = null;
      this.#contentKey = '';
      this.#maxContent = null;
      this.#detents = [];
      this.#detent = null;
      this.#drag = createSheetDrag();
      this.#press = null;
      this.#kb = null;
      this.#held = null;
      this.#touch = '';
      this.#presentation = null;
      this.#mode = null;
      this.#forcedState = null;
      this.#forcedWaited = false;
      this.#grabKey = '';
      this.#scrollTop = 0;
      this.#touchTop = null;
      this.#envDirty = false;
      this.#contentShown = false;
      // Last, with the surface gone: the attribute change finds nothing to follow and cannot reflect a detent back.
      if (this.#hadDetent === null) this.removeAttribute('detent');
      else this.setAttribute('detent', this.#hadDetent);
    }

    attributeChangedCallback(name: string): void {
      if (name === FORCE_ATTRIBUTE) this.#forcedState = parseForced(this.getAttribute(name));
      if (!this.#surface) return;
      if (name === FORCE_ATTRIBUTE) this.#applyForced();
      else if (name === 'glass') this.#refreshMode(true);
      else if (name === 'detent') this.#reflecting || this.#setDetent(this.getAttribute('detent'), true);
      else if (name === 'grabber-label' || name === 'detent-labels') this.#syncGrabber();
      else if (name === 'scroll-edge') this.#syncEdge();
      else {
        if (name === 'kind' && this.getAttribute('data-kind') !== this.#kind()) this.setAttribute('data-kind', this.#kind());
        if (this.#out) this.#remeasure();
      }
    }

    #awaitParts(): void {
      if (this.#tryUpgrade()) return;
      const observer = new MutationObserver(() => {
        if (this.#tryUpgrade()) observer.disconnect();
      });
      observer.observe(this, { childList: true, subtree: true });
      this.#cleanups.push(() => observer.disconnect());
    }

    #tryUpgrade(): boolean {
      const surface = this.querySelector<HTMLElement>(tag === 'popover' ? ':scope > [popover]' : ':scope > dialog, :scope > [popover]');
      if (!surface) return false;
      this.#upgrade(surface);
      return true;
    }

    #keep(el: Element, name: string, value: string | null, into: (() => void)[] = this.#restore): void {
      const was = el.getAttribute(name);
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
      into.push(() => (was === null ? el.removeAttribute(name) : el.setAttribute(name, was)));
    }

    #kind(): SurfaceKind {
      if (tag === 'popover') return 'popover';
      const wanted = this.getAttribute('kind') as SurfaceKind | null;
      if (wanted && SHEET_KINDS.includes(wanted)) return wanted;
      return this.#dialog ? 'modal-sheet' : 'sheet';
    }

    #persistent(): boolean {
      return this.hasAttribute('persistent');
    }

    #upgrade(surface: HTMLElement): void {
      this.#surface = surface;
      this.#dialog = surface instanceof HTMLDialogElement ? surface : null;
      this.#hadStyle.surface = surface.hasAttribute('style');
      this.#shell = shellOf(this);
      const wasOpen = this.#dialog ? this.#dialog.matches(':modal') : surface.matches(':popover-open');
      this.setAttribute('data-vk', '');
      this.setAttribute('data-kind', this.#kind());
      if (!this.#dialog) this.#keep(surface, 'popover', 'manual');

      const s = surface.style;
      const g = SHEET_SIZES.grabber;
      s.setProperty('--vk-grab-hit', px(g.hit));
      s.setProperty('--vk-grab-w', px(g.width));
      s.setProperty('--vk-grab-h', px(g.height));
      s.setProperty('--vk-grab-top', px(g.top));
      s.setProperty('--vk-pad', px(SHEET_SIZES.content.pad));
      s.setProperty('--vk-pad-t', px(SHEET_SIZES.content.pad));

      this.#grabber = this.#makeGrabber();
      surface.prepend(this.#grabber);
      const grabber = this.#grabber;
      this.#edge = createScrollEdge(surface, 'sticky', (el) => grabber.after(el));
      this.#scanTriggers();
      this.#listen(surface);
      this.#observeContent();
      this.#mode = null;
      this.#refreshMode();
      this.#cleanups.push(
        watchAdaptiveContext(this.#shell, (ctx) => {
          this.#ctx = ctx;
          if (!this.#out) return;
          this.#readEnvironment();
          this.#place();
          this.#run();
        }),
      );
      this.#forcedState = parseForced(this.getAttribute(FORCE_ATTRIBUTE));
      if (this.#forcedState) this.#applyForced();
      else if (wasOpen) this.#adopt(true);
    }

    #makeGrabber(): HTMLElement {
      const grabber = this.ownerDocument.createElement('div');
      grabber.setAttribute('data-vk-grabber', '');
      grabber.hidden = true;
      return grabber;
    }

    /** Buttons that present or dismiss the surface, lifted off the platform's own show and hide so the growth can run back first. */
    #scanTriggers(): void {
      const surface = this.#surface;
      if (!surface) return;
      for (const [button, lifted] of this.#lifted) {
        if (this.contains(button)) continue;
        lifted.restore();
        this.#lifted.delete(button);
      }
      for (const button of this.querySelectorAll<HTMLButtonElement>('button')) {
        if (this.#lifted.has(button)) continue;
        const target = (button as HTMLButtonElement & { popoverTargetElement?: Element | null }).popoverTargetElement;
        const aimed = target === surface || (surface.id !== '' && button.getAttribute('commandfor') === surface.id);
        if (!aimed) continue;
        const restore: (() => void)[] = [];
        const action = button.getAttribute('popovertargetaction') ?? 'toggle';
        if (!this.#dialog && button.hasAttribute('popovertarget')) {
          this.#keep(button, 'popovertarget', null, restore);
          this.#keep(button, 'popovertargetaction', null, restore);
        }
        if (!this.#dialog && !surface.contains(button)) {
          this.#keep(button, 'aria-expanded', String(this.#open), restore);
          if (surface.id) this.#keep(button, 'aria-controls', surface.id, restore);
        }
        this.#lifted.set(button, { action, restore: () => restore.reverse().forEach((undo) => undo()) });
      }
    }

    #triggers(): HTMLButtonElement[] {
      const surface = this.#surface;
      return [...this.#lifted.keys()].filter((b) => surface && !surface.contains(b) && b.isConnected);
    }

    #pickSource(): HTMLButtonElement | null {
      if (this.#source?.isConnected && this.contains(this.#source)) return this.#source;
      return this.#triggers()[0] ?? null;
    }

    #listen(surface: HTMLElement): void {
      const on = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, capture = false) => {
        target.addEventListener(type, handler as EventListener, capture);
        this.#cleanups.push(() => target.removeEventListener(type, handler as EventListener, capture));
      };

      const markup = new MutationObserver((records) => {
        const own = (node: Node) => node === this.#grabber || node === this.#edge?.el || node === this.#probe || this.#grabber?.contains(node);
        let changed = false;
        for (const record of records) {
          if (record.type === 'childList' && ![...record.addedNodes, ...record.removedNodes].every(own)) changed = true;
          else if (record.type === 'characterData') changed = true;
        }
        if (!changed) return;
        this.#scanTriggers();
        // A trigger taken out of the document has nothing to grow back into.
        if (this.#out && !this.#anchorEl && this.#source && !this.#source.isConnected) {
          this.#open = false;
          this.#settle();
          return;
        }
        this.#observeContent();
        this.#remeasure();
      });
      markup.observe(this, { childList: true, subtree: true, characterData: true });
      this.#cleanups.push(() => markup.disconnect());

      if (typeof ResizeObserver !== 'undefined') {
        const resizer = new ResizeObserver((entries) => this.#resized(entries));
        this.#resizer = resizer;
        this.#cleanups.push(() => {
          resizer.disconnect();
          this.#resizer = null;
          this.#sizes.clear();
        });
      }

      on<MouseEvent>(
        this,
        'click',
        (e) => {
          if (this.#forced()) return;
          // A carried trigger takes no pointer: the control that wraps it passes the click on to its button.
          const button = e.target instanceof Element ? e.target.closest('button') : null;
          const lifted = button ? this.#lifted.get(button) : undefined;
          if (!button || !lifted || this.#dialog) return;
          e.preventDefault();
          const inside = surface.contains(button);
          if (lifted.action === 'hide' || (inside && lifted.action === 'toggle')) this.#close();
          else if (lifted.action === 'show' && !this.#open) this.#show(inside ? null : button);
          else if (lifted.action === 'toggle') this.#open ? this.#close() : this.#show(button);
          else if (lifted.action === 'show') this.#show(inside ? null : button);
        },
        true,
      );

      if (this.#dialog) {
        const dialog = this.#dialog;
        on<Event>(dialog, 'command', (e) => {
          if (this.#forced()) return;
          const { command, source } = e as CommandLike;
          if (command === 'close' || command === 'request-close') {
            if (!this.#out) return;
            e.preventDefault();
            this.#close();
          } else if (command === 'show-modal') {
            const button = source instanceof HTMLButtonElement && !surface.contains(source) ? source : null;
            if (!this.#open && this.#ctx) {
              e.preventDefault();
              this.#show(button ?? this.#source);
            }
          }
        });
        on<Event>(dialog, 'cancel', (e) => {
          if (this.#forced() || !this.#out) return;
          e.preventDefault();
          this.#close();
        });
        on<Event>(dialog, 'close', () => {
          if (this.#out && !this.#hiding) this.#forceSettle();
        });
        on<SubmitEvent>(dialog, 'submit', (e) => {
          const form = e.target;
          if (!(form instanceof HTMLFormElement) || this.#forced() || !this.#out) return;
          const method = e.submitter?.hasAttribute('formmethod') ? (e.submitter as HTMLButtonElement).formMethod : form.method;
          if (method !== 'dialog') return;
          e.preventDefault();
          dialog.returnValue = e.submitter instanceof HTMLButtonElement ? e.submitter.value : '';
          this.#close();
        });
        const watch = new MutationObserver(() => {
          if (dialog.open && !this.#out) this.#adopt();
          else if (!dialog.open && this.#out && !this.#hiding) this.#forceSettle();
        });
        watch.observe(dialog, { attributes: true, attributeFilter: ['open'] });
        this.#cleanups.push(() => watch.disconnect());
      } else {
        on<ToggleEvent>(surface, 'beforetoggle', (e) => {
          if (this.#showing || this.#hiding) return;
          if (e.newState === 'open' && !this.#out) queueMicrotask(() => this.#surface?.matches(':popover-open') && !this.#out && this.#adopt());
          else if (e.newState === 'closed' && this.#out) this.#forceSettle();
        });
      }

      on<PointerEvent>(surface, 'pointerdown', (e) => this.#pressDown(e));
      on<PointerEvent>(surface, 'pointermove', (e) => this.#pressMove(e));
      on<PointerEvent>(surface, 'pointerup', (e) => this.#pressUp(e));
      on<PointerEvent>(surface, 'pointercancel', (e) => this.#pressUp(e));
      on<PointerEvent>(surface, 'lostpointercapture', (e) => e.target === surface && this.#pressUp(e));
      on<Event>(surface, 'scroll', () => {
        this.#scrollTop = surface.scrollTop;
        this.#syncTouch();
      });
      on<KeyboardEvent>(this.#grabber!, 'keydown', (e) => this.#grabberKey(e));
      on<FocusEvent>(surface, 'focusin', () => this.#viewportChanged());
      on<FocusEvent>(surface, 'focusout', () => queueMicrotask(() => this.#viewportChanged()));

      const roots = rootsOf(this);
      roots.forEach((root, i) => {
        const inner = i === 0 ? null : (roots[i - 1] as ShadowRoot).host;
        on<PointerEvent>(
          root,
          'pointerdown',
          (e) => {
            if (this.#swallow) this.#endSwallow();
            if (!this.#open || this.#forced()) return;
            const path = e.composedPath();
            if (inner && path.includes(inner)) return;
            if (path.includes(surface)) {
              const r = surface.getBoundingClientRect();
              const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
              if (!inside && this.#scrimCloses()) this.#close();
              return;
            }
            if (this.#triggers().some((t) => path.includes(t) || path.includes(this.#carrierOf(t) as Node))) return;
            if (tag !== 'popover' || this.#persistent()) return;
            // The platform gives a popover's ::backdrop no pointer, so the press on its scrim and the click after it are stopped here.
            if (this.#layout?.scrim && this.#form?.form === 'bottom-sheet' && this.#inWindow(e)) {
              e.preventDefault();
              this.#swallow = true;
              this.#swallowTimer = window.setTimeout(() => this.#endSwallow(), SWALLOW_MS);
            }
            this.#close();
          },
          true,
        );
        on(root, 'scroll', (e: Event) => this.#follow(e), true);
        on<MouseEvent>(
          root,
          'click',
          (e) => {
            if (!this.#swallow) return;
            this.#endSwallow();
            e.preventDefault();
            e.stopPropagation();
          },
          true,
        );
      });
      this.#cleanups.push(() => this.#endSwallow());
      on<KeyboardEvent>(this.ownerDocument, 'keydown', (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || tag !== 'popover' || !this.#open || this.#forced() || this.#persistent()) return;
        if (this.#modalElsewhere()) return;
        e.preventDefault();
        this.#close();
      });
      if (typeof window !== 'undefined') {
        on(window, 'resize', () => {
          this.#envDirty = true;
          this.#follow();
        });
        if (typeof window.matchMedia === 'function') on(window.matchMedia('(prefers-color-scheme: dark)'), 'change', () => this.#schemeChanged());
        const vv = window.visualViewport;
        if (vv) {
          on(vv, 'resize', () => this.#viewportChanged());
          on(vv, 'scroll', () => this.#viewportChanged());
        }
      }
    }

    #endSwallow(): void {
      window.clearTimeout(this.#swallowTimer);
      this.#swallowTimer = 0;
      this.#swallow = false;
    }

    /** A modal dialog open outside the surface owns the Escape, even when it was opened from inside the surface. */
    #modalElsewhere(): boolean {
      const surface = this.#surface;
      return rootsOf(this).some((root) => Array.from(root.querySelectorAll('dialog:modal')).some((dialog) => !dialog.contains(surface)));
    }

    #schemeChanged(): void {
      if (!this.#out) return;
      this.#readEnvironment();
      this.#paint();
    }

    #inWindow(e: PointerEvent): boolean {
      const w = this.#origin;
      return e.clientX >= w.x && e.clientX <= w.x + w.width && e.clientY >= w.y && e.clientY <= w.y + w.height;
    }

    #scrimCloses(): boolean {
      const form = this.#form;
      return form !== null && this.#layout?.scrim === true && scrimCloses(this.#kind(), form.form, this.#persistent());
    }

    /** A scroll re-places only a form that follows its source; the others look at whether the window moved. */
    #follow(scrolled?: Event): void {
      if (!this.#out || this.#followFrame) return;
      if (scrolled?.target instanceof Node && this.#surface?.contains(scrolled.target)) return;
      const sourced = !scrolled || this.#follows();
      this.#followFrame = requestAnimationFrame(() => {
        this.#followFrame = 0;
        if (!this.#out) return;
        if (this.#envDirty) {
          this.#envDirty = false;
          this.#readEnvironment();
        }
        if (sourced) {
          this.#place();
          this.#run();
          return;
        }
        const win = windowRect(this.#shell!);
        if (win.x === this.#origin.x && win.y === this.#origin.y) return;
        this.#origin = win;
        this.#paint();
      });
    }

    #follows(): boolean {
      const form = this.#form?.form;
      return form === 'popover' || form === 'grown';
    }

    #remeasure(): void {
      this.#maxContent = null;
      this.#contentKey = '';
      if (!this.#out) return;
      this.#place();
      this.#run();
    }

    #observeContent(): void {
      const resizer = this.#resizer;
      const surface = this.#surface;
      if (!resizer || !surface) return;
      const content = new Set(Array.from(surface.children).filter((child) => child !== this.#grabber && child !== this.#edge?.el));
      for (const el of [...this.#sizes.keys()]) {
        if (content.has(el)) continue;
        resizer.unobserve(el);
        this.#sizes.delete(el);
      }
      for (const el of content) {
        if (this.#sizes.has(el)) continue;
        this.#sizes.set(el, '');
        resizer.observe(el);
      }
    }

    #resized(entries: ResizeObserverEntry[]): void {
      const shown = (this.#surface?.getClientRects().length ?? 0) > 0;
      let changed = false;
      for (const { target, contentRect } of entries) {
        const key = `${contentRect.width}x${contentRect.height}`;
        const was = this.#sizes.get(target);
        this.#sizes.set(target, key);
        if (was !== undefined && was !== '' && was !== key) changed = true;
      }
      const opened = shown && !this.#contentShown;
      this.#contentShown = shown;
      if (changed && shown && !opened) this.#remeasure();
    }

    #present(): void {
      const surface = this.#surface!;
      this.#showing = true;
      try {
        if (this.#dialog) {
          if (this.#dialog.open && !this.#dialog.matches(':modal')) this.#dialog.close();
          if (!this.#dialog.open) this.#dialog.showModal();
        } else if (!surface.matches(':popover-open')) {
          surface.showPopover();
        }
      } finally {
        this.#showing = false;
      }
    }

    #show(source: HTMLButtonElement | null): void {
      if (!this.#surface || !this.#ctx) return;
      if (source && source !== this.#source) {
        if (this.#out) this.#setCarried(null);
        this.#source = source;
      }
      this.#open = true;
      if (!this.#out) {
        // Laid out and read before it is presented: a modal dialog makes the page inert, and an inert page cannot be read.
        this.#comeOut();
        this.#present();
      }
      this.#syncTriggers();
      this.#publishInset();
      this.#run();
    }

    /** The platform or the host opened the surface itself: pick it up on this frame. */
    #adopt(instant = false): void {
      if (!this.#surface || !this.#ctx || this.#out) return;
      this.#open = true;
      this.#comeOut();
      if (instant) {
        this.#pg = heldGrowthState(1);
        this.#sg = { x: 1, v: 0, target: 1 };
      }
      this.#syncTriggers();
      this.#publishInset();
      this.#run();
    }

    #close(): void {
      if (!this.#open) return;
      this.#open = false;
      const active = deepActive(this.ownerDocument);
      const trigger = this.#focusTarget();
      if (!this.#dialog && trigger && this.#surface && (this.#surface.contains(active) || active === this.ownerDocument.body)) {
        trigger.focus({ preventScroll: true });
      }
      this.#drag.active = false;
      this.#press = null;
      this.#syncTriggers();
      this.#clearInset();
      this.#run();
    }

    #comeOut(): void {
      this.#out = true;
      this.#focused = false;
      this.#source = this.#pickSource();
      this.#contentKey = '';
      this.#morph = null;
      this.#shown = null;
      this.#form = null;
      this.#kb = null;
      this.#detent = null;
      this.#scrollTop = this.#surface!.scrollTop;
      this.#envDirty = false;
      this.#readEnvironment();
      this.#place(true);
      this.#probed = this.#backdrop();
      this.#setCarried(1);
      this.#holdSample();
    }

    #settle(): void {
      const surface = this.#surface!;
      if (this.#glass) landGlass(this.#glass);
      const back = this.#focusTarget();
      this.#hiding = true;
      try {
        if (this.#dialog) {
          if (this.#dialog.open) this.#dialog.close();
        } else if (surface.matches(':popover-open')) {
          surface.hidePopover();
        }
      } finally {
        this.#hiding = false;
      }
      this.#reset();
      const active = deepActive(this.ownerDocument);
      if (this.#dialog && back?.isConnected && (!active || active === this.ownerDocument.body)) {
        back.focus({ preventScroll: true });
      }
    }

    /** Closed from outside while shown: no animation is possible, so settle where it stands. */
    #forceSettle(): void {
      this.#open = false;
      this.#reset();
    }

    #reset(): void {
      const surface = this.#surface;
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#out = false;
      this.#open = false;
      this.#pg = createGrowthState();
      this.#sg = createSheetGrowth();
      this.#morph = this.#shown = this.#form = this.#layout = this.#anchor = null;
      this.#sourceLocal = null;
      this.#drag = createSheetDrag();
      this.#press = null;
      this.#kb = null;
      this.#held = null;
      this.#probed = null;
      this.#touch = '';
      this.#grabKey = '';
      this.#scrollTop = 0;
      this.#touchTop = null;
      this.#clearInset();
      if (surface) {
        for (const name of Array.from(surface.style)) {
          if (name.startsWith('--vk-') && !/^--vk-(grab|pad)/.test(name)) surface.style.removeProperty(name);
        }
        surface.style.setProperty('--vk-pad-t', px(SHEET_SIZES.content.pad));
        for (const name of ['data-form', 'data-scrim', 'data-vk-touch']) surface.removeAttribute(name);
      }
      if (this.#grabber) this.#grabber.hidden = true;
      for (const name of ['data-form', 'data-phase', 'data-height']) this.removeAttribute(name);
      for (const name of Array.from(this.style)) if (name.startsWith('--vk-')) this.style.removeProperty(name);
      this.#glass?.setSample(this.#sample);
      this.#setCarried(null);
      this.#anchorEl = null;
      this.#syncTriggers();
    }

    #syncTriggers(): void {
      if (this.#dialog) return;
      for (const trigger of this.#triggers()) trigger.setAttribute('aria-expanded', String(this.#open));
    }

    #carrierOf(trigger: HTMLElement): Carrier | null {
      const parent = trigger.parentElement;
      return parent && /^vire-(icon-)?button$/.test(parent.localName) ? (parent as Carrier) : null;
    }

    /** What carries the surface's body while it is out: the anchor if it can, else the source's control. */
    #liveCarrier(): Carrier | null {
      const anchor = this.#anchorEl as Carrier | null;
      if (anchor) {
        if (typeof anchor.setCarried === 'function') return anchor;
        return this.#carrierOf(anchor as HTMLElement);
      }
      return this.#source ? this.#carrierOf(this.#source) : null;
    }

    #setCarried(ink: number | null): void {
      this.#liveCarrier()?.setCarried?.(ink);
    }

    #focusTarget(): HTMLElement | null {
      const anchor = this.#anchorEl;
      if (!anchor) return this.#source;
      return anchor instanceof HTMLButtonElement ? anchor : (anchor.querySelector<HTMLButtonElement>('button') ?? (anchor as HTMLElement));
    }

    #measure(width: number | null, grabber = false): Size {
      const surface = this.#surface!;
      this.style.setProperty('--vk-mpt', px(grabber ? SHEET_SIZES.content.handle : SHEET_SIZES.content.pad));
      if (width === null) this.style.removeProperty('--vk-mw');
      else this.style.setProperty('--vk-mw', px(width));
      this.setAttribute('data-measure', '');
      const r = surface.getBoundingClientRect();
      const size = { width: Math.ceil(r.width), height: Math.ceil(r.height) };
      this.removeAttribute('data-measure');
      this.style.removeProperty('--vk-mw');
      this.style.removeProperty('--vk-mpt');
      return size;
    }

    #contentFor(form: PresentationForm, window: Size): Size {
      const key = `${form.form}|${Math.round(form.region.width)}|${Math.round(form.region.height)}|${Math.round(window.height)}`;
      if (key === this.#contentKey) return this.#content;
      this.#maxContent ??= this.#measure(null).width;
      const probe = sheetLayout({ form, window, source: this.#sourceLocal, content: { width: this.#maxContent, height: 0 }, height: window.height / 2 });
      const width = Math.max(1, Math.round(probe.box.width));
      this.#content = { width: this.#maxContent, height: this.#measure(width, form.form === 'bottom-sheet').height };
      this.#contentKey = key;
      return this.#content;
    }

    #sourceClient(): RoundedRect | null {
      const trigger = this.#source;
      const anchor = this.#anchorEl;
      if (!anchor && !trigger?.isConnected) return null;
      const r = (anchor ?? this.#carrierOf(trigger!) ?? trigger!).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      const radius = parseFloat(getComputedStyle(this.#focusTarget() ?? trigger!).borderTopLeftRadius) || 0;
      return { x: r.x, y: r.y, width: r.width, height: r.height, radius: Math.min(radius, r.width / 2, r.height / 2) };
    }

    #wantedDetents(): SheetDetent[] {
      const words = (this.getAttribute('detents') ?? '').split(/\s+/).filter((w): w is SheetDetent => DETENTS.includes(w as SheetDetent));
      return words.length > 0 ? words : [...defaultSheetDetents(this.#kind())];
    }

    #detentList(extent: Size, content: Size): NamedSheetDetent[] {
      return namedSheetDetents(this.#kind(), extent, { detents: this.#wantedDetents(), content: sheetPeekContent(content.height) });
    }

    /** Everything that depends on the window, the source or the content; the per-frame part is `#relayout`. */
    #place(opening = false): void {
      const ctx = this.#ctx;
      const surface = this.#surface;
      if (!ctx || !surface || !this.#out) return;
      const win = windowRect(this.#shell!);
      this.#origin = win;
      const client = this.#sourceClient();
      const source = client ? { ...client, x: client.x - win.x, y: client.y - win.y } : null;
      this.#sourceLocal = source;
      const next = presentationForm(this.#kind(), ctx, source ?? undefined);
      const window = ctx.window;
      const content = this.#contentFor(next, window);
      this.#detents = this.#detentList({ width: next.region.width, height: next.region.height }, content);
      this.#anchor = popoverPlacement(next, source, content).anchor;

      const prev = this.#form;
      if (prev && prev.form !== next.form) {
        if (this.#instant() || !this.#open || !this.#shown) {
          this.#morph = null;
        } else {
          const from = { ...this.#shown };
          if (this.#morph) rebaseFormMorph(this.#morph.state);
          else this.#morph = { state: createFormMorph(), from };
          this.#morph.from = from;
        }
      }
      this.#form = next;
      this.setAttribute('data-form', next.form);
      surface.setAttribute('data-form', next.form);
      this.#chooseDetent(opening);
      this.#relayout();
      this.#reglass();
      this.#publishInset();
    }

    #chooseDetent(opening: boolean): void {
      const list = this.#detents;
      if (list.length === 0) return;
      let picked = list.find((d) => this.#detent !== null && d.names.includes(this.#detent));
      if (!picked) {
        const asked = this.getAttribute('detent') as SheetDetent | null;
        picked = list.find((d) => asked !== null && d.names.includes(asked)) ?? (this.#detent ? list.reduce((a, b) => (Math.abs(b.height - this.#drag.height.target) < Math.abs(a.height - this.#drag.height.target) ? b : a)) : list[0]!);
      }
      this.#detent = picked.name;
      this.#reflect(picked.name);
      if (this.#drag.active) return;
      if (opening || this.#form?.form !== 'bottom-sheet') {
        this.#drag.height = { x: picked.height, v: 0, target: picked.height };
      } else {
        this.#drag.height.target = this.#kb ? this.#drag.height.target : picked.height;
      }
    }

    #reflect(name: SheetDetent, restore = false): void {
      if (this.#form?.form !== 'bottom-sheet' || this.getAttribute('detent') === name) return;
      this.#reflecting = true;
      this.setAttribute('detent', name);
      this.#reflecting = false;
      if (!restore) this.dispatchEvent(new CustomEvent('vire-sheet-detent', { bubbles: true, detail: { detent: name } }));
    }

    #setDetent(name: string | null, animate: boolean): void {
      const picked = this.#detents.find((d) => name !== null && d.names.includes(name as SheetDetent));
      if (!this.#out) return;
      if (!picked) {
        if (this.#detent) this.#reflect(this.#detent, true);
        return;
      }
      if (this.#kb) this.#kb.moved = true;
      this.#detent = picked.name;
      this.#reflect(picked.name);
      this.#drag.height.target = picked.height;
      if (!animate) this.#drag.height = { x: picked.height, v: 0, target: picked.height };
      this.#run();
    }

    #relayout(): void {
      const form = this.#form;
      const ctx = this.#ctx;
      if (!form || !ctx) return;
      const grabber = form.form === 'bottom-sheet' && (this.#detents.length > 1 || !this.#persistent());
      this.#layout = sheetLayout({
        form,
        window: ctx.window,
        source: this.#sourceLocal,
        content: this.#content,
        height: this.#kb ? Math.min(this.#drag.height.x, ctx.window.height - this.#kb.lift - SHEET_SIZES.detent.largeTopGap) : this.#drag.height.x,
        grabber,
        bottomInset: this.#safeBottom,
        lift: this.#kb?.lift ?? 0,
      });
    }

    /** The bottom safe area and the colour of an opaque body, read through a probe that is in the element only while it is read. */
    #readEnvironment(): void {
      const probe = (this.#probe ??= this.#makeProbe());
      this.append(probe);
      const style = getComputedStyle(probe);
      const inset = parseFloat(style.paddingBottom);
      const canvas = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(style.backgroundColor);
      probe.remove();
      this.#safeBottom = Number.isFinite(inset) ? Math.max(inset, 0) : 0;
      this.#canvasLuma = canvas ? (0.2126 * Number(canvas[1]) + 0.7152 * Number(canvas[2]) + 0.0722 * Number(canvas[3])) / 255 : null;
    }

    #makeProbe(): HTMLElement {
      const probe = this.ownerDocument.createElement('div');
      probe.setAttribute('data-vk-probe', '');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);background-color:Canvas';
      return probe;
    }

    #syncInk(opaque: number): void {
      const sample = this.#probed ?? this.#held;
      const canvas = this.#canvasLuma;
      if (this.getAttribute('data-surface') !== 'glass' || !sample || canvas === null) {
        this.removeAttribute('data-ink');
        return;
      }
      const dimmed = !this.#probed && this.#layout?.scrim ? 1 - SHEET_SIZES.scrimAlpha : 1;
      const ink = surfaceInk(sample.luma * dimmed, opaque, canvas);
      if (this.getAttribute('data-ink') !== ink) {
        this.setAttribute('data-ink', ink);
        this.#edge?.update();
      }
    }

    /** The header strip of a scrolling surface floats over its content, so what slides under it dissolves before the glass shows it. */
    #syncEdge(): void {
      const edge = this.#edge;
      const grabber = this.#grabber;
      const surface = this.#surface;
      if (!edge || !grabber || !surface) return;
      const mode = this.getAttribute('scroll-edge');
      edge.set(
        this.#glassKey === 'on' && mode !== 'off'
          ? { scroller: surface, side: 'top', bar: grabber, hard: mode === 'hard', ink: () => (this.getAttribute('data-ink') === 'light' ? 1 : 0) }
          : null,
      );
    }

    #instant(): boolean {
      return this.#presentation?.instantSprings ?? false;
    }

    #run(): void {
      if (!this.#out || this.#forced()) return;
      if (this.#instant()) {
        this.#step(0, true);
        this.#paint();
        this.#afterStep();
        return;
      }
      this.#paint();
      if (this.#frame) return;
      this.#lastFrame = 0;
      this.#frame = requestAnimationFrame((t) => this.#tick(t));
    }

    #tick(now: number): void {
      this.#frame = 0;
      if (!this.isConnected || !this.#out || this.#forced()) return;
      const dt = this.#lastFrame ? Math.min((now - this.#lastFrame) / 1000, 0.05) : 1 / 60;
      this.#lastFrame = now;
      const moving = this.#step(dt, false);
      this.#paint();
      if (moving) this.#frame = requestAnimationFrame((t) => this.#tick(t));
      else this.#afterStep();
    }

    #popoverGrowth(): boolean {
      const form = this.#form?.form;
      return this.#sourceLocal !== null && (form === 'popover' || form === 'grown');
    }

    #step(dt: number, instant: boolean): boolean {
      const open = this.#open;
      let moving: boolean;
      // Only the growth being drawn runs; the other is held where this one will be, so a change of form finds it there.
      if (this.#popoverGrowth()) {
        moving = stepGrowth(this.#pg, dt, open, instant, POPOVER_GROWTH_TIMING);
        this.#sg = { x: open ? 1 : 0, v: 0, target: open ? 1 : 0 };
      } else {
        moving = stepSheetGrowth(this.#sg, dt, open, instant);
        const held = open ? 1 : 0;
        this.#pg = heldGrowthState(held);
      }
      const morph = this.#morph;
      if (morph) {
        if (!stepFormMorph(morph.state, dt, 1, instant)) {
          this.#morph = null;
          this.#reglass();
        }
        moving = true;
      }
      if (open && !this.#drag.active) moving = stepSheetHeight(this.#drag.height, dt, instant) || moving;
      return moving || this.#drag.active;
    }

    #afterStep(): void {
      if (!this.#open) {
        this.#settle();
        return;
      }
      if (this.#morph) {
        this.#morph = null;
        this.#reglass();
      }
      this.#paint();
      this.#focusIn();
    }

    #focusIn(): void {
      const surface = this.#surface;
      if (!surface || this.#focused || tag !== 'popover') return;
      this.#focused = true;
      const active = deepActive(this.ownerDocument);
      if (active && surface.contains(active)) return;
      const first = surface.querySelector<HTMLElement>('[autofocus], a[href], button:not([data-vk-grabber]):not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not([data-vk-grabber])');
      first?.focus({ preventScroll: true });
    }

    #compose(): {
      box: MorphBox;
      morph: VireGlassMorph | undefined;
      content: { x: number; y: number };
      ink: number;
      carry: number;
      scrim: number;
      opacity: number;
      activity: number;
      phase: 'open' | 'growing' | 'morph';
    } | null {
      this.#relayout();
      const layout = this.#layout;
      const form = this.#form;
      const ctx = this.#ctx;
      if (!layout || !form || !ctx) return null;
      let rest: MorphBox = layout.box;
      let opacity = layout.opacity;
      let scrim = layout.scrim ? 1 : 0;
      let formInk = 1;
      const m = this.#morph;
      if (m) {
        const f = formMorphFrame(m.from.box, layout.box, m.state);
        const t = clamp01(m.state.t.x);
        rest = f.box;
        opacity = mix(m.from.opacity, layout.opacity, t);
        scrim = mix(m.from.scrim, scrim, t);
        formInk = f.showing === 'from' ? f.ink.outgoing : f.ink.incoming;
      }
      this.#shown = { box: rest, opacity, scrim };

      const source = this.#sourceLocal;
      let box: MorphBox;
      let morph: VireGlassMorph | undefined;
      let ink: { outgoing: number; incoming: number };
      let activity = 0;
      let scrimT: number;
      let follows = false;
      if (this.#popoverGrowth() && source && this.#anchor) {
        const f = popoverGrowthFrame(source, rest, this.#anchor, growthPhase(this.#pg), form.region);
        ({ box, morph, ink, activity } = f);
        scrimT = 0;
        follows = true;
      } else if (source) {
        const f = sheetGrowthFrame(source, rest, this.#sg.x);
        ({ box, ink } = f);
        scrimT = clamp01(this.#sg.x);
        follows = true;
      } else {
        const from = form.form === 'bottom-sheet' || form.form === 'full-screen' ? 'bottom' : 'scale';
        const f = sheetEntryFrame(rest, this.#sg.x, from, { width: ctx.window.width, height: form.region.y + form.region.height });
        ({ box, ink } = f);
        scrimT = f.scrim;
      }
      const settled = this.#sg.x === 1 && this.#pg.shrink.x === 1 && this.#pg.grow.x === 1 && this.#pg.focus.x === 1 && this.#pg.rise.x === 1;
      return {
        box,
        morph,
        content: follows ? { x: rest.x - box.x, y: rest.y - box.y } : { x: 0, y: 0 },
        ink: Math.min(ink.incoming, formInk),
        carry: ink.outgoing,
        scrim: scrim * scrimT,
        opacity,
        activity,
        phase: !settled || !this.#open ? 'growing' : m ? 'morph' : 'open',
      };
    }

    #paint(): void {
      const surface = this.#surface;
      if (!surface || !this.#out) return;
      const c = this.#compose();
      const ctx = this.#ctx;
      if (!c || !ctx) return;
      const { x: ox, y: oy } = this.#origin;
      const s = surface.style;
      const box = c.box;
      s.setProperty('--vk-x', px(ox + box.x));
      s.setProperty('--vk-y', px(oy + box.y));
      s.setProperty('--vk-w', px(box.width));
      s.setProperty('--vk-h', px(box.height));
      s.setProperty('--vk-r', px(box.radius));
      s.setProperty('--vk-clip-b', px(this.#form ? sheetClipBottom(box, this.#form.region) : 0));
      s.setProperty('--vk-sx', px(ox));
      s.setProperty('--vk-sy', px(oy));
      s.setProperty('--vk-sw', px(ctx.window.width));
      s.setProperty('--vk-sh', px(ctx.window.height));
      s.setProperty('--vk-cx', px(c.content.x));
      s.setProperty('--vk-cy', px(c.content.y));
      s.setProperty('--vk-content-w', px(Math.max(0, (this.#layout?.box.width ?? box.width) - 2 * SHEET_SIZES.content.pad)));
      s.setProperty('--vk-ink-in', (Math.round(c.ink * 1000) / 1000).toFixed(3));
      s.setProperty('--vk-opaque', (this.#opaque ? 1 : c.opacity).toFixed(3));
      this.#syncInk(this.#opaque ? 1 : c.opacity);
      s.setProperty('--vk-scrim', (c.scrim * SHEET_SIZES.scrimAlpha).toFixed(3));
      const body = menuBody(VIREGLASS_CONTROL_MATERIAL, c.activity, false);
      s.setProperty('--vk-body-alpha', body.alpha.toFixed(3));
      s.setProperty('--vk-body-white', body.white.toFixed(3));
      s.setProperty('--vk-body-lift', body.lift.toFixed(3));
      surface.toggleAttribute('data-scrim', (this.#layout?.scrim ?? false) && this.#form?.form !== 'full-screen');
      this.setAttribute('data-phase', c.phase);
      const height = this.#drag.active ? 'dragging' : this.#form?.form === 'bottom-sheet' && this.#open && this.#drag.height.x !== this.#drag.height.target ? 'settling' : null;
      if (height) this.setAttribute('data-height', height);
      else this.removeAttribute('data-height');
      this.#syncGrabber();
      s.setProperty('--vk-pad-t', px(this.#grabber && !this.#grabber.hidden ? SHEET_SIZES.content.handle : SHEET_SIZES.content.pad));
      this.#syncTouch();
      this.#setCarried(this.#source || this.#anchorEl ? c.carry : null);
      this.#pushGlass(box, c.morph, c.activity, !this.#forced() && (c.phase !== 'open' || this.#drag.active || height !== null));
    }

    #pushGlass(box: MorphBox, morph: VireGlassMorph | undefined, activity: number, moving: boolean): void {
      const glass = this.#glass;
      if (!glass) return;
      const round = Math.round;
      const step = round(clamp01(activity) * MATERIAL_STEPS) / MATERIAL_STEPS;
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

    #backdrop(): BackdropSample | null {
      const layout = this.#layout;
      if (!layout) return null;
      const { x, y } = this.#origin;
      const read = this.#sample ?? probeRect(this.ownerDocument, { x: x + layout.box.x, y: y + layout.box.y, width: layout.box.width, height: layout.box.height });
      if (!read || !layout.scrim) return read;
      const k = 1 - SHEET_SIZES.scrimAlpha;
      return { ...read, luma: read.luma * k, lo: read.lo * k, hi: read.hi * k, r: read.r * k, g: read.g * k, b: read.b * k };
    }

    #holdSample(): void {
      const glass = this.#glass;
      const surface = this.#surface;
      const layout = this.#layout;
      if (!glass || !surface || !layout) return;
      let sample = this.#probed;
      if (!sample) {
        const s = surface.style;
        s.setProperty('--vk-x', px(this.#origin.x + layout.box.x));
        s.setProperty('--vk-y', px(this.#origin.y + layout.box.y));
        s.setProperty('--vk-w', px(layout.box.width));
        s.setProperty('--vk-h', px(layout.box.height));
        sample = glass.probe();
      }
      this.#held = sample;
      glass.setSample(sample);
      this.#paint();
    }

    /** With one detent the grabber is a picture of the swipe; with more it is the slider that moves between them. */
    #syncGrabber(): void {
      const grabber = this.#grabber;
      if (!grabber) return;
      const shown = this.#layout?.grabber != null && this.#form?.form === 'bottom-sheet';
      const list = this.#detents;
      const slider = shown && list.length > 1;
      const index = Math.max(0, list.findIndex((d) => d.name === this.#detent));
      const label = this.getAttribute('grabber-label') ?? 'Sheet height';
      const text = (this.#detent && parseDetentLabels(this.getAttribute('detent-labels'))[this.#detent]) || (this.#detent ?? '');
      const key = [shown, slider, index, list.length, label, text].join('|');
      if (key === this.#grabKey) return;
      this.#grabKey = key;
      grabber.hidden = !shown;
      const names = ['role', 'tabindex', 'aria-orientation', 'aria-label', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'];
      if (!slider) {
        for (const name of names) grabber.removeAttribute(name);
        grabber.setAttribute('aria-hidden', 'true');
        return;
      }
      grabber.removeAttribute('aria-hidden');
      grabber.setAttribute('role', 'slider');
      grabber.setAttribute('tabindex', '0');
      grabber.setAttribute('aria-orientation', 'vertical');
      grabber.setAttribute('aria-label', label);
      grabber.setAttribute('aria-valuemin', '0');
      grabber.setAttribute('aria-valuemax', String(list.length - 1));
      grabber.setAttribute('aria-valuenow', String(index));
      grabber.setAttribute('aria-valuetext', text);
    }

    #syncTouch(): void {
      const surface = this.#surface;
      if (!surface) return;
      const bottom = this.#form?.form === 'bottom-sheet' && this.#out;
      const next = bottom ? sheetTouchAction(this.#touchTop ?? this.#scrollTop, this.#drag.height.x, this.#detents.map((d) => d.height)) : '';
      if (next === this.#touch) return;
      this.#touch = next;
      if (next) surface.setAttribute('data-vk-touch', next);
      else surface.removeAttribute('data-vk-touch');
    }

    #publishInset(): void {
      if (this.#shell) setInset(this.#shell, this, this.#open && this.#out ? Math.round(this.#layout?.insetEnd ?? 0) : 0);
    }

    #clearInset(): void {
      if (this.#shell) setInset(this.#shell, this, 0);
    }

    #heights(): number[] {
      return this.#detents.map((d) => d.height);
    }

    #bottomSheet(): boolean {
      return this.#out && this.#open && this.#form?.form === 'bottom-sheet' && !this.#forced();
    }

    #scrollerOf(target: Element): Element | null {
      const surface = this.#surface!;
      for (let node: Element | null = target; node; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
        if (node === surface) break;
      }
      return null;
    }

    #pressDown(e: PointerEvent): void {
      if (!this.#bottomSheet() || e.button !== 0 || !e.isPrimary || !(e.target instanceof Element)) return;
      const surface = this.#surface!;
      const r = surface.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const grab = this.#grabber!.contains(e.target);
      const inStrip = e.clientY - r.top <= SHEET_SIZES.content.handle && e.target.closest(WIDGET) === null;
      const handle = grab || inStrip || e.target.closest('[data-sheet-handle]') !== null;
      if (!handle && e.pointerType === 'mouse') return;
      const scroller = handle ? null : this.#scrollerOf(e.target);
      this.#scrollTop = surface.scrollTop;
      this.#touchTop = scroller ? scroller.scrollTop : 0;
      this.#press = { id: e.pointerId, y: e.clientY, grab, started: false, scroller };
      this.#lastMove = e.timeStamp;
      this.#syncTouch();
      if (handle) this.#beginDrag(e);
    }

    #beginDrag(e: PointerEvent): void {
      const press = this.#press!;
      press.started = true;
      holdGlass(() => this.#press === press, () => [this.#glass]);
      pressSheetDrag(this.#drag, this.#drag.height.x, e.clientY);
      try {
        this.#surface!.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic pointer has nothing to capture.
      }
      this.#run();
    }

    #pressMove(e: PointerEvent): void {
      const press = this.#press;
      if (!press || press.id !== e.pointerId || !this.#bottomSheet()) return;
      if (!press.started) {
        const dy = e.clientY - press.y;
        if (Math.abs(dy) < DRAG_SLOP) return;
        if (sheetContentDrag(press.scroller?.scrollTop ?? this.#scrollTop, dy, this.#drag.height.x, this.#heights())) {
          this.#beginDrag(e);
          this.#lastMove = e.timeStamp;
        } else {
          this.#press = null;
        }
        return;
      }
      const dt = Math.max(0, (e.timeStamp - this.#lastMove) / 1000);
      this.#lastMove = e.timeStamp;
      if (this.#kb) this.#kb.moved = true;
      e.preventDefault();
      moveSheetDrag(this.#drag, e.clientY, dt, this.#heights(), this.#extent());
      this.#paint();
    }

    #extent(): Size {
      const region = this.#form?.region ?? { x: 0, y: 0, ...this.#ctx!.window };
      return { width: region.width, height: region.height };
    }

    #pressUp(e: PointerEvent): void {
      const press = this.#press;
      if (!press || press.id !== e.pointerId) return;
      this.#press = null;
      this.#touchTop = null;
      this.#syncTouch();
      if (!press.started) return;
      try {
        this.#surface!.releasePointerCapture(e.pointerId);
      } catch {
        // Nothing was captured.
      }
      if (e.type !== 'pointerup') {
        this.#land(cancelSheetDrag(this.#drag, this.#heights()).target);
        return;
      }
      if (press.grab && Math.abs(e.clientY - press.y) < DRAG_SLOP) {
        this.#drag.active = false;
        this.#stepDetent(1, true);
        return;
      }
      if ((e.timeStamp - this.#lastMove) / 1000 > SHEET_SIZES.drag.stale) this.#drag.velocity = 0;
      const result = releaseSheetDrag(this.#drag, this.#heights(), !this.#persistent());
      if ('close' in result) this.#close();
      else this.#land(result.target);
    }

    #land(target: number): void {
      const picked = this.#detents.find((d) => d.height === target);
      if (picked && picked.name !== this.#detent) {
        this.#detent = picked.name;
        this.#reflect(picked.name);
      }
      this.#run();
    }

    #stepDetent(direction: 1 | -1, wrap = false): void {
      const list = this.#detents;
      if (list.length < 2) return;
      const index = Math.max(0, list.findIndex((d) => d.name === this.#detent));
      let next = index + direction;
      if (next >= list.length) next = wrap ? 0 : list.length - 1;
      if (next < 0) next = 0;
      this.#setDetent(list[next]!.name, true);
    }

    #grabberKey(e: KeyboardEvent): void {
      if (!this.#bottomSheet() || e.altKey || e.ctrlKey || e.metaKey) return;
      const list = this.#detents;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'PageUp') this.#stepDetent(1);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'PageDown') this.#stepDetent(-1);
      else if (e.key === 'Home' && list.length > 0) this.#setDetent(list[0]!.name, true);
      else if (e.key === 'End' && list.length > 0) this.#setDetent(list[list.length - 1]!.name, true);
      else return;
      e.preventDefault();
    }

    #viewportChanged(): void {
      if (!this.#bottomSheet() || !this.#ctx) return;
      const vv = this.ownerDocument.defaultView?.visualViewport;
      const active = deepActive(this.ownerDocument);
      const inside = active !== null && this.#surface!.contains(active);
      const win = this.#ctx.window;
      if (vv && inside) {
        const rect = { x: vv.offsetLeft - this.#origin.x, y: vv.offsetTop - this.#origin.y, width: vv.width, height: vv.height };
        const current = this.#kb?.restore ?? this.#drag.height.target;
        const result = sheetForKeyboard(this.#heights(), current, win, rect);
        // A field starts it; focus moving on to the grabber does not end it, the keyboard leaving does.
        if (result.bottom < win.height - 1 && (isEditable(active) || this.#kb)) {
          this.#kb ??= { restore: result.restore, moved: false, lift: 0 };
          this.#kb.lift = win.height - result.bottom;
          if (!this.#kb.moved) this.#drag.height.target = result.height;
          this.#relayout();
          this.#run();
          return;
        }
      }
      const kb = this.#kb;
      if (!kb) return;
      this.#kb = null;
      if (!kb.moved) this.#drag.height.target = kb.restore;
      this.#relayout();
      this.#run();
    }

    #wantsGlass(): boolean {
      const wanted = this.getAttribute('glass');
      return wanted !== null && GLASS_ON.has(wanted);
    }

    #refreshMode(force = false, afterFailure = false): void {
      if (!afterFailure) this.#glassBroken = false;
      const mode = effectiveA11y(this.#own);
      const next = presentationFor(mode, this.#wantsGlass() && !this.#glassBroken);
      const changed = force || !this.#mode || !sameA11y(this.#mode, mode) || next.surface !== this.#presentation?.surface;
      this.#mode = mode;
      this.#presentation = next;
      this.#opaque = mode.reduceTransparency || mode.increaseContrast;
      const glass = next.glass && !this.#opaque;
      this.setAttribute('data-surface', glass ? 'glass' : 'plain');
      this.toggleAttribute('data-contrast', next.contrastBorder);
      this.setAttribute('data-glass', glass ? 'on' : 'off');
      if (changed) this.#reglass();
      if (this.#out) {
        this.#readEnvironment();
        this.#place();
        this.#run();
      }
    }

    #glassWanted(): boolean {
      const form = this.#form;
      if (!this.#presentation?.glass || this.#opaque || !this.#surface) return false;
      if (!form || !this.#ctx) return true;
      return sheetUsesGlass(form.form, this.#heights(), this.#extent());
    }

    #reglass(): void {
      const surface = this.#surface;
      const mode = this.#mode;
      if (!surface || !mode) return;
      let want = this.#glassWanted();
      if (!want && this.#morph && this.#glass) want = true;
      const key = want ? 'on' : '';
      if (key === this.#glassKey) return;
      this.#dropGlass();
      this.#glassKey = key;
      this.#syncEdge();
      if (!want) return;
      const token = this.#glassToken;
      const box = this.#layout?.box ?? { width: 300, height: 200, radius: SHEET_SIZES.dialog.radius };
      void attachControlGlass(
        surface,
        {
          material: menuMaterial(VIREGLASS_CONTROL_MATERIAL, 0),
          geometry: { width: Math.round(box.width), height: Math.round(box.height), cornerRadius: Math.round(box.radius) },
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

    #dropGlass(): void {
      this.#glassToken += 1;
      this.#glass?.destroy();
      this.#glass = null;
      this.#glassKey = '';
      this.#lastLens = { material: '', morph: '', geometry: '' };
    }

    #forced(): Forced | null {
      return this.#forcedState;
    }

    #applyForced(): void {
      const forced = this.#forced();
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      if (!forced) {
        if (this.#out) {
          this.#open = false;
          this.#settle();
        }
        return;
      }
      if (!this.#out && !this.#forcedWaited && this.#wantsGlass() && !glassLoaded()) {
        // The backdrop is read before the surface is presented, and that needs the glass module.
        const again = () => {
          this.#forcedWaited = true;
          if (this.#forcedState) this.#applyForced();
        };
        void ensureGlass().then(again, again);
        return;
      }
      this.#open = true;
      if (!this.#out) {
        if (!this.#ctx) return;
        this.#comeOut();
        this.#present();
      }
      if (forced.kind === 'open') {
        this.#pg = heldGrowthState(1);
        this.#sg = { x: 1, v: 0, target: 1 };
        if (forced.detent) {
          const picked = this.#detents.find((d) => d.names.includes(forced.detent!));
          if (picked) {
            this.#detent = picked.name;
            this.#drag.height = { x: picked.height, v: 0, target: picked.height };
          }
        }
      } else {
        this.#sg = { x: forced.t, v: 0, target: forced.t };
        this.#pg = {
          shrink: { x: clamp01(forced.t * 2), v: 0, target: 1 },
          grow: { x: clamp01(forced.t * 2 - 1), v: 0, target: 1 },
          height: { x: clamp01(forced.t * 2 - 1), v: 0, target: 1 },
          focus: { x: smoothstep(0.9, 1, clamp01(forced.t * 2 - 1)), v: 0, target: 1 },
          rise: { x: clamp01(forced.t * 2 - 1), v: 0, target: 1 },
          glow: { x: clamp01(forced.t * 2), v: 0, target: 1 },
        };
      }
      this.#morph = null;
      this.#syncTriggers();
      this.#publishInset();
      this.#paint();
    }
  };
}

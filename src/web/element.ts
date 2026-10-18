import { VIREGLASS_CONTROL_MATERIAL, type BackdropSample, type VireGlassMaterial } from 'vireglass';
import type { GlassMorph } from 'vireglass/dom';
import { presentationFor, sameA11y, type A11yMode, type A11yOverride, type Presentation } from '../kit/a11y';
import { atomBody, atomMaterial, type VireUIKitAtomKind } from '../kit/atom';
import { hitTarget, hoversWith, sizeTier } from '../kit/adaptive/input';
import {
  CONTROL_IDLE,
  stepControl,
  type ControlEvent,
  type ControlState,
  type InputCaps,
} from '../kit/behavior/control';
import {
  createControlVisual,
  settleControlVisual,
  stepControlVisual,
  visualAtomState,
} from '../kit/behavior/visual';
import { pressResponse } from '../kit/response';
import { BUTTON_SIZES, CONTROL_SIZES, hitSlop, iconButtonSize, type ControlSize } from '../kit/sizes';
import { effectiveA11y, watchA11yOverride, watchSystemA11y } from './a11y';
import { effectiveInput, watchPointerInput } from './environment';
import { attachControlGlass, type GlassSession } from './glass';
import { ensureStyles } from './styles';

type GlassMode = 'present' | 'touch' | 'off';

const FORCE_ATTRIBUTE = 'data-vire-force-state';

const FORCED = {
  rest: CONTROL_IDLE,
  hover: { ...CONTROL_IDLE, hovered: true },
  focus: { ...CONTROL_IDLE, focused: true },
  pressed: { ...CONTROL_IDLE, press: { by: 'pointer' } },
  disabled: { ...CONTROL_IDLE, disabled: true },
} as const satisfies Record<string, ControlState>;

type ForcedState = keyof typeof FORCED;

// Every distinct material rebuilds the lens's displacement map, so the press value is snapped
// instead of handing the lens a new one every frame.
const MATERIAL_STEPS = 10;
// How long after a release outside the button its click is still treated as that release's.
const SUPPRESS_MS = 100;
// Hover is the event's: the pointer that entered decides it, not the device's primary pointer.
const HOVER: InputCaps = { hover: true };
const NO_HOVER: InputCaps = { hover: false };

export interface VireControlElement extends HTMLElement {
  a11y: A11yOverride;
  sample: BackdropSample | null;
  setMorph(morph: GlassMorph | null): void;
  /** A menu growing out of this control carries its body: no lens and no body of its own, the glyph in
   *  focus by `ink` (1 sharp, 0 gone). `null` takes the body back. */
  setCarried(ink: number | null): void;
}

export type ControlElementOptions = { nonce?: string | undefined };

export function createControlElementClass(
  kind: Extract<VireUIKitAtomKind, 'button' | 'iconButton'>,
  options: ControlElementOptions = {},
) {
  const response = pressResponse(kind);

  return class VireControl extends HTMLElement implements VireControlElement {
    static observedAttributes = ['glass', 'size', 'disabled', FORCE_ATTRIBUTE];

    #control: HTMLButtonElement | null = null;
    #state: ControlState = CONTROL_IDLE;
    #visual = createControlVisual();
    #own: A11yOverride = {};
    #mode: A11yMode | null = null;
    #presentation: Presentation | null = null;
    #glass: GlassSession | null = null;
    #glassToken = 0;
    #glassKey = '';
    #glassBroken = false;
    #lastMaterialKey = '';
    #frame = 0;
    #lastFrame = 0;
    #cleanups: (() => void)[] = [];
    #suppressClick = false;
    #suppressTimer = 0;
    #slop = { x: 0, y: 0 };
    #morph: GlassMorph | null = null;
    #sample: BackdropSample | null = null;
    #carried: number | null = null;
    #hadStyle = { host: false, control: false };

    get a11y(): A11yOverride {
      return this.#own;
    }

    set a11y(next: A11yOverride) {
      this.#own = { ...next };
      if (this.#control) this.#refreshMode();
    }

    get sample(): BackdropSample | null {
      return this.#sample;
    }

    set sample(next: BackdropSample | null) {
      this.#sample = next;
      this.#glass?.setSample(next);
    }

    setMorph(morph: GlassMorph | null): void {
      this.#morph = morph;
      this.#glass?.setMorph(morph);
    }

    setCarried(ink: number | null): void {
      const handedOver = (this.#carried === null) !== (ink === null);
      this.#carried = ink === null ? null : Math.min(Math.max(ink, 0), 1);
      this.toggleAttribute('data-carried', this.#carried !== null);
      if (this.#carried === null) this.style.removeProperty('--vk-carry');
      else this.style.setProperty('--vk-carry', this.#carried.toFixed(3));
      // The lens materialises out rather than being removed, so taking the body back is one synchronous repaint;
      // a lens that appears only under the finger goes back to absent.
      if (handedOver) this.#glass?.setAppear(this.#carried === null && this.#glassMode() !== 'touch' ? 1 : 0);
    }

    connectedCallback(): void {
      // Set before the element was defined, a property lands on the instance and hides the accessor.
      for (const key of ['a11y', 'sample']) {
        if (!Object.prototype.hasOwnProperty.call(this, key)) continue;
        const value: unknown = Reflect.get(this, key);
        Reflect.deleteProperty(this, key);
        Reflect.set(this, key, value);
      }
      this.#hadStyle.host = this.hasAttribute('style');
      ensureStyles(this, options.nonce);
      this.#cleanups.push(watchPointerInput(() => this.#onInputChange()));
      this.#cleanups.push(watchSystemA11y(() => this.#refreshMode()));
      this.#cleanups.push(watchA11yOverride(() => this.#refreshMode()));
      this.#awaitControl();
    }

    disconnectedCallback(): void {
      for (const cleanup of this.#cleanups.splice(0)) cleanup();
      cancelAnimationFrame(this.#frame);
      clearTimeout(this.#suppressTimer);
      this.#frame = 0;
      this.#dropGlass();
      if (this.#control && !this.#hadStyle.control && this.#control.getAttribute('style') === '') this.#control.removeAttribute('style');
      this.#control = null;
      this.#state = CONTROL_IDLE;
      this.#suppressClick = false;
      this.#carried = null;
      for (const name of ['data-vk', 'data-surface', 'data-glass', 'data-frost', 'data-size', 'data-carried']) this.removeAttribute(name);
      for (const name of Array.from(this.style)) if (name.startsWith('--vk-')) this.style.removeProperty(name);
      if (!this.#hadStyle.host && this.getAttribute('style') === '') this.removeAttribute('style');
      this.#presentation = null;
      this.#mode = null;
    }

    attributeChangedCallback(name: string): void {
      if (!this.#control) return;
      if (name === 'disabled') {
        const wanted = this.hasAttribute('disabled');
        if (this.#control.disabled !== wanted) this.#control.disabled = wanted;
        this.#syncDisabled();
      } else if (name === FORCE_ATTRIBUTE) {
        this.#applyForced();
      } else {
        this.#refreshMode(true);
      }
    }

    // The parser connects the element before its children exist, so the button is waited for
    // rather than made up.
    #awaitControl(): void {
      const found = this.querySelector<HTMLButtonElement>(':scope > button');
      if (found) {
        this.#upgrade(found);
        return;
      }
      const observer = new MutationObserver(() => {
        const button = this.querySelector<HTMLButtonElement>(':scope > button');
        if (!button) return;
        observer.disconnect();
        this.#upgrade(button);
      });
      observer.observe(this, { childList: true });
      this.#cleanups.push(() => observer.disconnect());
    }

    #upgrade(control: HTMLButtonElement): void {
      this.#control = control;
      this.#hadStyle.control = control.hasAttribute('style');
      this.setAttribute('data-vk', '');
      this.#listen(control);
      this.#cleanups.push(this.#observeSize(control));
      this.#syncDisabled();
      if (control.matches(':focus')) {
        this.#dispatch({ type: 'focus', visible: control.matches(':focus-visible') });
      }
      this.#mode = null;
      this.#refreshMode();
    }

    #onInputChange(): void {
      if (!this.#control) return;
      // A mouse unplugged mid-hover never sends a leave; an enter with no hover clears it and leaves the press alone.
      if (this.#state.hovered && !effectiveInput().hover) this.#dispatch({ type: 'enter' }, NO_HOVER);
      this.#refreshMode(true);
    }

    #size(): ControlSize {
      const wanted = this.getAttribute('size');
      if (wanted && (CONTROL_SIZES as readonly string[]).includes(wanted)) return wanted as ControlSize;
      return sizeTier(effectiveInput());
    }

    #glassMode(): GlassMode {
      const wanted = this.getAttribute('glass');
      if (wanted === 'touch') return 'touch';
      return wanted === '' || wanted === 'present' ? 'present' : 'off';
    }

    #forced(): ForcedState | null {
      const wanted = this.getAttribute(FORCE_ATTRIBUTE);
      return wanted !== null && Object.hasOwn(FORCED, wanted) ? (wanted as ForcedState) : null;
    }

    #dispatch(event: ControlEvent, caps: InputCaps = HOVER): boolean {
      if (this.#forced()) return false;
      const step = stepControl(this.#state, event, caps);
      this.#state = step.state;
      this.#render();
      return step.activated;
    }

    #listen(control: HTMLButtonElement): void {
      const on = <E extends Event>(
        target: EventTarget,
        type: string,
        handler: (event: E) => void,
        capture = false,
      ) => {
        target.addEventListener(type, handler as EventListener, capture);
        this.#cleanups.push(() => target.removeEventListener(type, handler as EventListener, capture));
      };
      // The host's own box is the unscaled one; the button grows while pressed.
      const inside = (e: PointerEvent) => {
        const r = this.getBoundingClientRect();
        return (
          e.clientX >= r.left - this.#slop.x &&
          e.clientX <= r.right + this.#slop.x &&
          e.clientY >= r.top - this.#slop.y &&
          e.clientY <= r.bottom + this.#slop.y
        );
      };
      const holdSuppression = () => {
        this.#suppressClick = true;
        clearTimeout(this.#suppressTimer);
        this.#suppressTimer = window.setTimeout(() => (this.#suppressClick = false), SUPPRESS_MS);
      };
      const releaseSuppression = () => {
        this.#suppressClick = false;
        clearTimeout(this.#suppressTimer);
      };

      // The hit area reaches past the button on coarse pointers, so the host sees those events.
      const bind = (target: HTMLElement, own: boolean) => {
        const mine = (e: Event) => own || e.target === this;
        on<PointerEvent>(target, 'pointerdown', (e) => {
          if (e.button !== 0 || !mine(e)) return;
          releaseSuppression();
          this.#dispatch({ type: 'down', source: 'pointer' });
        });
        on<PointerEvent>(target, 'pointermove', (e) => {
          if (!mine(e)) return;
          if (this.#state.press.by === 'pointer' && !inside(e)) this.#dispatch({ type: 'leave' });
        });
        on<PointerEvent>(target, 'pointerup', (e) => {
          if (!mine(e)) return;
          const wasPressed = this.#state.press.by === 'pointer';
          const activated = this.#dispatch({ type: 'up', source: 'pointer' });
          if (own && !activated && !wasPressed && !inside(e)) holdSuppression();
        });
        on<PointerEvent>(target, 'pointercancel', (e) => {
          if (mine(e)) this.#dispatch({ type: 'cancel' });
        });
        on<PointerEvent>(target, 'pointerenter', (e) => {
          if (mine(e)) this.#dispatch({ type: 'enter' }, hoversWith(e.pointerType) ? HOVER : NO_HOVER);
        });
        on<PointerEvent>(target, 'pointerleave', (e) => {
          // A captured pointer never leaves; the move handler decides by position instead.
          if (mine(e) && !control.hasPointerCapture?.(e.pointerId)) this.#dispatch({ type: 'leave' });
        });
      };
      bind(control, true);
      bind(this, false);

      // A tap in the hit area clicks the host; the button gets the one click, and the host sees it bubble.
      on<MouseEvent>(
        this,
        'click',
        (e) => {
          if (e.target !== this) return;
          e.stopImmediatePropagation();
          e.preventDefault();
          control.click();
        },
        true,
      );

      // The lens captures the pointer, so a release outside the button still clicks it; only a
      // click that follows such a release is dropped, a keyboard or scripted one never is.
      on<MouseEvent>(
        control,
        'click',
        (e) => {
          if (!this.#suppressClick) return;
          releaseSuppression();
          if (e.detail === 0) return;
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        true,
      );
      on<KeyboardEvent>(control, 'keydown', (e) => {
        releaseSuppression();
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) this.#dispatch({ type: 'down', source: 'keyboard' });
      });
      on<KeyboardEvent>(control, 'keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') this.#dispatch({ type: 'up', source: 'keyboard' });
      });
      on(control, 'focus', () => this.#dispatch({ type: 'focus', visible: control.matches(':focus-visible') }));
      on(control, 'blur', () => this.#dispatch({ type: 'blur' }));
      on(control, 'focusout', () => this.#dispatch({ type: 'blur' }));

      const mutations = new MutationObserver(() => this.#syncDisabled());
      mutations.observe(control, { attributes: true, attributeFilter: ['disabled'] });
      this.#cleanups.push(() => mutations.disconnect());
    }

    #observeSize(control: HTMLButtonElement): () => void {
      if (typeof ResizeObserver === 'undefined') return () => {};
      const observer = new ResizeObserver(() => {
        this.#applySlop();
        this.#glass?.setGeometry(this.#geometry(control));
      });
      observer.observe(control);
      return () => observer.disconnect();
    }

    #geometry(control: HTMLElement) {
      const radius = parseFloat(getComputedStyle(control).borderTopLeftRadius) || 0;
      return { width: control.offsetWidth, height: control.offsetHeight, cornerRadius: radius };
    }

    #applySlop(): void {
      const control = this.#control;
      if (!control) return;
      const floor = hitTarget(effectiveInput());
      this.#slop = { x: hitSlop(control.offsetWidth, floor), y: hitSlop(control.offsetHeight, floor) };
      this.style.setProperty('--vk-slop-x', String(this.#slop.x));
      this.style.setProperty('--vk-slop-y', String(this.#slop.y));
    }

    #syncDisabled(): void {
      const control = this.#control;
      if (!control) return;
      // Assigning an already-set `disabled` still queues a mutation record, which would loop.
      if (this.hasAttribute('disabled') && !control.disabled) control.disabled = true;
      const disabled = control.disabled;
      if (this.#forced()) return;
      if (disabled !== this.#state.disabled) {
        this.#state = stepControl(this.#state, { type: 'disable', disabled }, HOVER).state;
        this.#render();
      }
    }

    #applyForced(): void {
      const forced = this.#forced();
      if (forced) {
        this.#state = FORCED[forced];
        settleControlVisual(this.#visual, this.#state);
        if (forced === 'disabled' && this.#control && !this.#control.disabled) this.#control.disabled = true;
      } else {
        this.#state = CONTROL_IDLE;
        this.#syncDisabled();
      }
      this.#render(true);
    }

    #refreshMode(force = false, afterFailure = false): void {
      if (!afterFailure) this.#glassBroken = false;
      const mode = effectiveA11y(this.#own);
      let next = presentationFor(mode, this.#glassMode() !== 'off');
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
      if (this.#forced()) this.#applyForced();
      else this.#render(true);
    }

    #applySize(): void {
      const size = this.#size();
      const spec = kind === 'iconButton' ? iconButtonSize(size) : BUTTON_SIZES[size];
      const set = (name: string, value: string) => this.style.setProperty(name, value);
      set('--vk-height', `${spec.height}px`);
      set('--vk-pad-x', `${spec.paddingX}px`);
      set('--vk-icon', `${spec.icon}px`);
      set('--vk-radius', `${spec.radius}px`);
      set('--vk-grow', String(response.grow));
      set('--vk-defocus', String(response.defocus));
      this.setAttribute('data-size', size);
      this.#applySlop();
    }

    #dropGlass(): void {
      this.#glassToken += 1;
      this.#glass?.destroy();
      this.#glass = null;
      this.#glassKey = '';
      this.#lastMaterialKey = '';
    }

    #reattachGlass(mode: A11yMode): void {
      const control = this.#control;
      const want = this.#presentation?.glass === true && control !== null;
      const key = want ? `${this.#glassMode()}|${JSON.stringify(mode)}|${this.#size()}` : '';
      if (key === this.#glassKey) return;
      this.#dropGlass();
      this.#glassKey = key;
      if (!want || !control) return;
      const token = this.#glassToken;
      const sample = this.#sample;
      void attachControlGlass(
        control,
        {
          material: VIREGLASS_CONTROL_MATERIAL,
          geometry: this.#geometry(control),
          accessibility: mode,
          onTouch: this.#glassMode() === 'touch',
          sample,
        },
        () => token === this.#glassToken && this.isConnected,
      )
        .then((session) => {
          if (!session) return;
          this.#glass = session;
          if (this.#morph) session.setMorph(this.#morph);
          if (this.#carried !== null) session.setAppear(0);
          if (this.#sample !== sample) session.setSample(this.#sample);
          this.#pushMaterial(true);
          this.dispatchEvent(new CustomEvent('vire-glass-ready'));
        })
        .catch(() => {
          if (token !== this.#glassToken) return;
          this.#glassKey = '';
          this.#glassBroken = true;
          this.#refreshMode(false, true);
        });
    }

    #pushMaterial(force = false): void {
      const glass = this.#glass;
      if (!glass) return;
      const atom = visualAtomState(this.#visual, this.#state);
      const snap = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * MATERIAL_STEPS) / MATERIAL_STEPS;
      const quantized = { ...atom, pressed: snap(atom.pressed), hovered: snap(atom.hovered) };
      const key = `${quantized.pressed}|${quantized.hovered}|${quantized.disabled}`;
      if (!force && key === this.#lastMaterialKey) return;
      this.#lastMaterialKey = key;
      const material: VireGlassMaterial = atomMaterial(VIREGLASS_CONTROL_MATERIAL, kind, quantized);
      glass.setMaterial(material);
      if (this.#glassMode() === 'touch' && this.#forced()) glass.setAppear(quantized.pressed);
    }

    #render(immediate = false): void {
      if (immediate && this.#forced()) settleControlVisual(this.#visual, this.#state);
      this.#paint();
      if (this.#frame || (immediate && this.#forced())) return;
      this.#lastFrame = 0;
      this.#frame = requestAnimationFrame((t) => this.#tick(t));
    }

    #tick(now: number): void {
      this.#frame = 0;
      if (!this.isConnected) return;
      const dt = this.#lastFrame ? Math.min((now - this.#lastFrame) / 1000, 0.05) : 1 / 60;
      this.#lastFrame = now;
      const moving = stepControlVisual(this.#visual, dt, this.#state, this.#presentation?.instantSprings ?? false);
      this.#paint();
      if (moving) this.#frame = requestAnimationFrame((t) => this.#tick(t));
    }

    #paint(): void {
      const v = this.#visual;
      const set = (name: string, value: number) => this.style.setProperty(name, value.toFixed(3));
      set('--vk-press', v.pressed.x);
      set('--vk-hover', v.hovered.x);
      const body = atomBody(VIREGLASS_CONTROL_MATERIAL, visualAtomState(v, this.#state), this.#presentation?.frost ?? false);
      set('--vk-body-alpha', body.alpha);
      set('--vk-body-white', body.white);
      set('--vk-body-lift', body.lift);
      this.toggleAttribute('data-pressed', this.#state.press.by !== null);
      this.toggleAttribute('data-hovered', this.#state.hovered);
      this.toggleAttribute('data-focus', this.#state.focused);
      this.toggleAttribute('data-disabled', this.#state.disabled);
      this.#pushMaterial();
    }
  };
}

// A class change flows a body from one form into the next: one body reshaped on the growth's springs, never a swap
// or a crossfade. Turning back mid-way runs the same spring the other way; reduced motion lands in one frame.
import type { Rect } from '../geometry';
import { POPOVER_GROWTH_TIMING, smoothstep, stepSpring, type Spring } from '../morph';
import type { AdaptiveContext } from './context';

export type MorphBody = 'navigation' | 'surface' | 'panes' | 'supporting' | 'accessory' | 'toolbar';

export type FormChange = { body: MorphBody; from: string; to: string };

export type FormMorphDescriptor = FormChange & {
  /**
   * `reshape`: the one body changes its box and its content refocuses. `appear` and `disappear`: the body comes and goes by
   * modulating its lens, never by fading. `retract`: its anchor is gone, so it runs back into the anchor's new owner and
   * closes. `none`: nothing moves.
   */
  mode: 'none' | 'reshape' | 'appear' | 'disappear' | 'retract';
  /** An open surface stays open through a change of form. */
  staysOpen: boolean;
  instant: boolean;
};

const HIDDEN = new Set(['hidden', 'closed', 'none']);

export function formMorph(change: FormChange, ctx: Pick<AdaptiveContext, 'reduceMotion'>, options: { anchorGone?: boolean } = {}): FormMorphDescriptor {
  const instant = ctx.reduceMotion;
  if (options.anchorGone) return { ...change, mode: 'retract', staysOpen: false, instant };
  if (change.from === change.to) return { ...change, mode: 'none', staysOpen: true, instant };
  const mode = HIDDEN.has(change.from) ? 'appear' : HIDDEN.has(change.to) ? 'disappear' : 'reshape';
  return { ...change, mode, staysOpen: mode !== 'disappear', instant };
}

/** A class change moves at the popover's opening pace, critically damped: a layout that overshoots would bounce off the window's edge. */
export const FORM_MORPH_TIMING = { response: POPOVER_GROWTH_TIMING.growOpen, damping: 1 } as const;

/** 0 is the form it comes from, 1 the form it goes to. */
export type FormMorphState = { t: Spring; fromInk?: number };

export const createFormMorph = (): FormMorphState => ({ t: { x: 0, v: 0, target: 0 }, fromInk: 1 });

/** Steps toward a form; true while still moving. Called with the other end mid-way, it turns back from where it is. */
export function stepFormMorph(state: FormMorphState, dt: number, toward: 0 | 1, instant = false): boolean {
  state.t.target = toward;
  return stepSpring(state.t, dt, FORM_MORPH_TIMING.response, FORM_MORPH_TIMING.damping, instant);
}

export type MorphBox = Rect & { radius: number };

export type FormMorphFrame = {
  box: MorphBox;
  /** The content defocuses out of the old form and into the new one; both are 0 around the middle. */
  ink: { outgoing: number; incoming: number };
  /** Which form's content shows. */
  showing: 'from' | 'to';
};

const OUT_END = 0.45;
const IN_START = 0.55;

export function formMorphFrame(from: MorphBox, to: MorphBox, state: FormMorphState): FormMorphFrame {
  const t = Math.min(Math.max(state.t.x, 0), 1);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    box: {
      x: mix(from.x, to.x),
      y: mix(from.y, to.y),
      width: mix(from.width, to.width),
      height: mix(from.height, to.height),
      radius: mix(from.radius, to.radius),
    },
    ink: inkAt(state, t),
    showing: t < 0.5 ? 'from' : 'to',
  };
}

function inkAt(state: FormMorphState, t: number): FormMorphFrame['ink'] {
  return { outgoing: (state.fromInk ?? 1) * (1 - smoothstep(0, OUT_END, t)), incoming: smoothstep(IN_START, 1, t) };
}

/**
 * A third form while a morph is under way: the box it is in now becomes the new start and the content showing now
 * leaves from the ink it has, so nothing jumps. A rebased start is a moment, not a form; the morph only goes on from it.
 */
export function rebaseFormMorph(state: FormMorphState): void {
  const t = Math.min(Math.max(state.t.x, 0), 1);
  const ink = inkAt(state, t);
  state.fromInk = t < 0.5 ? ink.outgoing : ink.incoming;
  state.t = { x: 0, v: 0, target: 0 };
}

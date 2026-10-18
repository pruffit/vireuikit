// A change of form goes through the selection: it lifts into a lens, the old body contracts into it, the lens travels
// to the selection's place in the new form, the new body grows out of it and the lens settles into the pill. One spring
// drives it; the frame is a pure function of that position, so turning back retraces it.
import { FORM_MORPH_TIMING, type MorphBox } from '../adaptive/form-morph';
import { smoothstep, stepSpring, type Spring } from '../morph';
import { NAV_SIZES, type NavLayout } from './layout';

/** Critically damped, fitted so the spring passes 95 % at about 0.8 s (M 8:36.2-8:37.0). */
export const NAV_MORPH_TIMING = { response: 1.06, damping: 1 } as const;
/** The bar contracting to its minimised circle and back moves at the pace of any other form change. */
export const NAV_MINIMIZE_TIMING = FORM_MORPH_TIMING;

export type NavMorphPhase = 'rest' | 'lift' | 'contract' | 'travel' | 'grow' | 'settle';

export type NavMorphFrame = {
  phase: NavMorphPhase;
  body: MorphBox;
  /** The bar's search circle as the body's second shape; smoothing 0 once separate. */
  second: { box: MorphBox; smoothing: number } | null;
  /** The selection's lens; null at rest. `lift` 0..1 is its glass presence and magnification. */
  lens: { box: MorphBox; lift: number } | null;
  ink: { outgoing: number; incoming: number };
  showing: 'from' | 'to';
};

type Second = NonNullable<NavMorphFrame['second']>;
type Lens = NonNullable<NavMorphFrame['lens']>;

const LIFT_END = 0.12;
const CONTRACT = [0.08, 0.38] as const;
const TRAVEL = [0.36, 0.56] as const;
const GROW = [0.52, 0.86] as const;
const SETTLE_START = 0.82;
const INK_OUT = [0.08, 0.28] as const;
const INK_IN = [0.62, 0.86] as const;
const SWAP_AT = 0.46;
const SMOOTHING = 24;
const SEED = 8;
const STAND_IN = 44;

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const mixBox = (a: MorphBox, b: MorphBox, t: number): MorphBox => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  width: mix(a.width, b.width, t),
  height: mix(a.height, b.height, t),
  radius: mix(a.radius, b.radius, t),
});

const inflate = (b: MorphBox, d: number): MorphBox => ({
  x: b.x - d,
  y: b.y - d,
  width: b.width + 2 * d,
  height: b.height + 2 * d,
  radius: b.radius + d,
});

const centred = (cx: number, cy: number, size: number): MorphBox => ({ x: cx - size / 2, y: cy - size / 2, width: size, height: size, radius: size / 2 });

/** The body's trailing end, where the search circle merges in and buds out. */
const trailingEnd = (body: MorphBox, size: number): MorphBox =>
  centred(body.x + body.width - body.height / 2, body.y + body.height / 2, size);

const pillOrStandIn = (layout: NavLayout): MorphBox =>
  layout.pill ?? centred(layout.body.x + layout.body.width / 2, layout.body.y + layout.body.height / 2, STAND_IN);

/** Only the bar has a separate search circle; elsewhere search lives inside the body. */
const separateSearch = (layout: NavLayout): MorphBox | null => (layout.form === 'bar' ? layout.search : null);

function restFrame(layout: NavLayout, side: 'from' | 'to'): NavMorphFrame {
  const search = separateSearch(layout);
  return {
    phase: 'rest',
    body: layout.body,
    second: search ? { box: search, smoothing: 0 } : null,
    lens: null,
    ink: side === 'from' ? { outgoing: 1, incoming: 0 } : { outgoing: 0, incoming: 1 },
    showing: side,
  };
}

/** Where a morph starts: a layout at rest, or a frozen frame (a moment, not a form). */
type Origin = {
  body: MorphBox;
  second: Second | null;
  lens: Lens;
  /** The ink the content showing now leaves from. */
  ink: number;
  /** The timeline starts here: a frozen frame has already lifted and begins contracting. */
  lead: number;
  /** A third form met the lens mid-travel: it goes on from where it is. */
  hold: { box: MorphBox; k0: number } | null;
};

const layoutOrigin = (layout: NavLayout): Origin => {
  const search = separateSearch(layout);
  return {
    body: layout.body,
    second: search ? { box: search, smoothing: 0 } : null,
    lens: { box: pillOrStandIn(layout), lift: 0 },
    ink: 1,
    lead: 0,
    hold: null,
  };
};

const frameOrigin = (frame: NavMorphFrame): Origin => ({
  body: frame.body,
  second: frame.second,
  lens: frame.lens ?? { box: centred(frame.body.x + frame.body.width / 2, frame.body.y + frame.body.height / 2, STAND_IN), lift: 0 },
  ink: Math.max(frame.ink.outgoing, frame.ink.incoming),
  lead: CONTRACT[0],
  hold: null,
});

function phaseAt(tau: number): NavMorphPhase {
  if (tau < CONTRACT[0]) return 'lift';
  if (tau < TRAVEL[0]) return 'contract';
  if (tau < GROW[0]) return 'travel';
  return tau < SETTLE_START ? 'grow' : 'settle';
}

function lensFrame(o: Origin, to: NavLayout, t: number): NavMorphFrame {
  const tau = o.lead + (1 - o.lead) * t;
  const u = smoothstep(o.lead, LIFT_END, tau);
  const base = inflate(o.lens.box, NAV_SIZES.lens.inflate * (1 - o.lens.lift) * u);
  const lift = mix(o.lens.lift, 1, u);
  const toPill = pillOrStandIn(to);
  const k = smoothstep(TRAVEL[0], TRAVEL[1], tau);
  const kk = o.hold ? clamp01((k - o.hold.k0) / (1 - o.hold.k0)) : k;
  const travelling = mixBox(o.hold?.box ?? base, inflate(toPill, NAV_SIZES.lens.inflate), kk);

  const c = smoothstep(CONTRACT[0], CONTRACT[1], tau);
  const g = smoothstep(GROW[0], GROW[1], tau);
  const s = smoothstep(SETTLE_START, 1, tau);
  const contracted = mixBox(o.body, travelling, c);
  const body = mixBox(contracted, to.body, g);

  let second: Second | null = null;
  const budding = separateSearch(to);
  if (o.second && c < 1) {
    second = {
      box: mixBox(o.second.box, trailingEnd(contracted, 0), c),
      smoothing: mix(o.second.smoothing, SMOOTHING, c),
    };
  } else if (budding && g > 0) {
    second = { box: mixBox(trailingEnd(body, SEED), budding, g), smoothing: SMOOTHING * (1 - g) };
  }

  return {
    phase: phaseAt(tau),
    body,
    second,
    lens: { box: mixBox(travelling, toPill, s), lift: lift * (1 - s) },
    ink: {
      outgoing: o.ink * (1 - smoothstep(INK_OUT[0], INK_OUT[1], tau)),
      incoming: smoothstep(INK_IN[0], INK_IN[1], tau),
    },
    showing: tau < SWAP_AT ? 'from' : 'to',
  };
}

function contractFrame(o: Origin, to: NavLayout, t: number): NavMorphFrame {
  const body = mixBox(o.body, to.body, t);
  const target = separateSearch(to);
  let second: Second | null = null;
  if (o.second && target) {
    second = { box: mixBox(o.second.box, target, t), smoothing: mix(o.second.smoothing, 0, t) };
  } else if (o.second) {
    second = { box: mixBox(o.second.box, trailingEnd(body, 0), t), smoothing: mix(o.second.smoothing, SMOOTHING, t) };
  } else if (target) {
    second = { box: mixBox(trailingEnd(body, SEED), target, t), smoothing: SMOOTHING * (1 - t) };
  }
  return {
    phase: 'contract',
    body,
    second,
    lens: null,
    ink: { outgoing: o.ink * (1 - smoothstep(0, 0.45, t)), incoming: smoothstep(0.55, 1, t) },
    showing: t < 0.5 ? 'from' : 'to',
  };
}

const frameFrom = (o: Origin, to: NavLayout, t: number, via: 'lens' | 'contract') => (via === 'lens' ? lensFrame(o, to, t) : contractFrame(o, to, t));

export function navMorphFrame(from: NavLayout, to: NavLayout, t: number, via: 'lens' | 'contract' = 'lens'): NavMorphFrame {
  if (t <= 0) return restFrame(from, 'from');
  if (t >= 1) return restFrame(to, 'to');
  return frameFrom(layoutOrigin(from), to, t, via);
}

export type NavMorphState = {
  /** 0 is the form it comes from, 1 the form it goes to. */
  t: Spring;
  from: NavLayout;
  to: NavLayout;
  via: 'lens' | 'contract';
  /** A frozen frame the morph goes on from; see `pivotAt`. */
  pivot: NavMorphFrame | null;
  /** Where `t` stood when a third form froze the lens mid-travel; 0 when the pivot is a new start (t was reset). */
  pivotAt: number;
};

/** Resting at `at`. */
export const createNavMorph = (at: NavLayout): NavMorphState => ({
  t: { x: 0, v: 0, target: 0 },
  from: at,
  to: at,
  via: 'lens',
  pivot: null,
  pivotAt: 0,
});

const sameForm = (a: NavLayout, b: NavLayout) => a.form === b.form && a.minimized === b.minimized;
const atRest = (s: NavMorphState) => s.t.v === 0 && s.t.x === s.t.target && (s.t.x === 0 || s.t.x === 1);

export function currentNavFrame(state: NavMorphState): NavMorphFrame {
  const x = clamp01(state.t.x);
  if (x >= 1) return restFrame(state.to, 'to');
  const { pivot } = state;
  if (!pivot) return navMorphFrame(state.from, state.to, x, state.via);
  if (state.pivotAt > 0 && pivot.lens) {
    const origin = layoutOrigin(state.from);
    origin.hold = { box: pivot.lens.box, k0: smoothstep(TRAVEL[0], TRAVEL[1], state.pivotAt) };
    return lensFrame(origin, state.to, x);
  }
  return frameFrom(frameOrigin(pivot), state.to, x, state.via);
}

/**
 * Aims the morph at a layout. At rest it starts a new morph. Aimed back at the layout it came from it turns back.
 * A third form before the lens reaches its place swaps the target (freezing the lens if it is already travelling);
 * once the body grows, the frame it is in becomes the start of a new morph that contracts again.
 */
export function aimNavMorph(state: NavMorphState, next: NavLayout, via: 'lens' | 'contract' = 'lens'): void {
  const { t } = state;
  if (atRest(state)) {
    const current = t.x >= 1 ? state.to : state.from;
    if (sameForm(current, next)) {
      if (t.x >= 1) state.to = next;
      else state.from = next;
      state.pivot = null;
      return;
    }
    state.from = current;
    state.to = next;
    state.via = via;
    state.pivot = null;
    state.pivotAt = 0;
    t.x = 0;
    t.v = 0;
    t.target = 1;
    return;
  }

  if (!state.pivot) {
    if (sameForm(next, state.from)) {
      state.from = next;
      t.target = 0;
      return;
    }
    if (sameForm(next, state.to)) {
      state.to = next;
      t.target = 1;
      return;
    }
    const x = clamp01(t.x);
    if (via === 'lens' && state.via === 'lens' && x < GROW[0]) {
      if (x >= TRAVEL[0]) {
        state.pivot = currentNavFrame(state);
        state.pivotAt = x;
      }
      state.to = next;
      t.target = 1;
      return;
    }
  } else if (sameForm(next, state.to)) {
    state.to = next;
    t.target = 1;
    return;
  }

  state.pivot = currentNavFrame(state);
  state.pivotAt = 0;
  state.to = next;
  state.via = via;
  t.x = 0;
  t.v = 0;
  t.target = 1;
}

/** True while moving. Reduced motion lands in one step. */
export function stepNavMorph(state: NavMorphState, dt: number, reduceMotion = false): boolean {
  const timing = state.via === 'lens' ? NAV_MORPH_TIMING : NAV_MINIMIZE_TIMING;
  const moved = stepSpring(state.t, dt, timing.response, timing.damping, reduceMotion);
  if (!moved && state.t.x >= 1) {
    state.pivot = null;
    state.pivotAt = 0;
  }
  return moved;
}

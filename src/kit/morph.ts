// Capsule → drop → target growth: behaviour, not layout; source and target sizes are passed in.
import { halfMinDp, type VireGlassGeometry, type VireGlassMorph } from 'vireglass';

/** A spring with `response`-second settle time; `damping` < 1 overshoots. `instant` skips
 *  integration entirely, for reduced motion. `rest` scales how near it must be to stop. */
export type Spring = { x: number; v: number; target: number };

/** The step the springs integrate in at most, s. */
export const SPRING_STEP = 1 / 240;

const RATES_HZ = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240];
const SAMPLES_MAX = 16;
export const FRAME_SAMPLES_MIN = 8;
const FRAME_MS_MAX = 50;

const intervals: number[] = [];
let period = 1 / 60;
let lastObserved = Number.NaN;

/** The page's refresh period, s: the median of recent frame intervals, snapped to a canonical rate when within 5 %. */
export const framePeriod = (): number => period;

/** Takes one observed frame interval (ms); intervals over 50 ms are pauses, not frames. */
export function observeFrameInterval(ms: number): void {
  if (!(ms > 0) || ms > FRAME_MS_MAX) return;
  intervals.push(ms);
  if (intervals.length > SAMPLES_MAX) intervals.shift();
  if (intervals.length < FRAME_SAMPLES_MIN) return;
  const sorted = [...intervals].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const rate = RATES_HZ.reduce((best, hz) => (Math.abs(median - 1000 / hz) < Math.abs(median - 1000 / best) ? hz : best));
  const snapped = Math.abs(median - 1000 / rate) <= 0.05 * (1000 / rate);
  period = snapped ? 1 / rate : Math.round(median * 10) / 10 / 1000;
}

/** Forgets what was observed; for tests. */
export function resetFramePeriod(): void {
  intervals.length = 0;
  period = 1 / 60;
  lastObserved = Number.NaN;
}

/** A motion's time in whole frames since its first one, at the period the page had then. */
export type MotionClock = { origin: number; frames: number; period: number; last: number };

/** A clock that starts on the first frame it is handed. */
export const createMotionClock = (): MotionClock => ({ origin: Number.NaN, frames: 0, period: Number.NaN, last: Number.NaN });

/**
 * Runs `step` for every frame due at `now` (ms), each as equal sub-steps of at most 1/240 s that add up to one refresh
 * period, and returns the last answer, or true when no frame is due. The first frame counts as one and time rounds to
 * whole frames, so a frame's state depends on its count, not on the jitter of frame times.
 */
export function stepMotion(clock: MotionClock, now: number, step: (dt: number) => boolean): boolean {
  if (Number.isNaN(clock.origin)) {
    clock.period = framePeriod();
    clock.origin = now - clock.period * 1000;
    clock.frames = 0;
  } else if (now !== lastObserved) {
    observeFrameInterval(now - clock.last);
  }
  lastObserved = now;
  clock.last = now;
  const ms = clock.period * 1000;
  const cap = Math.ceil(FRAME_MS_MAX / ms - 1e-9);
  let due = Math.round((now - clock.origin) / ms) - clock.frames;
  if (due > cap) {
    clock.origin += (due - cap) * ms;
    due = cap;
  }
  const n = Math.ceil(clock.period / SPRING_STEP - 1e-9);
  const dt = clock.period / n;
  let moving = true;
  for (let i = 0; i < due; i += 1) for (let j = 0; j < n; j += 1) moving = step(dt);
  clock.frames += Math.max(due, 0);
  return moving;
}

export function stepSpring(
  s: Spring,
  dt: number,
  response: number,
  damping: number,
  instant = false,
  rest = 1,
): boolean {
  if (instant) {
    const moved = s.x !== s.target || s.v !== 0;
    s.x = s.target;
    s.v = 0;
    return moved;
  }
  const stiffness = ((2 * Math.PI) / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  const h = SPRING_STEP;
  // Fixed step, but not a fixed frame budget: without this, a rare slow frame hands the spring a
  // huge dt and it diverges.
  for (let left = Math.min(dt, 0.05); left > 0; left -= h) {
    const step = Math.min(left, h);
    s.v += (stiffness * (s.target - s.x) - friction * s.v) * step;
    s.x += s.v * step;
  }
  if (Math.abs(s.target - s.x) < 1e-3 * rest && Math.abs(s.v) < 1e-2 * rest) {
    s.x = s.target;
    s.v = 0;
    return false;
  }
  return true;
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export type GrowthPoint = { x: number; y: number };

/** A shape and its position — it has no role of its own; `growthFrame` assigns the role (body, or
 *  what the body is merging into). */
export type GrowthShape = { geometry: VireGlassGeometry; center: GrowthPoint };

/** The springs of a growth, 0…1 (`grow` and `rise` overshoot). Without `height`, `rise` and `focus` they follow `grow`, without
 *  `glow` it follows `shrink`; what each does is in docs/acceptance.md, "Against the reference". */
export type GrowthPhase = { shrink: number; grow: number; height?: number; focus?: number; rise?: number; glow?: number };

export type GrowthInk = {
  /** 0…1: how much of the source's ink is still visible (1) vs. already defocused into the drop (0). */
  outgoing: number;
  /** 0…1: how much of the target's ink has come into focus (0 = not yet, 1 = fully). */
  incoming: number;
};

export type GrowthFrame = {
  /** The shape worth drawing as glass right now: the larger of the two, which supplies the
   *  thickness and the bevel. */
  body: GrowthShape;
  /** The target shape as-is, regardless of role — it drives the response to finger/light while
   *  the glass hasn't become it yet (while `body` is still the drop). */
  grown: GrowthShape;
  /** The second merge shape, ready for `toLensProps`/`toSurfaceUniforms`; `undefined` while the
   *  neck hasn't grown yet or has already retracted. */
  merge: VireGlassMorph | undefined;
  ink: GrowthInk;
};

/** The drop's diameter, as a fraction of the geometric mean of the source's sides. */
const DROP_SIZE = 0.62;
/** The capsule contracts to this fraction of the drop before it is the drop. */
const DROP_CORE = 0.6;
/** How far the body sinks past the drop on closing, per unit of its dip, in source sizes: independent of the menu's distance. */
const SINK_REACH = 2.5;
/** How far the drop sits above the source's centre once formed, in source sizes. */
const DROP_LIFT = 0.07;
/** Without a `rise`, the drop is at the target's centre when 60 % grown. */
const RISE_AHEAD = 0.9;
/** The bud starts smaller than a square root would make it. */
const SEED_GROWTH = 0.8;
/** Up to this much of the swelling, and while the capsule is re-forming, the drop is held inside the capsule's far side. */
const HOLD_UNTIL = 0.4;
const KEEP_UNTIL = 0.3;
const NECK_GAIN = 0.3;
const NECK_RAMP = 4;
const CORNER_EASE_START = 0.55;
const INK_OUT_START = 0.25;
const INK_OUT_END = 0.85;
// What counts as in focus: a spring never quite arrives.
const INK_IN_START = 0.9;
const INK_IN_END = 1;
const FOCUS_DONE = 0.97;

export function growthInk(phase: GrowthPhase): GrowthInk {
  const a = Math.min(Math.max(phase.shrink, 0), 1);
  const b = Math.max(phase.grow, 0);
  // Ink leaves and arrives by going out of focus, not by plain transparency — the blur amount is
  // the drawer's job, this only reports the fraction of focus.
  return {
    outgoing: 1 - smoothstep(INK_OUT_START, INK_OUT_END, a),
    incoming:
      phase.focus === undefined
        ? smoothstep(INK_IN_START, INK_IN_END, b)
        : Math.min(Math.max(phase.focus / FOCUS_DONE, 0), 1),
  };
}

/** The main shape is the larger one by half-size: it supplies the thickness and the bevel, so the
 *  roles swap exactly at equal half-sizes, which is invisible on screen. */
function largerOf(a: GrowthShape, b: GrowthShape): { main: GrowthShape; other: GrowthShape } {
  return halfMinDp(a.geometry) >= halfMinDp(b.geometry) ? { main: a, other: b } : { main: b, other: a };
}

/** `anchor` is the corner shared by source and target: the body pins to it, otherwise the target
 *  would grow out of the drop's center instead of the button's corner. */
export function growthFrame(
  source: GrowthShape,
  target: GrowthShape,
  anchor: GrowthPoint,
  phase: GrowthPhase,
): GrowthFrame {
  const dx = target.center.x - source.center.x;
  const dy = target.center.y - source.center.y;
  const len = Math.hypot(dx, dy) || 1;
  const sourceSize = halfMinDp(source.geometry) * 2;
  const dropSize = DROP_SIZE * Math.sqrt(source.geometry.width * source.geometry.height);
  const lift = DROP_LIFT * sourceSize;
  const drop: GrowthPoint = {
    x: source.center.x + (dx / len) * lift,
    y: source.center.y + (dy / len) * lift,
  };

  const a = Math.min(Math.max(phase.shrink, 0), 1);
  const b = Math.max(phase.grow, 0);
  const reached = Math.min(b, 1);
  const rise = phase.rise ?? reached * (1 + RISE_AHEAD * (1 - reached));
  // Closing, the whole body runs on past the drop's place and settles back.
  const dip = Math.min(rise, 0);
  const reach = Math.hypot(target.center.x - drop.x, target.center.y - drop.y) || 1;
  const sinkLength = -dip * SINK_REACH * sourceSize;
  const sink: GrowthPoint = { x: (-(target.center.x - drop.x) / reach) * sinkLength, y: (-(target.center.y - drop.y) / reach) * sinkLength };
  // The capsule goes into the swelling drop once the drop is a third grown; until then, closing finds it whole.
  const keep = 1 - smoothstep(KEEP_UNTIL, 1, b);
  const d = dropSize;

  const shrunkGeometry: VireGlassGeometry = {
    width: mix(source.geometry.width, DROP_CORE * d, a) * keep,
    height: mix(source.geometry.height, DROP_CORE * d, a) * keep,
    cornerRadius: 0,
  };
  // The source's radius EASES into the drop's rather than being replaced by it outright —
  // otherwise a field with a partial corner radius at rest would render as a full pill.
  shrunkGeometry.cornerRadius = Math.min(
    mix(source.geometry.cornerRadius, halfMinDp(shrunkGeometry), a),
    halfMinDp(shrunkGeometry),
  );
  const shrunk: GrowthShape = {
    geometry: shrunkGeometry,
    center: { x: mix(source.center.x, drop.x, a) + sink.x, y: mix(source.center.y, drop.y, a) + sink.y },
  };

  const seed = d * Math.min(Math.max(phase.glow ?? phase.shrink, 0), 1) ** SEED_GROWTH;
  // The sign of the corner the body pins to once it overshoots. Zero means the anchor sits on the same axis as the
  // source's center, so the overshoot along that axis is centred instead of hugging an edge.
  const cornerX = Math.sign(anchor.x - source.center.x);
  const cornerY = Math.sign(anchor.y - source.center.y);
  const width = mix(seed, target.geometry.width, b);
  const height = mix(seed, target.geometry.height, Math.max(phase.height ?? phase.grow, 0));
  const overX = Math.max(width - target.geometry.width, 0) / 2;
  const overY = Math.max(height - target.geometry.height, 0) / 2;
  const grownGeometry: VireGlassGeometry = { width, height, cornerRadius: 0 };
  grownGeometry.cornerRadius = Math.min(
    mix(halfMinDp(grownGeometry), target.geometry.cornerRadius, smoothstep(CORNER_EASE_START, 1, b)),
    halfMinDp(grownGeometry),
  );
  const grown: GrowthShape = {
    geometry: grownGeometry,
    center: {
      x: mix(drop.x, target.center.x, rise) - cornerX * overX,
      y: mix(drop.y, target.center.y, rise) - cornerY * overY,
    },
  };

  // The drop merges into the capsule's side towards the menu; it does not hang out of the other side.
  const away = { x: -dx / len, y: -dy / len };
  const farSide = (shape: GrowthShape) =>
    shape.center.x * away.x + shape.center.y * away.y + (Math.abs(away.x) * shape.geometry.width + Math.abs(away.y) * shape.geometry.height) / 2;
  const hanging = (farSide(grown) - farSide(shrunk)) * (1 - smoothstep(0, HOLD_UNTIL, b)) * (1 - smoothstep(0.2, 0.6, a));
  if (hanging > 0) grown.center = { x: grown.center.x - away.x * hanging, y: grown.center.y - away.y * hanging };

  const { main, other } = largerOf(grown, shrunk);
  const neck = NECK_GAIN * sourceSize * Math.min(a * NECK_RAMP, 1) * keep;
  const united = neck > 0.01 && other.geometry.width > 0.5 && other.geometry.height > 0.5;

  return {
    body: main,
    grown,
    merge: united
      ? {
          offsetX: other.center.x - main.center.x,
          offsetY: other.center.y - main.center.y,
          width: other.geometry.width,
          height: other.geometry.height,
          cornerRadius: other.geometry.cornerRadius,
          smoothing: neck,
        }
      : undefined,
    ink: growthInk(phase),
  };
}

export type GrowthState = { shrink: Spring; grow: Spring; height: Spring; focus: Spring; rise: Spring; glow: Spring };

export const createGrowthState = (): GrowthState => ({
  shrink: { x: 0, v: 0, target: 0 },
  grow: { x: 0, v: 0, target: 0 },
  height: { x: 0, v: 0, target: 0 },
  focus: { x: 0, v: 0, target: 0 },
  rise: { x: 0, v: 0, target: 0 },
  glow: { x: 0, v: 0, target: 0 },
});

/** Every spring at rest on `x`: the surface held open (1) or closed (0) with nothing moving. */
export const heldGrowthState = (x: 0 | 1): GrowthState => ({
  shrink: { x, v: 0, target: x },
  grow: { x, v: 0, target: x },
  height: { x, v: 0, target: x },
  focus: { x, v: 0, target: x },
  rise: { x, v: 0, target: x },
  glow: { x, v: 0, target: x },
});

/** The springs where an opening is when its width has reached `grow` (or, while that is 0, its capsule has reached `shrink`),
 *  for holding a surface part of the way open on the same curves it runs. */
export function growthStateAt(reach: { shrink: number; grow: number }, timing: GrowthTiming = DEFAULT_GROWTH_TIMING): GrowthState {
  if (reach.grow >= 1) return heldGrowthState(1);
  const state = createGrowthState();
  const dt = 1 / 240;
  for (let i = 0; i < 1200; i += 1) {
    if (reach.grow > 0 ? state.grow.x >= reach.grow : state.shrink.x >= reach.shrink) break;
    stepGrowth(state, dt, true, false, timing);
  }
  return state;
}

export const growthPhase = (state: GrowthState): GrowthPhase => ({
  shrink: state.shrink.x,
  grow: state.grow.x,
  height: state.height.x,
  focus: state.focus.x,
  rise: state.rise.x,
  glow: state.glow.x,
});

/** Durations belong to the client: the default is the menu's (docs/acceptance.md, N9). */
export type GrowthTiming = {
  shrinkOpen: number;
  shrinkClose: number;
  growOpen: number;
  growClose: number;
  /** < 1 gives the target a slight overshoot on open; closing never overshoots. */
  growDampingOpen: number;
  /** The height's swelling, which trails the width's and does not overshoot. */
  heightOpen: number;
  heightDampingOpen: number;
  heightClose: number;
  /** The body's rise toward the target's centre: it overshoots it on open and, closing, runs on past the drop (damping < 1). */
  riseOpen: number;
  riseDampingOpen: number;
  riseClose: number;
  riseDampingClose: number;
  /** The content coming into focus once the body is nearly at size, and leaving it first on close. */
  focusOpen: number;
  focusClose: number;
  /** The glass lighting up as the drop forms, and going back to its resting body after the capsule is back. */
  glowOpen: number;
  glowClose: number;
};

export const DEFAULT_GROWTH_TIMING: GrowthTiming = {
  shrinkOpen: 0.24,
  shrinkClose: 0.145,
  growOpen: 0.47,
  growClose: 0.45,
  growDampingOpen: 0.68,
  heightOpen: 0.43,
  heightDampingOpen: 1,
  heightClose: 0.51,
  riseOpen: 0.445,
  riseDampingOpen: 0.42,
  riseClose: 0.55,
  riseDampingClose: 0.55,
  focusOpen: 0.38,
  focusClose: 0.15,
  glowOpen: 0.08,
  glowClose: 0.6,
};

const POPOVER_OPEN = 0.38;
const POPOVER_CLOSE = 0.4;

/** The pace the menu's growth had before it was fitted to the reference: the popover keeps it, a sheet slows it
 *  (`SHEET_GROWTH_TIMING`) and a change of form moves at its opening response (`FORM_MORPH_TIMING`). */
export const POPOVER_GROWTH_TIMING: GrowthTiming = {
  shrinkOpen: 0.21,
  shrinkClose: 0.14,
  growOpen: POPOVER_OPEN,
  growClose: POPOVER_CLOSE,
  growDampingOpen: 0.72,
  heightOpen: POPOVER_OPEN,
  heightDampingOpen: 0.72,
  heightClose: POPOVER_CLOSE,
  riseOpen: POPOVER_OPEN,
  riseDampingOpen: 0.72,
  riseClose: POPOVER_CLOSE,
  riseDampingClose: 0.55,
  focusOpen: 0.38,
  focusClose: 0.1,
  glowOpen: 0.08,
  glowClose: 0.3,
};

const GROW_DAMPING_CLOSE = 1;
const SHRINK_DAMPING = 1;
const GROW_STARTS_AT = 0.8;
const SHRINK_RETURNS_AT = 0.3;
const FOCUS_STARTS_AT = 0.7;
const FOCUS_DAMPING = 1;
// A tail of 0.8 % of a rise, a light or a focus is not seen, and waiting for it would hold the surface out.
const LOOSE_REST = 8;

/** Growth starts once the drop has gathered, and the reverse on close. `reduceMotion` turns off
 *  the spring entirely: both phases jump straight to their target in one step, with no overshoot
 *  and no defocus phase. */
export function stepGrowth(
  state: GrowthState,
  dt: number,
  open: boolean,
  reduceMotion = false,
  timing: GrowthTiming = DEFAULT_GROWTH_TIMING,
): boolean {
  const { shrink, grow, height, focus, rise, glow } = state;
  if (reduceMotion) {
    shrink.target = open ? 1 : 0;
    grow.target = open ? 1 : 0;
    height.target = open ? 1 : 0;
    focus.target = open ? 1 : 0;
    rise.target = open ? 1 : 0;
  } else if (open) {
    shrink.target = 1;
    if (shrink.x > GROW_STARTS_AT) {
      grow.target = 1;
      height.target = 1;
      rise.target = 1;
    }
    if (grow.x > FOCUS_STARTS_AT) focus.target = 1;
  } else {
    grow.target = 0;
    height.target = 0;
    rise.target = 0;
    focus.target = 0;
    if (grow.x < SHRINK_RETURNS_AT) shrink.target = 0;
  }
  const movedShrink = stepSpring(
    shrink,
    dt,
    open ? timing.shrinkOpen : timing.shrinkClose,
    SHRINK_DAMPING,
    reduceMotion,
  );
  const movedGrow = stepSpring(
    grow,
    dt,
    open ? timing.growOpen : timing.growClose,
    open ? timing.growDampingOpen : GROW_DAMPING_CLOSE,
    reduceMotion,
  );
  const movedHeight = stepSpring(
    height,
    dt,
    open ? timing.heightOpen : timing.heightClose,
    open ? timing.heightDampingOpen : GROW_DAMPING_CLOSE,
    reduceMotion,
  );
  glow.target = reduceMotion ? (open ? 1 : 0) : shrink.x;
  const movedGlow = stepSpring(glow, dt, open ? timing.glowOpen : timing.glowClose, 1, reduceMotion, LOOSE_REST);
  const movedRise = stepSpring(
    rise,
    dt,
    open ? timing.riseOpen : timing.riseClose,
    open ? timing.riseDampingOpen : timing.riseDampingClose,
    reduceMotion,
    LOOSE_REST,
  );
  const movedFocus = stepSpring(focus, dt, open ? timing.focusOpen : timing.focusClose, FOCUS_DAMPING, reduceMotion, LOOSE_REST);
  return movedShrink || movedGrow || movedHeight || movedRise || movedFocus || movedGlow;
}

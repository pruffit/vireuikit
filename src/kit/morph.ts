// Two-phase "capsule → drop → target" growth: atom behavior, not layout. The body contracts into
// a drop, a neck grows from its side toward the target, the drop grows into the target with a
// slight overshoot; closing retraces the same path in reverse, because the model holds no
// direction, only the current phase. Source and target sizes are layout, supplied as parameters.
import { halfMinDp, type VireGlassGeometry, type VireGlassMorph } from 'vireglass';

/** A spring with `response`-second settle time; `damping` < 1 overshoots. `instant` skips
 *  integration entirely, for reduced motion. */
export type Spring = { x: number; v: number; target: number };

export function stepSpring(
  s: Spring,
  dt: number,
  response: number,
  damping: number,
  instant = false,
): boolean {
  if (instant) {
    const moved = s.x !== s.target || s.v !== 0;
    s.x = s.target;
    s.v = 0;
    return moved;
  }
  const stiffness = ((2 * Math.PI) / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  const h = 1 / 240;
  // Fixed step, but not a fixed frame budget: without this, a rare slow frame hands the spring a
  // huge dt and it diverges.
  for (let left = Math.min(dt, 0.05); left > 0; left -= h) {
    const step = Math.min(left, h);
    s.v += (stiffness * (s.target - s.x) - friction * s.v) * step;
    s.x += s.v * step;
  }
  if (Math.abs(s.target - s.x) < 1e-3 && Math.abs(s.v) < 1e-2) {
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

/** `shrink` — capsule → drop, no overshoot. `grow` — drop → target; may exceed 1 for the
 *  overshoot. Both are read as-is; `stepGrowth` owns the bounds and the handoff between them. */
export type GrowthPhase = { shrink: number; grow: number };

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

/** The drop's size — a fraction of the source's diameter, with headroom for the neck. */
const DROP_DIAMETER = 1.1;
/** How far the drop travels from the source toward the target, as a fraction of the source's diameter. */
const DROP_LIFT = 0.5;
const NECK_GAIN = 0.3;
const NECK_RAMP = 4;
const CORNER_EASE_START = 0.55;
const INK_OUT_END = 0.4;
const INK_IN_START = 0.45;
const INK_IN_END = 0.95;

export function growthInk(phase: GrowthPhase): GrowthInk {
  const a = Math.min(Math.max(phase.shrink, 0), 1);
  const b = Math.max(phase.grow, 0);
  // Ink leaves and arrives by going out of focus, not by plain transparency — the blur amount is
  // the drawer's job, this only reports the fraction of focus.
  return {
    outgoing: 1 - smoothstep(0, INK_OUT_END, a),
    incoming: smoothstep(INK_IN_START, INK_IN_END, b),
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
  const lift = DROP_LIFT * sourceSize;
  const drop: GrowthPoint = {
    x: source.center.x + (dx / len) * lift,
    y: source.center.y + (dy / len) * lift,
  };

  const a = Math.min(Math.max(phase.shrink, 0), 1);
  const b = Math.max(phase.grow, 0);
  const keep = Math.max(1 - b, 0);
  const d = DROP_DIAMETER * sourceSize;

  const shrunkGeometry: VireGlassGeometry = {
    width: mix(source.geometry.width, 0.6 * d, a) * keep,
    height: mix(source.geometry.height, 0.6 * d, a) * keep,
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
    center: { x: mix(source.center.x, drop.x, a), y: mix(source.center.y, drop.y, a) },
  };

  const seed = d * Math.sqrt(a);
  // The sign of the corner the body pins to. Zero means the anchor sits on the same axis as the
  // source's center, so growth along that axis centers instead of hugging an edge.
  const cornerX = Math.sign(anchor.x - source.center.x);
  const cornerY = Math.sign(anchor.y - source.center.y);
  const edgeX = mix(drop.x + cornerX * (seed / 2), anchor.x, Math.min(b, 1));
  const edgeY = mix(drop.y + cornerY * (seed / 2), anchor.y, Math.min(b, 1));
  const width = mix(seed, target.geometry.width, b);
  const height = mix(seed, target.geometry.height, b);
  const grownGeometry: VireGlassGeometry = { width, height, cornerRadius: 0 };
  grownGeometry.cornerRadius = Math.min(
    mix(halfMinDp(grownGeometry), target.geometry.cornerRadius, smoothstep(CORNER_EASE_START, 1, b)),
    halfMinDp(grownGeometry),
  );
  const grown: GrowthShape = {
    geometry: grownGeometry,
    center: { x: edgeX - cornerX * (width / 2), y: edgeY - cornerY * (height / 2) },
  };

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

export type GrowthState = { shrink: Spring; grow: Spring };

export const createGrowthState = (): GrowthState => ({
  shrink: { x: 0, v: 0, target: 0 },
  grow: { x: 0, v: 0, target: 0 },
});

export const growthPhase = (state: GrowthState): GrowthPhase => ({
  shrink: state.shrink.x,
  grow: state.grow.x,
});

/** Durations are client-specific: this set is tuned for the capsule-to-menu transition, and an
 *  atom at a different scale (an icon opening into a sheet) isn't obligated to match it. The
 *  shape of the transition is shared regardless. */
export type GrowthTiming = {
  shrinkOpen: number;
  shrinkClose: number;
  growOpen: number;
  growClose: number;
  /** < 1 gives the target a slight overshoot on open; closing never overshoots. */
  growDampingOpen: number;
};

export const DEFAULT_GROWTH_TIMING: GrowthTiming = {
  shrinkOpen: 0.38,
  shrinkClose: 0.3,
  growOpen: 0.46,
  growClose: 0.4,
  growDampingOpen: 0.72,
};

const GROW_DAMPING_CLOSE = 1;
const SHRINK_DAMPING = 1;
const GROW_STARTS_AT = 0.8;
const SHRINK_RETURNS_AT = 0.12;

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
  const { shrink, grow } = state;
  if (reduceMotion) {
    shrink.target = open ? 1 : 0;
    grow.target = open ? 1 : 0;
  } else if (open) {
    shrink.target = 1;
    if (shrink.x > GROW_STARTS_AT) grow.target = 1;
  } else {
    grow.target = 0;
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
  return movedShrink || movedGrow;
}

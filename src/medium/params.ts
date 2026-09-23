import { neutralSpecies } from './species';

// Medium parameters — the single source of truth for the web runtime (`web/medium.ts`) and,
// later, an Android one: the numbers are one set, the platforms only differ in how they feed them
// into uniforms.
export type VireUIKitMediumChannel = readonly [number, number, number];

export type VireUIKitMediumParams = {
  /** 1/s — how fast the TRACK density decays per second. Water (vapor+condensate) does not decay:
   *  it is a conserved volume, only moving between phases and being transported. */
  decay: number;
  /** Spatial frequency of the curl-noise potential, 1/px of the simulation grid. */
  curlFreq: number;
  /** Drift speed of the noise domain over time, 1/s. */
  curlSpeed: number;
  /** Velocity field scale, grid-px/s — how far the smoke can be carried in a second. */
  advectSpeed: number;
  /** Turbulence gate, 0…1 (playback drives it: playing is alive, paused cools down). The
   *  per-frame value is computed by `createMediumDynamics` (`dynamics.ts`) — it arrives here
   *  already resolved. */
  turbulence: number;
  /** 1/s — the fraction of vapor EXCESS above `condensationFloor` that turns into condensate every
   *  second from background seeding: weak, everywhere, all the time — the chamber is never
   *  perfectly clean. */
  condensationRate: number;
  /** Vapor density (in seed-density units, a spot's peak ≈1) below which condensation does not
   *  happen at all — only the excess above it condenses. Without a floor, the condensate would
   *  exactly retrace the vapor spot's shape (the same outline, or softer from growth blur), and
   *  the two phases would have nowhere to visually diverge: vapor is already soft, so the floor
   *  concentrates condensate in dense turbulence cores, leaving the sparse vapor around it
   *  uncondensed. Keep it NOTICEABLY below the settled mean vapor level (turbulence stirs spots
   *  into a nearly flat background of ~0.3 over a few minutes — a known limit of the numerical
   *  advection): a floor above that mean eventually stops finding any excess at all, and
   *  condensation dies out for good. */
  condensationFloor: number;
  /** 1/s — the fraction of condensate evaporating back into vapor. Larger than the condensation
   *  rate: at equilibrium most of the water stays vapor, which is the "supersaturated" one. */
  evaporationRate: number;
  /** grid-px/s — condensate drift downward, on top of the shared velocity field: gravity touches
   *  droplets and leaves vapor alone. */
  condensateSettleSpeed: number;
  /** 1/s — the rate at which a droplet blends with its grid neighbors. There is no separate age
   *  counter: the blend repeats every frame, and whatever has survived more frames ends up more
   *  blended with its neighbors on its own — that IS "growth". Keep it NOTICEABLY below
   *  `evaporationRate`: over a droplet's average lifetime (1/evaporationRate) only a small
   *  fraction should get to blend — otherwise the blur outruns evaporation and the whole grid
   *  levels into flat fog before a droplet gets a chance to return to vapor (visible by eye: the
   *  contrast between "a patch of droplets" and the vapor background disappears within seconds). */
  condensateSpreadRate: number;
  /** 0…1 — how much of the local vapor hue shows through in the condensate. Droplets carry no
   *  color of their own (droplets scatter light rather than tint it) — this is only a faint hint
   *  of the surroundings. */
  condensateTint: number;
  /** Condensate's visibility multiplier in the Oklab mix relative to vapor at equal density —
   *  droplets hold a small share of the water's mass, but they are mostly what's visible (as in a
   *  real cloud: vapor is transparent, droplets create the visibility). */
  condensateGain: number;
  /** Near-white sRGB tone of droplets with no hue seeding (`condensateTint=0`) — droplets scatter
   *  light rather than color it. */
  condensateColor: VireUIKitMediumChannel;
  /** Each vapor species' hue, sRGB 0…1. Derived as a family around one tone (`speciesFamily`),
   *  not picked as three separate colors — see `species.ts`. */
  channelColors: readonly [VireUIKitMediumChannel, VireUIKitMediumChannel, VireUIKitMediumChannel];
  /** The platform's neutral tone — what the medium is, alone, with no source playing. */
  baseColor: VireUIKitMediumChannel;
  /** Background weight in the Oklab mix: keeps the platform tone visible even where the smoke is dense. */
  baseWeight: number;
  /** Field-sample scale for the far depth plane, k ≥ 1 (see `MEDIUM_COMPOSITE_SHADER`): the far
   *  plane reads the SAME vapor/condensate field as the near plane, at `src * k + offset` instead
   *  of `src`. A larger k folds more of the field into the same screen area, so the identical
   *  evolving field reads as both finer-grained structure (features occupy fewer screen-px) and,
   *  because the field's own motion maps to screen motion as v/k, slower apparent motion — parallax
   *  and scale-of-structure from one number, with no second simulation. Measured against
   *  `check-medium.mjs`'s parallax gate (a cross-correlation best-shift, not a centroid — see the
   *  gate's own comment on why): 1.6 puts the far/near screen-speed ratio at 0.630, matching the
   *  naive prediction 1/1.6 = 0.625 almost exactly, comfortably inside a band that reads as depth
   *  without the far plane looking frozen. */
  depthFarScale: number;
  /** Offset into the shared field for the far plane, as a FRACTION of the grid's own width/height
   *  (per axis) rather than a fixed grid-px value — the field wraps (`gl.REPEAT`), so a fixed
   *  grid-px offset's EFFECTIVE (wrapped) distance from zero depends on whatever grid size it
   *  happens to run at, and can land close to zero by accident at a size nobody tested against.
   *  (This shipped once as `[41, 67]` grid-px: harmless at the 96px grid the depth gates tested
   *  against, but 67 wraps to just 5px at the 72px grid height this package's own README uses as
   *  its example — the far plane nearly re-read the near one, exactly the echo depth exists to
   *  avoid.) A fraction keeps the wrapped distance proportional to the grid at any size — see
   *  `depthFarOffsetPx` below and `check-medium.mjs`'s decorrelation gate, which measures this
   *  directly at the README's own 128x72. */
  depthFarOffsetFrac: readonly [number, number];
  /** Grid-px tap radius for the far plane's 4-tap box blur. A spatial average cannot raise local
   *  variance, so the same blur that softens the far plane's edges also, by construction, lowers
   *  its measured contrast — one mechanism for both aerial-perspective cues (no separate contrast
   *  knob exists). 0 disables it (the near plane stays sharp). Measured: reading the far plane's
   *  own scale/offset with no blur already drops contrast ~6% (a fixed offset can land on a
   *  locally denser or sparser patch of a field that isn't spatially uniform); this radius takes
   *  the total to 24% — see the aerial-perspective gate, whose two thresholds isolate blur's own
   *  share from that baseline. */
  depthFarBlurRadius: number;
  /** The far plane's share of the mix, relative to the near plane's implicit 1 — aerial
   *  perspective's other half: even at equal density the far plane must not compete with the near
   *  one for attention. */
  depthFarWeight: number;
  /** grid-px/s — a small downward drift added to VAPOR's own velocity, on top of the shared
   *  curl-noise field (condensate already settles faster via `condensateSettleSpeed`). An order of
   *  magnitude below it so the gas reads as "barely noticeable" drift rather than visibly falling.
   *  ADDS NO DENSITY: on this periodic (`gl.REPEAT`) grid a uniform drift only ever translates the
   *  field and wraps it back in at the top — it cannot accumulate mass anywhere, the way a real
   *  floor would. It is a motion cue (which way is down), not a source of "denser at the bottom" —
   *  that reading comes entirely from `gravityBottomBoost` below. See
   *  `check-medium.mjs`'s vapor-drift gate, which checks DIRECTION over a short window rather than
   *  a density ratio, for exactly this reason. */
  gravityVaporDrift: number;
  /** Density boost at the very bottom of the frame, added on top of 1 — a COMPOSITING-only effect:
   *  it scales how the already-conserved vapor/condensate density is DISPLAYED, never the
   *  simulated buffers themselves, so it cannot threaten the water-conservation invariant by
   *  construction, and — unlike `gravityVaporDrift` above — this is the mechanism that actually
   *  produces "denser at the bottom": it is a steady-state property of the compositing math, true
   *  from the very first frame, independent of any warmup or mixing time (see
   *  `check-medium.mjs`'s boost gate, which measures it with zero simulated steps for exactly that
   *  reason). Large in absolute terms because `baseWeight` (0.9) dominates the Oklab mix wherever
   *  gas density is thin — a small boost gets diluted into an invisible change in the final color;
   *  measured this large to register as a real, visible band against that dilution. */
  gravityBottomBoost: number;
  /** Fraction of frame height (0 top, 1 bottom) where the bottom boost starts ramping in via
   *  `smoothstep`. The brief asks for a denser LAYER at the floor of the chamber, not a boost that
   *  reaches halfway up the frame — kept in the bottom quarter. */
  gravityBottomBoostStart: number;
};

const BASE_COLOR: VireUIKitMediumChannel = [0.07, 0.08, 0.1];

export const MEDIUM_DEFAULTS: VireUIKitMediumParams = {
  decay: 0.06,
  curlFreq: 0.045,
  curlSpeed: 0.12,
  advectSpeed: 26,
  turbulence: 1,
  condensationRate: 0.18,
  condensationFloor: 0.12,
  evaporationRate: 0.2,
  condensateSettleSpeed: 8,
  condensateSpreadRate: 0.08,
  condensateTint: 0.2,
  condensateGain: 5,
  condensateColor: [0.94, 0.95, 0.97],
  channelColors: neutralSpecies(BASE_COLOR),
  baseColor: BASE_COLOR,
  baseWeight: 0.9,
  depthFarScale: 1.6,
  depthFarOffsetFrac: [0.47, 0.53],
  depthFarBlurRadius: 5,
  depthFarWeight: 0.5,
  gravityVaporDrift: 0.6,
  gravityBottomBoost: 2,
  gravityBottomBoostStart: 0.75,
};

/**
 * Resolves the far plane's fractional offset (`depthFarOffsetFrac`) into grid-px for a GIVEN grid
 * size — pure and exported so the wrap-safety it exists for is directly testable (see
 * `medium-depth-offset.test.ts`) without spinning up a WebGL2 context. Per-axis: `gridWidth` and
 * `gridHeight` are independent, and a non-square grid (the README's own 128x72 example) shouldn't
 * distort one axis relative to the other.
 */
export function depthFarOffsetPx(
  offsetFrac: readonly [number, number],
  gridWidth: number,
  gridHeight: number,
): readonly [number, number] {
  return [offsetFrac[0] * gridWidth, offsetFrac[1] * gridHeight];
}

/**
 * How far a value lands from the nearest wrap boundary (0 or `period`) on a periodic axis of the
 * given `period` — the quantity that actually matters for decorrelation, not the raw offset value
 * itself (a raw offset near the period is effectively a tiny one once the field wraps). Exported
 * for the same reason as `depthFarOffsetPx`: a plain number, testable without a GPU.
 */
export function wrappedDistanceFromZero(value: number, period: number): number {
  const wrapped = ((value % period) + period) % period;
  return Math.min(wrapped, period - wrapped);
}

/** The material probe can't see texture finer than this: there is no gain in a denser simulation
 *  grid than the probe's own floor. */
export const MEDIUM_PROBE_FLOOR_PX = 22;

/** Device-px per simulation grid cell by default — noticeably coarser than the probe floor;
 *  sharpening the detail visible right next to the glass is a later increment (emission and
 *  palette). */
export const MEDIUM_DEFAULT_CELL_PX = 26;

/**
 * The geometry of one track stamp (`emit-shader.ts`), in FRACTIONS of `min(gridW, gridH)` rather
 * than pixels — so a preset doesn't depend on the simulation grid's resolution. Two presets:
 * alpha is a thick, short, straight track; beta is a thin, long, ragged one. The third, natural,
 * is dim and short, for the occasional background track at rest (not tied to cover art).
 */
export type VireUIKitMediumTrackPreset = {
  lengthFrac: number;
  headWidthFrac: number;
  tailWidthFrac: number;
  /** Amplitude of the path's sideways noise, as a fraction of `min(gridW, gridH)`; 0 = a straight thread. */
  raggedFrac: number;
  raggedFreq: number;
  /** How far the tail has settled downward, as a fraction of `min(gridW, gridH)`. */
  settleFrac: number;
  /** How much dimmer the tail is than the head, 0…1. */
  tailDim: number;
  intensity: number;
};

export const MEDIUM_TRACK_PRESETS: Readonly<
  Record<'alpha' | 'beta' | 'natural', VireUIKitMediumTrackPreset>
> = {
  alpha: {
    lengthFrac: 0.22,
    headWidthFrac: 0.05,
    tailWidthFrac: 0.12,
    raggedFrac: 0,
    raggedFreq: 0,
    settleFrac: 0.02,
    tailDim: 0.55,
    intensity: 1.15,
  },
  beta: {
    lengthFrac: 0.42,
    headWidthFrac: 0.018,
    tailWidthFrac: 0.05,
    raggedFrac: 0.045,
    raggedFreq: 5,
    settleFrac: 0.05,
    tailDim: 0.45,
    intensity: 0.85,
  },
  natural: {
    lengthFrac: 0.13,
    headWidthFrac: 0.02,
    tailWidthFrac: 0.04,
    raggedFrac: 0.02,
    raggedFreq: 4,
    settleFrac: 0.02,
    tailDim: 0.5,
    intensity: 0.4,
  },
};

/** Turbulence at rest/paused/with no active track — the "slow drift" baseline shared by all three
 *  neutral states (they differ from each other in other ways, not in this number). */
// Rest has to look like it's actually resting: mixing happens over minutes, not seconds. A
// slower flow also accumulates less numerical diffusion.
export const MEDIUM_DRIFT_TURBULENCE = 0.045;

/** Turbulence range during playback: the low end is a quiet stretch of the track, the high end is
 *  peak amplitude. */
export const MEDIUM_PLAYING_TURBULENCE_RANGE: readonly [number, number] = [0.55, 1.15];

/** Turbulence smoothing time constant, seconds: both ramping up on play and cooling down on pause
 *  go through this filter — smooth, never a jump. */
export const MEDIUM_TURBULENCE_TAU = 2.5;

/** Emission cadence — once every this many beats, not on every beat: at 120–180 BPM that is
 *  0.5–0.75 Hz, an order of magnitude below the WCAG 2.3.1 photosensitivity ceiling (3 Hz). */
export const MEDIUM_EMISSION_BEATS = 4;

/** Fraction of the beats that actually get an emission — breaks up the exact periodicity (a
 *  metronome-perfect pulse reads as mechanical) without moving the average rate. */
export const MEDIUM_EMISSION_PROBABILITY = 0.55;

/** Emergency floor between two emissions, seconds — a safeguard for the same WCAG 2.3.1
 *  requirement, independent of `MEDIUM_EMISSION_BEATS`/BPM: even a mistake in the other constants
 *  can't flash faster than this. */
export const MEDIUM_MIN_EMISSION_INTERVAL = 1.2;

/** Average interval between solitary "background emission" tracks at rest, seconds, plus a random
 *  `MEDIUM_NATURAL_JITTER` on top — rare, with no discernible rhythm. */
export const MEDIUM_NATURAL_INTERVAL = 25;
export const MEDIUM_NATURAL_JITTER = 35;

/** The sensitive layer — fractions of height, top to bottom. Above it there isn't enough
 *  supersaturation for a track to appear at all, so background emission is only ever visible here. */
export const MEDIUM_SENSITIVE_TOP = 0.55;
export const MEDIUM_SENSITIVE_BOTTOM = 0.95;

/** Per-emission depth range applied to a track's width (`headWidthFrac`/`tailWidthFrac`), far…near.
 *  The same knob reads as both "thin" and "soft": a Gaussian stamp's edge steepness scales with its
 *  own width (`emit-shader.ts`'s only extent parameter), so shrinking it for a far track thins and
 *  softens it in the same stroke — there is no second knob to hang an independent softness number
 *  on. Floored at 0.55: below that a far `alpha` track's head narrows past what MacCormack's own
 *  numerical smoothing already blurs it to, and the depth cue disappears into that noise floor. */
export const MEDIUM_TRACK_DEPTH_WIDTH_RANGE: readonly [number, number] = [0.55, 1];

/** Per-emission depth range applied to a track's intensity, far…near — "dim". Floored at 0.4, not
 *  lower: a far track still has to clear `MEDIUM_DEFAULTS.condensationFloor`'s excess threshold
 *  often enough to read as a track, or depth would look like tracks randomly failing to spawn
 *  rather than fading into the distance. */
export const MEDIUM_TRACK_DEPTH_INTENSITY_RANGE: readonly [number, number] = [0.4, 1];

import { neutralSpecies } from './species';

// Medium parameters — the single source of truth for the web runtime (`web/medium.ts`) and,
// later, an Android one: the numbers are one set, the platforms only differ in how they feed them
// into uniforms.
export type VireUIKitMediumChannel = readonly [number, number, number];

/**
 * A static light source, as data — the chamber's illumination is a separate entity from the gas it
 * lights (see `MEDIUM_COMPOSITE_SHADER`): the medium itself is dark, and everything visible is
 * light scattered by mist, condensate and tracks inside a light's reach.
 */
export type VireUIKitMediumLight = {
  /** Fraction of the frame, 0…1 both axes. `y=0` is the chamber's visual BOTTOM edge, `y=1` the
   *  top — the same convention `gravityBottomBoost` already uses in `MEDIUM_COMPOSITE_SHADER`. */
  position: readonly [number, number];
  /** Unit direction (any nonzero vector is normalized before upload) the light points into the
   *  chamber, in the SAME up-is-positive-y convention as `position`. Kept off the exact
   *  vertical/horizontal axes by default: an on-axis beam edge is itself axis-aligned, which is
   *  exactly the straight-line artifact `check:medium`'s isotropy gate polices, and an angled shaft
   *  also reads more like a real illuminated volume than a spotlight aimed straight down a wall. */
  direction: readonly [number, number];
  /** Half-angle of the light's cone, radians. Wide (close to a right angle or beyond) for an edge
   *  strip that washes the whole chamber width — there the shaping comes from distance falloff, not
   *  a cone edge — narrow for a spotlight, where the cone edge IS the visible beam. */
  coneAngle: number;
  /** 1/(fraction of frame height) — how fast illumination drops off with distance from the light.
   *  Distance is normalized by frame HEIGHT (not a raw fraction of each axis) so a circular pool of
   *  light stays circular on screen regardless of the frame's aspect ratio. */
  falloff: number;
  /** sRGB 0…1. Defaults to a cool neutral; a caller deriving a light rig from cover art applies
   *  `speciesFamily`/`characterOf` (`species.ts`) to THESE colors now, not to `channelColors` —
   *  see the comment on `channelColors` below. */
  color: VireUIKitMediumChannel;
  /** ≥0 multiplier on this light's contribution. 0 turns it off without removing it from the array. */
  intensity: number;
};

/** How many lights `MEDIUM_COMPOSITE_SHADER` reads — a fixed, small count of flat uniforms
 *  (`u_light0*`/`u_light1*`/`u_light2*`), the same pattern `u_lab0/1/2` already uses for species:
 *  `setUniform` (vireglass/web) has no array form, only scalars up to vec4. A `lights` array
 *  shorter than this is padded with intensity-0 entries; a longer one is truncated. */
export const MEDIUM_MAX_LIGHTS = 3;

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
  /** Multiplier on the ambient curl field's OWN x-component, added to settling UNCONDITIONALLY
   *  (not gated by `turbulence` the way the shared velocity field is) — see
   *  MEDIUM_ADVECT_VELOCITY_SETTLE in advect-shader.ts. Without it, a droplet falling at a constant
   *  `condensateSettleSpeed` with only a turbulence-gated sideways push traces a near-straight
   *  vertical line whenever turbulence is low (rest/paused: 0.045, over 20x below the gated push
   *  needed to bend the fall) — many droplets in nearby columns then read as parallel vertical
   *  streaks, one of the axis-aligned artifacts `check-medium.mjs`'s isotropy gate measures. Reuses
   *  the SAME seamless curl field `vel` already reads rather than a second noise system, so it adds
   *  no new seam of its own. Calibrated against that gate at the product's default grid (1920x952,
   *  74x37) — see the gate's own report for the measured ratio at this value. */
  condensateSettleWiggle: number;
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
  /** Each vapor species' hue, sRGB 0…1, folded into the dark ambient mix underneath the lit layer
   *  (see `MEDIUM_COMPOSITE_SHADER`) — a minor, near-neutral hint by default. Colour now lives on
   *  `lights`, not here: a real chamber's gas is invisible, only what scatters light reads at all
   *  (see `channelScatter`). Kept for callers that still want a tinted ambient base, and because the
   *  isotropy/contrast/depth gates in `check-medium.mjs` measure structure through it directly. */
  channelColors: readonly [VireUIKitMediumChannel, VireUIKitMediumChannel, VireUIKitMediumChannel];
  /** How strongly each vapor species scatters light, relative to the others — what a species IS,
   *  now that colour lives on `lights` (see `channelColors`). `[1, 1, 1]` (equal) by default; a
   *  caller can make one species read as denser mist than another without touching its hue. */
  channelScatter: VireUIKitMediumChannel;
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
  /** Grid-px radius of the far plane's 8-tap ring blur, rotated so no tap pair lies on a grid
   *  axis. A spatial average cannot raise local
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
  /** Static lights — the chamber's illumination, entirely separate from the gas (see
   *  `VireUIKitMediumLight`). Padded/truncated to `MEDIUM_MAX_LIGHTS` by the web runtime. */
  lights: readonly VireUIKitMediumLight[];
  /** ≥0 — master strength of the procedural mist grain (`MEDIUM_COMPOSITE_SHADER`'s `vgGrain`): the
   *  countless fine droplets the reference shows, stateless and per-pixel rather than simulated, so
   *  it costs one extra pass of cheap hashing, not a fourth buffer. 0 disables it outright. */
  mistGrainAmount: number;
  /** Content-px per grain cell — the brief's "1–2 px" droplets, independent of the simulation grid
   *  (the grain is evaluated once per screen pixel in the composite, not per simulation cell). */
  mistGrainCellPx: number;
  /** Content-px/s the grain drifts downward — sedimentation, on top of the cheap per-cell wobble
   *  `mistGrainJitterPx`/`mistGrainJitterFreq` stand in for curl-field nudging (see the comment on
   *  `vgGrain` in `composite-shader.ts` for why a full curl-noise sample per screen pixel was too
   *  costly for a one-pass, stateless effect). */
  mistGrainFallSpeed: number;
  /** Content-px amplitude of the per-cell wobble that reads as the mist being nudged by turbulence,
   *  without sampling the actual curl field per screen pixel. */
  mistGrainJitterPx: number;
  /** Multiplies the fall distance to get each cell's wobble phase — a cheap substitute for a real
   *  clock uniform: the grain already has a monotonic, wrapped fall offset to reuse (see
   *  `MEDIUM_GRAIN_FALL_WRAP_PX`), so no second time uniform is needed just for the wobble. */
  mistGrainJitterFreq: number;
  /** 0…1 — a track's minimum visibility regardless of local illumination, added to the light
   *  reaching it. Tracks are lit the same way as mist, but a fresh ionization trail is bright enough
   *  in a real chamber to read even where the ambient light is weak — this is that floor, not a
   *  second light source. */
  trackLightFloor: number;
  /** ≥0 — master strength of the crisp, screen-space track layer (`web/track-layer.ts`): a grid
   *  cell cannot carry a thin sharp line (see that module's own header), so the grid stamp this
   *  file's `decay`/`trackLightFloor` govern stays the soft, gas-carried residue, and THIS is the
   *  bright, sharp geometry drawn over it in content pixels. 0 disables it outright — the canary
   *  `check:medium` uses to prove its "sharp at birth" gate is actually sensitive to the layer,
   *  not to the residue underneath it. */
  trackLayerAmount: number;
};

const BASE_COLOR: VireUIKitMediumChannel = [0.07, 0.08, 0.1];

const normalize2 = (v: readonly [number, number]): readonly [number, number] => {
  const len = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / len, v[1] / len];
};

/** Cool neutral — the reference's fluorescent-tube/LED-strip look, not a warm incandescent one. */
const MEDIUM_DEFAULT_LIGHT_COLOR: VireUIKitMediumChannel = [0.78, 0.85, 0.94];

/**
 * Defaults that echo the reference: a wide edge strip near the chamber floor (shaped almost
 * entirely by distance falloff, not its cone edge — see `VireUIKitMediumLight.coneAngle`) plus two
 * angled spotlights from opposite top corners. Both spotlight directions sit ~25-30° off vertical
 * AND off each other's mirror angle (19°/22° cones, not identical) — an exact mirror or an on-axis
 * beam reads as staged; a small asymmetry reads as a room with two lamps in it.
 */
export const MEDIUM_DEFAULT_LIGHTS: readonly VireUIKitMediumLight[] = [
  {
    position: [0.5, 0.0],
    direction: [0, 1],
    coneAngle: Math.PI,
    falloff: 6,
    color: MEDIUM_DEFAULT_LIGHT_COLOR,
    intensity: 1.2,
  },
  {
    position: [0.14, 0.9],
    direction: normalize2([0.5, -0.86]),
    coneAngle: (22 * Math.PI) / 180,
    falloff: 1.0,
    color: MEDIUM_DEFAULT_LIGHT_COLOR,
    intensity: 0.9,
  },
  {
    position: [0.86, 0.86],
    direction: normalize2([-0.42, -0.9]),
    coneAngle: (19 * Math.PI) / 180,
    falloff: 1.05,
    color: MEDIUM_DEFAULT_LIGHT_COLOR,
    intensity: 0.7,
  },
];

/** The grain's fall accumulator (`web/medium.ts`) wraps at this many content-px — see the
 *  accumulator's own comment for why an exact periodic hash (the way `MEDIUM_TIME_PERIOD` wraps the
 *  curl field) isn't needed here: at the shipped `mistGrainFallSpeed` this is days of continuous
 *  playback between wraps, and the wrap itself only relabels which cell's hash renders where, not a
 *  visible jump in an already-sparse, already-random field. */
export const MEDIUM_GRAIN_FALL_WRAP_PX = 1_000_000;

export const MEDIUM_DEFAULTS: VireUIKitMediumParams = {
  // A stamped track has to visibly broaden and fade within the reference's "roughly one to two
  // seconds", not the ~11s half-life a 0.06 decay gives — measured against check-medium.mjs's track
  // gate (birth vs +1.5s cross-section width and total density): 1.1 leaves ~30% of the peak at 1s
  // and ~17% at 1.5s, comfortably faded without dying before MacCormack's own diffusion has time to
  // visibly broaden the stamp.
  decay: 1.1,
  curlFreq: 0.045,
  curlSpeed: 0.12,
  advectSpeed: 26,
  turbulence: 1,
  condensationRate: 0.18,
  condensationFloor: 0.12,
  evaporationRate: 0.2,
  condensateSettleSpeed: 8,
  condensateSettleWiggle: 0.4,
  condensateSpreadRate: 0.08,
  condensateTint: 0.2,
  condensateGain: 5,
  condensateColor: [0.94, 0.95, 0.97],
  channelColors: neutralSpecies(BASE_COLOR),
  channelScatter: [1, 1, 1],
  baseColor: BASE_COLOR,
  baseWeight: 0.9,
  depthFarScale: 1.6,
  depthFarOffsetFrac: [0.47, 0.53],
  depthFarBlurRadius: 5,
  depthFarWeight: 0.5,
  gravityVaporDrift: 0.6,
  gravityBottomBoost: 2,
  gravityBottomBoostStart: 0.75,
  lights: MEDIUM_DEFAULT_LIGHTS,
  // 1.6px cells read as fine grain at the product's own content resolution without collapsing into
  // a texture at typical DPR; a slow fall plus a small wobble is "settling", not "raining" — see
  // check-medium.mjs's grain gate for the measured high-frequency energy this produces.
  mistGrainAmount: 1,
  mistGrainCellPx: 1.6,
  mistGrainFallSpeed: 5,
  mistGrainJitterPx: 2.2,
  mistGrainJitterFreq: 0.9,
  trackLightFloor: 0.32,
  trackLayerAmount: 1,
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
 * than pixels — so a preset doesn't depend on the simulation grid's resolution. Three presets, the
 * reference's three visible kinds: `alpha` is a thick, short, straight ray — `createMediumDynamics`
 * stamps a dozen or so of these at once per event, radiating from one point, so a single ray is
 * short on purpose. `electron` is thin, long-ish and ragged (wiggly, granular). `muon` is long,
 * straight and thin — a cosmic ray crossing the whole chamber, unrelated to any source.
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
  Record<'alpha' | 'electron' | 'muon', VireUIKitMediumTrackPreset>
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
  electron: {
    lengthFrac: 0.42,
    headWidthFrac: 0.018,
    tailWidthFrac: 0.05,
    raggedFrac: 0.045,
    raggedFreq: 5,
    settleFrac: 0.05,
    tailDim: 0.45,
    intensity: 0.6,
  },
  muon: {
    lengthFrac: 0.7,
    headWidthFrac: 0.012,
    tailWidthFrac: 0.02,
    raggedFrac: 0,
    raggedFreq: 0,
    settleFrac: 0.01,
    tailDim: 0.75,
    intensity: 0.5,
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

/** How many alpha rays a single decay event stamps at once, radiating from the same source point —
 *  the reference's starburst, not a lone track (`MEDIUM_TRACK_PRESETS.alpha` is the shape of ONE
 *  ray). Randomized per event within this range. */
export const MEDIUM_ALPHA_BURST_RAYS: readonly [number, number] = [8, 16];

/** Per-ray length multiplier within a burst, so the rays read as an organic spray rather than a
 *  wheel of identical spokes — the reference's rays visibly differ in reach. */
export const MEDIUM_ALPHA_RAY_LENGTH_SCALE: readonly [number, number] = [0.55, 1];

/** Per-emission depth range applied to a track's width (`headWidthFrac`/`tailWidthFrac`), far…near.
 *  The same knob reads as both "thin" and "soft": a Gaussian stamp's edge steepness scales with its
 *  own width (`emit-shader.ts`'s only extent parameter), so shrinking it for a far track thins and
 *  softens it in the same stroke — there is no second knob to hang an independent softness number
 *  on. Floored at 0.55: below that a far `alpha` track's head narrows past what MacCormack's own
 *  numerical smoothing already blurs it to, and the depth cue disappears into that noise floor.
 *  The near end now runs past 1 (1.2, not 1): depth of field needs the NEAREST tracks a little
 *  LARGER than the base preset too, not just full-size — the reference shows near tracks blurring
 *  into big soft shapes rather than merely reading "as sharp as it gets". The same knob does both
 *  jobs again: a wider-than-base stamp is also a softer-edged one. */
export const MEDIUM_TRACK_DEPTH_WIDTH_RANGE: readonly [number, number] = [0.55, 1.2];

/** Per-emission depth range applied to a track's intensity, far…near — "dim". Floored at 0.4, not
 *  lower: a far track still has to clear `MEDIUM_DEFAULTS.condensationFloor`'s excess threshold
 *  often enough to read as a track, or depth would look like tracks randomly failing to spawn
 *  rather than fading into the distance. */
export const MEDIUM_TRACK_DEPTH_INTENSITY_RANGE: readonly [number, number] = [0.4, 1];

/**
 * How long a live track stays in the crisp screen-space layer (`web/track-layer.ts`), seconds, by
 * preset — tuned by eye against the reference's own "roughly one to two seconds"
 * (`docs`/the brief's own reference frames): `alpha` is the shortest, thickest burst ray; `muon`,
 * a cosmic ray crossing the whole chamber, lingers longest. Independent of `MEDIUM_DEFAULTS.decay`,
 * which times the SOFT gas-carried residue left behind in the grid, not this layer.
 */
export const MEDIUM_TRACK_LAYER_LIFE_SECONDS: Readonly<Record<keyof typeof MEDIUM_TRACK_PRESETS, number>> = {
  alpha: 1.8,
  electron: 1.4,
  muon: 2.2,
};

/** Oldest-out cap on the live-track list (`web/track-layer.ts`) — a burst of a dozen-plus alpha
 *  rays every few seconds would otherwise grow the instanced draw without bound over a long
 *  session; 64 is comfortably above what a few overlapping bursts plus background radiation ever
 *  need alive at once. */
export const MEDIUM_TRACK_LAYER_MAX_TRACKS = 64;

/** How much a live track's own width grows over its life, as a fraction of its birth width (0 = no
 *  growth, 1 = doubled by the time it's removed) — "wider ... at ~1.5s", the same broadening the
 *  grid residue already shows, but on the crisp layer's own geometry. */
export const MEDIUM_TRACK_LAYER_WIDEN_GAIN = 0.9;

/** Shapes the brightness-vs-age curve as `(1 - age/life) ** gamma`: reaches exactly 0 at removal
 *  (no pop when a track leaves the list) while staying close to full brightness for the first part
 *  of its life (>1 skews the fade toward the end rather than a flat linear ramp down). */
export const MEDIUM_TRACK_LAYER_FADE_GAMMA = 1.6;

/** Downward drift, as a fraction of `min(contentWidth, contentHeight)` per second — droplets that
 *  formed along a track keep settling after the stamp itself, the same physical idea as
 *  `MEDIUM_DEFAULTS.condensateSettleSpeed` but for this layer's own screen-space geometry rather
 *  than the simulation grid. Small: over a track's longest life (muon, 2.2s) this alone moves it
 *  well under a tenth of the frame. */
export const MEDIUM_TRACK_LAYER_GRAVITY_SAG = 0.018;

/** Scales the curl field's push on a live track (see `web/track-layer.ts`'s `curlVelocityJS`),
 *  units of `min(contentWidth, contentHeight)` per second per unit of curl velocity — small enough
 *  to read as "nudged", not carried the way the gas itself is by `MEDIUM_DEFAULTS.advectSpeed`. */
export const MEDIUM_TRACK_LAYER_CURL_PUSH = 0.05;

#!/usr/bin/env node
/**
 * Behavioral gate for the medium (`src/medium/**`, `src/web/medium*.ts`): runs the REAL
 * `vireglass` renderer in headless Chromium, the same way `check-glsl.mjs`'s syntax check and
 * `check-backdrop.mjs`/`check-optics.mjs` (in `vireglass` itself) run their own behavioral gates —
 * bundle with esbuild, inject into a blank page, drive `createVireGlassRenderer` and this
 * package's medium runtime directly.
 *
 * Why this exists: the checks that already run (`check:glsl` compiles the shaders,
 * `vitest` covers the pure model in `src/medium`) never touch the ACTUAL simulation stepping
 * inside a WebGL2 context. A real bug lived exactly there and both were green: an extra Y flip in
 * `composite-shader.ts` (an early draft, not what shipped) inverted the vertical read of the
 * condensate buffer — gravity would have pulled condensate toward the TOP of the frame instead of
 * the bottom. Only a headless render caught it (see the comment on `MEDIUM_COMPOSITE_SHADER`).
 * This gate keeps that measurement running on every change instead of depending on someone
 * re-running it by hand.
 *
 * The simulation steps with a FIXED dt inside the page's own loop (never a wall-clock wait) —
 * deterministic and fast: no `page.waitForTimeout`, no real GPU frame pacing.
 *
 * Run: npm run check:medium
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '../src/web/index.ts').replace(/\\/g, '/');
const MEDIUM = resolve(HERE, '../src/medium/index.ts').replace(/\\/g, '/');
const NOISE = resolve(HERE, '../src/medium/noise.ts').replace(/\\/g, '/');

// --- Gravity (the bug this gate exists for) -------------------------------------------------

/** Simulation-grid size for the gravity rig. Tall on purpose: `condensateSettleSpeed` gives a
 *  known px/s drift, and the grid needs enough headroom on both sides of the seeded blob that the
 *  measurement window can't wrap around the `REPEAT` border (see `GRAVITY_STEPS` below). */
const GRAVITY_GRID_W = 96;
const GRAVITY_GRID_H = 192;
/** Isolates gravity from the curl-noise drift: `u_turbulence` scales ONLY the curl term (see
 *  `MEDIUM_ADVECT_VELOCITY` in `advect-shader.ts`), `u_settleSpeed` is added after it — zero
 *  turbulence leaves settle as the sole velocity, so the centroid moves by a predictable,
 *  noise-free amount instead of a swirl the measurement would have to average out. */
const GRAVITY_TURBULENCE = 0;
const GRAVITY_DT = 1 / 60;
/** Checkpoints in steps. At `condensateSettleSpeed = 8` grid-px/s (`MEDIUM_DEFAULTS`) and this
 *  dt, 360 steps is 6s of sim time and ~48px of drift — comfortably inside the grid's 192px
 *  height from a blob seeded at its center (96px), nowhere near the `REPEAT` seam. */
const GRAVITY_CHECKPOINTS = [1, 90, 180, 270, 360];
/**
 * How much of the vertical range the centroid must cross, downhill toward the canvas's visual
 * bottom, between the first and last checkpoint — in FRACTIONS of the checkpoint-to-checkpoint
 * step count, not raw pixels, so it isn't sensitive to the exact grid size. Measured on this rig
 * with the shipped (correct) probe: the centroid moves monotonically end to end. The floor is
 * loose on purpose — this gate cares about DIRECTION, not the exact settle-speed calibration
 * (that number is `MEDIUM_DEFAULTS.condensateSettleSpeed`'s own job, tuned and commented there).
 */
const MIN_GRAVITY_DRIFT_PX = 6;
/** How many of the 4 checkpoint-to-checkpoint steps are allowed to move the WRONG way before this
 *  gate calls the trend broken — MacCormack's limiter and the grid's own discretization leave
 *  room for a step of noise, but not for the majority of them to reverse. */
const MAX_GRAVITY_REVERSALS = 1;

// --- Water conservation ------------------------------------------------------------------------

/** 128x72: the same "coarser than the frame" size the README's own usage example uses — the
 *  curl-noise frequency is per grid-px, so an arbitrarily smaller test grid changes the field's
 *  effective resolution and isn't representative of what this model actually runs at. */
const WATER_GRID_W = 128;
const WATER_GRID_H = 72;
const WATER_DT = 1 / 30;
/** Seconds of warmup before sampling starts. Condensate seeds EMPTY (`seed()` in `web/medium.ts`)
 *  and climbs to its share of the water through condensation, whose time constant is of order
 *  `1/(condensationRate + evaporationRate)` ≈ 2.6s at the shipped defaults — sampling through that
 *  ramp would fail on a transient that has nothing to do with conservation. A monorepo predecessor
 *  of this gate hit exactly this and fixed it by moving the window past the ramp, not by loosening
 *  the threshold. Measured on this grid: range/mean at this window is 0.62%; at 12s warmup (right
 *  at the edge of the ramp) it's still 4.63% — under threshold, but with little room, which is why
 *  the warmup here is chosen past where it visibly settles rather than at the minimum that passes.
 */
const WATER_WARMUP_S = 20;
const WATER_SAMPLE_INTERVAL_S = 1;
const WATER_SAMPLES = 15;
/**
 * Range of the water sum (vapor+condensate) over the sampled window, as a fraction of its mean.
 * The transport scheme (semi-Lagrangian MacCormack) has no obligation to conserve the sum by
 * itself — `web/medium.ts` corrects it once a second against a target — so this bounds the
 * residual, not a perfectly flat line. The vire monorepo's own predecessor of this gate (before
 * the two-phase vapor/condensate split; see `medium-equilibrium-gate.mjs`/`a292d6a3` in that
 * repo's history) used the same 5% figure for the analogous single-phase check. Measured here,
 * past warmup, on this grid: 0.62% — the 5% figure carries a wide margin, kept at the historical
 * value rather than tightened, so a change to the renormalization cadence doesn't need a new
 * number picked from a single run.
 */
const MAX_WATER_RANGE_OVER_MEAN = 0.05;

// --- Flicker -------------------------------------------------------------------------------

const FLICKER_GRID_W = 64;
const FLICKER_GRID_H = 36;
const FLICKER_DT = 1 / 60;
const FLICKER_WARMUP_STEPS = 60;
const FLICKER_SAMPLE_FRAMES = 60;
/** Fraction of frame-to-frame luma deltas allowed to flip sign before this gate calls it flicker.
 *  The bug this guards against (a pass reading its own previous frame from an FBO without the
 *  flip `advect-shader.ts` now applies — see `targets/glsl.ts` in `vireglass`) flips the sign on
 *  very nearly every comparable frame; a healthy medium's frame-to-frame luma keeps the same sign
 *  for several frames in a row as it drifts. Half the gap between "occasional noise" and "a
 *  systematic per-frame flip" — the same margin the analogous flicker check used in the vire
 *  monorepo before this package was extracted from it. */
const MAX_FLICKER_RATIO = 0.5;

// --- Resize: a grid resize RESAMPLES state, it doesn't reseed --------------------------------

/** Two grid sizes, same aspect ratio, ~2.27x the cell count — big enough that a reseed's drop in
 *  water (condensate goes to exactly 0, see below) is unmistakable against normal frame-to-frame
 *  noise. */
const RESIZE_GRID_W1 = 80;
const RESIZE_GRID_H1 = 45;
const RESIZE_GRID_W2 = 120;
const RESIZE_GRID_H2 = 68;
const RESIZE_DT = 1 / 30;
/** Same rationale as WATER_WARMUP_S: past the condensate ramp, so "before" is a real developed
 *  state (both phases present, structure built up by turbulence) rather than the seeded moment. */
const RESIZE_WARMUP_S = 20;
/** "two seconds (of simulated steps) after the resize" — the brief's own number for how long to
 *  let the resized grid run before the second measurement. */
const RESIZE_POST_S = 2;
/**
 * Relative change (|after - before| / before) allowed in water DENSITY (total / cell count, not
 * the raw sum — the raw sum is SUPPOSED to grow with the new grid's cell count, see the
 * area-ratio rescale in web/medium.ts) across a resize, for the CORRECT (resample) path. A
 * resample isn't lossless — bilinear filtering and the area-ratio rescale of the renormalization
 * target both carry some error. Measured on this rig: 1.26%. Kept at ~4x that so ordinary
 * run-to-run turbulence variance doesn't make this flaky.
 */
const MAX_RESIZE_WATER_RELATIVE_CHANGE = 0.05;
/**
 * Same idea, specifically for condensate density — the more sensitive of the two, since a reseed
 * zeroes condensate outright while vapor's fresh three spots are the same order of magnitude as
 * the evolved state (diluting the signal in the water-density figure above). Measured: resample
 * moves it by 4.10%.
 */
const MAX_RESIZE_CONDENSATE_RELATIVE_CHANGE = 0.1;
/** Same idea for inter-species contrast (coefficient of variation of the three vapor channels'
 *  grid-wide totals — see `contrastOf` in the ENTRY script). Measured: resample moves it by 0.48%. */
const MAX_RESIZE_CONTRAST_RELATIVE_CHANGE = 0.05;
/**
 * The canary (a full destroy-and-reseed on resize, the behavior this fix replaces) must FAIL the
 * condensate-density check above. Measured drop: 39.8% — condensate resets to exactly 0 at the
 * reseed instant (`seed()` in web/medium.ts) and only partially recovers in the 2s window that
 * follows. Set well below that (half) so the canary passing this floor is not a coin flip, while
 * staying well above the CORRECT path's own 4.10% so the two can never be confused.
 */
const MIN_CANARY_CONDENSATE_RELATIVE_CHANGE = 0.2;

// --- Long run: a phase wrap is seamless, not a jump ------------------------------------------

const SEAM_GRID_W = 48;
const SEAM_GRID_H = 48;
/** A representative frame time; only its product with curlSpeed (the phase step size) matters. */
const SEAM_DT = 1 / 30;
/** Samples on each side of the wrap — enough to establish a "typical step" baseline without it
 *  costing more than a handful of extra draw calls. */
const SEAM_STEPS_EACH_SIDE = 30;
/**
 * How much bigger the delta AT the seam is allowed to be than the typical (median) delta measured
 * away from it, for the CORRECT (periodic) probe. Measured on this rig: the seam delta is smaller
 * than a typical step (ratio 0.03) — the periodic hash's wrap doesn't just avoid a jump, it lands
 * on an exact lattice node for every octave at once (see MEDIUM_TIME_OCTAVES), and this scheme's
 * smoothstep blending has a zero derivative exactly at a lattice node, so the seam is flatter than
 * an ordinary step, not just as smooth. Set well above 1 (100x the measurement) anyway so this
 * isn't sensitive to exactly how flat that node happens to be, only to whether there's a jump.
 */
const MAX_SEAM_JUMP_RATIO = 3;
/** The canary (a naive wrap: the phase value wraps but the hash doesn't) must clear this — the
 *  seam delta there is the difference between two essentially uncorrelated hash lattice nodes.
 *  Measured: ratio 727x — kept at a small fraction (1/70th) of that so the floor is comfortable. */
const MIN_CANARY_SEAM_JUMP_RATIO = 10;

// --- Depth: parallax ---------------------------------------------------------------------------
//
// A single seeded blob under a clean, deterministic velocity (not real curl-noise turbulence,
// which spreads and reshapes it over many steps into content no single weighted centroid can
// track), read back through TWO fixed transforms — near (identity) and far
// (MEDIUM_DEFAULTS.depthFarScale/depthFarOffsetFrac). Both probes read the IDENTICAL evolving
// buffer, so any difference in apparent motion is attributable purely to the transform: screenPos
// = (fieldPos - offset) / scale, so the ratio of far/near motion should land at 1/depthFarScale.
// The motion is measured as a whole-image cross-correlation best-shift (Node side, see
// bestShiftY), not a weighted centroid — a centroid breaks down for a scale > 1 read of a
// REPEAT-wrapped field (xy * scale sweeps more than one period, so the visible window can show
// more than one aliased copy of the blob), which is invisible right up until you actually try it:
// an earlier version of this gate used a centroid and passed by coincidence, then broke the moment
// an unrelated texture-precision fix (see makeVaporOnlyRig) changed how much background noise it
// was implicitly averaging over.
const PARALLAX_GRID_W = 96;
const PARALLAX_GRID_H = 96;
const PARALLAX_DT = 1 / 30;
const PARALLAX_STEPS = 160;
/** A clean, deterministic downward velocity for this rig only — not production's own
 *  gravityVaporDrift (0.6, deliberately tiny): this gate tests the SCALE TRANSFORM's own
 *  mathematical property (any motion source works), and a larger, faster signal is less sensitive
 *  to bilinear/MacCormack discretization noise. ~27px of travel over 160 steps on a 96px grid —
 *  comfortably clear of the REPEAT seam, and within PARALLAX_MAX_SHIFT's search range below. */
const PARALLAX_TEST_VELOCITY = 5;
/** Cross-correlation search range, grid-px — covers the near plane's own ~27px of expected motion
 *  (and the far plane's smaller share of it) with margin, while staying under half the grid (48px)
 *  so a shift and its wrap-around alias are never confused. */
const PARALLAX_MAX_SHIFT = 35;
/** Band for (far shift / near shift). The naive prediction is 1/depthFarScale (1/1.6 = 0.625);
 *  measured on this rig: 0.630 — a fully deterministic rigid translation under an exact coordinate
 *  transform, so this is about as close to the theoretical number as the discrete pixel-shift
 *  search resolves. Banded with headroom for a future change to the velocity/grid, not run-to-run
 *  noise (there is none). */
const MIN_PARALLAX_RATIO = 0.5;
const MAX_PARALLAX_RATIO = 0.75;
/** The canary — both planes at the same scale — must land close to 1 (no differential motion at
 *  all): two reads of the same transform of the same buffer move identically. */
const MIN_CANARY_PARALLAX_RATIO = 0.9;

// --- Depth: aerial perspective (contrast) -------------------------------------------------------
//
// A spatial low-pass cannot raise local variance, so the SAME 4-tap blur that softens the far
// plane's edges also, by construction, lowers its measured contrast — one mechanism for both
// cues (see MEDIUM_COMPOSITE_SHADER). Real 3-spot vapor turbulence (not a single blob): contrast
// needs actual structure to reduce.
const CONTRAST_GRID_W = 96;
const CONTRAST_GRID_H = 96;
const CONTRAST_DT = 1 / 30;
/** Steps of pure advection (no reaction) before measuring — plenty for curl-noise turbulence to
 *  fold the three seeded spots into real multi-blob structure; this rig has no condensation ramp
 *  to wait out, unlike the water gate. */
const CONTRAST_STEPS = 1200;
/** Minimum fractional drop in the far plane's std-dev relative to the near plane's. Measured on
 *  this rig at the shipped depthFarBlurRadius: 33.1%. Kept well below that (25%) — the canary
 *  below already shows scale/offset alone account for a real ~15% of it on this non-stationary
 *  field (a fixed offset can land on a locally denser/sparser patch by chance), and the margin
 *  between the two thresholds is what actually isolates blur's own contribution. */
const MIN_CONTRAST_REDUCTION = 0.25;
/** The canary — the far plane's own scale/offset with blurRadius=0 — must fall under this.
 *  Measured: 15.0%, from reading a fixed offset into a field that isn't spatially stationary (see
 *  MIN_CONTRAST_REDUCTION) — not zero, but well under the blurred reading's 33.1%. */
const MAX_CANARY_CONTRAST_REDUCTION = 0.2;

// --- Depth: decorrelation — the far plane doesn't echo the near one, at the README's own grid ---

const DECORRELATION_GRID_W = 128;
const DECORRELATION_GRID_H = 72;
const DECORRELATION_DT = 1 / 30;
const DECORRELATION_STEPS = 1200;
/** Maximum Pearson correlation between a near read and a REAL (fraction-based) far read, both at
 *  scale 1, for them to count as decorrelated. Measured on this rig: -0.385 (comfortably
 *  decorrelated — a genuine echo, the canary below, correlates at 0.797). */
const MAX_DECORRELATION = 0.2;
/** The canary: a tiny (2 grid-px) effective offset — well under one curl-noise wavelength, exactly
 *  the failure mode a fixed grid-px value could still produce at a size nobody tested (see
 *  depthFarOffsetPx's own comment) — must exceed this correlation. Measured: 0.797. */
const MIN_CANARY_DECORRELATION = 0.6;

// --- Gravity is now two separate, decoupled properties -------------------------------------------
//
// A uniform drift on a PERIODIC (`gl.REPEAT`) grid cannot accumulate density anywhere — it only
// ever translates the field and wraps it back in at the top, so it is a MOTION cue, not a source
// of "denser at the bottom" (see MEDIUM_DEFAULTS.gravityVaporDrift's own comment). Only the
// compositing boost produces density asymmetry, and it does so as a steady-state property of the
// compositing math — true from frame one, with no warmup to get right and no window to wrap out
// of. Testing them as one combined "gravity visible" property (an earlier version of this gate)
// needed a 40s warmup to erode the production seed layout's own asymmetry, and that warmup was
// itself fragile: at 120s the drift's own contribution reversed sign after wrapping partway around
// the grid. Splitting them removes the fragile window entirely.

// --- Gravity: the bottom boost is a steady-state compositing property ---------------------------

const BOOST_GRID_W = 72;
const BOOST_GRID_H = 128;
/** A tall content canvas — "from the side" is a portrait framing, and the boost is a fraction of
 *  frame HEIGHT (see gravityBottomBoostStart), so the aspect ratio the gate measures at matters. */
const BOOST_CANVAS_W = 144;
const BOOST_CANVAS_H = 256;
/** Fraction of frame height sampled at each edge for the top/bottom band means. */
const BOOST_BAND = 0.2;
/** Minimum (bottom-band / top-band) mean-luma ratio, measured with ZERO simulated steps: two
 *  identical grayscale spots seeded symmetrically (see vgBoostSeries) make the bottom and top
 *  bands equal by construction absent the boost, so this is a property of the compositing math
 *  alone — true at frame 1 exactly as much as at frame 100000. Measured on this rig: ... (see the
 *  report). */
const MIN_BOOST_RATIO = 1.1;
/** The canary (boost=0) must fall under this — the symmetric seeding above should leave it at
 *  (near) exactly 1, not merely below MIN_BOOST_RATIO. */
const MAX_CANARY_BOOST_RATIO = 1.02;

// --- Gravity: vapor drift is a motion-direction cue, valid at any (bounded) time -----------------
//
// The SAME centroid-tracking technique the condensate gravity rig at the top of this file already
// uses, applied to vapor with u_turbulence=0 (isolating drift, exactly like GRAVITY_TURBULENCE=0
// does for condensate's settle) — a short window, well inside the grid before the REPEAT seam,
// checked for DIRECTION and monotonicity, never for how much density resulted (there is none).
const DRIFT_GRID_W = 96;
const DRIFT_GRID_H = 96;
const DRIFT_DT = 1 / 60;
/** vaporDrift (0.6 grid-px/s) is over an order of magnitude slower than condensate's settle
 *  (8 grid-px/s), so this window is proportionally longer than the condensate rig's 6s: 2000 steps
 *  at this dt is ~33.3s, ~20px of drift on a 96px grid — comfortably under half the grid height,
 *  nowhere near the REPEAT seam. */
const DRIFT_CHECKPOINTS = [1, 500, 1000, 1500, 2000];
/** Same idea as the condensate rig's MIN_GRAVITY_DRIFT_PX. Measured on this rig: 19.6px — kept at
 *  half that so the floor is comfortable rather than a hair's breadth over the line. */
const MIN_DRIFT_PX = 10;
const MAX_DRIFT_REVERSALS = 1;
/** The canary (drift=0) must fall under this — with u_turbulence already 0, there is no velocity
 *  left at all, so the centroid should not move beyond float/discretization noise. */
const MAX_CANARY_DRIFT_PX = 1;

// --- Cost: what the depth composite adds over the pre-depth (single-plane) one ------------------

const COST_GRID_W = 128;
const COST_GRID_H = 72;
/** A representative phone-class portrait resolution — the composite runs once per frame at CONTENT
 *  (not grid) resolution, and that's where the brief's "~8ms of GPU at an 8.33ms budget" applies. */
const COST_CANVAS_W = 1080;
const COST_CANVAS_H = 2400;
/** 30 frames measured 0.000ms/frame on this rig — under `performance.now()`'s own clamp
 *  resolution, not a real zero. 3000 clears that floor (~1ms total, verified) without the tight
 *  synchronous draw loop running long enough to risk the headless GPU process itself (measured:
 *  a further order of magnitude did). The number this yields is unreliable in absolute terms in
 *  this specific sandbox either way — see the report for why the gate stays informational. */
const COST_FRAMES = 3000;
/** Hard ceiling ONLY when a real GPU timer is available (headless Chromium here has none — see the
 *  report). The depth composite must not cost more than this multiple of the pre-depth one. */
const MAX_COST_RATIO_WITH_TIMER = 2;

// --- Isotropy: the composited backdrop must not read as a lattice of straight lines --------------
//
// The product's OWN default grid at half its real size: round(1920/26) x round(952/26) — same
// 74x37 grid the diagnosis in the fix's own brief was made against (MEDIUM_DEFAULT_CELL_PX at a
// 1920x952 canvas), rendered at 960x476 (cell 13px) instead of the full 1920x952. Headless
// SwiftShader has no GPU to accelerate the composite's ~25 dependent texture taps, and this gate
// already runs two full pipelines (canary + correct) plus several diagnostic probes per run; the
// isotropy/seam METRICS are ratios (axis/diagonal energy, seam/typical step) computed from the
// SAME grid content at a smaller output scale, not absolute pixel counts, so they read the same
// property at 1/4 the pixels and a large fraction of the wall-clock cost.
const ISOTROPY_GRID_W = 74;
const ISOTROPY_GRID_H = 37;
const ISOTROPY_CANVAS_W = 960;
const ISOTROPY_CANVAS_H = 476;
const ISOTROPY_DT = 1 / 30;
/** 60s of simulated time — plenty for the far-plane seam (present from the first wrap-around read)
 *  and, more demandingly, for condensate settling to complete many full REPEAT wraps of the grid's
 *  height (condensateSettleSpeed=8 grid-px/s over a 37-tall grid wraps roughly every 4.6s, so this
 *  is ~13 wraps) — long enough for a straight-line trail to fully establish if nothing is breaking
 *  it up. Blockiness needs no warmup at all (a steady property of the grid resolution), so this
 *  window is sized by the SLOWEST of the three artifacts, not the fastest. */
const ISOTROPY_STEPS = 1800;
/** Degrees on each side of an axis/diagonal direction counted as "near" it — the brief's own figure. */
const ISOTROPY_ANGLE_WINDOW_DEG = 10;
/**
 * Ratio of Sobel gradient energy within ±10° of the axes (0°/90°) to energy within ±10° of the
 * diagonals (45°/135°) — the two windows are equal width (40° total each out of 180°), so an
 * isotropic field's ratio sits near 1 by construction, not because of an arbitrary normalization.
 *
 * Gated. Measured on this rig at 1800 steps (960x476 / 74x37): correct 1.66, a canary sharing
 * correct's frequencies but not its periodicity 3.74. The threshold sits between them with margin
 * both ways. A reading of 13.3 once looked like noise in this metric and turned out to be a real
 * bug — bicubic weights grouped as (x+z, y+w) instead of (x+y, z+w), which drew the grid as
 * hard-edged squares — so a high ratio here means look at the frame, not at the metric.
 */
const MAX_ISOTROPY_RATIO = 2.5;
/** Mean absolute luma step AT the far plane's tile-wrap column, relative to the median step at
 *  ordinary (non-seam) columns nearby — mirrors the phase-wrap seam gate's own "seam vs typical"
 *  ratio, read from the far plane's OWN rendered contribution alone (probeFarField), not the full
 *  composite (an earlier draft measured the full frame and picked up unrelated near-plane content
 *  at the same columns). A seamless field reads close to 1 (the wrap column is an ordinary column);
 *  a genuine discontinuity reads larger. Measured on this rig (vapor, 1800 steps, 960x476/74x37):
 *  correct 0.545, canary (same frequencies as correct, not periodic) 2.800 — kept with margin on
 *  both sides of that gap rather than at either edge. */
const MAX_SEAM_COLUMN_RATIO = 1.5;
const MIN_CANARY_SEAM_COLUMN_RATIO = 2;

// --- Chamber look: lights are a separate, visible entity ----------------------------------------
//
// The full production medium (createMediumBackdrop, real API — condensation needs its own ramp,
// same reasoning as WATER_WARMUP_S), with every light but one forced to zero intensity so the
// measurement isolates the cone mechanism itself rather than the sum of all three shipped lights.
const BEAM_GRID_W = 96;
const BEAM_GRID_H = 48;
const BEAM_CANVAS_W = 480;
const BEAM_CANVAS_H = 240;
const BEAM_DT = 1 / 30;
/** Same 20s condensation-ramp warmup as WATER_WARMUP_S, through the same real full-medium API —
 *  fogDensity (vapor+condensate) needs both phases developed before a light has anything to light. */
const BEAM_WARMUP_STEPS = 600;
/** Inner/outer radius of the sampled annulus, as a fraction of min(canvas dims) past the canvas
 *  edge nearest the light. */
const BEAM_MIN_RADIUS_FRAC = 0.1;
const BEAM_MAX_RADIUS_FRAC = 0.6;
/** Ratio of mean luma well inside the light's cone to well outside it, at the same distance band.
 *  Thresholds set from a measured run — see the report printed by this gate. */
const MIN_BEAM_RATIO = 1.5;
const MAX_CANARY_BEAM_RATIO = 1.15;

// --- Chamber look: a track is sharp at birth, then broadens, sags and fades ----------------------
//
// The real full-medium API again, but read through readTrackGrid() (raw density, no compositing or
// lighting in the way) — a single manually-built `muon` emission (long, straight, thin: the easiest
// shape to take a clean perpendicular cross-section of) stamped once, then left to advect and decay
// on its own for TRACK_LATER_S with no further emissions.
const TRACK_GRID_W = 96;
const TRACK_GRID_H = 48;
const TRACK_DT = 1 / 30;
const TRACK_LATER_S = 1.5;
/** Ratio of the cross-section's Gaussian sigma (a density-weighted standard deviation across a
 *  scanline perpendicular to the track) at +1.5s vs at birth — how much it broadened. Thresholds
 *  from a measured run. */
const MIN_TRACK_BROADEN_RATIO = 1.2;
/** Ratio of total track density at +1.5s vs at birth — how much of it faded. Below 1: some of the
 *  stamp is gone, not merely spread thinner (broadening alone conserves the sum; decay is what
 *  actually loses it). Thresholds from a measured run. */
const MAX_TRACK_FADE_RATIO = 0.6;
/** The canary (decay=0, turbulence=0 — no motion to broaden, no decay to fade) must show close to
 *  NO change in either measure: at zero velocity the backtrace samples its own exact texel center
 *  every frame, so bilinear resampling introduces essentially no diffusion on its own. */
const MAX_CANARY_TRACK_BROADEN_RATIO = 1.05;
const MIN_CANARY_TRACK_FADE_RATIO = 0.95;

// --- Chamber look: the crisp screen-space track layer is sharp at birth -------------------------
//
// The gate above measures the SOFT grid residue via readTrackGrid(); this one measures the layer
// drawn OVER it (track-layer.ts/track-layer-gl.ts), which has no grid buffer of its own — read back
// from the FINAL composited canvas instead (readCanvas, the same technique the beam gate
// uses), at the product's own content resolution so a preset's width FRACTION lands on the
// same content-px the real product shows. A single straight `muon` emission (angle=0 — a clean
// perpendicular scanline at its own midpoint column), stamped once through the real medium.pass()
// API and read immediately (birth) and again TRACK_LAYER_LATER_S later with no further emissions:
// long enough for the layer's own age-based widen/fade to show, short of MEDIUM_TRACK_LAYER_LIFE_
// SECONDS.muon (2.2s) so the track is still alive to measure. A same-scene, no-emission background
// frame is subtracted per pixel before weighting — the ambient lights/mist gradient varies smoothly
// across the frame on its own, and would otherwise bias the weighted sigma independent of the track.
const TRACK_LAYER_CANVAS_W = 1920;
const TRACK_LAYER_CANVAS_H = 952;
const TRACK_LAYER_GRID_W = 74;
const TRACK_LAYER_GRID_H = 37;
const TRACK_LAYER_DT = 1 / 30;
const TRACK_LAYER_WARMUP_STEPS = 40;
const TRACK_LAYER_LATER_S = 1.4;
/** Birth cross-section sigma, content-px — has to read SHARP (the muon look's core is under 1px at
 *  this size, see MEDIUM_TRACK_LAYER_LOOK), not a ~26px grid-cell blur. The emission sits at mid
 *  depth, so no defocus. Threshold from a measured run. */
const MAX_TRACK_LAYER_BIRTH_SIGMA_PX = 8;
/** Ratio of the cross-section's sigma at +1.4s vs at birth — how much the layer's own geometry
 *  broadened (see MEDIUM_TRACK_LAYER_LOOK.broaden). Threshold from a measured run. */
const MIN_TRACK_LAYER_BROADEN_RATIO = 1.15;
/** Ratio of total track brightness (background-subtracted) at +1.4s vs at birth — how much it
 *  dimmed (see MEDIUM_TRACK_LAYER_FADE_GAMMA/LIFE_SECONDS). Threshold from a measured run. */
const MAX_TRACK_LAYER_FADE_RATIO = 0.6;

const ENTRY = `
import { createVireGlassRenderer } from 'vireglass/web';
import { toGLSL } from 'vireglass';
import {
  bindTextureAt,
  createFramebuffer,
  createProgram,
  createTexture,
  drawFullscreenTriangle,
  FULLSCREEN_TRIANGLE_VERTEX_SOURCE,
  locationCache,
  setUniform,
} from 'vireglass/web';
import { createMediumBackdrop } from '${WEB}';
import { computeMediumSpatialPeriods } from '${NOISE}';
import {
  depthFarOffsetPx,
  MEDIUM_COMPOSITE_SHADER,
  MEDIUM_CONDENSATE_CORRECT_SHADER,
  MEDIUM_CONDENSATE_FORWARD_SHADER,
  MEDIUM_CONDENSATE_REACT_SHADER,
  MEDIUM_DEFAULTS,
  MEDIUM_SEED_SHADER,
  MEDIUM_TIME_PERIOD,
  MEDIUM_TRACK_PRESETS,
  MEDIUM_VAPOR_CORRECT_SHADER,
  MEDIUM_VAPOR_FORWARD_SHADER,
  MEDIUM_VAPOR_REACT_SHADER,
  VG_CURL_NOISE,
  VG_OKLAB_TO_SRGB,
} from '${MEDIUM}';

// Every hand-rolled probe rig below builds its OWN GL program straight from a real production
// shader (MEDIUM_*_FORWARD/CORRECT_SHADER), so it also has to bind the seamless-noise uniforms
// those shaders now declare (u_spatial0..3, see noise.ts/advect-shader.ts) — left unset, they
// default to (0,0,0,0), which collapses vgPotentialSeamless to a SPATIALLY UNIFORM field (every
// pixel samples the identical lattice cell) and silently zeroes curl everywhere. Most rigs run at
// u_turbulence=0 anyway (isolating a different mechanism) so this never showed up as a wrong
// PASS — except the contrast/decorrelation rigs, which need REAL turbulent mixing and, measured
// directly, produced a materially different (weaker) contrast-reduction number with it silently
// broken. \`bindSpatial\` centralizes the fix so every rig computes it the same way production does.
function bindSpatial(gl, loc, w, h, curlFreq) {
  const spatial = computeMediumSpatialPeriods(w, h, curlFreq);
  setUniform(gl, loc('u_spatial0'), [spatial[0].freqX, spatial[0].freqY, spatial[0].periodX, spatial[0].periodY]);
  setUniform(gl, loc('u_spatial1'), [spatial[1].freqX, spatial[1].freqY, spatial[1].periodX, spatial[1].periodY]);
  setUniform(gl, loc('u_spatial2'), [spatial[2].freqX, spatial[2].freqY, spatial[2].periodX, spatial[2].periodY]);
  setUniform(gl, loc('u_spatial3'), [spatial[3].freqX, spatial[3].freqY, spatial[3].periodX, spatial[3].periodY]);
}

// NOT attached to document.body: a WebGL2 context works fine on a detached canvas (every read here
// goes through gl.readPixels/renderer.render, never layout or a visible paint), and Chromium caps
// the number of SIMULTANEOUSLY LIVE WebGL contexts per page (observed here: adding this package's
// own three new gates on top of the existing dozen tipped the running total over that cap mid-run —
// "WARNING: Too many active WebGL contexts. Oldest context will be lost." — which silently evicts
// whichever gate's context is oldest, not necessarily the one at fault, and reads back as a stall
// or a hang, not a clean error). A canvas that was appended to document.body stays reachable from
// the DOM tree for the rest of the page's life even after its own JS variable goes out of scope, so
// its context never becomes eligible for GC-driven release; every earlier gate's canvas was still
// pinned in memory by the time this file's later gates ran. A detached canvas is reclaimed (context
// and all) the moment nothing references it any more — ordinary GC, no explicit cleanup needed here.
function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

// Reads the FINAL, fully composited canvas — after VireGlass's own contentTexture-then-blit
// pipeline, not the medium's internal grid. This is deliberate: the bug this gate exists for was
// specifically a mismatch between the internal grid's own vertical convention and what the
// glass's lens finally shows a viewer, and it would slip straight through a check that only
// re-derives the grid's own bookkeeping. \`gl.readPixels\` on the CANVAS'S OWN default framebuffer
// needs no calibration of its own: row 0 is the window-coordinate bottom of THIS canvas — the
// same canvas the browser paints on screen with no further flip, a plain WebGL fact untouched by
// any of VireGlass's internal contentTexture conventions (those apply only BEFORE the final blit,
// see \`BLIT_FRAGMENT_SOURCE\` in vireglass's \`web/renderer.ts\`).
function readCanvas(gl, w, h) {
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf;
}

// --- Gravity rig -----------------------------------------------------------------------------
//
// A condensate-only probe, deliberately smaller than the full medium: \`MEDIUM_CONDENSATE_FORWARD/
// CORRECT_SHADER\` transport condensate with no dependency on vapor at all (only the REACT step —
// condensation/evaporation — reads vapor, and this rig never runs it). That leaves exactly the
// mechanism gravity depends on: transport plus \`condensateSettleSpeed\`. The probe's own composite
// mirrors the ONE line of the real \`MEDIUM_COMPOSITE_SHADER\` this gate is about (the condensate
// read: \`xy * u_dyeScale\`, no flip) rather than importing it — the same hand-written-probe
// pattern \`vireglass\`'s own check-backdrop.mjs uses for its FOLLOWS/VIOLATES blit shaders, so a
// canary can substitute the ONE line at risk without needing the real shader's vapor/track inputs.
const CONDENSATE_PROBE_CORRECT = \`
uniform shader u_condensate;
uniform float2 u_dyeScale;
half4 main(float2 xy) {
  float2 src = xy * u_dyeScale;
  float w = float(u_condensate.eval(src).r);
  return half4(half3(w), half(1.0));
}
\`;

// The canary: the extra flip a very early draft of MEDIUM_COMPOSITE_SHADER had, and the one this
// whole gate exists to catch a return of (see the comment on MEDIUM_COMPOSITE_SHADER itself).
// \`u_resolution\` needs no declaration — every shader gets it from the transpiler's own prologue
// (\`addPrologue\` in \`targets/glsl.ts\`), the same uniform \`web/medium.ts\` sets for every program.
const CONDENSATE_PROBE_CANARY = \`
uniform shader u_condensate;
uniform float2 u_dyeScale;
half4 main(float2 xy) {
  float2 flipped = float2(xy.x, u_resolution.y - xy.y);
  float2 src = flipped * u_dyeScale;
  float w = float(u_condensate.eval(src).r);
  return half4(half3(w), half(1.0));
}
\`;

function makeGravityPass(gl, { gridW, gridH, canary }) {
  const forwardProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_CONDENSATE_FORWARD_SHADER));
  const correctProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_CONDENSATE_CORRECT_SHADER));
  const seedProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_SEED_SHADER));
  const probeProgram = createProgram(
    gl,
    FULLSCREEN_TRIANGLE_VERTEX_SOURCE,
    toGLSL(canary ? CONDENSATE_PROBE_CANARY : CONDENSATE_PROBE_CORRECT),
  );
  const forwardLoc = locationCache(gl, forwardProgram);
  const correctLoc = locationCache(gl, correctProgram);
  const seedLoc = locationCache(gl, seedProgram);
  const probeLoc = locationCache(gl, probeProgram);

  const mk = () => {
    const texture = createTexture(gl, { width: gridW, height: gridH, wrap: gl.REPEAT });
    const fbo = createFramebuffer(gl, texture);
    return { texture, fbo };
  };
  const condensate = [mk(), mk()];
  const forward = mk();
  let front = 0;
  let seeded = false;

  function seed() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, condensate[front].fbo);
    gl.viewport(0, 0, gridW, gridH);
    gl.disable(gl.BLEND);
    gl.useProgram(seedProgram);
    // One spot, all three channels the same position: a plain grayscale blob (the probe only
    // reads .r), centered vertically with equal headroom to drift either way.
    const spot = [gridW / 2, gridH / 2];
    setUniform(gl, seedLoc('u_resolution'), [gridW, gridH]);
    setUniform(gl, seedLoc('u_spot0'), spot);
    setUniform(gl, seedLoc('u_spot1'), spot);
    setUniform(gl, seedLoc('u_spot2'), spot);
    setUniform(gl, seedLoc('u_spotRadius'), Math.min(gridW, gridH) * 0.12);
    drawFullscreenTriangle(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function bindVelocity(loc, dt) {
    setUniform(gl, loc('u_dyeSize'), [gridW, gridH]);
    setUniform(gl, loc('u_resolution'), [gridW, gridH]);
    setUniform(gl, loc('u_dt'), dt);
    // u_turbulence is 0 (GRAVITY_TURBULENCE), which zeroes the SHARED curl*advectSpeed*turbulence
    // term (see MEDIUM_ADVECT_VELOCITY) — but not u_settleWiggle's own share of curl.x, which is
    // added unconditionally (see MEDIUM_ADVECT_VELOCITY_SETTLE): phase and the spatial uniforms
    // below DO matter now, or this rig would exercise a zeroed wiggle term instead of the real one.
    setUniform(gl, loc('u_phase'), 0);
    setUniform(gl, loc('u_curlFreq'), MEDIUM_DEFAULTS.curlFreq);
    bindSpatial(gl, loc, gridW, gridH, MEDIUM_DEFAULTS.curlFreq);
    setUniform(gl, loc('u_advectSpeed'), MEDIUM_DEFAULTS.advectSpeed);
    setUniform(gl, loc('u_turbulence'), ${GRAVITY_TURBULENCE});
    setUniform(gl, loc('u_settleSpeed'), MEDIUM_DEFAULTS.condensateSettleSpeed);
    setUniform(gl, loc('u_settleWiggle'), MEDIUM_DEFAULTS.condensateSettleWiggle);
  }

  function step(dt) {
    const back = front === 0 ? 1 : 0;
    gl.viewport(0, 0, gridW, gridH);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, forward.fbo);
    gl.useProgram(forwardProgram);
    bindTextureAt(gl, 0, condensate[front].texture, forwardProgram, 'u_dye');
    bindVelocity(forwardLoc, dt);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, condensate[back].fbo);
    gl.useProgram(correctProgram);
    bindTextureAt(gl, 0, condensate[front].texture, correctProgram, 'u_dye');
    bindTextureAt(gl, 1, forward.texture, correctProgram, 'u_forward');
    setUniform(gl, correctLoc('u_forwardSize'), [gridW, gridH]);
    bindVelocity(correctLoc, dt);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    front = back;
  }

  return (gl, target) => {
    if (!seeded) {
      seed();
      seeded = true;
    }
    step(${GRAVITY_DT});
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.BLEND);
    gl.useProgram(probeProgram);
    bindTextureAt(gl, 0, condensate[front].texture, probeProgram, 'u_condensate');
    setUniform(gl, probeLoc('u_condensateSize'), [gridW, gridH]);
    setUniform(gl, probeLoc('u_dyeScale'), [gridW / target.width, gridH / target.height]);
    setUniform(gl, probeLoc('u_resolution'), [target.width, target.height]);
    drawFullscreenTriangle(gl);
  };
}

globalThis.vgGravity = async ({ canary }) => {
  const w = ${GRAVITY_GRID_W};
  const h = ${GRAVITY_GRID_H};
  const canvas = makeCanvas(w, h);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const pass = makeGravityPass(gl, { gridW: w, gridH: h, canary });

  const checkpoints = ${JSON.stringify(GRAVITY_CHECKPOINTS)};
  let done = 0;
  const samples = [];
  for (const target of checkpoints) {
    while (done < target) {
      renderer.render({ density: 1, debug: 'normal', pieces: [], backdrop: pass });
      done += 1;
    }
    const buf = readCanvas(gl, w, h);
    // Row-index-weighted centroid of the probe's own grayscale (red channel). Row 0 in this
    // buffer is the canvas's own visual bottom (see readCanvas's comment) — a centroid trending
    // toward 0 is condensate settling toward the bottom of the frame.
    let mass = 0;
    let weighted = 0;
    for (let r = 0; r < h; r += 1) {
      for (let c = 0; c < w; c += 1) {
        const v = buf[(r * w + c) * 4];
        mass += v;
        weighted += v * r;
      }
    }
    samples.push({ step: done, centroidRow: mass > 0 ? weighted / mass : null, mass });
  }
  return samples;
};

// --- Water conservation + flicker, via the real public API -----------------------------------

globalThis.vgWaterSeries = async () => {
  const w = ${WATER_GRID_W};
  const h = ${WATER_GRID_H};
  const canvas = makeCanvas(w, h);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(w, h);
  const medium = createMediumBackdrop();

  const dt = ${WATER_DT};
  const warmupSteps = Math.round(${WATER_WARMUP_S} / dt);
  const sampleEvery = Math.round(${WATER_SAMPLE_INTERVAL_S} / dt);
  function frame() {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: medium.pass({ gridWidth: w, gridHeight: h, dt }),
    });
  }
  for (let i = 0; i < warmupSteps; i += 1) frame();

  const samples = [];
  for (let i = 0; i < ${WATER_SAMPLES}; i += 1) {
    const totals = medium.readTotals();
    if (!totals) throw new Error('readTotals() returned null after warmup — the medium never rendered');
    samples.push(totals);
    for (let j = 0; j < sampleEvery; j += 1) frame();
  }
  medium.destroy();
  return samples;
};

globalThis.vgFlickerSeries = async () => {
  const w = ${FLICKER_GRID_W};
  const h = ${FLICKER_GRID_H};
  const canvas = makeCanvas(w, h);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const medium = createMediumBackdrop();

  const dt = ${FLICKER_DT};
  function frame() {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: medium.pass({ gridWidth: w, gridHeight: h, dt }),
    });
  }
  for (let i = 0; i < ${FLICKER_WARMUP_STEPS}; i += 1) frame();

  const lumas = [];
  for (let i = 0; i < ${FLICKER_SAMPLE_FRAMES}; i += 1) {
    frame();
    const buf = readCanvas(gl, w, h);
    let sum = 0;
    for (let p = 0; p < w * h; p += 1) {
      sum += 0.2126 * buf[p * 4] + 0.7152 * buf[p * 4 + 1] + 0.0722 * buf[p * 4 + 2];
    }
    lumas.push(sum / (w * h));
  }
  medium.destroy();
  return lumas;
};

// --- Resize: RESAMPLE across a grid-size change, not a reseed --------------------------------
//
// Species channel totals (r/g/b of the vapor grid), not a per-pixel decode: a coefficient of
// variation of the three GRID-WIDE totals — 0 means the three species carry equal mass, larger
// means one or two dominate. This is the "inter-species contrast" the resize check compares
// before/after: a resample carries whatever balance existed across to the new resolution (up to
// resampling error), while a reseed replaces it with the fresh three-spot balance.
function contrastOf(vaporGrid) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < vaporGrid.data.length; i += 3) {
    sumR += vaporGrid.data[i];
    sumG += vaporGrid.data[i + 1];
    sumB += vaporGrid.data[i + 2];
  }
  const mean = (sumR + sumG + sumB) / 3;
  if (mean < 1e-9) return 0;
  const variance = ((sumR - mean) ** 2 + (sumG - mean) ** 2 + (sumB - mean) ** 2) / 3;
  return Math.sqrt(variance) / mean;
}

globalThis.vgResizeSeries = async ({ canary }) => {
  const w1 = ${RESIZE_GRID_W1};
  const h1 = ${RESIZE_GRID_H1};
  const w2 = ${RESIZE_GRID_W2};
  const h2 = ${RESIZE_GRID_H2};
  const canvas = makeCanvas(Math.max(w1, w2), Math.max(h1, h2));
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(canvas.width, canvas.height);
  let medium = createMediumBackdrop();

  const dt = ${RESIZE_DT};
  const warmupSteps = Math.round(${RESIZE_WARMUP_S} / dt);
  const postSteps = Math.round(${RESIZE_POST_S} / dt);

  function frameAt(w, h) {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: medium.pass({ gridWidth: w, gridHeight: h, dt }),
    });
  }

  // Density (total / cell count), not the raw total: the raw sum is SUPPOSED to change across a
  // resize (see the area-ratio rescale of the renormalization target in web/medium.ts — more cells
  // sampling the same average density sum to more) — that's the correct behavior, not drift. The
  // density is what "resample, don't reseed" actually promises to hold steady.
  function measure() {
    const totals = medium.readTotals();
    const vaporGrid = medium.readVaporGrid();
    const cells = vaporGrid.cols * vaporGrid.rows;
    const water = totals.vapor + totals.condensate;
    return {
      water,
      waterDensity: water / cells,
      condensate: totals.condensate,
      condensateDensity: totals.condensate / cells,
      contrast: contrastOf(vaporGrid),
    };
  }

  for (let i = 0; i < warmupSteps; i += 1) frameAt(w1, h1);
  const before = measure();

  if (canary) {
    // The behavior this fix replaces: a resize used to destroy every target and reseed from
    // scratch. Recreating the runtime and calling pass() at the new size reproduces exactly that
    // — createMediumBackdrop's own runtime always seeds on its first ensureGrid call, the same
    // "first call" path a real resize used to take on EVERY call.
    medium.destroy();
    medium = createMediumBackdrop();
  }
  for (let i = 0; i < postSteps; i += 1) frameAt(w2, h2);
  const after = measure();

  medium.destroy();
  return { before, after };
};

// --- Long run: the field's phase wraps without a jump ----------------------------------------

const NOISE_PROBE_PERIODIC = \`
uniform float u_phase;
uniform float u_curlFreq;
\${VG_CURL_NOISE}
half4 main(float2 xy) {
  float v = vgPotential(xy * u_curlFreq, u_phase) * 0.5 + 0.5;
  return half4(half3(v), half(1.0));
}
\`;

// The mistake the design forbids, made concrete: wrap the PHASE VALUE but leave the noise itself
// non-periodic (this is vgPotential's body from before the fix, calling the non-periodic
// vgValueNoise3 that VG_CURL_NOISE still exports). z for octave 0 lands near 600 just before the
// wrap and near 0 just after — two uncorrelated lattice nodes, not neighbors.
const NOISE_PROBE_NAIVE = \`
uniform float u_phase;
uniform float u_curlFreq;
\${VG_CURL_NOISE}
float vgPotentialNaive(float2 p, float phase) {
  float v = vgValueNoise3(float3(p, phase * 0.6)) * 0.5;
  v += vgValueNoise3(float3(p * 2.03, phase * 1.7 + 11.0)) * 0.25;
  v += vgValueNoise3(float3(p * 4.11, phase * 0.9 + 37.0)) * 0.125;
  float macro = vgValueNoise3(float3(p * 0.35, phase * 0.15 + 5.0));
  return v * (0.7 + 0.3 * macro);
}
half4 main(float2 xy) {
  float v = vgPotentialNaive(xy * u_curlFreq, u_phase) * 0.5 + 0.5;
  return half4(half3(v), half(1.0));
}
\`;

globalThis.vgSeamSeries = async ({ periodic }) => {
  const w = ${SEAM_GRID_W};
  const h = ${SEAM_GRID_H};
  const canvas = makeCanvas(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const program = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(periodic ? NOISE_PROBE_PERIODIC : NOISE_PROBE_NAIVE));
  const loc = locationCache(gl, program);

  const T = MEDIUM_TIME_PERIOD;
  const stepPhase = ${SEAM_DT} * MEDIUM_DEFAULTS.curlSpeed;
  const N = ${SEAM_STEPS_EACH_SIDE};
  // Straddles the wrap exactly the way the real CPU accumulator would: N steps approaching T from
  // below, then N steps that would overshoot it, wrapped into [0, T) — a real fixed-step
  // accumulator crossing the boundary produces precisely this sequence of values.
  const phases = [];
  for (let i = -N; i < N; i += 1) {
    const raw = T + i * stepPhase;
    phases.push(((raw % T) + T) % T);
  }

  const lumas = [];
  for (const phase of phases) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    setUniform(gl, loc('u_resolution'), [w, h]);
    setUniform(gl, loc('u_phase'), phase);
    setUniform(gl, loc('u_curlFreq'), MEDIUM_DEFAULTS.curlFreq);
    drawFullscreenTriangle(gl);
    const buf = readCanvas(gl, w, h);
    let sum = 0;
    for (let p = 0; p < w * h; p += 1) sum += buf[p * 4];
    lumas.push(sum / (w * h));
  }
  return { phases, lumas };
};

// --- Depth: parallax + aerial perspective share one rig -----------------------------------------
//
// A bare vapor-only advection rig (seed + forward + correct, no reaction, no condensate/track) —
// exactly the machinery both gates need: real curl-noise motion and real turbulent structure, with
// nothing else mixed in to confound a centroid or a contrast reading.
function makeVaporOnlyRig(gl, w, h, seedSpots, turbulence = 1, vaporDrift = MEDIUM_DEFAULTS.gravityVaporDrift) {
  const seedProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_SEED_SHADER));
  const forwardProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_VAPOR_FORWARD_SHADER));
  const correctProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_VAPOR_CORRECT_SHADER));
  const seedLoc = locationCache(gl, seedProgram);
  const forwardLoc = locationCache(gl, forwardProgram);
  const correctLoc = locationCache(gl, correctProgram);

  // RGBA8 (createTexture's own default) is 256 discrete levels — fine for a fast, large-amplitude
  // field, but a SLOW velocity's per-step displacement (vaporDrift's 0.6 grid-px/s here is
  // ~0.01 grid-px/step at a typical dt) can round away to nothing every single step, since
  // semi-Lagrangian transport re-samples fresh from the already-quantized field each time rather
  // than carrying a continuous sub-pixel position forward — measured directly: at RGBA8 the drift
  // gate showed EXACTLY zero centroid movement over 1000 steps, not just a small one. Matching
  // production's own pickDyeFormat (web/medium.ts) fixes it.
  const hasFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  const format = hasFloat
    ? { internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT }
    : { internalFormat: gl.RGBA8, type: gl.UNSIGNED_BYTE };
  const mk = () => {
    const texture = createTexture(gl, { width: w, height: h, wrap: gl.REPEAT, ...format });
    const fbo = createFramebuffer(gl, texture);
    return { texture, fbo };
  };
  const vapor = [mk(), mk()];
  const forward = mk();
  let front = 0;
  let phase = 0;

  gl.bindFramebuffer(gl.FRAMEBUFFER, vapor[front].fbo);
  gl.viewport(0, 0, w, h);
  gl.disable(gl.BLEND);
  gl.useProgram(seedProgram);
  setUniform(gl, seedLoc('u_resolution'), [w, h]);
  setUniform(gl, seedLoc('u_spot0'), seedSpots[0]);
  setUniform(gl, seedLoc('u_spot1'), seedSpots[1]);
  setUniform(gl, seedLoc('u_spot2'), seedSpots[2]);
  setUniform(gl, seedLoc('u_spotRadius'), seedSpots.radius);
  drawFullscreenTriangle(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  function bindVelocity(loc, dt) {
    setUniform(gl, loc('u_dyeSize'), [w, h]);
    setUniform(gl, loc('u_resolution'), [w, h]);
    setUniform(gl, loc('u_dt'), dt);
    setUniform(gl, loc('u_phase'), phase);
    setUniform(gl, loc('u_curlFreq'), MEDIUM_DEFAULTS.curlFreq);
    bindSpatial(gl, loc, w, h, MEDIUM_DEFAULTS.curlFreq);
    setUniform(gl, loc('u_advectSpeed'), MEDIUM_DEFAULTS.advectSpeed);
    setUniform(gl, loc('u_turbulence'), turbulence);
    setUniform(gl, loc('u_vaporDrift'), vaporDrift);
  }

  function step(dt) {
    phase += dt * MEDIUM_DEFAULTS.curlSpeed;
    const back = front === 0 ? 1 : 0;
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, forward.fbo);
    gl.useProgram(forwardProgram);
    bindTextureAt(gl, 0, vapor[front].texture, forwardProgram, 'u_dye');
    bindVelocity(forwardLoc, dt);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, vapor[back].fbo);
    gl.useProgram(correctProgram);
    bindTextureAt(gl, 0, vapor[front].texture, correctProgram, 'u_dye');
    bindTextureAt(gl, 1, forward.texture, correctProgram, 'u_forward');
    setUniform(gl, correctLoc('u_forwardSize'), [w, h]);
    bindVelocity(correctLoc, dt);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    front = back;
  }

  return { step, texture: () => vapor[front].texture };
}

// Mirrors composite-shader.ts's near/far read exactly (scale + offset), minus the color mix — a
// grayscale density sum, read back for a row/col-weighted centroid.
const DEPTH_PARALLAX_PROBE_SHADER = \`
uniform shader u_vapor;
uniform float  u_scale;
uniform float2 u_offset;
half4 main(float2 xy) {
  float2 src = xy * u_scale + u_offset;
  half4 v = u_vapor.eval(src);
  float w = float(v.r) + float(v.g) + float(v.b);
  return half4(half3(w), half(1.0));
}
\`;

globalThis.vgParallaxSeries = async ({ canary }) => {
  const farScale = canary ? 1 : MEDIUM_DEFAULTS.depthFarScale;
  const w = ${PARALLAX_GRID_W};
  const h = ${PARALLAX_GRID_H};
  // The canary isolates SCALE alone: offset stays [0, 0] for both planes, or a non-zero offset
  // combined with scale=1 would read a DIFFERENT, uncorrelated point of a single seeded blob (an
  // offset only cancels out of a displacement for the SAME scale it was measured at) — that would
  // make the canary noisy for a reason that has nothing to do with the mechanism under test.
  const farOffset = canary ? [0, 0] : depthFarOffsetPx(MEDIUM_DEFAULTS.depthFarOffsetFrac, w, h);
  const canvas = makeCanvas(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const spot = [w / 2, h / 2];
  // Zero turbulence, a clean constant velocity instead: real curl-noise turbulence spreads and
  // reshapes the blob over many steps, which is exactly the kind of chaotic, multi-featured content
  // a SINGLE weighted centroid can't track reliably. A rigid translation has no such ambiguity.
  const rig = makeVaporOnlyRig(gl, w, h, Object.assign([spot, spot, spot], { radius: Math.min(w, h) * 0.1 }), 0, ${PARALLAX_TEST_VELOCITY});

  const probeProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(DEPTH_PARALLAX_PROBE_SHADER));
  const probeLoc = locationCache(gl, probeProgram);
  // Returns the whole rendered image, not a centroid: a weighted centroid breaks down for a
  // scale > 1 read of a REPEAT-wrapped field, since \`xy * scale\` sweeps MORE than one period of
  // the field and the visible window can show more than one aliased copy of the blob at once —
  // measured directly, this made the far reading's own centroid computation unreliable (swinging
  // wildly between runs and texture-precision settings on the exact same underlying motion). The
  // NODE side below finds the best whole-image cross-correlation shift instead, which stays
  // correct however many aliased copies are visible, as long as they all move together.
  function renderImage(scale, offset) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(probeProgram);
    bindTextureAt(gl, 0, rig.texture(), probeProgram, 'u_vapor');
    setUniform(gl, probeLoc('u_vaporSize'), [w, h]);
    setUniform(gl, probeLoc('u_scale'), scale);
    setUniform(gl, probeLoc('u_offset'), offset);
    setUniform(gl, probeLoc('u_resolution'), [w, h]);
    drawFullscreenTriangle(gl);
    const buf = readCanvas(gl, w, h);
    const values = new Array(w * h);
    for (let i = 0; i < w * h; i += 1) values[i] = buf[i * 4];
    return values;
  }

  const nearBefore = renderImage(1, [0, 0]);
  const farBefore = renderImage(farScale, farOffset);
  for (let i = 0; i < ${PARALLAX_STEPS}; i += 1) rig.step(${PARALLAX_DT});
  const nearAfter = renderImage(1, [0, 0]);
  const farAfter = renderImage(farScale, farOffset);
  return { w, h, nearBefore, nearAfter, farBefore, farAfter };
};

// Same near/far transform, plus the composite's own 4-tap box blur — blurRadius=0 collapses to
// four reads of the same point, i.e. a plain single-tap read, so this shader also serves as the
// contrast gate's canary (no separate shader needed).
const DEPTH_CONTRAST_PROBE_SHADER = \`
uniform shader u_vapor;
uniform float  u_scale;
uniform float2 u_offset;
uniform float  u_blurRadius;
half4 main(float2 xy) {
  float2 src = xy * u_scale + u_offset;
  float2 bx = float2(u_blurRadius, 0.0);
  float2 by = float2(0.0, u_blurRadius);
  half4 v = (u_vapor.eval(src + bx) + u_vapor.eval(src - bx) +
             u_vapor.eval(src + by) + u_vapor.eval(src - by)) * half4(0.25);
  float w = float(v.r) + float(v.g) + float(v.b);
  return half4(half3(w), half(1.0));
}
\`;

globalThis.vgContrastSeries = async ({ canary }) => {
  const farBlurRadius = canary ? 0 : MEDIUM_DEFAULTS.depthFarBlurRadius;
  const w = ${CONTRAST_GRID_W};
  const h = ${CONTRAST_GRID_H};
  const canvas = makeCanvas(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  // The production three-spot layout (see web/medium.ts's own seed()), not a single blob — real
  // multi-species turbulence is what has contrast to reduce.
  const seedSpots = Object.assign(
    [[w * 0.28, h * 0.64], [w * 0.7, h * 0.32], [w * 0.48, h * 0.84]],
    { radius: Math.max(w, h) * 0.18 },
  );
  const rig = makeVaporOnlyRig(gl, w, h, seedSpots);
  for (let i = 0; i < ${CONTRAST_STEPS}; i += 1) rig.step(${CONTRAST_DT});

  const probeProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(DEPTH_CONTRAST_PROBE_SHADER));
  const probeLoc = locationCache(gl, probeProgram);
  function render(scale, offset, blurRadius) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(probeProgram);
    bindTextureAt(gl, 0, rig.texture(), probeProgram, 'u_vapor');
    setUniform(gl, probeLoc('u_vaporSize'), [w, h]);
    setUniform(gl, probeLoc('u_scale'), scale);
    setUniform(gl, probeLoc('u_offset'), offset);
    setUniform(gl, probeLoc('u_blurRadius'), blurRadius);
    setUniform(gl, probeLoc('u_resolution'), [w, h]);
    drawFullscreenTriangle(gl);
    const buf = readCanvas(gl, w, h);
    const values = [];
    for (let i = 0; i < w * h; i += 1) values.push(buf[i * 4]);
    return values;
  }

  const near = render(1, [0, 0], 0);
  const far = render(
    MEDIUM_DEFAULTS.depthFarScale,
    depthFarOffsetPx(MEDIUM_DEFAULTS.depthFarOffsetFrac, w, h),
    farBlurRadius,
  );
  return { near, far };
};

// --- Depth: decorrelation — the far plane must not echo the near one --------------------------
//
// The bug this gate exists for: a fixed grid-px offset wraps on this periodic (REPEAT) field, and
// its EFFECTIVE (wrapped) distance from zero depends on the grid size it happens to run at — small
// at some sizes even though the raw number looks "large" (67 grid-px at gridHeight 72, this
// package's own README example, wraps to just 5px). At 128x72 specifically (the README's own
// number, and this package's COST_GRID) this rig proves the two planes read as decorrelated, not
// nearly-identical, via a real turbulence field's Pearson correlation between a near read (scale 1,
// offset 0) and a far read (production scale + offset) — no blur here, so a genuine echo shows up
// as correlation near 1 and REAL decorrelation as something much lower.
globalThis.vgDecorrelationSeries = async ({ canary }) => {
  const w = ${DECORRELATION_GRID_W};
  const h = ${DECORRELATION_GRID_H};
  // The canary: a tiny effective offset, well under one curl-noise wavelength (~22 grid-px at the
  // shipped curlFreq) — exactly the failure mode a fixed grid-px value could still produce by
  // accident at a grid size nobody tested (see depthFarOffsetPx's own comment).
  const farOffset = canary ? [2, 2] : depthFarOffsetPx(MEDIUM_DEFAULTS.depthFarOffsetFrac, w, h);
  // Scale is held at 1 for BOTH readings here, deliberately NOT the production depthFarScale
  // (1.6): measured directly, scale=1.6 alone already decorrelates from the near plane regardless
  // of offset (correlation stays in the -0.16..0.09 noise band whether the offset is 0, tiny, or
  // the real fraction) — it would mask exactly the failure this gate exists to catch. Isolating
  // offset's OWN contribution at scale=1 is the stricter test: the real composite adds scale's own
  // decorrelation on top, so this only ever undersells production, never oversells it.
  const canvas = makeCanvas(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const seedSpots = Object.assign(
    [[w * 0.28, h * 0.64], [w * 0.7, h * 0.32], [w * 0.48, h * 0.84]],
    { radius: Math.max(w, h) * 0.18 },
  );
  const rig = makeVaporOnlyRig(gl, w, h, seedSpots);
  for (let i = 0; i < ${DECORRELATION_STEPS}; i += 1) rig.step(${DECORRELATION_DT});

  const probeProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(DEPTH_PARALLAX_PROBE_SHADER));
  const probeLoc = locationCache(gl, probeProgram);
  function render(scale, offset) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(probeProgram);
    bindTextureAt(gl, 0, rig.texture(), probeProgram, 'u_vapor');
    setUniform(gl, probeLoc('u_vaporSize'), [w, h]);
    setUniform(gl, probeLoc('u_scale'), scale);
    setUniform(gl, probeLoc('u_offset'), offset);
    setUniform(gl, probeLoc('u_resolution'), [w, h]);
    drawFullscreenTriangle(gl);
    const buf = readCanvas(gl, w, h);
    const values = [];
    for (let i = 0; i < w * h; i += 1) values.push(buf[i * 4]);
    return values;
  }

  const near = render(1, [0, 0]);
  const far = render(1, farOffset);
  return { near, far };
};

// --- Gravity: the bottom boost is a steady-state compositing property ----------------------------
//
// Two identical grayscale spots, seeded symmetrically (see the constants above) — a hand-rolled
// seed rather than MEDIUM_SEED_SHADER's three-channel/three-position layout, so the bottom-band and
// top-band densities are EQUAL BY CONSTRUCTION before any boost, with no hue confound and no
// dependency on turbulent mixing to get there. Zero simulated steps: only the real
// MEDIUM_COMPOSITE_SHADER runs, once, with a direct \`u_gravityBoost\` override — a steady-state
// reading of the compositing math alone, exactly like the boost itself.
const BOOST_SEED_SHADER = \`
uniform float2 u_bottomSpot;
uniform float2 u_topSpot;
uniform float  u_radius;
float vgBoostSpot(float2 p, float2 c, float r) {
  float d = length(p - c) / max(r, 1.0);
  return exp(-d * d * 2.0);
}
half4 main(float2 xy) {
  float v = vgBoostSpot(xy, u_bottomSpot, u_radius) + vgBoostSpot(xy, u_topSpot, u_radius);
  return half4(half3(v), half(1.0));
}
\`;

// Routed through the REAL renderer (createVireGlassRenderer + a custom backdrop pass), not a bare
// draw to the default framebuffer: VireGlass's own contentTexture-then-blit pipeline applies an
// orientation step of its own (see the file header's ORIENTATION CONTRACT comment reproduced in
// composite-shader.ts), and a hand-rolled draw straight to the canvas skips it — measured directly,
// that bare-draw version put the boost on the WRONG band. Going through renderer.render() the same
// way the condensate gravity rig above does keeps this rig honest about what a real frame shows.
globalThis.vgBoostSeries = async ({ canary }) => {
  const boost = canary ? 0 : MEDIUM_DEFAULTS.gravityBottomBoost;
  const gridW = ${BOOST_GRID_W};
  const gridH = ${BOOST_GRID_H};
  const cw = ${BOOST_CANVAS_W};
  const ch = ${BOOST_CANVAS_H};
  const canvas = makeCanvas(cw, ch);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(cw, ch);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });

  const seedProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(BOOST_SEED_SHADER));
  const compositeProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_COMPOSITE_SHADER));
  const seedLoc = locationCache(gl, seedProgram);
  const compositeLoc = locationCache(gl, compositeProgram);
  const mk = () => {
    const texture = createTexture(gl, { width: gridW, height: gridH, wrap: gl.REPEAT });
    const fbo = createFramebuffer(gl, texture);
    return { texture, fbo };
  };
  const vaporTex = mk();
  const condensateTex = mk();
  const trackTex = mk();
  let seeded = false;

  function seed() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, vaporTex.fbo);
    gl.viewport(0, 0, gridW, gridH);
    gl.disable(gl.BLEND);
    gl.useProgram(seedProgram);
    setUniform(gl, seedLoc('u_resolution'), [gridW, gridH]);
    setUniform(gl, seedLoc('u_bottomSpot'), [gridW * 0.5, gridH * 0.15]);
    setUniform(gl, seedLoc('u_topSpot'), [gridW * 0.5, gridH * 0.85]);
    setUniform(gl, seedLoc('u_radius'), Math.min(gridW, gridH) * 0.15);
    drawFullscreenTriangle(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // condensate/track stay however createTexture initializes them (zero) — no seed pass needed.
  }

  function pass(gl, target) {
    if (!seeded) {
      seed();
      seeded = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.BLEND);
    gl.useProgram(compositeProgram);
    bindTextureAt(gl, 0, vaporTex.texture, compositeProgram, 'u_vapor');
    bindTextureAt(gl, 1, condensateTex.texture, compositeProgram, 'u_condensate');
    bindTextureAt(gl, 2, trackTex.texture, compositeProgram, 'u_track');
    setUniform(gl, compositeLoc('u_vaporSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_condensateSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_trackSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_resolution'), [target.width, target.height]);
    setUniform(gl, compositeLoc('u_dyeScale'), [gridW / target.width, gridH / target.height]);
    setUniform(gl, compositeLoc('u_lab0'), [0.5, 0.05, 0.05]);
    setUniform(gl, compositeLoc('u_lab1'), [0.5, -0.05, 0.05]);
    setUniform(gl, compositeLoc('u_lab2'), [0.5, 0.05, -0.05]);
    setUniform(gl, compositeLoc('u_labBg'), [0.1, 0, 0]);
    setUniform(gl, compositeLoc('u_labCondensate'), [0.9, 0, 0]);
    setUniform(gl, compositeLoc('u_baseWeight'), MEDIUM_DEFAULTS.baseWeight);
    setUniform(gl, compositeLoc('u_condensateTint'), MEDIUM_DEFAULTS.condensateTint);
    setUniform(gl, compositeLoc('u_condensateGain'), MEDIUM_DEFAULTS.condensateGain);
    // The far plane is disabled (weight 0): this gate is about the boost alone, and a nonzero far
    // weight would fold in whatever asymmetry the scale+offset transform introduces, confounding
    // the "symmetric absent boost" premise the seeding above relies on.
    setUniform(gl, compositeLoc('u_farScale'), 1);
    setUniform(gl, compositeLoc('u_farOffset'), [0, 0]);
    setUniform(gl, compositeLoc('u_farBlurRadius'), 0);
    setUniform(gl, compositeLoc('u_farWeight'), 0);
    setUniform(gl, compositeLoc('u_gravityBoost'), boost);
    setUniform(gl, compositeLoc('u_gravityBoostStart'), MEDIUM_DEFAULTS.gravityBottomBoostStart);
    drawFullscreenTriangle(gl);
  }

  renderer.render({ density: 1, debug: 'normal', pieces: [], backdrop: pass });
  const buf = readCanvas(gl, cw, ch);

  const bandRows = Math.round(ch * ${BOOST_BAND});
  function bandMeanLuma(rowStart, rowEnd) {
    let sum = 0;
    let count = 0;
    for (let r = rowStart; r < rowEnd; r += 1) {
      for (let c = 0; c < cw; c += 1) {
        const i = (r * cw + c) * 4;
        sum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
        count += 1;
      }
    }
    return sum / count;
  }
  // Row 0 is the canvas's own visual BOTTOM (see readCanvas's comment above) — true here because
  // this rig goes through the real renderer, unlike the direct-draw version this replaced.
  const bottomLuma = bandMeanLuma(0, bandRows);
  const topLuma = bandMeanLuma(ch - bandRows, ch);
  return { bottomLuma, topLuma };
};

// --- Gravity: vapor drift is a motion-direction cue, valid at any (bounded) time -----------------

globalThis.vgVaporDriftSeries = async ({ canary }) => {
  const drift = canary ? 0 : MEDIUM_DEFAULTS.gravityVaporDrift;
  const w = ${DRIFT_GRID_W};
  const h = ${DRIFT_GRID_H};
  const canvas = makeCanvas(w, h);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const spot = [w / 2, h / 2];
  // Zero turbulence isolates drift exactly like the condensate gravity rig isolates settle at the
  // top of this file: with u_turbulence=0 the curl term vanishes entirely, leaving drift as the
  // sole velocity, so the centroid moves by a predictable, noise-free amount.
  const rig = makeVaporOnlyRig(
    gl,
    w,
    h,
    Object.assign([spot, spot, spot], { radius: Math.min(w, h) * 0.1 }),
    0,
    drift,
  );

  const probeProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(DEPTH_PARALLAX_PROBE_SHADER));
  const probeLoc = locationCache(gl, probeProgram);
  function centroidNow() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(probeProgram);
    bindTextureAt(gl, 0, rig.texture(), probeProgram, 'u_vapor');
    setUniform(gl, probeLoc('u_vaporSize'), [w, h]);
    setUniform(gl, probeLoc('u_scale'), 1);
    setUniform(gl, probeLoc('u_offset'), [0, 0]);
    setUniform(gl, probeLoc('u_resolution'), [w, h]);
    drawFullscreenTriangle(gl);
    const buf = readCanvas(gl, w, h);
    let mass = 0;
    let weighted = 0;
    for (let r = 0; r < h; r += 1) {
      for (let c = 0; c < w; c += 1) {
        const v = buf[(r * w + c) * 4];
        mass += v;
        weighted += v * r;
      }
    }
    return mass > 0 ? weighted / mass : null;
  }

  const checkpoints = ${JSON.stringify(DRIFT_CHECKPOINTS)};
  let done = 0;
  const samples = [];
  for (const target of checkpoints) {
    while (done < target) {
      rig.step(${DRIFT_DT});
      done += 1;
    }
    samples.push({ step: done, centroidRow: centroidNow() });
  }
  return samples;
};

// --- Cost: what the depth composite adds over the pre-depth (single-plane) one -------------------
//
// The pre-depth composite, frozen here ONLY as this gate's baseline — not exported, not used
// anywhere else. Byte-for-byte the shader this file's own git history shows before the depth work
// (see composite-shader.ts's CHANGELOG entry).
const LEGACY_COMPOSITE_SHADER = \`
uniform shader u_vapor;
uniform shader u_condensate;
uniform shader u_track;
uniform float2 u_dyeScale;
uniform float3 u_lab0;
uniform float3 u_lab1;
uniform float3 u_lab2;
uniform float3 u_labBg;
uniform float3 u_labCondensate;
uniform float  u_baseWeight;
uniform float  u_condensateTint;
uniform float  u_condensateGain;

\${VG_OKLAB_TO_SRGB}

half4 main(float2 xy) {
  float2 src = xy * u_dyeScale;
  half4 vapor = u_vapor.eval(src);
  half4 condensate = u_condensate.eval(src);
  half4 track = u_track.eval(src);
  float w0 = float(vapor.r) + float(track.r);
  float w1 = float(vapor.g) + float(track.g);
  float w2 = float(vapor.b) + float(track.b);
  float wBg = u_baseWeight;

  float vaporLocal = max(w0 + w1 + w2, 1e-4);
  float3 vaporHue = (u_lab0 * w0 + u_lab1 * w1 + u_lab2 * w2) / vaporLocal;
  float3 condensateLab = mix(u_labCondensate, vaporHue, u_condensateTint);
  float wCondensate = float(condensate.r) * u_condensateGain;

  float total = max(w0 + w1 + w2 + wBg + wCondensate, 1e-4);
  float3 mixLab =
    (u_labBg * wBg + u_lab0 * w0 + u_lab1 * w1 + u_lab2 * w2 + condensateLab * wCondensate) / total;
  float3 rgbLinear = clamp(vgOklabToLinear(mixLab), float3(0.0), float3(1.0));
  float3 srgb = vgLinearToSrgb(rgbLinear);
  return half4(half3(srgb), half(1.0));
}
\`;

globalThis.vgCompositeCost = async () => {
  const gridW = ${COST_GRID_W};
  const gridH = ${COST_GRID_H};
  const cw = ${COST_CANVAS_W};
  const ch = ${COST_CANVAS_H};

  // A real GPU timer reading, via the real pipeline — null in headless Chromium without
  // EXT_disjoint_timer_query_webgl2 (see the report for which method actually measured this run).
  const timerCanvas = makeCanvas(cw, ch);
  const renderer = createVireGlassRenderer(timerCanvas);
  renderer.resize(cw, ch);
  const timedMedium = createMediumBackdrop();
  for (let i = 0; i < 10; i += 1) {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: timedMedium.pass({ gridWidth: gridW, gridHeight: gridH, dt: 1 / 60 }),
    });
  }
  const gpuMs = renderer.getLastGpuMs();
  timedMedium.destroy();

  // CPU wall-time fallback: the ONE shader this work changed, isolated from the rest of the step,
  // against static content at CONTENT resolution — the same single draw call the real pipeline
  // issues once per frame (see composite() in web/medium.ts).
  const canvas = makeCanvas(cw, ch);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const seedProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_SEED_SHADER));
  const seedLoc = locationCache(gl, seedProgram);
  const mk = () => {
    const texture = createTexture(gl, { width: gridW, height: gridH, wrap: gl.REPEAT });
    const fbo = createFramebuffer(gl, texture);
    return { texture, fbo };
  };
  const vaporTex = mk();
  const condensateTex = mk();
  const trackTex = mk();
  gl.bindFramebuffer(gl.FRAMEBUFFER, vaporTex.fbo);
  gl.viewport(0, 0, gridW, gridH);
  gl.disable(gl.BLEND);
  gl.useProgram(seedProgram);
  setUniform(gl, seedLoc('u_resolution'), [gridW, gridH]);
  setUniform(gl, seedLoc('u_spot0'), [gridW * 0.28, gridH * 0.64]);
  setUniform(gl, seedLoc('u_spot1'), [gridW * 0.7, gridH * 0.32]);
  setUniform(gl, seedLoc('u_spot2'), [gridW * 0.48, gridH * 0.84]);
  setUniform(gl, seedLoc('u_spotRadius'), Math.max(gridW, gridH) * 0.18);
  drawFullscreenTriangle(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  function timeComposite(fragmentSource) {
    const program = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(fragmentSource));
    const loc = locationCache(gl, program);
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    bindTextureAt(gl, 0, vaporTex.texture, program, 'u_vapor');
    bindTextureAt(gl, 1, condensateTex.texture, program, 'u_condensate');
    bindTextureAt(gl, 2, trackTex.texture, program, 'u_track');
    setUniform(gl, loc('u_vaporSize'), [gridW, gridH]);
    setUniform(gl, loc('u_condensateSize'), [gridW, gridH]);
    setUniform(gl, loc('u_trackSize'), [gridW, gridH]);
    setUniform(gl, loc('u_resolution'), [cw, ch]);
    setUniform(gl, loc('u_dyeScale'), [gridW / cw, gridH / ch]);
    setUniform(gl, loc('u_lab0'), [0.5, 0.05, 0.05]);
    setUniform(gl, loc('u_lab1'), [0.5, -0.05, 0.05]);
    setUniform(gl, loc('u_lab2'), [0.5, 0.05, -0.05]);
    setUniform(gl, loc('u_labBg'), [0.1, 0, 0]);
    setUniform(gl, loc('u_labCondensate'), [0.9, 0, 0]);
    setUniform(gl, loc('u_baseWeight'), MEDIUM_DEFAULTS.baseWeight);
    setUniform(gl, loc('u_condensateTint'), MEDIUM_DEFAULTS.condensateTint);
    setUniform(gl, loc('u_condensateGain'), MEDIUM_DEFAULTS.condensateGain);
    setUniform(gl, loc('u_farScale'), MEDIUM_DEFAULTS.depthFarScale);
    setUniform(gl, loc('u_farOffset'), depthFarOffsetPx(MEDIUM_DEFAULTS.depthFarOffsetFrac, gridW, gridH));
    setUniform(gl, loc('u_farBlurRadius'), MEDIUM_DEFAULTS.depthFarBlurRadius);
    setUniform(gl, loc('u_farWeight'), MEDIUM_DEFAULTS.depthFarWeight);
    setUniform(gl, loc('u_gravityBoost'), MEDIUM_DEFAULTS.gravityBottomBoost);
    setUniform(gl, loc('u_gravityBoostStart'), MEDIUM_DEFAULTS.gravityBottomBoostStart);

    drawFullscreenTriangle(gl);
    gl.finish();
    const start = performance.now();
    for (let i = 0; i < ${COST_FRAMES}; i += 1) drawFullscreenTriangle(gl);
    gl.finish();
    const elapsed = performance.now() - start;
    gl.deleteProgram(program);
    return elapsed / ${COST_FRAMES};
  }

  const wallMsBaseline = timeComposite(LEGACY_COMPOSITE_SHADER);
  const wallMsDepth = timeComposite(MEDIUM_COMPOSITE_SHADER);
  return { gpuMs, wallMsBaseline, wallMsDepth };
};

// --- Isotropy: the composited backdrop must not read as a lattice of straight lines --------------
//
// Full transport pipeline (seed, MacCormack for vapor AND condensate, phase exchange, the real
// composite) at the product's own default size and grid. Tracks are omitted from BOTH the canary
// and the correct rig below: a track's own randomized stamp angle plays no part in the AXIS-ALIGNED
// mechanisms under test, and leaving it out of both equally keeps the comparison isolated to
// exactly the four things the fix changed (a sanity run with tracks included, through the real
// public API, is in the fix's own report).
//
// canary=true is the pre-fix medium, not a single-variable switch: a non-periodic lattice, no
// settle wiggle and the old composite together, so a failure of the correct rig can come from any
// of the three. Its lattice shares the EXACT SAME per-octave
// frequencies computeMediumSpatialPeriods gives the correct rig (so both rigs carry the same
// turbulence intensity — see bindVelocity's own comment for why matching current main's RAW
// MEDIUM_TIME_OCTAVES scales instead, a first-draft of this canary, was a confound rather than a
// fix: at this small grid, correct's frequency ADJUSTMENT (needed to land on an integer period)
// is itself enough to change how much condensate forms, independent of periodicity), just with
// the period set so large mod() never wraps in practice — the identical trick NOISE_PROBE_NAIVE
// above uses to reach a pre-periodic field. u_settleWiggle is 0. Only the COMPOSITE shader itself
// is a genuinely frozen old copy (\`CANARY_COMPOSITE_SHADER\`, the pre-fix ±x/±y blur and no bicubic)
// — the one piece of this fix that changed shader TEXT rather than a uniform value.
const ISOTROPY_NO_WRAP = 1000000;

const CANARY_COMPOSITE_SHADER = \`
uniform shader u_vapor;
uniform shader u_condensate;
uniform shader u_track;
uniform float2 u_dyeScale;
uniform float3 u_lab0;
uniform float3 u_lab1;
uniform float3 u_lab2;
uniform float3 u_labBg;
uniform float3 u_labCondensate;
uniform float  u_baseWeight;
uniform float  u_condensateTint;
uniform float  u_condensateGain;
uniform float  u_farScale;
uniform float2 u_farOffset;
uniform float  u_farBlurRadius;
uniform float  u_farWeight;
uniform float  u_gravityBoost;
uniform float  u_gravityBoostStart;

\${VG_OKLAB_TO_SRGB}

half4 main(float2 xy) {
  float2 baseSrc = xy * u_dyeScale;
  half4 vapor = u_vapor.eval(baseSrc);
  half4 condensate = u_condensate.eval(baseSrc);
  half4 track = u_track.eval(baseSrc);

  float2 farSrc = baseSrc * u_farScale + u_farOffset;
  float2 blurX = float2(u_farBlurRadius, 0.0);
  float2 blurY = float2(0.0, u_farBlurRadius);
  half4 vaporFar = (u_vapor.eval(farSrc + blurX) + u_vapor.eval(farSrc - blurX) +
                     u_vapor.eval(farSrc + blurY) + u_vapor.eval(farSrc - blurY)) * half4(0.25);
  half4 condensateFar = (u_condensate.eval(farSrc + blurX) + u_condensate.eval(farSrc - blurX) +
                          u_condensate.eval(farSrc + blurY) + u_condensate.eval(farSrc - blurY)) * half4(0.25);

  float bottomFrac = 1.0 - xy.y / u_resolution.y;
  float bottomT = smoothstep(u_gravityBoostStart, 1.0, bottomFrac);
  float bottomBoost = 1.0 + u_gravityBoost * bottomT;

  float gasR = (float(vapor.r) + float(vaporFar.r) * u_farWeight) * bottomBoost;
  float gasG = (float(vapor.g) + float(vaporFar.g) * u_farWeight) * bottomBoost;
  float gasB = (float(vapor.b) + float(vaporFar.b) * u_farWeight) * bottomBoost;
  float w0 = gasR + float(track.r);
  float w1 = gasG + float(track.g);
  float w2 = gasB + float(track.b);
  float wBg = u_baseWeight;

  float vaporLocal = max(w0 + w1 + w2, 1e-4);
  float3 vaporHue = (u_lab0 * w0 + u_lab1 * w1 + u_lab2 * w2) / vaporLocal;
  float3 condensateLab = mix(u_labCondensate, vaporHue, u_condensateTint);
  float wCondensate =
    (float(condensate.r) + float(condensateFar.r) * u_farWeight) * u_condensateGain * bottomBoost;

  float total = max(w0 + w1 + w2 + wBg + wCondensate, 1e-4);
  float3 mixLab =
    (u_labBg * wBg + u_lab0 * w0 + u_lab1 * w1 + u_lab2 * w2 + condensateLab * wCondensate) / total;
  float3 rgbLinear = clamp(vgOklabToLinear(mixLab), float3(0.0), float3(1.0));
  float3 srgb = vgLinearToSrgb(rgbLinear);
  return half4(half3(srgb), half(1.0));
}
\`;

function makeIsotropyRig(gl, { gridW, gridH, canary }) {
  const vaporForwardProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_VAPOR_FORWARD_SHADER));
  const vaporCorrectProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_VAPOR_CORRECT_SHADER));
  const vaporReactProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_VAPOR_REACT_SHADER));
  const condensateForwardProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_CONDENSATE_FORWARD_SHADER));
  const condensateCorrectProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_CONDENSATE_CORRECT_SHADER));
  const condensateReactProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_CONDENSATE_REACT_SHADER));
  const seedProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(MEDIUM_SEED_SHADER));
  const compositeProgram = createProgram(
    gl,
    FULLSCREEN_TRIANGLE_VERTEX_SOURCE,
    toGLSL(canary ? CANARY_COMPOSITE_SHADER : MEDIUM_COMPOSITE_SHADER),
  );

  const vfLoc = locationCache(gl, vaporForwardProgram);
  const vcLoc = locationCache(gl, vaporCorrectProgram);
  const vrLoc = locationCache(gl, vaporReactProgram);
  const cfLoc = locationCache(gl, condensateForwardProgram);
  const ccLoc = locationCache(gl, condensateCorrectProgram);
  const crLoc = locationCache(gl, condensateReactProgram);
  const seedLoc = locationCache(gl, seedProgram);
  const compositeLoc = locationCache(gl, compositeProgram);

  const hasFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  const format = hasFloat
    ? { internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT }
    : { internalFormat: gl.RGBA8, type: gl.UNSIGNED_BYTE };
  const mk = () => {
    const texture = createTexture(gl, { width: gridW, height: gridH, wrap: gl.REPEAT, ...format });
    const fbo = createFramebuffer(gl, texture);
    return { texture, fbo };
  };
  const vapor = [mk(), mk()];
  const condensate = [mk(), mk()];
  const vaporForward = mk();
  const vaporCorrected = mk();
  const condensateForward = mk();
  const condensateCorrected = mk();
  const track = mk(); // stays constant zero — see the file header on why both rigs omit stamping
  let front = 0;
  let phase = 0;

  // Water renormalization, mirrored from web/medium.ts's own step(): a semi-Lagrangian gather has
  // no obligation to conserve vapor+condensate by itself, and over this rig's 60s window (vs. the
  // water gate's 15s sampling) an uncorrected drift is large enough to matter — measured directly,
  // an earlier draft of this rig with u_totalScale pinned to 1 let density collapse far enough that
  // 8-bit quantization/banding (itself axis-aligned, from the rectangular pixel grid) dominated the
  // isotropy reading instead of the actual structural artifacts this gate exists to measure.
  function readTarget(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    let sum = 0;
    if (hasFloat) {
      const buf = new Float32Array(gridW * gridH * 4);
      gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.FLOAT, buf);
      for (let i = 0; i < buf.length; i += 4) sum += buf[i] + buf[i + 1] + buf[i + 2];
    } else {
      const buf = new Uint8Array(gridW * gridH * 4);
      gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let i = 0; i < buf.length; i += 4) sum += (buf[i] + buf[i + 1] + buf[i + 2]) / 255;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return sum;
  }
  const WATER_RENORM_INTERVAL_S = 1;
  let waterTargetTotal = 0;
  let waterScale = 1;
  let timeSinceRenorm = 0;
  let framesSinceRenorm = 0;

  // The real production seed layout (web/medium.ts's own seed()) — three spots, not a single blob:
  // isotropy is a question about the STEADY structure a real screen shows, not one feature.
  gl.bindFramebuffer(gl.FRAMEBUFFER, vapor[front].fbo);
  gl.viewport(0, 0, gridW, gridH);
  gl.disable(gl.BLEND);
  gl.useProgram(seedProgram);
  setUniform(gl, seedLoc('u_resolution'), [gridW, gridH]);
  setUniform(gl, seedLoc('u_spot0'), [gridW * 0.28, gridH * 0.64]);
  setUniform(gl, seedLoc('u_spot1'), [gridW * 0.7, gridH * 0.32]);
  setUniform(gl, seedLoc('u_spot2'), [gridW * 0.48, gridH * 0.84]);
  setUniform(gl, seedLoc('u_spotRadius'), Math.max(gridW, gridH) * 0.18);
  drawFullscreenTriangle(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  waterTargetTotal = readTarget(vapor[front]) + readTarget(condensate[front]);

  function bindVelocity(loc, dt) {
    setUniform(gl, loc('u_dyeSize'), [gridW, gridH]);
    setUniform(gl, loc('u_resolution'), [gridW, gridH]);
    setUniform(gl, loc('u_dt'), dt);
    setUniform(gl, loc('u_phase'), phase);
    setUniform(gl, loc('u_curlFreq'), MEDIUM_DEFAULTS.curlFreq);
    setUniform(gl, loc('u_advectSpeed'), MEDIUM_DEFAULTS.advectSpeed);
    setUniform(gl, loc('u_turbulence'), MEDIUM_DEFAULTS.turbulence);
    setUniform(gl, loc('u_vaporDrift'), MEDIUM_DEFAULTS.gravityVaporDrift);
    // canary uses the EXACT SAME frequencies as correct (computeMediumSpatialPeriods), only with
    // periods so large mod() never wraps — isolating PERIODICITY as the only variable between the
    // two rigs. An earlier draft gave the canary the raw MEDIUM_TIME_OCTAVES scales directly
    // (reproducing old vgPotential bit-for-bit); that is a faithful reproduction of current main,
    // but it also gives the canary WEAKER turbulence than correct's frequency-adjusted octaves
    // (needed to hit an integer period — see computeMediumSpatialPeriods's own comment), which on
    // this small grid was enough to change whether condensate forms at all — a confound unrelated
    // to periodicity that made the canary read as MORE isotropic than the fix, the opposite of a
    // working canary. Sharing frequencies removes that confound; not wrapping is still the one
    // thing current main actually got wrong.
    const spatial = computeMediumSpatialPeriods(gridW, gridH, MEDIUM_DEFAULTS.curlFreq);
    for (let i = 0; i < 4; i += 1) {
      const periodX = canary ? ISOTROPY_NO_WRAP : spatial[i].periodX;
      const periodY = canary ? ISOTROPY_NO_WRAP : spatial[i].periodY;
      setUniform(gl, loc('u_spatial' + i), [spatial[i].freqX, spatial[i].freqY, periodX, periodY]);
    }
  }

  function step(dt) {
    phase = (phase + dt * MEDIUM_DEFAULTS.curlSpeed) % MEDIUM_TIME_PERIOD;
    const back = front === 0 ? 1 : 0;
    gl.viewport(0, 0, gridW, gridH);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, vaporForward.fbo);
    gl.useProgram(vaporForwardProgram);
    bindTextureAt(gl, 0, vapor[front].texture, vaporForwardProgram, 'u_dye');
    bindVelocity(vfLoc, dt);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, condensateForward.fbo);
    gl.useProgram(condensateForwardProgram);
    bindTextureAt(gl, 0, condensate[front].texture, condensateForwardProgram, 'u_dye');
    bindVelocity(cfLoc, dt);
    setUniform(gl, cfLoc('u_settleSpeed'), MEDIUM_DEFAULTS.condensateSettleSpeed);
    setUniform(gl, cfLoc('u_settleWiggle'), canary ? 0 : MEDIUM_DEFAULTS.condensateSettleWiggle);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, vaporCorrected.fbo);
    gl.useProgram(vaporCorrectProgram);
    bindTextureAt(gl, 0, vapor[front].texture, vaporCorrectProgram, 'u_dye');
    bindTextureAt(gl, 1, vaporForward.texture, vaporCorrectProgram, 'u_forward');
    setUniform(gl, vcLoc('u_forwardSize'), [gridW, gridH]);
    bindVelocity(vcLoc, dt);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, condensateCorrected.fbo);
    gl.useProgram(condensateCorrectProgram);
    bindTextureAt(gl, 0, condensate[front].texture, condensateCorrectProgram, 'u_dye');
    bindTextureAt(gl, 1, condensateForward.texture, condensateCorrectProgram, 'u_forward');
    setUniform(gl, ccLoc('u_forwardSize'), [gridW, gridH]);
    bindVelocity(ccLoc, dt);
    setUniform(gl, ccLoc('u_settleSpeed'), MEDIUM_DEFAULTS.condensateSettleSpeed);
    setUniform(gl, ccLoc('u_settleWiggle'), canary ? 0 : MEDIUM_DEFAULTS.condensateSettleWiggle);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, vapor[back].fbo);
    gl.useProgram(vaporReactProgram);
    bindTextureAt(gl, 0, vaporCorrected.texture, vaporReactProgram, 'u_transported');
    bindTextureAt(gl, 1, condensateCorrected.texture, vaporReactProgram, 'u_condensateTransported');
    setUniform(gl, vrLoc('u_transportedSize'), [gridW, gridH]);
    setUniform(gl, vrLoc('u_condensateTransportedSize'), [gridW, gridH]);
    setUniform(gl, vrLoc('u_resolution'), [gridW, gridH]);
    setUniform(gl, vrLoc('u_dt'), dt);
    setUniform(gl, vrLoc('u_condensationRate'), MEDIUM_DEFAULTS.condensationRate);
    setUniform(gl, vrLoc('u_condensationFloor'), MEDIUM_DEFAULTS.condensationFloor);
    setUniform(gl, vrLoc('u_evaporationRate'), MEDIUM_DEFAULTS.evaporationRate);
    setUniform(gl, vrLoc('u_totalScale'), waterScale);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, condensate[back].fbo);
    gl.useProgram(condensateReactProgram);
    bindTextureAt(gl, 0, condensateCorrected.texture, condensateReactProgram, 'u_transported');
    bindTextureAt(gl, 1, vaporCorrected.texture, condensateReactProgram, 'u_vaporTransported');
    bindTextureAt(gl, 2, condensate[front].texture, condensateReactProgram, 'u_dye');
    setUniform(gl, crLoc('u_transportedSize'), [gridW, gridH]);
    setUniform(gl, crLoc('u_vaporTransportedSize'), [gridW, gridH]);
    setUniform(gl, crLoc('u_dyeSize'), [gridW, gridH]);
    setUniform(gl, crLoc('u_resolution'), [gridW, gridH]);
    setUniform(gl, crLoc('u_dt'), dt);
    setUniform(gl, crLoc('u_condensationRate'), MEDIUM_DEFAULTS.condensationRate);
    setUniform(gl, crLoc('u_condensationFloor'), MEDIUM_DEFAULTS.condensationFloor);
    setUniform(gl, crLoc('u_evaporationRate'), MEDIUM_DEFAULTS.evaporationRate);
    setUniform(gl, crLoc('u_spreadRate'), MEDIUM_DEFAULTS.condensateSpreadRate);
    setUniform(gl, crLoc('u_totalScale'), waterScale);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    front = back;
    framesSinceRenorm += 1;
    timeSinceRenorm += dt;
    if (waterTargetTotal > 0 && timeSinceRenorm >= WATER_RENORM_INTERVAL_S && framesSinceRenorm > 0) {
      const current = readTarget(vapor[front]) + readTarget(condensate[front]);
      if (current > 1e-6) {
        const totalRatio = waterTargetTotal / current;
        const perFrame = Math.pow(totalRatio, 1 / framesSinceRenorm);
        waterScale = Math.min(1.05, Math.max(0.95, perFrame));
      }
      timeSinceRenorm = 0;
      framesSinceRenorm = 0;
    }
  }

  function composite(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.BLEND);
    gl.useProgram(compositeProgram);
    bindTextureAt(gl, 0, vapor[front].texture, compositeProgram, 'u_vapor');
    bindTextureAt(gl, 1, condensate[front].texture, compositeProgram, 'u_condensate');
    bindTextureAt(gl, 2, track.texture, compositeProgram, 'u_track');
    setUniform(gl, compositeLoc('u_vaporSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_condensateSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_trackSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_resolution'), [target.width, target.height]);
    setUniform(gl, compositeLoc('u_dyeScale'), [gridW / target.width, gridH / target.height]);
    setUniform(gl, compositeLoc('u_lab0'), [0.5, 0.05, 0.05]);
    setUniform(gl, compositeLoc('u_lab1'), [0.5, -0.05, 0.05]);
    setUniform(gl, compositeLoc('u_lab2'), [0.5, 0.05, -0.05]);
    setUniform(gl, compositeLoc('u_labBg'), [0.1, 0, 0]);
    setUniform(gl, compositeLoc('u_labCondensate'), [0.9, 0, 0]);
    setUniform(gl, compositeLoc('u_baseWeight'), MEDIUM_DEFAULTS.baseWeight);
    setUniform(gl, compositeLoc('u_condensateTint'), MEDIUM_DEFAULTS.condensateTint);
    setUniform(gl, compositeLoc('u_condensateGain'), MEDIUM_DEFAULTS.condensateGain);
    setUniform(gl, compositeLoc('u_farScale'), MEDIUM_DEFAULTS.depthFarScale);
    const farOffset = depthFarOffsetPx(MEDIUM_DEFAULTS.depthFarOffsetFrac, gridW, gridH);
    setUniform(gl, compositeLoc('u_farOffset'), farOffset);
    setUniform(gl, compositeLoc('u_farBlurRadius'), MEDIUM_DEFAULTS.depthFarBlurRadius);
    setUniform(gl, compositeLoc('u_farWeight'), MEDIUM_DEFAULTS.depthFarWeight);
    setUniform(gl, compositeLoc('u_gravityBoost'), MEDIUM_DEFAULTS.gravityBottomBoost);
    setUniform(gl, compositeLoc('u_gravityBoostStart'), MEDIUM_DEFAULTS.gravityBottomBoostStart);
    drawFullscreenTriangle(gl);
    return farOffset;
  }

  return {
    step,
    composite,
    vaporTexture: () => vapor[front].texture,
    condensateTexture: () => condensate[front].texture,
    gridW,
    gridH,
  };
}

// The far plane's OWN rendered contribution, isolated from the near plane entirely: composite-
// shader.ts's vaporFar/condensateFar terms (ring blur) and CANARY_COMPOSITE_SHADER's own
// (±x/±y box blur), reproduced as standalone probes. The seam check below measures THIS, not the
// full mixed composite — an earlier draft measured the full frame at the far plane's wrap columns
// and found a large "seam" that turned out to be the (unrelated) NEAR-plane bicubic content at
// those same arbitrary screen columns, not anything about the far-plane tile boundary at all; a
// probe that never reads the near plane can't have that confound.
const FAR_BOX_BLUR_PROBE_SHADER = \`
uniform shader u_vapor;
uniform float  u_scale;
uniform float2 u_offset;
uniform float  u_blurRadius;
half4 main(float2 xy) {
  float2 src = xy * u_scale + u_offset;
  float2 bx = float2(u_blurRadius, 0.0);
  float2 by = float2(0.0, u_blurRadius);
  half4 v = (u_vapor.eval(src + bx) + u_vapor.eval(src - bx) +
             u_vapor.eval(src + by) + u_vapor.eval(src - by)) * half4(0.25);
  float w = float(v.r) + float(v.g) + float(v.b);
  return half4(half3(w), half(1.0));
}
\`;

const FAR_RING_BLUR_PROBE_SHADER = \`
uniform shader u_vapor;
uniform float  u_scale;
uniform float2 u_offset;
uniform float  u_blurRadius;
half4 main(float2 xy) {
  float2 src = xy * u_scale + u_offset;
  float2 ring0 = float2( 0.9238795,  0.3826834) * u_blurRadius;
  float2 ring1 = float2( 0.3826834,  0.9238795) * u_blurRadius;
  float2 ring2 = float2(-0.3826834,  0.9238795) * u_blurRadius;
  float2 ring3 = float2(-0.9238795,  0.3826834) * u_blurRadius;
  float2 ring4 = float2(-0.9238795, -0.3826834) * u_blurRadius;
  float2 ring5 = float2(-0.3826834, -0.9238795) * u_blurRadius;
  float2 ring6 = float2( 0.3826834, -0.9238795) * u_blurRadius;
  float2 ring7 = float2( 0.9238795, -0.3826834) * u_blurRadius;
  half4 v = (u_vapor.eval(src + ring0) + u_vapor.eval(src + ring1) +
             u_vapor.eval(src + ring2) + u_vapor.eval(src + ring3) +
             u_vapor.eval(src + ring4) + u_vapor.eval(src + ring5) +
             u_vapor.eval(src + ring6) + u_vapor.eval(src + ring7)) * half4(0.125);
  float w = float(v.r) + float(v.g) + float(v.b);
  return half4(half3(w), half(1.0));
}
\`;

function probeFarField(gl, rig, cw, ch, { blur, field }) {
  const shader =
    blur === 'none' ? DEPTH_PARALLAX_PROBE_SHADER : blur === 'ring' ? FAR_RING_BLUR_PROBE_SHADER : FAR_BOX_BLUR_PROBE_SHADER;
  const probeProgram = createProgram(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE, toGLSL(shader));
  const probeLoc = locationCache(gl, probeProgram);
  const dyeScaleX = rig.gridW / cw;
  const farOffset = depthFarOffsetPx(MEDIUM_DEFAULTS.depthFarOffsetFrac, rig.gridW, rig.gridH);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, cw, ch);
  gl.disable(gl.BLEND);
  gl.useProgram(probeProgram);
  const tex = field === 'condensate' ? rig.condensateTexture() : rig.vaporTexture();
  bindTextureAt(gl, 0, tex, probeProgram, 'u_vapor');
  setUniform(gl, probeLoc('u_vaporSize'), [rig.gridW, rig.gridH]);
  // Composes content->grid scale and the far-plane's own scale into ONE factor — the same product
  // composite-shader.ts's farSrc = (xy * u_dyeScale) * u_farScale + u_farOffset reduces to.
  setUniform(gl, probeLoc('u_scale'), dyeScaleX * MEDIUM_DEFAULTS.depthFarScale);
  setUniform(gl, probeLoc('u_offset'), farOffset);
  if (blur !== 'none') setUniform(gl, probeLoc('u_blurRadius'), MEDIUM_DEFAULTS.depthFarBlurRadius);
  setUniform(gl, probeLoc('u_resolution'), [cw, ch]);
  drawFullscreenTriangle(gl);
  const buf = readCanvas(gl, cw, ch);
  const luma = new Array(cw * ch);
  for (let i = 0; i < cw * ch; i += 1) luma[i] = buf[i * 4];
  gl.deleteProgram(probeProgram);
  return { luma, dyeScaleX, farOffsetX: farOffset[0] };
}

/** Sobel gradient magnitude/orientation, binned into "near an axis" (0°/90°, mod 180°) vs "near a
 *  diagonal" (45°/135°) energy — run in-page so only the final numbers cross the CDP bridge, not a
 *  1920x952 pixel array. \`energy\` is squared magnitude, the usual convention (energy ~ amplitude^2).
 *  The two windows are equal width by construction (see MAX_ISOTROPY_RATIO's own comment), so this
 *  needs no separate normalization to read near 1 for an isotropic field.
 *
 *  \`yStart\`/\`yEnd\` restrict the rows scanned — this gate excludes the gravity bottom-boost band
 *  (see the caller): MEDIUM_DEFAULTS.gravityBottomBoost ramps a SMOOTH, purely vertical density
 *  gradient into the bottom quarter of every frame, by design (the "denser at the chamber floor"
 *  cue) — nothing this fix touches. A pure vertical gradient has gx=0 everywhere, so its gradient
 *  angle is EXACTLY 90°, landing 100% in the axis bin and 0% in the diagonal one; measured directly,
 *  including that band inflates the ratio by a large, constant amount regardless of how isotropic
 *  the turbulent structure itself is — the same reason the aerial-perspective/boost gates each
 *  isolate their own one mechanism (zero the other) instead of reading a confounded frame. */
function vgIsotropyRatio(luma, w, h, yStart, yEnd) {
  const windowRad = (${ISOTROPY_ANGLE_WINDOW_DEG} * Math.PI) / 180;
  let axisEnergy = 0;
  let diagEnergy = 0;
  for (let y = Math.max(1, yStart); y < Math.min(h - 1, yEnd); y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const tl = luma[(y - 1) * w + (x - 1)];
      const t = luma[(y - 1) * w + x];
      const tr = luma[(y - 1) * w + (x + 1)];
      const l = luma[y * w + (x - 1)];
      const r = luma[y * w + (x + 1)];
      const bl = luma[(y + 1) * w + (x - 1)];
      const b = luma[(y + 1) * w + x];
      const br = luma[(y + 1) * w + (x + 1)];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      const energy = gx * gx + gy * gy;
      if (energy < 1e-9) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const distToAxis = Math.min(angle, Math.abs(angle - Math.PI / 2), Math.abs(angle - Math.PI));
      const distToDiag = Math.min(Math.abs(angle - Math.PI / 4), Math.abs(angle - (3 * Math.PI) / 4));
      if (distToAxis <= windowRad) axisEnergy += energy;
      if (distToDiag <= windowRad) diagEnergy += energy;
    }
  }
  return { axisEnergy, diagEnergy, ratio: diagEnergy > 1e-9 ? axisEnergy / diagEnergy : Infinity };
}

/** Mean absolute luma step at the far plane's tile-wrap column(s) (where floor(farSrc.x / gridW)
 *  changes between adjacent screen columns — the SAME condition that puts the wrapped sample on the
 *  other side of the periodic texture) vs. the median step at ordinary columns away from any seam.
 *  Only the x (vertical-line) seam is measured — the y (horizontal-line) one is the same mechanism
 *  on the other axis, and the fix is axis-agnostic. */
function vgSeamColumnRatio(luma, w, h, gridW, dyeScaleX, farScale, farOffsetX) {
  const bucketAt = (x) => Math.floor((x * dyeScaleX * farScale + farOffsetX) / gridW);
  const seamCols = [];
  let prevBucket = bucketAt(0);
  for (let x = 1; x < w; x += 1) {
    const bucket = bucketAt(x);
    if (bucket !== prevBucket) seamCols.push(x);
    prevBucket = bucket;
  }
  const colStep = (x) => {
    let sum = 0;
    for (let y = 0; y < h; y += 1) sum += Math.abs(luma[y * w + x] - luma[y * w + (x - 1)]);
    return sum / h;
  };
  const seamStep = seamCols.length
    ? seamCols.map(colStep).reduce((a, b) => a + b, 0) / seamCols.length
    : 0;
  const margin = 5;
  const stride = 37;
  const typicalSteps = [];
  for (let x = 10; x < w - 10; x += stride) {
    if (seamCols.every((s) => Math.abs(s - x) > margin)) typicalSteps.push(colStep(x));
  }
  typicalSteps.sort((a, b) => a - b);
  const typicalStep = typicalSteps[Math.floor(typicalSteps.length / 2)] ?? 0;
  return {
    seamCols,
    seamStep,
    typicalStep,
    ratio: typicalStep > 1e-9 ? seamStep / typicalStep : Infinity,
  };
}

globalThis.vgIsotropySeries = async ({ canary }) => {
  const gridW = ${ISOTROPY_GRID_W};
  const gridH = ${ISOTROPY_GRID_H};
  const cw = ${ISOTROPY_CANVAS_W};
  const ch = ${ISOTROPY_CANVAS_H};
  const canvas = makeCanvas(cw, ch);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(cw, ch);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const rig = makeIsotropyRig(gl, { gridW, gridH, canary });

  for (let i = 0; i < ${ISOTROPY_STEPS}; i += 1) rig.step(${ISOTROPY_DT});

  renderer.render({
    density: 1,
    debug: 'normal',
    pieces: [],
    backdrop: (glArg, target) => {
      rig.composite(target);
    },
  });

  const buf = readCanvas(gl, cw, ch);
  const luma = new Array(cw * ch);
  for (let i = 0; i < cw * ch; i += 1) {
    luma[i] = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
  }

  // Row 0 is the canvas's own visual BOTTOM (see readCanvas's comment) — the gravity boost band
  // (MEDIUM_DEFAULTS.gravityBottomBoostStart..1 of frame height) lives at LOW row indices here.
  const boostRows = Math.ceil((1 - MEDIUM_DEFAULTS.gravityBottomBoostStart) * ch);
  const isotropy = vgIsotropyRatio(luma, cw, ch, boostRows, ch);

  // The seam check reads ONLY the far plane's own rendered contribution (see probeFarField's file
  // header) — not the full mixed composite, which also carries the (unrelated) near-plane bicubic
  // content at those same screen columns.
  const farProbe = probeFarField(gl, rig, cw, ch, { blur: canary ? 'box' : 'ring', field: 'vapor' });
  const seam = vgSeamColumnRatio(farProbe.luma, cw, ch, gridW, farProbe.dyeScaleX, MEDIUM_DEFAULTS.depthFarScale, farProbe.farOffsetX);
  return { isotropy, seam };
};
// --- Chamber look: lights are a separate, visible entity -----------------------------------------
//
// Mean luma well inside the light's cone vs well outside it, at the SAME distance band — a ring
// sample (many pixels averaged), not a single point, so per-pixel noise cancels out rather
// than dominating either bucket. lightPosFrac/lightDir arrive in the SAME up-is-positive-y fraction
// space MEDIUM_COMPOSITE_SHADER's lights use; luma is row 0 = the canvas's own visual BOTTOM (see
// readCanvas's comment) — the SAME sense as that fraction space, so no flip is needed here either.
function vgBeamRatio(luma, cw, ch, lightPosFrac, lightDir, coneAngle) {
  const lightPx = [lightPosFrac[0] * cw, lightPosFrac[1] * ch];
  const cosCone = Math.cos(coneAngle);
  // Lamps sit off-canvas: the distance band starts where the canvas does.
  const edge = Math.hypot(Math.max(0, -lightPx[0], lightPx[0] - cw), Math.max(0, -lightPx[1], lightPx[1] - ch));
  const minR = edge + Math.min(cw, ch) * ${BEAM_MIN_RADIUS_FRAC};
  const maxR = edge + Math.min(cw, ch) * ${BEAM_MAX_RADIUS_FRAC};
  let insideSum = 0;
  let insideN = 0;
  let outsideSum = 0;
  let outsideN = 0;
  for (let row = 0; row < ch; row += 1) {
    for (let col = 0; col < cw; col += 1) {
      const dx = col - lightPx[0];
      const dy = row - lightPx[1];
      const dist = Math.hypot(dx, dy);
      if (dist < minR || dist > maxR) continue;
      const cosAngle = (dx * lightDir[0] + dy * lightDir[1]) / dist;
      const v = luma[row * cw + col];
      // Margins on both sides of the cone edge so the soft transition band itself doesn't dilute
      // either bucket — "well inside" and "well outside", not "on either side of the edge".
      if (cosAngle > cosCone + (1 - cosCone) * 0.3) {
        insideSum += v;
        insideN += 1;
      } else if (cosAngle < cosCone - 0.15) {
        outsideSum += v;
        outsideN += 1;
      }
    }
  }
  const insideMean = insideN > 0 ? insideSum / insideN : 0;
  const outsideMean = outsideN > 0 ? outsideSum / outsideN : 0;
  return { insideMean, outsideMean, insideN, outsideN, ratio: outsideMean > 1e-6 ? insideMean / outsideMean : Infinity };
}

globalThis.vgBeamSeries = async ({ lightOn }) => {
  const gridW = ${BEAM_GRID_W};
  const gridH = ${BEAM_GRID_H};
  const cw = ${BEAM_CANVAS_W};
  const ch = ${BEAM_CANVAS_H};
  const canvas = makeCanvas(cw, ch);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(cw, ch);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const medium = createMediumBackdrop();
  const dt = ${BEAM_DT};
  // One light only (a spotlight, MEDIUM_DEFAULTS.lights[1]) — isolates the cone mechanism from the
  // sum of all three shipped lights, the same "zero the other mechanism" isolation the boost/
  // contrast gates already use for their own one variable.
  const baseLight = MEDIUM_DEFAULTS.lights[1];
  const lights = [{ ...baseLight, intensity: lightOn ? baseLight.intensity : 0 }];
  function frame() {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: medium.pass({ gridWidth: gridW, gridHeight: gridH, dt, params: { lights } }),
    });
  }
  for (let i = 0; i < ${BEAM_WARMUP_STEPS}; i += 1) frame();
  const buf = readCanvas(gl, cw, ch);
  medium.destroy();
  const luma = new Array(cw * ch);
  for (let i = 0; i < cw * ch; i += 1) {
    luma[i] = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
  }
  return vgBeamRatio(luma, cw, ch, baseLight.position, baseLight.direction, baseLight.coneAngle);
};

// --- Chamber look: a track is sharp at birth, then broadens, sags and fades ----------------------
//
// One manually-built muon emission (long, straight, thin — the easiest shape to take a clean
// perpendicular cross-section of) stamped through the real emit() path, read back via
// readTrackGrid() (raw density, no compositing/lighting in the way) immediately (birth) and again
// TRACK_LATER_S of simulated time later with no further emissions.
globalThis.vgTrackShapeSeries = async ({ canary }) => {
  const gridW = ${TRACK_GRID_W};
  const gridH = ${TRACK_GRID_H};
  const canvas = makeCanvas(gridW, gridH);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(gridW, gridH);
  const medium = createMediumBackdrop();
  const dt = ${TRACK_DT};
  // The canary removes every mechanism that could broaden or fade a stamp: zero turbulence leaves
  // the backtrace sampling its own exact texel center every frame (no diffusion of its own), and
  // zero decay leaves the total exactly where it was stamped.
  const params = canary ? { decay: 0, turbulence: 0, condensateSettleWiggle: 0 } : {};
  const muon = MEDIUM_TRACK_PRESETS.muon;
  const minDim = Math.min(gridW, gridH);
  const emission = { ...muon, source: [0.5, 0.5], angle: 0, seed: 1, depth: 1, kind: 'muon' };

  function frame(emissions) {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: medium.pass({ gridWidth: gridW, gridHeight: gridH, dt, params, emissions }),
    });
  }
  frame([emission]);
  const birth = medium.readTrackGrid();
  const steps = Math.round(${TRACK_LATER_S} / dt);
  for (let i = 0; i < steps; i += 1) frame([]);
  const later = medium.readTrackGrid();
  medium.destroy();

  // angle=0 (straight along +x from grid-center, see web/medium.ts's emit()) — a vertical scanline
  // at the track's own midpoint column is exactly perpendicular to it. Sigma is a density-weighted
  // standard deviation across that scanline: a robust "width" with no threshold to pick by hand.
  const midCol = Math.min(Math.max(Math.round(gridW / 2 + (muon.lengthFrac * minDim) / 2), 0), gridW - 1);
  function crossSection(grid) {
    let mass = 0;
    let weighted = 0;
    let total = 0;
    for (let r = 0; r < gridH; r += 1) mass += grid.data[r * gridW + midCol];
    for (let r = 0; r < gridH; r += 1) weighted += grid.data[r * gridW + midCol] * r;
    for (let i = 0; i < grid.data.length; i += 1) total += grid.data[i];
    const meanRow = mass > 1e-6 ? weighted / mass : gridH / 2;
    let variance = 0;
    for (let r = 0; r < gridH; r += 1) {
      const v = grid.data[r * gridW + midCol];
      variance += v * (r - meanRow) * (r - meanRow);
    }
    const sigma = mass > 1e-6 ? Math.sqrt(variance / mass) : 0;
    return { sigma, total };
  }
  return { birth: crossSection(birth), later: crossSection(later) };
};

globalThis.vgTrackLayerShapeSeries = async ({ trackLayerAmount }) => {
  const cw = ${TRACK_LAYER_CANVAS_W};
  const ch = ${TRACK_LAYER_CANVAS_H};
  const gridW = ${TRACK_LAYER_GRID_W};
  const gridH = ${TRACK_LAYER_GRID_H};
  const canvas = makeCanvas(cw, ch);
  const renderer = createVireGlassRenderer(canvas);
  renderer.resize(cw, ch);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const medium = createMediumBackdrop();
  const dt = ${TRACK_LAYER_DT};
  const params = { trackLayerAmount };
  const muon = MEDIUM_TRACK_PRESETS.muon;
  const minDim = Math.min(cw, ch);
  const emission = { ...muon, source: [0.5, 0.5], angle: 0, seed: 1, depth: 0.5, kind: 'muon' };

  function frame(emissions) {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: medium.pass({ gridWidth: gridW, gridHeight: gridH, dt, params, emissions }),
    });
  }

  // No-emission warmup so mist/lights settle BEFORE the background reference is captured — the
  // background subtraction below only isolates the track's own contribution if the ambient scene
  // it's subtracted from is itself already representative, not still ramping from a cold start.
  for (let i = 0; i < ${TRACK_LAYER_WARMUP_STEPS}; i += 1) frame([]);
  const background = readCanvas(gl, cw, ch);

  frame([emission]);
  const birth = readCanvas(gl, cw, ch);
  const steps = Math.round(${TRACK_LAYER_LATER_S} / dt);
  for (let i = 0; i < steps; i += 1) frame([]);
  const later = readCanvas(gl, cw, ch);
  medium.destroy();

  // angle=0 (straight along +x from the frame center, see web/track-layer-gl.ts's px conversion) —
  // a vertical scanline at the track's own midpoint column is exactly perpendicular to it. Sigma is
  // a density-weighted standard deviation across that scanline, luma background-subtracted per pixel
  // (see the file header) — a robust "width" with no threshold to pick by hand.
  const midCol = Math.min(Math.max(Math.round(cw / 2 + (muon.lengthFrac * minDim) / 2), 0), cw - 1);
  const boxColStart = Math.max(0, Math.floor(cw / 2 - 20));
  const boxColEnd = Math.min(cw, Math.ceil(cw / 2 + muon.lengthFrac * minDim + 20));
  const boxRowStart = Math.max(0, Math.floor(ch / 2 - 60));
  const boxRowEnd = Math.min(ch, Math.ceil(ch / 2 + 60));

  function luma(buf, idx) {
    const i = idx * 4;
    return 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
  }
  function diffAt(buf, row, col) {
    const idx = row * cw + col;
    return Math.max(0, luma(buf, idx) - luma(background, idx));
  }

  function crossSection(buf) {
    let mass = 0;
    let weighted = 0;
    for (let r = 0; r < ch; r += 1) {
      const d = diffAt(buf, r, midCol);
      mass += d;
      weighted += d * r;
    }
    const meanRow = mass > 1e-6 ? weighted / mass : ch / 2;
    let variance = 0;
    for (let r = 0; r < ch; r += 1) {
      const d = diffAt(buf, r, midCol);
      variance += d * (r - meanRow) * (r - meanRow);
    }
    const sigma = mass > 1e-6 ? Math.sqrt(variance / mass) : 0;
    let total = 0;
    for (let r = boxRowStart; r < boxRowEnd; r += 1) {
      for (let c = boxColStart; c < boxColEnd; c += 1) total += diffAt(buf, r, c);
    }
    return { sigma, total };
  }
  return { birth: crossSection(birth), later: crossSection(later) };
};
`;

function centroidTrend(samples) {
  const first = samples[0].centroidRow;
  const last = samples[samples.length - 1].centroidRow;
  let reversals = 0;
  for (let i = 2; i < samples.length; i += 1) {
    const prevDelta = samples[i - 1].centroidRow - samples[i - 2].centroidRow;
    const delta = samples[i].centroidRow - samples[i - 1].centroidRow;
    if (prevDelta !== 0 && delta !== 0 && Math.sign(prevDelta) !== Math.sign(delta)) reversals += 1;
  }
  return { first, last, drift: last - first, reversals };
}

/** Pearson correlation between two equal-length flattened images — 1 means identical (an echo), 0
 *  means unrelated. Used by the decorrelation gate to tell a genuinely offset far plane from one
 *  that's nearly re-reading the near one. */
function pearsonCorrelation(a, b) {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 1e-9 ? cov / denom : 0;
}

/**
 * The vertical shift (rows, `-maxShift..maxShift`) that best aligns `before` with `after` by
 * cross-correlation — robust to a REPEAT-wrapped field showing more than one aliased copy of a
 * moving feature (see the comment on PARALLAX_MAX_SHIFT), since it matches the WHOLE pattern
 * rather than locating one peak. Both images are `w*h` flattened arrays.
 */
function bestShiftY(before, after, w, h, maxShift) {
  let bestShift = 0;
  let bestScore = -Infinity;
  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    let score = 0;
    for (let r = 0; r < h; r += 1) {
      const shifted = ((r + shift) % h + h) % h;
      for (let c = 0; c < w; c += 1) score += before[r * w + c] * after[shifted * w + c];
    }
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }
  return bestShift;
}

async function main() {
  const bundle = await build({
    stdin: { contents: ENTRY, resolveDir: HERE, loader: 'ts' },
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'silent',
  });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const failed = [];

  // --- 1. Gravity pulls down, and the canary proves this gate would notice if it stopped. -------
  console.log('--- gravity: condensate settles toward the canvas bottom (row 0) ---');
  const correct = await page.evaluate((a) => globalThis.vgGravity(a), { canary: false });
  const correctTrend = centroidTrend(correct);
  console.log(
    `  correct composite: ${correct.map((s) => `step ${s.step} row ${s.centroidRow?.toFixed(1)}`).join(', ')}`,
  );
  console.log(
    `  drift ${correctTrend.drift.toFixed(1)}px toward row 0, ${correctTrend.reversals} reversal(s) of ${correct.length - 2}`,
  );
  const correctOk =
    correctTrend.drift <= -MIN_GRAVITY_DRIFT_PX && correctTrend.reversals <= MAX_GRAVITY_REVERSALS;
  if (!correctOk) {
    failed.push(
      `gravity: condensate did not settle toward the canvas bottom (drift ${correctTrend.drift.toFixed(1)}px, ${correctTrend.reversals} reversals) — an orientation regression in the composite's read of the condensate buffer`,
    );
  }

  console.log('--- canary: the same rig with the composite read flipped must NOT settle downward ---');
  const canary = await page.evaluate((a) => globalThis.vgGravity(a), { canary: true });
  const canaryTrend = centroidTrend(canary);
  console.log(
    `  canary composite: ${canary.map((s) => `step ${s.step} row ${s.centroidRow?.toFixed(1)}`).join(', ')}`,
  );
  console.log(`  drift ${canaryTrend.drift.toFixed(1)}px toward row 0`);
  if (canaryTrend.drift <= -MIN_GRAVITY_DRIFT_PX) {
    failed.push(
      `gravity canary did not fail (drift ${canaryTrend.drift.toFixed(1)}px toward row 0, same as a correct composite) — this gate is not actually sensitive to the composite's read orientation`,
    );
  }

  // --- 2. Water (vapor+condensate) is conserved. -------------------------------------------------
  console.log('--- water: vapor+condensate sum holds steady under active turbulence ---');
  const waterSamples = await page.evaluate(() => globalThis.vgWaterSeries());
  const waterTotals = waterSamples.map((t) => t.vapor + t.condensate);
  const mean = waterTotals.reduce((a, b) => a + b, 0) / waterTotals.length;
  const range = Math.max(...waterTotals) - Math.min(...waterTotals);
  const ratio = mean > 1e-9 ? range / mean : Infinity;
  console.log(`  water sum (${waterTotals.length} samples, ${WATER_SAMPLE_INTERVAL_S}s apart): ${waterTotals.map((v) => v.toFixed(1)).join(' ')}`);
  console.log(`  vapor: ${waterSamples.map((t) => t.vapor.toFixed(1)).join(' ')}`);
  console.log(`  condensate: ${waterSamples.map((t) => t.condensate.toFixed(1)).join(' ')}`);
  console.log(`  mean ${mean.toFixed(2)}, range ${range.toFixed(2)}, range/mean ${(ratio * 100).toFixed(2)}%`);
  if (!(ratio <= MAX_WATER_RANGE_OVER_MEAN)) {
    failed.push(`water: range/mean ${(ratio * 100).toFixed(2)}% exceeds ${(MAX_WATER_RANGE_OVER_MEAN * 100).toFixed(0)}% — water is not conserved`);
  }
  if (waterSamples.every((t) => t.condensate < 1e-6)) {
    failed.push('water: condensate stayed at zero for the whole window — the vapor/condensate exchange is dead, and a sum that never had two phases proves nothing (see the vire monorepo history, 19f26add: this exact false pass happened before)');
  }

  // --- 3. No flicker. -------------------------------------------------------------------------
  console.log('--- flicker: frame-to-frame luma does not flip sign on nearly every frame ---');
  const lumas = await page.evaluate(() => globalThis.vgFlickerSeries());
  const deltas = [];
  for (let i = 1; i < lumas.length; i += 1) deltas.push(lumas[i] - lumas[i - 1]);
  let flips = 0;
  let comparable = 0;
  for (let i = 1; i < deltas.length; i += 1) {
    if (deltas[i] === 0 || deltas[i - 1] === 0) continue;
    comparable += 1;
    if (Math.sign(deltas[i]) !== Math.sign(deltas[i - 1])) flips += 1;
  }
  const flickerRatio = comparable > 0 ? flips / comparable : 0;
  console.log(`  luma (${lumas.length} frames): ${lumas.map((v) => v.toFixed(4)).join(' ')}`);
  console.log(`  sign flips: ${flips} of ${comparable} (${(flickerRatio * 100).toFixed(0)}%)`);
  if (!(flickerRatio <= MAX_FLICKER_RATIO)) {
    failed.push(`flicker: ${flips}/${comparable} (${(flickerRatio * 100).toFixed(0)}%) frame-to-frame sign flips exceeds ${(MAX_FLICKER_RATIO * 100).toFixed(0)}%`);
  }

  // --- 4. A grid resize resamples state; it doesn't reset to a fresh seed. ----------------------
  console.log('--- resize: water and inter-species contrast survive a grid resize ---');
  const resize = await page.evaluate((a) => globalThis.vgResizeSeries(a), { canary: false });
  const resizeWaterChange = Math.abs(resize.after.waterDensity - resize.before.waterDensity) / resize.before.waterDensity;
  const resizeCondensateChange =
    Math.abs(resize.after.condensateDensity - resize.before.condensateDensity) / resize.before.condensateDensity;
  const resizeContrastChange = Math.abs(resize.after.contrast - resize.before.contrast) / resize.before.contrast;
  console.log(
    `  before: water ${resize.before.water.toFixed(1)} density ${resize.before.waterDensity.toFixed(4)} (condensate density ${resize.before.condensateDensity.toFixed(4)}), contrast ${resize.before.contrast.toFixed(4)}`,
  );
  console.log(
    `  after (${RESIZE_POST_S}s later, at the new grid size): water ${resize.after.water.toFixed(1)} density ${resize.after.waterDensity.toFixed(4)} (condensate density ${resize.after.condensateDensity.toFixed(4)}), contrast ${resize.after.contrast.toFixed(4)}`,
  );
  console.log(
    `  relative change: water density ${(resizeWaterChange * 100).toFixed(2)}%, condensate density ${(resizeCondensateChange * 100).toFixed(2)}%, contrast ${(resizeContrastChange * 100).toFixed(2)}%`,
  );
  if (!(resizeWaterChange <= MAX_RESIZE_WATER_RELATIVE_CHANGE)) {
    failed.push(
      `resize: water density changed ${(resizeWaterChange * 100).toFixed(2)}% across the resize, exceeding ${(MAX_RESIZE_WATER_RELATIVE_CHANGE * 100).toFixed(0)}% — a resize is dropping or fabricating water instead of resampling it`,
    );
  }
  if (!(resizeCondensateChange <= MAX_RESIZE_CONDENSATE_RELATIVE_CHANGE)) {
    failed.push(
      `resize: condensate density changed ${(resizeCondensateChange * 100).toFixed(2)}% across the resize, exceeding ${(MAX_RESIZE_CONDENSATE_RELATIVE_CHANGE * 100).toFixed(0)}% — condensate is not surviving the resize`,
    );
  }
  if (!(resizeContrastChange <= MAX_RESIZE_CONTRAST_RELATIVE_CHANGE)) {
    failed.push(
      `resize: inter-species contrast changed ${(resizeContrastChange * 100).toFixed(2)}% across the resize, exceeding ${(MAX_RESIZE_CONTRAST_RELATIVE_CHANGE * 100).toFixed(0)}% — the species balance did not survive the resize`,
    );
  }

  console.log('--- canary: the old destroy-and-reseed-on-resize behavior must fail the condensate check above ---');
  const canaryResize = await page.evaluate((a) => globalThis.vgResizeSeries(a), { canary: true });
  const canaryCondensateChange =
    Math.abs(canaryResize.after.condensateDensity - canaryResize.before.condensateDensity) /
    canaryResize.before.condensateDensity;
  console.log(
    `  before: water density ${canaryResize.before.waterDensity.toFixed(4)} (condensate density ${canaryResize.before.condensateDensity.toFixed(4)}), contrast ${canaryResize.before.contrast.toFixed(4)}`,
  );
  console.log(
    `  after (reseeded at the new size, then ${RESIZE_POST_S}s later): water density ${canaryResize.after.waterDensity.toFixed(4)} (condensate density ${canaryResize.after.condensateDensity.toFixed(4)}), contrast ${canaryResize.after.contrast.toFixed(4)}`,
  );
  console.log(`  relative change: condensate density ${(canaryCondensateChange * 100).toFixed(2)}%`);
  if (!(canaryCondensateChange >= MIN_CANARY_CONDENSATE_RELATIVE_CHANGE)) {
    failed.push(
      `resize canary did not fail (condensate density changed only ${(canaryCondensateChange * 100).toFixed(2)}%, same order as a correct resample) — this gate is not actually sensitive to a reseed-on-resize regression`,
    );
  }

  // --- 5. The field's phase wraps without a jump. -------------------------------------------------
  console.log('--- long run: frame-to-frame change at the phase-wrap seam is no bigger than a typical step ---');
  function seamRatio({ lumas }) {
    const deltas = [];
    for (let i = 1; i < lumas.length; i += 1) deltas.push(Math.abs(lumas[i] - lumas[i - 1]));
    const seamIdx = SEAM_STEPS_EACH_SIDE - 1; // deltas[seamIdx] is the pair straddling the wrap
    const seamDelta = deltas[seamIdx];
    const others = deltas.filter((_, i) => i !== seamIdx).sort((a, b) => a - b);
    const typical = others[Math.floor(others.length / 2)];
    return { seamDelta, typical, ratio: typical > 1e-9 ? seamDelta / typical : Infinity };
  }
  const seamPeriodic = seamRatio(await page.evaluate(() => globalThis.vgSeamSeries({ periodic: true })));
  console.log(
    `  periodic (production) probe: seam delta ${seamPeriodic.seamDelta.toFixed(3)}, typical step ${seamPeriodic.typical.toFixed(3)}, ratio ${seamPeriodic.ratio.toFixed(2)}`,
  );
  if (!(seamPeriodic.ratio <= MAX_SEAM_JUMP_RATIO)) {
    failed.push(
      `long run: the seam delta is ${seamPeriodic.ratio.toFixed(2)}x the typical step, exceeding ${MAX_SEAM_JUMP_RATIO}x — the phase wrap is visible as a jump`,
    );
  }

  console.log('--- canary: a naive wrap (phase wraps, the hash does not) must fail the same check ---');
  const seamNaive = seamRatio(await page.evaluate(() => globalThis.vgSeamSeries({ periodic: false })));
  console.log(
    `  naive probe: seam delta ${seamNaive.seamDelta.toFixed(3)}, typical step ${seamNaive.typical.toFixed(3)}, ratio ${seamNaive.ratio.toFixed(2)}`,
  );
  if (!(seamNaive.ratio >= MIN_CANARY_SEAM_JUMP_RATIO)) {
    failed.push(
      `long run canary did not fail (seam ratio only ${seamNaive.ratio.toFixed(2)}x, same order as the periodic probe) — this gate is not actually sensitive to a non-periodic wrap`,
    );
  }

  // --- 6. Depth: parallax — the far plane moves slower on screen than the near plane. -----------
  console.log('--- parallax: the far plane reads the same field slower than the near plane ---');
  const parallax = await page.evaluate((a) => globalThis.vgParallaxSeries(a), { canary: false });
  const nearShift = Math.abs(bestShiftY(parallax.nearBefore, parallax.nearAfter, parallax.w, parallax.h, PARALLAX_MAX_SHIFT));
  const farShift = Math.abs(bestShiftY(parallax.farBefore, parallax.farAfter, parallax.w, parallax.h, PARALLAX_MAX_SHIFT));
  const parallaxRatio = nearShift > 0 ? farShift / nearShift : Infinity;
  console.log(`  near best-shift ${nearShift}px, far best-shift ${farShift}px, ratio ${parallaxRatio.toFixed(3)}`);
  if (!(parallaxRatio >= MIN_PARALLAX_RATIO && parallaxRatio <= MAX_PARALLAX_RATIO)) {
    failed.push(
      `parallax: far/near shift ratio ${parallaxRatio.toFixed(3)} outside [${MIN_PARALLAX_RATIO}, ${MAX_PARALLAX_RATIO}] — the far plane is not reading as slower than the near one`,
    );
  }

  console.log('--- canary: both planes at the same scale must show no differential motion ---');
  const parallaxCanary = await page.evaluate((a) => globalThis.vgParallaxSeries(a), { canary: true });
  const canaryNearShift = Math.abs(bestShiftY(parallaxCanary.nearBefore, parallaxCanary.nearAfter, parallaxCanary.w, parallaxCanary.h, PARALLAX_MAX_SHIFT));
  const canaryFarShift = Math.abs(bestShiftY(parallaxCanary.farBefore, parallaxCanary.farAfter, parallaxCanary.w, parallaxCanary.h, PARALLAX_MAX_SHIFT));
  const canaryParallaxRatio = canaryNearShift > 0 ? canaryFarShift / canaryNearShift : Infinity;
  console.log(`  near best-shift ${canaryNearShift}px, far best-shift ${canaryFarShift}px, ratio ${canaryParallaxRatio.toFixed(3)}`);
  if (!(canaryParallaxRatio >= MIN_CANARY_PARALLAX_RATIO)) {
    failed.push(
      `parallax canary did not fail (ratio ${canaryParallaxRatio.toFixed(3)}, same order as a real depth difference) — this gate is not actually sensitive to the scale mechanism`,
    );
  }

  // --- 7. Depth: aerial perspective — the far plane's contrast is lower. -------------------------
  console.log('--- aerial perspective: the far plane reads lower-contrast than the near plane ---');
  function stdDev(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }
  const contrast = await page.evaluate((a) => globalThis.vgContrastSeries(a), { canary: false });
  const nearStd = stdDev(contrast.near);
  const farStd = stdDev(contrast.far);
  const contrastReduction = nearStd > 1e-6 ? (nearStd - farStd) / nearStd : 0;
  console.log(`  near std-dev ${nearStd.toFixed(2)}, far std-dev ${farStd.toFixed(2)}, reduction ${(contrastReduction * 100).toFixed(1)}%`);
  if (!(contrastReduction >= MIN_CONTRAST_REDUCTION)) {
    failed.push(
      `aerial perspective: contrast reduction ${(contrastReduction * 100).toFixed(1)}% is below the required ${(MIN_CONTRAST_REDUCTION * 100).toFixed(0)}% — the far plane does not read as lower-contrast`,
    );
  }

  console.log('--- canary: the far plane at blurRadius=0 must not clear the same margin ---');
  const contrastCanary = await page.evaluate((a) => globalThis.vgContrastSeries(a), { canary: true });
  const canaryNearStd = stdDev(contrastCanary.near);
  const canaryFarStd = stdDev(contrastCanary.far);
  const canaryContrastReduction = canaryNearStd > 1e-6 ? (canaryNearStd - canaryFarStd) / canaryNearStd : 0;
  console.log(`  near std-dev ${canaryNearStd.toFixed(2)}, far std-dev ${canaryFarStd.toFixed(2)}, reduction ${(canaryContrastReduction * 100).toFixed(1)}%`);
  if (!(canaryContrastReduction <= MAX_CANARY_CONTRAST_REDUCTION)) {
    failed.push(
      `aerial perspective canary did not fail (reduction ${(canaryContrastReduction * 100).toFixed(1)}%, clears the same margin as the blurred read) — this gate is not actually sensitive to blur`,
    );
  }

  // --- 8. Depth: decorrelation — the far plane doesn't echo the near one, at 128x72. --------------
  console.log('--- decorrelation: the far plane does not echo the near one at 128x72 ---');
  const decorrelation = await page.evaluate((a) => globalThis.vgDecorrelationSeries(a), { canary: false });
  const decorrelationValue = pearsonCorrelation(decorrelation.near, decorrelation.far);
  console.log(`  correlation (near vs. far, production offset) at ${DECORRELATION_GRID_W}x${DECORRELATION_GRID_H}: ${decorrelationValue.toFixed(3)}`);
  if (!(decorrelationValue <= MAX_DECORRELATION)) {
    failed.push(
      `decorrelation: correlation ${decorrelationValue.toFixed(3)} exceeds ${MAX_DECORRELATION} at ${DECORRELATION_GRID_W}x${DECORRELATION_GRID_H} — the far plane is nearly echoing the near one`,
    );
  }

  console.log('--- canary: a tiny effective offset must correlate much higher (an echo) ---');
  const decorrelationCanary = await page.evaluate((a) => globalThis.vgDecorrelationSeries(a), { canary: true });
  const canaryDecorrelationValue = pearsonCorrelation(decorrelationCanary.near, decorrelationCanary.far);
  console.log(`  correlation (near vs. far, 2px effective offset): ${canaryDecorrelationValue.toFixed(3)}`);
  if (!(canaryDecorrelationValue >= MIN_CANARY_DECORRELATION)) {
    failed.push(
      `decorrelation canary did not fail (correlation only ${canaryDecorrelationValue.toFixed(3)}) — this gate is not actually sensitive to an echoing offset`,
    );
  }

  // --- 9. Gravity: the bottom boost is a steady-state compositing property. -----------------------
  console.log('--- gravity (boost): the bottom band reads denser than the top band, at zero simulated steps ---');
  const boost = await page.evaluate((a) => globalThis.vgBoostSeries(a), { canary: false });
  const boostRatio = boost.topLuma > 1e-6 ? boost.bottomLuma / boost.topLuma : Infinity;
  console.log(`  bottom-band luma ${boost.bottomLuma.toFixed(3)}, top-band luma ${boost.topLuma.toFixed(3)}, ratio ${boostRatio.toFixed(3)}`);
  if (!(boostRatio >= MIN_BOOST_RATIO)) {
    failed.push(`gravity (boost): bottom/top luma ratio ${boostRatio.toFixed(3)} is below the required ${MIN_BOOST_RATIO} — the chamber does not read as denser at the bottom`);
  }

  console.log('--- canary: boost=0 must leave the symmetric seeding at (near) exactly 1 ---');
  const boostCanary = await page.evaluate((a) => globalThis.vgBoostSeries(a), { canary: true });
  const canaryBoostRatio = boostCanary.topLuma > 1e-6 ? boostCanary.bottomLuma / boostCanary.topLuma : Infinity;
  console.log(`  bottom-band luma ${boostCanary.bottomLuma.toFixed(3)}, top-band luma ${boostCanary.topLuma.toFixed(3)}, ratio ${canaryBoostRatio.toFixed(3)}`);
  if (!(canaryBoostRatio <= MAX_CANARY_BOOST_RATIO)) {
    failed.push(`gravity (boost) canary did not fail (ratio ${canaryBoostRatio.toFixed(3)}, clears the same margin with boost off) — this gate is not actually sensitive to the boost`);
  }

  // --- 10. Gravity: vapor drift is a motion-direction cue, valid at any (bounded) time. -----------
  //
  // This probe draws DIRECTLY to the default framebuffer (like the parallax/contrast/decorrelation
  // rigs above), not through the real renderer the way the condensate gravity rig and the boost
  // gate do — it never touches contentTexture's own orientation contract, so it has no reason to
  // share their "increasing row = toward row 0 = down" convention. Measured directly: positive
  // vaporDrift (the same sign that settles condensate downward in the real, renderer-based rig)
  // makes THIS probe's row INCREASE, not decrease. The direction is verified here, not assumed.
  console.log('--- gravity (drift): vapor drifts in one consistent direction over a short window ---');
  const drift = await page.evaluate((a) => globalThis.vgVaporDriftSeries(a), { canary: false });
  const driftTrend = centroidTrend(drift);
  console.log(`  samples: ${drift.map((s) => `step ${s.step} row ${s.centroidRow?.toFixed(1)}`).join(', ')}`);
  console.log(`  drift ${driftTrend.drift.toFixed(1)}px, ${driftTrend.reversals} reversal(s) of ${drift.length - 2}`);
  if (!(driftTrend.drift >= MIN_DRIFT_PX && driftTrend.reversals <= MAX_DRIFT_REVERSALS)) {
    failed.push(`gravity (drift): vapor did not show a consistent drift (drift ${driftTrend.drift.toFixed(1)}px, ${driftTrend.reversals} reversals)`);
  }

  console.log('--- canary: drift=0 (turbulence already 0) must show no meaningful trend ---');
  const driftCanary = await page.evaluate((a) => globalThis.vgVaporDriftSeries(a), { canary: true });
  const canaryDriftTrend = centroidTrend(driftCanary);
  console.log(`  samples: ${driftCanary.map((s) => `step ${s.step} row ${s.centroidRow?.toFixed(1)}`).join(', ')}`);
  console.log(`  drift ${canaryDriftTrend.drift.toFixed(1)}px`);
  if (!(Math.abs(canaryDriftTrend.drift) <= MAX_CANARY_DRIFT_PX)) {
    failed.push(`gravity (drift) canary did not fail (drift ${canaryDriftTrend.drift.toFixed(1)}px with no velocity at all) — this gate is not actually sensitive to the drift mechanism`);
  }

  // --- 11. Cost: what the depth composite adds over the pre-depth (single-plane) one. --------------
  console.log('--- cost: the depth composite vs the pre-depth (single-plane) one, at content resolution ---');
  const cost = await page.evaluate(() => globalThis.vgCompositeCost());
  if (cost.gpuMs === null) {
    console.log('  renderer.getLastGpuMs(): null (no EXT_disjoint_timer_query_webgl2 in this headless Chromium) — falling back to CPU wall time');
  } else {
    console.log(`  renderer.getLastGpuMs(): ${cost.gpuMs.toFixed(3)}ms (a single real frame, informational alongside the wall-time comparison below)`);
  }
  // Below this, either measurement rounds to 0.000ms at 3-decimal precision — that is
  // performance.now()'s own clamp resolution, not a real zero, and a ratio of two clamped numbers
  // is noise, not a cost figure (measured across runs: anywhere from 0.4x to 1.0x on identical
  // code). Report the resolution floor instead of a fabricated ratio.
  const COST_RESOLUTION_FLOOR_MS = 0.001;
  if (cost.wallMsBaseline < COST_RESOLUTION_FLOOR_MS || cost.wallMsDepth < COST_RESOLUTION_FLOOR_MS) {
    console.log(
      `  CPU wall time (${COST_FRAMES} frames, gl.finish() each, ${COST_CANVAS_W}x${COST_CANVAS_H}): single-plane ${cost.wallMsBaseline.toFixed(4)}ms/frame, depth ${cost.wallMsDepth.toFixed(4)}ms/frame — both below this environment's ${COST_RESOLUTION_FLOOR_MS}ms timer resolution, no meaningful ratio`,
    );
  } else {
    const costRatio = cost.wallMsDepth / cost.wallMsBaseline;
    console.log(
      `  CPU wall time (${COST_FRAMES} frames, gl.finish() each, ${COST_CANVAS_W}x${COST_CANVAS_H}): single-plane ${cost.wallMsBaseline.toFixed(4)}ms/frame, depth ${cost.wallMsDepth.toFixed(4)}ms/frame, ratio ${costRatio.toFixed(2)}x`,
    );
    if (cost.gpuMs !== null && !(costRatio <= MAX_COST_RATIO_WITH_TIMER)) {
      failed.push(`cost: depth composite is ${costRatio.toFixed(2)}x the single-plane one, exceeding ${MAX_COST_RATIO_WITH_TIMER}x`);
    }
  }

  // --- 12. Isotropy: the composited backdrop reads as gas, not a lattice of straight lines. -------
  //
  console.log(`--- isotropy: gradient energy near the axes (0/90deg) vs near the diagonals (45/135deg), at ${ISOTROPY_CANVAS_W}x${ISOTROPY_CANVAS_H} / ${ISOTROPY_GRID_W}x${ISOTROPY_GRID_H} ---`);
  const isotropyCorrect = await page.evaluate((a) => globalThis.vgIsotropySeries(a), { canary: false });
  console.log(
    `  correct: axis energy ${isotropyCorrect.isotropy.axisEnergy.toExponential(3)}, diagonal energy ${isotropyCorrect.isotropy.diagEnergy.toExponential(3)}, ratio ${isotropyCorrect.isotropy.ratio.toFixed(3)}`,
  );
  console.log(
    `  correct seam (vapor, far plane only): step ${isotropyCorrect.seam.seamStep.toFixed(3)}, typical step ${isotropyCorrect.seam.typicalStep.toFixed(3)}, ratio ${isotropyCorrect.seam.ratio.toFixed(3)} (${isotropyCorrect.seam.seamCols.length} wrap column(s))`,
  );
  if (!(isotropyCorrect.isotropy.ratio <= MAX_ISOTROPY_RATIO)) {
    failed.push(
      `isotropy: axis/diagonal gradient energy is ${isotropyCorrect.isotropy.ratio.toFixed(3)}, exceeding ${MAX_ISOTROPY_RATIO} — the backdrop reads as straight lines along the axes`,
    );
  }
  if (!(isotropyCorrect.seam.ratio <= MAX_SEAM_COLUMN_RATIO)) {
    failed.push(
      `isotropy: far-plane seam step is ${isotropyCorrect.seam.ratio.toFixed(3)}x the typical column step, exceeding ${MAX_SEAM_COLUMN_RATIO}x — the tile boundary is still visible`,
    );
  }

  console.log('--- canary: same frequencies as correct, not periodic (isolates periodicity — see the file header) ---');
  const isotropyCanary = await page.evaluate((a) => globalThis.vgIsotropySeries(a), { canary: true });
  console.log(
    `  canary: axis energy ${isotropyCanary.isotropy.axisEnergy.toExponential(3)}, diagonal energy ${isotropyCanary.isotropy.diagEnergy.toExponential(3)}, ratio ${isotropyCanary.isotropy.ratio.toFixed(3)}`,
  );
  console.log(
    `  canary seam (vapor, far plane only): step ${isotropyCanary.seam.seamStep.toFixed(3)}, typical step ${isotropyCanary.seam.typicalStep.toFixed(3)}, ratio ${isotropyCanary.seam.ratio.toFixed(3)} (${isotropyCanary.seam.seamCols.length} wrap column(s))`,
  );
  if (!(isotropyCanary.isotropy.ratio > MAX_ISOTROPY_RATIO)) {
    failed.push(
      `isotropy canary did not fail (ratio ${isotropyCanary.isotropy.ratio.toFixed(3)}) — this gate is not sensitive to a non-periodic field`,
    );
  }
  if (!(isotropyCanary.seam.ratio >= MIN_CANARY_SEAM_COLUMN_RATIO)) {
    failed.push(
      `isotropy seam canary did not fail (ratio ${isotropyCanary.seam.ratio.toFixed(3)}) — this gate is not actually sensitive to the tile-boundary regression`,
    );
  }

  // --- 13. Chamber look: beams are visible — luminance inside a light's cone vs outside it. -------
  console.log('--- beams: luminance inside a light\'s cone reads brighter than outside it, at the same distance ---');
  const beamCorrect = await page.evaluate((a) => globalThis.vgBeamSeries(a), { lightOn: true });
  console.log(
    `  inside-cone mean ${beamCorrect.insideMean.toFixed(2)} (n=${beamCorrect.insideN}), outside mean ${beamCorrect.outsideMean.toFixed(2)} (n=${beamCorrect.outsideN}), ratio ${beamCorrect.ratio.toFixed(3)}`,
  );
  if (!(beamCorrect.ratio >= MIN_BEAM_RATIO)) {
    failed.push(
      `beams: inside/outside luma ratio ${beamCorrect.ratio.toFixed(3)} is below the required ${MIN_BEAM_RATIO} — the light's cone does not read as a visible beam`,
    );
  }

  console.log('--- canary: the same light at zero intensity must not show a cone-shaped difference ---');
  const beamCanary = await page.evaluate((a) => globalThis.vgBeamSeries(a), { lightOn: false });
  console.log(
    `  inside-cone mean ${beamCanary.insideMean.toFixed(2)}, outside mean ${beamCanary.outsideMean.toFixed(2)}, ratio ${beamCanary.ratio.toFixed(3)}`,
  );
  if (!(beamCanary.ratio <= MAX_CANARY_BEAM_RATIO)) {
    failed.push(
      `beams canary did not fail (ratio ${beamCanary.ratio.toFixed(3)} with the light off) — this gate is not actually sensitive to the light mechanism`,
    );
  }

  // --- 14. Chamber look: a track is sharp at birth, then broadens, sags and fades. ----------------
  console.log('--- track shape: a stamped track broadens and fades over +1.5s -------------------------------');
  const trackCorrect = await page.evaluate((a) => globalThis.vgTrackShapeSeries(a), { canary: false });
  const broadenRatio = trackCorrect.birth.sigma > 1e-6 ? trackCorrect.later.sigma / trackCorrect.birth.sigma : Infinity;
  const fadeRatio = trackCorrect.birth.total > 1e-6 ? trackCorrect.later.total / trackCorrect.birth.total : 1;
  console.log(
    `  birth: sigma ${trackCorrect.birth.sigma.toFixed(3)}, total ${trackCorrect.birth.total.toFixed(2)}`,
  );
  console.log(
    `  +${TRACK_LATER_S}s: sigma ${trackCorrect.later.sigma.toFixed(3)}, total ${trackCorrect.later.total.toFixed(2)}`,
  );
  console.log(`  broaden ratio ${broadenRatio.toFixed(3)}, fade ratio ${fadeRatio.toFixed(3)}`);
  if (!(broadenRatio >= MIN_TRACK_BROADEN_RATIO)) {
    failed.push(
      `track shape: broaden ratio ${broadenRatio.toFixed(3)} is below the required ${MIN_TRACK_BROADEN_RATIO} — a track does not visibly broaden`,
    );
  }
  if (!(fadeRatio <= MAX_TRACK_FADE_RATIO)) {
    failed.push(
      `track shape: fade ratio ${fadeRatio.toFixed(3)} exceeds ${MAX_TRACK_FADE_RATIO} — a track does not visibly fade within ${TRACK_LATER_S}s`,
    );
  }

  console.log('--- canary: zero turbulence and zero decay must show almost no broadening or fading ---');
  const trackCanary = await page.evaluate((a) => globalThis.vgTrackShapeSeries(a), { canary: true });
  const canaryBroadenRatio =
    trackCanary.birth.sigma > 1e-6 ? trackCanary.later.sigma / trackCanary.birth.sigma : 1;
  const canaryFadeRatio = trackCanary.birth.total > 1e-6 ? trackCanary.later.total / trackCanary.birth.total : 1;
  console.log(`  broaden ratio ${canaryBroadenRatio.toFixed(3)}, fade ratio ${canaryFadeRatio.toFixed(3)}`);
  if (!(canaryBroadenRatio <= MAX_CANARY_TRACK_BROADEN_RATIO && canaryFadeRatio >= MIN_CANARY_TRACK_FADE_RATIO)) {
    failed.push(
      `track shape canary did not fail (broaden ${canaryBroadenRatio.toFixed(3)}, fade ${canaryFadeRatio.toFixed(3)}) — this gate is not actually sensitive to turbulence/decay`,
    );
  }

  // --- 15. Chamber look: the crisp screen-space track layer is sharp at birth. --------------------
  console.log('--- track layer: sharp at birth, broadens and dims by +1.4s -----------------------------------');
  const layerCorrect = await page.evaluate((a) => globalThis.vgTrackLayerShapeSeries(a), { trackLayerAmount: 1 });
  const layerBroadenRatio =
    layerCorrect.birth.sigma > 1e-6 ? layerCorrect.later.sigma / layerCorrect.birth.sigma : Infinity;
  const layerFadeRatio = layerCorrect.birth.total > 1e-6 ? layerCorrect.later.total / layerCorrect.birth.total : 1;
  console.log(
    `  birth: sigma ${layerCorrect.birth.sigma.toFixed(2)}px, total ${layerCorrect.birth.total.toFixed(1)}`,
  );
  console.log(
    `  +${TRACK_LAYER_LATER_S}s: sigma ${layerCorrect.later.sigma.toFixed(2)}px, total ${layerCorrect.later.total.toFixed(1)}`,
  );
  console.log(`  broaden ratio ${layerBroadenRatio.toFixed(3)}, fade ratio ${layerFadeRatio.toFixed(3)}`);
  if (!(layerCorrect.birth.sigma <= MAX_TRACK_LAYER_BIRTH_SIGMA_PX)) {
    failed.push(
      `track layer: birth sigma ${layerCorrect.birth.sigma.toFixed(2)}px exceeds ${MAX_TRACK_LAYER_BIRTH_SIGMA_PX}px — the crisp layer is not reading sharp at birth`,
    );
  }
  if (!(layerBroadenRatio >= MIN_TRACK_LAYER_BROADEN_RATIO)) {
    failed.push(
      `track layer: broaden ratio ${layerBroadenRatio.toFixed(3)} is below the required ${MIN_TRACK_LAYER_BROADEN_RATIO} — the layer's own geometry does not visibly broaden with age`,
    );
  }
  if (!(layerFadeRatio <= MAX_TRACK_LAYER_FADE_RATIO)) {
    failed.push(
      `track layer: fade ratio ${layerFadeRatio.toFixed(3)} exceeds ${MAX_TRACK_LAYER_FADE_RATIO} — the layer does not visibly dim with age`,
    );
  }

  console.log('--- canary: trackLayerAmount=0 must NOT read sharp — only the soft grid residue remains ---');
  const layerCanary = await page.evaluate((a) => globalThis.vgTrackLayerShapeSeries(a), { trackLayerAmount: 0 });
  console.log(`  birth: sigma ${layerCanary.birth.sigma.toFixed(2)}px, total ${layerCanary.birth.total.toFixed(1)}`);
  if (layerCanary.birth.sigma <= MAX_TRACK_LAYER_BIRTH_SIGMA_PX) {
    failed.push(
      `track layer canary did not fail (birth sigma ${layerCanary.birth.sigma.toFixed(2)}px with trackLayerAmount=0) — this gate is not actually sensitive to the crisp layer, only to the soft grid residue underneath it`,
    );
  }

  await browser.close();

  if (failed.length) {
    console.error(`check-medium: ${failed.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "check-medium: gravity settles toward the canvas bottom (canary caught), water is conserved, no per-frame flicker, a resize resamples instead of reseeding (canary caught), the phase wrap is seamless (canary caught), the far depth plane reads slower and lower-contrast than the near one (both canaries caught), the far plane decorrelates from the near one at 128x72 (canary caught), the bottom boost is a steady-state property and vapor drift is a valid motion cue (both canaries caught), the depth composite's cost over the pre-depth one is reported, the composited backdrop at the product's own default size reads as isotropic gas, not a lattice of straight lines (canary caught), a light's cone reads as a visible beam (canary caught), a stamped track broadens and fades within +1.5s (canary caught), and the crisp screen-space track layer reads sharp at birth and broadens/dims by +1.4s (canary caught)",
  );
}

await main();

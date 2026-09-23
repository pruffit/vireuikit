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
import {
  depthFarOffsetPx,
  MEDIUM_COMPOSITE_SHADER,
  MEDIUM_CONDENSATE_CORRECT_SHADER,
  MEDIUM_CONDENSATE_FORWARD_SHADER,
  MEDIUM_DEFAULTS,
  MEDIUM_SEED_SHADER,
  MEDIUM_TIME_PERIOD,
  MEDIUM_VAPOR_CORRECT_SHADER,
  MEDIUM_VAPOR_FORWARD_SHADER,
  VG_CURL_NOISE,
  VG_OKLAB_TO_SRGB,
} from '${MEDIUM}';

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  document.body.append(canvas);
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
    // Phase doesn't matter here: u_turbulence is 0 (GRAVITY_TURBULENCE), which zeroes the curl
    // term entirely (see MEDIUM_ADVECT_VELOCITY_SETTLE) — settle is the only velocity left.
    setUniform(gl, loc('u_phase'), 0);
    setUniform(gl, loc('u_curlFreq'), MEDIUM_DEFAULTS.curlFreq);
    setUniform(gl, loc('u_advectSpeed'), MEDIUM_DEFAULTS.advectSpeed);
    setUniform(gl, loc('u_turbulence'), ${GRAVITY_TURBULENCE});
    setUniform(gl, loc('u_settleSpeed'), MEDIUM_DEFAULTS.condensateSettleSpeed);
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

  await browser.close();

  if (failed.length) {
    console.error(`check-medium: ${failed.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "check-medium: gravity settles toward the canvas bottom (canary caught), water is conserved, no per-frame flicker, a resize resamples instead of reseeding (canary caught), the phase wrap is seamless (canary caught), the far depth plane reads slower and lower-contrast than the near one (both canaries caught), the far plane decorrelates from the near one at 128x72 (canary caught), the bottom boost is a steady-state property and vapor drift is a valid motion cue (both canaries caught), and the depth composite's cost over the pre-depth one is reported",
  );
}

await main();

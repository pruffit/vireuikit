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
  MEDIUM_CONDENSATE_CORRECT_SHADER,
  MEDIUM_CONDENSATE_FORWARD_SHADER,
  MEDIUM_DEFAULTS,
  MEDIUM_SEED_SHADER,
  MEDIUM_TIME_PERIOD,
  VG_CURL_NOISE,
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

  await browser.close();

  if (failed.length) {
    console.error(`check-medium: ${failed.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    'check-medium: gravity settles toward the canvas bottom (canary caught), water is conserved, no per-frame flicker, a resize resamples instead of reseeding (canary caught), and the phase wrap is seamless (canary caught)',
  );
}

await main();

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
    setUniform(gl, loc('u_time'), 0);
    setUniform(gl, loc('u_curlFreq'), MEDIUM_DEFAULTS.curlFreq);
    setUniform(gl, loc('u_curlSpeed'), MEDIUM_DEFAULTS.curlSpeed);
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
  let time = 0;
  let step = 0;
  function frame() {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: medium.pass({ gridWidth: w, gridHeight: h, time, dt }),
    });
    time += dt;
    step += 1;
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
  let time = 0;
  function frame() {
    renderer.render({
      density: 1,
      debug: 'normal',
      pieces: [],
      backdrop: medium.pass({ gridWidth: w, gridHeight: h, time, dt }),
    });
    time += dt;
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

  await browser.close();

  if (failed.length) {
    console.error(`check-medium: ${failed.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    'check-medium: gravity settles toward the canvas bottom (canary caught), water is conserved, no per-frame flicker',
  );
}

await main();

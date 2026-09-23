// The medium's runtime layer: ping-pong FBOs for the simulation grid and its GPU passes. Shader
// text and parameters live in the package's model (`../medium`) — this file is WebGL only.
//
// Three independent buffers, not one: vapor (a conserved color reserve), condensate (droplets —
// they grow, settle, and exchange with vapor) and tracks (born from a stamp, fade through decay).
// Vapor and condensate form ONE conserved sum — water; tracks aren't part of it, and their decay
// and stamping haven't been folded into that accounting.
import {
  depthFarOffsetPx,
  MEDIUM_COMPOSITE_SHADER,
  MEDIUM_CONDENSATE_CORRECT_SHADER,
  MEDIUM_CONDENSATE_FORWARD_SHADER,
  MEDIUM_CONDENSATE_REACT_SHADER,
  MEDIUM_DEFAULTS,
  MEDIUM_EMIT_SHADER,
  MEDIUM_RESAMPLE_SHADER,
  MEDIUM_SEED_SHADER,
  MEDIUM_TIME_PERIOD,
  MEDIUM_TRACK_ADVECT_SHADER,
  MEDIUM_VAPOR_CORRECT_SHADER,
  MEDIUM_VAPOR_FORWARD_SHADER,
  MEDIUM_VAPOR_REACT_SHADER,
  srgbToOklab,
  type VireUIKitMediumEmission,
  type VireUIKitMediumParams,
} from '../medium';
import { toGLSL } from 'vireglass';
import {
  bindTextureAt,
  createFramebuffer,
  createProgram,
  createTexture,
  drawFullscreenTriangle,
  locationCache,
  setUniform,
} from 'vireglass/web';

export type MediumRuntime = {
  /** Recreates the grid on the first call (seeding it); on a later call with a different size,
   *  RESAMPLES the old vapor/condensate/track state into the new size instead of reseeding — see
   *  `resizeGrid` below for why. A no-op when the size hasn't changed. */
  ensureGrid(gridWidth: number, gridHeight: number): void;
  /** One transport step for all three buffers (vapor and condensate via MacCormack:
   *  forward/correct/react, see `advect-shader.ts`; tracks via a single backtrace plus decay),
   *  ping-ponging their own FBOs. The field's phase (curl-noise's time axis) is this runtime's own
   *  state, accumulated from `dt` — see `u_phase` below — not derived from a caller-supplied clock. */
  step(dt: number, params?: Partial<VireUIKitMediumParams>): void;
  /**
   * Stamps tracks into the TRACK buffer just refreshed by advection — via additive blending,
   * rather than a separate pass or its own position list. From there the same field carries them
   * and their own decay extinguishes them; there is no lifetime timer here.
   */
  emit(emissions: readonly VireUIKitMediumEmission[]): void;
  /**
   * Composites the current density (vapor + condensate + tracks) into a buffer already bound by
   * the caller (the renderer's `contentFbo`) — this is exactly how the medium acts as the second
   * backdrop path: the result lands in the same `contentTexture` the lens samples, not a separate
   * pass drawn over the glass.
   */
  composite(contentWidth: number, contentHeight: number, params?: Partial<VireUIKitMediumParams>): void;
  /** The raw density sum across every cell — a measurement hook, not part of the frame. Balance
   *  and structure gates read THIS, not a composited pixel: compositing muddies things with Oklab
   *  nonlinearity, and the water (vapor+condensate) sum and contrast need to be measurable on
   *  their own. */
  readTotals(): { vapor: number; condensate: number; track: number } | null;
  /** The raw VAPOR grid, at simulation-grid resolution, `data` as r/g/b triples (three species)
   *  per cell, not a sum. Used by the structure gate (contrast BETWEEN species across the grid). */
  readVaporGrid(): { cols: number; rows: number; data: number[] } | null;
  /** The raw CONDENSATE grid, at simulation-grid resolution, `data` as one density value per
   *  cell (condensate has no color — see `readVaporGrid`'s r/g/b for the contrast). Used by the
   *  gravity gate to find the density-weighted row where the mass sits. */
  readCondensateGrid(): { cols: number; rows: number; data: number[] } | null;
  destroy(): void;
};

type DyeTarget = { texture: WebGLTexture; fbo: WebGLFramebuffer };
type DyePair = readonly [DyeTarget, DyeTarget];

/** RGBA16F keeps decay from banding on its long tail; without `EXT_color_buffer_float` (float
 *  render targets need it) this falls back to RGBA8 — coarser, but works everywhere. */
function pickDyeFormat(gl: WebGL2RenderingContext): { internalFormat: number; type: number } {
  const hasFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  return hasFloat
    ? { internalFormat: gl.RGBA16F, type: gl.HALF_FLOAT }
    : { internalFormat: gl.RGBA8, type: gl.UNSIGNED_BYTE };
}

export function createMediumRuntime(gl: WebGL2RenderingContext, vertexSource: string): MediumRuntime {
  const format = pickDyeFormat(gl);

  const vaporForwardProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_VAPOR_FORWARD_SHADER));
  const vaporCorrectProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_VAPOR_CORRECT_SHADER));
  const vaporReactProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_VAPOR_REACT_SHADER));
  const condensateForwardProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_CONDENSATE_FORWARD_SHADER));
  const condensateCorrectProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_CONDENSATE_CORRECT_SHADER));
  const condensateReactProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_CONDENSATE_REACT_SHADER));
  const trackAdvectProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_TRACK_ADVECT_SHADER));
  const compositeProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_COMPOSITE_SHADER));
  const seedProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_SEED_SHADER));
  const emitProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_EMIT_SHADER));
  const resampleProgram = createProgram(gl, vertexSource, toGLSL(MEDIUM_RESAMPLE_SHADER));

  const vaporForwardLoc = locationCache(gl, vaporForwardProgram);
  const vaporCorrectLoc = locationCache(gl, vaporCorrectProgram);
  const vaporReactLoc = locationCache(gl, vaporReactProgram);
  const condensateForwardLoc = locationCache(gl, condensateForwardProgram);
  const condensateCorrectLoc = locationCache(gl, condensateCorrectProgram);
  const condensateReactLoc = locationCache(gl, condensateReactProgram);
  const trackAdvectLoc = locationCache(gl, trackAdvectProgram);
  const compositeLoc = locationCache(gl, compositeProgram);
  const seedLoc = locationCache(gl, seedProgram);
  const emitLoc = locationCache(gl, emitProgram);
  const resampleLoc = locationCache(gl, resampleProgram);

  let gridW = 0;
  let gridH = 0;
  let vapor: DyePair | null = null;
  let condensate: DyePair | null = null;
  let track: DyePair | null = null;
  // MacCormack scratch buffers for a single frame, not ping-pong: each is fully overwritten by its
  // own pass and read again within the SAME step — no persistent state carried between frames.
  let vaporForward: DyeTarget | null = null;
  let vaporCorrected: DyeTarget | null = null;
  let condensateForward: DyeTarget | null = null;
  let condensateCorrected: DyeTarget | null = null;
  let front = 0;

  function makeTarget(w: number, h: number): DyeTarget {
    const texture = createTexture(gl, {
      width: w,
      height: h,
      internalFormat: format.internalFormat,
      type: format.type,
      // REPEAT: a domain with no border — see TextureOptions.wrap. All buffers carry the same
      // field, so the border needs to behave identically for each of them, or vapor would wrap
      // while condensate or a track at the same coordinate cuts off. The MacCormack limiter also
      // reads neighbors across this same border — it needs REPEAT exactly as much as transport does.
      wrap: gl.REPEAT,
    });
    const fbo = createFramebuffer(gl, texture);
    return { texture, fbo };
  }

  function clearTarget(target: DyeTarget, w: number, h: number): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function destroyPair(pair: DyePair | null): void {
    if (!pair) return;
    for (const t of pair) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.fbo);
    }
  }

  function destroyTarget(target: DyeTarget | null): void {
    if (!target) return;
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.fbo);
  }

  function destroyTargets(): void {
    destroyPair(vapor);
    destroyPair(condensate);
    destroyPair(track);
    destroyTarget(vaporForward);
    destroyTarget(vaporCorrected);
    destroyTarget(condensateForward);
    destroyTarget(condensateCorrected);
    vapor = null;
    condensate = null;
    track = null;
    vaporForward = null;
    vaporCorrected = null;
    condensateForward = null;
    condensateCorrected = null;
  }

  // Three spots at fixed, spread-out grid points — the "initial spots", and the entire water
  // supply: it has no other source (the sum of vapor and condensate is conserved). Condensate and
  // tracks seed empty: only background condensation stamps into condensate on the first step, and
  // only `emit` stamps into tracks.
  function seed(w: number, h: number): void {
    if (!vapor || !condensate || !track) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, vapor[front].fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(seedProgram);
    setUniform(gl, seedLoc('u_resolution'), [w, h]);
    setUniform(gl, seedLoc('u_spot0'), [w * 0.28, h * 0.64]);
    setUniform(gl, seedLoc('u_spot1'), [w * 0.7, h * 0.32]);
    setUniform(gl, seedLoc('u_spot2'), [w * 0.48, h * 0.84]);
    setUniform(gl, seedLoc('u_spotRadius'), Math.max(w, h) * 0.18);
    drawFullscreenTriangle(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    clearTarget(condensate[0], w, h);
    clearTarget(condensate[1], w, h);
    clearTarget(track[0], w, h);
    clearTarget(track[1], w, h);
  }

  /** Bilinear-resamples one buffer into a differently-sized target — see MEDIUM_RESAMPLE_SHADER. */
  function resample(src: DyeTarget, srcW: number, srcH: number, dst: DyeTarget, dstW: number, dstH: number): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dstW, dstH);
    gl.disable(gl.BLEND);
    gl.useProgram(resampleProgram);
    bindTextureAt(gl, 0, src.texture, resampleProgram, 'u_src');
    setUniform(gl, resampleLoc('u_srcSize'), [srcW, srcH]);
    setUniform(gl, resampleLoc('u_resolution'), [dstW, dstH]);
    drawFullscreenTriangle(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // A resize used to destroy every target and reseed from scratch — a phone rotation or a window
  // resize wiped the vapor back to its three initial spots and blinked condensate/tracks out, the
  // flicker the design forbids. Instead: bilinear-resample the OLD front buffers (the only ones
  // that carry real state — see the comment on the MacCormack scratch buffers above) into NEW,
  // differently-sized targets, then delete the old ones. Seeding stays a first-call-only thing.
  function resizeGrid(w: number, h: number): void {
    if (!vapor || !condensate || !track) return; // narrows for TS; callers already checked
    const oldVapor = vapor;
    const oldCondensate = condensate;
    const oldTrack = track;
    const oldW = gridW;
    const oldH = gridH;

    const newVaporFront = makeTarget(w, h);
    const newCondensateFront = makeTarget(w, h);
    const newTrackFront = makeTarget(w, h);
    resample(oldVapor[front], oldW, oldH, newVaporFront, w, h);
    resample(oldCondensate[front], oldW, oldH, newCondensateFront, w, h);
    resample(oldTrack[front], oldW, oldH, newTrackFront, w, h);

    destroyTargets();
    gridW = w;
    gridH = h;
    vapor = [newVaporFront, makeTarget(w, h)];
    condensate = [newCondensateFront, makeTarget(w, h)];
    track = [newTrackFront, makeTarget(w, h)];
    vaporForward = makeTarget(w, h);
    vaporCorrected = makeTarget(w, h);
    condensateForward = makeTarget(w, h);
    condensateCorrected = makeTarget(w, h);
    front = 0;

    // Total water scales with cell count, not just density: a bilinear resample roughly preserves
    // the AVERAGE value per cell, so the SUM over every cell scales with how many cells there now
    // are. Rescaling the EXISTING target (rather than re-measuring the just-resampled buffers)
    // keeps the invariant exact even if the resample itself is slightly lossy at the edges — the
    // periodic renormalization below already self-corrects any residual, and it needs a real
    // target to correct TOWARD rather than one that already baked in this resize's own error.
    // `timeSinceRenorm`/`framesSinceRenorm` are left running: the interval they measure doesn't
    // care about grid size, only about how much correction accumulated frame to frame.
    const areaRatio = (w * h) / (oldW * oldH);
    waterTargetTotal *= areaRatio;
  }

  function ensureGrid(gridWidth: number, gridHeight: number): void {
    const w = Math.max(2, Math.round(gridWidth));
    const h = Math.max(2, Math.round(gridHeight));
    if (vapor && condensate && track && w === gridW && h === gridH) return;

    if (!vapor || !condensate || !track) {
      gridW = w;
      gridH = h;
      vapor = [makeTarget(w, h), makeTarget(w, h)];
      condensate = [makeTarget(w, h), makeTarget(w, h)];
      track = [makeTarget(w, h), makeTarget(w, h)];
      vaporForward = makeTarget(w, h);
      vaporCorrected = makeTarget(w, h);
      condensateForward = makeTarget(w, h);
      condensateCorrected = makeTarget(w, h);
      front = 0;
      seed(w, h);
      // The target water total — right after seeding, before the first step: this is "the entire
      // supply" (see the comment on `seed`), and every later renormalization checks against it.
      // Right after seeding condensate is empty, so the target equals the vapor sum — but it's
      // re-verified every time as vapor+condensate, not just vapor, in case the initial state ever
      // changes.
      waterTargetTotal = readTarget(vapor[front]) + readTarget(condensate[front]);
      waterScale = 1;
      timeSinceRenorm = 0;
      framesSinceRenorm = 0;
      return;
    }

    resizeGrid(w, h);
  }

  /** Shared velocity-field uniforms — one set for both phases' forward/correct passes and for
   *  tracks (condensate adds its own gravity on top — see `u_settleSpeed` where it's declared).
   *  The react passes don't mind them either: the extra `loc()` calls for curl uniforms that don't
   *  exist there just return null, and `setUniform` silently skips them. */
  function bindVelocityUniforms(
    loc: (name: string) => WebGLUniformLocation | null,
    dt: number,
    phase: number,
    p: VireUIKitMediumParams,
  ): void {
    setUniform(gl, loc('u_dyeSize'), [gridW, gridH]);
    setUniform(gl, loc('u_resolution'), [gridW, gridH]);
    setUniform(gl, loc('u_dt'), dt);
    setUniform(gl, loc('u_phase'), phase);
    setUniform(gl, loc('u_curlFreq'), p.curlFreq);
    setUniform(gl, loc('u_advectSpeed'), p.advectSpeed);
    setUniform(gl, loc('u_turbulence'), p.turbulence);
    // Only the vapor forward/correct programs declare u_vaporDrift; elsewhere loc() returns null
    // and setUniform silently skips it, same as the curl uniforms already do for the react passes.
    setUniform(gl, loc('u_vaporDrift'), p.gravityVaporDrift);
  }

  // The field's phase — curl-noise's time axis, accumulated here in float64 rather than derived
  // from an ever-growing caller-supplied clock, and wrapped at MEDIUM_TIME_PERIOD (noise.ts's
  // MEDIUM_TIME_OCTAVES makes that wrap exact, not approximate). Sending a raw, ever-growing
  // `time * curlSpeed` product to the GPU as a float32 uniform eventually loses the bits that
  // place a point within its own lattice cell — after hours of playback the field would visibly
  // jitter in place. Wrapping the ACCUMULATOR keeps its magnitude bounded, and because the rate is
  // baked in incrementally rather than multiplied in fresh every frame, changing `curlSpeed` at
  // runtime changes the slope going forward instead of rescaling everything already accumulated —
  // no jump.
  let phase = 0;

  function wrapPhase(value: number): number {
    const wrapped = value % MEDIUM_TIME_PERIOD;
    return wrapped < 0 ? wrapped + MEDIUM_TIME_PERIOD : wrapped;
  }

  // A semi-Lagrangian gather over a non-uniform velocity has no obligation to conserve the sum by
  // itself, and neither does the vapor<->condensate exchange at non-integer rounding exponents
  // (not a boundary or step-size issue — at zero advection and zero exchange there's no loss at
  // all); rather than change the scheme, once a second the WATER sum (vapor+condensate) is checked
  // against its target and the correction is spread as an EQUAL multiplier over the frames of the
  // next interval (an Nth root — otherwise an N-fold ratio would overshoot the target instead of
  // reaching it).
  const WATER_RENORM_INTERVAL_S = 1;
  let waterTargetTotal = 0;
  let waterScale = 1;
  let timeSinceRenorm = 0;
  let framesSinceRenorm = 0;

  function step(dt: number, params: Partial<VireUIKitMediumParams> = {}): void {
    if (
      !vapor ||
      !condensate ||
      !track ||
      !vaporForward ||
      !vaporCorrected ||
      !condensateForward ||
      !condensateCorrected
    ) {
      return;
    }
    const p = { ...MEDIUM_DEFAULTS, ...params };
    // dt is clamped: a tab returning from the background would otherwise carry advection past the
    // grid's bounds in one jump, sweeping all the smoke to an edge in a single frame.
    const clampedDt = Math.min(Math.max(dt, 0), 1 / 15);
    // Advance and wrap the phase BEFORE using it this frame — see the comment on `phase` above.
    phase = wrapPhase(phase + clampedDt * p.curlSpeed);
    const back = front === 0 ? 1 : 0;
    const gridSize: readonly [number, number] = [gridW, gridH];

    // --- Transport: MacCormack splits each phase into forward/correct, both phases independently
    // (only the react pass below reads the partner, and only on already grid-aligned values). ---

    gl.viewport(0, 0, gridW, gridH);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, vaporForward.fbo);
    gl.useProgram(vaporForwardProgram);
    bindTextureAt(gl, 0, vapor[front].texture, vaporForwardProgram, 'u_dye');
    bindVelocityUniforms(vaporForwardLoc, clampedDt, phase, p);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, condensateForward.fbo);
    gl.useProgram(condensateForwardProgram);
    bindTextureAt(gl, 0, condensate[front].texture, condensateForwardProgram, 'u_dye');
    bindVelocityUniforms(condensateForwardLoc, clampedDt, phase, p);
    setUniform(gl, condensateForwardLoc('u_settleSpeed'), p.condensateSettleSpeed);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, vaporCorrected.fbo);
    gl.useProgram(vaporCorrectProgram);
    bindTextureAt(gl, 0, vapor[front].texture, vaporCorrectProgram, 'u_dye');
    bindTextureAt(gl, 1, vaporForward.texture, vaporCorrectProgram, 'u_forward');
    // bindTextureAt only binds the sampler, not its auto uniform size (the transpiler generates a
    // <name>Size for every `uniform shader`) — the second (cross-) sampler needs its own size set
    // separately, or it silently stays (0,0) and `.eval()` divides the coordinate by zero.
    setUniform(gl, vaporCorrectLoc('u_forwardSize'), gridSize);
    bindVelocityUniforms(vaporCorrectLoc, clampedDt, phase, p);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, condensateCorrected.fbo);
    gl.useProgram(condensateCorrectProgram);
    bindTextureAt(gl, 0, condensate[front].texture, condensateCorrectProgram, 'u_dye');
    bindTextureAt(gl, 1, condensateForward.texture, condensateCorrectProgram, 'u_forward');
    setUniform(gl, condensateCorrectLoc('u_forwardSize'), gridSize);
    bindVelocityUniforms(condensateCorrectLoc, clampedDt, phase, p);
    setUniform(gl, condensateCorrectLoc('u_settleSpeed'), p.condensateSettleSpeed);
    drawFullscreenTriangle(gl);

    // --- Reaction: vapor<->condensate exchange and droplet growth, on the already transported
    // (MacCormack) fields, with the partner read directly at its OWN point xy — both fields are
    // already grid-aligned. ---

    gl.bindFramebuffer(gl.FRAMEBUFFER, vapor[back].fbo);
    gl.useProgram(vaporReactProgram);
    bindTextureAt(gl, 0, vaporCorrected.texture, vaporReactProgram, 'u_transported');
    bindTextureAt(gl, 1, condensateCorrected.texture, vaporReactProgram, 'u_condensateTransported');
    setUniform(gl, vaporReactLoc('u_transportedSize'), gridSize);
    setUniform(gl, vaporReactLoc('u_condensateTransportedSize'), gridSize);
    setUniform(gl, vaporReactLoc('u_resolution'), gridSize);
    setUniform(gl, vaporReactLoc('u_dt'), clampedDt);
    setUniform(gl, vaporReactLoc('u_condensationRate'), p.condensationRate);
    setUniform(gl, vaporReactLoc('u_condensationFloor'), p.condensationFloor);
    setUniform(gl, vaporReactLoc('u_evaporationRate'), p.evaporationRate);
    setUniform(gl, vaporReactLoc('u_totalScale'), waterScale);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, condensate[back].fbo);
    gl.useProgram(condensateReactProgram);
    bindTextureAt(gl, 0, condensateCorrected.texture, condensateReactProgram, 'u_transported');
    bindTextureAt(gl, 1, vaporCorrected.texture, condensateReactProgram, 'u_vaporTransported');
    // Growth reads the neighbors of its OWN cell xy in the ORIGINAL (pre-transport-this-frame)
    // condensate — see the comment in advect-shader.ts on MEDIUM_CONDENSATE_REACT_SHADER — so the
    // third sampler is the old front buffer.
    bindTextureAt(gl, 2, condensate[front].texture, condensateReactProgram, 'u_dye');
    setUniform(gl, condensateReactLoc('u_transportedSize'), gridSize);
    setUniform(gl, condensateReactLoc('u_vaporTransportedSize'), gridSize);
    setUniform(gl, condensateReactLoc('u_dyeSize'), gridSize);
    setUniform(gl, condensateReactLoc('u_resolution'), gridSize);
    setUniform(gl, condensateReactLoc('u_dt'), clampedDt);
    setUniform(gl, condensateReactLoc('u_condensationRate'), p.condensationRate);
    setUniform(gl, condensateReactLoc('u_condensationFloor'), p.condensationFloor);
    setUniform(gl, condensateReactLoc('u_evaporationRate'), p.evaporationRate);
    setUniform(gl, condensateReactLoc('u_spreadRate'), p.condensateSpreadRate);
    setUniform(gl, condensateReactLoc('u_totalScale'), waterScale);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, track[back].fbo);
    gl.useProgram(trackAdvectProgram);
    bindTextureAt(gl, 0, track[front].texture, trackAdvectProgram, 'u_dye');
    bindVelocityUniforms(trackAdvectLoc, clampedDt, phase, p);
    setUniform(gl, trackAdvectLoc('u_decay'), p.decay);
    drawFullscreenTriangle(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    front = back;
    framesSinceRenorm += 1;

    timeSinceRenorm += clampedDt;
    if (waterTargetTotal > 0 && timeSinceRenorm >= WATER_RENORM_INTERVAL_S && framesSinceRenorm > 0) {
      const current = readTarget(vapor[front]) + readTarget(condensate[front]);
      if (current > 1e-6) {
        // The Nth root: applied N times in a row (N frames of the past interval) has to PRODUCE
        // the ratio target/current, not apply that ratio in EACH frame — otherwise one second's
        // correction would fire N times and overshoot the target instead of reaching it.
        const totalRatio = waterTargetTotal / current;
        const perFrame = Math.pow(totalRatio, 1 / framesSinceRenorm);
        waterScale = Math.min(1.05, Math.max(0.95, perFrame));
      }
      timeSinceRenorm = 0;
      framesSinceRenorm = 0;
    }
  }

  // Stamping goes into the TRACK buffer (the one advection just wrote) via additive blending,
  // exactly as track stamping requires: not a separate pass, not its own buffer, not water.
  function emit(emissions: readonly VireUIKitMediumEmission[]): void {
    if (!track || emissions.length === 0) return;
    const minDim = Math.min(gridW, gridH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, track[front].fbo);
    gl.viewport(0, 0, gridW, gridH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(emitProgram);
    // The flip-convention comment above doesn't apply here: the shader never reads its own
    // previous frame (no `.eval()`), so there's nothing to flip — but the transpiler always
    // requires u_resolution regardless (see `targets/glsl.ts`: the entry coordinate goes through
    // it unconditionally).
    setUniform(gl, emitLoc('u_resolution'), [gridW, gridH]);
    for (const e of emissions) {
      const source: [number, number] = [e.source[0] * gridW, e.source[1] * gridH];
      const length = e.lengthFrac * minDim;
      const head: [number, number] = [
        source[0] + Math.cos(e.angle) * length,
        source[1] + Math.sin(e.angle) * length,
      ];
      setUniform(gl, emitLoc('u_source'), source);
      setUniform(gl, emitLoc('u_head'), head);
      setUniform(gl, emitLoc('u_headWidth'), e.headWidthFrac * minDim);
      setUniform(gl, emitLoc('u_tailWidth'), e.tailWidthFrac * minDim);
      setUniform(gl, emitLoc('u_raggedAmp'), e.raggedFrac * minDim);
      setUniform(gl, emitLoc('u_raggedFreq'), e.raggedFreq);
      setUniform(gl, emitLoc('u_settle'), e.settleFrac * minDim);
      setUniform(gl, emitLoc('u_tailDim'), e.tailDim);
      setUniform(gl, emitLoc('u_intensity'), e.intensity);
      setUniform(gl, emitLoc('u_seed'), e.seed);
      setUniform(gl, emitLoc('u_channelMask'), e.channel);
      drawFullscreenTriangle(gl);
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function composite(
    contentWidth: number,
    contentHeight: number,
    params: Partial<VireUIKitMediumParams> = {},
  ): void {
    if (!vapor || !condensate || !track) return;
    const p = { ...MEDIUM_DEFAULTS, ...params };
    gl.viewport(0, 0, contentWidth, contentHeight);
    gl.disable(gl.BLEND);
    gl.useProgram(compositeProgram);
    bindTextureAt(gl, 0, vapor[front].texture, compositeProgram, 'u_vapor');
    bindTextureAt(gl, 1, condensate[front].texture, compositeProgram, 'u_condensate');
    bindTextureAt(gl, 2, track[front].texture, compositeProgram, 'u_track');
    setUniform(gl, compositeLoc('u_vaporSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_condensateSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_trackSize'), [gridW, gridH]);
    setUniform(gl, compositeLoc('u_resolution'), [contentWidth, contentHeight]);
    setUniform(gl, compositeLoc('u_dyeScale'), [gridW / contentWidth, gridH / contentHeight]);
    // The palette's forward direction (sRGB → Oklab) — here, once per frame (frame constants),
    // not in the shader per pixel (see the comment in composite-shader.ts).
    setUniform(gl, compositeLoc('u_lab0'), srgbToOklab(p.channelColors[0]));
    setUniform(gl, compositeLoc('u_lab1'), srgbToOklab(p.channelColors[1]));
    setUniform(gl, compositeLoc('u_lab2'), srgbToOklab(p.channelColors[2]));
    setUniform(gl, compositeLoc('u_labBg'), srgbToOklab(p.baseColor));
    setUniform(gl, compositeLoc('u_labCondensate'), srgbToOklab(p.condensateColor));
    setUniform(gl, compositeLoc('u_baseWeight'), p.baseWeight);
    setUniform(gl, compositeLoc('u_condensateTint'), p.condensateTint);
    setUniform(gl, compositeLoc('u_condensateGain'), p.condensateGain);
    setUniform(gl, compositeLoc('u_farScale'), p.depthFarScale);
    // Resolved against the GRID's own size (baseSrc is already grid-px), not content size — a
    // fixed fraction of a wrapping axis, not a fixed pixel count (see depthFarOffsetPx's own
    // comment for why a fixed grid-px value doesn't survive every grid size).
    setUniform(gl, compositeLoc('u_farOffset'), depthFarOffsetPx(p.depthFarOffsetFrac, gridW, gridH));
    setUniform(gl, compositeLoc('u_farBlurRadius'), p.depthFarBlurRadius);
    setUniform(gl, compositeLoc('u_farWeight'), p.depthFarWeight);
    setUniform(gl, compositeLoc('u_gravityBoost'), p.gravityBottomBoost);
    setUniform(gl, compositeLoc('u_gravityBoostStart'), p.gravityBottomBoostStart);
    drawFullscreenTriangle(gl);
  }

  function readTarget(target: DyeTarget): number {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    let sum = 0;
    if (format.type === gl.HALF_FLOAT) {
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

  function readTotals(): { vapor: number; condensate: number; track: number } | null {
    if (!vapor || !condensate || !track) return null;
    return {
      vapor: readTarget(vapor[front]),
      condensate: readTarget(condensate[front]),
      track: readTarget(track[front]),
    };
  }

  // Three numbers per cell (r/g/b of the three vapor species), not a sum: the structure gate
  // (medium-structure-gate.mjs) measures contrast BETWEEN species — a summed density would lose it.
  function readVaporGrid(): { cols: number; rows: number; data: number[] } | null {
    if (!vapor) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, vapor[front].fbo);
    const cells = gridW * gridH;
    const data = new Array(cells * 3);
    if (format.type === gl.HALF_FLOAT) {
      const buf = new Float32Array(cells * 4);
      gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.FLOAT, buf);
      for (let i = 0; i < cells; i += 1) {
        data[i * 3] = buf[i * 4];
        data[i * 3 + 1] = buf[i * 4 + 1];
        data[i * 3 + 2] = buf[i * 4 + 2];
      }
    } else {
      const buf = new Uint8Array(cells * 4);
      gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let i = 0; i < cells; i += 1) {
        data[i * 3] = buf[i * 4] / 255;
        data[i * 3 + 1] = buf[i * 4 + 1] / 255;
        data[i * 3 + 2] = buf[i * 4 + 2] / 255;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { cols: gridW, rows: gridH, data };
  }

  // One number per cell, not three: condensate has no color of its own (density lives in .r,
  // g/b unused — see MEDIUM_CONDENSATE_REACT_SHADER). A gravity gate reads THIS, row-weighting the
  // density to find where the mass sits, without decoding an RGB triple that's two-thirds padding.
  function readCondensateGrid(): { cols: number; rows: number; data: number[] } | null {
    if (!condensate) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, condensate[front].fbo);
    const cells = gridW * gridH;
    const data = new Array(cells);
    if (format.type === gl.HALF_FLOAT) {
      const buf = new Float32Array(cells * 4);
      gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.FLOAT, buf);
      for (let i = 0; i < cells; i += 1) data[i] = buf[i * 4];
    } else {
      const buf = new Uint8Array(cells * 4);
      gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let i = 0; i < cells; i += 1) data[i] = buf[i * 4] / 255;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { cols: gridW, rows: gridH, data };
  }

  function destroy(): void {
    destroyTargets();
    gl.deleteProgram(vaporForwardProgram);
    gl.deleteProgram(vaporCorrectProgram);
    gl.deleteProgram(vaporReactProgram);
    gl.deleteProgram(condensateForwardProgram);
    gl.deleteProgram(condensateCorrectProgram);
    gl.deleteProgram(condensateReactProgram);
    gl.deleteProgram(trackAdvectProgram);
    gl.deleteProgram(compositeProgram);
    gl.deleteProgram(seedProgram);
    gl.deleteProgram(emitProgram);
    gl.deleteProgram(resampleProgram);
  }

  return { ensureGrid, step, emit, composite, readTotals, readVaporGrid, readCondensateGrid, destroy };
}

import { VG_CURL_NOISE } from './noise';

// MacCormack instead of plain semi-Lagrangian transport: a single backtrace sample is heavily
// diffusive on a coarse grid — over roughly 15-35s turbulence stirs the vapor species into a flat
// background, and all the structure the grid exists for disappears. This scheme splits the
// transport of EACH field (vapor, condensate) into three passes instead of one:
//   forward  — the same backtrace sample the old single-pass scheme used (`MEDIUM_*_FORWARD_SHADER`);
//   correct  — a reverse backtrace of the already-transported field, a correction for the
//              difference against the original, and a limiter (clamped to the source cell's
//              neighbors) — without the limiter the scheme produces overshoots that weren't in the
//              field, which read as flicker (`MEDIUM_*_CORRECT_SHADER`);
//   react    — the phase exchange (condensation/evaporation/growth), applied to the already
//              corrected transport rather than the raw backtrace (`MEDIUM_*_REACT_SHADER`).
// The vapor<->condensate exchange used to read its partner AT ITS OWN transported point; splitting
// the passes removes the cause outright: both phases transport on SEPARATE fields with no
// cross-reads, and the exchange happens AFTER, on values already transported and grid-aligned at
// the same point xy — so "how much vapor was lost" and "how much condensate was gained" agree by
// construction.
const MEDIUM_ADVECT_UNIFORMS = `
uniform shader u_dye;
uniform float  u_dt;
uniform float  u_time;
uniform float  u_curlFreq;
uniform float  u_curlSpeed;
uniform float  u_advectSpeed;
uniform float  u_turbulence;

${VG_CURL_NOISE}
`;

// Reading our own previous frame, which sits in the texture bottom-to-top: xy runs top-to-bottom,
// and `.eval()` passes the coordinate straight through as a texture coordinate. Without this flip,
// every step would turn the field upside down, and the two states would alternate frame to frame —
// flicker across half the refresh rate. The rule is the same for ANY read of a smoke texture via
// `.eval()` in this file: composite-shader.ts reads these same buffers for display and has to flip
// the same way.
const MEDIUM_ADVECT_VELOCITY = `
  float2 vel = vgCurlVelocity(xy * u_curlFreq, u_time * u_curlSpeed) * u_advectSpeed * u_turbulence;
`;

// Gravity touches only the condensate — an addition on top of the shared field rather than a
// separate calculation: droplets are carried by the same wind as vapor, plus a downward drift.
const MEDIUM_ADVECT_VELOCITY_SETTLE = `
${MEDIUM_ADVECT_VELOCITY}
  vel.y += u_settleSpeed;
`;

// The forward MacCormack half-step — ONE backtrace sample, bit-for-bit what the whole scheme used
// to do on its own. The result goes to a temporary buffer rather than out; the `correct` pass will
// read it again to estimate, via a reverse step, how much this single sample smeared.
export const MEDIUM_VAPOR_FORWARD_SHADER = `
${MEDIUM_ADVECT_UNIFORMS}

half4 main(float2 xy) {
${MEDIUM_ADVECT_VELOCITY}
  float2 src = xy - vel * u_dt;
  return u_dye.eval(float2(src.x, u_dyeSize.y - src.y));
}
`;

export const MEDIUM_CONDENSATE_FORWARD_SHADER = `
${MEDIUM_ADVECT_UNIFORMS}
uniform float u_settleSpeed;

half4 main(float2 xy) {
${MEDIUM_ADVECT_VELOCITY_SETTLE}
  float2 src = xy - vel * u_dt;
  return u_dye.eval(float2(src.x, u_dyeSize.y - src.y));
}
`;

// Reverse half-step + correction + limiter (Selle et al. 2007). The macro expects `vel` already
// computed (the calling shader sets it to either the forward or the settling version) and two
// samplers: `u_dye` — the field BEFORE this frame's transport, `u_forward` — the forward pass's
// result for the same field.
//
// Correction: corrected = forward + (field_before - forward_backward)/2 — the standard MacCormack
// formula, roughly halving one backtrace's numerical diffusion in order of accuracy.
//
// The limiter is mandatory: without it the correction isn't LOCALLY conservative and can push a
// value above every one of the source cell's neighbors — a new extremum that wasn't in the field.
// On a frame-by-frame sweep that reads as flicker. The clamp is to the range of the four texels
// neighboring the ORIGINAL field around the point the forward pass came from (not bilinearly
// blended — exactly the texel, `.eval()` at its precise center, the same technique used for
// droplet growth in the react shaders below).
const MEDIUM_MACCORMACK_CORRECT = `
  float2 srcForward = xy - vel * u_dt;
  float2 srcReverse = xy + vel * u_dt;
  half4 forwardSelf = u_forward.eval(float2(xy.x, u_forwardSize.y - xy.y));
  half4 forwardReverse = u_forward.eval(float2(srcReverse.x, u_forwardSize.y - srcReverse.y));
  half4 prevSelf = u_dye.eval(float2(xy.x, u_dyeSize.y - xy.y));
  half4 corrected = forwardSelf + half4(0.5) * (prevSelf - forwardReverse);

  float2 src = float2(srcForward.x, u_dyeSize.y - srcForward.y);
  float2 base = floor(src - 0.5);
  half4 c00 = u_dye.eval(base + float2(0.5, 0.5));
  half4 c10 = u_dye.eval(base + float2(1.5, 0.5));
  half4 c01 = u_dye.eval(base + float2(0.5, 1.5));
  half4 c11 = u_dye.eval(base + float2(1.5, 1.5));
  half4 lo = min(min(c00, c10), min(c01, c11));
  half4 hi = max(max(c00, c10), max(c01, c11));
  half4 limited = clamp(corrected, lo, hi);
`;

export const MEDIUM_VAPOR_CORRECT_SHADER = `
${MEDIUM_ADVECT_UNIFORMS}
uniform shader u_forward;

half4 main(float2 xy) {
${MEDIUM_ADVECT_VELOCITY}
${MEDIUM_MACCORMACK_CORRECT}
  return limited;
}
`;

export const MEDIUM_CONDENSATE_CORRECT_SHADER = `
${MEDIUM_ADVECT_UNIFORMS}
uniform float u_settleSpeed;
uniform shader u_forward;

half4 main(float2 xy) {
${MEDIUM_ADVECT_VELOCITY_SETTLE}
${MEDIUM_MACCORMACK_CORRECT}
  return limited;
}
`;

// Water is a conserved volume: the sum of vapor and condensate has no source and no sink, only
// transport and a transition between phases. `u_totalScale` is not water physics but a method
// correction (see `web/medium.ts`): transport alone doesn't hold the sum exactly (residual
// numerical diffusion/dispersion), so the runtime checks the total water (vapor+condensate) once a
// second against the target and folds a correction into both buffers — the same one for each.
//
// The reaction operates on the already CORRECTED (MacCormack + limiter) transport of both phases,
// not the raw backtrace: `u_transported`/`u_condensateTransported` are the correct pass's output,
// grid-aligned at the same point xy, so the exchange reads its partner with no backtrace of its
// own and no desync (see the comment at the top of this file).
//
// Vapor carries color (three channels r/g/b, as before).
export const MEDIUM_VAPOR_REACT_SHADER = `
uniform shader u_transported;
uniform shader u_condensateTransported;
uniform float  u_dt;
uniform float  u_condensationRate;
uniform float  u_condensationFloor;
uniform float  u_evaporationRate;
uniform float  u_totalScale;

half4 main(float2 xy) {
  float3 prevVapor = float3(u_transported.eval(float2(xy.x, u_transportedSize.y - xy.y)).rgb);
  float condensateAtXy = float(u_condensateTransported.eval(float2(xy.x, u_condensateTransportedSize.y - xy.y)).r);
  float vaporTotal = prevVapor.r + prevVapor.g + prevVapor.b;

  // Only the EXCESS of vapor above the background floor condenses, not any nonzero density —
  // otherwise condensate would exactly retrace the vapor spot's shape (the same outline, or
  // softer from blur), leaving the two phases nowhere to visually diverge: vapor is already soft,
  // and condensate needs to read brighter and sharper than it. The floor concentrates condensate
  // in dense turbulence cores, leaving the sparse vapor around it uncondensed — that's where the
  // contrast comes from.
  float excess = max(0.0, vaporTotal - u_condensationFloor);
  float condensedAmount = excess * (1.0 - exp(-u_condensationRate * u_dt));
  float lossFraction = vaporTotal > 1e-6 ? condensedAmount / vaporTotal : 0.0;
  float3 afterLoss = prevVapor * (1.0 - lossFraction);

  float condKeep = exp(-u_evaporationRate * u_dt);
  float returned = condensateAtXy * (1.0 - condKeep);

  // Evaporated water is distributed by the CURRENT vapor proportion — the condensation/
  // evaporation cycle doesn't shift the hue, water only oscillates between phases (color belongs
  // to vapor). NOTE for future edits: this file must never spell out the GLSL exit keyword
  // followed by a space anywhere in a comment. vireglass's transpiler (convertReturns, in
  // targets/glsl.ts) finds that keyword by regex over the WHOLE main-body text, comments
  // included, and rewrites everything up to the next semicolon into an early exit — spanning
  // newlines, since its expression pattern excludes only the semicolon itself. An earlier
  // wording here started a sentence with that exact keyword and a space, and got spliced into a
  // bare exit right after the next semicolon (sumAfterLoss's declaration), silently discarding
  // every line below it. That dropped vapor to a no-op forever: the front buffer stayed pinned at
  // its seeded value and the phase exchange never ran. check:medium's water-conservation check is
  // what caught it.
  float sumAfterLoss = afterLoss.r + afterLoss.g + afterLoss.b;
  float3 hueShare = sumAfterLoss > 1e-6 ? afterLoss / sumAfterLoss : float3(1.0 / 3.0);
  float3 vapor = (afterLoss + hueShare * returned) * u_totalScale;
  return half4(half3(vapor), half(1.0));
}
`;

// Condensate is droplets: a scalar (density lives in .r, g/b unused — it has no color of its own,
// composite-shader.ts tints it with the local vapor hue). Two processes on top of transport:
// exchange with vapor (mirrors the exchange in MEDIUM_VAPOR_REACT_SHADER, the same
// excess/condensedAmount from the same transported vaporTotal) and growth (blending with grid
// neighbors every frame with no age counter: whatever survived more steps ends up more blended
// with its neighbors on its own). Settling isn't here — it's a velocity addition in
// *_FORWARD_SHADER/*_CORRECT_SHADER.
export const MEDIUM_CONDENSATE_REACT_SHADER = `
uniform shader u_transported;
uniform shader u_vaporTransported;
uniform shader u_dye;
uniform float  u_dt;
uniform float  u_condensationRate;
uniform float  u_condensationFloor;
uniform float  u_evaporationRate;
uniform float  u_spreadRate;
uniform float  u_totalScale;

half4 main(float2 xy) {
  float prevCondensate = float(u_transported.eval(float2(xy.x, u_transportedSize.y - xy.y)).r);
  float3 vaporAtXy = float3(u_vaporTransported.eval(float2(xy.x, u_vaporTransportedSize.y - xy.y)).rgb);
  float vaporTotal = vaporAtXy.r + vaporAtXy.g + vaporAtXy.b;

  float excess = max(0.0, vaporTotal - u_condensationFloor);
  float condensed = excess * (1.0 - exp(-u_condensationRate * u_dt));
  float condKeep = exp(-u_evaporationRate * u_dt);
  float afterReaction = prevCondensate * condKeep + condensed;

  // Growth is an Euler step separate from transport: the neighbors are sampled at THIS cell's own
  // xy in the ORIGINAL (pre-transport-this-frame) field u_dye, not the already
  // transported/corrected value. On a non-uniform flow, warping compresses the domain in some
  // places and stretches it in others, and blurring at a warped point stacks those distortions —
  // the error accumulates frame over frame (measured: condensate steadily gained about 5% extra
  // water alongside its own mass growth). Right on the grid, with no warp, the same blur is an
  // honest averaging kernel that conserves the sum on a periodic domain.
  float2 selfSrc = float2(xy.x, u_dyeSize.y - xy.y);
  float n0 = float(u_dye.eval(float2(selfSrc.x + 1.0, selfSrc.y)).r);
  float n1 = float(u_dye.eval(float2(selfSrc.x - 1.0, selfSrc.y)).r);
  float n2 = float(u_dye.eval(float2(selfSrc.x, selfSrc.y - 1.0)).r);
  float n3 = float(u_dye.eval(float2(selfSrc.x, selfSrc.y + 1.0)).r);
  float neighborAvg = (n0 + n1 + n2 + n3) * 0.25;
  float spreadWeight = 1.0 - exp(-u_spreadRate * u_dt);
  float grown = mix(afterReaction, neighborAvg, spreadWeight) * u_totalScale;

  return half4(half3(grown, 0.0, 0.0), half(1.0));
}
`;

// Tracks are not this layer's water: an event stamps a burst (`emit-shader.ts`), and it fades on
// its own. Decay is a property of THIS layer, so it lives here rather than in the vapor/condensate
// passes. Track transport stays a single backtrace: it doesn't need MacCormack — tracks aren't
// conserved, they live for seconds and their own decay extinguishes them before numerical
// diffusion becomes noticeable.
export const MEDIUM_TRACK_ADVECT_SHADER = `
${MEDIUM_ADVECT_UNIFORMS}
uniform float u_decay;

half4 main(float2 xy) {
${MEDIUM_ADVECT_VELOCITY}
  float2 back = xy - vel * u_dt;
  half4 prev = u_dye.eval(float2(back.x, u_dyeSize.y - back.y));
  float3 decayed = float3(prev.rgb) * exp(-u_decay * u_dt);
  return half4(half3(decayed), half(1.0));
}
`;

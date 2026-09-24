import { VG_OKLAB_TO_SRGB } from './oklab';

// Composites vapor, condensate and track density into color — DIRECTLY into the buffer the lens
// samples: this is not a separate pass drawn over the glass, it fills the same contentTexture an
// ordinary 2D scene would, just from the GPU side.
//
// The mix happens in Oklab: two saturated channels averaged in raw RGB collapse into muddy gray;
// in Oklab, lightness and chroma don't bleed into each other, and the sum stays vivid. The palette
// arrives already in Oklab (`u_lab0/1/2`, `u_labBg`, `u_labCondensate`) — the forward direction
// (sRGB → Oklab) is computed once per frame by `srgbToOklab` in `web/medium.ts`, not here per pixel.
//
// `u_dyeScale` converts a frame coordinate into SIMULATION-GRID pixels — deliberately coarser than
// the frame — and only here, once, does the resolution become what the eye actually sees again,
// through `.eval()`'s bilinear sample. NO extra Y flip here, unlike the grid-to-grid reads in
// advect-shader.ts: those flip because they read a buffer through `.eval()` while still inside the
// same top-down "xy" frame the buffer was written in. This is the one read that leaves that frame
// for the screen's own — `xy` here already is screen space (this shader's entry point is
// transpiled exactly like the lens/surface shaders), so the coordinate handed to `u_vapor` etc.
// only needs the grid/frame resolution scale, not another flip. Measured with a headless render:
// adding the extra flip (as a very early version of this file did) made settled condensate drift
// toward the TOP of the screen instead of the bottom.
//
// Three buffers, not one: vapor is conserved, condensate transitions from vapor and back
// (`MEDIUM_VAPOR_REACT_SHADER`/`MEDIUM_CONDENSATE_REACT_SHADER`, see `advect-shader.ts`), tracks
// fade out (`MEDIUM_TRACK_ADVECT_SHADER`) — a channel's density for the mix is the sum of vapor and
// tracks, while condensate mixes separately (it carries its own, near-white, only lightly tinted
// paint).
//
// DEPTH: a far plane is not a second simulation — it is the SAME vapor/condensate buffers, read a
// second time at a different scale and offset (see MEDIUM_DEFAULTS.depthFarScale/depthFarOffsetFrac
// — u_farOffset itself arrives already resolved to grid-px, see depthFarOffsetPx in params.ts).
// Reading the identical evolving field through two different "lenses" gives parallax and finer
// far-plane structure from one number (`depthFarScale`) with no extra grid to step, and a cheap
// 4-tap blur gives the far plane aerial perspective's blur AND lower contrast from one mechanism
// (a spatial average cannot raise local variance). Tracks are NOT re-sampled per plane — a track's
// own depth is baked into its stamped width/intensity at emission time (`dynamics.ts`), not into a
// second read here.
//
// The far plane folds into the SAME weighted-average-in-Oklab this file already used for species:
// its weights simply add to the near plane's before the one division, exactly the technique species
// already use to combine three channels without the sum ever pulling toward gray.
// Cubic B-spline reconstruction from 4 bilinear taps (Sigg & Hadwiger 2005) — the standard trick
// that gets a smooth surface out of the grid's own bilinear filtering instead of 16 point samples.
// Needed because check-medium.mjs's isotropy gate measures it directly: at the product's default
// coarse grid (74x37 at 1920x952), plain bilinear plus this shader's own nonlinear Oklab mix shows
// the grid's cells as squares with staircase edges (see the gate's report for the measured ratio).
// `vgCubicWeights` computes the four B-spline basis weights at fractional position `v`; each of
// the two `vgBicubicN` functions below is the SAME sampling formula against a DIFFERENT texture —
// the transpiler's `.eval()` rewrite (vireglass's targets/glsl.ts) matches call sites by the
// literal declared uniform name, not by a function parameter, so a texture can't be passed in as an
// argument; the formula is instead generated once per texture name by `vgBicubicSampler` in JS,
// the same way noise.ts's octave text is generated from MEDIUM_TIME_OCTAVES rather than retyped.
// Applied to vapor and condensate (the two fields that make up the visible "gas" body); NOT to the
// far plane, which is already blurred (a spatial average already hides blockiness on its own), or
// to tracks (thin, high-contrast, already-sharp stamps — bicubic softening would blur the "fresh
// ionization" look the head/tail intensity split exists for, at a cost with no matching benefit).
const VG_CUBIC_WEIGHTS = `
float4 vgCubicWeights(float v) {
  float4 n = float4(1.0, 2.0, 3.0, 4.0) - v;
  float4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return float4(x, y, z, w) * (1.0 / 6.0);
}
`;

function vgBicubicSampler(fnName: string, textureName: string): string {
  return `
half4 ${fnName}(float2 px) {
  float2 shifted = px - 0.5;
  float2 fxy = fract(shifted);
  float2 base = shifted - fxy;
  float4 xw = vgCubicWeights(fxy.x);
  float4 yw = vgCubicWeights(fxy.y);
  float2 sx = float2(xw.x + xw.z, xw.y + xw.w);
  float2 sy = float2(yw.x + yw.z, yw.y + yw.w);
  float2 offsetX = float2(base.x - 0.5 + xw.y / sx.x, base.x + 1.5 + xw.w / sx.y);
  float2 offsetY = float2(base.y - 0.5 + yw.y / sy.x, base.y + 1.5 + yw.w / sy.y);
  half4 s00 = ${textureName}.eval(float2(offsetX.x, offsetY.x));
  half4 s10 = ${textureName}.eval(float2(offsetX.y, offsetY.x));
  half4 s01 = ${textureName}.eval(float2(offsetX.x, offsetY.y));
  half4 s11 = ${textureName}.eval(float2(offsetX.y, offsetY.y));
  float wx = sx.x / (sx.x + sx.y);
  float wy = sy.x / (sy.x + sy.y);
  return mix(mix(s11, s01, wx), mix(s10, s00, wx), wy);
}
`;
}

export const MEDIUM_COMPOSITE_SHADER = `
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

${VG_OKLAB_TO_SRGB}
${VG_CUBIC_WEIGHTS}
${vgBicubicSampler('vgBicubicVapor', 'u_vapor')}
${vgBicubicSampler('vgBicubicCondensate', 'u_condensate')}

half4 main(float2 xy) {
  float2 baseSrc = xy * u_dyeScale;

  // Near plane — the calibrated look lives here. Bicubic (see the file header) on vapor and
  // condensate; track stays a plain bilinear read.
  half4 vapor = vgBicubicVapor(baseSrc);
  half4 condensate = vgBicubicCondensate(baseSrc);
  half4 track = u_track.eval(baseSrc);

  // Far plane — the identical field, scaled and offset (see the file header). An 8-tap ring, not
  // the near plane's ±x/±y box: axis-aligned taps read the SAME column/row on both sides of any
  // residual axis-aligned structure (a seam, a resize artifact), which is exactly how a straight
  // line gets doubled into four parallel copies instead of softened away — measured directly via
  // check-medium.mjs's isotropy gate (see its report). The ring is rotated a half-step (22.5°) off
  // the axes so no tap direction ever coincides with a grid row or column. Radius stays in the same
  // far-plane texture-space unit as before (u_farBlurRadius, grid-px) — only the tap PATTERN
  // changed, not what it measures in.
  float2 farSrc = baseSrc * u_farScale + u_farOffset;
  float2 ring0 = float2( 0.9238795,  0.3826834) * u_farBlurRadius;
  float2 ring1 = float2( 0.3826834,  0.9238795) * u_farBlurRadius;
  float2 ring2 = float2(-0.3826834,  0.9238795) * u_farBlurRadius;
  float2 ring3 = float2(-0.9238795,  0.3826834) * u_farBlurRadius;
  float2 ring4 = float2(-0.9238795, -0.3826834) * u_farBlurRadius;
  float2 ring5 = float2(-0.3826834, -0.9238795) * u_farBlurRadius;
  float2 ring6 = float2( 0.3826834, -0.9238795) * u_farBlurRadius;
  float2 ring7 = float2( 0.9238795, -0.3826834) * u_farBlurRadius;
  half4 vaporFar = (u_vapor.eval(farSrc + ring0) + u_vapor.eval(farSrc + ring1) +
                     u_vapor.eval(farSrc + ring2) + u_vapor.eval(farSrc + ring3) +
                     u_vapor.eval(farSrc + ring4) + u_vapor.eval(farSrc + ring5) +
                     u_vapor.eval(farSrc + ring6) + u_vapor.eval(farSrc + ring7)) * half4(0.125);
  half4 condensateFar = (u_condensate.eval(farSrc + ring0) + u_condensate.eval(farSrc + ring1) +
                          u_condensate.eval(farSrc + ring2) + u_condensate.eval(farSrc + ring3) +
                          u_condensate.eval(farSrc + ring4) + u_condensate.eval(farSrc + ring5) +
                          u_condensate.eval(farSrc + ring6) + u_condensate.eval(farSrc + ring7)) * half4(0.125);

  // Gravity's "denser layer at the bottom of the chamber" — a compositing-only boost (see
  // MEDIUM_DEFAULTS.gravityBottomBoost): it scales how density already in the conserved buffers is
  // DISPLAYED, never the buffers themselves, so it can't threaten water conservation. Shared by
  // both planes: the chamber's floor is denser everywhere along its depth, not just up close.
  //
  // Verified with a headless render, not assumed: ramping this with xy.y directly lit up the TOP
  // of the frame, not the bottom (contentTexture's own orientation contract flips y once more
  // between this pass and the final scene — see the file header) — hence the 1.0 - below.
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

  // A faint condensate hint from the LOCAL vapor, not its own color (droplets scatter light
  // rather than tint it) — a fraction of the way from white to the vapor tone sampled right here.
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
`;

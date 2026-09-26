import { VG_OKLAB_TO_SRGB } from './oklab';
import { VG_VALUE_NOISE } from './noise';

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
// far-plane structure from one number (`depthFarScale`) with no extra grid to step, and an 8-tap
// ring blur gives the far plane aerial perspective's blur AND lower contrast from one mechanism
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
  float2 sx = float2(xw.x + xw.y, xw.z + xw.w);
  float2 sy = float2(yw.x + yw.y, yw.z + yw.w);
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

// LIGHT: the gas above is the OLD "colored vapor" mechanism — kept exactly as it was
// (still driving the isotropy/contrast/decorrelation/parallax/gravity gates in check-medium.mjs,
// none of which know about lights) so it stays a valid, near-neutral ambient base by default
// (`channelColors` defaults to a near-black family — see params.ts). What actually reads as the
// reference does — a dark volume where light is a separate, visible thing — is ADDITIVE on top of
// it, in linear light, so a rig that never binds the uniforms below (their GL default is 0) renders
// bit-for-bit as before.
//
// A light is a soft lobe from a fixed point (`vgLightAmount`): position/direction arrive already in the
// SAME up-is-positive-y fraction space `gravityBottomBoost` above uses, converted to real content
// pixels here so a circular pool of light stays circular regardless of the frame's aspect ratio
// (distance is normalized by height alone, not by each axis separately, for the same reason).
// `u_light0..2` are flat, fixed-slot uniforms, not an array — `setUniform` (vireglass/web) has no
// array form, only scalars up to vec4 (the same reason species already use `u_lab0/1/2` instead of
// one array uniform); an unused slot is simply intensity 0.
//
// `channelColors` used to be the species' hue; now `u_channelScatter` is how strongly each species
// SCATTERS the lights' color instead — hue moved to the lights, species are what they scatter, not
// what they tint (see params.ts's `channelScatter`).

const VG_LIGHT = `
float vgLightAmount(float2 xy, float2 lightPosFrac, float2 lightDir, float cosCone, float falloff, float2 resolution, float seed) {
  float2 rel = xy - lightPosFrac * resolution;
  // A cone of 180° or more is an edge strip: light spreads from a line, not a point.
  if (cosCone <= -0.999) {
    float depth = max(dot(rel, lightDir), 0.0);
    return exp(-(depth / max(resolution.y, 1.0)) * falloff);
  }
  float dist = length(rel);
  float2 dirN = dist > 1e-4 ? rel / dist : lightDir;
  float cosAngle = dot(dirN, lightDir);
  // A soft lobe with half intensity at the cone angle and no boundary at all: a lamp in haze has
  // no drawn edge.
  float lobe = log(0.5) / log(clamp(cosCone, 0.05, 0.999));
  float edge = pow(max(cosAngle, 0.0), lobe);
  float atten = exp(-(dist / max(resolution.y, 1.0)) * falloff);
  if (edge * atten < 0.001) return 0.0;
  // Static shafts inside the beam: brightness varies with the angle around the lamp, so streaks
  // fan out from the source the way light through dusty air does.
  float angle = atan(dirN.x * lightDir.y - dirN.y * lightDir.x, cosAngle);
  float shafts = 0.6 + 0.32 * vgValueNoise(float2(angle * 14.0, seed)) + 0.18 * vgValueNoise(float2(angle * 33.0, seed + 5.3));
  return edge * atten * clamp(shafts, 0.0, 1.0);
}
`;

export const MEDIUM_COMPOSITE_SHADER = `
uniform shader u_vapor;
uniform shader u_condensate;
uniform shader u_track;
uniform shader u_shadow;
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
uniform float3 u_channelScatter;
uniform float2 u_light0Pos;
uniform float2 u_light0Dir;
uniform float  u_light0CosCone;
uniform float  u_light0Falloff;
uniform float3 u_light0Color;
uniform float  u_light0Intensity;
uniform float2 u_light1Pos;
uniform float2 u_light1Dir;
uniform float  u_light1CosCone;
uniform float  u_light1Falloff;
uniform float3 u_light1Color;
uniform float  u_light1Intensity;
uniform float2 u_light2Pos;
uniform float2 u_light2Dir;
uniform float  u_light2CosCone;
uniform float  u_light2Falloff;
uniform float3 u_light2Color;
uniform float  u_light2Intensity;
uniform float  u_trackLightFloor;

${VG_OKLAB_TO_SRGB}
${VG_CUBIC_WEIGHTS}
${vgBicubicSampler('vgBicubicVapor', 'u_vapor')}
${vgBicubicSampler('vgBicubicCondensate', 'u_condensate')}
${VG_VALUE_NOISE}
${VG_LIGHT}

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
  // The dark ambient base — this is where the OLD mechanism stops (see the file header on
  // VG_LIGHT): unclamped here, clamped once at the very end, after the lit layer adds in.
  float3 rgbLinearBase = vgOklabToLinear(mixLab);

  // Spotlights reach this point dimmed by the gas in front of them (shadow-shader.ts).
  half4 shadow = u_shadow.eval(baseSrc);
  float light0 = vgLightAmount(xy, u_light0Pos, u_light0Dir, u_light0CosCone, u_light0Falloff, u_resolution, 1.7) * u_light0Intensity;
  float light1 = vgLightAmount(xy, u_light1Pos, u_light1Dir, u_light1CosCone, u_light1Falloff, u_resolution, 4.1) * u_light1Intensity
    * float(shadow.r);
  float light2 = vgLightAmount(xy, u_light2Pos, u_light2Dir, u_light2CosCone, u_light2Falloff, u_resolution, 8.3) * u_light2Intensity
    * float(shadow.g);
  float3 illum = u_light0Color * light0 + u_light1Color * light1 + u_light2Color * light2;

  float totalScatter = gasR * u_channelScatter.x + gasG * u_channelScatter.y + gasB * u_channelScatter.z;
  float fogDensity = totalScatter + wCondensate;
  float mist = 0.006 + fogDensity * 0.2;

  // TRACKS: lit the same way as the mist, plus a floor so a track already on screen never vanishes
  // entirely just because it drifted out of a cone (a fresh ionization trail reads brighter than
  // ambient mist in a real chamber). The floor is added to ITS OWN color, not multiplied into illum:
  // illum is exactly [0,0,0] in a fully unlit spot (every light's amount is 0 there), so a floor
  // multiplied by illum would vanish exactly where it exists to help — it needs a color of its own
  // (a neutral, self-luminous glow) rather than borrowing whichever light happens to be nearby.
  float trackDensity = max(float(track.r), max(float(track.g), float(track.b)));
  float3 trackGlow = (1.0 - exp(-trackDensity * 0.4)) * (illum + float3(u_trackLightFloor)) * 0.08;

  float3 rgbLinear = rgbLinearBase * 0.025 + illum * mist + trackGlow;
  rgbLinear = float3(1.0) - exp(-rgbLinear * 1.0);
  float3 srgb = vgLinearToSrgb(rgbLinear);
  return half4(half3(srgb), half(1.0));
}
`;

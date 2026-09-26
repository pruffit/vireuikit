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

// LIGHT AND GRAIN: the gas above is the OLD "colored vapor" mechanism — kept exactly as it was
// (still driving the isotropy/contrast/decorrelation/parallax/gravity gates in check-medium.mjs,
// none of which know about lights) so it stays a valid, near-neutral ambient base by default
// (`channelColors` defaults to a near-black family — see params.ts). What actually reads as the
// reference does — a dark volume where light is a separate, visible thing — is ADDITIVE on top of
// it, in linear light, so a rig that never binds the uniforms below (their GL default is 0) renders
// bit-for-bit as before.
//
// A light is a cone from a fixed point (`vgLightAmount`): position/direction arrive already in the
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
//
// Mist grain (`vgGrain`) is stateless and per-pixel — a hashed cell, not a fourth simulated buffer
// — so it costs one pass of cheap arithmetic. It nudges sideways with a per-cell sine wobble keyed
// off the SAME fall accumulator that scrolls it downward, rather than sampling the real curl-noise
// field per screen pixel: `vgCurlVelocitySeamless` is a 4-octave, multi-tap function, and this
// composite already reads ~25 dependent texture taps for the gas alone (see the isotropy gate's own
// comment on this shader's cost) — a full curl sample for every one of a 1920x952 frame's pixels,
// just for a few-pixel wobble, measured as the dominant cost in an early draft. The wobble is a
// cheap stand-in for "nudged by turbulence", not the turbulence itself.
const VG_LIGHT_AND_GRAIN = `
float vgLightAmount(float2 xy, float2 lightPosFrac, float2 lightDir, float cosCone, float falloff, float2 resolution) {
  float2 rel = xy - lightPosFrac * resolution;
  // A cone of 180° or more is an edge strip: light spreads from a line, not a point.
  if (cosCone <= -0.999) {
    float depth = max(dot(rel, lightDir), 0.0);
    return exp(-(depth / max(resolution.y, 1.0)) * falloff);
  }
  float dist = length(rel);
  float2 dirN = dist > 1e-4 ? rel / dist : lightDir;
  float cosAngle = dot(dirN, lightDir);
  float edge = smoothstep(cosCone, mix(cosCone, 1.0, 0.85), cosAngle);
  edge *= edge;
  float atten = exp(-(dist / max(resolution.y, 1.0)) * falloff);
  return edge * atten;
}

// One hashed "mote" per cell rather than a filled cell: a random sub-cell position plus a soft
// radius reads as a fine dust speck, where a filled cell would read as a pixel-grid texture. Only a
// fraction of cells host a visible mote at any moment (\`lit\`) — full occupancy would read as haze,
// not "countless individual droplets".
float vgGrain(float2 xy, float cellPx, float fallPx, float jitterPx, float jitterFreq) {
  float2 p = xy + float2(0.0, fallPx);
  float2 cell0 = floor(p / max(cellPx, 0.5));
  float cellSeed = vgHash21(cell0);
  float wobblePhase = fallPx * jitterFreq + cellSeed * 6.2831853;
  float2 wobble = float2(sin(wobblePhase), cos(wobblePhase * 1.3)) * jitterPx;
  float2 pj = p + wobble;
  float2 cell = floor(pj / max(cellPx, 0.5));
  float2 f = fract(pj / max(cellPx, 0.5));
  float h = vgHash21(cell);
  float2 speckPos = float2(vgHash21(cell + float2(7.0, 3.0)), vgHash21(cell + float2(1.0, 9.0)));
  float d = length(f - speckPos);
  float speck = smoothstep(0.3, 0.0, d);
  float lit = step(0.7, h);
  return speck * lit;
}
`;

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
uniform float  u_grainAmount;
uniform float  u_grainCellPx;
uniform float  u_grainFallPx;
uniform float  u_grainJitterPx;
uniform float  u_grainJitterFreq;
uniform float  u_trackLightFloor;

${VG_OKLAB_TO_SRGB}
${VG_CUBIC_WEIGHTS}
${vgBicubicSampler('vgBicubicVapor', 'u_vapor')}
${vgBicubicSampler('vgBicubicCondensate', 'u_condensate')}
${VG_VALUE_NOISE}
${VG_LIGHT_AND_GRAIN}

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
  // VG_LIGHT_AND_GRAIN): unclamped here, clamped once at the very end, after the lit layer adds in.
  float3 rgbLinearBase = vgOklabToLinear(mixLab);

  // LIGHTS: a separate entity from the gas, exactly as the reference shows — a cone from a fixed
  // point, falling off with distance, scattered visible only where it reaches. Colored, additive.
  float light0 = vgLightAmount(xy, u_light0Pos, u_light0Dir, u_light0CosCone, u_light0Falloff, u_resolution) * u_light0Intensity;
  float light1 = vgLightAmount(xy, u_light1Pos, u_light1Dir, u_light1CosCone, u_light1Falloff, u_resolution) * u_light1Intensity;
  float light2 = vgLightAmount(xy, u_light2Pos, u_light2Dir, u_light2CosCone, u_light2Falloff, u_resolution) * u_light2Intensity;
  float3 illum = u_light0Color * light0 + u_light1Color * light1 + u_light2Color * light2;
  float illumScalar = light0 + light1 + light2;

  // SCATTERING: species are what they scatter now, not what they tint (u_channelScatter replaces
  // channelColors' old hue role for the lit layer) — vapor only, not track (track gets its own
  // trackLit term below, so it isn't counted twice).
  float totalScatter = gasR * u_channelScatter.x + gasG * u_channelScatter.y + gasB * u_channelScatter.z;
  float fogDensity = totalScatter + wCondensate;

  // MIST GRAIN: fine droplets, visible only where lit and only where there is something to scatter
  // ("the gas itself is invisible" — see the file header). A little smooth fog on top of the
  // sparkle, from the same density, so the volume doesn't read as pure black between motes.
  float grain = vgGrain(xy, u_grainCellPx, u_grainFallPx, u_grainJitterPx, u_grainJitterFreq) * u_grainAmount;
  float densityGate = clamp(fogDensity * 3.0, 0.0, 1.0);
  float mist = 0.02 + fogDensity * 0.15 + grain * densityGate * 0.8;

  // TRACKS: lit the same way as the mist, plus a floor so a track already on screen never vanishes
  // entirely just because it drifted out of a cone (a fresh ionization trail reads brighter than
  // ambient mist in a real chamber). The floor is added to ITS OWN color, not multiplied into illum:
  // illum is exactly [0,0,0] in a fully unlit spot (every light's amount is 0 there), so a floor
  // multiplied by illum would vanish exactly where it exists to help — it needs a color of its own
  // (a neutral, self-luminous glow) rather than borrowing whichever light happens to be nearby.
  float trackDensity = max(float(track.r), max(float(track.g), float(track.b)));
  float3 trackGlow = trackDensity * (illum + float3(u_trackLightFloor));

  float3 rgbLinear = rgbLinearBase * 0.03 + illum * mist + trackGlow;
  rgbLinear = float3(1.0) - exp(-rgbLinear * 0.9);
  float3 srgb = vgLinearToSrgb(rgbLinear);
  return half4(half3(srgb), half(1.0));
}
`;

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
// second time at a different scale and offset (see MEDIUM_DEFAULTS.depthFarScale/depthFarOffset).
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

half4 main(float2 xy) {
  float2 baseSrc = xy * u_dyeScale;

  // Near plane — sampled exactly as before the depth work; the calibrated look lives here.
  half4 vapor = u_vapor.eval(baseSrc);
  half4 condensate = u_condensate.eval(baseSrc);
  half4 track = u_track.eval(baseSrc);

  // Far plane — the identical field, scaled and offset (see the file header). A 4-tap box blur
  // (no separate center sample, the cheapest isotropic blur available) supplies aerial perspective's
  // blur and, as a side effect of averaging, its lower contrast too.
  float2 farSrc = baseSrc * u_farScale + u_farOffset;
  float2 blurX = float2(u_farBlurRadius, 0.0);
  float2 blurY = float2(0.0, u_farBlurRadius);
  half4 vaporFar = (u_vapor.eval(farSrc + blurX) + u_vapor.eval(farSrc - blurX) +
                     u_vapor.eval(farSrc + blurY) + u_vapor.eval(farSrc - blurY)) * half4(0.25);
  half4 condensateFar = (u_condensate.eval(farSrc + blurX) + u_condensate.eval(farSrc - blurX) +
                          u_condensate.eval(farSrc + blurY) + u_condensate.eval(farSrc - blurY)) * half4(0.25);

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

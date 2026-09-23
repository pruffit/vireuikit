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

${VG_OKLAB_TO_SRGB}

half4 main(float2 xy) {
  float2 src = xy * u_dyeScale;
  half4 vapor = u_vapor.eval(src);
  half4 condensate = u_condensate.eval(src);
  half4 track = u_track.eval(src);
  float w0 = float(vapor.r) + float(track.r);
  float w1 = float(vapor.g) + float(track.g);
  float w2 = float(vapor.b) + float(track.b);
  float wBg = u_baseWeight;

  // A faint condensate hint from the LOCAL vapor, not its own color (droplets scatter light
  // rather than tint it) — a fraction of the way from white to the vapor tone sampled right here.
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
`;

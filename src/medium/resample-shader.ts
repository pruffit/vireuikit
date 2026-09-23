// Bilinear resample of one buffer into a different-sized target — used only when the simulation
// grid changes size (`ensureGrid` in web/medium.ts resizing on a window resize or a device
// rotation), to carry vapor/condensate/track state across instead of wiping it. A destroy-and-
// reseed on every resize was the flicker the design forbids: the vapor jumps back to its three
// initial spots and condensate/tracks blink out.
//
// Same flip convention as advect-shader.ts's `.eval()` reads: `xy` is top-down (the shader's own
// entry coordinate), the source texture is stored bottom-up, so a straight `.eval()` without the
// flip would resample from the wrong row. `u_src`'s own size (`u_srcSize`) comes from the
// transpiler's auto-generated uniform for `uniform shader` (see the comment on the cross-sampler
// in web/medium.ts) — the OLD grid's dimensions, set explicitly since bindTextureAt only binds the
// sampler itself.
export const MEDIUM_RESAMPLE_SHADER = `
uniform shader u_src;

half4 main(float2 xy) {
  float2 uv = xy / u_resolution;
  float2 src = uv * u_srcSize;
  return u_src.eval(float2(src.x, u_srcSize.y - src.y));
}
`;

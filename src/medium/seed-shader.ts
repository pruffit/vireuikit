// Initial spots for the three GAS channels: three fixed-color channels with initial spots — this
// is the entire water supply, gas has no other source, it only conserves and mixes through
// advection. One pass, three channels: r/g/b are each smoke channel's density on its own, not a
// color — composite-shader.ts paints them with a fixed palette.
export const MEDIUM_SEED_SHADER = `
uniform float2 u_spot0;
uniform float2 u_spot1;
uniform float2 u_spot2;
uniform float  u_spotRadius;

float vgSpot(float2 p, float2 c, float r) {
  float d = length(p - c) / max(r, 1.0);
  return exp(-d * d * 2.0);
}

half4 main(float2 xy) {
  float3 dye = float3(
    vgSpot(xy, u_spot0, u_spotRadius),
    vgSpot(xy, u_spot1, u_spotRadius),
    vgSpot(xy, u_spot2, u_spotRadius)
  );
  return half4(half3(dye), half(1.0));
}
`;

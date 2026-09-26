// How much of each spotlight reaches a grid cell through the gas in front of it: denser gas throws
// soft shadow streaks behind itself, so the beams are shaped by the gas rather than drawn. Computed
// once per grid cell, not per screen pixel — the gas is no finer than the grid anyway.
//
// Coordinates are the composite's grid space (`xy * u_dyeScale` there, y up): the written row
// comes out flipped relative to that, hence the flip on entry. Samples outside the grid count as
// clear air, so the REPEAT border never lets the floor's gas shade the ceiling.
export const MEDIUM_SHADOW_SHADER = `
uniform shader u_vapor;
uniform shader u_condensate;
uniform float  u_condensateGain;
uniform float2 u_light1Grid;
uniform float2 u_light2Grid;
uniform float  u_extinction;

float vgOpticalDepth(float2 p, float2 lightP) {
  float2 toLight = lightP - p;
  float optical = 0.0;
  for (int i = 1; i <= 24; i++) {
    float2 q = p + toLight * (float(i) / 24.0);
    float inside = step(0.0, q.x) * step(q.x, u_resolution.x) * step(0.0, q.y) * step(q.y, u_resolution.y);
    half4 v = u_vapor.eval(q);
    half4 c = u_condensate.eval(q);
    optical += inside * (float(v.r + v.g + v.b) + float(c.r) * u_condensateGain);
  }
  return optical * length(toLight) / 24.0 / max(u_resolution.y, 1.0);
}

half4 main(float2 xy) {
  float2 p = float2(xy.x, u_resolution.y - xy.y);
  float t1 = exp(-vgOpticalDepth(p, u_light1Grid) * u_extinction);
  float t2 = exp(-vgOpticalDepth(p, u_light2Grid) * u_extinction);
  return half4(half(t1), half(t2), half(0.0), half(1.0));
}
`;

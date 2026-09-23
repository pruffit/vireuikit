// Hash + value-noise — the shared noise primitive (track emission also uses it for the tail's
// ragged spread, `emit-shader.ts`), kept apart from what's curl-specific (the potential, the curl).
export const VG_VALUE_NOISE = `
float vgHash21(float2 p) {
  float h = dot(p, float2(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

float vgValueNoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float a = vgHash21(i);
  float b = vgHash21(i + float2(1.0, 0.0));
  float c = vgHash21(i + float2(0.0, 1.0));
  float d = vgHash21(i + float2(1.0, 1.0));
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
`;

// Curl-noise velocity field: the curl of a SCALAR potential is divergence-free by construction,
// so no Poisson solver is needed here — unlike Stable Fluids, where incompressibility has to be
// projected explicitly.
export const VG_CURL_NOISE = `
${VG_VALUE_NOISE}

float vgHash31(float3 p) {
  float h = dot(p, float3(127.1, 311.7, 74.7));
  return fract(sin(h) * 43758.5453123);
}

// 3D value-noise: time is a third grid axis, not a coordinate shift. A shift would just SLIDE the
// pattern (a "traveling" look, when motion is meant to read as random), while trilinear
// interpolation over t CHANGES the pattern itself between grid nodes — nearby moments look alike,
// distant ones don't, and no repeat ever shows up.
float vgValueNoise3(float3 p) {
  float3 i = floor(p);
  float3 f = fract(p);
  float3 u = f * f * (3.0 - 2.0 * f);
  float n000 = vgHash31(i);
  float n100 = vgHash31(i + float3(1.0, 0.0, 0.0));
  float n010 = vgHash31(i + float3(0.0, 1.0, 0.0));
  float n110 = vgHash31(i + float3(1.0, 1.0, 0.0));
  float n001 = vgHash31(i + float3(0.0, 0.0, 1.0));
  float n101 = vgHash31(i + float3(1.0, 0.0, 1.0));
  float n011 = vgHash31(i + float3(0.0, 1.0, 1.0));
  float n111 = vgHash31(i + float3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z) * 2.0 - 1.0;
}

// The potential is an fbm of three octaves, each evolving over time at its own speed (unrelated
// to the others, plus a phase offset): no single frame-wide shift can align them all at once, so
// no traveling pattern remains. The large-scale factor is a slow non-uniformity layered over the
// sum — without it, a field that's uniform by statistics still reads as a regular cell pattern.
float vgPotential(float2 p, float t) {
  float v = vgValueNoise3(float3(p, t * 0.6)) * 0.5;
  v += vgValueNoise3(float3(p * 2.03, t * 1.7 + 11.0)) * 0.25;
  v += vgValueNoise3(float3(p * 4.11, t * 0.9 + 37.0)) * 0.125;
  float macro = vgValueNoise3(float3(p * 0.35, t * 0.15 + 5.0));
  return v * (0.7 + 0.3 * macro);
}

// Velocity = (dPsi/dy, -dPsi/dx) — the curl of a scalar field, solenoidal for any Psi. Central
// differences instead of an analytic derivative: the potential is a sum of three value-noise
// calls, and there is no cheaper way to differentiate it by hand than four extra samples.
float2 vgCurlVelocity(float2 p, float t) {
  float e = 0.6;
  float px1 = vgPotential(p + float2(e, 0.0), t);
  float px0 = vgPotential(p - float2(e, 0.0), t);
  float py1 = vgPotential(p + float2(0.0, e), t);
  float py0 = vgPotential(p - float2(0.0, e), t);
  return float2(py1 - py0, -(px1 - px0)) / (2.0 * e);
}
`;

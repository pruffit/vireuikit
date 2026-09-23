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

/** GLSL float literals need a decimal point (`600` won't compile as a float) — same convention as
 *  oklab.ts's `glsl()`. */
const glslFloat = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** The field's phase wraps every this many seconds (see `web/medium.ts`'s CPU-side accumulator).
 *  Chosen so every octave rate below times this period lands on an integer — that integer is the
 *  z-lattice period `vgValueNoise3Periodic` wraps on, which is what makes the wrap exact rather
 *  than merely small. 1000s (~16.7 minutes) is long enough that a wrap is rare, while every rate
 *  in `MEDIUM_TIME_OCTAVES` still divides it evenly. */
export const MEDIUM_TIME_PERIOD = 1000;

type MediumTimeOctave = {
  /** The z-axis (phase) rate this octave's `vgValueNoise3Periodic` call advances at. */
  rate: number;
  /** Fixed phase offset — decorrelates the octaves (see the comment on `vgPotential` below) and
   *  doesn't affect periodicity: shifting a periodic function along its own axis leaves its period
   *  unchanged. */
  offset: number;
  /** Spatial frequency multiplier on `p`. */
  scale: number;
};

/** `vgPotential`'s four fbm octaves — the single source both the GLSL text below and the JS port
 *  (`vgPotentialJS`, for tests) derive their numbers from, so the two can never drift apart. */
export const MEDIUM_TIME_OCTAVES: readonly MediumTimeOctave[] = [
  { rate: 0.6, offset: 0, scale: 1 },
  { rate: 1.7, offset: 11, scale: 2.03 },
  { rate: 0.9, offset: 37, scale: 4.11 },
  { rate: 0.15, offset: 5, scale: 0.35 },
];

/** The z-lattice period for one octave's rate — `rate * MEDIUM_TIME_PERIOD`, which has to land on
 *  an integer or the phase wrap would jump instead of being seamless (see `MEDIUM_TIME_OCTAVES`).
 *  Throws at module load rather than rendering a shader that would silently jitter on every wrap. */
export function mediumOctavePeriod(rate: number): number {
  const period = rate * MEDIUM_TIME_PERIOD;
  if (!Number.isInteger(period)) {
    throw new Error(
      `medium noise: octave rate ${rate} * MEDIUM_TIME_PERIOD ${MEDIUM_TIME_PERIOD} = ${period}, not an integer — the phase wrap would not be seamless`,
    );
  }
  return period;
}

const glslOctave = (o: MediumTimeOctave) => ({
  rate: glslFloat(o.rate),
  offset: glslFloat(o.offset),
  scale: glslFloat(o.scale),
  period: glslFloat(mediumOctavePeriod(o.rate)),
});
const [VG_OCT0, VG_OCT1, VG_OCT2, VG_OCT3] = MEDIUM_TIME_OCTAVES.map(glslOctave);

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

// Same as vgValueNoise3, but the z axis wraps at \`period\`: BOTH z-lattice neighbors (i.z and
// i.z + 1.0) are folded into [0, period) before hashing, so this is EXACTLY the same function of
// z and of z + period — not just close. vgPotential below calls this once per octave, each with
// the period matching its own rate (MEDIUM_TIME_OCTAVES), so a phase that wraps at
// MEDIUM_TIME_PERIOD reproduces the identical field instead of jumping to a new one.
float vgValueNoise3Periodic(float3 p, float period) {
  float3 i = floor(p);
  float3 f = fract(p);
  float3 u = f * f * (3.0 - 2.0 * f);
  float z0 = mod(i.z, period);
  float z1 = mod(i.z + 1.0, period);
  float n000 = vgHash31(float3(i.xy, z0));
  float n100 = vgHash31(float3(i.xy + float2(1.0, 0.0), z0));
  float n010 = vgHash31(float3(i.xy + float2(0.0, 1.0), z0));
  float n110 = vgHash31(float3(i.xy + float2(1.0, 1.0), z0));
  float n001 = vgHash31(float3(i.xy, z1));
  float n101 = vgHash31(float3(i.xy + float2(1.0, 0.0), z1));
  float n011 = vgHash31(float3(i.xy + float2(0.0, 1.0), z1));
  float n111 = vgHash31(float3(i.xy + float2(1.0, 1.0), z1));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z) * 2.0 - 1.0;
}

// The potential is an fbm of three octaves, each evolving over the field's PHASE at its own speed
// (unrelated to the others, plus a phase offset): no single phase shift can align them all at
// once, so no traveling pattern remains. Each octave wraps its own z-lattice at the period that
// matches its rate (see MEDIUM_TIME_OCTAVES/vgValueNoise3Periodic), so
// vgPotential(p, phase) === vgPotential(p, phase + ${glslFloat(MEDIUM_TIME_PERIOD)}) exactly — a
// CPU-side phase accumulator can wrap at that period with no visible jump (see web/medium.ts). The
// large-scale factor is a slow non-uniformity layered over the sum — without it, a field that's
// uniform by statistics still reads as a regular cell pattern.
float vgPotential(float2 p, float phase) {
  float v = vgValueNoise3Periodic(float3(p * ${VG_OCT0.scale}, phase * ${VG_OCT0.rate} + ${VG_OCT0.offset}), ${VG_OCT0.period}) * 0.5;
  v += vgValueNoise3Periodic(float3(p * ${VG_OCT1.scale}, phase * ${VG_OCT1.rate} + ${VG_OCT1.offset}), ${VG_OCT1.period}) * 0.25;
  v += vgValueNoise3Periodic(float3(p * ${VG_OCT2.scale}, phase * ${VG_OCT2.rate} + ${VG_OCT2.offset}), ${VG_OCT2.period}) * 0.125;
  float macro = vgValueNoise3Periodic(float3(p * ${VG_OCT3.scale}, phase * ${VG_OCT3.rate} + ${VG_OCT3.offset}), ${VG_OCT3.period});
  return v * (0.7 + 0.3 * macro);
}

// Velocity = (dPsi/dy, -dPsi/dx) — the curl of a scalar field, solenoidal for any Psi. Central
// differences instead of an analytic derivative: the potential is a sum of three value-noise
// calls, and there is no cheaper way to differentiate it by hand than four extra samples.
float2 vgCurlVelocity(float2 p, float phase) {
  float e = 0.6;
  float px1 = vgPotential(p + float2(e, 0.0), phase);
  float px0 = vgPotential(p - float2(e, 0.0), phase);
  float py1 = vgPotential(p + float2(0.0, e), phase);
  float py0 = vgPotential(p - float2(0.0, e), phase);
  return float2(py1 - py0, -(px1 - px0)) / (2.0 * e);
}
`;

// --- JS port of the periodic potential, for tests that can't spin up a WebGL2 context ------------
//
// The exact same arithmetic as vgHash31/vgValueNoise3Periodic/vgPotential above, so a vitest can
// prove periodicity and continuity across the phase wrap without a GPU. Kept next to the shader
// text as the single source of truth for what "the same constants" means: both are generated from
// MEDIUM_TIME_OCTAVES, and `medium-noise-periodicity.test.ts` checks the shader string itself
// contains these numbers rather than trusting that the two never drifted apart.

function hash31JS(x: number, y: number, z: number): number {
  const h = x * 127.1 + y * 311.7 + z * 74.7;
  const s = Math.sin(h) * 43758.5453123;
  return s - Math.floor(s);
}

const smoothstep3JS = (f: number): number => f * f * (3 - 2 * f);

/** GLSL's `mod(x, y)` for floats is `x - y * floor(x / y)` — always in `[0, y)`, unlike JS's `%`,
 *  which keeps the sign of `x`. Matching it exactly here is the point: this IS the wrap the shader
 *  performs. */
const glslMod = (x: number, y: number): number => x - y * Math.floor(x / y);

/** Pure-JS port of `vgValueNoise3Periodic`. */
export function vgValueNoise3PeriodicJS(px: number, py: number, pz: number, period: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  const ux = smoothstep3JS(px - ix);
  const uy = smoothstep3JS(py - iy);
  const uz = smoothstep3JS(pz - iz);
  const z0 = glslMod(iz, period);
  const z1 = glslMod(iz + 1, period);
  const n000 = hash31JS(ix, iy, z0);
  const n100 = hash31JS(ix + 1, iy, z0);
  const n010 = hash31JS(ix, iy + 1, z0);
  const n110 = hash31JS(ix + 1, iy + 1, z0);
  const n001 = hash31JS(ix, iy, z1);
  const n101 = hash31JS(ix + 1, iy, z1);
  const n011 = hash31JS(ix, iy + 1, z1);
  const n111 = hash31JS(ix + 1, iy + 1, z1);
  const nx00 = n000 + (n100 - n000) * ux;
  const nx10 = n010 + (n110 - n010) * ux;
  const nx01 = n001 + (n101 - n001) * ux;
  const nx11 = n011 + (n111 - n011) * ux;
  const nxy0 = nx00 + (nx10 - nx00) * uy;
  const nxy1 = nx01 + (nx11 - nx01) * uy;
  return (nxy0 + (nxy1 - nxy0) * uz) * 2 - 1;
}

/** Pure-JS port of `vgPotential`, built from the same `MEDIUM_TIME_OCTAVES` table the shader text
 *  above is generated from. */
export function vgPotentialJS(px: number, py: number, phase: number): number {
  const [o0, o1, o2, o3] = MEDIUM_TIME_OCTAVES;
  let v =
    vgValueNoise3PeriodicJS(px * o0.scale, py * o0.scale, phase * o0.rate + o0.offset, mediumOctavePeriod(o0.rate)) *
    0.5;
  v +=
    vgValueNoise3PeriodicJS(px * o1.scale, py * o1.scale, phase * o1.rate + o1.offset, mediumOctavePeriod(o1.rate)) *
    0.25;
  v +=
    vgValueNoise3PeriodicJS(px * o2.scale, py * o2.scale, phase * o2.rate + o2.offset, mediumOctavePeriod(o2.rate)) *
    0.125;
  const macro = vgValueNoise3PeriodicJS(
    px * o3.scale,
    py * o3.scale,
    phase * o3.rate + o3.offset,
    mediumOctavePeriod(o3.rate),
  );
  return v * (0.7 + 0.3 * macro);
}

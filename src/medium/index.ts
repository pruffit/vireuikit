export * from './params';
export * from './oklab';
export * from './species';
// Not a barrel re-export: noise.ts also carries test-only JS ports (vgPotentialJS,
// vgValueNoise3PeriodicJS, mediumOctavePeriod) and the octave table they're built from
// (MEDIUM_TIME_OCTAVES) — internal to the package, not public API. Tests import them from
// './noise' directly. MEDIUM_TIME_PERIOD stays here: web/medium.ts's phase accumulator and a
// consumer inspecting the wrap period both have a legitimate reason to see it.
export { MEDIUM_TIME_PERIOD, VG_CURL_NOISE, VG_VALUE_NOISE } from './noise';
export * from './seed-shader';
export * from './resample-shader';
export * from './advect-shader';
export * from './composite-shader';
export * from './emit-shader';
export * from './shadow-shader';
export * from './dynamics';
export * from './light-rig';

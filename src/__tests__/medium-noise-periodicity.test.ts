import { describe, expect, it } from 'vitest';
import { MEDIUM_DEFAULTS } from '../medium';
// Direct module path, not the package barrel: vgPotentialJS/vgValueNoise3PeriodicJS/
// mediumOctavePeriod/MEDIUM_TIME_OCTAVES are internal to this package (see medium/index.ts) —
// tests reach them here instead of through the public API.
import {
  MEDIUM_TIME_OCTAVES,
  MEDIUM_TIME_PERIOD,
  VG_CURL_NOISE,
  mediumOctavePeriod,
  vgPotentialJS,
  vgValueNoise3PeriodicJS,
} from '../medium/noise';

// Why this file exists: the field's phase (curl-noise's time axis, `u_phase` in advect-shader.ts)
// is accumulated on the CPU and wrapped at MEDIUM_TIME_PERIOD instead of growing without bound —
// over hours of playback an ever-growing value would eventually lose the float32 bits that place a
// point within its own lattice cell, and the pattern would jitter. Wrapping is only safe because
// `vgPotential` is built to be EXACTLY periodic with that same period (see noise.ts's
// `vgValueNoise3Periodic`); these tests are the proof, on the JS port `vgPotentialJS` that mirrors
// the shader text bit for bit.

describe('MEDIUM_TIME_OCTAVES: the periods a phase wrap relies on', () => {
  it('every octave rate times the period lands on an integer', () => {
    for (const o of MEDIUM_TIME_OCTAVES) {
      expect(Number.isInteger(o.rate * MEDIUM_TIME_PERIOD)).toBe(true);
    }
  });

  it('the periods are exactly 600, 1700, 900, 150 at T = 1000', () => {
    expect(MEDIUM_TIME_PERIOD).toBe(1000);
    expect(MEDIUM_TIME_OCTAVES.map((o) => mediumOctavePeriod(o.rate))).toEqual([600, 1700, 900, 150]);
  });

  // MEDIUM_TIME_PERIOD is in PHASE units (curlSpeed·seconds), not seconds — the wall-clock wrap
  // period is MEDIUM_TIME_PERIOD / curlSpeed (see the comment on MEDIUM_TIME_PERIOD). This ties
  // that comment's stated ~2.3h figure to the ACTUAL shipped default, so a future change to
  // curlSpeed fails here instead of leaving a stale number in a comment nobody revisits.
  it('wraps every ~2.3h of real time at the shipped default curlSpeed', () => {
    const wallClockSeconds = MEDIUM_TIME_PERIOD / MEDIUM_DEFAULTS.curlSpeed;
    expect(wallClockSeconds / 3600).toBeCloseTo(2.3148, 3);
  });

  it('mediumOctavePeriod refuses a rate that would not wrap seamlessly', () => {
    // 1/3 * 1000 is not an integer — a rate that doesn't divide the period evenly would make the
    // hash's mod(i.z, period) land on a different node depending on which side of the wrap you
    // approach from.
    expect(() => mediumOctavePeriod(1 / 3)).toThrow();
  });
});

describe('VG_CURL_NOISE: the shader text is assembled from MEDIUM_TIME_OCTAVES, not retyped', () => {
  it('contains each octave\'s rate, offset, scale and period as rendered numbers', () => {
    const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
    for (const o of MEDIUM_TIME_OCTAVES) {
      expect(VG_CURL_NOISE).toContain(`${glslFloat(o.rate)} +`);
      expect(VG_CURL_NOISE).toContain(glslFloat(o.offset));
      expect(VG_CURL_NOISE).toContain(`p * ${glslFloat(o.scale)}`);
      expect(VG_CURL_NOISE).toContain(glslFloat(mediumOctavePeriod(o.rate)));
    }
  });

  it('wraps both z-lattice neighbors of vgValueNoise3Periodic through mod(., period)', () => {
    expect(VG_CURL_NOISE).toContain('mod(i.z, period)');
    expect(VG_CURL_NOISE).toContain('mod(i.z + 1.0, period)');
  });
});

// A grid of spatial points and phases, away from 0/T themselves, so the periodicity check isn't
// vacuously comparing a value to itself.
const SPATIAL_POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.3, -2.1],
  [-4.7, 3.2],
  [10, 10],
  [-0.4, 8.8],
];
const PHASE_SAMPLES = [0, 1, 137.2, 400.5, 613.9, 842.1, 999];

describe('vgPotentialJS: periodic in phase with period MEDIUM_TIME_PERIOD', () => {
  it('agrees at phase and phase + T to machine precision, on a grid of points', () => {
    let maxDiff = 0;
    for (const [x, y] of SPATIAL_POINTS) {
      for (const phase of PHASE_SAMPLES) {
        const a = vgPotentialJS(x, y, phase);
        const b = vgPotentialJS(x, y, phase + MEDIUM_TIME_PERIOD);
        maxDiff = Math.max(maxDiff, Math.abs(a - b));
      }
    }
    // "Machine precision" for float64 arithmetic on values of order 1: comfortably above the
    // ~1e-16 ULP floor, comfortably below anything a real discontinuity (order 1) would produce.
    expect(maxDiff).toBeLessThan(1e-9);
  });

  it('also agrees several periods apart (2T, 5T) — the wrap is exact, not a one-time coincidence', () => {
    for (const [x, y] of SPATIAL_POINTS) {
      const base = vgPotentialJS(x, y, 321.7);
      for (const k of [2, 5, 11]) {
        const shifted = vgPotentialJS(x, y, 321.7 + k * MEDIUM_TIME_PERIOD);
        expect(Math.abs(base - shifted)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('vgPotentialJS: continuous across the phase wrap seam', () => {
  // The threshold is derived, not guessed: measure the field's own worst-case slope w.r.t. phase
  // away from the seam (central differences at a spread of points), then a real discontinuity at
  // the seam would have to exceed slope * (the phase gap being crossed) by construction — a jump
  // is exactly what a bounded derivative rules out. SAFETY_FACTOR gives room for the finite grid
  // of slope samples not having hit the true supremum.
  const SLOPE_H = 1e-3;
  const SEAM_EPS = 1e-3;
  const SAFETY_FACTOR = 5;

  function measureMaxSlope(): number {
    let maxSlope = 0;
    for (const [x, y] of SPATIAL_POINTS) {
      for (let phase = 20; phase < MEDIUM_TIME_PERIOD - 20; phase += 47.3) {
        const d = (vgPotentialJS(x, y, phase + SLOPE_H) - vgPotentialJS(x, y, phase - SLOPE_H)) / (2 * SLOPE_H);
        maxSlope = Math.max(maxSlope, Math.abs(d));
      }
    }
    return maxSlope;
  }

  it('the step across the seam is no larger than the measured slope predicts', () => {
    const maxSlope = measureMaxSlope();
    // Sanity: the field actually moves (a slope of 0 would make this test vacuous).
    expect(maxSlope).toBeGreaterThan(0);
    const threshold = maxSlope * 2 * SEAM_EPS * SAFETY_FACTOR;

    for (const [x, y] of SPATIAL_POINTS) {
      const before = vgPotentialJS(x, y, MEDIUM_TIME_PERIOD - SEAM_EPS);
      const after = vgPotentialJS(x, y, SEAM_EPS);
      expect(Math.abs(before - after)).toBeLessThanOrEqual(threshold);
    }
  });

  it('a naive wrap (no periodic hash) WOULD jump — proving this test is sensitive', () => {
    // The exact mistake the design forbids: wrap the phase value but leave the noise itself
    // non-periodic. `phase * rate` for octave 0 (rate 0.6) lands near z=600 just before the wrap
    // and near z=0 just after — two essentially uncorrelated lattice nodes, not neighbors.
    function naivePotential(x: number, y: number, phase: number): number {
      // Reuses vgValueNoise3PeriodicJS's own math by calling it with a period so large it never
      // wraps in this test's range — i.e. the periodic hash degenerates to a plain, non-wrapping
      // one, the same shape of mistake as "simply wrapping the clock" without a periodic noise.
      const NO_WRAP = 1e9;
      const [o0, o1, o2, o3] = MEDIUM_TIME_OCTAVES;
      let v = vgValueNoise3PeriodicJS(x, y, phase * o0.rate + o0.offset, NO_WRAP) * 0.5;
      v += vgValueNoise3PeriodicJS(x * o1.scale, y * o1.scale, phase * o1.rate + o1.offset, NO_WRAP) * 0.25;
      v += vgValueNoise3PeriodicJS(x * o2.scale, y * o2.scale, phase * o2.rate + o2.offset, NO_WRAP) * 0.125;
      const macro = vgValueNoise3PeriodicJS(x * o3.scale, y * o3.scale, phase * o3.rate + o3.offset, NO_WRAP);
      return v * (0.7 + 0.3 * macro);
    }

    const maxSlope = measureMaxSlope();
    const threshold = maxSlope * 2 * SEAM_EPS * SAFETY_FACTOR;

    let sawAJump = false;
    for (const [x, y] of SPATIAL_POINTS) {
      const before = naivePotential(x, y, MEDIUM_TIME_PERIOD - SEAM_EPS);
      const after = naivePotential(x, y, SEAM_EPS);
      if (Math.abs(before - after) > threshold) sawAJump = true;
    }
    expect(sawAJump).toBe(true);
  });
});

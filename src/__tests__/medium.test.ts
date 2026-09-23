import { describe, expect, it } from 'vitest';
import {
  LINEAR_TO_LMS,
  LMS_TO_LINEAR,
  LMS_TO_OKLAB,
  MEDIUM_DEFAULTS,
  OKLAB_TO_LMS,
  oklabToSrgb,
  srgbToOklab,
  VG_OKLAB_TO_SRGB,
} from '../medium';

const COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 1, 1],
  [0.5, 0.5, 0.5],
  [0.86, 0.42, 0.24],
  [0.36, 0.46, 0.92],
  [0.32, 0.78, 0.62],
  [0.07, 0.08, 0.1],
];

type Mat3 = readonly (readonly [number, number, number])[];
const mul = (a: Mat3, b: Mat3) =>
  a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));

describe('medium Oklab: the GPU and the CPU compute the same thing', () => {
  // The forward direction is computed by JS once per frame, the inverse by the shader per pixel.
  // If the two sets of numbers drifted apart, the palette would shift by a hue with nothing to
  // catch it.
  it('a round trip returns the original color', () => {
    for (const c of COLORS) {
      const back = oklabToSrgb(srgbToOklab(c));
      for (let i = 0; i < 3; i += 1) expect(back[i]).toBeCloseTo(c[i], 6);
    }
  });

  it('the forward and inverse matrices are mutual inverses', () => {
    for (const [a, b] of [
      [LINEAR_TO_LMS, LMS_TO_LINEAR],
      [LMS_TO_OKLAB, OKLAB_TO_LMS],
    ] as const) {
      const id = mul(a, b);
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) expect(id[i][j]).toBeCloseTo(i === j ? 1 : 0, 4);
      }
    }
  });

  it('the shader text is assembled from the same numbers, not retyped by hand', () => {
    for (const row of OKLAB_TO_LMS) {
      for (const k of row) expect(VG_OKLAB_TO_SRGB).toContain(String(k === 1 ? '1.0' : k));
    }
    for (const row of LMS_TO_LINEAR) {
      for (const k of row) expect(VG_OKLAB_TO_SRGB).toContain(String(k));
    }
  });

  it('gray stays gray: a neutral has no chroma', () => {
    const [, a, b] = srgbToOklab([0.5, 0.5, 0.5]);
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
  });
});

describe('medium parameters', () => {
  it('decay is positive: without it the medium never fades', () => {
    expect(MEDIUM_DEFAULTS.decay).toBeGreaterThan(0);
  });

  it('there are exactly three channels, all within sRGB', () => {
    expect(MEDIUM_DEFAULTS.channelColors).toHaveLength(3);
    for (const c of [...MEDIUM_DEFAULTS.channelColors, MEDIUM_DEFAULTS.baseColor, MEDIUM_DEFAULTS.condensateColor]) {
      expect(c).toHaveLength(3);
      for (const v of c) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  // Turbulence gate 0..1, background weight 0..1, condensate tint fraction 0..1 — otherwise the
  // mix runs out of bounds.
  it('the gated fractions stay within their bounds', () => {
    for (const v of [MEDIUM_DEFAULTS.turbulence, MEDIUM_DEFAULTS.baseWeight, MEDIUM_DEFAULTS.condensateTint]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  // Vapor is supersaturated and stays the larger share of the water at equilibrium, so
  // evaporation has to be faster than condensation — otherwise droplets would accumulate most of
  // the water instead of vapor.
  it('evaporation is faster than condensation: vapor stays dominant at equilibrium', () => {
    expect(MEDIUM_DEFAULTS.evaporationRate).toBeGreaterThan(MEDIUM_DEFAULTS.condensationRate);
  });

  it('phase-transition, settling and growth rates are positive', () => {
    for (const v of [
      MEDIUM_DEFAULTS.condensationRate,
      MEDIUM_DEFAULTS.evaporationRate,
      MEDIUM_DEFAULTS.condensateSettleSpeed,
      MEDIUM_DEFAULTS.condensateSpreadRate,
      MEDIUM_DEFAULTS.condensateGain,
    ]) {
      expect(v).toBeGreaterThan(0);
    }
  });
});

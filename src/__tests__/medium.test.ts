import { describe, expect, it } from 'vitest';
import {
  depthFarOffsetPx,
  LINEAR_TO_LMS,
  LMS_TO_LINEAR,
  LMS_TO_OKLAB,
  MEDIUM_DEFAULTS,
  OKLAB_TO_LMS,
  oklabToSrgb,
  srgbToOklab,
  VG_OKLAB_TO_SRGB,
  wrappedDistanceFromZero,
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

describe('medium depth: parallax, aerial perspective, gravity', () => {
  it('the far plane samples MORE of the field per screen-px, never less — that is the whole mechanism', () => {
    expect(MEDIUM_DEFAULTS.depthFarScale).toBeGreaterThan(1);
  });

  // The offset is a FRACTION of the grid, not a fixed grid-px value, so its EFFECTIVE (wrapped)
  // distance from zero has to stay comfortably above a curl-noise wavelength at every grid size
  // this package is expected to run at — not just the one gate/example that happened to get
  // tested. A fixed grid-px offset can look fine at one size and echo at another (see
  // depthFarOffsetPx's own comment: this shipped once as [41, 67] grid-px, fine at 96px, but 67
  // wraps to 5px at the 72px height this package's own README uses as its example).
  it('the far offset stays well above one curl-noise wavelength across supported grid sizes', () => {
    const wavelength = 1 / MEDIUM_DEFAULTS.curlFreq;
    const margin = 1.2; // comfortable headroom, not a hair's breadth over the line
    for (const size of [64, 72, 96, 128, 192, 256]) {
      const [offsetX, offsetY] = depthFarOffsetPx(MEDIUM_DEFAULTS.depthFarOffsetFrac, size, size);
      expect(wrappedDistanceFromZero(offsetX, size)).toBeGreaterThan(wavelength * margin);
      expect(wrappedDistanceFromZero(offsetY, size)).toBeGreaterThan(wavelength * margin);
    }
  });

  // Regression documentation, not a test of current behavior: proves the FAILURE MODE a fixed
  // grid-px offset produced (this shipped once, before depthFarOffsetFrac replaced it) — 67 grid-px
  // at the README's own 72px grid height wraps to just 5px, well under one wavelength, which is
  // exactly the "the far plane nearly re-reads the near one" bug the fraction-based offset exists
  // to prevent.
  it('a fixed grid-px offset (the bug depthFarOffsetFrac replaces) would have wrapped into an echo', () => {
    const wavelength = 1 / MEDIUM_DEFAULTS.curlFreq;
    const buggyOffsetPx = 67;
    const gridHeight = 72;
    expect(wrappedDistanceFromZero(buggyOffsetPx, gridHeight)).toBeLessThan(wavelength);
  });

  it('the far plane blurs and is weighted down, never sharper or louder than the near plane', () => {
    expect(MEDIUM_DEFAULTS.depthFarBlurRadius).toBeGreaterThan(0);
    expect(MEDIUM_DEFAULTS.depthFarWeight).toBeGreaterThan(0);
    expect(MEDIUM_DEFAULTS.depthFarWeight).toBeLessThan(1);
  });

  // Gravity has to touch the gas too, but "barely noticeable" is the requirement — an order of
  // magnitude below condensate's own settle speed keeps it that way.
  it('vapor drift is positive but far below condensate settling', () => {
    expect(MEDIUM_DEFAULTS.gravityVaporDrift).toBeGreaterThan(0);
    expect(MEDIUM_DEFAULTS.gravityVaporDrift).toBeLessThan(MEDIUM_DEFAULTS.condensateSettleSpeed / 5);
  });

  it('the bottom boost only ADDS density, and only near the floor of the frame', () => {
    expect(MEDIUM_DEFAULTS.gravityBottomBoost).toBeGreaterThan(0);
    expect(MEDIUM_DEFAULTS.gravityBottomBoostStart).toBeGreaterThan(0.5);
    expect(MEDIUM_DEFAULTS.gravityBottomBoostStart).toBeLessThan(1);
  });
});

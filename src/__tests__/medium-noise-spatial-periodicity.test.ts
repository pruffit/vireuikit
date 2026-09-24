import { describe, expect, it } from 'vitest';
import { MEDIUM_DEFAULTS, MEDIUM_DEFAULT_CELL_PX } from '../medium';
// Internal module path — see the comment on medium/index.ts's noise re-export.
import { computeMediumSpatialPeriods, vgPotentialSeamlessJS } from '../medium/noise';

// Why this file exists: vgPotential (noise.ts) was periodic in TIME only — the simulation domain is
// a torus (gl.REPEAT), but the lattice never wrapped in x/y, so velocity jumped at the domain seam
// (see check-medium.mjs's isotropy gate for the rendered consequence: a lattice of straight lines).
// vgPotentialSeamless closes that gap the same way the time axis already was.
//
// Each octave's per-axis frequency (`computeMediumSpatialPeriods`) is chosen so that shifting by
// exactly ONE GRID WIDTH (or height) advances EVERY octave's own lattice coordinate by EXACTLY its
// own integer period — not a coincidence: freqX = periodX / (gridWidth * curlFreq), so
// gridWidth * curlFreq * freqX collapses to periodX by construction, for any octave. That means the
// FULL fbm sum (not just one octave in isolation) is periodic with period gridWidth/gridHeight
// EXACTLY — the actual simulation domain size, which is the property that closes the seam.

// The product's own default (round(1920/26), round(952/26) at MEDIUM_DEFAULT_CELL_PX — the exact
// size/grid check-medium.mjs's isotropy gate measures at) plus the README's own 128x72 example and
// a deliberately tiny grid, so this isn't only proven at one size.
const GRID_SIZES: readonly (readonly [number, number])[] = [
  [Math.round(1920 / MEDIUM_DEFAULT_CELL_PX), Math.round(952 / MEDIUM_DEFAULT_CELL_PX)],
  [128, 72],
  [16, 12],
];

const SPATIAL_POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.3, -2.1],
  [-4.7, 3.2],
  [10, 10],
  [-0.4, 8.8],
];
const PHASE_SAMPLES = [0, 1, 61.3, 400.5, 842.1];

describe('computeMediumSpatialPeriods: the wrap a resize has to recompute', () => {
  it('every period is an integer at least 2 (never a degenerate 0/1-cell wrap)', () => {
    for (const [w, h] of GRID_SIZES) {
      for (const o of computeMediumSpatialPeriods(w, h, MEDIUM_DEFAULTS.curlFreq)) {
        expect(Number.isInteger(o.periodX)).toBe(true);
        expect(Number.isInteger(o.periodY)).toBe(true);
        expect(o.periodX).toBeGreaterThanOrEqual(2);
        expect(o.periodY).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('gridSize * curlFreq * frequency lands exactly on the period, by construction', () => {
    // freqX is defined as periodX / (gridWidth * curlFreq), so gridWidth * curlFreq * freqX
    // collapses to periodX exactly — this identity is what makes a shift of gridWidth (see the
    // periodicity describe block below) advance every octave to precisely its own integer period.
    for (const [w, h] of GRID_SIZES) {
      for (const o of computeMediumSpatialPeriods(w, h, MEDIUM_DEFAULTS.curlFreq)) {
        expect(w * MEDIUM_DEFAULTS.curlFreq * o.freqX).toBeCloseTo(o.periodX, 9);
        expect(h * MEDIUM_DEFAULTS.curlFreq * o.freqY).toBeCloseTo(o.periodY, 9);
      }
    }
  });

  it('freqX/freqY stay close to the octave\'s own scale — a small correction, not a redesign', () => {
    // freqX/freqY replace the compile-time `scale` constant in a call already made against
    // curlFreq-scaled coordinates (vgPotentialSeamless(xy * u_curlFreq, ...) — see advect-shader.ts
    // and vgPotentialSeamlessJS's own JSDoc), so the nominal value to compare against is the scale
    // itself, not curlFreq * scale. MEDIUM_TIME_OCTAVES' own scales, duplicated here for the same
    // reason check-medium.mjs's isotropy canary duplicates them: noise.ts doesn't export the octave
    // table through the barrel.
    //
    // Octave 3 (the macro octave, scale 0.35 — the lowest frequency) is excluded here: its
    // un-rounded period is already under 2 cells at BOTH grids this checks (1.17 at 74x37, 1.13 at
    // 128x72's height), so the MIN_SPATIAL_PERIOD floor is a large correction there by design, not a
    // small one — covered by its own "at least 2" and "gridSize * curlFreq * freqX = periodX"
    // assertions above instead of a closeness bound that the floor exists specifically to violate.
    const scales = [1, 2.03, 4.11];
    for (const [w, h] of GRID_SIZES.slice(0, 2)) {
      const spatial = computeMediumSpatialPeriods(w, h, MEDIUM_DEFAULTS.curlFreq);
      scales.forEach((nominal, i) => {
        const o = spatial[i];
        expect(Math.abs(o.freqX - nominal)).toBeLessThan(nominal * 0.35 + 1e-6);
        expect(Math.abs(o.freqY - nominal)).toBeLessThan(nominal * 0.35 + 1e-6);
      });
    }
  });
});

describe('vgPotentialSeamlessJS: periodic over the GRID DOMAIN, in space, at every octave at once', () => {
  // vgPotentialSeamlessJS takes coordinates ALREADY multiplied by curlFreq (mirroring
  // vgPotentialSeamless(xy * u_curlFreq, ...) at its GLSL call site, and vgPotentialJS's own
  // identical convention) — so "one grid width over" in that space is `gridWidth * curlFreq`, not
  // a bare `gridWidth`. This is what makes freqX = periodX / (gridWidth * curlFreq) cancel exactly:
  // shifting by gridWidth * curlFreq advances every octave's own lattice coordinate by precisely
  // its own integer period, regardless of curlFreq or which octave.
  const shiftFor = (w: number) => w * MEDIUM_DEFAULTS.curlFreq;

  it('agrees at x and x + gridWidth (and y and y + gridHeight) to machine precision', () => {
    for (const [w, h] of GRID_SIZES) {
      const spatial = computeMediumSpatialPeriods(w, h, MEDIUM_DEFAULTS.curlFreq);
      let maxDiffX = 0;
      let maxDiffY = 0;
      for (const [x, y] of SPATIAL_POINTS) {
        for (const phase of PHASE_SAMPLES) {
          const base = vgPotentialSeamlessJS(x, y, phase, spatial);
          const shiftedX = vgPotentialSeamlessJS(x + shiftFor(w), y, phase, spatial);
          const shiftedY = vgPotentialSeamlessJS(x, y + shiftFor(h), phase, spatial);
          maxDiffX = Math.max(maxDiffX, Math.abs(base - shiftedX));
          maxDiffY = Math.max(maxDiffY, Math.abs(base - shiftedY));
        }
      }
      expect(maxDiffX).toBeLessThan(1e-9);
      expect(maxDiffY).toBeLessThan(1e-9);
    }
  });

  it('also agrees several grid widths/heights over (2x, 5x) — the wrap is exact, not a coincidence', () => {
    const [w, h] = GRID_SIZES[0];
    const spatial = computeMediumSpatialPeriods(w, h, MEDIUM_DEFAULTS.curlFreq);
    for (const [x, y] of SPATIAL_POINTS) {
      const base = vgPotentialSeamlessJS(x, y, 137.2, spatial);
      for (const k of [2, 5]) {
        const shiftedX = vgPotentialSeamlessJS(x + k * shiftFor(w), y, 137.2, spatial);
        const shiftedY = vgPotentialSeamlessJS(x, y + k * shiftFor(h), 137.2, spatial);
        expect(Math.abs(base - shiftedX)).toBeLessThan(1e-9);
        expect(Math.abs(base - shiftedY)).toBeLessThan(1e-9);
      }
    }
  });

  it('a naive (non-seamless) field would NOT repeat over the grid domain — proving this test is sensitive', () => {
    // The mistake the fix corrects, made concrete: a period so large it never wraps within the
    // range tested (the same NO_WRAP trick check-medium.mjs's isotropy canary uses), fed the SAME
    // frequency — if the wrap itself weren't doing the work, this would pass too.
    const [w, h] = GRID_SIZES[0];
    const nonSeamless = computeMediumSpatialPeriods(w, h, MEDIUM_DEFAULTS.curlFreq).map((o) => ({
      ...o,
      periodX: 1e9,
      periodY: 1e9,
    }));
    let sawADifference = false;
    for (const [x, y] of SPATIAL_POINTS) {
      const base = vgPotentialSeamlessJS(x, y, 137.2, nonSeamless);
      const shiftedX = vgPotentialSeamlessJS(x + shiftFor(w), y, 137.2, nonSeamless);
      if (Math.abs(base - shiftedX) > 1e-6) sawADifference = true;
    }
    expect(sawADifference).toBe(true);
  });
});

describe('computeMediumSpatialPeriods: the lattice stays isotropic on non-square grids', () => {
  // Flooring each axis on its own once gave the macro octave a 2:1 lattice on a 74x37 grid, which
  // drew the field along one axis; only the slow isotropy gate would have caught it.
  it('keeps each octave within 0.8..1.25 of equal frequency on both axes', () => {
    const sides = [12, 20, 31, 37, 48, 64, 72, 74, 96, 119, 128, 192, 240, 256];
    for (const w of sides) {
      for (const h of sides) {
        for (const o of computeMediumSpatialPeriods(w, h, MEDIUM_DEFAULTS.curlFreq)) {
          const ratio = o.freqX / o.freqY;
          expect(ratio, `${w}x${h}`).toBeGreaterThanOrEqual(0.8);
          expect(ratio, `${w}x${h}`).toBeLessThanOrEqual(1.25);
        }
      }
    }
  });

  it('survives a zero curl frequency without handing the shader Infinity', () => {
    for (const o of computeMediumSpatialPeriods(74, 37, 0)) {
      expect(Number.isFinite(o.freqX) && Number.isFinite(o.freqY)).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { MEDIUM_DEFAULTS } from '../medium';
// Internal module path — see the comment on medium/index.ts's noise re-export.
import { MEDIUM_TIME_OCTAVES, mediumOctavePeriod, vgPotentialJS, vgValueNoise3PeriodicJS } from '../medium/noise';

// Ported from the VireMusic monorepo's lab gate (medium-pattern-gate.mjs, pruffit/vire-glass):
// samples the curl-noise POTENTIAL (not a rendered frame) on a grid at phase P and P+ΔP, then
// finds the shift (dx, dy) that best correlates the two samples. A pattern that TRAVELS (a domain
// shifted by time) correlates almost perfectly under its own shift; a pattern that EVOLVES (time
// as a third noise axis, what this package actually does) does not, because trilinear
// interpolation over the third axis changes the shape between grid nodes, not just its position.
//
// Why sample the potential directly rather than drive it through the full render pipeline (the
// way check-medium.mjs's other gates do): water is a conserved volume (see the resize/water
// gates) — the seeded spots never fade, only drift with the mean flow, and that drift alone
// produces a high shift-correlation regardless of whether the FIELD's own pattern travels or
// evolves. Sampling the potential has no such confound: it isolates exactly the temporal behavior
// this module controls.
//
// Judged on the MAIN octave (weight 0.5) alone, not the full fbm sum: a hypothetical domain-shift
// formula's three octaves would drift at different rates (see `potentialRidingFull` below) and no
// longer combine into one coherent shift either way, which would mask the exact thing this test
// checks. The main octave is the actual mechanism vgPotential's header comment describes — the
// third noise axis vs. a domain shift — isolated from the other octaves' own noise.
const CURL_FREQ = MEDIUM_DEFAULTS.curlFreq;
const CURL_SPEED = MEDIUM_DEFAULTS.curlSpeed;
const COLS = 42;
const ROWS = 92;
const DELTA_S = 14;
const SEARCH_FRAC = 0.4;
const MIN_OVERLAP_FRAC = 0.5;
/**
 * Between a riding (canary) and an evolving (production) main octave. Ported from the monorepo
 * gate's own calibration, unchanged: the sampled phases here (around 4.8-6.5) stay far under any
 * octave's wrap period (600 at minimum — see MEDIUM_TIME_OCTAVES), so vgValueNoise3Periodic's
 * mod(i.z, period) never triggers and this is bit-for-bit the same computation the monorepo's
 * original non-periodic noise did — the phase-wrap work in this package does not move these
 * numbers. Measured directly against this test's own functions: riding 0.9999, evolving 0.6611 —
 * kept at 0.75, with margin on both sides (0.089 below to evolving, 0.25 above to riding).
 */
const CORRELATION_LIMIT = 0.75;

// --- riding: the mistake this design forbids, made concrete — the domain shifts with time (a
// "traveling" look), the noise pattern itself never changes shape. This formula never shipped in
// vireuikit; it's the historical bug the monorepo gate exists to guard against, reproduced here
// only as a canary. ---
function hash21(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const m0 = a + (b - a) * ux;
  const m1 = c + (d - c) * ux;
  return (m0 + (m1 - m0) * uy) * 2 - 1;
}
function mainOctaveRiding(x: number, y: number, phase: number): number {
  return valueNoise2D(x + phase * 0.37, y - phase * 0.29);
}
function potentialRidingFull(x: number, y: number, phase: number): number {
  const dx = phase * 0.37;
  const dy = -phase * 0.29;
  let v = valueNoise2D(x + dx, y + dy) * 0.5;
  v += valueNoise2D(x * 2.03 - dx * 1.7, y * 2.03 - dy * 1.7) * 0.25;
  v += valueNoise2D(x * 4.11 + dx * 2.3, y * 4.11 + dy * 2.3) * 0.125;
  return v;
}

// --- evolving: the production formula, built from noise.ts's own JS port (the single source —
// vgPotentialJS/vgValueNoise3PeriodicJS) rather than re-derived here. ---
const [MAIN_OCTAVE] = MEDIUM_TIME_OCTAVES;
const MAIN_OCTAVE_PERIOD = mediumOctavePeriod(MAIN_OCTAVE.rate);
function mainOctaveEvolving(x: number, y: number, phase: number): number {
  return vgValueNoise3PeriodicJS(
    x * MAIN_OCTAVE.scale,
    y * MAIN_OCTAVE.scale,
    phase * MAIN_OCTAVE.rate + MAIN_OCTAVE.offset,
    MAIN_OCTAVE_PERIOD,
  );
}

type Grid = { cols: number; rows: number; data: number[] };
type Potential = (x: number, y: number, phase: number) => number;

function sampleGrid(potential: Potential, tSeconds: number): Grid {
  const phase = tSeconds * CURL_SPEED;
  const data: number[] = new Array(COLS * ROWS);
  for (let gy = 0; gy < ROWS; gy += 1) {
    for (let gx = 0; gx < COLS; gx += 1) {
      data[gy * COLS + gx] = potential(gx * CURL_FREQ, gy * CURL_FREQ, phase);
    }
  }
  return { cols: COLS, rows: ROWS, data };
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n === 0) return 0;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 1e-9 ? cov / denom : 0;
}

/** Best correlation over shifts (dx, dy) in cells, on the overlap (no wraparound — this test's
 *  domain isn't periodic). A high best-shift correlation means A translated is almost B. */
function bestShiftCorrelation(gridA: Grid, gridB: Grid): number {
  const { cols, rows, data: A } = gridA;
  const { data: B } = gridB;
  const searchX = Math.max(1, Math.round(cols * SEARCH_FRAC));
  const searchY = Math.max(1, Math.round(rows * SEARCH_FRAC));
  const totalCells = cols * rows;
  let best = -Infinity;
  for (let dy = -searchY; dy <= searchY; dy += 1) {
    for (let dx = -searchX; dx <= searchX; dx += 1) {
      const x0 = Math.max(0, dx);
      const x1 = Math.min(cols, cols + dx);
      const y0 = Math.max(0, dy);
      const y1 = Math.min(rows, rows + dy);
      const overlapCells = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      if (overlapCells < totalCells * MIN_OVERLAP_FRAC) continue;
      const a: number[] = new Array(overlapCells);
      const b: number[] = new Array(overlapCells);
      let k = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          a[k] = A[(y - dy) * cols + (x - dx)];
          b[k] = B[y * cols + x];
          k += 1;
        }
      }
      best = Math.max(best, correlation(a, b));
    }
  }
  return best;
}

/** Grid A well away from phase 0 (so this isn't a special case), grid B one DELTA_S later. */
function bestShiftAt(potential: Potential): number {
  const gridA = sampleGrid(potential, 40);
  const gridB = sampleGrid(potential, 40 + DELTA_S);
  return bestShiftCorrelation(gridA, gridB);
}

describe('the noise field evolves; it does not travel', () => {
  it('the production main octave stays under the riding/evolving threshold', () => {
    expect(bestShiftAt(mainOctaveEvolving)).toBeLessThanOrEqual(CORRELATION_LIMIT);
  });

  it('canary: a domain-shift ("riding") main octave clears the same threshold', () => {
    const riding = bestShiftAt(mainOctaveRiding);
    // Comfortably above the limit, not just barely: riding is close to a rigid translation, so
    // its best-shift correlation should read close to 1, not merely "on the wrong side of 0.75".
    expect(riding).toBeGreaterThan(CORRELATION_LIMIT);
    expect(riding).toBeGreaterThan(0.99);
  });

  it('for context: the full fbm sum discriminates less sharply than the main octave alone', () => {
    // Not gated on (see the header comment on why) — just proof this test isn't accidentally
    // relying on a metric that would have passed either formula.
    expect(bestShiftAt(potentialRidingFull)).toBeGreaterThan(bestShiftAt(vgPotentialJS));
  });
});

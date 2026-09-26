import { describe, expect, it } from 'vitest';
import {
  applyTrackDepth,
  createMediumDynamics,
  MEDIUM_DRIFT_TURBULENCE,
  MEDIUM_MIN_EMISSION_INTERVAL,
  MEDIUM_PLAYING_TURBULENCE_RANGE,
  MEDIUM_TRACK_PRESETS,
  type VireUIKitMediumDynamicsInput,
  type VireUIKitMediumEmission,
} from '../medium';

const SOURCE: readonly [number, number] = [0.5, 0.5];
const DT = 1 / 60;

function run(
  frames: number,
  overrides: Partial<VireUIKitMediumDynamicsInput> = {},
): { emissions: VireUIKitMediumEmission[]; turbulenceHistory: number[] } {
  const dyn = createMediumDynamics();
  const emissions: VireUIKitMediumEmission[] = [];
  const turbulenceHistory: number[] = [];
  let position = overrides.positionSeconds ?? 0;
  for (let i = 0; i < frames; i += 1) {
    const frame = dyn.step({
      state: 'playing',
      bpm: 128,
      amplitude: 0.5,
      sourcePoint: SOURCE,
      dt: DT,
      ...overrides,
      positionSeconds: position,
    });
    turbulenceHistory.push(frame.turbulence);
    emissions.push(...frame.emissions);
    position += DT;
  }
  return { emissions, turbulenceHistory };
}

describe('createMediumDynamics: emission scheduling', () => {
  it('is deterministic: two independent runs with the same inputs give the same result', () => {
    const a = run(600);
    const b = run(600);
    expect(a.emissions.map((e) => [e.seed, e.angle, e.depth])).toEqual(
      b.emissions.map((e) => [e.seed, e.angle, e.depth]),
    );
  });

  it('WCAG 2.3.1: an emergency floor between emissions holds even at an absurdly high BPM', () => {
    const dyn = createMediumDynamics();
    let position = 0;
    let simTime = 0;
    let lastAt = -Infinity;
    for (let i = 0; i < 6000; i += 1) {
      const frame = dyn.step({
        state: 'playing',
        bpm: 1000,
        amplitude: 1,
        sourcePoint: SOURCE,
        dt: DT,
        positionSeconds: position,
      });
      simTime += DT;
      position += DT;
      if (frame.emissions.length > 0) {
        if (Number.isFinite(lastAt)) {
          expect(simTime - lastAt).toBeGreaterThanOrEqual(MEDIUM_MIN_EMISSION_INTERVAL - 1e-9);
        }
        lastAt = simTime;
      }
    }
  });

  it('while playing, only emits alpha starbursts from the fixed cover-art point', () => {
    const { emissions } = run(1200);
    expect(emissions.length).toBeGreaterThan(0);
    for (const e of emissions) {
      expect(e.source).toEqual(SOURCE);
      // Every playing-state emission is a ray of the alpha preset's own shape (length is untouched
      // by depth — only width/intensity are, see applyTrackDepth — but IS scaled per-ray, so this
      // checks the ceiling rather than exact equality).
      expect(e.raggedFrac).toBe(MEDIUM_TRACK_PRESETS.alpha.raggedFrac);
      expect(e.lengthFrac).toBeLessThanOrEqual(MEDIUM_TRACK_PRESETS.alpha.lengthFrac);
    }
  });

  it('a single eligible event stamps a starburst (many rays at once), not one ray', () => {
    // 20s at 128 BPM is ~10 emission-cadence bars (MEDIUM_EMISSION_BEATS=4); even with the
    // eligibility gate well under half of those firing, a one-ray-per-event scheme could not clear
    // this floor — only a multi-ray burst per event can.
    const { emissions } = run(1200);
    expect(emissions.length).toBeGreaterThan(20);
  });

  it('paused/stopped never produce new tracks', () => {
    for (const state of ['paused', 'stopped'] as const) {
      const { emissions } = run(1200, { state });
      expect(emissions).toHaveLength(0);
    }
  });

  it('idle produces rare background-radiation tracks (electron/muon) from a random point, never alpha', () => {
    const dyn = createMediumDynamics();
    const emissions: VireUIKitMediumEmission[] = [];
    let position = 0;
    // The idle branch never reads bpm/positionSeconds, only accumulated dt — a coarse 1s step
    // simulates ~50 minutes (well over 80 average intervals) in 3000 iterations instead of 180000,
    // enough occurrences that both background kinds are certain to show up at least once.
    const IDLE_DT = 1;
    for (let i = 0; i < 3000; i += 1) {
      const frame = dyn.step({
        state: 'idle',
        bpm: 128,
        amplitude: 0,
        sourcePoint: SOURCE,
        dt: IDLE_DT,
        positionSeconds: position,
      });
      emissions.push(...frame.emissions);
      position += IDLE_DT;
    }
    expect(emissions.length).toBeGreaterThan(0);
    for (const e of emissions) {
      expect(e.source).not.toEqual(SOURCE);
      // Never the alpha shape (length is untouched by depth, so the preset's own value identifies
      // it): background radiation is electron or muon, the driven decay source is the only alpha.
      expect(e.lengthFrac).not.toBe(MEDIUM_TRACK_PRESETS.alpha.lengthFrac);
    }
    const electronCount = emissions.filter((e) => e.lengthFrac === MEDIUM_TRACK_PRESETS.electron.lengthFrac).length;
    const muonCount = emissions.filter((e) => e.lengthFrac === MEDIUM_TRACK_PRESETS.muon.lengthFrac).length;
    expect(electronCount).toBeGreaterThan(0);
    expect(muonCount).toBeGreaterThan(0);
    expect(electronCount + muonCount).toBe(emissions.length);
  });
});

describe('createMediumDynamics: turbulence', () => {
  it('while playing, converges into a range that depends on amplitude', () => {
    const low = run(2000, { amplitude: 0 }).turbulenceHistory.at(-1)!;
    const high = run(2000, { amplitude: 1 }).turbulenceHistory.at(-1)!;
    expect(low).toBeCloseTo(MEDIUM_PLAYING_TURBULENCE_RANGE[0], 1);
    expect(high).toBeCloseTo(MEDIUM_PLAYING_TURBULENCE_RANGE[1], 1);
  });

  it('paused/stopped/idle cool down to the baseline drift', () => {
    for (const state of ['paused', 'stopped', 'idle'] as const) {
      const last = run(2000, { state, amplitude: 1 }).turbulenceHistory.at(-1)!;
      expect(last).toBeCloseTo(MEDIUM_DRIFT_TURBULENCE, 2);
    }
  });
});

describe('track presets', () => {
  it('alpha is thick, short and straight; electron is thin, longer and ragged', () => {
    const { alpha, electron } = MEDIUM_TRACK_PRESETS;
    expect(alpha.raggedFrac).toBe(0);
    expect(electron.raggedFrac).toBeGreaterThan(0);
    expect(electron.lengthFrac).toBeGreaterThan(alpha.lengthFrac);
    expect(alpha.tailWidthFrac).toBeGreaterThan(electron.tailWidthFrac);
  });

  it('muon is long, straight and thin — a cosmic ray crossing the whole chamber', () => {
    const { alpha, electron, muon } = MEDIUM_TRACK_PRESETS;
    expect(muon.raggedFrac).toBe(0);
    expect(muon.lengthFrac).toBeGreaterThan(alpha.lengthFrac);
    expect(muon.lengthFrac).toBeGreaterThan(electron.lengthFrac);
    expect(muon.headWidthFrac).toBeLessThan(alpha.headWidthFrac);
  });

  it('every preset has a dimmer, wider tail than head — a sharp head, a settled tail', () => {
    for (const preset of Object.values(MEDIUM_TRACK_PRESETS)) {
      expect(preset.tailDim).toBeLessThan(1);
      expect(preset.tailWidthFrac).toBeGreaterThan(preset.headWidthFrac);
      expect(preset.settleFrac).toBeGreaterThanOrEqual(0);
    }
  });

  it('background radiation (electron, muon) is dimmer than an alpha burst ray — no driven source', () => {
    const { alpha, electron, muon } = MEDIUM_TRACK_PRESETS;
    expect(electron.intensity).toBeLessThan(alpha.intensity);
    expect(muon.intensity).toBeLessThan(alpha.intensity);
  });
});

describe('track depth: which plane a track lives on', () => {
  it('every emission carries a depth in 0..1, deterministic from its seed', () => {
    const a = run(600);
    const b = run(600);
    for (const e of a.emissions) {
      expect(e.depth).toBeGreaterThanOrEqual(0);
      expect(e.depth).toBeLessThanOrEqual(1);
    }
    expect(a.emissions.map((e) => e.depth)).toEqual(b.emissions.map((e) => e.depth));
  });

  it('applyTrackDepth: a far track (depth 0) is thinner and dimmer than a near one (depth 1), same preset', () => {
    const preset = MEDIUM_TRACK_PRESETS.alpha;
    const far = applyTrackDepth(preset, 0);
    const near = applyTrackDepth(preset, 1);
    expect(far.headWidthFrac).toBeLessThan(near.headWidthFrac);
    expect(far.tailWidthFrac).toBeLessThan(near.tailWidthFrac);
    expect(far.intensity).toBeLessThan(near.intensity);
    // Everything else about the preset (length, ragged path, tail dimming, settle) is untouched —
    // depth scales geometry and brightness only.
    expect(far.lengthFrac).toBe(preset.lengthFrac);
    expect(far.raggedFrac).toBe(preset.raggedFrac);
  });

  it('applyTrackDepth: depth 1 is slightly LARGER than the base preset — near depth of field, not merely full-size', () => {
    const preset = MEDIUM_TRACK_PRESETS.electron;
    const near = applyTrackDepth(preset, 1);
    expect(near.headWidthFrac).toBeGreaterThan(preset.headWidthFrac);
    expect(near.tailWidthFrac).toBeGreaterThan(preset.tailWidthFrac);
    // Intensity's own range still tops out at 1 — only width (and, by construction, the same
    // Gaussian stamp's edge softness) grows for a near track, not brightness.
    expect(near.intensity).toBe(preset.intensity);
  });
});

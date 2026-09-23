import { describe, expect, it } from 'vitest';
import {
  createMediumDynamics,
  MEDIUM_DRIFT_TURBULENCE,
  MEDIUM_MIN_EMISSION_INTERVAL,
  MEDIUM_PLAYING_TURBULENCE_RANGE,
  MEDIUM_TRACK_DEPTH_INTENSITY_RANGE,
  MEDIUM_TRACK_DEPTH_WIDTH_RANGE,
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
    expect(a.emissions.map((e) => [e.seed, e.angle, e.channel])).toEqual(
      b.emissions.map((e) => [e.seed, e.angle, e.channel]),
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

  it('while playing, only emits alpha/beta from the fixed cover-art point', () => {
    const { emissions } = run(1200);
    expect(emissions.length).toBeGreaterThan(0);
    for (const e of emissions) {
      expect(e.source).toEqual(SOURCE);
    }
  });

  it('paused/stopped never produce new tracks', () => {
    for (const state of ['paused', 'stopped'] as const) {
      const { emissions } = run(1200, { state });
      expect(emissions).toHaveLength(0);
    }
  });

  it('idle produces rare natural tracks from a random point, not from cover art', () => {
    const dyn = createMediumDynamics();
    const emissions: VireUIKitMediumEmission[] = [];
    let position = 0;
    // ~40s — comfortably longer than the average interval between natural tracks.
    for (let i = 0; i < 2400; i += 1) {
      const frame = dyn.step({
        state: 'idle',
        bpm: 128,
        amplitude: 0,
        sourcePoint: SOURCE,
        dt: DT,
        positionSeconds: position,
      });
      emissions.push(...frame.emissions);
      position += DT;
    }
    expect(emissions.length).toBeGreaterThan(0);
    for (const e of emissions) {
      expect(e.source).not.toEqual(SOURCE);
    }
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
  it('alpha is thick, short and straight; beta is thin, long and ragged', () => {
    const alpha = MEDIUM_TRACK_PRESETS.alpha;
    const beta = MEDIUM_TRACK_PRESETS.beta;
    expect(alpha.raggedFrac).toBe(0);
    expect(beta.raggedFrac).toBeGreaterThan(0);
    expect(beta.lengthFrac).toBeGreaterThan(alpha.lengthFrac);
    expect(alpha.tailWidthFrac).toBeGreaterThan(beta.tailWidthFrac);
  });

  it('every preset has a dimmer, wider tail than head — a sharp head, a settled tail', () => {
    for (const preset of Object.values(MEDIUM_TRACK_PRESETS)) {
      expect(preset.tailDim).toBeLessThan(1);
      expect(preset.tailWidthFrac).toBeGreaterThan(preset.headWidthFrac);
      expect(preset.settleFrac).toBeGreaterThanOrEqual(0);
    }
  });

  it('natural is dimmer than alpha and beta — a solitary background track, not a full one', () => {
    const { alpha, beta, natural } = MEDIUM_TRACK_PRESETS;
    expect(natural.intensity).toBeLessThan(alpha.intensity);
    expect(natural.intensity).toBeLessThan(beta.intensity);
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

  it('depth is decorrelated from channel and angle: not every far track shares a channel', () => {
    // Regression guard for a shared-multiplier mistake: if depth's hash reused the channel or angle
    // multiplier, every emission with the same depth bucket would also share a channel or angle.
    const { emissions } = run(2400);
    const farRed = emissions.filter((e) => e.depth < 0.5 && e.channel[0] === 1);
    const farOther = emissions.filter((e) => e.depth < 0.5 && e.channel[0] !== 1);
    expect(farOther.length).toBeGreaterThan(0);
    expect(farRed.length).toBeGreaterThan(0);
  });

  it('a far track (depth near 0) is thinner and dimmer than the same preset at depth near 1', () => {
    const preset = MEDIUM_TRACK_PRESETS.alpha;
    const far = MEDIUM_TRACK_DEPTH_WIDTH_RANGE[0];
    const near = MEDIUM_TRACK_DEPTH_WIDTH_RANGE[1];
    expect(far).toBeLessThan(near);
    const farIntensity = MEDIUM_TRACK_DEPTH_INTENSITY_RANGE[0];
    const nearIntensity = MEDIUM_TRACK_DEPTH_INTENSITY_RANGE[1];
    expect(farIntensity).toBeLessThan(nearIntensity);
    // The ranges apply multiplicatively to a preset's own geometry — confirm they stay within it
    // rather than ever widening a track past its preset's own near-depth (scale 1) size.
    expect(preset.headWidthFrac * near).toBeCloseTo(preset.headWidthFrac, 6);
  });
});

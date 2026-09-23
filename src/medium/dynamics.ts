import {
  MEDIUM_DRIFT_TURBULENCE,
  MEDIUM_EMISSION_BEATS,
  MEDIUM_EMISSION_PROBABILITY,
  MEDIUM_MIN_EMISSION_INTERVAL,
  MEDIUM_NATURAL_INTERVAL,
  MEDIUM_NATURAL_JITTER,
  MEDIUM_SENSITIVE_BOTTOM,
  MEDIUM_SENSITIVE_TOP,
  MEDIUM_PLAYING_TURBULENCE_RANGE,
  MEDIUM_TRACK_DEPTH_INTENSITY_RANGE,
  MEDIUM_TRACK_DEPTH_WIDTH_RANGE,
  MEDIUM_TRACK_PRESETS,
  MEDIUM_TURBULENCE_TAU,
  type VireUIKitMediumTrackPreset,
} from './params';

// Rest-state playback: a chamber with nothing playing isn't empty — each neutral state has its
// own behavior rather than one shared "nothing is happening".
export type VireUIKitMediumPlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

export type VireUIKitMediumTrackPresetName = keyof typeof MEDIUM_TRACK_PRESETS;

/** The fully resolved geometry of one track stamp — the platform layer (`web/medium.ts`)
 *  translates fractions into simulation-grid pixels and binds the uniforms, deciding nothing else:
 *  which preset, where, and how bright is entirely this model's call. */
export type VireUIKitMediumEmission = VireUIKitMediumTrackPreset & {
  /** 0…1, a fraction of the grid on both axes — the source point (cover art while playing;
   *  wherever it happens to land at rest). */
  source: readonly [number, number];
  /** Radians, direction from the source to the head. */
  angle: number;
  seed: number;
  channel: readonly [number, number, number];
  /** 0 (farthest) … 1 (nearest), random within the full range and deterministic from `seed` — which
   *  plane the track reads as living on. Already folded into this emission's own `headWidthFrac`/
   *  `tailWidthFrac`/`intensity` below (see `buildEmission`); carried here too so a caller inspecting
   *  an emission can see why. */
  depth: number;
};

export type VireUIKitMediumDynamicsInput = {
  state: VireUIKitMediumPlaybackState;
  /** Beats per minute of the active track; unread in states with no track. */
  bpm: number;
  /** 0…1 — a continuous volume envelope (e.g. from precomputed waveform peaks), NOT the beat itself. */
  amplitude: number;
  /** Seconds, a deterministic playback position (not wall-clock time) — the emission cadence has
   *  to be derived from it rather than accumulating its own phase. */
  positionSeconds: number;
  /** 0…1 — the area of the active track's cover art that emission comes from while playing. */
  sourcePoint: readonly [number, number];
  dt: number;
};

export type VireUIKitMediumDynamicsFrame = {
  turbulence: number;
  emissions: readonly VireUIKitMediumEmission[];
};

export type VireUIKitMediumDynamics = {
  step(input: VireUIKitMediumDynamicsInput): VireUIKitMediumDynamicsFrame;
};

function hash01(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function channelFromSeed(seed: number): readonly [number, number, number] {
  const idx = Math.floor(hash01(seed * 1.37) * 3) % 3;
  return idx === 0 ? [1, 0, 0] : idx === 1 ? [0, 1, 0] : [0, 0, 1];
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/**
 * Scales a track preset's width and intensity by depth (0 far … 1 near) — separated from
 * `buildEmission` below and exported so depth's effect on a preset is directly testable with two
 * plain numbers, independent of how a specific emission's depth got hashed from its seed. At
 * depth=1 this returns the preset's own numbers unchanged (both ranges' upper bound is 1).
 */
export function applyTrackDepth(
  preset: VireUIKitMediumTrackPreset,
  depth: number,
): VireUIKitMediumTrackPreset {
  const widthScale = lerp(MEDIUM_TRACK_DEPTH_WIDTH_RANGE, depth);
  const intensityScale = lerp(MEDIUM_TRACK_DEPTH_INTENSITY_RANGE, depth);
  return {
    ...preset,
    headWidthFrac: preset.headWidthFrac * widthScale,
    tailWidthFrac: preset.tailWidthFrac * widthScale,
    intensity: preset.intensity * intensityScale,
  };
}

function buildEmission(
  presetName: VireUIKitMediumTrackPresetName,
  source: readonly [number, number],
  seed: number,
  intensityScale: number,
): VireUIKitMediumEmission {
  const preset = MEDIUM_TRACK_PRESETS[presetName];
  // Decorrelated from the channel (seed*1.37) and angle (seed*7.31) hashes below, so a track's
  // depth doesn't covary with its color or direction.
  const depth = hash01(seed * 4.63);
  const depthApplied = applyTrackDepth(preset, depth);
  return {
    ...depthApplied,
    intensity: depthApplied.intensity * intensityScale,
    source,
    angle: hash01(seed * 7.31) * Math.PI * 2,
    seed,
    channel: channelFromSeed(seed),
    depth,
  };
}

/**
 * Stateful "playback dynamics" model: turbulence and emission scheduling per frame. Platform
 * neutral — the caller supplies the clock and the playback position (in a bench, that would be
 * its own render loop); it never reads `performance.now()` or the DOM itself.
 */
export function createMediumDynamics(): VireUIKitMediumDynamics {
  let turbulence = MEDIUM_DRIFT_TURBULENCE;
  let lastBar = -1;
  let idleClock = 0;
  let naturalIndex = 0;
  let nextNaturalAt = MEDIUM_NATURAL_INTERVAL * 0.5;
  let simTime = 0;
  let lastEmissionAt = -Infinity;

  function step(input: VireUIKitMediumDynamicsInput): VireUIKitMediumDynamicsFrame {
    const { state, bpm, amplitude, positionSeconds, sourcePoint, dt } = input;
    simTime += dt;
    const amp = Math.max(0, Math.min(1, amplitude));

    const target =
      state === 'playing'
        ? MEDIUM_PLAYING_TURBULENCE_RANGE[0] +
          (MEDIUM_PLAYING_TURBULENCE_RANGE[1] - MEDIUM_PLAYING_TURBULENCE_RANGE[0]) * amp
        : MEDIUM_DRIFT_TURBULENCE;
    turbulence += (target - turbulence) * (1 - Math.exp(-dt / MEDIUM_TURBULENCE_TAU));

    const emissions: VireUIKitMediumEmission[] = [];

    // `bar`/`idx` below become `u_seed`, a float32 uniform in emit-shader.ts — but unlike the
    // curl-noise phase (see MEDIUM_TIME_PERIOD in noise.ts), they don't need periodic treatment:
    // `bar` resets with `positionSeconds` on every new track (it counts beats within the CURRENT
    // track, not the session), and `idx` advances only once per natural-emission interval (tens of
    // seconds), reaching at most a few thousand over a multi-hour session — nowhere near where a
    // float32 hash input's precision would matter.
    if (state === 'playing' && bpm > 0) {
      const beats = (positionSeconds * bpm) / 60;
      const bar = Math.floor(beats / MEDIUM_EMISSION_BEATS);
      if (bar !== lastBar) {
        lastBar = bar;
        const eligible =
          hash01(bar * 0.618) < MEDIUM_EMISSION_PROBABILITY &&
          simTime - lastEmissionAt >= MEDIUM_MIN_EMISSION_INTERVAL;
        if (eligible) {
          lastEmissionAt = simTime;
          const presetName: VireUIKitMediumTrackPresetName = hash01(bar * 3.14) < 0.55 ? 'alpha' : 'beta';
          emissions.push(buildEmission(presetName, sourcePoint, bar, 0.6 + 0.4 * amp));
        }
      }
    } else if (state === 'idle') {
      idleClock += dt;
      if (idleClock >= nextNaturalAt) {
        const idx = naturalIndex;
        naturalIndex += 1;
        // There's no source at rest: this is background emission, and its location is random. The
        // sensitive layer bounds it vertically — above it a track simply wouldn't appear.
        const randomSource: readonly [number, number] = [
          hash01(idx * 2.1 + 0.5),
          MEDIUM_SENSITIVE_TOP + hash01(idx * 5.9 + 1.7) * (MEDIUM_SENSITIVE_BOTTOM - MEDIUM_SENSITIVE_TOP),
        ];
        emissions.push(buildEmission('natural', randomSource, idx, 1));
        nextNaturalAt = idleClock + MEDIUM_NATURAL_INTERVAL + hash01(idx * 1.7) * MEDIUM_NATURAL_JITTER;
      }
    }

    return { turbulence, emissions };
  }

  return { step };
}

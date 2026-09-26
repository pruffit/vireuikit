import {
  MEDIUM_ALPHA_BURST_RAYS,
  MEDIUM_ALPHA_RAY_LENGTH_SCALE,
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
 *  which preset, where, and how bright is entirely this model's call. Carries no color of its own
 *  (there is no `channel` field): a track is lit the same way as the mist around it
 *  (`MEDIUM_COMPOSITE_SHADER`), not tinted by which track it happens to be. */
export type VireUIKitMediumEmission = VireUIKitMediumTrackPreset & {
  /** 0…1, a fraction of the grid on both axes — the source point (cover art while playing;
   *  wherever it happens to land at rest). */
  source: readonly [number, number];
  /** Radians, direction from the source to the head. */
  angle: number;
  seed: number;
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

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/**
 * Scales a track preset's width and intensity by depth (0 far … 1 near) — separated from
 * `buildEmission` below and exported so depth's effect on a preset is directly testable with two
 * plain numbers, independent of how a specific emission's depth got hashed from its seed. At
 * depth=1 this returns the preset's OWN intensity unchanged but its width scaled by the width
 * range's own near end (`MEDIUM_TRACK_DEPTH_WIDTH_RANGE[1]`, now slightly above 1 — the nearest
 * tracks read a little larger and softer than the base preset, not merely "as sharp as it gets";
 * see that constant's own comment).
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

/**
 * Builds one resolved emission. `angleOverride`/`lengthScale` exist for an alpha burst (see
 * `step` below): each ray needs an explicit angle around the source rather than a fully random one,
 * and a per-ray length so the spray reads as organic rather than a wheel of identical spokes.
 */
function buildEmission(
  presetName: VireUIKitMediumTrackPresetName,
  source: readonly [number, number],
  seed: number,
  intensityScale: number,
  angleOverride?: number,
  lengthScale = 1,
): VireUIKitMediumEmission {
  const preset = MEDIUM_TRACK_PRESETS[presetName];
  // Decorrelated from the angle hash below, so a track's depth doesn't covary with its direction.
  const depth = hash01(seed * 4.63);
  const depthApplied = applyTrackDepth(preset, depth);
  return {
    ...depthApplied,
    lengthFrac: depthApplied.lengthFrac * lengthScale,
    intensity: depthApplied.intensity * intensityScale,
    source,
    angle: angleOverride ?? hash01(seed * 7.31) * Math.PI * 2,
    seed,
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
          // The playing source emits alpha starbursts, not a single ray (real alpha-decay footage
          // sprays a dozen or so short thick tracks from one point at once — see
          // MEDIUM_TRACK_PRESETS.alpha's own comment for why the preset itself stays a lone ray).
          const rayCount = Math.round(lerp(MEDIUM_ALPHA_BURST_RAYS, hash01(bar * 9.17)));
          for (let i = 0; i < rayCount; i += 1) {
            const raySeed = bar + (i + 1) * 0.0137;
            const angle = ((i + hash01(raySeed * 5.23)) / rayCount) * Math.PI * 2;
            const lengthScale = lerp(MEDIUM_ALPHA_RAY_LENGTH_SCALE, hash01(raySeed * 2.91));
            emissions.push(
              buildEmission('alpha', sourcePoint, raySeed, 0.6 + 0.4 * amp, angle, lengthScale),
            );
          }
        }
      }
    } else if (state === 'idle') {
      idleClock += dt;
      if (idleClock >= nextNaturalAt) {
        const idx = naturalIndex;
        naturalIndex += 1;
        // There's no source at rest: this is background radiation, and its location is random. The
        // sensitive layer bounds it vertically — above it a track simply wouldn't appear. Rare
        // muons (straight, chamber-crossing) and electrons (thin, wiggly) — never alpha, which
        // belongs to a driven decay source, not the calm state.
        const randomSource: readonly [number, number] = [
          hash01(idx * 2.1 + 0.5),
          MEDIUM_SENSITIVE_TOP + hash01(idx * 5.9 + 1.7) * (MEDIUM_SENSITIVE_BOTTOM - MEDIUM_SENSITIVE_TOP),
        ];
        const presetName: VireUIKitMediumTrackPresetName = hash01(idx * 3.14) < 0.5 ? 'electron' : 'muon';
        emissions.push(buildEmission(presetName, randomSource, idx, 1));
        nextNaturalAt = idleClock + MEDIUM_NATURAL_INTERVAL + hash01(idx * 1.7) * MEDIUM_NATURAL_JITTER;
      }
    }

    return { turbulence, emissions };
  }

  return { step };
}

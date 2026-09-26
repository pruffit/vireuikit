// The crisp, screen-space track layer's CPU half: a live-track list fed by the same emissions the
// grid stamp (`emit-shader.ts`) already receives. Pure and platform-neutral in everything but its
// folder — no GL here, only the fraction-space bookkeeping `web/track-layer-gl.ts` turns into an
// instanced draw. Kept apart from that file so the aging/drift/fade math is directly testable
// without a WebGL2 context, the same reasoning `dynamics.ts` already follows for emission scheduling.
import {
  MEDIUM_TRACK_LAYER_CURL_PUSH,
  MEDIUM_TRACK_LAYER_FADE_GAMMA,
  MEDIUM_TRACK_LAYER_GRAVITY_SAG,
  MEDIUM_TRACK_LAYER_LIFE_SECONDS,
  MEDIUM_TRACK_LAYER_MAX_TRACKS,
  MEDIUM_TRACK_LAYER_WIDEN_GAIN,
  type VireUIKitMediumEmission,
} from '../medium';
import { vgPotentialJS } from '../medium/noise';

/** One track alive in the crisp layer: the ORIGINAL emission (never mutated — every derived
 *  quantity below is a pure function of it plus age) and the bookkeeping this layer adds on top. */
export type VireUIKitLiveTrack = {
  emission: VireUIKitMediumEmission;
  /** Seconds since this track was stamped. */
  age: number;
  /** Accumulated drift, as a fraction of `min(contentWidth, contentHeight)` — added to BOTH the
   *  source and the head (a rigid translation of the whole track, not a bend) when the GPU buffer
   *  is built. Same normalization as every other length-like quantity on an emission
   *  (`lengthFrac`, `settleFrac`, …), so it doesn't depend on the frame's own resolution. */
  driftX: number;
  driftY: number;
};

/** `(1 - age/life) ** gamma`, clamped and reaching exactly 0 at `age >= life` — a track fades out
 *  smoothly enough that being dropped from the list (see `MEDIUM_TRACK_LAYER_MAX_TRACKS`/the life
 *  table) never pops. Exported and pure so the curve itself is directly testable. */
export function trackLayerFade(age: number, life: number): number {
  if (life <= 0) return 0;
  const t = Math.min(Math.max(age / life, 0), 1);
  return (1 - t) ** MEDIUM_TRACK_LAYER_FADE_GAMMA;
}

/** How much a track's own width has grown by `age`, as a multiplier on its birth width — "wider ...
 *  at ~1.5s" (the brief's own reference point). Grows monotonically to `1 + WIDEN_GAIN` by the end
 *  of the track's life, then holds (a track past its life is dropped before this matters). */
export function trackLayerWidthMul(age: number, life: number): number {
  const t = life > 0 ? Math.min(Math.max(age / life, 0), 1) : 1;
  return 1 + MEDIUM_TRACK_LAYER_WIDEN_GAIN * t;
}

/** JS port of `vgCurlVelocity` (noise.ts) — central difference of `vgPotentialJS`, same epsilon.
 *  `px`/`py` are an arbitrary spatial coordinate, not grid-px: this layer has no grid of its own
 *  (see the file header), so the push only needs to vary smoothly across the frame, not match the
 *  simulated gas sample-for-sample — a stylistic nudge, not a physically synced one. */
function curlVelocityJS(px: number, py: number, phase: number): readonly [number, number] {
  const e = 0.6;
  const px1 = vgPotentialJS(px + e, py, phase);
  const px0 = vgPotentialJS(px - e, py, phase);
  const py1 = vgPotentialJS(px, py + e, phase);
  const py0 = vgPotentialJS(px, py - e, phase);
  return [(py1 - py0) / (2 * e), -(px1 - px0) / (2 * e)];
}

/** Arbitrary spatial scale for sampling the curl potential (see `curlVelocityJS`'s own comment) —
 *  independent of any real grid size, just large enough that the field varies noticeably across
 *  the frame instead of reading as one near-constant push everywhere. */
const CURL_SAMPLE_SCALE = 40;

/** Curl-noise's own time axis for this layer — a small, self-contained accumulator (NOT the grid
 *  runtime's `phase` in `web/medium.ts`): threading that state across modules for a purely
 *  decorative nudge would couple two otherwise-independent systems for no visible benefit. Wrapped
 *  loosely (float32 headroom, not an exact lattice period — this phase never needs to match the
 *  grid's own wrap, see `MEDIUM_TIME_PERIOD`'s comment for why THAT one does). */
const PHASE_WRAP = 10_000;

export type VireUIKitTrackLayer = {
  /**
   * Ages and drifts every live track by `dt`, drops anything past its own life (per-kind,
   * `MEDIUM_TRACK_LAYER_LIFE_SECONDS`), appends `emissions` as fresh tracks (age 0), and caps the
   * list at `MEDIUM_TRACK_LAYER_MAX_TRACKS` (oldest inserted out first). Returns the live list —
   * the same array identity is not guaranteed across calls, but tracks within it keep their own
   * identity as long as they stay alive (a caller building a per-frame GPU buffer can rely on that
   * for anything it might want to cache per track, though nothing here currently does).
   */
  step(dt: number, emissions: readonly VireUIKitMediumEmission[]): readonly VireUIKitLiveTrack[];
};

export function createTrackLayer(): VireUIKitTrackLayer {
  let tracks: VireUIKitLiveTrack[] = [];
  let phase = 0;

  function step(dt: number, emissions: readonly VireUIKitMediumEmission[]): readonly VireUIKitLiveTrack[] {
    phase = (phase + dt) % PHASE_WRAP;

    const next: VireUIKitLiveTrack[] = [];
    for (const track of tracks) {
      const life = MEDIUM_TRACK_LAYER_LIFE_SECONDS[track.emission.kind];
      const age = track.age + dt;
      if (age >= life) continue;

      const midX = track.emission.source[0] + Math.cos(track.emission.angle) * track.emission.lengthFrac * 0.5;
      const midY = track.emission.source[1] + Math.sin(track.emission.angle) * track.emission.lengthFrac * 0.5;
      const [curlX, curlY] = curlVelocityJS(midX * CURL_SAMPLE_SCALE, midY * CURL_SAMPLE_SCALE, phase);

      next.push({
        emission: track.emission,
        age,
        driftX: track.driftX + curlX * MEDIUM_TRACK_LAYER_CURL_PUSH * dt,
        driftY: track.driftY + (curlY * MEDIUM_TRACK_LAYER_CURL_PUSH - MEDIUM_TRACK_LAYER_GRAVITY_SAG) * dt,
      });
    }
    for (const emission of emissions) {
      next.push({ emission, age: 0, driftX: 0, driftY: 0 });
    }

    tracks = next.length > MEDIUM_TRACK_LAYER_MAX_TRACKS
      ? next.slice(next.length - MEDIUM_TRACK_LAYER_MAX_TRACKS)
      : next;
    return tracks;
  }

  return { step };
}

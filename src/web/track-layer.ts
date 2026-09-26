// The crisp, screen-space track layer's CPU half: a live-track list fed by the same emissions the
// grid stamp (`emit-shader.ts`) receives. No GL here, so the aging/drift/fade math is testable
// without a WebGL2 context; `web/track-layer-gl.ts` turns the list into an instanced draw.
import {
  MEDIUM_TRACK_LAYER_BURST_ACCENT,
  MEDIUM_TRACK_LAYER_BURST_SPREAD,
  MEDIUM_TRACK_LAYER_CURL_PUSH,
  MEDIUM_TRACK_LAYER_FADE_GAMMA,
  MEDIUM_TRACK_LAYER_GRAVITY_SAG,
  MEDIUM_TRACK_LAYER_LIFE_SECONDS,
  MEDIUM_TRACK_LAYER_MAX_TRACKS,
  type VireUIKitMediumEmission,
} from '../medium';
import { vgPotentialJS } from '../medium/noise';

/** One track alive in the crisp layer: the original emission (never mutated) plus its age and
 *  drift. */
export type VireUIKitLiveTrack = {
  emission: VireUIKitMediumEmission;
  /** Seconds since the track appeared. Negative while a burst ray is still waiting for its turn. */
  age: number;
  /** Accumulated rigid drift, as a fraction of `min(contentWidth, contentHeight)`. */
  driftX: number;
  driftY: number;
};

/** `(1 - age/life) ** gamma`, reaching exactly 0 at `age >= life`, so dropping a track never pops. */
export function trackLayerFade(age: number, life: number): number {
  if (life <= 0) return 0;
  const t = Math.min(Math.max(age / life, 0), 1);
  return (1 - t) ** MEDIUM_TRACK_LAYER_FADE_GAMMA;
}

/** Diffusion: droplets spread sideways as `sqrt(age)`, the way an ink line blurs. */
export function trackLayerSigmaMul(age: number, broaden: number): number {
  return Math.sqrt(1 + broaden * Math.max(age, 0));
}

function hash01(n: number): number {
  const s = Math.sin(n * 91.3458) * 47453.5453;
  return s - Math.floor(s);
}

function curlVelocityJS(px: number, py: number, phase: number): readonly [number, number] {
  const e = 0.6;
  const px1 = vgPotentialJS(px + e, py, phase);
  const px0 = vgPotentialJS(px - e, py, phase);
  const py1 = vgPotentialJS(px, py + e, phase);
  const py0 = vgPotentialJS(px, py - e, phase);
  return [(py1 - py0) / (2 * e), -(px1 - px0) / (2 * e)];
}

const CURL_SAMPLE_SCALE = 40;
const PHASE_WRAP = 10_000;

export type VireUIKitTrackLayer = {
  /**
   * Ages and drifts every live track by `dt`, drops anything past its own life, appends
   * `emissions` as fresh tracks and caps the list at `MEDIUM_TRACK_LAYER_MAX_TRACKS` (oldest out).
   * Alpha rays arriving in one call are one burst: the first few appear at once, the rest are born
   * over `MEDIUM_TRACK_LAYER_BURST_SPREAD` seconds.
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
      if (age <= 0) {
        next.push({ ...track, age });
        continue;
      }

      const midX = track.emission.source[0] + Math.cos(track.emission.angle) * track.emission.lengthFrac * 0.5;
      const midY = track.emission.source[1] + Math.sin(track.emission.angle) * track.emission.lengthFrac * 0.5;
      const [curlX, curlY] = curlVelocityJS(midX * CURL_SAMPLE_SCALE, midY * CURL_SAMPLE_SCALE, phase);
      const activeDt = Math.min(dt, age);

      next.push({
        emission: track.emission,
        age,
        driftX: track.driftX + curlX * MEDIUM_TRACK_LAYER_CURL_PUSH * activeDt,
        driftY: track.driftY + (curlY * MEDIUM_TRACK_LAYER_CURL_PUSH - MEDIUM_TRACK_LAYER_GRAVITY_SAG) * activeDt,
      });
    }
    let burstIndex = 0;
    for (const emission of emissions) {
      let age = 0;
      if (emission.kind === 'alpha') {
        if (burstIndex >= MEDIUM_TRACK_LAYER_BURST_ACCENT) {
          age = -hash01(emission.seed * 3.17 + burstIndex) * MEDIUM_TRACK_LAYER_BURST_SPREAD;
        }
        burstIndex += 1;
      }
      next.push({ emission, age, driftX: 0, driftY: 0 });
    }

    tracks = next.length > MEDIUM_TRACK_LAYER_MAX_TRACKS
      ? next.slice(next.length - MEDIUM_TRACK_LAYER_MAX_TRACKS)
      : next;
    return tracks;
  }

  return { step };
}

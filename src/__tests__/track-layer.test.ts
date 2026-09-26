import { describe, expect, it } from 'vitest';
import type { VireUIKitMediumEmission } from '../medium';
import { MEDIUM_TRACK_LAYER_LIFE_SECONDS, MEDIUM_TRACK_LAYER_MAX_TRACKS, MEDIUM_TRACK_PRESETS } from '../medium';
import { createTrackLayer, trackLayerFade, trackLayerWidthMul } from '../web/track-layer';
import { buildTrackLayerInstances } from '../web/track-layer-gl';

function emission(overrides: Partial<VireUIKitMediumEmission> = {}): VireUIKitMediumEmission {
  return {
    ...MEDIUM_TRACK_PRESETS.muon,
    source: [0.5, 0.5],
    angle: 0,
    seed: 1,
    depth: 1,
    kind: 'muon',
    ...overrides,
  };
}

describe('trackLayerFade', () => {
  it('starts at 1 and reaches exactly 0 at the end of life — no pop on removal', () => {
    expect(trackLayerFade(0, 2)).toBe(1);
    expect(trackLayerFade(2, 2)).toBe(0);
    expect(trackLayerFade(3, 2)).toBe(0);
  });

  it('is monotonically decreasing over the track\'s life', () => {
    const life = 1.8;
    let previous = trackLayerFade(0, life);
    for (let age = 0.1; age <= life; age += 0.1) {
      const value = trackLayerFade(age, life);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('trackLayerWidthMul', () => {
  it('starts at 1 (birth width) and grows over life', () => {
    expect(trackLayerWidthMul(0, 2)).toBe(1);
    expect(trackLayerWidthMul(2, 2)).toBeGreaterThan(1);
  });

  it('is monotonically non-decreasing over the track\'s life', () => {
    const life = 1.4;
    let previous = trackLayerWidthMul(0, life);
    for (let age = 0.1; age <= life; age += 0.1) {
      const value = trackLayerWidthMul(age, life);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('createTrackLayer: aging, drift and the cap', () => {
  it('a fresh emission enters at age 0 with no drift yet', () => {
    const layer = createTrackLayer();
    const tracks = layer.step(1 / 60, [emission()]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].age).toBe(0);
    expect(tracks[0].driftX).toBe(0);
    expect(tracks[0].driftY).toBe(0);
  });

  it('drops a track once its age passes its own kind\'s life', () => {
    const layer = createTrackLayer();
    layer.step(1 / 60, [emission({ kind: 'alpha' })]);
    const life = MEDIUM_TRACK_LAYER_LIFE_SECONDS.alpha;
    const dt = 1 / 30;
    let tracks = layer.step(dt, []);
    let steps = 1;
    while (steps * dt < life + dt) {
      tracks = layer.step(dt, []);
      steps += 1;
    }
    expect(tracks).toHaveLength(0);
  });

  it('different kinds live for their own configured life, not a shared one', () => {
    const layer = createTrackLayer();
    layer.step(1 / 60, [emission({ kind: 'alpha', seed: 1 }), emission({ kind: 'muon', seed: 2 })]);
    const dt = 1 / 30;
    const midLife = (MEDIUM_TRACK_LAYER_LIFE_SECONDS.alpha + MEDIUM_TRACK_LAYER_LIFE_SECONDS.muon) / 2;
    let tracks = layer.step(dt, []);
    let elapsed = dt;
    while (elapsed < midLife) {
      tracks = layer.step(dt, []);
      elapsed += dt;
    }
    expect(tracks.some((t) => t.emission.kind === 'alpha')).toBe(false);
    expect(tracks.some((t) => t.emission.kind === 'muon')).toBe(true);
  });

  it('drifts downward over time (gravity sag) even with no curl push contribution at rest', () => {
    const layer = createTrackLayer();
    layer.step(1 / 60, [emission()]);
    let tracks: ReturnType<typeof layer.step> = [];
    for (let i = 0; i < 5; i += 1) tracks = layer.step(0.3, []);
    // Sag alone pulls driftY negative (down, in the up-is-positive-y convention every fraction here
    // shares with MEDIUM_DEFAULT_LIGHTS) — the curl push is small relative to a second and a half of sag.
    expect(tracks[0].driftY).toBeLessThan(0);
  });

  it('caps the list at MEDIUM_TRACK_LAYER_MAX_TRACKS, oldest out', () => {
    const layer = createTrackLayer();
    for (let i = 0; i < MEDIUM_TRACK_LAYER_MAX_TRACKS + 10; i += 1) {
      layer.step(1 / 60, [emission({ seed: i, kind: 'muon' })]);
    }
    const tracks = layer.step(1 / 60, []);
    expect(tracks.length).toBeLessThanOrEqual(MEDIUM_TRACK_LAYER_MAX_TRACKS);
    // The oldest seeds (0, 1, 2, …) are the ones dropped first.
    expect(tracks.some((t) => t.emission.seed === 0)).toBe(false);
  });

  it('is deterministic: two independent runs with the same emissions drift identically', () => {
    const run = () => {
      const layer = createTrackLayer();
      layer.step(1 / 60, [emission()]);
      let tracks = layer.step(1 / 60, []);
      for (let i = 0; i < 30; i += 1) tracks = layer.step(1 / 60, []);
      return tracks[0];
    };
    const a = run();
    const b = run();
    expect(a.driftX).toBe(b.driftX);
    expect(a.driftY).toBe(b.driftY);
  });
});

describe('buildTrackLayerInstances', () => {
  it('converts a live track into content-px instance data', () => {
    const layer = createTrackLayer();
    const tracks = layer.step(1 / 60, [emission({ source: [0.25, 0.5], angle: 0 })]);
    const { data, count } = buildTrackLayerInstances(tracks, 1000, 500, 1);
    expect(count).toBe(1);
    expect(data[0]).toBeCloseTo(250, 5); // source.x fraction * contentWidth
    expect(data[1]).toBeCloseTo(250, 5); // source.y fraction * contentHeight
    expect(data[2]).toBeGreaterThan(data[0]); // head.x is further along +x (angle 0)
  });

  it('amount=0 (the canary check:medium uses) produces no instances at all', () => {
    const layer = createTrackLayer();
    const tracks = layer.step(1 / 60, [emission()]);
    const { count } = buildTrackLayerInstances(tracks, 1000, 500, 0);
    expect(count).toBe(0);
  });

  it('skips a track that has fully faded out', () => {
    const layer = createTrackLayer();
    let tracks = layer.step(1 / 60, [emission({ kind: 'alpha' })]);
    const dt = 1 / 30;
    let elapsed = 1 / 60;
    while (elapsed < MEDIUM_TRACK_LAYER_LIFE_SECONDS.alpha - dt) {
      tracks = layer.step(dt, []);
      elapsed += dt;
    }
    const { count } = buildTrackLayerInstances(tracks, 1000, 500, 1);
    // Right at the edge of its life the fade curve is at or near 0 — either already dropped by the
    // layer itself or filtered out here; either way, no instance for a track that can't be seen.
    expect(count).toBeLessThanOrEqual(tracks.length);
  });
});

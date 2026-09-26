import { describe, expect, it } from 'vitest';
import { characterOf, lightRigForCharacter, lightRigForCover, MEDIUM_DEFAULT_LIGHTS } from '../medium';

const RED: readonly [number, number, number] = [0.8, 0.15, 0.15];

describe('lightRigForCharacter: a cover tints the lights, not the gas', () => {
  it('recolors every spotlight (narrow cone) but leaves position/direction/falloff untouched', () => {
    const character = characterOf(RED);
    const rig = lightRigForCharacter(character);
    for (let i = 0; i < rig.length; i += 1) {
      const before = MEDIUM_DEFAULT_LIGHTS[i];
      const after = rig[i];
      expect(after.position).toEqual(before.position);
      expect(after.direction).toEqual(before.direction);
      expect(after.coneAngle).toBe(before.coneAngle);
      expect(after.falloff).toBe(before.falloff);
      expect(after.intensity).toBe(before.intensity);
    }
  });

  it('gives the two spotlights DIFFERENT tones off the same family, not an identical recolor', () => {
    const rig = lightRigForCharacter(characterOf(RED));
    const spotlights = rig.filter((l) => l.coneAngle < Math.PI - 1e-6);
    expect(spotlights).toHaveLength(2);
    expect(spotlights[0].color).not.toEqual(spotlights[1].color);
  });

  it('changes every light\'s color from the neutral default when a cover is applied', () => {
    const rig = lightRigForCharacter(characterOf(RED));
    for (let i = 0; i < rig.length; i += 1) {
      expect(rig[i].color).not.toEqual(MEDIUM_DEFAULT_LIGHTS[i].color);
    }
  });

  it('the edge strip (180°+ cone) moves toward the cover far less than a spotlight does', () => {
    const character = characterOf(RED);
    const rig = lightRigForCharacter(character);
    const edgeStrip = rig.find((l) => l.coneAngle >= Math.PI - 1e-6)!;
    const baseEdgeStrip = MEDIUM_DEFAULT_LIGHTS.find((l) => l.coneAngle >= Math.PI - 1e-6)!;
    const spotlight = rig.find((l) => l.coneAngle < Math.PI - 1e-6)!;
    const baseSpotlight = MEDIUM_DEFAULT_LIGHTS.find((l) => l.coneAngle < Math.PI - 1e-6)!;
    const dist = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(dist(edgeStrip.color, baseEdgeStrip.color)).toBeLessThan(dist(spotlight.color, baseSpotlight.color));
  });

  it('a gray cover (zero chroma) turns a spotlight neutral rather than an arbitrary hue', () => {
    const gray = characterOf([0.5, 0.5, 0.5]);
    const rig = lightRigForCharacter(gray);
    const spotlight = rig.find((l) => l.coneAngle < Math.PI - 1e-6)!;
    expect(characterOf(spotlight.color).chroma).toBeLessThan(0.01);
  });
});

describe('lightRigForCover', () => {
  it('is characterOf + lightRigForCharacter, not a separate derivation', () => {
    expect(lightRigForCover(RED)).toEqual(lightRigForCharacter(characterOf(RED)));
  });
});

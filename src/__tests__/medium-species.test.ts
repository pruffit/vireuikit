import { describe, it, expect } from 'vitest';
import {
  MEDIUM_DEFAULTS,
  MEDIUM_SPECIES_HUE_SPREAD,
  MEDIUM_SPECIES_LIGHTNESS,
  characterOf,
  neutralSpecies,
  speciesFamily,
  srgbToOklab,
} from '../medium';

const oklch = (color: readonly [number, number, number]) => {
  const [lightness, a, b] = srgbToOklab(color);
  return { lightness, chroma: Math.hypot(a, b), hue: (Math.atan2(b, a) * 180) / Math.PI };
};

const arc = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('vapor species family', () => {
  const character = { hue: 40, chroma: 0.09, lightness: MEDIUM_SPECIES_LIGHTNESS };

  it('keeps hues in a narrow arc: a mix of two tones never passes through gray', () => {
    const [low, mid, high] = speciesFamily(character).map(oklch);

    expect(arc(mid.hue, character.hue)).toBeLessThan(0.5);
    expect(arc(low.hue, mid.hue)).toBeCloseTo(MEDIUM_SPECIES_HUE_SPREAD, 0);
    expect(arc(high.hue, mid.hue)).toBeCloseTo(MEDIUM_SPECIES_HUE_SPREAD, 0);
    expect(arc(low.hue, high.hue)).toBeLessThan(90);
  });

  it('equalizes lightness and chroma: unevenly bright tones would read as patches, not a medium', () => {
    const family = speciesFamily(character).map(oklch);

    for (const tone of family) {
      expect(tone.lightness).toBeCloseTo(character.lightness, 2);
      expect(tone.chroma).toBeCloseTo(character.chroma, 2);
    }
  });

  // Glass can't be parked on the polarity threshold: the material would flip it every frame there.
  it('lightness stays below the 0.50…0.62 polarity band', () => {
    expect(MEDIUM_SPECIES_LIGHTNESS).toBeLessThan(0.5);

    for (const tone of speciesFamily(character)) {
      expect(oklch(tone).lightness).toBeLessThan(0.5);
    }
  });

  it('cover art with no color needs no special case: the arc collapses on its own', () => {
    const [low, mid, high] = speciesFamily({ hue: 40, chroma: 0, lightness: 0.44 });

    expect(low).toEqual(mid);
    expect(high).toEqual(mid);
  });
});

describe('initial state', () => {
  it('is derived from the platform tone rather than hardcoded as a triad', () => {
    expect(MEDIUM_DEFAULTS.channelColors).toEqual(neutralSpecies(MEDIUM_DEFAULTS.baseColor));
  });

  it("takes the platform's own tone and chroma — there is nowhere else to take a color from", () => {
    const base = characterOf(MEDIUM_DEFAULTS.baseColor);

    for (const tone of neutralSpecies(MEDIUM_DEFAULTS.baseColor)) {
      const { chroma, hue } = oklch(tone);
      expect(chroma).toBeCloseTo(base.chroma, 2);
      expect(arc(hue, base.hue)).toBeLessThan(MEDIUM_SPECIES_HUE_SPREAD + 1);
    }
  });

  // The platform tone is dark, vapor above it is lighter — otherwise the fog wouldn't show against
  // its own background.
  it('vapor is lighter than the platform tone, but stays within the corridor', () => {
    const base = characterOf(MEDIUM_DEFAULTS.baseColor);

    for (const tone of MEDIUM_DEFAULTS.channelColors) {
      const { lightness } = oklch(tone);
      expect(lightness).toBeGreaterThan(base.lightness);
      expect(lightness).toBeLessThan(0.5);
    }
  });
});

// Vapor species tones are DERIVED from a character, not picked as three separate colors. The
// three most common colors of a piece of cover art are not a palette: they land all around the
// hue wheel, and the species mix with each other too — a mix of two opposing hues passes through
// gray. A narrow arc around a single hue is the guard against that: mixes inside it simply have
// nowhere to pass through gray.

import { oklabToSrgb, srgbToOklab } from './oklab';
import type { VireUIKitMediumChannel } from './params';

/** The medium's character: one hue, one chroma, one lightness shared by the whole triad. */
export type VireUIKitMediumCharacter = {
  /** Oklch hue, degrees. */
  hue: number;
  /** Oklch chroma. For the initial state, this is the platform tone's own chroma — i.e. the floor. */
  chroma: number;
  /** Oklab lightness, shared across every species: unevenly bright tones read as separate patches
   *  rather than one medium. */
  lightness: number;
};

/**
 * The medium's working lightness. Glass can't be parked on the polarity threshold (0.50…0.62) —
 * the material would flip its polarity every frame there — so the medium stays below that band.
 * The physical picture is the same either way: the chamber is a dark volume that tracks glow
 * inside it.
 */
export const MEDIUM_SPECIES_LIGHTNESS = 0.44;

/** Arc between neighboring species, degrees (a 25–40° spread is the target). */
export const MEDIUM_SPECIES_HUE_SPREAD = 32;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Hue, chroma and lightness of an sRGB color — the input for building a family around it. */
export function characterOf(color: VireUIKitMediumChannel): VireUIKitMediumCharacter {
  const [lightness, a, b] = srgbToOklab(color);
  return {
    hue: (Math.atan2(b, a) * 180) / Math.PI,
    chroma: Math.hypot(a, b),
    lightness,
  };
}

/**
 * A family of three species: `H − Δ`, `H`, `H + Δ`, sharing lightness and chroma.
 *
 * Cover art with no color needs no special case: on a gray cover, chroma arrives as the floor,
 * and the arc collapses on its own — all three species get the same platform tone. That is the
 * initial state, not a branch written for it.
 */
export function speciesFamily(
  character: VireUIKitMediumCharacter,
  spreadDeg = MEDIUM_SPECIES_HUE_SPREAD,
): readonly [VireUIKitMediumChannel, VireUIKitMediumChannel, VireUIKitMediumChannel] {
  const { hue, chroma, lightness } = character;
  const tone = (deg: number): VireUIKitMediumChannel => {
    const rad = (deg * Math.PI) / 180;
    return oklabToSrgb([lightness, chroma * Math.cos(rad), chroma * Math.sin(rad)]).map(
      clamp01,
    ) as unknown as VireUIKitMediumChannel;
  };
  return [tone(hue - spreadDeg), tone(hue), tone(hue + spreadDeg)];
}

/**
 * The initial state: with no cover art, there is nowhere to take a color from. The family is
 * derived from the platform's own tone, so there is no hardcoded triad in the code — neither a
 * placeholder nor an example — only the platform tone and the derivation rule.
 */
export function neutralSpecies(
  baseColor: VireUIKitMediumChannel,
): readonly [VireUIKitMediumChannel, VireUIKitMediumChannel, VireUIKitMediumChannel] {
  const { hue, chroma } = characterOf(baseColor);
  return speciesFamily({ hue, chroma, lightness: MEDIUM_SPECIES_LIGHTNESS });
}

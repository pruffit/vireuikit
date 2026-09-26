// A given cover's character reaches the LIGHTS, not `channelColors` (see that field's own comment
// in params.ts and `species.ts`'s file header): a chamber's gas is invisible, only what scatters
// light reads at all, so a colored chamber has to mean colored light sources, not a colored gas.
//
// Spotlights and the edge strip don't take the cover the same way. A spotlight IS the visible beam
// — real stage/room lamps come in noticeably different tints, so each spotlight takes one tone off
// the SAME family `species.ts` already derives for vapor, spread across just the spotlights (not
// all three light slots). The edge strip washes the whole chamber width from a near-180° cone —
// fully retinting IT would tilt the entire calm-state ambient toward the cover's hue, which the
// brief and the reference both want to stay a neutral room; it only takes a slight nudge.
import { oklabToSrgb, srgbToOklab } from './oklab';
import { characterOf, MEDIUM_SPECIES_HUE_SPREAD, type VireUIKitMediumCharacter } from './species';
import { MEDIUM_DEFAULT_LIGHTS, type VireUIKitMediumChannel, type VireUIKitMediumLight } from './params';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Cone half-angle at/above which `MEDIUM_COMPOSITE_SHADER`'s `vgLightAmount` treats a light as an
 *  edge strip rather than a spotlight (see that shader's own comment: "a cone of 180° or more is an
 *  edge strip") — the same threshold, so this rig agrees with what the composite actually renders. */
const EDGE_STRIP_CONE_ANGLE = Math.PI - 1e-6;

/** How far the edge strip's own hue moves toward the cover's character, 0…1 — "near-neutral with a
 *  slight tint", not a family member: it keeps most of its own low-chroma platform tone. */
const EDGE_STRIP_TINT_MIX = 0.22;

/** Hue offset of each spotlight from the cover, degrees: half the vapor species arc, so two lamps
 *  read as one family rather than two unrelated colors. */
const GEL_LIGHTNESS = 0.7;

const LIGHT_HUE_SPREAD = MEDIUM_SPECIES_HUE_SPREAD / 2;

/** Rotates `base`'s Oklab hue/chroma toward `(hueDeg, chroma)` by `mix` (0 = untouched, 1 = fully
 *  retinted), keeping `base`'s own LIGHTNESS — a light's brightness shouldn't change just because
 *  its color did. A gray cover (`chroma=0`) fully retinted (`mix=1`) therefore turns a light
 *  neutral, the same "the arc collapses on its own" reading `species.ts` already gives a gray
 *  cover — no special case, the formula does this on its own. */
function retint(base: VireUIKitMediumChannel, hueDeg: number, chroma: number, mix: number): VireUIKitMediumChannel {
  const [baseL, a, b] = srgbToOklab(base);
  // A tinted lamp is a gel: tint at a lower lightness, where the gamut has room for chroma, then
  // scale back up to the lamp's own peak channel.
  const l = baseL + (Math.min(baseL, GEL_LIGHTNESS) - baseL) * mix;
  const rad = (hueDeg * Math.PI) / 180;
  const targetA = chroma * Math.cos(rad);
  const targetB = chroma * Math.sin(rad);
  const mixedA = a + (targetA - a) * mix;
  const mixedB = b + (targetB - b) * mix;
  // Gamut-map by chroma, not by clamping channels: a clamp at this lightness turns blue into cyan.
  let lo = 0;
  let hi = 1;
  if (inGamut(oklabToSrgb([l, mixedA, mixedB]))) lo = 1;
  else {
    for (let i = 0; i < 12; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToSrgb([l, mixedA * mid, mixedB * mid]))) lo = mid;
      else hi = mid;
    }
  }
  const rgb = oklabToSrgb([l, mixedA * lo, mixedB * lo]).map(clamp01);
  const gain = Math.max(...base) / Math.max(...rgb, 1e-6);
  return rgb.map((v) => clamp01(v * gain)) as unknown as VireUIKitMediumChannel;
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/**
 * Builds a light rig from a cover's character: spotlights take one tone each off the family spread
 * around the cover's hue (`characterOf`/`MEDIUM_SPECIES_HUE_SPREAD`, the same arc `species.ts` uses
 * for vapor), the edge strip only nudges toward it. With no cover, a caller simply doesn't call this
 * — `MEDIUM_DEFAULT_LIGHTS` is already the neutral calm state, so there is no "no-cover" branch here
 * to keep in sync with it.
 */
export function lightRigForCharacter(
  character: VireUIKitMediumCharacter,
  baseLights: readonly VireUIKitMediumLight[] = MEDIUM_DEFAULT_LIGHTS,
): readonly VireUIKitMediumLight[] {
  const spotlightIndices: number[] = [];
  baseLights.forEach((light, i) => {
    if (light.coneAngle < EDGE_STRIP_CONE_ANGLE) spotlightIndices.push(i);
  });
  const spotlightCount = spotlightIndices.length;

  return baseLights.map((light, i) => {
    if (light.coneAngle >= EDGE_STRIP_CONE_ANGLE) {
      return { ...light, color: retint(light.color, character.hue, character.chroma, EDGE_STRIP_TINT_MIX) };
    }
    const slot = spotlightIndices.indexOf(i);
    const hueOffset =
      spotlightCount > 1 ? LIGHT_HUE_SPREAD * ((2 * slot) / (spotlightCount - 1) - 1) : 0;
    return { ...light, color: retint(light.color, character.hue + hueOffset, character.chroma, 1) };
  });
}

/** Convenience for callers that only have a cover color (not an already-derived character) — a
 *  cover-art palette step lands `characterOf` upstream of this in the product; a lab stand parsing
 *  `?cover=<hue>,<chroma>` from the URL builds the character directly instead. */
export function lightRigForCover(
  cover: VireUIKitMediumChannel,
  baseLights: readonly VireUIKitMediumLight[] = MEDIUM_DEFAULT_LIGHTS,
): readonly VireUIKitMediumLight[] {
  return lightRigForCharacter(characterOf(cover), baseLights);
}

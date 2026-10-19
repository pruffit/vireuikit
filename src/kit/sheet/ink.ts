// The ink of a glass surface follows the body as it is drawn: what lies behind, under the body's own density.

export type SurfaceInk = 'dark' | 'light';

/** Near-black and near-white: each reads on its own pole of the body. */
export const SURFACE_INK = { dark: '#16171a', light: '#f6f6f8' } as const;

/** Relative luminance of the two inks. */
const INK_LUMINANCE = { dark: 0.008, light: 0.92 } as const;

const linear = (encoded: number) => (encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4);
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The polarity that reads better on the body: `opaqueLuma` laid over `backdropLuma` at `opaque` density, all in
 * sRGB-encoded lightness 0..1 (a scrim, if there is one, is already in the backdrop).
 */
export function surfaceInk(backdropLuma: number, opaque: number, opaqueLuma: number): SurfaceInk {
  const k = Math.min(Math.max(opaque, 0), 1);
  const body = linear(backdropLuma * (1 - k) + opaqueLuma * k);
  return contrast(body, INK_LUMINANCE.dark) >= contrast(body, INK_LUMINANCE.light) ? 'dark' : 'light';
}

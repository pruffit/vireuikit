import type { VireGlassAccessibility, VireGlassGeometry, VireGlassMaterial } from 'vireglass';
import type { AttachGlassOptions, GlassHandle, GlassMorph } from 'vireglass/dom';

export type GlassParams = {
  material: VireGlassMaterial;
  geometry: VireGlassGeometry;
  accessibility: VireGlassAccessibility;
  /** The glass appears only under the finger. */
  onTouch: boolean;
};

export type GlassSession = {
  setMaterial(material: VireGlassMaterial): void;
  setGeometry(geometry: VireGlassGeometry): void;
  setAppear(t: number): void;
  setMorph(morph: GlassMorph | null): void;
  destroy(): void;
};

// Loaded on demand: the control works without it, so the glass is an upgrade, not a dependency of
// first paint. Resolves to null if the caller stopped wanting it while the module loaded.
export async function attachControlGlass(
  el: HTMLElement,
  params: GlassParams,
  stillWanted: () => boolean,
): Promise<GlassSession | null> {
  const { attachGlass } = await import('vireglass/dom');
  if (!stillWanted()) return null;

  // `attachGlass` re-reads these on `update()`. The geometry is passed in because a pressed
  // element is scaled and a measured box would be the scaled one.
  const opts: AttachGlassOptions = {
    material: params.material,
    geometry: params.geometry,
    accessibility: params.accessibility,
    variant: params.onTouch ? 'interactive' : 'present',
  };
  const handle: GlassHandle = attachGlass(el, opts);

  return {
    setMaterial(material) {
      opts.material = material;
      handle.update();
    },
    setGeometry(geometry) {
      opts.geometry = geometry;
      handle.update();
    },
    setAppear: (t) => handle.setAppear(t),
    setMorph: (morph) => handle.setMorph(morph),
    destroy: () => handle.destroy(),
  };
}

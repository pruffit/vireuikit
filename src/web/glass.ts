import type { BackdropSample, VireGlassAccessibility, VireGlassGeometry, VireGlassMaterial } from 'vireglass';
import type { AttachGlassOptions, GlassHandle, GlassMorph } from 'vireglass/dom';

export type GlassParams = {
  material: VireGlassMaterial;
  geometry: VireGlassGeometry;
  accessibility: VireGlassAccessibility;
  /** The glass appears only under the finger. */
  onTouch: boolean;
  /** The backdrop as the host knows it; null leaves it to the lens's probe. */
  sample: BackdropSample | null;
  /** The lens's own pointer response; off where the element's children take the pointer. */
  interactive?: boolean;
};

export type GlassFrame = {
  material?: VireGlassMaterial;
  geometry?: VireGlassGeometry;
  morph?: GlassMorph | null;
};

export type GlassSession = {
  setMaterial(material: VireGlassMaterial): void;
  setGeometry(geometry: VireGlassGeometry): void;
  /** Material, geometry and morph together, for one repaint instead of three. */
  frame(next: GlassFrame): void;
  setAppear(t: number): void;
  setMorph(morph: GlassMorph | null): void;
  setSample(sample: BackdropSample | null): void;
  /** What the probe reads behind the element where it is now. */
  probe(): BackdropSample;
  destroy(): void;
};

// Loaded on demand: the control works without it, so the glass is an upgrade, not a dependency of
// first paint. Resolves to null if the caller stopped wanting it while the module loaded.
export async function attachControlGlass(
  el: HTMLElement,
  params: GlassParams,
  stillWanted: () => boolean,
): Promise<GlassSession | null> {
  const { attachGlass, probeBackdrop } = await import('vireglass/dom');
  if (!stillWanted()) return null;

  // `attachGlass` re-reads these on `update()`. The geometry is passed in because a pressed
  // element is scaled and a measured box would be the scaled one.
  const opts: AttachGlassOptions = {
    material: params.material,
    geometry: params.geometry,
    accessibility: params.accessibility,
    variant: params.onTouch ? 'interactive' : 'present',
    // The kit paints its own body: the core's is not lighter than its surround over a light backdrop and
    // near black under reduced transparency with light ink (docs/acceptance.md, "Resting body").
    body: false,
  };
  if (params.interactive === false) opts.interactive = false;
  if (params.sample) opts.sample = params.sample;
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
    frame(next) {
      if (next.material) opts.material = next.material;
      if (next.geometry) opts.geometry = next.geometry;
      if (next.morph !== undefined) handle.setMorph(next.morph);
      else handle.update();
    },
    setAppear: (t) => handle.setAppear(t),
    setMorph: (morph) => handle.setMorph(morph),
    setSample: (sample) => handle.setSample(sample),
    probe: () => probeBackdrop(el),
    destroy: () => handle.destroy(),
  };
}

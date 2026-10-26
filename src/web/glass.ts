import type { BackdropSample, VireGlassAccessibility, VireGlassGeometry, VireGlassMaterial } from 'vireglass';
import type { AttachGlassOptions, GlassHandle, GlassMorph, PrepareTarget, ScrollEdgeHandle, ScrollEdgeOptions } from 'vireglass/dom';
import type { Rect } from '../kit/geometry';

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
  /** While on, the lens keeps its probe and baked maps through changes of shape; turning it off lands it. */
  setInterim(on: boolean): void;
  /** Announces where the motion ends, so the maps and colours of that end are ready by its last frame. */
  prepare(target: PrepareTarget | null): void;
  /** Lands a lens that is in interim, in this task; does nothing for one that is not. */
  land(): void;
  /** Resolves when the prepared destination is decoded, or has failed, or nothing is prepared. */
  whenPrepared(): Promise<void>;
  /** Tells the core a held gesture is still going: restarts its 2 s safety net if this lens is in interim, and does nothing otherwise. */
  beat(): void;
  /** What the probe reads behind the element where it is now. */
  probe(): BackdropSample;
  destroy(): void;
};

// On the way a new second shape is a map to rebuild, and a coarse grid keeps that to a few frames of the motion.
const MOVING_GRID = 8;

/** The core's morph for a surface that is joined to a second shape, in whole pixels, and coarser while it moves. */
export function glassMorph(
  morph: { smoothing: number; offsetX: number; offsetY: number; width: number; height: number; cornerRadius: number } | undefined,
  moving: boolean,
): GlassMorph | null {
  if (!morph) return null;
  // 0 means no morph at all, so at rest a smoothing the whole pixel rounds to 0 stays 0.
  const snap = (v: number, grid = moving ? MOVING_GRID : 1) => Math.round(v / grid) * grid;
  return {
    smoothing: morph.smoothing > 0 && (moving || morph.smoothing >= 0.5) ? Math.max(snap(morph.smoothing, moving ? MOVING_GRID / 2 : 1), 1) : 0,
    shape: {
      offsetX: snap(morph.offsetX),
      offsetY: snap(morph.offsetY),
      width: snap(morph.width),
      height: snap(morph.height),
      cornerRadius: snap(morph.cornerRadius),
    },
  };
}

/** Runs the changes to a lens inside interim while its element moves. The last frame applies what lands the element and lands the lens in the same task. */
export function moveGlass(session: GlassSession, moving: boolean, apply: () => void): void {
  if (moving) {
    session.setInterim(true);
    apply();
  } else {
    apply();
    session.land();
  }
}

const HEARTBEAT_MS = 1000;

/**
 * A pointer held still sends no geometry, and the core ends an interim that hears nothing for 2 s. For the life of one
 * gesture this tells it once a second that the gesture is still held, and stops by itself when `held` turns false; call
 * the result when the pointer is released, cancelled or loses its capture. A surface that never lands is still ended by the core's own net.
 */
export function holdGlass(held: () => boolean, sessions: () => Iterable<GlassSession | null | undefined>): () => void {
  const timer = window.setInterval(() => {
    if (!held()) window.clearInterval(timer);
    else for (const session of sessions()) session?.beat();
  }, HEARTBEAT_MS);
  return () => window.clearInterval(timer);
}

let loaded: typeof import('vireglass/dom') | null = null;

export const glassLoaded = (): boolean => loaded !== null;

/** Loads the glass module, which is what a host that must read the backdrop first waits for. */
export async function ensureGlass(): Promise<void> {
  loaded ??= await import('vireglass/dom');
}

/**
 * What lies behind a box in client coordinates, read through an element that is only there while it is read. A modal
 * dialog makes the page inert, and hit testing skips an inert page, so this is read before the dialog opens. Null until the
 * glass module has loaded.
 */
export function probeRect(doc: Document, box: Rect): BackdropSample | null {
  if (!loaded) return null;
  const probe = doc.createElement('div');
  probe.setAttribute('data-vk-sample', '');
  probe.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;visibility:hidden;pointer-events:none`;
  doc.body.append(probe);
  try {
    return loaded.probeBackdrop(probe);
  } finally {
    probe.remove();
  }
}

// Loaded on demand: the control works without it, so the glass is an upgrade, not a dependency of
// first paint. Resolves to null if the caller stopped wanting it while the module loaded.
export async function attachControlGlass(
  el: HTMLElement,
  params: GlassParams,
  stillWanted: () => boolean,
): Promise<GlassSession | null> {
  await ensureGlass();
  if (!stillWanted()) return null;
  return attachLoaded(el, params);
}

/** `attachControlGlass` for a host that has already waited for the module: the lens is there on this frame, or null. */
export function attachControlGlassNow(el: HTMLElement, params: GlassParams): GlassSession | null {
  return loaded ? attachLoaded(el, params) : null;
}

function attachLoaded(el: HTMLElement, params: GlassParams): GlassSession {
  const { attachGlass, probeBackdrop } = loaded!;

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

  let interim = false;
  const session: GlassSession = {
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
    setInterim(on) {
      interim = on;
      handle.setInterim(on);
    },
    prepare: (target) => handle.prepare(target),
    land() {
      if (!interim) return;
      interim = false;
      handle.land();
    },
    whenPrepared: () => handle.whenPrepared(),
    beat() {
      if (interim) handle.setInterim(true);
    },
    probe: () => probeBackdrop(el),
    destroy: () => handle.destroy(),
  };
  return session;
}

/** The core's scroll edge on an element the host placed, or null until the glass module has loaded (or when a stand-in for it has none). */
export function attachEdgeNow(scroller: HTMLElement, el: HTMLElement, options: ScrollEdgeOptions): ScrollEdgeHandle | null {
  return typeof loaded?.attachScrollEdge === 'function' ? loaded.attachScrollEdge(scroller, el, options) : null;
}

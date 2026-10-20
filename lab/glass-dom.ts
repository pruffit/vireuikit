import { attachGlass as attachReal } from 'vireglass/dom';
import type { AttachGlassOptions, GlassHandle, GlassMorph } from 'vireglass/dom';

export * from 'vireglass/dom';

/** What the shim saw of one lens: the last of each call the kit made, which is what the core was left holding. */
export type LabLens = {
  el: HTMLElement;
  alive: boolean;
  /** Interim was turned on at some point since the last `__labGlassMark`. */
  entered: boolean;
  /** The last `setInterim` that reached the core; null if none did. */
  interim: boolean | null;
  morph: GlassMorph | null | undefined;
  appear: number | undefined;
  options: AttachGlassOptions | undefined;
};

declare global {
  interface Window {
    /** A selector; a lens whose element matches it ignores `setInterim`, which is what the motion gate's canary needs. */
    __labNoInterim?: string;
    /** A selector; a lens whose element matches it ignores `setInterim(false)`: interim is entered and never landed. */
    __labNoLand?: string;
    /** A selector; a lens whose element matches it ends and re-enters interim after every `setAppear`, which is a core that bakes for presence. */
    __labBakeOnAppear?: string;
    /** How many lenses have been attached, so a gate can tell a surface that was created from one that was rebuilt. */
    __labAttached?: number;
    /** From now on only the kit's heartbeat ('beat') or nothing ('none') reaches the core's `setInterim`: a held gesture that sends no geometry. */
    __labHear?: 'beat' | 'none';
    __labGlass?: LabLens[];
    /** Forgets that any lens has entered interim, so a recording counts only its own. */
    __labGlassMark?: () => void;
    /** `attachGlass` itself, for a canary that rebuilds a lens on every frame. */
    __labAttachGlass?: typeof attachGlass;
  }
}

// The lab only: stands in for `vireglass/dom` so a test can switch interim off for one element, count attaches and
// read what each lens was last handed.
export function attachGlass(el: HTMLElement, options?: AttachGlassOptions): GlassHandle {
  window.__labAttached = (window.__labAttached ?? 0) + 1;
  const handle = attachReal(el, options);
  const lens: LabLens = { el, alive: true, entered: false, interim: null, morph: undefined, appear: undefined, options };
  (window.__labGlass ??= []).push(lens);
  window.__labGlassMark ??= () => {
    for (const l of window.__labGlass ?? []) l.entered = false;
  };
  window.__labAttachGlass = attachGlass;
  const realInterim = handle.setInterim?.bind(handle);
  handle.setInterim = (on: boolean) => {
    const hit = (selector?: string) => Boolean(selector) && el.matches(selector!);
    if (hit(window.__labNoInterim) || (!on && hit(window.__labNoLand))) return;
    const hear = window.__labHear;
    if (hear && (hear === 'none' || !/beat/.test(new Error().stack ?? ''))) return;
    lens.interim = on;
    if (on) lens.entered = true;
    realInterim?.(on);
  };
  const realMorph = handle.setMorph.bind(handle);
  handle.setMorph = (morph) => {
    lens.morph = morph;
    realMorph(morph);
  };
  const realAppear = handle.setAppear.bind(handle);
  handle.setAppear = (t) => {
    lens.appear = t;
    realAppear(t);
    if (window.__labBakeOnAppear && el.matches(window.__labBakeOnAppear)) {
      const g = options?.geometry;
      realInterim?.(false);
      if (options && g) {
        options.geometry = { ...g, width: g.width + 1 };
        handle.update();
      }
      realInterim?.(true);
    }
  };
  const realDestroy = handle.destroy.bind(handle);
  handle.destroy = () => {
    lens.alive = false;
    realDestroy();
  };
  return handle;
}

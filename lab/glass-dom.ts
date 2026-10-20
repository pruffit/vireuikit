import { attachGlass as attachReal } from 'vireglass/dom';
import type { AttachGlassOptions, GlassHandle } from 'vireglass/dom';

export * from 'vireglass/dom';

declare global {
  interface Window {
    /** A selector; a lens whose element matches it ignores `setInterim`, which is what the motion gate's canary needs. */
    __labNoInterim?: string;
    /** How many lenses have been attached, so a gate can tell a surface that was created from one that was rebuilt. */
    __labAttached?: number;
  }
}

// The lab only: stands in for `vireglass/dom` so a test can switch interim off for one element and count attaches.
export function attachGlass(el: HTMLElement, options?: AttachGlassOptions): GlassHandle {
  window.__labAttached = (window.__labAttached ?? 0) + 1;
  const handle = attachReal(el, options);
  const real = handle.setInterim?.bind(handle);
  handle.setInterim = (on: boolean) => {
    const off = window.__labNoInterim;
    if (off && el.matches(off)) return;
    real?.(on);
  };
  return handle;
}

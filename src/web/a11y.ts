import { A11Y_NONE, resolveA11y, type A11yMode, type A11yOverride } from '../kit/a11y';

const QUERIES = {
  reduceMotion: '(prefers-reduced-motion: reduce)',
  increaseContrast: '(prefers-contrast: more)',
  reduceTransparency: '(prefers-reduced-transparency: reduce)',
} as const satisfies Record<keyof A11yMode, string>;

const KEYS = Object.keys(QUERIES) as (keyof A11yMode)[];

export function systemA11y(): A11yMode {
  if (typeof matchMedia === 'undefined') return A11Y_NONE;
  return {
    reduceMotion: matchMedia(QUERIES.reduceMotion).matches,
    increaseContrast: matchMedia(QUERIES.increaseContrast).matches,
    reduceTransparency: matchMedia(QUERIES.reduceTransparency).matches,
  };
}

export function watchSystemA11y(onChange: () => void): () => void {
  if (typeof matchMedia === 'undefined') return () => {};
  const lists = KEYS.map((key) => matchMedia(QUERIES[key]));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

let globalOverride: A11yOverride = {};
const listeners = new Set<() => void>();

/** Overrides the system for every element on the page; a key set to `undefined` follows it again. */
export function setA11yOverride(next: A11yOverride): void {
  globalOverride = { ...globalOverride, ...next };
  for (const listener of listeners) listener();
}

export function getA11yOverride(): A11yOverride {
  return globalOverride;
}

export function watchA11yOverride(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** An element's own override wins over the page's, which wins over the system. */
export function effectiveA11y(own: A11yOverride): A11yMode {
  const merged: A11yOverride = { ...globalOverride };
  for (const key of KEYS) if (own[key] !== undefined) merged[key] = own[key];
  return resolveA11y(systemA11y(), merged);
}

const COARSE = '(pointer: coarse)';

/** One query decides the size tier, the hit area, and whether hover and focus rings exist. */
export function isCoarsePointer(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia(COARSE).matches;
}

export function watchCoarsePointer(onChange: () => void): () => void {
  if (typeof matchMedia === 'undefined') return () => {};
  const list = matchMedia(COARSE);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

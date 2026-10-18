// The web collects the adaptive context: the input layers from media queries and key presses, the window's
// segments from the Viewport Segments API, and hands the elements what they need of it.
import { postureFromSegments, type AdaptiveContext, type InputLayers } from '../kit/adaptive/context';
import { intersectRect, type Rect } from '../kit/geometry';
import { effectiveA11y, watchA11yOverride, watchSystemA11y } from './a11y';

const QUERIES = {
  coarse: '(pointer: coarse)',
  anyCoarse: '(any-pointer: coarse)',
  anyHover: '(any-hover: hover)',
} as const;

const media = (query: string) => typeof matchMedia !== 'undefined' && matchMedia(query).matches;

let keyboardSeen = false;
let inputOverride: InputOverride = {};
const inputListeners = new Set<() => void>();
let viewportOverride: ViewportOverride | null = null;
const viewportListeners = new Set<() => void>();

/** `undefined` follows the system; a value overrides it. */
export type InputOverride = { [K in keyof InputLayers]?: InputLayers[K] | undefined };

export function systemInput(): InputLayers {
  if (typeof matchMedia === 'undefined') return { primary: 'fine', anyCoarse: false, hover: true, keyboard: keyboardSeen };
  const coarse = media(QUERIES.coarse);
  return {
    primary: coarse ? 'coarse' : 'fine',
    anyCoarse: coarse || media(QUERIES.anyCoarse),
    hover: media(QUERIES.anyHover),
    keyboard: keyboardSeen,
  };
}

/** Overrides the system's input layers for every element on the page: a host that knows better, or a simulation. */
export function setInputOverride(next: InputOverride): void {
  inputOverride = { ...inputOverride, ...next };
  for (const listener of [...inputListeners]) listener();
}

export function getInputOverride(): InputOverride {
  return inputOverride;
}

export function effectiveInput(): InputLayers {
  const system = systemInput();
  return {
    primary: inputOverride.primary ?? system.primary,
    anyCoarse: inputOverride.anyCoarse ?? system.anyCoarse,
    hover: inputOverride.hover ?? system.hover,
    keyboard: inputOverride.keyboard ?? system.keyboard,
  };
}

export const isEditable = (target: EventTarget | null) =>
  target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;

// An on-screen keyboard only types into a field, so a key pressed elsewhere is a hardware one.
function onKey(e: KeyboardEvent): void {
  // The window sees a shadow host as the target; the path still starts at the field inside an open root.
  const target = e.composedPath()[0] ?? e.target;
  if (keyboardSeen || e.isComposing || e.key === 'Unidentified' || e.key === 'Process' || isEditable(target)) return;
  keyboardSeen = true;
  for (const listener of [...inputListeners]) listener();
}

export function watchInput(onChange: () => void): () => void {
  inputListeners.add(onChange);
  const lists = typeof matchMedia === 'undefined' ? [] : Object.values(QUERIES).map((q) => matchMedia(q));
  for (const list of lists) list.addEventListener('change', onChange);
  if (inputListeners.size === 1 && typeof window !== 'undefined') window.addEventListener('keydown', onKey, true);
  return () => {
    inputListeners.delete(onChange);
    for (const list of lists) list.removeEventListener('change', onChange);
    if (inputListeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('keydown', onKey, true);
  };
}

const pointerLayers = ({ primary, anyCoarse, hover }: InputLayers) => `${primary} ${anyCoarse} ${hover}`;

/** `watchInput` for the atoms: a keyboard sets neither their tier, their hit area nor their hover, so it stays silent. */
export function watchPointerInput(onChange: () => void): () => void {
  let last = pointerLayers(effectiveInput());
  return watchInput(() => {
    const next = pointerLayers(effectiveInput());
    if (next === last) return;
    last = next;
    onChange();
  });
}

/**
 * Makes an element the window: a host that draws its app inside a frame, or a simulation of a folding device.
 * `segments` are in the element's own coordinates; one segment, the element's box, by default.
 */
export type ViewportOverride = { root: Element; segments?: readonly Rect[] | undefined };

export function setViewportOverride(next: ViewportOverride | null): void {
  viewportOverride = next;
  for (const listener of [...viewportListeners]) listener();
}

/** The element the host made the window, if any. */
export function viewportRoot(): Element | null {
  return viewportOverride?.root ?? null;
}

type SegmentsApi = { viewport?: { segments?: readonly DOMRectReadOnly[] | null } };

/** The window and its segments in client coordinates. */
export function viewportSegments(): { viewport: Rect; segments: Rect[] } {
  if (viewportOverride?.root.isConnected) {
    const r = viewportOverride.root.getBoundingClientRect();
    const viewport = { x: r.x, y: r.y, width: r.width, height: r.height };
    const local = viewportOverride.segments ?? [{ x: 0, y: 0, width: r.width, height: r.height }];
    return { viewport, segments: local.map((s) => ({ x: s.x + r.x, y: s.y + r.y, width: s.width, height: s.height })) };
  }
  const root = typeof document === 'undefined' ? null : document.documentElement;
  const viewport = { x: 0, y: 0, width: root?.clientWidth ?? 0, height: root?.clientHeight ?? 0 };
  const api = typeof window === 'undefined' ? null : (window as unknown as SegmentsApi).viewport?.segments;
  const segments = api && api.length > 1 ? api.map((s) => ({ x: s.x, y: s.y, width: s.width, height: s.height })) : [viewport];
  return { viewport, segments };
}

/** A posture change resizes the window, so the resize event carries it. */
export function watchViewport(onChange: () => void): () => void {
  viewportListeners.add(onChange);
  if (typeof window !== 'undefined') window.addEventListener('resize', onChange);
  return () => {
    viewportListeners.delete(onChange);
    if (typeof window !== 'undefined') window.removeEventListener('resize', onChange);
  };
}

/** The window an element stands for: its box, or for the document the viewport (the root element's box is the whole page). */
export function windowRect(root: Element): Rect {
  const doc = root.ownerDocument.documentElement;
  if (root === doc) return { x: 0, y: 0, width: doc.clientWidth, height: doc.clientHeight };
  const r = root.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function contextOf(root: Element): AdaptiveContext {
  const r = windowRect(root);
  const window = { width: r.width, height: r.height };
  const box = { x: r.x, y: r.y, width: r.width, height: r.height };
  const local = viewportSegments()
    .segments.map((s) => intersectRect(s, box))
    .filter((s): s is Rect => s !== null)
    .map((s) => ({ x: s.x - r.x, y: s.y - r.y, width: s.width, height: s.height }));
  return {
    window,
    input: effectiveInput(),
    posture: postureFromSegments(window, local),
    reduceMotion: effectiveA11y({}).reduceMotion,
  };
}

/** The adaptive context of an app shell rooted at `root`: told now, and again whenever any part of it changes. */
export function watchAdaptiveContext(root: Element, onChange: (ctx: AdaptiveContext) => void): () => void {
  let last = '';
  const emit = () => {
    if (!root.isConnected) return;
    const ctx = contextOf(root);
    const key = JSON.stringify(ctx);
    if (key === last) return;
    last = key;
    onChange(ctx);
  };
  const cleanups = [watchInput(emit), watchViewport(emit), watchSystemA11y(emit), watchA11yOverride(emit)];
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(emit);
    observer.observe(root);
    cleanups.push(() => observer.disconnect());
  }
  emit();
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

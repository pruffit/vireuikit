export type Root = Document | ShadowRoot;

/** The element's own tree outwards: its root first, the document last. */
export function rootsOf(el: Element): Root[] {
  const roots: Root[] = [];
  let node: Node = el.getRootNode();
  while (node instanceof ShadowRoot) {
    roots.push(node);
    node = node.host.getRootNode();
  }
  roots.push(el.ownerDocument);
  return roots;
}

export function dropEmptyStyle(el: Element, hadStyle: boolean): void {
  if (!hadStyle && el.getAttribute('style') === '') el.removeAttribute('style');
}

/** The focused element, looking into open shadow roots. */
export function deepActive(root: Root): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

const motionFrames = new Set<number>();
let motionAnnounced = false;

/** Tells a page-level probe (`globalThis.__vireMotion`) when a motion starts and when its last frame has run: the edges a recording needs. */
function announceMotion(): void {
  const running = motionFrames.size > 0;
  if (running === motionAnnounced) return;
  motionAnnounced = running;
  (globalThis as { __vireMotion?: (state: 'start' | 'end') => void }).__vireMotion?.(running ? 'start' : 'end');
}

const idleWaiters = new Set<() => void>();
let flushQueued = false;

function flushIdleWaiters(): void {
  flushQueued = false;
  if (motionFrames.size > 0) return;
  const waiting = Array.from(idleWaiters);
  idleWaiters.clear();
  for (const start of waiting) start();
}

function motionEnded(): void {
  if (motionFrames.size > 0 || flushQueued || idleWaiters.size === 0) return;
  flushQueued = true;
  queueMicrotask(flushIdleWaiters);
}

/** `requestAnimationFrame` for a running motion: the kit's idle work waits until none is pending. */
export function requestMotionFrame(callback: FrameRequestCallback): number {
  const id = requestAnimationFrame((t) => {
    motionFrames.delete(id);
    try {
      callback(t);
    } finally {
      announceMotion();
      motionEnded();
    }
  });
  motionFrames.add(id);
  announceMotion();
  return id;
}

export function cancelMotionFrame(id: number): void {
  if (!id) return;
  cancelAnimationFrame(id);
  if (motionFrames.delete(id)) {
    announceMotion();
    motionEnded();
  }
}

/** Runs `run` when the page is next idle (within 300 ms) and no kit motion runs, or after 200 ms without `requestIdleCallback`; returns its cancel. */
export function whenIdle(run: () => void): () => void {
  let cancelIdle: (() => void) | null = null;
  let cancelled = false;
  const start = (): void => {
    if (cancelled) return;
    const go = (): void => {
      if (motionFrames.size > 0) idleWaiters.add(start);
      else run();
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(go, { timeout: 300 });
      cancelIdle = () => cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(go, 200);
      cancelIdle = () => window.clearTimeout(id);
    }
  };
  if (motionFrames.size > 0) idleWaiters.add(start);
  else start();
  return () => {
    cancelled = true;
    idleWaiters.delete(start);
    cancelIdle?.();
  };
}

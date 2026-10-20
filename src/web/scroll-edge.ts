import { scrollEdgeReachDp } from 'vireglass';
import type { ScrollEdgeHandle } from 'vireglass/dom';
import { attachEdgeNow, ensureGlass, glassLoaded } from './glass';

export type EdgeSpec = {
  scroller: Element;
  side: 'top' | 'bottom';
  bar: Element;
  /** Another body over the same edge, such as a navigation bar's accessory: the band reaches past it too. */
  beside?: Element | null;
  hard: boolean;
  /** Ink polarity of the bar's glass, 1 light and 0 dark. */
  ink: () => number;
};

export type ScrollEdge = {
  readonly el: HTMLElement;
  set(spec: EdgeSpec | null): void;
  update(): void;
  /** Puts an element straight after the edge, so it paints over it. */
  after(el: Element): void;
  destroy(): void;
};

type Mount = 'band' | 'sticky';

const GEOMETRY = ['left', 'top', 'width', 'height', 'display', 'margin-bottom'];

const px = (v: number) => `${v.toFixed(2)}px`;

// A document's scroll events go to the window, and the core listens on the scroller.
function pageSource(doc: Document): HTMLElement {
  const root = () => doc.scrollingElement ?? doc.documentElement;
  const win = doc.defaultView!;
  return {
    get scrollTop() {
      return root().scrollTop;
    },
    get scrollHeight() {
      return root().scrollHeight;
    },
    get clientHeight() {
      return root().clientHeight;
    },
    addEventListener: (type: string, listener: EventListener, options?: AddEventListenerOptions) => win.addEventListener(type, listener, options),
    removeEventListener: (type: string, listener: EventListener) => win.removeEventListener(type, listener),
  } as unknown as HTMLElement;
}

const isPage = (el: Element) => el === el.ownerDocument.documentElement || el === el.ownerDocument.body || el === el.ownerDocument.scrollingElement;

export function createScrollEdge(host: HTMLElement, mode: Mount, mount: (el: HTMLElement) => void): ScrollEdge {
  const doc = host.ownerDocument;
  const el = doc.createElement('div');
  el.setAttribute('data-vk-edge', '');
  el.setAttribute('aria-hidden', 'true');
  if (mode === 'sticky') el.setAttribute('data-sticky', '');
  let spec: EdgeSpec | null = null;
  let live: { scroller: Element; side: string; hard: boolean; bar: Element; beside: Element | null | undefined; handle: ScrollEdgeHandle; observer: ResizeObserver | null } | null = null;
  let written = '';
  let loading = false;

  const write = (props: Record<string, string>) => {
    const key = JSON.stringify(props);
    if (key === written) return;
    written = key;
    for (const name of GEOMETRY) {
      const value = props[name];
      if (value === undefined) el.style.removeProperty(name);
      else el.style.setProperty(name, value);
    }
  };

  const place = () => {
    if (!live) return;
    const barBox = live.bar.getBoundingClientRect();
    const reach = scrollEdgeReachDp(barBox.height);
    if (mode === 'sticky') {
      write({ height: px(reach), 'margin-bottom': px(-reach) });
      return;
    }
    const page = isPage(live.scroller);
    const rect = page ? { left: 0, top: 0 } : live.scroller.getBoundingClientRect();
    const root = page ? (doc.scrollingElement ?? doc.documentElement) : live.scroller;
    const left = rect.left + (page ? 0 : root.clientLeft);
    const top = rect.top + (page ? 0 : root.clientTop);
    const width = root.clientWidth;
    const bottom = top + root.clientHeight;
    const boxes = [barBox, live.beside?.getBoundingClientRect()].filter((box): box is DOMRect => box !== undefined && box.width > 0 && box.height > 0);
    const lip = Math.max(...boxes.map((box) => (live!.side === 'top' ? box.bottom - top : bottom - box.top)));
    const height = Math.min(lip + reach, root.clientHeight);
    const bandTop = live.side === 'top' ? top : bottom - height;
    const clear = lip <= 0 || barBox.top >= bottom || barBox.bottom <= top || barBox.right <= left || barBox.left >= left + width;
    if (clear || width <= 0 || height <= 0) {
      write({ display: 'none' });
      return;
    }
    const at = host.getBoundingClientRect();
    write({ left: px(left - at.left - host.clientLeft), top: px(bandTop - at.top - host.clientTop), width: px(width), height: px(height) });
  };

  const stop = () => {
    if (!live) return;
    live.handle.destroy();
    live.observer?.disconnect();
    el.remove();
    write({});
    written = '';
    live = null;
  };

  const sync = () => {
    if (!spec) {
      stop();
      return;
    }
    if (!glassLoaded()) {
      stop();
      if (!loading) {
        loading = true;
        void ensureGlass()
          .then(() => {
            loading = false;
            sync();
          })
          .catch(() => {
            loading = false;
          });
      }
      return;
    }
    if (live && live.scroller === spec.scroller && live.side === spec.side && live.hard === spec.hard && live.bar === spec.bar && live.beside === spec.beside) return;
    stop();
    const handle = attachEdgeNow(isPage(spec.scroller) ? pageSource(doc) : (spec.scroller as HTMLElement), el, {
      side: spec.side,
      pinned: spec.hard,
      ink: () => spec?.ink() ?? 1,
    });
    if (!handle) return;
    mount(el);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(place);
      const targets = mode === 'band' ? [host, spec.bar, spec.beside, isPage(spec.scroller) ? doc.documentElement : spec.scroller] : [spec.bar];
      for (const target of targets) if (target) observer.observe(target);
    }
    live = { scroller: spec.scroller, side: spec.side, hard: spec.hard, bar: spec.bar, beside: spec.beside, handle, observer };
    place();
  };

  return {
    el,
    set(next) {
      spec = next;
      sync();
    },
    update() {
      live?.handle.update();
    },
    after(node) {
      if (el.parentNode === host) el.after(node);
      else host.prepend(node);
    },
    destroy() {
      spec = null;
      stop();
    },
  };
}

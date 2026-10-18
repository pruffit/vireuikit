// What every adaptive decision reads: the window in dp, the input in three layers, the posture and reduced motion.
// Targets collect it (the web from ResizeObserver, media queries and viewport segments; Android from its window
// size class and FoldingFeature) and the pure functions here turn it into forms.
import { intersectRect, type Rect, type Size } from '../geometry';

export type InputLayers = {
  /** The primary pointer: layout density for the whole window. */
  primary: 'fine' | 'coarse';
  /** Any coarse input present: hit areas reach the touch floor without changing layout. */
  anyCoarse: boolean;
  /** Some pointer can hover. Whether one does is decided per event, never by this flag. */
  hover: boolean;
  /** A hardware keyboard is present. The web cannot query it and learns it from a key press. */
  keyboard: boolean;
};

export const INPUT_TOUCH: InputLayers = { primary: 'coarse', anyCoarse: true, hover: false, keyboard: false };
export const INPUT_POINTER: InputLayers = { primary: 'fine', anyCoarse: false, hover: true, keyboard: true };
/** A laptop with a touch screen: the pointer is primary and touch is present. */
export const INPUT_MIXED: InputLayers = { primary: 'fine', anyCoarse: true, hover: true, keyboard: true };
/** A tablet with a keyboard and a trackpad attached stays touch first. */
export const INPUT_TABLET_KEYBOARD: InputLayers = { primary: 'coarse', anyCoarse: true, hover: true, keyboard: true };

/** The hinge in window coordinates (dp). A seamless fold may be a line of zero width. */
export type Fold = {
  bounds: Rect;
  /** Nothing can be drawn inside the bounds. */
  occluding: boolean;
};

/** Half-open: tabletop folds horizontally (top and bottom), book vertically (left and right). Physical, not mirrored in RTL. */
export type Posture = { kind: 'flat' } | { kind: 'tabletop'; fold: Fold } | { kind: 'book'; fold: Fold };

export const POSTURE_FLAT: Posture = { kind: 'flat' };

export type AdaptiveContext = {
  window: Size;
  input: InputLayers;
  posture: Posture;
  reduceMotion: boolean;
};

export function adaptiveContext(partial: Partial<AdaptiveContext> & { window: Size }): AdaptiveContext {
  return {
    window: partial.window,
    input: partial.input ?? INPUT_POINTER,
    posture: partial.posture ?? POSTURE_FLAT,
    reduceMotion: partial.reduceMotion ?? false,
  };
}

export type HalfOpenOptions = {
  /** Where the fold's centre line sits along its axis, dp; the middle by default. */
  at?: number;
  /** The band's width across the fold, dp. */
  band?: number;
  /** By default a band of any width occludes and a line does not. */
  occluding?: boolean;
};

export function halfOpen(kind: 'tabletop' | 'book', window: Size, options: HalfOpenOptions = {}): Posture {
  const band = Math.max(options.band ?? 0, 0);
  const span = kind === 'tabletop' ? window.height : window.width;
  const at = options.at ?? span / 2;
  const start = at - band / 2;
  const bounds =
    kind === 'tabletop'
      ? { x: 0, y: start, width: window.width, height: band }
      : { x: start, y: 0, width: band, height: window.height };
  return { kind, fold: { bounds, occluding: options.occluding ?? band > 0 } };
}

/**
 * The window's segments: one when flat, two on either side of the fold when half-open. An occluding fold's band
 * belongs to neither; a fold that does not occlude splits the window at its centre line.
 */
export function windowSegments(ctx: Pick<AdaptiveContext, 'window' | 'posture'>): Rect[] {
  const { width, height } = ctx.window;
  const whole = { x: 0, y: 0, width, height };
  if (ctx.posture.kind === 'flat') return [whole];
  const { bounds, occluding } = ctx.posture.fold;
  const tabletop = ctx.posture.kind === 'tabletop';
  const span = tabletop ? height : width;
  const lo = Math.min(Math.max(tabletop ? bounds.y : bounds.x, 0), span);
  const hi = Math.min(Math.max(lo + (tabletop ? bounds.height : bounds.width), lo), span);
  const end = occluding ? lo : (lo + hi) / 2;
  const start = occluding ? hi : (lo + hi) / 2;
  const parts: Rect[] = tabletop
    ? [
        { x: 0, y: 0, width, height: end },
        { x: 0, y: start, width, height: height - start },
      ]
    : [
        { x: 0, y: 0, width: end, height },
        { x: start, y: 0, width: width - start, height },
      ];
  const kept = parts.filter((r) => r.width > 0 && r.height > 0);
  return kept.length ? kept : [whole];
}

/**
 * The posture two viewport segments describe. The web has no hinge angle, so two segments count as half-open
 *; anything but two is flat.
 */
export function postureFromSegments(window: Size, segments: readonly Rect[]): Posture {
  if (segments.length !== 2) return POSTURE_FLAT;
  const [a, b] = [...segments].sort((p, q) => p.x - q.x || p.y - q.y) as [Rect, Rect];
  const gapX = b.x - (a.x + a.width);
  if (gapX >= 0 && a.y < b.y + b.height && b.y < a.y + a.height) {
    return { kind: 'book', fold: { bounds: { x: a.x + a.width, y: 0, width: gapX, height: window.height }, occluding: gapX > 0 } };
  }
  const [top, bottom] = [...segments].sort((p, q) => p.y - q.y) as [Rect, Rect];
  const gapY = bottom.y - (top.y + top.height);
  if (gapY >= 0) {
    return { kind: 'tabletop', fold: { bounds: { x: 0, y: top.y + top.height, width: window.width, height: gapY }, occluding: gapY > 0 } };
  }
  return POSTURE_FLAT;
}

const area = (r: Rect | null) => (r ? r.width * r.height : 0);

/** The segment a box belongs to: the one holding its centre, else the one it overlaps most. */
export function segmentOf(box: Rect, segments: readonly Rect[]): Rect | undefined {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const holding = segments.find((s) => cx >= s.x && cx < s.x + s.width && cy >= s.y && cy < s.y + s.height);
  if (holding) return holding;
  let best: Rect | undefined;
  let most = 0;
  for (const s of segments) {
    const overlap = area(intersectRect(s, box));
    if (overlap > most) {
      most = overlap;
      best = s;
    }
  }
  if (best) return best;
  let nearest: Rect | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const s of segments) {
    const d = Math.hypot(s.x + s.width / 2 - cx, s.y + s.height / 2 - cy);
    if (d < distance) {
      distance = d;
      nearest = s;
    }
  }
  return nearest;
}

/** Where a surface may live: its source's segment, or the largest one when nothing anchors it. It never crosses the fold. */
export function surfaceRegion(ctx: Pick<AdaptiveContext, 'window' | 'posture'>, source?: Rect): Rect {
  const segments = windowSegments(ctx);
  if (source) return segmentOf(source, segments) ?? segments[0]!;
  return segments.reduce((best, s) => (area(s) > area(best) ? s : best), segments[0]!);
}

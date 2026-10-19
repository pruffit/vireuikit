// What a smooth union of toolbar capsules looks like as one outline. A target that can only draw the body as one
// element clips it to this; the neck between two shapes is the one the material's own union would make.
import { sdfRoundedRect, smin } from 'vireglass';
import type { MorphBox } from '../adaptive/form-morph';

export type ToolbarAxis = 'x' | 'y';

const start = (b: MorphBox, a: ToolbarAxis) => (a === 'x' ? b.x : b.y);
const end = (b: MorphBox, a: ToolbarAxis) => (a === 'x' ? b.x + b.width : b.y + b.height);
const drawn = (b: MorphBox) => b.width > 0 && b.height > 0;

/**
 * Indices of the boxes that one smooth union with this `smoothing` holds together, each group in order along the axis.
 * Two neighbours join when the gap between them is under a quarter of the neck's width, which is where the union's
 * midpoint falls inside the shape; a box with no size is never part of a group of its own.
 */
export function toolbarClusters(boxes: readonly MorphBox[], smoothing: number, axis: ToolbarAxis): number[][] {
  const order = boxes.map((_, i) => i).sort((a, b) => start(boxes[a]!, axis) - start(boxes[b]!, axis));
  const groups: number[][] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;
  for (const i of order) {
    const box = boxes[i]!;
    const last = groups.at(-1);
    if (last && smoothing > 0 && start(box, axis) - groupEnd < smoothing / 2) {
      last.push(i);
      groupEnd = Math.max(groupEnd, end(box, axis));
    } else {
      groups.push([i]);
      groupEnd = end(box, axis);
    }
  }
  return groups;
}

export type ToolbarBounds = MorphBox;

/** The box that holds every drawn one. */
export function toolbarBounds(boxes: readonly MorphBox[]): MorphBox {
  const shown = boxes.filter(drawn);
  const list = shown.length ? shown : boxes;
  const x0 = Math.min(...list.map((b) => b.x));
  const y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.width));
  const y1 = Math.max(...list.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, radius: Math.min(x1 - x0, y1 - y0) / 2 };
}

/**
 * The outline of the smooth union of `boxes`, in the coordinates of their bounds: the top edge along the axis, then the
 * bottom edge back. Each column across the axis is found by bisection from the bounds' centre line, so the shapes are
 * expected to share it (they do: a toolbar is a row).
 */
export function toolbarSilhouette(boxes: readonly MorphBox[], smoothing: number, axis: ToolbarAxis, step = 1): [number, number][] {
  const bounds = toolbarBounds(boxes);
  const horizontal = axis === 'x';
  const length = horizontal ? bounds.width : bounds.height;
  const across = horizontal ? bounds.height : bounds.width;
  const parts = boxes.filter(drawn).map((b) => ({
    cu: (horizontal ? b.x + b.width / 2 : b.y + b.height / 2) - (horizontal ? bounds.x : bounds.y),
    cv: (horizontal ? b.y + b.height / 2 : b.x + b.width / 2) - (horizontal ? bounds.y : bounds.x),
    w: horizontal ? b.width : b.height,
    h: horizontal ? b.height : b.width,
    r: b.radius,
  }));
  const distance = (u: number, v: number) => {
    let d = Number.POSITIVE_INFINITY;
    for (const p of parts) {
      const next = sdfRoundedRect(u - p.cu, v - p.cv, p.w, p.h, p.r);
      d = d === Number.POSITIVE_INFINITY ? next : smoothing > 0 ? smin(d, next, smoothing) : Math.min(d, next);
    }
    return d;
  };
  const centre = across / 2;
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  const at = (u: number, v: number): [number, number] => (horizontal ? [u, v] : [v, u]);
  const columns = Math.max(Math.ceil(length / step), 1);
  for (let i = 0; i <= columns; i++) {
    const u = Math.min(i * step, length);
    if (distance(u, centre) >= 0) {
      top.push(at(u, centre));
      bottom.push(at(u, centre));
      continue;
    }
    const edge = (outside: number) => {
      let lo = outside;
      let hi = centre;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (distance(u, mid) < 0) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    top.push(at(u, edge(0)));
    bottom.push(at(u, edge(across)));
  }
  return [...top, ...bottom.reverse()];
}

/** `clip-path` for the outline. */
export function toolbarClipPath(points: readonly (readonly [number, number])[]): string {
  return `polygon(${points.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
}

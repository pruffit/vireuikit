// A stage change is one pure function of progress. Merging closes the gap between capsules until they touch, a neck
// holds them as they become one; overflow collapses the leaving slots into the capsule's end and buds "…" out of it.
// Only the compressing direction is written: widening is the same frame read backwards, so turning back retraces it.
import { smoothstep, stepSpring, type Spring } from '../morph';
import type { MorphBox } from '../adaptive/form-morph';
import type { ToolbarCapsuleBox, ToolbarGeometry } from './geometry';

/** Critically damped, fitted so the spring passes 95 % at about 0.38 s (M 4:46-4:53). */
export const TOOLBAR_MORPH_TIMING = { response: 0.5, damping: 1 } as const;
/** A change of place: the old toolbar leaves and the new one arrives inside about 0.3 s. */
export const TOOLBAR_PLACE_TIMING = { response: 0.4, damping: 1 } as const;

export type ToolbarFrame = {
  /** The capsules and "…" as glass shapes; index 0 is the lens body. */
  shapes: MorphBox[];
  /** The neck between shapes that are joining or separating, dp. */
  smoothing: number;
  slots: Record<string, { box: MorphBox; ink: number }>;
  more: { box: MorphBox; presence: number } | null;
  /** The shapes' members, for a morph that goes on from this frame. */
  capsules: ToolbarCapsuleBox[];
};

/** Progress at which facing capsules touch and a merge becomes one shape. */
const CONTACT = 0.7;
const INK_OUT = 0.4;
const NECK = 0.35;

type Axis = 'x' | 'y';
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixBox = (a: MorphBox, b: MorphBox, t: number): MorphBox => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  width: mix(a.width, b.width, t),
  height: mix(a.height, b.height, t),
  radius: mix(a.radius, b.radius, t),
});
const start = (b: MorphBox, a: Axis) => (a === 'x' ? b.x : b.y);
const end = (b: MorphBox, a: Axis) => (a === 'x' ? b.x + b.width : b.y + b.height);
const along = (ref: MorphBox, a: Axis, s: number, e: number): MorphBox =>
  a === 'x'
    ? { x: s, y: ref.y, width: e - s, height: ref.height, radius: Math.min(e - s, ref.height) / 2 }
    : { x: ref.x, y: s, width: ref.width, height: e - s, radius: Math.min(e - s, ref.width) / 2 };
const point = (a: Axis, alongAt: number, crossAt: number): MorphBox =>
  a === 'x' ? { x: alongAt, y: crossAt, width: 0, height: 0, radius: 0 } : { x: crossAt, y: alongAt, width: 0, height: 0, radius: 0 };
const crossCentre = (b: MorphBox, a: Axis) => (a === 'x' ? b.y + b.height / 2 : b.x + b.width / 2);
const bounds = (boxes: readonly MorphBox[]): MorphBox => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, radius: Math.min(x1 - x0, y1 - y0) / 2 };
};

const bud = (x: number) => smoothstep(0.1, 1, x);
const budNeck = (b: number) => smoothstep(0, 0.25, b) * (1 - smoothstep(0.4, 1, b));
const breadth = (g: ToolbarGeometry) => Object.keys(g.slots).length * 1000 + g.capsules.length;

function restFrame(g: ToolbarGeometry): ToolbarFrame {
  const slots: ToolbarFrame['slots'] = {};
  for (const [id, box] of Object.entries(g.slots)) slots[id] = { box, ink: g.carry?.ink[id] ?? 1 };
  const more = g.more ? { box: g.more, presence: g.carry?.morePresence ?? 1 } : null;
  return {
    shapes: [...g.capsules.map((c) => c.box), ...(more ? [more.box] : [])],
    smoothing: g.carry?.smoothing ?? 0,
    slots,
    more,
    capsules: [...g.capsules],
  };
}

const itemsOf = (g: ToolbarGeometry) => [...g.capsules.flatMap((c) => c.items), ...Object.keys(g.slots)];

function unionOrder(wide: ToolbarGeometry, narrow: ToolbarGeometry): string[] {
  const f = itemsOf(wide);
  const t = itemsOf(narrow);
  const inW = new Set(f);
  const inN = new Set(t);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!seen.has(id)) out.push(id);
    seen.add(id);
  };
  let j = 0;
  for (const id of f) {
    if (inN.has(id)) {
      while (j < t.length && t[j] !== id) {
        if (!inW.has(t[j]!)) push(t[j]!);
        j++;
      }
      j++;
    }
    push(id);
  }
  for (; j < t.length; j++) push(t[j]!);
  return out;
}

/** `u` 0 is `wide` at rest, 1 is `narrow` at rest. */
function compress(wide: ToolbarGeometry, narrow: ToolbarGeometry, u: number): ToolbarFrame {
  const a: Axis = wide.orientation === 'vertical' ? 'y' : 'x';
  const p = clamp01(u / CONTACT);
  const order = unionOrder(wide, narrow);
  const stays = (id: string) => id in wide.slots && id in narrow.slots;

  const boxes: Record<string, MorphBox> = {};
  for (const id of order) if (stays(id)) boxes[id] = mixBox(wide.slots[id]!, narrow.slots[id]!, p);
  // A slot that comes or goes collapses into the nearest stayer, so nothing crosses a neighbour.
  const collapse = (index: number, fallback: number) => {
    for (let k = index - 1; k >= 0; k--) if (stays(order[k]!)) return end(boxes[order[k]!]!, a);
    for (let k = index + 1; k < order.length; k++) if (stays(order[k]!)) return start(boxes[order[k]!]!, a);
    return fallback;
  };
  order.forEach((id, index) => {
    const w = wide.slots[id];
    const n = narrow.slots[id];
    if (w && !n && p < 1) {
      const at = collapse(index, end(w, a));
      boxes[id] = along(w, a, mix(start(w, a), at, p), mix(end(w, a), at, p));
    } else if (n && !w && p > 0) {
      const at = collapse(index, start(n, a));
      boxes[id] = along(n, a, mix(at, start(n, a), p), mix(at, end(n, a), p));
    }
  });

  let capsules: ToolbarCapsuleBox[];
  const narrowOf = (id: string) => narrow.capsules.findIndex((c) => c.items.includes(id));
  const wideOf = (id: string) => wide.capsules.findIndex((c) => c.items.includes(id));
  const joined = new Map<number, Set<number>>();
  for (const id of order) if (stays(id)) joined.set(narrowOf(id), (joined.get(narrowOf(id)) ?? new Set<number>()).add(wideOf(id)));
  const merging = [...joined.values()].some((set) => set.size > 1);
  if (p >= 1) {
    capsules = [...narrow.capsules];
  } else {
    const extra = new Map<number, string[]>();
    for (const id of order) {
      if (id in wide.slots || !(id in boxes)) continue;
      const mate = order.find((o) => stays(o) && narrowOf(o) === narrowOf(id));
      if (mate !== undefined) extra.set(wideOf(mate), [...(extra.get(wideOf(mate)) ?? []), id]);
    }
    capsules = [];
    wide.capsules.forEach((c, ci) => {
      const ids = [...c.items.filter((id) => id in boxes), ...(extra.get(ci) ?? [])];
      if (!ids.length) return;
      let box = bounds(ids.map((id) => boxes[id]!));
      if (c.items.every((id) => !(id in narrow.slots))) {
        const half = (a === 'x' ? box.height : box.width) * (1 - p);
        const centre = crossCentre(box, a);
        box = a === 'x' ? { ...box, y: centre - half / 2, height: half } : { ...box, x: centre - half / 2, width: half };
        box.radius = Math.min(box.width, box.height) / 2;
      }
      capsules.push({ kind: c.kind, items: ids, box });
    });
  }

  const slots: ToolbarFrame['slots'] = {};
  for (const id of order) {
    const box = boxes[id];
    if (!box) continue;
    const inkW = wide.carry?.ink[id] ?? 1;
    const inkN = narrow.carry?.ink[id] ?? 1;
    const ink = stays(id)
      ? mix(inkW, inkN, smoothstep(0, INK_OUT, u))
      : id in wide.slots
        ? inkW * (1 - smoothstep(0, INK_OUT, u))
        : inkN * smoothstep(1 - INK_OUT, 1, u);
    slots[id] = { box, ink };
  }

  const neck = NECK * wide.side;
  let smoothing = 0;
  if (merging) smoothing = neck * smoothstep(CONTACT - 0.35, CONTACT, u) * (1 - smoothstep(CONTACT, CONTACT + 0.2, u));
  smoothing = Math.max(
    smoothing,
    (wide.carry?.smoothing ?? 0) * (1 - smoothstep(0, 0.3, u)),
    (narrow.carry?.smoothing ?? 0) * smoothstep(0.7, 1, u),
  );

  const last = [...capsules].reverse().find((c) => c.kind !== 'primary');
  const folded = (ref: MorphBox) =>
    point(a, last ? end(last.box, a) - wide.side / 2 : (start(ref, a) + end(ref, a)) / 2, crossCentre(ref, a));
  let more: ToolbarFrame['more'] = null;
  const wm = wide.more;
  const nm = narrow.more;
  const presenceW = wide.carry?.morePresence ?? 1;
  const presenceN = narrow.carry?.morePresence ?? 1;
  if (wm && nm) {
    more = { box: mixBox(wm, nm, p), presence: mix(presenceW, presenceN, p) };
  } else if (nm) {
    const b = bud(u);
    if (b > 0) {
      more = { box: mixBox(folded(nm), nm, b), presence: presenceN * b };
      smoothing = Math.max(smoothing, neck * budNeck(b));
    }
  } else if (wm) {
    const b = bud(1 - u);
    if (b > 0) {
      more = { box: mixBox(folded(wm), wm, b), presence: presenceW * b };
      smoothing = Math.max(smoothing, neck * budNeck(b));
    }
  }

  return {
    shapes: [...capsules.map((c) => c.box), ...(more ? [more.box] : [])],
    smoothing,
    slots,
    more,
    capsules,
  };
}

/**
 * The frame at progress `t` (0 is `from` at rest, 1 is `to` at rest). Merging brings capsules together until they
 * touch at 70 % of the way, with the neck holding them; the rest settles the joined body. Item boxes move
 * continuously and never cross.
 */
export function toolbarMorphFrame(from: ToolbarGeometry, to: ToolbarGeometry, t: number): ToolbarFrame {
  if (t <= 0) return restFrame(from);
  if (t >= 1) return restFrame(to);
  return breadth(from) >= breadth(to) ? compress(from, to, t) : compress(to, from, 1 - t);
}

/** The outgoing toolbar dematerialises over the first half of a change of place, the incoming one over the second. */
export function toolbarPlaceFrame(t: number): { outgoing: number; incoming: number } {
  return { outgoing: 1 - smoothstep(0, 0.5, t), incoming: smoothstep(0.5, 1, t) };
}

export type ToolbarMorphState = {
  /** 0 is the geometry it comes from, 1 the one it goes to. */
  t: Spring;
  from: ToolbarGeometry;
  to: ToolbarGeometry;
};

/** Resting at `at`. */
export const createToolbarMorph = (at: ToolbarGeometry): ToolbarMorphState => ({
  t: { x: 0, v: 0, target: 0 },
  from: at,
  to: at,
});

const near = (a: MorphBox, b: MorphBox) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height) + Math.abs(a.radius - b.radius) < 1e-6;
const nearOrBoth = (a: MorphBox | null, b: MorphBox | null) => (a && b ? near(a, b) : a === b);

function sameGeometry(a: ToolbarGeometry, b: ToolbarGeometry): boolean {
  const ids = Object.keys(a.slots);
  return (
    a.orientation === b.orientation &&
    a.capsules.length === b.capsules.length &&
    a.capsules.every((c, i) => c.kind === b.capsules[i]!.kind && c.items.join() === b.capsules[i]!.items.join() && near(c.box, b.capsules[i]!.box)) &&
    ids.length === Object.keys(b.slots).length &&
    ids.every((id) => b.slots[id] !== undefined && near(a.slots[id]!, b.slots[id]!)) &&
    nearOrBoth(a.more, b.more) &&
    !a.carry &&
    !b.carry
  );
}

export function currentToolbarFrame(state: ToolbarMorphState): ToolbarFrame {
  return toolbarMorphFrame(state.from, state.to, clamp01(state.t.x));
}

function frameGeometry(frame: ToolbarFrame, like: ToolbarGeometry): ToolbarGeometry {
  const slots: Record<string, MorphBox> = {};
  const ink: Record<string, number> = {};
  for (const [id, s] of Object.entries(frame.slots)) {
    slots[id] = s.box;
    ink[id] = s.ink;
  }
  return {
    orientation: like.orientation,
    extent: like.extent,
    side: like.side,
    capsules: frame.capsules,
    slots,
    more: frame.more?.box ?? null,
    aside: null,
    carry: { ink, morePresence: frame.more?.presence ?? 1, smoothing: frame.smoothing },
  };
}

const atRest = (s: ToolbarMorphState) => s.t.v === 0 && s.t.x === s.t.target && (s.t.x === 0 || s.t.x === 1);

/**
 * Aims the morph at a geometry. At rest it starts a morph; aimed back at where it came from it turns back; a new
 * target mid-way freezes the current frame as the start, so nothing jumps.
 */
export function aimToolbarMorph(state: ToolbarMorphState, next: ToolbarGeometry): void {
  const { t } = state;
  if (atRest(state)) {
    const current = t.x >= 1 ? state.to : state.from;
    if (sameGeometry(current, next)) {
      if (t.x >= 1) state.to = next;
      else state.from = next;
      return;
    }
    state.from = current;
    state.to = next;
    t.x = 0;
    t.v = 0;
    t.target = 1;
    return;
  }
  if (sameGeometry(next, state.to)) {
    state.to = next;
    t.target = 1;
    return;
  }
  if (sameGeometry(next, state.from)) {
    state.from = next;
    t.target = 0;
    return;
  }
  state.from = frameGeometry(currentToolbarFrame(state), state.to);
  state.to = next;
  t.x = 0;
  t.v = 0;
  t.target = 1;
}

/** True while moving. Reduced motion lands in one step. */
export function stepToolbarMorph(state: ToolbarMorphState, dt: number, reduceMotion = false): boolean {
  return stepSpring(state.t, dt, TOOLBAR_MORPH_TIMING.response, TOOLBAR_MORPH_TIMING.damping, reduceMotion);
}

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROWTH_TIMING,
  SHEET_GROWTH_TIMING,
  SHEET_SIZES,
  adaptiveContext,
  createGrowthState,
  createSheetDrag,
  createSheetGrowth,
  defaultSheetDetents,
  menuPlacement,
  menuSurfaceFrame,
  moveSheetDrag,
  namedSheetDetents,
  parseDetentLabels,
  cancelSheetDrag,
  sheetClipBottom,
  popoverGrowthFrame,
  popoverPlacement,
  pressSheetDrag,
  presentationForm,
  releaseSheetDrag,
  scrimCloses,
  sheetContentDrag,
  sheetTouchAction,
  sheetUsesGlass,
  sheetDetents,
  sheetEntryFrame,
  sheetForKeyboard,
  sheetGrabber,
  sheetGrowthFrame,
  sheetInset,
  sheetLayout,
  sheetPeekContent,
  sheetOpacity,
  sheetRadius,
  surfaceInk,
  sheetResistance,
  stepGrowth,
  stepSheetGrowth,
  stepSheetHeight,
  type SheetDragState,
  type Size,
  type SurfaceKind,
} from '../index';

const phone: Size = { width: 390, height: 800 };
const tablet: Size = { width: 700, height: 900 };
const desktop: Size = { width: 1440, height: 900 };
const wide: Size = { width: 1800, height: 1000 };

const formFor = (kind: SurfaceKind, window: Size, source?: { x: number; y: number; width: number; height: number }) =>
  presentationForm(kind, adaptiveContext({ window }), source);

describe('sheetInset, sheetRadius and sheetOpacity', () => {
  it('shrinks the inset piecewise linearly: 12 to 30 %, 6 at 55 %, flush from 90 %', () => {
    expect(sheetInset(0.1)).toBe(12);
    expect(sheetInset(0.3)).toBe(12);
    expect(sheetInset(0.55)).toBeCloseTo(6, 9);
    expect(sheetInset(0.425)).toBeCloseTo(9, 9);
    expect(sheetInset(0.725)).toBeCloseTo(3, 9);
    expect(sheetInset(0.9)).toBe(0);
    expect(sheetInset(1)).toBe(0);
  });

  it('never grows as the sheet rises', () => {
    let last = Infinity;
    for (let f = 0; f <= 1; f += 0.01) {
      const inset = sheetInset(f);
      expect(inset).toBeLessThanOrEqual(last + 1e-9);
      last = inset;
    }
  });

  it('is 32 dp inset and 28 dp flush', () => {
    expect(sheetRadius(0.2)).toBe(32);
    expect(sheetRadius(0.95)).toBe(28);
    expect(sheetRadius(0.55)).toBeGreaterThan(28);
    expect(sheetRadius(0.55)).toBeLessThan(32);
  });

  it('is glass up to a quarter of the window, about half dense at medium and opaque from 90 %', () => {
    expect(sheetOpacity(0.1)).toBe(0);
    expect(sheetOpacity(0.25)).toBe(0);
    expect(sheetOpacity(0.55)).toBeGreaterThan(0.4);
    expect(sheetOpacity(0.55)).toBeLessThan(0.5);
    expect(sheetOpacity(0.9)).toBe(1);
    expect(sheetOpacity(1)).toBe(1);
  });

  it('never thins as the sheet rises', () => {
    let last = -1;
    for (let f = 0; f <= 1; f += 0.01) {
      const o = sheetOpacity(f);
      expect(o).toBeGreaterThanOrEqual(last);
      last = o;
    }
  });
});

describe('sheetDetents', () => {
  it('gives a supplementary sheet medium and large', () => {
    expect(sheetDetents('sheet', phone)).toEqual([400, 744]);
  });

  it('gives a modal sheet and a picker only large, 56 dp from the top', () => {
    expect(sheetDetents('modal-sheet', phone)).toEqual([744]);
    expect(sheetDetents('picker', phone)).toEqual([744]);
  });

  it('gives a popover its content height, clamped between 120 dp and large', () => {
    expect(sheetDetents('popover', phone, { content: 300 })).toEqual([300]);
    expect(sheetDetents('popover', phone, { content: 40 })).toEqual([120]);
    expect(sheetDetents('popover', phone, { content: 5000 })).toEqual([744]);
  });

  it('takes the detents attribute over the kind and adds peek only when the content is known', () => {
    expect(sheetDetents('sheet', phone, { detents: ['peek', 'medium', 'large'], content: 200 })).toEqual([200, 400, 744]);
    expect(sheetDetents('sheet', phone, { detents: ['peek', 'large'] })).toEqual([744]);
  });

  it('sorts and removes repeats', () => {
    expect(sheetDetents('sheet', phone, { detents: ['large', 'peek', 'medium', 'large'], content: 400 })).toEqual([400, 744]);
  });

  it('keeps the tallest detent named large on a window under 112 dp', () => {
    const all = { detents: ['peek', 'medium', 'large'] as const, content: 80 };
    const tiny = namedSheetDetents('sheet', { width: 390, height: 100 }, all);
    expect(tiny).toEqual([{ name: 'large', height: 50, names: ['peek', 'medium', 'large'] }]);
    const sliver = namedSheetDetents('sheet', { width: 390, height: 60 }, all);
    expect(sliver).toEqual([{ name: 'large', height: 30, names: ['peek', 'medium', 'large'] }]);
  });

  it('merges detents closer than 24 dp under the larger name and keeps those 24 dp apart', () => {
    expect(namedSheetDetents('sheet', { width: 390, height: 130 })).toEqual([{ name: 'large', height: 74, names: ['medium', 'large'] }]);
    expect(sheetDetents('sheet', { width: 390, height: 160 })).toEqual([80, 104]);
    expect(sheetDetents('sheet', phone)).toEqual([400, 744]);
  });

  it('names every detent that lands on a height, the largest first as its name', () => {
    const steps = namedSheetDetents('sheet', phone, { detents: ['peek', 'medium', 'large'], content: 400 });
    expect(steps).toEqual([
      { name: 'medium', height: 400, names: ['peek', 'medium'] },
      { name: 'large', height: 744, names: ['large'] },
    ]);
  });
});

describe('parseDetentLabels', () => {
  it('reads name=text pairs and drops what it does not know', () => {
    expect(parseDetentLabels('peek=Small; medium = Half ; large=Full screen; huge=No; medium2')).toEqual({ peek: 'Small', medium: 'Half', large: 'Full screen' });
    expect(parseDetentLabels(null)).toEqual({});
    expect(parseDetentLabels('peek=')).toEqual({});
  });
});

describe('sheetLayout, bottom sheet', () => {
  const content = { width: 300, height: 2000 };
  const at = (height: number, window = phone, extra = {}) => {
    const form = formFor('sheet', window);
    return sheetLayout({ form, window, source: null, content, height, ...extra });
  };

  it('floats inset with symmetric sides at a low height', () => {
    const l = at(240);
    expect(l.box.x).toBe(12);
    expect(l.box.width).toBe(phone.width - 24);
    expect(l.box.y + l.box.height).toBeCloseTo(phone.height - 12, 9);
    expect(l.box.radius).toBe(32);
    expect(l.glass).toBe(true);
    expect(l.opacity).toBeLessThan(0.05);
  });

  it('is flush, opaque and runs its bottom corners off the window at large', () => {
    const l = at(744);
    expect(l.box.x).toBe(0);
    expect(l.box.width).toBe(phone.width);
    expect(l.box.y).toBe(56);
    expect(l.box.y + l.box.height).toBe(phone.height + 28);
    expect(l.box.radius).toBe(28);
    expect(l.opacity).toBe(1);
    expect(l.glass).toBe(false);
  });

  it('keeps its top where the height puts it while the bottom edge moves with the inset', () => {
    for (const h of [200, 400, 560, 744]) expect(at(h).box.y).toBe(phone.height - h);
  });

  it('stops at 640 dp and centres on a medium window', () => {
    const l = at(400, tablet);
    expect(l.box.width).toBe(640);
    expect(l.box.x).toBe(30);
    expect(l.box.x * 2 + l.box.width).toBeCloseTo(tablet.width, 9);
    const wideSheet = at(400, { width: 800, height: 900 });
    expect(wideSheet.box.width).toBe(640);
    expect(wideSheet.box.x).toBe(80);
  });

  it('stays clear of a bottom safe area while floating, and ignores it when flush', () => {
    const floating = at(240, phone, { bottomInset: 34 });
    expect(floating.box.y + floating.box.height).toBeCloseTo(phone.height - 34, 9);
    const flush = at(744, phone, { bottomInset: 34 });
    expect(flush.box.y + flush.box.height).toBe(phone.height + 28);
  });

  it('is scrollable when its content is taller than the visible height', () => {
    expect(at(400).scrollable).toBe(true);
    const short = sheetLayout({ form: formFor('sheet', phone), window: phone, source: null, content: { width: 300, height: 100 }, height: 400 });
    expect(short.scrollable).toBe(false);
  });

  it('draws a grabber at the top centre only when it applies', () => {
    const on = at(400, phone, { grabber: true });
    expect(on.grabber).toMatchObject({ width: 44, height: 44, y: on.box.y });
    expect(on.grabber!.x + 22).toBeCloseTo(on.box.x + on.box.width / 2, 9);
    expect(at(400).grabber).toBeNull();
  });

  it('keeps the floor under a scrim: a popover that became a sheet is never thinner than a dialog', () => {
    const form = formFor('popover', phone);
    expect(form.form).toBe('bottom-sheet');
    expect(form.scrim).toBe(true);
    const l = sheetLayout({ form, window: phone, source: null, content, height: 240 });
    expect(l.opacity).toBe(SHEET_SIZES.opacity.overScrim);
    expect(sheetLayout({ form, window: phone, source: null, content, height: 744 }).opacity).toBe(1);
  });

  it('carries the form scrim', () => {
    expect(at(400).scrim).toBe(false);
    const modal = sheetLayout({ form: formFor('modal-sheet', phone), window: phone, source: null, content, height: 744 });
    expect(modal.scrim).toBe(true);
  });
});

describe('surfaceInk', () => {
  it('writes dark over a light body and light over a dark one', () => {
    expect(surfaceInk(0.9, 0, 1)).toBe('dark');
    expect(surfaceInk(0.1, 0, 1)).toBe('light');
  });

  it('reads the backdrop as the body lets it through: a mid-grey glass body takes dark ink, a dense one follows its own colour', () => {
    expect(surfaceInk(0.63, 0, 1)).toBe('dark');
    expect(surfaceInk(0.2, 1, 1)).toBe('dark');
    expect(surfaceInk(0.9, 1, 0.07)).toBe('light');
  });

  it('flips where the two inks read equally well, never inside a pole', () => {
    const flips: number[] = [];
    let last = surfaceInk(0, 0, 1);
    for (let l = 0; l <= 1; l += 0.01) {
      const now = surfaceInk(l, 0, 1);
      if (now !== last) flips.push(l);
      last = now;
    }
    expect(flips).toHaveLength(1);
    expect(flips[0]!).toBeGreaterThan(0.35);
    expect(flips[0]!).toBeLessThan(0.65);
  });
});

describe('sheetGrabber', () => {
  it('is a 44 dp hit area with a 32 by 4 line 8 dp from the top', () => {
    const { hit, line } = sheetGrabber({ x: 10, y: 100, width: 200, height: 300, radius: 32 });
    expect(hit).toMatchObject({ x: 88, y: 100, width: 44, height: 44 });
    expect(line).toMatchObject({ x: 94, y: 108, width: 32, height: 4 });
  });
});

describe('sheetLayout in a region of the window', () => {
  const region = { x: 0, y: 0, width: 390, height: 400 };
  const content = { width: 300, height: 2000 };

  it('clamps a bottom sheet to the region, not the window, and sets its bottom on the region', () => {
    const form = { ...formFor('sheet', phone), region };
    const l = sheetLayout({ form, window: phone, source: null, content, height: 1000 });
    expect(l.box.y).toBe(0);
    expect(l.box.y + l.box.height).toBe(region.height + 28);
    expect(sheetClipBottom(l.box, region)).toBe(28);
    expect(l.opacity).toBe(1);
  });

  it('takes the density from the share of the region', () => {
    const form = { ...formFor('sheet', phone), region };
    const l = sheetLayout({ form, window: phone, source: null, content, height: 200 });
    expect(l.opacity).toBeCloseTo(sheetOpacity(0.5), 9);
    expect(l.box.radius).toBeCloseTo(sheetRadius(0.5), 9);
  });

  it('stands on what the keyboard leaves of the region and keeps its density by the whole region', () => {
    const form = formFor('sheet', phone);
    const free = sheetLayout({ form, window: phone, source: null, content, height: 400 });
    const lifted = sheetLayout({ form, window: phone, source: null, content, height: 400, lift: 300 });
    expect(lifted.box.y).toBe(free.box.y - 300);
    expect(lifted.opacity).toBe(free.opacity);
    expect(sheetLayout({ form, window: phone, source: null, content, height: 700, lift: 300 }).box.y).toBe(phone.height - 300 - 500);
  });

  it('limits a centred sheet to the region minus the window gap', () => {
    const form = { ...formFor('modal-sheet', tablet), region: { x: 0, y: 0, width: 700, height: 400 } };
    expect(form.form).toBe('centered-sheet');
    const l = sheetLayout({ form, window: tablet, source: null, content });
    expect(l.box.height).toBe(400 - SHEET_SIZES.windowGap);
  });

  it('counts a glass lens by the region too', () => {
    expect(sheetUsesGlass('bottom-sheet', [200], { width: 390, height: 400 })).toBe(true);
    expect(sheetUsesGlass('bottom-sheet', [200], phone)).toBe(true);
    expect(sheetUsesGlass('bottom-sheet', [370], { width: 390, height: 400 })).toBe(false);
    expect(sheetUsesGlass('bottom-sheet', [370], phone)).toBe(true);
  });

  it('clips nothing above the bottom edge of the region', () => {
    expect(sheetClipBottom({ x: 0, y: 0, width: 1, height: 300, radius: 0 }, region)).toBe(0);
  });
});

describe('sheetLayout, other forms', () => {
  const content = { width: 320, height: 400 };

  it('puts a side sheet 360 wide, inset 8, glass, narrowing the content by its width and gaps', () => {
    const form = formFor('sheet', desktop);
    expect(form.form).toBe('side-sheet');
    const l = sheetLayout({ form, window: desktop, source: null, content });
    expect(l.box).toEqual({ x: 1440 - 8 - 360, y: 8, width: 360, height: 884, radius: 24 });
    expect(l.glass).toBe(true);
    expect(l.insetEnd).toBe(376);
  });

  it('holds a side sheet to a third of the window, 280 dp at least', () => {
    const narrow = { width: 840, height: 800 };
    const l = sheetLayout({ form: formFor('sheet', narrow), window: narrow, source: null, content });
    expect(l.box.width).toBe(280);
  });

  it('makes the third pane the same box, opaque and not glass', () => {
    const form = formFor('sheet', wide);
    expect(form.form).toBe('side-pane');
    const pane = sheetLayout({ form, window: wide, source: null, content });
    expect(pane.box.width).toBe(360);
    expect(pane.glass).toBe(false);
    expect(pane.opacity).toBe(1);
    expect(pane.insetEnd).toBe(376);
  });

  it('centres a sheet or basic dialog at min(560, window - 48) and scrolls what exceeds the height', () => {
    const form = formFor('modal-sheet', desktop);
    expect(form.form).toBe('centered-sheet');
    const l = sheetLayout({ form, window: desktop, source: null, content: { width: 500, height: 3000 } });
    expect(l.box).toMatchObject({ width: 560, height: 852, radius: 28 });
    expect(l.box.x).toBe(440);
    expect(l.box.y).toBe(24);
    expect(l.scrollable).toBe(true);
    const small = sheetLayout({ form, window: desktop, source: null, content });
    expect(small.box.height).toBe(400);
    expect(small.box.y).toBe(250);
    expect(small.scrollable).toBe(false);
    const basic = formFor('dialog', desktop);
    expect(basic.form).toBe('basic-dialog');
    expect(sheetLayout({ form: basic, window: desktop, source: null, content }).box.width).toBe(560);
    const narrow = { width: 600, height: 900 };
    expect(sheetLayout({ form: formFor('dialog', narrow), window: narrow, source: null, content }).box.width).toBe(552);
  });

  it('gives a centred sheet, a basic dialog and an alert the density floor over their scrim', () => {
    for (const kind of ['modal-sheet', 'dialog', 'alert'] as const) {
      const form = formFor(kind, desktop);
      const l = sheetLayout({ form, window: desktop, source: null, content });
      expect(form.scrim).toBe(true);
      expect(l.opacity).toBe(SHEET_SIZES.opacity.overScrim);
      expect(l.glass).toBe(true);
    }
  });

  it('makes an alert min(320, window - 48) wide', () => {
    const alert = sheetLayout({ form: formFor('alert', desktop), window: desktop, source: null, content });
    expect(alert.box.width).toBe(320);
    const small = { width: 340, height: 700 };
    expect(sheetLayout({ form: formFor('alert', small), window: small, source: null, content }).box.width).toBe(292);
  });

  it('fills the window flush and opaque in full screen', () => {
    const form = formFor('dialog', phone);
    expect(form.form).toBe('full-screen');
    const l = sheetLayout({ form, window: phone, source: null, content });
    expect(l.box).toEqual({ x: 0, y: 0, width: 390, height: 800, radius: 0 });
    expect(l.opacity).toBe(1);
    expect(l.glass).toBe(false);
  });

  it('places a popover with the menu, in its source segment, up to 400 wide with a margin of 8', () => {
    const source = { x: 1000, y: 40, width: 40, height: 40, radius: 20 };
    const form = formFor('popover', desktop, source);
    expect(form.form).toBe('popover');
    const l = sheetLayout({ form, window: desktop, source, content: { width: 900, height: 300 } });
    expect(l.box.width).toBe(400);
    expect(l.box.radius).toBe(28);
    const expected = menuPlacement(source, { width: 400, height: 300 }, form.region, { margin: 8 });
    expect(l.box).toMatchObject(expected.rect);
    expect(popoverPlacement(form, source, { width: 900, height: 300 })).toEqual(expected);
    const nearEdge = sheetLayout({ form, window: desktop, source: { ...source, x: 1420 }, content: { width: 200, height: 300 } });
    expect(nearEdge.box.x + nearEdge.box.width).toBeLessThanOrEqual(desktop.width - 8);
  });
});

describe('the sizes', () => {
  it('holds the numbers of the spec', () => {
    expect(SHEET_SIZES.detent).toEqual({ medium: 0.5, largeTopGap: 56, peekMin: 120, merge: 24 });
    expect(SHEET_SIZES.drag).toEqual({ distance: 56, velocity: 125, zone: 125, stale: 0.1 });
    expect(SHEET_SIZES.side).toMatchObject({ width: 360, min: 280, max: 400, inset: 8, radius: 24 });
    expect(SHEET_SIZES.dialog).toMatchObject({ width: 560, alertWidth: 320 });
    expect(SHEET_SIZES.scrimAlpha).toBe(0.32);
    expect(SHEET_SIZES.entryScale).toBe(0.96);
  });

  // The menu's growth was fitted to M 5:11 after the popover took its pace from it; the popover keeps that pace.
  it("slows the pace the menu's growth had before the reference by a quarter", () => {
    expect(SHEET_GROWTH_TIMING.growOpen).toBeCloseTo(0.38 * 1.25, 9);
    expect(SHEET_GROWTH_TIMING.growClose).toBeCloseTo(0.4 * 1.25, 9);
    expect(SHEET_GROWTH_TIMING.growOpen).toBeLessThan(DEFAULT_GROWTH_TIMING.growOpen);
  });
});

describe('growth and closing frames', () => {
  const trigger = { x: 300, y: 700, width: 44, height: 44, radius: 22 };
  const box = { x: 12, y: 400, width: 366, height: 388, radius: 32 };

  it('takes the popover through the menu growth', () => {
    const panel = { x: 100, y: 100, width: 240, height: 200, radius: 28 };
    const anchor = { x: 340, y: 300 };
    const phase = { shrink: 1, grow: 0.5 };
    expect(popoverGrowthFrame(trigger, panel, anchor, phase)).toEqual(menuSurfaceFrame(trigger, panel, anchor, phase));
  });

  it('runs a sheet straight from the trigger to the box with no drop', () => {
    expect(sheetGrowthFrame(trigger, box, 0).box).toEqual(trigger);
    expect(sheetGrowthFrame(trigger, box, 1).box).toEqual(box);
    const half = sheetGrowthFrame(trigger, box, 0.5).box;
    expect(half.width).toBeCloseTo((44 + 366) / 2, 9);
    expect(half.x).toBeCloseTo((300 + 12) / 2, 9);
    expect(half.radius).toBeGreaterThan(22);
    expect(half.radius).toBeLessThan(32);
    for (let t = 0.1; t <= 1; t += 0.1) {
      const b = sheetGrowthFrame(trigger, box, t).box;
      expect(b.width).toBeGreaterThanOrEqual(44 - 1e-9);
    }
  });

  it('defocuses the trigger early and brings the content in near size', () => {
    expect(sheetGrowthFrame(trigger, box, 0).ink).toEqual({ outgoing: 1, incoming: 0 });
    expect(sheetGrowthFrame(trigger, box, 0.3).ink.outgoing).toBe(0);
    expect(sheetGrowthFrame(trigger, box, 0.85).ink.incoming).toBe(0);
    expect(sheetGrowthFrame(trigger, box, 1).ink).toEqual({ outgoing: 0, incoming: 1 });
    expect(sheetGrowthFrame(trigger, box, 0.5).content).toEqual({ x: box.x - sheetGrowthFrame(trigger, box, 0.5).box.x, y: box.y - sheetGrowthFrame(trigger, box, 0.5).box.y });
  });

  it('opens within 2 % overshoot and runs back without any', () => {
    const state = createSheetGrowth();
    let peak = 0;
    let time = 0;
    while (stepSheetGrowth(state, 1 / 120, true) && time < 5) {
      peak = Math.max(peak, state.x);
      time += 1 / 120;
    }
    expect(peak).toBeLessThanOrEqual(1.02);
    expect(peak).toBeGreaterThan(1);
    expect(state.x).toBe(1);
    let low = 1;
    while (stepSheetGrowth(state, 1 / 120, false)) low = Math.min(low, state.x);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(state.x).toBe(0);
  });

  it('is slower than the menu growth and lands in one frame under reduced motion', () => {
    const settle = (step: (dt: number) => boolean) => {
      let t = 0;
      while (step(1 / 120) && t < 5) t += 1 / 120;
      return t;
    };
    const sheet = createSheetGrowth();
    const menu = createGrowthState();
    expect(settle((dt) => stepSheetGrowth(sheet, dt, true))).toBeGreaterThan(
      settle((dt) => {
        stepGrowth(menu, dt, true, false, { ...DEFAULT_GROWTH_TIMING, growOpen: 0.38, growDampingOpen: 0.72 });
        return menu.grow.x !== 1 || menu.grow.target !== 1;
      }) * 0.9,
    );
    const instant = createSheetGrowth();
    stepSheetGrowth(instant, 1 / 60, true, true);
    expect(instant.x).toBe(1);
  });

  it('rises from below the window edge without a trigger', () => {
    const start = sheetEntryFrame(box, 0, 'bottom', phone);
    expect(start.box.y).toBe(phone.height);
    expect(sheetEntryFrame(box, 1, 'bottom', phone).box).toEqual(box);
    expect(sheetEntryFrame(box, 0.5, 'bottom', phone).box.y).toBeCloseTo((box.y + phone.height) / 2, 9);
  });

  it('comes in from 96 % scale with the content fading in', () => {
    const start = sheetEntryFrame(box, 0, 'scale', phone);
    expect(start.box.width).toBeCloseTo(box.width * 0.96, 9);
    expect(start.box.x + start.box.width / 2).toBeCloseTo(box.x + box.width / 2, 9);
    expect(start.box.y + start.box.height / 2).toBeCloseTo(box.y + box.height / 2, 9);
    expect(start.ink.incoming).toBe(0);
    const end = sheetEntryFrame(box, 1, 'scale', phone);
    expect(end.box).toEqual(box);
    expect(end.ink.incoming).toBe(1);
  });
});

describe('the drag', () => {
  const detents = [400, 744];
  const drag = (height: number, y = 600): SheetDragState => {
    const s = createSheetDrag();
    pressSheetDrag(s, height, y);
    return s;
  };
  /** Moves a finger from `from` to `to` over `seconds`, at 60 Hz. */
  const swipe = (s: SheetDragState, from: number, to: number, seconds: number): number => {
    const frames = Math.max(1, Math.round(seconds * 60));
    let h = s.height.x;
    for (let i = 1; i <= frames; i += 1) h = moveSheetDrag(s, from + ((to - from) * i) / frames, 1 / 60, detents, phone);
    return h;
  };

  it('follows the finger exactly between the lowest and the largest detent', () => {
    const s = drag(500);
    expect(moveSheetDrag(s, 560, 1 / 60, detents, phone)).toBe(540);
    expect(moveSheetDrag(s, 450, 1 / 60, detents, phone)).toBe(650);
    expect(s.height.x).toBe(650);
  });

  it('follows down below the lowest without resistance', () => {
    const s = drag(400);
    expect(moveSheetDrag(s, 700, 1 / 60, detents, phone)).toBe(300);
    expect(moveSheetDrag(s, 900, 1 / 60, detents, phone)).toBe(100);
  });

  it('resists past the largest: monotonic, starting at the finger, bounded by the 125 dp zone', () => {
    let last = 0;
    for (let over = 1; over <= 2000; over += 7) {
      const r = sheetResistance(over);
      expect(r).toBeGreaterThan(last);
      expect(r).toBeLessThan(125);
      last = r;
    }
    expect(sheetResistance(1)).toBeCloseTo(1, 1);
    expect(sheetResistance(0)).toBe(0);
    const s = drag(744, 600);
    const h = moveSheetDrag(s, 0, 1 / 60, [400, 744], { width: 390, height: 2000 });
    expect(h).toBeGreaterThan(744);
    expect(h).toBeLessThan(744 + 125);
  });

  it('flings up to the next detent beyond where it was let go, across one detent', () => {
    const s = drag(400);
    swipe(s, 600, 560, 0.08);
    expect(s.velocity).toBeGreaterThan(125);
    expect(releaseSheetDrag(s, detents, true)).toEqual({ target: 744 });
  });

  it('flings down to the next detent below, across one detent and across two', () => {
    const one = drag(744);
    swipe(one, 600, 640, 0.08);
    expect(releaseSheetDrag(one, detents, true)).toEqual({ target: 400 });
    const three = [200, 400, 744];
    const two = drag(744);
    swipe(two, 600, 640, 0.08);
    expect(releaseSheetDrag(two, three, true)).toEqual({ target: 400 });
    const lower = drag(450);
    swipe(lower, 600, 640, 0.08);
    expect(releaseSheetDrag(lower, three, true)).toEqual({ target: 400 });
    const dip = drag(400);
    swipe(dip, 600, 640, 0.08);
    expect(releaseSheetDrag(dip, three, true)).toEqual({ target: 200 });
  });

  it('lands on the nearest detent on a slow release, either way', () => {
    const near = drag(400);
    swipe(near, 600, 480, 2);
    expect(Math.abs(near.velocity)).toBeLessThan(125);
    expect(releaseSheetDrag(near, detents, true)).toEqual({ target: 400 });
    const up = drag(400);
    swipe(up, 600, 300, 3);
    expect(up.height.x).toBeCloseTo(700, 5);
    expect(releaseSheetDrag(up, detents, true)).toEqual({ target: 744 });
  });

  it('settles back on the largest after resistance', () => {
    const s = drag(744);
    swipe(s, 600, 400, 2);
    expect(releaseSheetDrag(s, detents, true)).toEqual({ target: 744 });
  });

  it('closes past the thresholds below the lowest when dismissible, else returns to it', () => {
    const slow = drag(400);
    swipe(slow, 600, 680, 3);
    expect(slow.height.x).toBeCloseTo(320, 5);
    expect(releaseSheetDrag(slow, detents, true)).toEqual({ close: true });
    const stay = drag(400);
    swipe(stay, 600, 680, 3);
    expect(releaseSheetDrag(stay, detents, false)).toEqual({ target: 400 });
    const short = drag(400);
    swipe(short, 600, 630, 3);
    expect(releaseSheetDrag(short, detents, true)).toEqual({ target: 400 });
    const fast = drag(400);
    swipe(fast, 600, 620, 0.06);
    expect(releaseSheetDrag(fast, detents, true)).toEqual({ close: true });
  });

  it('leaves the spring moving to the target with the finger velocity', () => {
    const s = drag(400);
    swipe(s, 600, 560, 0.08);
    const r = releaseSheetDrag(s, detents, true);
    expect(s.active).toBe(false);
    expect(s.height.target).toBe((r as { target: number }).target);
    expect(s.height.v).toBeGreaterThan(0);
  });

  it('settles a cancelled drag on the nearest detent with no velocity, however it was moving', () => {
    const fling = drag(500);
    swipe(fling, 600, 560, 0.06);
    expect(fling.velocity).toBeGreaterThan(125);
    expect(cancelSheetDrag(fling, detents)).toEqual({ target: 400 });
    expect(fling.height.v).toBe(0);
    expect(fling.active).toBe(false);
    const below = drag(400);
    swipe(below, 600, 700, 0.06);
    expect(releaseSheetDrag({ ...below, height: { ...below.height } }, detents, true)).toEqual({ close: true });
    expect(cancelSheetDrag(below, detents)).toEqual({ target: 400 });
    const above = drag(744);
    swipe(above, 600, 300, 1);
    expect(cancelSheetDrag(above, detents)).toEqual({ target: 744 });
  });

  it('ignores moves before a press', () => {
    const s = createSheetDrag();
    expect(moveSheetDrag(s, 300, 1 / 60, detents, phone)).toBe(0);
  });
});

describe('the detent spring', () => {
  const run = (from: number, to: number) => {
    const spring = { x: from, v: 0, target: to };
    const dt = 1 / 240;
    const span = Math.abs(to - from);
    let t = 0;
    let peak = 0;
    let settled = 0;
    while (t < 3) {
      stepSheetHeight(spring, dt);
      t += dt;
      peak = Math.max(peak, ((spring.x - to) * Math.sign(to - from)) / span);
      if (Math.abs(spring.x - to) > 0.01 * span) settled = t;
    }
    return { settled, overshoot: peak };
  };

  it('settles in about 0.4 s with at most 2 % overshoot', () => {
    for (const [from, to] of [
      [400, 744],
      [744, 400],
      [300, 560],
    ] as const) {
      const { settled, overshoot } = run(from, to);
      expect(settled).toBeGreaterThan(0.3);
      expect(settled).toBeLessThan(0.5);
      expect(overshoot).toBeLessThanOrEqual(0.02);
    }
  });

  it('lands in one frame under reduced motion', () => {
    const spring = { x: 400, v: 0, target: 744 };
    stepSheetHeight(spring, 1 / 60, true);
    expect(spring.x).toBe(744);
  });
});

describe('sheetForKeyboard', () => {
  const heights = [400, 744];

  it('raises to the largest detent that fits above the keyboard and returns the detent to go back to', () => {
    const vv = { x: 0, y: 0, width: 390, height: 500 };
    expect(sheetForKeyboard(heights, 400, phone, vv)).toEqual({ height: 444, bottom: 500, restore: 400 });
  });

  it('takes the largest detent when it fits', () => {
    const vv = { x: 0, y: 0, width: 390, height: 780 };
    expect(sheetForKeyboard(heights, 400, phone, vv)).toEqual({ height: 724, bottom: 780, restore: 400 });
    const roomy = { width: 390, height: 1000 };
    expect(sheetForKeyboard([400, 600], 400, roomy, { x: 0, y: 0, width: 390, height: 900 })).toEqual({ height: 600, bottom: 900, restore: 400 });
  });

  it('leaves the sheet alone when the keyboard is away', () => {
    const vv = { x: 0, y: 0, width: 390, height: 800 };
    expect(sheetForKeyboard(heights, 400, phone, vv)).toEqual({ height: 400, bottom: 800, restore: 400 });
  });

  it('keeps the bottom on the visual viewport when it is scrolled', () => {
    const vv = { x: 0, y: 40, width: 390, height: 460 };
    expect(sheetForKeyboard(heights, 400, phone, vv).bottom).toBe(500);
  });
});

describe('what the element asks of the model', () => {
  it('names the detents a kind has by default', () => {
    expect(defaultSheetDetents('sheet')).toEqual(['medium', 'large']);
    expect(defaultSheetDetents('popover')).toEqual(['peek']);
    expect(defaultSheetDetents('modal-sheet')).toEqual(['large']);
  });

  it('asks for a peek that shows the content and the gap under the floating sheet', () => {
    expect(sheetPeekContent(300)).toBe(312);
    expect(sheetDetents('popover', phone, { content: sheetPeekContent(300) })).toEqual([312]);
  });

  it('attaches a lens to every form but the third pane and full screen, and to a bottom sheet that is not opaque at its lowest detent', () => {
    const w = { width: 390, height: 800 };
    expect(sheetUsesGlass('side-pane', [], w)).toBe(false);
    expect(sheetUsesGlass('full-screen', [], w)).toBe(false);
    expect(sheetUsesGlass('side-sheet', [], w)).toBe(true);
    expect(sheetUsesGlass('popover', [], w)).toBe(true);
    expect(sheetUsesGlass('bottom-sheet', [400, 744], w)).toBe(true);
    expect(sheetUsesGlass('bottom-sheet', [744], w)).toBe(false);
  });

  it('lets a scrim press close a bottom sheet or a popover, never a centred surface or a persistent one', () => {
    expect(scrimCloses('modal-sheet', 'bottom-sheet', false)).toBe(true);
    expect(scrimCloses('popover', 'bottom-sheet', false)).toBe(true);
    expect(scrimCloses('modal-sheet', 'centered-sheet', false)).toBe(false);
    expect(scrimCloses('dialog', 'basic-dialog', false)).toBe(false);
    expect(scrimCloses('alert', 'alert', false)).toBe(false);
    expect(scrimCloses('modal-sheet', 'bottom-sheet', true)).toBe(false);
    expect(scrimCloses('popover', 'popover', true)).toBe(false);
  });

  it('gives a drag in the content to the sheet only from the content top, upward only below the largest detent', () => {
    const detents = [400, 744];
    expect(sheetContentDrag(0, 20, 744, detents)).toBe(true);
    expect(sheetContentDrag(0, -20, 744, detents)).toBe(false);
    expect(sheetContentDrag(0, -20, 400, detents)).toBe(true);
    expect(sheetContentDrag(12, 20, 400, detents)).toBe(false);
    expect(sheetContentDrag(0, 0, 400, detents)).toBe(false);
  });

  it('leaves a touch to the content while it scrolls and to the sheet otherwise', () => {
    const detents = [400, 744];
    expect(sheetTouchAction(10, 400, detents)).toBe('pan-y');
    expect(sheetTouchAction(0, 400, detents)).toBe('none');
    expect(sheetTouchAction(0, 744, detents)).toBe('pan-up');
  });
});

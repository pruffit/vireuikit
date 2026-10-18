import { describe, expect, it } from 'vitest';
import {
  BAR_SLOTS,
  BOTTOM_SHEET_MAX_WIDTH,
  DIALOG_MAX_WIDTH,
  INPUT_MIXED,
  INPUT_POINTER,
  INPUT_TABLET_KEYBOARD,
  INPUT_TOUCH,
  LIST_PANE_WIDTH,
  POSTURE_FLAT,
  SIDE_SHEET_MAX_WIDTH,
  SUPPORTING_PANE_MAX_WIDTH,
  SURFACE_KINDS,
  adaptiveContext,
  bottomAccessory,
  classifyWindow,
  defaultSize,
  halfOpen,
  heightClass,
  hitTarget,
  hoversWith,
  menuPlacement,
  menuSurfaceFrame,
  minTarget,
  navigationForm,
  paneLayout,
  postureFromSegments,
  postureSplit,
  presentationForm,
  rectContains,
  segmentOf,
  sizeTier,
  supportingPane,
  surfaceRegion,
  widthAtLeast,
  widthClass,
  windowSegments,
  type AdaptiveContext,
  type InputLayers,
  type ListDetailState,
  type Posture,
  type Rect,
  type SurfaceKind,
} from '../index';

const at = (width: number, height = 900, extra: Partial<AdaptiveContext> = {}) =>
  adaptiveContext({ window: { width, height }, ...extra });

const NAV = { primary: 4, secondary: 2, search: true } as const;

describe('window classes', () => {
  it('width boundaries fall exactly on 600, 840, 1200 and 1600', () => {
    const cases: [number, string][] = [
      [0, 'compact'],
      [599, 'compact'],
      [599.9, 'compact'],
      [600, 'medium'],
      [839, 'medium'],
      [840, 'expanded'],
      [1199, 'expanded'],
      [1200, 'large'],
      [1599, 'large'],
      [1600, 'xlarge'],
      [3840, 'xlarge'],
    ];
    for (const [width, expected] of cases) expect(widthClass(width), String(width)).toBe(expected);
  });

  it('height boundaries fall exactly on 480 and 900', () => {
    const cases: [number, string][] = [
      [0, 'compact'],
      [479, 'compact'],
      [480, 'medium'],
      [899, 'medium'],
      [900, 'expanded'],
    ];
    for (const [height, expected] of cases) expect(heightClass(height), String(height)).toBe(expected);
  });

  it('a window that is not a number is compact, and classes order', () => {
    expect(widthClass(Number.NaN)).toBe('compact');
    expect(heightClass(-1)).toBe('compact');
    expect(classifyWindow({ width: 915, height: 412 })).toEqual({ width: 'expanded', height: 'compact' });
    expect(widthAtLeast('large', 'expanded')).toBe(true);
    expect(widthAtLeast('medium', 'expanded')).toBe(false);
    expect(widthAtLeast('xlarge', 'large')).toBe(true);
  });
});

describe('input layers', () => {
  const pair = (input: InputLayers) => [sizeTier(input), hitTarget(input)];

  it('density follows the primary pointer, the hit area any coarse input', () => {
    expect(pair(INPUT_TOUCH)).toEqual(['touch', 44]);
    expect(pair(INPUT_POINTER)).toEqual(['medium', 24]);
    expect(pair(INPUT_MIXED)).toEqual(['medium', 44]);
    expect(pair(INPUT_TABLET_KEYBOARD)).toEqual(['touch', 44]);
  });

  it('canary: one coarse flag cannot give a laptop with a touch screen its pointer tier and the finger hit area', () => {
    for (const coarse of [true, false]) {
      expect([defaultSize({ touch: coarse }), minTarget({ touch: coarse })]).not.toEqual(pair(INPUT_MIXED));
    }
  });

  it('hover is the event\'s: a mouse or a pen hovers, a finger does not', () => {
    expect(hoversWith('mouse')).toBe(true);
    expect(hoversWith('pen')).toBe(true);
    expect(hoversWith('touch')).toBe(false);
  });

  it('a keyboard changes neither the tier nor the hit area', () => {
    expect(pair({ ...INPUT_TOUCH, keyboard: true })).toEqual(pair(INPUT_TOUCH));
    expect(pair({ ...INPUT_POINTER, keyboard: false })).toEqual(pair(INPUT_POINTER));
  });
});

describe('posture and segments', () => {
  const window = { width: 841, height: 701 };

  it('flat is one segment, the whole window', () => {
    expect(windowSegments({ window, posture: POSTURE_FLAT })).toEqual([{ x: 0, y: 0, width: 841, height: 701 }]);
  });

  it('an occluding fold\'s band belongs to neither segment', () => {
    const book = halfOpen('book', window, { band: 21 });
    expect(book).toMatchObject({ kind: 'book', fold: { occluding: true } });
    expect(windowSegments({ window, posture: book })).toEqual([
      { x: 0, y: 0, width: 410, height: 701 },
      { x: 431, y: 0, width: 410, height: 701 },
    ]);
    const tabletop = halfOpen('tabletop', window, { at: 300, band: 20 });
    expect(windowSegments({ window, posture: tabletop })).toEqual([
      { x: 0, y: 0, width: 841, height: 290 },
      { x: 0, y: 310, width: 841, height: 391 },
    ]);
  });

  it('a fold that does not occlude splits the window at its centre line', () => {
    const posture = halfOpen('book', window, { band: 20, occluding: false });
    expect(windowSegments({ window, posture })).toEqual([
      { x: 0, y: 0, width: 420.5, height: 701 },
      { x: 420.5, y: 0, width: 420.5, height: 701 },
    ]);
  });

  it('two segments read back as the posture they came from', () => {
    for (const posture of [halfOpen('book', window, { band: 20 }), halfOpen('tabletop', window, { band: 24 }), halfOpen('book', window)]) {
      expect(postureFromSegments(window, windowSegments({ window, posture }))).toEqual(posture);
    }
  });

  it('anything but two separated segments is flat', () => {
    expect(postureFromSegments(window, [])).toEqual(POSTURE_FLAT);
    expect(postureFromSegments(window, [{ x: 0, y: 0, width: 841, height: 701 }])).toEqual(POSTURE_FLAT);
    const three = [0, 1, 2].map((i) => ({ x: i * 280, y: 0, width: 270, height: 701 }));
    expect(postureFromSegments(window, three)).toEqual(POSTURE_FLAT);
    expect(postureFromSegments(window, [{ x: 0, y: 0, width: 500, height: 701 }, { x: 400, y: 0, width: 441, height: 701 }])).toEqual(POSTURE_FLAT);
  });

  it('a box belongs to the segment holding its centre, else the one it overlaps most, else the nearest', () => {
    const segments = windowSegments({ window, posture: halfOpen('book', window, { band: 21 }) });
    expect(segmentOf({ x: 380, y: 10, width: 44, height: 44 }, segments)).toBe(segments[0]);
    expect(segmentOf({ x: 400, y: 10, width: 44, height: 44 }, segments)).toBe(segments[1]);
    expect(segmentOf({ x: 405, y: 10, width: 20, height: 20 }, segments)).toBe(segments[0]);
    expect(segmentOf({ x: 2000, y: 10, width: 20, height: 20 }, segments)).toBe(segments[1]);
    expect(segmentOf({ x: 0, y: 0, width: 1, height: 1 }, [])).toBeUndefined();
  });

  it('a surface lives in its source\'s segment, or the largest when nothing anchors it', () => {
    const posture = halfOpen('tabletop', window, { at: 250, band: 20 });
    const segments = windowSegments({ window, posture });
    expect(surfaceRegion({ window, posture }, { x: 10, y: 10, width: 44, height: 44 })).toEqual(segments[0]);
    expect(surfaceRegion({ window, posture })).toEqual(segments[1]);
    expect(surfaceRegion({ window, posture: POSTURE_FLAT })).toEqual({ x: 0, y: 0, ...window });
  });

  it('a half-open posture splits watched content from its controls, flat does not', () => {
    expect(postureSplit(at(841, 701))).toEqual({ kind: 'single' });
    const tabletop = postureSplit(at(841, 701, { posture: halfOpen('tabletop', window) }));
    expect(tabletop).toMatchObject({ kind: 'split', axis: 'horizontal', primary: { y: 0 }, secondary: { y: 350.5 } });
    const book = postureSplit(at(841, 701, { posture: halfOpen('book', window, { band: 21 }) }));
    expect(book).toMatchObject({ kind: 'split', axis: 'vertical', primary: { x: 0, width: 410 }, secondary: { x: 431 } });
  });
});

describe('navigation', () => {
  const form = (ctx: AdaptiveContext, extra = {}) => navigationForm(ctx, { ...NAV, ...extra }).form;

  it('bar on a compact width, rail on medium and expanded, sidebar from large', () => {
    const cases: [number, string][] = [
      [360, 'bar'],
      [599, 'bar'],
      [600, 'rail'],
      [839, 'rail'],
      [840, 'rail'],
      [1199, 'rail'],
      [1200, 'sidebar'],
      [1600, 'sidebar'],
      [2560, 'sidebar'],
    ];
    for (const [width, expected] of cases) expect(form(at(width, 900)), String(width)).toBe(expected);
  });

  it('a medium window with two panes takes the bar, except in book posture where the rail stays', () => {
    expect(form(at(673, 841), { panes: 2 })).toBe('bar');
    expect(form(at(673, 841), { panes: 1 })).toBe('rail');
    expect(form(at(673, 841, { posture: halfOpen('book', { width: 673, height: 841 }) }), { panes: 2 })).toBe('rail');
    expect(form(at(900, 841), { panes: 2 })).toBe('rail');
  });

  it('a compact height gives the vertical space to content: a rail, and a sidebar from large', () => {
    expect(form(at(915, 412))).toBe('rail');
    expect(form(at(800, 360))).toBe('rail');
    expect(form(at(560, 400))).toBe('rail');
    expect(form(at(1400, 450))).toBe('sidebar');
    expect(form(at(450, 470))).toBe('bar');
  });

  it('tabletop takes the bar on every width', () => {
    for (const width of [600, 841, 1300]) {
      const posture = halfOpen('tabletop', { width, height: 701 });
      expect(form(at(width, 701, { posture }))).toBe('bar');
    }
  });

  it('a sidebar the person collapsed stays a rail that expands beside the content; it is a sidebar again only by choice', () => {
    expect(navigationForm(at(1440, 900), { ...NAV, sidebarCollapsed: true })).toMatchObject({ form: 'rail', expandable: 'beside', collapsible: false });
    expect(navigationForm(at(1440, 900), NAV)).toMatchObject({ form: 'sidebar', expandable: null, collapsible: true });
    expect(navigationForm(at(1024, 700), NAV)).toMatchObject({ form: 'rail', expandable: 'over' });
    expect(navigationForm(at(700, 900), NAV)).toMatchObject({ form: 'rail', expandable: null });
  });

  it('the same destinations on every form; secondary ones show only in the sidebar; no "More"', () => {
    for (const width of [360, 700, 1000, 1440]) {
      const nav = navigationForm(at(width), NAV);
      expect(nav.primary).toBe(4);
      expect(nav.secondary).toBe(2);
      expect(nav.secondaryVisible).toBe(nav.form === 'sidebar');
    }
    expect(BAR_SLOTS).toBe(5);
    expect(navigationForm(at(360), { primary: 6, search: true })).toMatchObject({ primary: 4, secondary: 2 });
    expect(navigationForm(at(1440), { primary: 6, search: false })).toMatchObject({ primary: 5, secondary: 1 });
  });

  it('search: a button at the bar\'s end, a rail item, a persistent field from large; a shortcut where there is a keyboard', () => {
    expect(navigationForm(at(360, 800, { input: INPUT_TOUCH }), NAV).search).toEqual({ form: 'button', place: 'bar', shortcut: false });
    expect(navigationForm(at(700, 900, { input: INPUT_TOUCH }), NAV).search).toEqual({ form: 'item', place: 'rail', shortcut: false });
    expect(navigationForm(at(1000, 800, { input: INPUT_TABLET_KEYBOARD }), NAV).search).toEqual({ form: 'item', place: 'rail', shortcut: true });
    expect(navigationForm(at(1440), NAV).search).toEqual({ form: 'field', place: 'sidebar', shortcut: true });
    expect(navigationForm(at(1440), { ...NAV, sidebarCollapsed: true }).search).toEqual({ form: 'field', place: 'toolbar', shortcut: true });
    expect(navigationForm(at(1440), { primary: 4 }).search).toBeNull();
  });

  it('the edge follows the form', () => {
    expect(navigationForm(at(360), NAV).edge).toBe('bottom');
    expect(navigationForm(at(700), NAV).edge).toBe('leading');
    expect(navigationForm(at(1440), NAV).edge).toBe('leading');
  });

  it('the bottom accessory sits above the bar, in its row once it minimises, and along the content beside a rail', () => {
    expect(bottomAccessory({ form: 'bar' })).toEqual({ placement: 'above-bar', compact: false });
    expect(bottomAccessory({ form: 'bar' }, { barMinimized: true })).toEqual({ placement: 'in-bar', compact: true });
    expect(bottomAccessory({ form: 'rail' }, { barMinimized: true })).toEqual({ placement: 'content-bottom', compact: false });
    expect(bottomAccessory({ form: 'sidebar' })).toEqual({ placement: 'content-bottom', compact: false });
  });
});

describe('presentation', () => {
  const formOf = (kind: SurfaceKind, width: number, height = 900, posture?: Posture) =>
    presentationForm(kind, at(width, height, posture ? { posture } : {})).form;

  it('a menu grows out of its trigger on every class', () => {
    for (const width of [360, 600, 840, 1200, 1600]) {
      expect(presentationForm('menu', at(width))).toMatchObject({ form: 'grown', fromSource: true, scrim: false });
    }
  });

  it('a popover is a sheet grown from its source below 600 and a popover from 600', () => {
    expect(presentationForm('popover', at(599))).toMatchObject({ form: 'bottom-sheet', fromSource: true });
    expect(presentationForm('popover', at(600))).toMatchObject({ form: 'popover', fromSource: true, scrim: false });
  });

  it('a supplementary sheet is a bottom sheet below 840, a side sheet from 840 and a third pane from 1600', () => {
    expect(presentationForm('sheet', at(599))).toMatchObject({ form: 'bottom-sheet', maxWidth: null, scrim: false });
    expect(presentationForm('sheet', at(600))).toMatchObject({ form: 'bottom-sheet', maxWidth: BOTTOM_SHEET_MAX_WIDTH });
    expect(formOf('sheet', 839)).toBe('bottom-sheet');
    expect(presentationForm('sheet', at(840))).toMatchObject({ form: 'side-sheet', compresses: true, maxWidth: SIDE_SHEET_MAX_WIDTH, scrim: false });
    expect(formOf('sheet', 1599)).toBe('side-sheet');
    expect(presentationForm('sheet', at(1600))).toMatchObject({ form: 'side-pane', compresses: true, maxWidth: SIDE_SHEET_MAX_WIDTH });
  });

  it('a modal task is a bottom sheet below 600 and a centred sheet from 600; a long pick is the same sheet, not a menu', () => {
    for (const kind of ['modal-sheet', 'picker'] as const) {
      expect(presentationForm(kind, at(599))).toMatchObject({ form: 'bottom-sheet', scrim: true });
      expect(presentationForm(kind, at(600))).toMatchObject({ form: 'centered-sheet', scrim: true, maxWidth: DIALOG_MAX_WIDTH });
      expect(formOf(kind, 1600)).toBe('centered-sheet');
    }
  });

  it('a dialog with fields is full screen below 600 and a basic dialog from 600; an alert is an alert everywhere', () => {
    expect(formOf('dialog', 599)).toBe('full-screen');
    expect(presentationForm('dialog', at(600))).toMatchObject({ form: 'basic-dialog', scrim: true, maxWidth: DIALOG_MAX_WIDTH });
    for (const width of [360, 900, 1600]) expect(formOf('alert', width)).toBe('alert');
  });

  it('on a compact height every bottom or centred sheet is full screen; side sheets are full height already', () => {
    expect(formOf('sheet', 560, 479)).toBe('full-screen');
    expect(formOf('sheet', 700, 479)).toBe('full-screen');
    expect(formOf('sheet', 700, 480)).toBe('bottom-sheet');
    expect(formOf('modal-sheet', 915, 412)).toBe('full-screen');
    expect(formOf('popover', 560, 400)).toBe('full-screen');
    expect(formOf('popover', 915, 412)).toBe('popover');
    expect(formOf('sheet', 915, 412)).toBe('side-sheet');
    expect(formOf('menu', 915, 412)).toBe('grown');
    expect(formOf('dialog', 915, 412)).toBe('basic-dialog');
  });

  it('a surface never crosses the fold: it lives in its source\'s segment, side sheets in the trailing one in book posture', () => {
    const window = { width: 841, height: 701 };
    const book = halfOpen('book', window, { band: 21 });
    const segments = windowSegments({ window, posture: book });
    const left = { x: 300, y: 20, width: 44, height: 44 };
    for (const kind of SURFACE_KINDS) {
      const form = presentationForm(kind, at(841, 701, { posture: book }), left);
      const expected = form.form === 'side-sheet' || form.form === 'side-pane' ? segments[1] : segments[0];
      expect(form.region, kind).toEqual(expected);
    }
    expect(presentationForm('menu', at(841, 701), left).region).toEqual({ x: 0, y: 0, ...window });
  });
});

describe('panes', () => {
  const state = (s: Partial<ListDetailState> = {}): ListDetailState => ({ selected: true, showing: 'detail', ...s });

  it('one pane below 840, two from 840 with a list of 360, 412 from 1200', () => {
    expect(paneLayout(at(839), state())).toMatchObject({ panes: 1 });
    expect(paneLayout(at(840), state())).toMatchObject({ panes: 2, split: { kind: 'fixed', list: LIST_PANE_WIDTH.expanded } });
    expect(LIST_PANE_WIDTH.expanded).toBe(360);
    expect(paneLayout(at(1199), state())).toMatchObject({ split: { kind: 'fixed', list: 360 } });
    expect(paneLayout(at(1200), state())).toMatchObject({ split: { kind: 'fixed', list: LIST_PANE_WIDTH.large } });
    expect(LIST_PANE_WIDTH.large).toBe(412);
    expect(paneLayout(at(2560), state())).toMatchObject({ split: { kind: 'fixed', list: 412 } });
  });

  it('a medium window splits in half only for sparse content; a compact height never takes two panes', () => {
    expect(paneLayout(at(700), state({ sparse: true }))).toMatchObject({ panes: 2, split: { kind: 'half' } });
    expect(paneLayout(at(599), state({ sparse: true }))).toMatchObject({ panes: 1 });
    expect(paneLayout(at(915, 412), state())).toMatchObject({ panes: 1 });
    expect(paneLayout(at(1300, 479), state())).toMatchObject({ panes: 1 });
    expect(paneLayout(at(1300, 480), state())).toMatchObject({ panes: 2 });
  });

  it('book posture splits the panes along the fold, which is their spacer', () => {
    const window = { width: 673, height: 841 };
    const posture = halfOpen('book', window, { band: 13 });
    const layout = paneLayout(at(673, 841, { posture }), state());
    expect(layout).toMatchObject({ panes: 2, split: { kind: 'fold' } });
    expect(layout.split).toEqual({ kind: 'fold', gap: posture.kind === 'book' ? posture.fold.bounds : null });
  });

  it('narrowing keeps the detail when something is selected, the list otherwise; back exists only on a lone detail', () => {
    expect(paneLayout(at(700), state())).toMatchObject({ visible: ['detail'], back: true, selectionShown: false });
    expect(paneLayout(at(700), state({ selected: false }))).toMatchObject({ visible: ['list'], back: false });
    expect(paneLayout(at(700), state({ showing: 'list' }))).toMatchObject({ visible: ['list'], back: false });
    expect(paneLayout(at(700), state({ selected: false, showing: 'detail' }))).toMatchObject({ visible: ['list'] });
  });

  it('widening shows the list beside the detail with the selection drawn, or the detail\'s empty state', () => {
    expect(paneLayout(at(1000), state())).toMatchObject({ visible: ['list', 'detail'], placeholder: false, back: false, selectionShown: true });
    expect(paneLayout(at(1000), state({ selected: false, showing: 'list' }))).toMatchObject({ placeholder: true, selectionShown: false });
  });

  it('the supporting pane: beside the content from large, over it on expanded, hidden below and remembered', () => {
    const pinned = { pinned: true, open: false };
    expect(supportingPane(at(1200), pinned)).toMatchObject({ form: 'beside', scrim: false, maxWidth: SUPPORTING_PANE_MAX_WIDTH, edge: 'trailing' });
    expect(supportingPane(at(1199), pinned)).toMatchObject({ form: 'hidden', remembered: true });
    expect(supportingPane(at(1199), { pinned: true, open: true })).toMatchObject({ form: 'over', scrim: true });
    expect(supportingPane(at(839), { pinned: true, open: true })).toMatchObject({ form: 'hidden', remembered: true });
    expect(supportingPane(at(1200), { pinned: false, open: true })).toMatchObject({ form: 'beside' });
    expect(supportingPane(at(1200), { pinned: false, open: false })).toMatchObject({ form: 'hidden', remembered: false });
    expect(SUPPORTING_PANE_MAX_WIDTH).toBe(400);
  });

  it('a sweep down and back up returns the supporting pane where it was', () => {
    const forms = [1440, 1000, 700, 1000, 1440].map((w) => supportingPane(at(w), { pinned: true, open: false }).form);
    expect(forms).toEqual(['beside', 'hidden', 'hidden', 'hidden', 'beside']);
  });
});

describe('menu placement in a segment', () => {
  const window = { width: 841, height: 701 };

  it('a size alone is still a region at the origin, and a region elsewhere moves the menu with it', () => {
    const trigger = { x: 20, y: 20, width: 44, height: 44 };
    const menu = { width: 200, height: 160 };
    const bySize = menuPlacement(trigger, menu, { width: 800, height: 600 });
    expect(menuPlacement(trigger, menu, { x: 0, y: 0, width: 800, height: 600 })).toEqual(bySize);
    const moved = menuPlacement({ ...trigger, x: 520 }, menu, { x: 500, y: 0, width: 300, height: 600 });
    expect(moved.rect).toEqual({ ...bySize.rect, x: bySize.rect.x + 500 });
    expect(moved.corner).toEqual(bySize.corner);
  });

  it('a menu near the fold pins to the corner facing its own segment, where the whole window would send it across', () => {
    const posture = halfOpen('book', window, { band: 21 });
    const segments = windowSegments({ window, posture });
    const trigger = { x: 360, y: 20, width: 44, height: 44 };
    const menu = { width: 220, height: 200 };
    const inSegment = menuPlacement(trigger, menu, segmentOf(trigger, segments)!);
    expect(inSegment.corner.x).toBe(1);
    expect(inSegment.rect.x + inSegment.rect.width).toBeLessThanOrEqual(410);
    const whole = menuPlacement(trigger, menu, window);
    expect(whole.rect.x + whole.rect.width).toBeGreaterThan(431);
  });

  it('every frame of the growth stays in the region, the overshoot included, and the lens keeps its second shape where it was', () => {
    const posture = halfOpen('tabletop', window, { band: 0 });
    const [, bottom] = windowSegments({ window, posture }) as [Rect, Rect];
    const trigger = { x: 700, y: 600, width: 44, height: 44, radius: 22 };
    const menu = { width: 220, height: 290 };
    const { rect, anchor } = menuPlacement(trigger, menu, bottom);
    const target = { ...rect, radius: 35 };
    let escaped = false;
    for (const grow of [0, 0.3, 0.6, 0.9, 1, 1.02, 1.035, 1.05]) {
      const free = menuSurfaceFrame(trigger, target, anchor, { shrink: 1, grow });
      if (free.box.y < bottom.y) escaped = true;
      const held = menuSurfaceFrame(trigger, target, anchor, { shrink: 1, grow }, bottom);
      expect(rectContains(bottom, held.box, 1e-9), String(grow)).toBe(true);
      expect(held.box.radius).toBeLessThanOrEqual(Math.min(held.box.width, held.box.height) / 2);
      if (free.morph && held.morph) {
        const freeAt = free.box.y + free.box.height / 2 + free.morph.offsetY;
        expect(held.box.y + held.box.height / 2 + held.morph.offsetY).toBeCloseTo(freeAt, 9);
      }
    }
    expect(escaped).toBe(true);
  });

  it('a menu opened in either half of a folded window never crosses the fold', () => {
    for (const kind of ['book', 'tabletop'] as const) {
      for (const band of [0, 21]) {
        const posture = halfOpen(kind, window, { band });
        const segments = windowSegments({ window, posture });
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 400; i += 1) {
          const trigger: Rect = { x: rand() * 800, y: rand() * 660, width: 44, height: 44 };
          const menu = { width: 120 + rand() * 300, height: 80 + rand() * 500 };
          const region = segmentOf(trigger, segments)!;
          const { rect } = menuPlacement(trigger, menu, region);
          expect(rectContains(region, rect, 1e-9), JSON.stringify({ kind, band, trigger, menu })).toBe(true);
        }
      }
    }
  });
});

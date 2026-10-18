// Where a surface sits, in dp, for every form `presentationForm` can give it.
import type { MorphBox } from '../adaptive/form-morph';
import type { PresentationForm } from '../adaptive/presentation';
import type { Size } from '../geometry';
import { menuPlacement, type MenuPlacement, type RoundedRect } from '../menu';
import { SHEET_SIZES, sheetInset, sheetOpacity, sheetRadius } from './sizes';

export type SheetLayoutInput = {
  form: PresentationForm;
  window: Size;
  /** The control that presents the surface; a popover is placed against it. */
  source: RoundedRect | null;
  content: Size;
  /** A bottom sheet's current height, measured from the window's bottom edge. */
  height?: number;
  /** More than one detent, or closes by a swipe. */
  grabber?: boolean;
  /** The bottom safe area; a floating sheet stays clear of it. */
  bottomInset?: number;
};

export type SheetLayout = {
  box: MorphBox;
  /** 0 is glass, 1 is opaque. */
  opacity: number;
  glass: boolean;
  scrim: boolean;
  /** The grabber's 44 dp hit area; null where the form has none. */
  grabber: MorphBox | null;
  /** What a side sheet or pane takes from the content it narrows, at the trailing edge; 0 elsewhere. */
  insetEnd: number;
  /** The content is taller than the box. */
  scrollable: boolean;
};

export type SheetGrabber = { hit: MorphBox; line: MorphBox };

/** The grabber of a sheet whose box is `box`: a 44 dp hit area at its top centre and the line 8 dp below the top. */
export function sheetGrabber(box: MorphBox): SheetGrabber {
  const { width, height, hit, top } = SHEET_SIZES.grabber;
  const cx = box.x + box.width / 2;
  return {
    hit: { x: cx - hit / 2, y: box.y, width: hit, height: hit, radius: hit / 2 },
    line: { x: cx - width / 2, y: box.y + top, width, height, radius: height / 2 },
  };
}

/** A popover's rectangle and the corner it grows from, in its source's segment. */
export function popoverPlacement(form: PresentationForm, source: RoundedRect | null, content: Size): MenuPlacement {
  const { region } = form;
  const trigger = source ?? { x: region.x + region.width / 2, y: region.y + region.height / 2, width: 0, height: 0 };
  const width = Math.min(content.width, SHEET_SIZES.popover.maxWidth);
  return menuPlacement(trigger, { width, height: content.height }, region, { margin: SHEET_SIZES.popover.margin });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function sheetLayout(input: SheetLayoutInput): SheetLayout {
  const { form, window, source, content } = input;
  const { region } = form;
  const rest = { opacity: 0, glass: true, scrim: form.scrim, grabber: null, insetEnd: 0 };
  const result = (box: MorphBox, extra: Partial<SheetLayout> = {}): SheetLayout => ({
    ...rest,
    box,
    scrollable: content.height > box.height,
    ...extra,
  });
  switch (form.form) {
    case 'grown':
    case 'popover': {
      const { rect } = popoverPlacement(form, source, content);
      return result({ ...rect, radius: SHEET_SIZES.popover.radius });
    }
    case 'bottom-sheet': {
      const height = clamp(input.height ?? content.height, 0, window.height);
      const fraction = window.height > 0 ? height / window.height : 0;
      const inset = sheetInset(fraction);
      const radius = sheetRadius(fraction);
      const opacity = sheetOpacity(fraction);
      // Under 2 dp of inset the bottom corners are already running off the window's edge.
      const k = Math.min(inset / 2, 1);
      const gap = k * Math.max(inset, input.bottomInset ?? 0);
      const width = Math.min(form.maxWidth ?? Infinity, region.width - 2 * inset);
      const bottom = region.y + region.height;
      const box = {
        x: region.x + (region.width - width) / 2,
        y: bottom - height,
        width,
        height: height - gap + radius * (1 - k),
        radius,
      };
      const grabber = input.grabber ? sheetGrabber(box).hit : null;
      return result(box, { opacity, glass: opacity < 1, grabber, scrollable: content.height > height });
    }
    case 'side-sheet':
    case 'side-pane': {
      const { side } = SHEET_SIZES;
      const limit = Math.min(form.maxWidth ?? side.max, side.max);
      const width = Math.min(Math.max(Math.min(side.width, region.width * side.fraction), side.min), limit);
      const box = {
        x: region.x + region.width - side.inset - width,
        y: region.y + side.inset,
        width,
        height: region.height - 2 * side.inset,
        radius: side.radius,
      };
      const pane = form.form === 'side-pane';
      return result(box, { opacity: pane ? 1 : 0, glass: !pane, insetEnd: width + 2 * side.inset });
    }
    case 'centered-sheet':
    case 'basic-dialog':
    case 'alert': {
      const { dialog, windowGap } = SHEET_SIZES;
      const limit = form.form === 'alert' ? dialog.alertWidth : (form.maxWidth ?? dialog.width);
      const width = Math.max(0, Math.min(limit, region.width - windowGap));
      const height = Math.max(0, Math.min(content.height, window.height - windowGap));
      return result({
        x: region.x + (region.width - width) / 2,
        y: region.y + (region.height - height) / 2,
        width,
        height,
        radius: dialog.radius,
      });
    }
    case 'full-screen':
      return result({ x: 0, y: 0, width: window.width, height: window.height, radius: 0 }, { opacity: 1, glass: false });
  }
}

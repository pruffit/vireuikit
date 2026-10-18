// What a transient surface becomes on each class. A form change keeps the surface open; only its form flows.
import type { Rect } from '../geometry';
import { classifyWindow, widthAtLeast } from './classes';
import { surfaceRegion, windowSegments, type AdaptiveContext } from './context';

/**
 * `menu`: closes after one choice and grows out of its trigger on every class. `picker`: a long choice with a search,
 * which is not a menu but a sheet. `popover`: several picks, stays open. `sheet`: supplementary content beside a
 * parallel task. `modal-sheet`: a modal task with a form. `alert`: a dialog without fields. `dialog`: one with fields.
 */
export type SurfaceKind = 'menu' | 'picker' | 'popover' | 'sheet' | 'modal-sheet' | 'alert' | 'dialog';

export const SURFACE_KINDS: readonly SurfaceKind[] = ['menu', 'picker', 'popover', 'sheet', 'modal-sheet', 'alert', 'dialog'];

export type PresentationFormKind =
  | 'grown'
  | 'popover'
  | 'bottom-sheet'
  | 'centered-sheet'
  | 'side-sheet'
  | 'side-pane'
  | 'full-screen'
  | 'basic-dialog'
  | 'alert';

export type PresentationForm = {
  form: PresentationFormKind;
  /** It grows out of its source (and runs back into it). */
  fromSource: boolean;
  /** What lies behind is dimmed and inert. */
  scrim: boolean;
  /** It narrows the main area instead of covering it. */
  compresses: boolean;
  /** Its widest extent in dp; null where it fills its region. */
  maxWidth: number | null;
  /** Where it lives: its source's segment, or the largest; side sheets in book posture take the trailing one. */
  region: Rect;
};

/** A bottom sheet on a medium window stops growing here and centres (Material 3 bottom sheets). */
export const BOTTOM_SHEET_MAX_WIDTH = 640;
/** A side sheet, and the third pane it becomes on an xlarge window. */
export const SIDE_SHEET_MAX_WIDTH = 400;
/** A centred sheet and a basic dialog (Material 3 dialogs). */
export const DIALOG_MAX_WIDTH = 560;

type Base = Omit<PresentationForm, 'region'>;

function baseForm(kind: SurfaceKind, ctx: AdaptiveContext): Base {
  const { width, height } = classifyWindow(ctx.window);
  const compactWidth = width === 'compact';
  const plain = { fromSource: false, scrim: false, compresses: false, maxWidth: null };
  // A sheet whose height is the constraint fills the window on a compact height; a side sheet is full height already.
  const sheet = (form: Base): Base => (height === 'compact' ? { ...plain, form: 'full-screen', scrim: true } : form);
  switch (kind) {
    case 'menu':
      return { ...plain, form: 'grown', fromSource: true };
    case 'popover':
      return compactWidth ? sheet({ ...plain, form: 'bottom-sheet', fromSource: true, scrim: true }) : { ...plain, form: 'popover', fromSource: true };
    case 'picker':
    case 'modal-sheet':
      return sheet(
        compactWidth
          ? { ...plain, form: 'bottom-sheet', scrim: true }
          : { ...plain, form: 'centered-sheet', scrim: true, maxWidth: DIALOG_MAX_WIDTH },
      );
    case 'sheet':
      if (width === 'xlarge') return { ...plain, form: 'side-pane', compresses: true, maxWidth: SIDE_SHEET_MAX_WIDTH };
      if (widthAtLeast(width, 'expanded')) return { ...plain, form: 'side-sheet', compresses: true, maxWidth: SIDE_SHEET_MAX_WIDTH };
      return sheet({ ...plain, form: 'bottom-sheet', maxWidth: compactWidth ? null : BOTTOM_SHEET_MAX_WIDTH });
    case 'alert':
      return { ...plain, form: 'alert', scrim: true, maxWidth: DIALOG_MAX_WIDTH };
    case 'dialog':
      return compactWidth ? { ...plain, form: 'full-screen', scrim: true } : { ...plain, form: 'basic-dialog', scrim: true, maxWidth: DIALOG_MAX_WIDTH };
  }
}

export function presentationForm(kind: SurfaceKind, ctx: AdaptiveContext, source?: Rect): PresentationForm {
  const base = baseForm(kind, ctx);
  const side = base.form === 'side-sheet' || base.form === 'side-pane';
  let region: Rect;
  if (side) {
    const segments = windowSegments(ctx);
    region = ctx.posture.kind === 'book' ? segments[segments.length - 1]! : { x: 0, y: 0, ...ctx.window };
  } else {
    region = surfaceRegion(ctx, source);
  }
  return { ...base, region };
}

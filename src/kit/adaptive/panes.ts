// Panes: list-detail, the supporting pane, and how a half-open posture splits the window.
import type { Rect } from '../geometry';
import { classifyWindow, widthAtLeast } from './classes';
import { windowSegments, type AdaptiveContext } from './context';

/** The fixed list pane beside the detail (Material 3 list-detail). */
export const LIST_PANE_WIDTH = { expanded: 360, large: 412 } as const;
export const SUPPORTING_PANE_MAX_WIDTH = 400;

export type ListDetailState = {
  selected: boolean;
  /** The pane the person is on while one pane shows; the detail needs a selection. Set it to `detail` on a selection. */
  showing: 'list' | 'detail';
  /** Sparse content may split a medium window in half. */
  sparse?: boolean;
};

export type PaneSplit =
  | { kind: 'fixed'; list: number }
  | { kind: 'half' }
  /** Book posture: the fold is the spacer between the panes. */
  | { kind: 'fold'; gap: Rect };

export type PaneLayout = {
  panes: 1 | 2;
  visible: readonly ('list' | 'detail')[];
  split: PaneSplit | null;
  /** Two panes and nothing selected: the detail shows its empty state. */
  placeholder: boolean;
  /** Back exists only where the detail replaces the list. */
  back: boolean;
  /** The selection is drawn in the list only while both panes show. */
  selectionShown: boolean;
};

function splitFor(ctx: AdaptiveContext, sparse: boolean): PaneSplit | null {
  const { width, height } = classifyWindow(ctx.window);
  if (ctx.posture.kind === 'book') return { kind: 'fold', gap: ctx.posture.fold.bounds };
  // Two panes are not practical on a compact height (Android canonical layouts).
  if (height === 'compact') return null;
  if (widthAtLeast(width, 'large')) return { kind: 'fixed', list: LIST_PANE_WIDTH.large };
  if (width === 'expanded') return { kind: 'fixed', list: LIST_PANE_WIDTH.expanded };
  return width === 'medium' && sparse ? { kind: 'half' } : null;
}

export function paneLayout(ctx: AdaptiveContext, state: ListDetailState): PaneLayout {
  const split = splitFor(ctx, state.sparse ?? false);
  if (split) {
    return { panes: 2, visible: ['list', 'detail'], split, placeholder: !state.selected, back: false, selectionShown: state.selected };
  }
  const detail = state.selected && state.showing === 'detail';
  return { panes: 1, visible: [detail ? 'detail' : 'list'], split: null, placeholder: false, back: detail, selectionShown: false };
}

export type SupportingPaneState = {
  /** The person keeps it beside the content; remembered across classes, so it returns when the window widens again. */
  pinned: boolean;
  /** Shown on demand; over the content on an expanded window. */
  open: boolean;
};

export type SupportingPaneForm = {
  form: 'beside' | 'over' | 'hidden';
  edge: 'trailing';
  maxWidth: number;
  /** Over the content it dims what it covers, like a modal side sheet. */
  scrim: boolean;
  remembered: boolean;
};

export function supportingPane(ctx: AdaptiveContext, state: SupportingPaneState): SupportingPaneForm {
  const width = classifyWindow(ctx.window).width;
  const base = { edge: 'trailing' as const, maxWidth: SUPPORTING_PANE_MAX_WIDTH, remembered: state.pinned };
  if (widthAtLeast(width, 'large')) return { ...base, form: state.pinned || state.open ? 'beside' : 'hidden', scrim: false };
  if (width === 'expanded' && state.open) return { ...base, form: 'over', scrim: true };
  return { ...base, form: 'hidden', scrim: false };
}

export type PostureSplit =
  | { kind: 'single' }
  /** Tabletop: what is watched above the fold, its controls below. Book: the leading half and the trailing one. */
  | { kind: 'split'; axis: 'horizontal' | 'vertical'; primary: Rect; secondary: Rect };

export function postureSplit(ctx: AdaptiveContext): PostureSplit {
  if (ctx.posture.kind === 'flat') return { kind: 'single' };
  const segments = windowSegments(ctx);
  if (segments.length < 2) return { kind: 'single' };
  return { kind: 'split', axis: ctx.posture.kind === 'tabletop' ? 'horizontal' : 'vertical', primary: segments[0]!, secondary: segments[1]! };
}

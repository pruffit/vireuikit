// Navigation is one body in three forms: a bar at the bottom, a rail and a sidebar at the leading edge.
import { classifyWindow, widthAtLeast } from './classes';
import type { AdaptiveContext } from './context';

export type NavigationSpec = {
  /** Destinations shown on every form. */
  primary: number;
  /** Destinations shown only in the sidebar and in a rail expanded over the content. */
  secondary?: number;
  search?: boolean;
  /** The person collapsed the sidebar into a rail; the choice is remembered. */
  sidebarCollapsed?: boolean;
  /** Panes the content shows; two panes on a medium window take the bar. */
  panes?: number;
};

export type NavigationFormKind = 'bar' | 'rail' | 'sidebar';

export type SearchForm = {
  /** A button at the bar's trailing end, an item of the rail, or a persistent field. */
  form: 'button' | 'item' | 'field';
  place: 'bar' | 'rail' | 'sidebar' | 'toolbar';
  /** A keyboard shortcut focuses it. */
  shortcut: boolean;
};

export type NavigationForm = {
  form: NavigationFormKind;
  edge: 'bottom' | 'leading';
  /** The same primary destinations on every form, so the body that changes form keeps its items. */
  primary: number;
  /** The secondary destinations plus those the bar has no slot for. */
  secondary: number;
  secondaryVisible: boolean;
  search: SearchForm | null;
  /** A rail that opens wider: over the content on an expanded window, beside it when the person collapsed the sidebar. */
  expandable: 'over' | 'beside' | null;
  /** A sidebar the person can collapse into a rail. */
  collapsible: boolean;
};

/** Slots on the bar, the search button included. There is no "More" slot. */
export const BAR_SLOTS = 5;

function formFor(ctx: AdaptiveContext, spec: NavigationSpec): NavigationFormKind {
  const { width, height } = classifyWindow(ctx.window);
  if (ctx.posture.kind === 'tabletop') return 'bar';
  if (widthAtLeast(width, 'large')) return spec.sidebarCollapsed ? 'rail' : 'sidebar';
  // A bottom bar would take the height a landscape phone has least of; a sidebar would not, hence below large only.
  if (height === 'compact' && ctx.window.width > ctx.window.height) return 'rail';
  if (width === 'compact') return 'bar';
  if (width === 'medium' && (spec.panes ?? 1) > 1 && ctx.posture.kind !== 'book') return 'bar';
  return 'rail';
}

export function navigationForm(ctx: AdaptiveContext, spec: NavigationSpec): NavigationForm {
  const form = formFor(ctx, spec);
  const width = classifyWindow(ctx.window).width;
  const large = widthAtLeast(width, 'large');
  const slots = BAR_SLOTS - (spec.search ? 1 : 0);
  const primary = Math.max(0, Math.min(spec.primary, slots));
  const secondary = Math.max(0, spec.secondary ?? 0) + Math.max(0, spec.primary - primary);
  let search: SearchForm | null = null;
  if (spec.search) {
    const shortcut = large || ctx.input.keyboard;
    if (large) search = { form: 'field', place: form === 'sidebar' ? 'sidebar' : 'toolbar', shortcut };
    else search = form === 'bar' ? { form: 'button', place: 'bar', shortcut } : { form: 'item', place: 'rail', shortcut };
  }
  return {
    form,
    edge: form === 'bar' ? 'bottom' : 'leading',
    primary,
    secondary,
    secondaryVisible: form === 'sidebar',
    search,
    expandable: form !== 'rail' ? null : large ? 'beside' : width === 'expanded' ? 'over' : null,
    collapsible: form === 'sidebar',
  };
}

export type BottomAccessoryForm = {
  /** Above the bar; in the bar's row once it has minimised; along the bottom of the content beside a rail or sidebar. */
  placement: 'above-bar' | 'in-bar' | 'content-bottom';
  /** In the bar's row only the transport fits. */
  compact: boolean;
};

export function bottomAccessory(nav: Pick<NavigationForm, 'form'>, state: { barMinimized?: boolean } = {}): BottomAccessoryForm {
  if (nav.form !== 'bar') return { placement: 'content-bottom', compact: false };
  return state.barMinimized ? { placement: 'in-bar', compact: true } : { placement: 'above-bar', compact: false };
}

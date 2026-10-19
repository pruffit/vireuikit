import { toolbarLayout, type ToolbarItem, type ToolbarLayout, type ToolbarOptions } from '../adaptive/toolbar';

const compression = (layout: ToolbarLayout) => (layout.stage === 'separate' ? 0 : layout.stage === 'merged' ? 1000 : 2000 + layout.overflow.length);
const sameState = (a: ToolbarLayout, b: ToolbarLayout) =>
  a.stage === b.stage && a.overflow.length === b.overflow.length && a.overflow.every((id, i) => id === b.overflow[i]);

/**
 * `toolbarLayout`, except that a width held just across a threshold does not toggle it. Narrowing changes at the
 * threshold; widening waits until the container is `hysteresis` dp past it. With no `previous` it is `toolbarLayout`.
 */
export function toolbarLayoutWithHysteresis(
  items: readonly ToolbarItem[],
  options: ToolbarOptions,
  previous: ToolbarLayout | null,
  hysteresis = 8,
): ToolbarLayout {
  const next = toolbarLayout(items, options);
  if (!previous || sameState(previous, next) || compression(next) >= compression(previous)) return next;
  const settled = toolbarLayout(items, { ...options, available: options.available - hysteresis });
  return compression(settled) >= compression(previous) ? previous : next;
}

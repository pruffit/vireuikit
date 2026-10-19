import { createControlElementClass } from './element';
import { createMenuElementClass } from './menu';
import { createNavElementClass } from './nav';
import { createSurfaceElementClass } from './sheet';
import { createToolbarElementClass } from './toolbar';

export { getA11yOverride, setA11yOverride, systemA11y } from './a11y';
export type { VireControlElement } from './element';
export {
  effectiveInput,
  getInputOverride,
  setInputOverride,
  setViewportOverride,
  systemInput,
  viewportSegments,
  watchAdaptiveContext,
} from './environment';
export type { InputOverride, ViewportOverride } from './environment';
export type { VireMenuElement } from './menu';
export type { VireNavElement } from './nav';
export type { VirePopoverElement, VireSheetElement, VireSurfaceElement } from './sheet';
export type { VireToolbarElement } from './toolbar';
export { STYLES } from './styles';

export const BUTTON_TAG = 'vire-button';
export const ICON_BUTTON_TAG = 'vire-icon-button';
export const MENU_TAG = 'vire-menu';
export const NAV_TAG = 'vire-nav';
export const POPOVER_TAG = 'vire-popover';
export const SHEET_TAG = 'vire-sheet';
export const TOOLBAR_TAG = 'vire-toolbar';

export type DefineOptions = {
  /** CSP nonce for the stylesheet the elements inject. Alternatively, ship `STYLES` yourself. */
  nonce?: string | undefined;
  registry?: CustomElementRegistry | undefined;
};

// A call rather than an import side effect: the classes extend `HTMLElement`, which a server lacks.
export function defineVireElements(options: DefineOptions = {}): void {
  const registry = options.registry ?? (typeof customElements === 'undefined' ? undefined : customElements);
  if (!registry) return;
  const pairs: [string, 'button' | 'iconButton'][] = [
    [BUTTON_TAG, 'button'],
    [ICON_BUTTON_TAG, 'iconButton'],
  ];
  for (const [tag, kind] of pairs) {
    if (!registry.get(tag)) registry.define(tag, createControlElementClass(kind, { nonce: options.nonce }));
  }
  if (!registry.get(MENU_TAG)) registry.define(MENU_TAG, createMenuElementClass({ nonce: options.nonce }));
  if (!registry.get(NAV_TAG)) registry.define(NAV_TAG, createNavElementClass({ nonce: options.nonce }));
  if (!registry.get(POPOVER_TAG)) registry.define(POPOVER_TAG, createSurfaceElementClass('popover', { nonce: options.nonce }));
  if (!registry.get(SHEET_TAG)) registry.define(SHEET_TAG, createSurfaceElementClass('sheet', { nonce: options.nonce }));
  if (!registry.get(TOOLBAR_TAG)) registry.define(TOOLBAR_TAG, createToolbarElementClass({ nonce: options.nonce }));
}

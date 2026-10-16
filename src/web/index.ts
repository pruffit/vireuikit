import { createControlElementClass } from './element';

export { getA11yOverride, setA11yOverride, systemA11y } from './a11y';
export type { VireControlElement } from './element';
export { STYLES } from './styles';

export const BUTTON_TAG = 'vire-button';
export const ICON_BUTTON_TAG = 'vire-icon-button';

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
}

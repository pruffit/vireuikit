export type Root = Document | ShadowRoot;

/** The element's own tree outwards: its root first, the document last. */
export function rootsOf(el: Element): Root[] {
  const roots: Root[] = [];
  let node: Node = el.getRootNode();
  while (node instanceof ShadowRoot) {
    roots.push(node);
    node = node.host.getRootNode();
  }
  roots.push(el.ownerDocument);
  return roots;
}

export function dropEmptyStyle(el: Element, hadStyle: boolean): void {
  if (!hadStyle && el.getAttribute('style') === '') el.removeAttribute('style');
}

/** The focused element, looking into open shadow roots. */
export function deepActive(root: Root): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

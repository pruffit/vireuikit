export {};

declare global {
  interface Window {
    __lab: {
      setA11yOverride: typeof import('vireuikit/web').setA11yOverride;
      setInputOverride: typeof import('vireuikit/web').setInputOverride;
      input: typeof import('vireuikit/web').effectiveInput;
      define: () => void;
      upgraded: boolean;
      nav?: { frame: HTMLElement; resize(width: number, height: number): void; scrollOnDocument(): void };
      sheet?: import('./sheet').SheetSandboxHandle;
      toolbar?: import('./toolbar').ToolbarSandboxHandle;
      /** The core's counters of the work its lenses do: probes, bakes and filter swaps. */
      renderStats(): import('vireglass/dom').RenderStats;
      resetRenderStats(): void;
    };
  }
}

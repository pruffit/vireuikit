export {};

declare global {
  interface Window {
    __lab: {
      setA11yOverride: typeof import('vireuikit/web').setA11yOverride;
      define: () => void;
      upgraded: boolean;
    };
  }
}

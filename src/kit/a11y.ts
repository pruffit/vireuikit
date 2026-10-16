export type A11yMode = {
  reduceTransparency: boolean;
  increaseContrast: boolean;
  reduceMotion: boolean;
};

export const A11Y_NONE: A11yMode = {
  reduceTransparency: false,
  increaseContrast: false,
  reduceMotion: false,
};

/** `undefined` follows the system; a boolean overrides it. */
export type A11yOverride = { [K in keyof A11yMode]?: boolean | undefined };

export function resolveA11y(system: A11yMode, override: A11yOverride = {}): A11yMode {
  return {
    reduceTransparency: override.reduceTransparency ?? system.reduceTransparency,
    increaseContrast: override.increaseContrast ?? system.increaseContrast,
    reduceMotion: override.reduceMotion ?? system.reduceMotion,
  };
}

/** `plain`: no glass was asked for. `frosted`: the stand-in when glass under reduced transparency cannot attach. */
export type Surface = 'plain' | 'frosted' | 'glass';

export type Presentation = {
  glass: boolean;
  /** Reduced transparency: the glass stays and frosts. */
  frost: boolean;
  surface: Surface;
  contrastBorder: boolean;
  instantSprings: boolean;
};

// Reduced motion stops the springs, not the press response itself.
export function presentationFor(mode: A11yMode, wantsGlass: boolean): Presentation {
  return {
    glass: wantsGlass,
    frost: wantsGlass && mode.reduceTransparency,
    surface: wantsGlass ? 'glass' : 'plain',
    contrastBorder: mode.increaseContrast,
    instantSprings: mode.reduceMotion,
  };
}

export function sameA11y(a: A11yMode, b: A11yMode): boolean {
  return (
    a.reduceTransparency === b.reduceTransparency &&
    a.increaseContrast === b.increaseContrast &&
    a.reduceMotion === b.reduceMotion
  );
}

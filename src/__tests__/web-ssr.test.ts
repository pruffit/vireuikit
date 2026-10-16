import { describe, expect, it } from 'vitest';
import { BUTTON_TAG, ICON_BUTTON_TAG, defineVireElements, setA11yOverride, systemA11y } from '../web';

describe('the web entry on a server', () => {
  it('loads without a DOM', () => {
    expect(typeof document).toBe('undefined');
    expect(BUTTON_TAG).toBe('vire-button');
    expect(ICON_BUTTON_TAG).toBe('vire-icon-button');
  });

  it('defining elements is a no-op where there is no registry', () => {
    expect(() => defineVireElements()).not.toThrow();
  });

  it('reads no system settings and still accepts an override', () => {
    expect(systemA11y()).toEqual({ reduceTransparency: false, increaseContrast: false, reduceMotion: false });
    expect(() => setA11yOverride({ reduceMotion: true })).not.toThrow();
    setA11yOverride({ reduceMotion: undefined });
  });
});

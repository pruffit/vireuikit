import { describe, expect, it } from 'vitest';
import { A11Y_NONE, presentationFor, resolveA11y, sameA11y } from '../index';

describe('accessibility modes', () => {
  it('without any setting, glass stays glass', () => {
    expect(presentationFor(A11Y_NONE, true)).toEqual({
      glass: true,
      frost: false,
      surface: 'glass',
      contrastBorder: false,
      instantSprings: false,
    });
  });

  it('reduced transparency keeps the lens and asks it to frost', () => {
    const p = presentationFor({ ...A11Y_NONE, reduceTransparency: true }, true);
    expect(p.glass).toBe(true);
    expect(p.frost).toBe(true);
    expect(p.surface).toBe('glass');
  });

  it('a control that did not ask for glass has nothing to frost', () => {
    const p = presentationFor({ ...A11Y_NONE, reduceTransparency: true }, false);
    expect(p).toMatchObject({ glass: false, frost: false, surface: 'plain' });
  });

  it('increased contrast keeps the lens and asks for a border', () => {
    const p = presentationFor({ ...A11Y_NONE, increaseContrast: true }, true);
    expect(p.glass).toBe(true);
    expect(p.contrastBorder).toBe(true);
  });

  it('increased contrast also borders a control that has no glass', () => {
    const p = presentationFor({ ...A11Y_NONE, increaseContrast: true }, false);
    expect(p.surface).toBe('plain');
    expect(p.contrastBorder).toBe(true);
  });

  it('reduced motion turns the springs instant and leaves the material alone', () => {
    const p = presentationFor({ ...A11Y_NONE, reduceMotion: true }, true);
    expect(p.instantSprings).toBe(true);
    expect(p.glass).toBe(true);
  });

  it('a control that did not ask for glass never gets it', () => {
    const p = presentationFor(A11Y_NONE, false);
    expect(p.glass).toBe(false);
    expect(p.surface).toBe('plain');
  });

  it('the three settings combine', () => {
    const p = presentationFor({ reduceTransparency: true, increaseContrast: true, reduceMotion: true }, true);
    expect(p).toEqual({ glass: true, frost: true, surface: 'glass', contrastBorder: true, instantSprings: true });
  });
});

describe('override', () => {
  const system = { reduceTransparency: true, increaseContrast: false, reduceMotion: false };

  it('follows the system where nothing is overridden', () => {
    expect(resolveA11y(system)).toEqual(system);
    expect(resolveA11y(system, { increaseContrast: undefined })).toEqual(system);
  });

  it('a boolean wins over the system in both directions', () => {
    const out = resolveA11y(system, { reduceTransparency: false, increaseContrast: true });
    expect(out).toEqual({ reduceTransparency: false, increaseContrast: true, reduceMotion: false });
  });

  it('compares two modes', () => {
    expect(sameA11y(system, { ...system })).toBe(true);
    expect(sameA11y(system, A11Y_NONE)).toBe(false);
  });
});

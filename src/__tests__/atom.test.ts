import { describe, expect, it } from 'vitest';
import {
  ATOM_AT_REST,
  atomAtRest,
  atomLift,
  atomMaterial,
  type VireUIKitAtomKind,
} from '../kit/atom';
import { VIREGLASS_CONTROL_MATERIAL } from 'vireglass';

const KINDS: readonly VireUIKitAtomKind[] = [
  'button',
  'iconButton',
  'switch',
  'slider',
  'segment',
  'chip',
  'field',
  'menu',
];

describe('atom states', () => {
  it('the material is untouched at rest', () => {
    expect(atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'button')).toEqual(VIREGLASS_CONTROL_MATERIAL);
    expect(atomAtRest(ATOM_AT_REST)).toBe(true);
  });

  // State, for glass, is a change in the medium, not a highlight on top of it.
  it('press and selection densify the medium', () => {
    for (const key of ['pressed', 'selected'] as const) {
      const on = atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'button', { ...ATOM_AT_REST, [key]: 1 });
      expect(on.ior).toBeGreaterThan(VIREGLASS_CONTROL_MATERIAL.ior);
      expect(on.thickness).toBeGreaterThan(VIREGLASS_CONTROL_MATERIAL.thickness);
      expect(on.roughness).toBeLessThan(VIREGLASS_CONTROL_MATERIAL.roughness);
    }
  });

  it('hover is weaker than press but stronger than rest', () => {
    const hover = atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'button', { ...ATOM_AT_REST, hovered: 1 });
    const press = atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'button', { ...ATOM_AT_REST, pressed: 1 });
    expect(hover.ior).toBeGreaterThan(VIREGLASS_CONTROL_MATERIAL.ior);
    expect(hover.ior).toBeLessThan(press.ior);
  });

  // A touch client has no hover and no focus at all: the atom must be complete at zero.
  it('with no hover, the atom stays itself rather than half-finished', () => {
    const touchRest = atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'iconButton', ATOM_AT_REST);
    expect(touchRest).toEqual(VIREGLASS_CONTROL_MATERIAL);
  });

  it('disabled lifts the legibility requirement but leaves the glass', () => {
    const off = atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'button', {
      ...ATOM_AT_REST,
      disabled: true,
      pressed: 1,
    });
    expect(off.presence).toBeLessThan(VIREGLASS_CONTROL_MATERIAL.presence);
    expect(off.ior).toBe(VIREGLASS_CONTROL_MATERIAL.ior);
    expect(off.thickness).toBeGreaterThan(0);
  });
});

describe('lift into the glass', () => {
  // A small target has the finger covering it entirely — the lens underneath is the only sign of a hit.
  it('small pieces lift, large ones sink', () => {
    expect(atomLift('iconButton')).toBe(1);
    expect(atomLift('switch')).toBe(1);
    expect(atomLift('slider')).toBe(1);
    expect(atomLift('button')).toBe(0);
    expect(atomLift('menu')).toBe(0);
  });

  it('every atom has a lift value, within bounds', () => {
    for (const kind of KINDS) {
      const lift = atomLift(kind);
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThanOrEqual(1);
    }
  });
});

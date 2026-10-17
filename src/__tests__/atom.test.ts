import { describe, expect, it } from 'vitest';
import {
  ATOM_AT_REST,
  atomAtRest,
  atomLift,
  atomBody,
  atomMaterial,
  type VireUIKitAtomKind,
} from '../kit/atom';
import { VIREGLASS_CONTROL_MATERIAL, applyAccessibility, resolveOptics } from 'vireglass';

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

  // The control material carries no presence of its own; a base that does loses most of it.
  it('disabled lifts the legibility requirement but leaves the glass', () => {
    const base = { ...VIREGLASS_CONTROL_MATERIAL, presence: 0.2 };
    const off = atomMaterial(base, 'button', { ...ATOM_AT_REST, disabled: true, pressed: 1 });
    expect(off.presence).toBeLessThan(base.presence / 2);
    expect(off.ior).toBe(base.ior);
    expect(off.thickness).toBeGreaterThan(0);
    expect(atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'button', { ...ATOM_AT_REST, disabled: true, pressed: 1 })).toEqual(
      VIREGLASS_CONTROL_MATERIAL,
    );
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

describe('the body', () => {
  const body = (state: Partial<typeof ATOM_AT_REST> = {}, frost = false) =>
    atomBody(VIREGLASS_CONTROL_MATERIAL, { ...ATOM_AT_REST, ...state }, frost);

  it('rest already carries a body that lifts the backdrop', () => {
    const rest = body();
    expect(rest.alpha).toBeGreaterThan(0.2);
    expect(rest.lift).toBeGreaterThanOrEqual(0.1);
  });

  it('the pressed end is the milky tint the kit already drew', () => {
    expect(body({ pressed: 1 })).toEqual({ alpha: 0.34, white: 0.35, lift: 0 });
  });

  it('hover sits between rest and press, and press past one is clamped', () => {
    const [rest, hover, press] = [body(), body({ hovered: 1 }), body({ pressed: 1 })];
    expect(hover.lift).toBeLessThan(rest.lift);
    expect(hover.lift).toBeGreaterThan(press.lift);
    expect(body({ pressed: 3 })).toEqual(press);
  });

  it('disabled stops asserting itself', () => {
    expect(body({ disabled: true }).alpha).toBeLessThan(body().alpha / 2);
    expect(body({ disabled: true, pressed: 1 })).toEqual(body({ disabled: true }));
  });

  it('reduced transparency raises the body to the density the glass itself asks for', () => {
    const asked = applyAccessibility(resolveOptics(VIREGLASS_CONTROL_MATERIAL), {
      reduceTransparency: true,
      increaseContrast: false,
      reduceMotion: false,
    }).bodyDensity;
    expect(body({}, true).alpha).toBe(asked);
    expect(body({}, true).alpha).toBeGreaterThan(0.7);
    expect(body({}, true).lift).toBeGreaterThan(body().lift);
  });
});

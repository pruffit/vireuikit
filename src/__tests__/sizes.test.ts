import { describe, expect, it } from 'vitest';
import {
  BUTTON_SIZES,
  CONTROL_SIZES,
  MIN_POINTER_TARGET_DP,
  MIN_TOUCH_TARGET_DP,
  defaultSize,
  hitSlop,
  iconButtonSize,
  menuSize,
  minTarget,
  nestedRadius,
} from '../index';

describe('menu sizes', () => {
  it('rows are as tall as the tier, the padding is 0.3 of a row', () => {
    for (const size of CONTROL_SIZES) {
      const menu = menuSize(size);
      expect(menu.row).toBe(BUTTON_SIZES[size].height);
      expect(menu.padding).toBe(Math.round(0.3 * menu.row));
      expect(menu.icon).toBe(BUTTON_SIZES[size].icon);
    }
  });

  it('the menu is concentric with its highlighted item', () => {
    for (const size of CONTROL_SIZES) {
      const menu = menuSize(size);
      expect(menu.itemRadius).toBe(BUTTON_SIZES[size].radius);
      expect(nestedRadius(menu.radius, menu.padding)).toBe(menu.itemRadius);
    }
  });

  // M 5:11: rows 44.9 dp apart, the first glyph's centre 34.6 dp down and 33.8 dp in, the label at 58.8 dp, a 37 dp corner.
  it('the touch tier lands within 2 dp of the reference menu', () => {
    const menu = menuSize('touch');
    expect(menu).toMatchObject({ row: 44, padding: 13, radius: 35 });
    const glyphCentre = menu.padding + menu.row / 2;
    expect(Math.abs(glyphCentre - 34.6)).toBeLessThanOrEqual(2);
    expect(Math.abs(glyphCentre - 33.8)).toBeLessThanOrEqual(2);
    expect(Math.abs(menu.padding + menu.row - 58.8)).toBeLessThanOrEqual(2);
    expect(Math.abs(menu.radius - 37)).toBeLessThanOrEqual(2);
  });
});

describe('sizes', () => {
  it('every tier is at least the pointer target floor, and the finger tier meets the touch floor', () => {
    for (const size of CONTROL_SIZES) {
      expect(BUTTON_SIZES[size].height).toBeGreaterThanOrEqual(MIN_POINTER_TARGET_DP);
    }
    expect(BUTTON_SIZES.touch.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_DP);
  });

  it('tiers grow monotonically from small to xlarge', () => {
    const order = ['small', 'medium', 'large', 'xlarge'] as const;
    for (let i = 1; i < order.length; i += 1) {
      expect(BUTTON_SIZES[order[i]!].height).toBeGreaterThan(BUTTON_SIZES[order[i - 1]!].height);
    }
  });

  it('capsules use half the height as radius, rounded tiers a fixed smaller one', () => {
    for (const size of CONTROL_SIZES) {
      const spec = BUTTON_SIZES[size];
      if (spec.shape === 'capsule') expect(spec.radius).toBe(spec.height / 2);
      else expect(spec.radius).toBeLessThan(spec.height / 2);
    }
  });

  it('large and up are capsules, small and medium are not', () => {
    expect(BUTTON_SIZES.small.shape).toBe('rounded');
    expect(BUTTON_SIZES.medium.shape).toBe('rounded');
    expect(BUTTON_SIZES.large.shape).toBe('capsule');
    expect(BUTTON_SIZES.xlarge.shape).toBe('capsule');
  });

  it('the glyph fits inside the body with room on every side', () => {
    for (const size of CONTROL_SIZES) {
      const spec = BUTTON_SIZES[size];
      expect(spec.icon).toBeLessThan(spec.height);
      expect((spec.height - spec.icon) / 2).toBeGreaterThanOrEqual(6);
    }
  });

  it('an icon button is square with no label padding', () => {
    const icon = iconButtonSize('touch');
    expect(icon.width).toBe(icon.height);
    expect(icon.paddingX).toBe(0);
  });

  it('a nested radius is the outer one less the gap, never negative, with an optional floor', () => {
    expect(nestedRadius(22, 6)).toBe(16);
    expect(nestedRadius(8, 12)).toBe(0);
    expect(nestedRadius(8, 12, 4)).toBe(4);
  });

  it('the hit area reaches past a body that is under the floor, and not past one that meets it', () => {
    expect(hitSlop(24, 44)).toBe(10);
    expect(hitSlop(44, 44)).toBe(0);
    expect(hitSlop(48, 44)).toBe(0);
  });

  it('picks the finger tier for touch and a pointer tier otherwise', () => {
    expect(defaultSize({ touch: true })).toBe('touch');
    expect(defaultSize({ touch: false })).toBe('medium');
  });

  it('a finger needs the touch floor whatever the body size', () => {
    expect(minTarget({ touch: true })).toBe(MIN_TOUCH_TARGET_DP);
    expect(minTarget({ touch: false })).toBe(MIN_POINTER_TARGET_DP);
    expect(hitSlop(BUTTON_SIZES.small.height, minTarget({ touch: true }))).toBe(10);
    expect(hitSlop(BUTTON_SIZES.medium.height, minTarget({ touch: true }))).toBe(6);
  });
});

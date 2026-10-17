import { concentricRadius } from 'vireglass';

export type ControlSize = 'touch' | 'small' | 'medium' | 'large' | 'xlarge';

export const CONTROL_SIZES: readonly ControlSize[] = ['touch', 'small', 'medium', 'large', 'xlarge'];

export type SizeSpec = {
  /** Body height; an icon button is a square of this side. */
  height: number;
  paddingX: number;
  icon: number;
  radius: number;
  shape: 'capsule' | 'rounded';
};

export const MIN_TOUCH_TARGET_DP = 44;
export const MIN_POINTER_TARGET_DP = 24;

const capsule = (height: number, paddingX: number): SizeSpec => ({
  height,
  paddingX,
  icon: Math.round(height / 2),
  radius: height / 2,
  shape: 'capsule',
});

const rounded = (height: number, paddingX: number): SizeSpec => ({
  height,
  paddingX,
  icon: Math.round(height / 2),
  radius: height / 4,
  shape: 'rounded',
});

// Where each number comes from: docs/acceptance.md.
export const BUTTON_SIZES: Readonly<Record<ControlSize, SizeSpec>> = {
  touch: capsule(44, 20),
  small: rounded(24, 10),
  medium: rounded(32, 14),
  large: capsule(40, 18),
  xlarge: capsule(48, 22),
};

export function iconButtonSize(size: ControlSize): SizeSpec & { width: number } {
  const spec = BUTTON_SIZES[size];
  return { ...spec, width: spec.height, paddingX: 0 };
}

export type MenuSizeSpec = {
  /** Row height; the glyph sits centred in a square of it. */
  row: number;
  padding: number;
  /** The active item's highlight. */
  itemRadius: number;
  /** Concentric with the highlight: its radius plus the padding. */
  radius: number;
  icon: number;
  /** The label's inset in an item without a glyph. */
  labelPad: number;
};

const MENU_PADDING = 0.3;

export function menuSize(size: ControlSize): MenuSizeSpec {
  const spec = BUTTON_SIZES[size];
  const padding = Math.round(spec.height * MENU_PADDING);
  return {
    row: spec.height,
    padding,
    itemRadius: spec.radius,
    radius: spec.radius + padding,
    icon: spec.icon,
    labelPad: spec.paddingX,
  };
}

export function nestedRadius(outerRadius: number, inset: number, minimum = 0): number {
  return concentricRadius(outerRadius, inset, minimum);
}

export function defaultSize(input: { touch: boolean }): ControlSize {
  return input.touch ? 'touch' : 'medium';
}

export function hitSlop(bodyDp: number, minTargetDp: number): number {
  return bodyDp >= minTargetDp ? 0 : (minTargetDp - bodyDp) / 2;
}

export function minTarget(input: { touch: boolean }): number {
  return input.touch ? MIN_TOUCH_TARGET_DP : MIN_POINTER_TARGET_DP;
}

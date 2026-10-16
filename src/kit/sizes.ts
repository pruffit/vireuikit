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

// Small and medium stay rounded rectangles, large and up are capsules (D 4:23); touch is a
// capsule (D 4:15). Where each number comes from: docs/acceptance.md.
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

/** Outer radius less the gap (D 3:53, M 7:53); `minimum` keeps a far-from-edge shape in the family. */
export function nestedRadius(outerRadius: number, inset: number, minimum = 0): number {
  return concentricRadius(outerRadius, inset, minimum);
}

export function defaultSize(input: { touch: boolean }): ControlSize {
  return input.touch ? 'touch' : 'medium';
}

/** How far the hit area must reach past the body, per side, to meet the target floor. */
export function hitSlop(bodyDp: number, minTargetDp: number): number {
  return bodyDp >= minTargetDp ? 0 : (minTargetDp - bodyDp) / 2;
}

/** The hit-area floor for the device: a finger needs the larger one whatever the body size. */
export function minTarget(input: { touch: boolean }): number {
  return input.touch ? MIN_TOUCH_TARGET_DP : MIN_POINTER_TARGET_DP;
}

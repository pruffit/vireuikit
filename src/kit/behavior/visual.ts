import type { VireUIKitAtomState } from '../atom';
import { stepSpring, type Spring } from '../morph';
import { controlTargets, type ControlState } from './control';

export type ControlVisual = {
  pressed: Spring;
  hovered: Spring;
  focus: Spring;
};

export const createControlVisual = (): ControlVisual => ({
  pressed: { x: 0, v: 0, target: 0 },
  hovered: { x: 0, v: 0, target: 0 },
  focus: { x: 0, v: 0, target: 0 },
});

// Press attacks fast and settles with a little give; hover and focus just ease.
const PRESS = { response: 0.18, damping: 0.78 };
const HOVER = { response: 0.22, damping: 1 };
const FOCUS = { response: 0.16, damping: 1 };

/** Returns whether anything is still moving, so a target can stop its frame loop. */
export function stepControlVisual(
  visual: ControlVisual,
  dt: number,
  state: ControlState,
  instant = false,
): boolean {
  const t = controlTargets(state);
  visual.pressed.target = t.pressed;
  visual.hovered.target = t.hovered;
  visual.focus.target = t.focus;
  const a = stepSpring(visual.pressed, dt, PRESS.response, PRESS.damping, instant);
  const b = stepSpring(visual.hovered, dt, HOVER.response, HOVER.damping, instant);
  const c = stepSpring(visual.focus, dt, FOCUS.response, FOCUS.damping, instant);
  return a || b || c;
}

// The press may overshoot 1; `atomMaterial` clamps, so the raw value is passed through.
export function visualAtomState(visual: ControlVisual, state: ControlState): VireUIKitAtomState {
  return {
    pressed: visual.pressed.x,
    hovered: visual.hovered.x,
    selected: 0,
    disabled: state.disabled,
  };
}

export function settleControlVisual(visual: ControlVisual, state: ControlState): void {
  stepControlVisual(visual, 0, state, true);
}

import { stepFocus, type FocusChange } from './focus';
import { stepHover, type HoverChange } from './hover';
import { PRESS_IDLE, stepPress, type PressEvent, type PressState } from './press';

/** What this device's input can produce: touch has neither hover nor a focus ring. */
export type InputCaps = { hover: boolean; keyboardFocus: boolean };

export const TOUCH_INPUT: InputCaps = { hover: false, keyboardFocus: false };
export const POINTER_INPUT: InputCaps = { hover: true, keyboardFocus: true };

export type ControlState = {
  press: PressState;
  hovered: boolean;
  focused: boolean;
  disabled: boolean;
};

export const CONTROL_IDLE: ControlState = {
  press: PRESS_IDLE,
  hovered: false,
  focused: false,
  disabled: false,
};

export type ControlEvent = PressEvent | HoverChange | FocusChange | { type: 'disable'; disabled: boolean };

export type ControlStep = { state: ControlState; activated: boolean };

export function stepControl(state: ControlState, event: ControlEvent, caps: InputCaps): ControlStep {
  switch (event.type) {
    case 'down':
    case 'up':
    case 'cancel': {
      const next = stepPress(state.press, event, !state.disabled);
      return { state: { ...state, press: next.state }, activated: next.activated };
    }
    case 'leave': {
      const next = stepPress(state.press, event, !state.disabled);
      return { state: { ...state, press: next.state, hovered: false }, activated: false };
    }
    case 'enter':
      return {
        state: { ...state, hovered: !state.disabled && stepHover(event, caps.hover) },
        activated: false,
      };
    case 'focus':
    case 'blur': {
      // Focus moving away takes the key-up with it, so a held key press must not outlive it.
      const press = event.type === 'blur' && state.press.by === 'keyboard' ? PRESS_IDLE : state.press;
      return {
        state: { ...state, press, focused: !state.disabled && stepFocus(event, caps.keyboardFocus) },
        activated: false,
      };
    }
    case 'disable':
      return {
        state: event.disabled
          ? { press: PRESS_IDLE, hovered: false, focused: false, disabled: true }
          : { ...state, disabled: false },
        activated: false,
      };
  }
}

export type ControlTargets = {
  pressed: number;
  hovered: number;
  focus: number;
  disabled: boolean;
};

export function controlTargets(state: ControlState): ControlTargets {
  return {
    pressed: state.press.by !== null ? 1 : 0,
    hovered: state.hovered ? 1 : 0,
    focus: state.focused ? 1 : 0,
    disabled: state.disabled,
  };
}

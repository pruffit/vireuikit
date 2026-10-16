export type PressSource = 'pointer' | 'keyboard';

export type PressState = { by: PressSource | null };

export type PressEvent =
  | { type: 'down'; source: PressSource }
  | { type: 'up'; source: PressSource }
  | { type: 'cancel' }
  | { type: 'leave' };

export const PRESS_IDLE: PressState = { by: null };

export type PressStep = {
  state: PressState;
  activated: boolean;
};

export function stepPress(state: PressState, event: PressEvent, enabled: boolean): PressStep {
  switch (event.type) {
    case 'down':
      if (!enabled || state.by !== null) return { state, activated: false };
      return { state: { by: event.source }, activated: false };
    case 'up':
      // A key lifted mid-touch is not a tap.
      if (state.by !== event.source) return { state, activated: false };
      return { state: PRESS_IDLE, activated: enabled };
    case 'cancel':
      return { state: PRESS_IDLE, activated: false };
    case 'leave':
      // A key press has no position, so the pointer leaving cannot cancel it.
      return state.by === 'pointer' ? { state: PRESS_IDLE, activated: false } : { state, activated: false };
  }
}

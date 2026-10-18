// The three input layers turned into what an atom needs. One flag cannot do it: a laptop with a touch screen needs
// the pointer's density and the finger's hit area at once, and a tablet with a trackpad stays touch first but hovers.
import { defaultSize, minTarget, type ControlSize } from '../sizes';
import type { InputLayers } from './context';

/** Layout density, for the whole window: the primary pointer. */
export function sizeTier(input: Pick<InputLayers, 'primary'>): ControlSize {
  return defaultSize({ touch: input.primary === 'coarse' });
}

/** The hit area's floor in dp: any coarse input present. The body keeps its size. */
export function hitTarget(input: Pick<InputLayers, 'anyCoarse'>): number {
  return minTarget({ touch: input.anyCoarse });
}

/** Hover is the event's: a mouse or a pen over the control hovers, a finger never does. */
export function hoversWith(pointerType: string): boolean {
  return pointerType !== 'touch';
}

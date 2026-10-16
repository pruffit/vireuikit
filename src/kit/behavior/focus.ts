export type FocusChange = { type: 'focus'; visible: boolean } | { type: 'blur' };

// A click also focuses a button; a ring on every click would read as a press that never lets go.
export function stepFocus(event: FocusChange, hasKeyboardFocus: boolean): boolean {
  return hasKeyboardFocus && event.type === 'focus' && event.visible;
}

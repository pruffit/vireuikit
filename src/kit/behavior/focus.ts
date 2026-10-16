export type FocusChange = { type: 'focus'; visible: boolean } | { type: 'blur' };

// `visible` is the browser's keyboard-modality verdict, so a ring follows a key on any device, and a
// click, which also focuses a button, shows none.
export function stepFocus(event: FocusChange): boolean {
  return event.type === 'focus' && event.visible;
}

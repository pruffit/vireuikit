export type HoverChange = { type: 'enter' } | { type: 'leave' };

export function stepHover(event: HoverChange, canHover: boolean): boolean {
  return canHover && event.type === 'enter';
}

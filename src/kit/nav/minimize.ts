// The bar minimises after a run of scrolling one way, so a jitter never toggles it.
export const MINIMIZE_THRESHOLD = 24;

export type MinimizeState = { minimized: boolean; run: number; last: number };

export const createMinimize = (scrollTop = 0): MinimizeState => ({ minimized: false, run: 0, last: scrollTop });

/** Feeds the scroller's position; returns whether the bar is minimised. */
export function stepMinimize(state: MinimizeState, scrollTop: number): boolean {
  const delta = scrollTop - state.last;
  state.last = scrollTop;
  if (scrollTop <= 0) {
    state.minimized = false;
    state.run = 0;
    return false;
  }
  if (delta === 0) return state.minimized;
  state.run = Math.sign(delta) === Math.sign(state.run) ? state.run + delta : delta;
  if (state.run >= MINIMIZE_THRESHOLD) state.minimized = true;
  else if (state.run <= -MINIMIZE_THRESHOLD) state.minimized = false;
  return state.minimized;
}

/** A tap or focus expands the bar and starts the run over. */
export function expandMinimize(state: MinimizeState): void {
  state.minimized = false;
  state.run = 0;
}

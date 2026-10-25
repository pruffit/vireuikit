import { FRAME_SAMPLES_MIN, observeFrameInterval } from '../kit/morph';

let probing = false;

/** Measures the refresh period over a few frames, once per page; the callbacks only record time. */
export function probeFramePeriod(): void {
  if (probing) return;
  probing = true;
  let left = FRAME_SAMPLES_MIN + 1;
  let last = Number.NaN;
  const tick = (t: number): void => {
    if (!Number.isNaN(last)) observeFrameInterval(t - last);
    last = t;
    left -= 1;
    if (left > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

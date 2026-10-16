import type { Footprint } from './footprint';

export type ReferenceControl = Footprint & {
  id: string;
  /** Path under `VIREUIKIT_REFERENCE_DIR`. */
  file: string;
  /** Source code and timecode, as in docs/acceptance.md. */
  at: string;
  /** What the control is in our kit: a circle is an icon button, a capsule a button. */
  atom: 'button' | 'iconButton';
  /** Which accessibility mode the reference was showing. */
  mode?: 'reduce-transparency';
};

const I137 = 'ios26-4k/i137.00.jpg';

// Footprints are in frame pixels (3840x2160), read off the rim and checked against rings drawn over it.
export const REFERENCE_CONTROLS: readonly ReferenceControl[] = [
  { id: 'a217-skip-left', file: I137, at: 'A 2:17', atom: 'iconButton', cx: 1442, cy: 1079, hw: 112, hh: 112 },
  { id: 'a217-pause', file: I137, at: 'A 2:17', atom: 'iconButton', cx: 1920, cy: 1079, hw: 156, hh: 156 },
  { id: 'a217-skip-right', file: I137, at: 'A 2:17', atom: 'iconButton', cx: 2397, cy: 1079, hw: 111, hh: 111 },
  { id: 'a217-continue', file: I137, at: 'A 2:17', atom: 'button', cx: 1593, cy: 1620, hw: 312, hh: 72 },
  { id: 'a217-info', file: I137, at: 'A 2:17', atom: 'button', cx: 741, cy: 1620, hw: 125, hh: 72 },
  { id: 'a218-more', file: 'ios26-4k/i138.00.jpg', at: 'A 2:18', atom: 'iconButton', cx: 2867, cy: 1227, hw: 247, hh: 247 },
  { id: 'm172-next', file: 'meet4k/m172.00.jpg', at: 'M 2:52', atom: 'iconButton', cx: 2635, cy: 1105, hw: 228, hh: 228 },
  { id: 'm718-bar', file: 'meet4k/m718.00.jpg', at: 'M 11:58', atom: 'button', cx: 1921, cy: 1086, hw: 818, hh: 356 },
  { id: 'm1826-glass', file: 'meet4k/m1106.00.png', at: 'M 18:26', atom: 'iconButton', cx: 1966, cy: 961, hw: 422, hh: 392, ellipse: true },
  { id: 'm1830-reduced', file: 'meet4k/m1110.00.png', at: 'M 18:30', atom: 'iconButton', cx: 1916, cy: 962, hw: 490, hh: 435, ellipse: true, mode: 'reduce-transparency' },
];

export const referenceControl = (id: string): ReferenceControl | undefined =>
  REFERENCE_CONTROLS.find((c) => c.id === id);

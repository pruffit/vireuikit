import { atomLift, type VireUIKitAtomKind } from './atom';

export type PressResponse = {
  /** Fraction of its own size the body adds at full press. */
  grow: number;
  /** Glyph blur at full press, px. */
  defocus: number;
};

// A piece that lifts into the glass grows more: the finger covers it, and the enlarged lens is
// the only sign of a hit (S).
const LIFTING: PressResponse = { grow: 0.18, defocus: 1.6 };
const SINKING: PressResponse = { grow: 0.06, defocus: 1 };

export function pressResponse(kind: VireUIKitAtomKind): PressResponse {
  return atomLift(kind) === 1 ? LIFTING : SINKING;
}

// Atom states — shared across every client: the set of states, what they mean, and what they do
// to the material. Sizes, layout and per-input idioms are client-specific and live elsewhere.
import { activeMaterial, type VireGlassMaterial } from 'vireglass';

export type VireUIKitAtomKind =
  | 'button'
  | 'iconButton'
  | 'switch'
  | 'slider'
  | 'segment'
  | 'chip'
  | 'field'
  | 'menu';

/** Hover and focus don't exist everywhere: touch has neither. The atom accepts them, but has to
 *  look complete at zero too — otherwise a touch client gets an unfinished look. */
export type VireUIKitAtomState = {
  pressed: number;
  hovered: number;
  selected: number;
  disabled: boolean;
};

export const ATOM_AT_REST: VireUIKitAtomState = {
  pressed: 0,
  hovered: 0,
  selected: 0,
  disabled: false,
};

/**
 * Whether the piece lifts INTO the glass under press (1) or sinks into the backing (0).
 *
 * Lift isn't decoration: a small target has the finger covering it entirely, and an enlarged
 * transparent lens underneath is the only sign of a hit. A large target stays visible past the
 * finger, so it reads more naturally sinking toward the backing instead.
 */
export function atomLift(kind: VireUIKitAtomKind): number {
  switch (kind) {
    case 'iconButton':
    case 'switch':
    case 'slider':
      return 1;
    default:
      return 0;
  }
}

/** A disabled piece stays glass but stops asserting itself: the legibility requirement is lifted
 *  and tint turns off. Hiding it via transparency won't do — the material is already transparent. */
const DISABLED_PRESENCE = 0.25;
/** Hover is halfway to a press: the cursor is already on the target, but nothing is chosen yet. */
const HOVER_GAIN = 0.35;

/**
 * The atom's material for a given state. Press and selection go through `activeMaterial` — for
 * glass, state is a change in the MEDIUM itself (denser, thicker, clearer), not a highlight
 * drawn over it.
 */
export function atomMaterial(
  base: VireGlassMaterial,
  kind: VireUIKitAtomKind,
  state: VireUIKitAtomState = ATOM_AT_REST,
): VireGlassMaterial {
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const on = Math.max(clamp(state.selected), clamp(state.pressed), clamp(state.hovered) * HOVER_GAIN);
  const out = activeMaterial(base, state.disabled ? 0 : on);
  if (!state.disabled) return out;
  return { ...out, presence: out.presence * DISABLED_PRESENCE };
}

/** Whether every field on the atom matches rest — lets a client skip redraws for states its own
 *  input can never produce (hover on touch, focus on Android). */
export function atomAtRest(state: VireUIKitAtomState): boolean {
  return (
    state.pressed === 0 && state.hovered === 0 && state.selected === 0 && state.disabled === false
  );
}

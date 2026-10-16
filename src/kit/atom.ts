// Atom states — shared across every client: the set of states, what they mean, and what they do
// to the material. Sizes, layout and per-input idioms are client-specific and live elsewhere.
import { activeMaterial, applyAccessibility, resolveOptics, type VireGlassMaterial } from 'vireglass';

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

/** How far a state is from rest toward the pressed end, 0..1. */
function activation(state: VireUIKitAtomState): number {
  if (state.disabled) return 0;
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return Math.max(clamp(state.selected), clamp(state.pressed), clamp(state.hovered) * HOVER_GAIN);
}

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
  const out = activeMaterial(base, activation(state));
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

/** The veil over the backdrop: the surroundings' colour, `white` of it swapped for white, lifted by `lift` in OKLab lightness. */
export type AtomBody = { alpha: number; white: number; lift: number };

const REST_BODY: AtomBody = { alpha: 0.25, white: 0.15, lift: 0.1 };
const PRESSED_BODY: AtomBody = { alpha: 0.34, white: 0.35, lift: 0 };
const FROST_LIFT = 0.26;

/** Rim strength by the luma behind the control: the core draws it white everywhere, the reference follows the surroundings. */
export function atomRimOpacity(backdropLuma: number, state: VireUIKitAtomState = ATOM_AT_REST): number {
  const t = Math.min(Math.max((backdropLuma - 0.15) / 0.3, 0), 1);
  const rest = 0.27 + 0.38 * t * t * (3 - 2 * t);
  return rest + (1 - rest) * activation(state);
}

/** The body for a state; reduced transparency raises it to the density `vireglass` asks of the glass in that mode. */
export function atomBody(
  base: VireGlassMaterial,
  state: VireUIKitAtomState = ATOM_AT_REST,
  frost = false,
): AtomBody {
  const on = activation(state);
  const mix = (key: keyof AtomBody) => REST_BODY[key] + (PRESSED_BODY[key] - REST_BODY[key]) * on;
  let alpha = mix('alpha');
  let white = mix('white');
  let lift = mix('lift');
  if (state.disabled) alpha *= DISABLED_PRESENCE;
  if (frost) {
    const density = applyAccessibility(resolveOptics(base), {
      reduceTransparency: true,
      increaseContrast: false,
      reduceMotion: false,
    }).bodyDensity;
    alpha = Math.max(alpha, density);
    white = 0;
    lift = FROST_LIFT;
  }
  return { alpha, white, lift };
}

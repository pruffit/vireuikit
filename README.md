# VireUIKit

A UI kit built on top of [VireGlass](https://github.com/pruffit/vireglass)'s physically-derived
glass material: atom state and press/hover/selection behavior for controls, and a
capsule-to-target growth morph.

**Status: 0.x.** The API can still change between minor versions.

## Install

```bash
npm install vireuikit vireglass
```

`vireglass` (3.x) is a peer dependency — this package draws on its material model rather than
shipping its own.

## Atom state and morph

Every control shares one state model — pressed, hovered, selected, disabled — and the same rule
for turning it into a material: press and selection change the glass itself (denser, thicker,
clearer), not a highlight drawn on top of it.

```ts
import { atomMaterial, ATOM_AT_REST } from 'vireuikit';
import { VIREGLASS_CONTROL_MATERIAL } from 'vireglass';

const pressed = atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'button', {
  ...ATOM_AT_REST,
  pressed: 1,
});
```

`growthFrame` drives the two-phase "capsule → drop → target" transition a control uses to open
into a menu or a sheet: the body contracts into a drop, then grows into the target shape.

```ts
import { createGrowthState, growthFrame, growthPhase, stepGrowth } from 'vireuikit';

const state = createGrowthState();
stepGrowth(state, dt, /* open */ true);
const frame = growthFrame(sourceShape, targetShape, anchorPoint, growthPhase(state));
// frame.body: the shape to draw as glass this frame.
```

The default timing is fitted to Apple's reference of a menu growing out of its toolbar. The menu itself is a model
too, so every target shares its keyboard, where it sits and what its surface is on each frame:

```ts
import { MENU_CLOSED, menuPlacement, menuSurfaceFrame, stepMenu } from 'vireuikit';

const step = stepMenu(MENU_CLOSED, { type: 'open', focus: 'first' }, items); // items: { label, disabled }[]
// step.focus says where focus goes; a choice always closes the menu.
const { rect, anchor } = menuPlacement(triggerRect, menuSize, viewport);
const surface = menuSurfaceFrame(triggerBox, { ...rect, radius }, anchor, growthPhase(state));
```

## Web elements

`vireuikit/web` upgrades native controls with custom elements. The control inside works before the
upgrade; afterwards the element drives its states from the model. Glass is opt-in: put `glass` on pieces
of the navigation layer, and leave it off for content.

```html
<vire-button><button>Play</button></vire-button>
<vire-icon-button glass><button aria-label="Share">…</button></vire-icon-button>
```

```ts
import { defineVireElements, setA11yOverride } from 'vireuikit/web';

defineVireElements({ nonce: cspNonce });
setA11yOverride({ reduceTransparency: true });
```

- `<vire-button>` is an action: it sinks and grows slightly under press, and nothing opens out of it unless it is the
  trigger of a `<vire-menu>`.
- `<vire-icon-button>` lifts into the glass under the finger; the lens response is visible while the
  press is held.
- Attributes: `glass` (empty or `present`: a lens at rest; `touch`: a lens only under the finger; absent: no
  glass), `size` (`touch`, `small`, `medium`, `large`, `xlarge`; by default `touch` on a coarse pointer and
  `medium` otherwise), `disabled`.
- On a coarse pointer every size keeps a hit area of at least 44 dp without changing layout.
- The lens reads the backdrop from declared colours and cannot see an image, a video or a canvas. A host that knows
  what lies under the control sets the element's `sample` (a `BackdropSample` from `vireglass`), at any time; `null`
  hands it back to the probe.

  ```ts
  import { statsFromSamples } from 'vireglass/dom';

  playButton.sample = statsFromSamples(coverColours); // [{ r, g, b }, …] in 0–255
  ```

- The element dispatches `vire-glass-ready` once its lens is attached. If the lens cannot be loaded or attached,
  the control stays a complete one on its plain (or, under reduced transparency, opaque frosted) surface, and the next
  setting change tries again.
- Set `disabled` on the host element: it is mirrored onto the inner `<button>` and wins over it. Clearing it on
  the host re-enables the button.
- Under `forced-colors` the elements keep the system colours and drop their own tints and blur.
- Accessibility follows the system `prefers-*` settings; `setA11yOverride` or the element's `a11y`
  property overrides them. Reduced transparency keeps the lens and frosts it: a blurrier lens and a denser body, with the
  ink following the body. Text takes the page's colour; the frosted fallback and the high-contrast bodies assume
  the page's `color-scheme` matches it.
- The elements inject one stylesheet. Under a strict CSP pass `nonce` to `defineVireElements`, or ship the
  exported `STYLES` string yourself.
- Importing the module touches no DOM, so it is safe on a server; `defineVireElements()` is the only call
  that registers anything. An element defined before its markup is parsed waits for its button.

### Menu

`<vire-menu>` wraps a platform popover menu: a trigger button with `popovertarget` (bare, or inside `<vire-button>` or
`<vire-icon-button>`) and a `popover` list of item buttons.

```html
<vire-menu glass>
  <vire-icon-button glass>
    <button popovertarget="more" aria-label="More">…</button>
  </vire-icon-button>
  <div id="more" popover>
    <button popovertarget="more" popovertargetaction="hide"><svg>…</svg>Copy link</button>
    <button popovertarget="more" popovertargetaction="hide">Rename</button>
    <button popovertarget="more" popovertargetaction="hide" disabled>Delete</button>
  </div>
</vire-menu>
```

- Before the element is defined the browser runs it: the trigger toggles the list, a choice clicks the item and closes
  it, Escape and a press outside dismiss it, and focus comes back to the trigger. Write the markup without menu roles.
- After the upgrade the element adds the menu-button roles (`aria-haspopup`, `aria-expanded`, `menu`, `menuitem`)
  together with their keyboard: Enter, Space or ArrowDown open on the first item and ArrowUp on the last; the arrows,
  Home, End and typeahead move over the items; Escape and a choice return focus to the trigger; Tab closes and moves
  on. A pointer opens it with focus on the menu. Removing the element restores the markup.
- A disabled item follows the WAI-ARIA APG: it stays focusable and cannot be chosen. The element turns its `disabled`
  into `aria-disabled="true"`; after the upgrade, change it with `aria-disabled` (setting `disabled` again is turned
  into it too).
- The press that opened the menu chooses nothing: a click on an item counts once the menu has arrived, and neither
  the second click of a double click nor a held key ever counts.
- The list's own `beforetoggle` and `toggle` events fire when it leaves the top layer, after the growth has run back;
  `aria-expanded` turns false as the closing begins.
- The menu grows out of its trigger and covers it: the trigger's body contracts into a drop, the drop grows into the
  menu with a small overshoot, and the content comes into focus near size. A choice closes it, and closing runs the
  same path back into the trigger. Reduced motion opens and closes it in one frame. A menu that has to stay open for
  several picks is a popover, which is another atom.
- While the menu is out, the trigger hands its body to the menu's surface (`setCarried` on `<vire-button>` and
  `<vire-icon-button>`), so there is never glass on glass.
- Attributes: `glass` (empty, `present` or `touch`: the surface is a lens; absent or anything else: an opaque surface), `size` (as for the buttons; rows are as tall
  as the tier), `corner` (`top-left`, `top-right`, `bottom-left`, `bottom-right`: the trigger corner the menu pins to;
  by default the one facing the nearest viewport corner). `sample` works as on the buttons; without one, the backdrop
  under the menu is read once as it opens and held while it is out.

Sizes, behaviour state machines and accessibility modes are exported from `vireuikit` and shared by every
target. How an atom is accepted:
[design](https://github.com/pruffit/vireuikit/blob/main/docs/design.md),
[acceptance](https://github.com/pruffit/vireuikit/blob/main/docs/acceptance.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

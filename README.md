# VireUIKit

A UI kit built on top of [VireGlass](https://github.com/pruffit/vireglass)'s physically-derived
glass material: atom state and press/hover/selection behavior for controls, and a
capsule-to-target growth morph.

**Status: 0.x.** The API can still change between minor versions.

## Install

```bash
npm install vireuikit vireglass
```

`vireglass` is a peer dependency — this package draws on its material model rather than
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

- `<vire-button>` is an action: it sinks and grows slightly under press, and nothing opens out of it.
- `<vire-icon-button>` lifts into the glass under the finger; the lens response is visible while the
  press is held.
- Attributes: `glass` (empty or `present`: a lens at rest; `touch`: a lens only under the finger; absent: no
  glass), `size` (`touch`, `small`, `medium`, `large`, `xlarge`; by default `touch` on a coarse pointer and
  `medium` otherwise), `disabled`.
- On a coarse pointer every size keeps a hit area of at least 44 dp without changing layout.
- The element dispatches `vire-glass-ready` once its lens is attached. If the lens cannot be loaded or attached,
  the control stays a complete one on its plain (or, under reduced transparency, frosted) surface, and the next
  setting change tries again.
- Set `disabled` on the host element: it is mirrored onto the inner `<button>` and wins over it. Clearing it on
  the host re-enables the button.
- Under `forced-colors` the elements keep the system colours and drop their own tints and blur.
- Accessibility follows the system `prefers-*` settings; `setA11yOverride` or the element's `a11y`
  property overrides them. Reduced transparency drops the lens and keeps an opaque control. Text takes the
  page's colour; the opaque and high-contrast bodies assume the page's `color-scheme` matches it.
- The elements inject one stylesheet. Under a strict CSP pass `nonce` to `defineVireElements`, or ship the
  exported `STYLES` string yourself.
- Importing the module touches no DOM, so it is safe on a server; `defineVireElements()` is the only call
  that registers anything. An element defined before its markup is parsed waits for its button.

Sizes, behaviour state machines and accessibility modes are exported from `vireuikit` and shared by every
target. How an atom is accepted:
[design](https://github.com/pruffit/vireuikit/blob/main/docs/design.md),
[acceptance](https://github.com/pruffit/vireuikit/blob/main/docs/acceptance.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

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

const step = stepMenu(MENU_CLOSED, { type: 'open', focus: 'first' }, items); // items: { label, disabled, focusable? }[]
// step.focus says where focus goes; a choice always closes the menu.
const { rect, anchor } = menuPlacement(triggerRect, menuSize, segment); // the trigger's segment of the window, or the viewport
const surface = menuSurfaceFrame(triggerBox, { ...rect, radius }, anchor, growthPhase(state));
```

## Adaptive model

What every atom and pattern becomes across window classes, input and posture is one pure model, so every target
decides the same way. The context is the window in dp, the input in three layers (the primary pointer, any coarse
input, hover, a keyboard), the posture of a folding screen and reduced motion; the functions turn it into forms.

```ts
import { adaptiveContext, halfOpen, INPUT_MIXED, navigationForm, paneLayout, presentationForm } from 'vireuikit';

const window = { width: 673, height: 841 };
const ctx = adaptiveContext({ window, input: INPUT_MIXED, posture: halfOpen('book', window) });

navigationForm(ctx, { primary: 4, secondary: 2, search: true }).form; // 'rail'
paneLayout(ctx, { selected: true, showing: 'detail' }).split; // { kind: 'fold', gap }: the panes split at the fold
presentationForm('sheet', ctx).form; // 'bottom-sheet'; a side sheet from 840 dp
```

- `classifyWindow` holds every threshold: widths 600, 840, 1200 and 1600 dp, heights 480 and 900.
- `navigationForm`: a bar on a compact width and in tabletop, a rail on medium, expanded and a compact height, a
  sidebar from large; the same primary destinations on every form, at most five bar slots with search, no "More".
  `bottomAccessory` places a strip above the bar, in its row or along the content.
- `presentationForm` for a menu, picker, popover, sheet, modal sheet, alert or dialog: a popover is a sheet grown from
  its source below 600, a supplementary sheet is a bottom sheet below 840 and a side sheet from there, sheets fill
  the window on a compact height, and every surface lives in one segment, never across the fold.
- `paneLayout` (list-detail: one pane below 840, a 360 or 412 dp list beside the detail, split at the fold in book
  posture), `supportingPane` (beside the content from large, over it on expanded, remembered), `postureSplit`.
- `toolbarLayout` fits a toolbar into its container: neighbours merge, then the lowest priority goes into "…";
  badged items and the main action stay. `toolbarPlacement` says where the window puts it.
- `sizeTier` follows the primary pointer and `hitTarget` any coarse input, so a laptop with a touch screen gets the
  pointer tier with a 44 dp hit area.
- `formMorph`, `stepFormMorph` and `formMorphFrame` flow one body into its new form on the growth's springs; turned
  back mid-way it runs back from where it is, and under reduced motion it lands in one frame.

On the web the elements collect their part of the context themselves. A shell that lays itself out from the model
watches its root:

```ts
import { setInputOverride, setViewportOverride, watchAdaptiveContext } from 'vireuikit/web';

const stop = watchAdaptiveContext(shell, (ctx) => render(ctx)); // told now and on every change
```

`setInputOverride` lets a host that knows its input better decide the layers, and `setViewportOverride` makes an
element the window, with its own segments; the lab's adaptive stage simulates devices with both.

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
  glass), `size` (`touch`, `small`, `medium`, `large`, `xlarge`; by default `touch` when the primary pointer is
  coarse and `medium` otherwise), `disabled`.
- Wherever a coarse input is present, a touch screen on a laptop too, every size keeps a hit area of at least 44 dp
  without changing layout. Hover comes from the pointer that entered: a mouse on a tablet hovers, a finger never does.
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
- Disabled items are yours to set and clear at any time; the element never rewrites them. A `disabled` item cannot take
  focus, so the keyboard passes over it; an `aria-disabled="true"` item stays focusable, the WAI-ARIA APG way. Neither can
  be chosen.
- The press that opened the menu chooses nothing: a pointer click on an item counts once the menu has arrived, a key
  once its content shows, and neither the second click of a double click nor a held key ever counts.
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
  by default the one facing the nearest corner of the trigger's segment of the window). On a folding screen the menu
  stays in its trigger's half, every frame of its growth included, and scrolls if it is taller. `sample` works as on the buttons; without one, the backdrop
  under the menu is read once as it opens and held while it is out.

### Navigation

`<vire-nav>` upgrades a `<nav>` of links into one glass body that is a bar, a rail or a sidebar by the window it covers,
and changes form through the selected destination.

```html
<vire-nav glass minimize="scroll" scroller="content">
  <nav aria-label="Sections">
    <ul>
      <li><a href="/" aria-current="page"><svg>…</svg>Home</a></li>
      <li><a href="/library"><svg>…</svg>Library</a></li>
    </ul>
    <ul data-secondary>
      <li><a href="/feed"><svg>…</svg>Feed</a></li>
    </ul>
    <a href="/search" data-search><svg>…</svg>Search</a>
  </nav>
  <div data-accessory>…host content, such as a mini player…</div>
</vire-nav>
```

- Before the upgrade it is a list of links. After it the element covers its containing block (give that a position): its
  own box is the window it classifies, so it needs no breakpoints from the host. Only the body, the search, the toggle,
  the scrim and the accessory take the pointer. Links stay links: no `tablist`, no arrow keys, Tab walks them, and
  `aria-current` is the host's to set and move; the pill slides to it. Removing the element restores the markup.
- The form comes from `navigationForm`: a bar on a compact width, a rail on medium and expanded windows, a sidebar from
  large. Destinations beyond the bar's slots move to the secondary list, which shows only in the sidebar; links not shown
  in a form are `hidden`. The host carries `data-form` (`bar`, `rail`, `sidebar`), `data-search` (`button`, `item`,
  `field`) and `data-minimized`.
- A change of form goes through the selection: it lifts into a lens, the old body contracts into it, the new body grows
  out of it and the lens settles into the pill. The lens is glass only while it moves. Focus stays on the same link
  while that link stays shown; a link the new form hides (minimising, a link moving to the secondary list) hands focus to
  the selected link, or to the toggle. Reduced motion lands the new form in one frame.
- On the bar a press lifts the selection into a lens under the finger; a drag moves it, and releasing activates the
  nearest link once. A tap is a plain click on the link.
- Attributes: `form` (`bar`, `rail` or `sidebar`: fixes the form), `collapsed` (the sidebar held as a rail; the toggle
  sets and clears it and the host remembers it), `panes` (panes the content shows; two on a medium window take the bar),
  `minimize="scroll"` with `scroller` (the id of the scrolling element, resolved in the element's root; or set the
  `scroller` property to an element), `search-key` (default `/`), `toggle-label` (the toggle's name, default "Sidebar";
  it never changes, `aria-expanded` says whether the sidebar is shown), `glass` (empty or `present`: glass; otherwise a plain body).
- Minimising: the bar becomes a circle with the selected icon, and the search a second circle, after 24 dp scrolled
  down in the scroller, and expands after 24 dp up, at the top, on a tap on it and when focus enters it.
- `[data-accessory]` is the bottom accessory. It sits over the bar, in the minimised bar's row, or along the bottom of
  the content beside a rail or sidebar, and says which in its `data-placement` (`above-bar`, `in-bar`,
  `content-bottom`): show the transport only when `in-bar`.
- Insets: the element sets `--vire-nav-inset-bottom` and `--vire-nav-inset-start` (px) on its parent for the content to
  clear, and fires `vire-nav-layout` with `{ form, minimized, insets, accessoryPlacement }` whenever any changes.
- Toggle: in the sidebar a button in its head collapses it into a rail (`collapsed`, and `vire-nav-collapse` with
  `{ collapsed: true }`); an expandable rail beside the content clears it (`{ collapsed: false }`); on an expanded window
  a rail opens the sidebar over the content behind a scrim (`aria-expanded` is true then too), closed by Escape, a press on the scrim or a link chosen;
  Escape and the scrim return focus to the toggle if it was inside the navigation. The element stores nothing.
- Where the model gives a shortcut (a large window, or a keyboard in use), `search-key` pressed outside a field clicks
  the search link, which carries `aria-keyshortcuts` only then.
- Every link keeps a 44 dp hit area wherever a coarse input is present, without changing the layout. A `[data-badge]`
  inside a link is a count (or a dot, when empty) at the icon's corner, and only a picture: the element sets
  `aria-hidden="true"` on it and restores the attribute on removal. To say it, put a `[data-badge-label]` in the link;
  it is visually hidden but stays in the link's name:
  `<a href="/messages"><svg>…</svg>Messages<span data-badge>3</span><span data-badge-label>, 3 new</span></a>`. `sample` and `a11y` work as on the buttons.

Sizes, behaviour state machines and accessibility modes are exported from `vireuikit` and shared by every
target. How an atom is accepted:
[design](https://github.com/pruffit/vireuikit/blob/main/docs/design.md),
[acceptance](https://github.com/pruffit/vireuikit/blob/main/docs/acceptance.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

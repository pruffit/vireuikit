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
- `anchor` (an element, or `null`) is the box the menu grows from and returns into instead of its trigger, for a host
  that has moved the trigger out of sight (`<vire-toolbar>` sets it to its "…"); the menu clears it once it has closed.
  `retractInto(el)` runs the growth back into `el` and closes, `retractInto(null)` closes at once, and `follow()` puts
  the menu back on its anchor after the host moved it. A trigger that leaves the document closes an open menu on the spot.

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
  the selected link, or to the toggle. Reduced motion lands the new form in one frame. A press that starts on the bar's inset or between items and ends
  without a drag settles the lens back on the selected item.
- On the bar a press lifts the selection into a lens under the finger; a drag moves it, and releasing activates the
  nearest link once. A tap is a plain click on the link.
- Attributes: `form` (`bar`, `rail` or `sidebar`: fixes the form), `collapsed` (the sidebar held as a rail; the toggle
  sets and clears it and the host remembers it), `panes` (panes the content shows; two on a medium window take the bar),
  `scroll-edge` (`off` or `hard`; see below), `minimize="scroll"` with `scroller` (the id of the scrolling element, resolved in the element's root; or set the
  `scroller` property to an element), `search-key` (default `/`), `toggle-label` (the toggle's name, default "Sidebar";
  it never changes, `aria-expanded` says whether the sidebar is shown), `glass` (empty or `present`: glass; otherwise a plain body).
- Scroll edge: a bar floats over its scroller's bottom edge, so content that slides under it goes out of focus before the glass sees it (the core's `attachScrollEdge`, reference §10). It needs a `scroller` (the id, or the property; `minimize` is not required), glass on and the bar form; the rail and the sidebar have none. The element makes a `[data-vk-edge]` (`aria-hidden`, `pointer-events: none`) as the host's first child, under the body in the stack, over the scroller's visible width and as deep as the bar's own height reaches into it plus the core's reach, and it follows resizes and a change of form. `scroll-edge` sets it: absent is on, `off` turns it off, `hard` is the flat band for pinned content. Over dark glass the dissolve is a light dimming, following the body's ink.
- Minimising: the bar becomes a circle with the selected icon, and the search a second circle, after 24 dp scrolled
  down in the scroller, and expands after 24 dp up, at the top, on a tap on it and when focus enters it. Giving the
  bar another scroller expands it. The element looks the id up again on each change: a node that left the document, or
  that the id no longer names, is let go and the bar expands. The document itself works as a scroller
  (`document.documentElement`, `document.body` or `document.scrollingElement`, listened to on the window), and a
  bounce past either end of the scroll range counts as the end. A step back of less than 4 dp does not break a run.
- `[data-accessory]` is the bottom accessory. It sits over the bar, in the minimised bar's row, or along the bottom of
  the content beside a rail or sidebar, and says which in its `data-placement` (`above-bar`, `in-bar`,
  `content-bottom`): show the transport only when `in-bar`. Beside a side sheet a `content-bottom` accessory ends at the
  sheet's leading edge: the element reads `--vire-sheet-inset-end` on its shell (see the sheet) and re-lays out when
  the sheet publishes it.
- Insets: the element sets `--vire-nav-inset-bottom` and `--vire-nav-inset-start` (px) on its parent for the content to
  clear, and fires `vire-nav-layout` with `{ form, minimized, insets, accessoryPlacement }` whenever any changes.
- Toggle: in the sidebar a button in its head collapses it into a rail (`collapsed`, and `vire-nav-collapse` with
  `{ collapsed: true }`); an expandable rail beside the content clears it (`{ collapsed: false }`); on an expanded window
  a rail opens the sidebar over the content behind a scrim (`aria-expanded` is true then too), closed by Escape, a press on the scrim or a link chosen;
  Escape and the scrim return focus to the toggle if it was inside the navigation. The element stores nothing.
- Where the model gives a shortcut (a large window, or a keyboard in use), `search-key` pressed outside a field clicks
  the search link, which carries `aria-keyshortcuts` while it is shown (the shortcut still works for a link the form hides).
- Every link keeps a 44 dp hit area wherever a coarse input is present, without changing the layout. A `[data-badge]`
  inside a link is a count (or a dot, when empty) at the icon's corner, and only a picture: the element sets
  `aria-hidden="true"` on it and restores the attribute on removal. To say it, put a `[data-badge-label]` in the link;
  it is visually hidden but stays in the link's name:
  `<a href="/messages"><svg>…</svg>Messages<span data-badge>3</span><span data-badge-label>3 new</span></a>`, read as "Messages 3 new". `sample` and `a11y` work as on the buttons. The bar clears the bottom safe area
  (`env(safe-area-inset-bottom)`, read once per layout; 0 where unsupported).
- The element adds nodes inside `<vire-nav>`, so call `defineVireElements()` after a framework has hydrated the markup
  (in an effect, say), not before. The lens's copy follows the selected link's content, and a link that leaves the markup
  is left as the author wrote it.

### Sheet and popover

`<vire-popover>` and `<vire-sheet>` upgrade the platform's own transient surfaces. A surface is one body: it grows out
of the control that presents it, runs back into it on close, and reshapes itself when the window changes class (a
popover is a bottom sheet below 600 dp, a supplementary sheet a side sheet from 840 dp and a third pane from 1600 dp, a
modal sheet is centred from 600 dp, a dialog with fields is full screen below 600 dp). Which form it takes is decided by
`presentationForm` and reflected in `data-form` on the element and the surface.

```html
<vire-popover glass>
  <vire-button glass><button popovertarget="filters">Filters</button></vire-button>
  <div id="filters" popover>…<button popovertarget="filters" popovertargetaction="hide">Done</button></div>
</vire-popover>

<vire-sheet glass detents="medium large">
  <button commandfor="add" command="show-modal">Add to playlist</button>
  <dialog id="add" aria-labelledby="add-title">
    <h2 id="add-title">Add to playlist</h2>…<button commandfor="add" command="close">Close</button>
  </dialog>
</vire-sheet>

<vire-sheet glass kind="sheet">
  <button popovertarget="queue">Queue</button>
  <div id="queue" popover="manual">…</div>
</vire-sheet>
```

- The kinds, from the markup: `<vire-popover>` is a `<button popovertarget>` and a `popover`. `<vire-sheet>` is a
  `<dialog>` opened by `command="show-modal"` and closed by `command="close"` (kind `modal-sheet`; `kind` may say
  `picker`, `dialog` or `alert`), or a `popover="manual"` its button toggles (kind `sheet`, supplementary: the page stays
  usable and only the person closes it). The trigger is optional: a host may call `showModal()` or `showPopover()`
  itself, and the surface then comes in from the bottom edge or from 96 % scale instead of growing out of a control.
- Before the element is defined the browser runs each kind: light dismiss, Escape and focus return for the popover; an
  inert page, Escape and focus moved in and back for the dialog; a toggle for the manual popover. Write the markup
  without roles: the surface gets none (the dialog keeps its name from `aria-labelledby`), only the grabber is a
  `role="slider"`.
- After the upgrade the element runs the show and the hide, so the growth can run back before the surface leaves the
  top layer. A popover becomes `manual` and its buttons' `popovertarget` is lifted; a dialog's `command` and `cancel`
  events, a dialog submit (a `<form method="dialog">`, or a submitter with `formmethod="dialog"`) and a close through
  `command="close"` are intercepted and run back first, but only while the element runs the surface: a dialog it has
  not picked up yet closes natively. A host calling `close()` or `hidePopover()` itself gets no animation, only a clean
  settle, and one calling `showModal()` itself should set `sample`: a modal dialog makes the page inert, and the lens
  reads the backdrop before it opens. Escape closes a popover unless a modal dialog outside it is open, which keeps the
  key. Everything the element added is removed with it: the lifted attributes, the inline properties, the created
  grabber, the `detent` it reflected (an authored one is put back) and its share of the shell's inset.
- A surface's trigger must be inside the element. A `popovertarget` button outside it toggles the platform popover
  with no growth, no carried body and no retraction, and the element only adopts what it sees open.
- The window is the nearest ancestor marked `data-vire-shell`, else the root given to `setViewportOverride`, else the
  viewport. The form, the placement and the detents are measured in it; a positioned ancestor is not a window. A
  bottom sheet's height and detents stand in the part of the window it opens in (one half of a folded screen), and the
  content's size is measured again when it changes after the surface is out (a `<details>` opened, an element shown).
- Growth. A popover grows as the menu does (the trigger's body, a drop, the panel with a small overshoot). A sheet grows
  straight out of its trigger into its box with no drop. The trigger hands its body over while the surface is out
  (`setCarried`), so there is never glass on glass, and takes it back on close. Reduced motion lands opening, closing and
  every change of form in one frame.
- The bottom sheet has detents: `detents="peek medium large"` (`peek` is the content's height, `medium` half the window,
  `large` leaves 56 dp at the top; a supplementary sheet has `medium large`, a popover `peek`, a modal sheet `large`).
  The current one is reflected in `detent`, settable by the host, and announced by a `vire-sheet-detent` event. The
  sheet is inset glass at a low height and becomes opaque and flush as it rises. It follows the finger with no spring and
  resists past the largest detent, springs to the detent the position and velocity choose, and closes below the lowest
  one unless `persistent` is set. The content scrolls first: a drag moves the sheet only from the content's top, and on
  the grabber and the top strip always. `[data-sheet-handle]` marks more chrome that drags.
- With more than one detent the grabber is a created `<div role="slider" aria-orientation="vertical">` with a 44 dp hit
  area, whose `aria-label` is `grabber-label` (default "Sheet height") and whose `aria-valuetext` is the detent's name;
  `detent-labels="peek=Compact; medium=Half; large=Full"` says them in the page's language (a name left out keeps the
  English one). The arrows, Home and End change the detent, a tap moves to the next. With one detent it is only a picture
  of the swipe (`aria-hidden="true"`, not focusable, no role); a swipe, Escape and the close button still close the
  sheet. With a field focused and the visual viewport shrunk by a keyboard, the sheet takes its largest detent above the
  keyboard and goes back when it leaves, unless the person moved it.
- A side sheet publishes `--vire-sheet-inset-end` on its shell (the width and gaps it takes from the content; custom
  properties inherit, so every layout inside the shell can read it) and fires a bubbling `vire-sheet-inset` event
  there with `{ inset }` when it changes. With several side sheets open the shell carries the widest; the last one to
  close gives back what the shell had. From 1600 dp the third pane is opaque and not glass, like full screen.
- The scrim is 32 % black under a modal surface and under a popover's sheet form. A press on it closes a bottom sheet or
  a popover, never a centred sheet, a dialog, an alert or a `persistent` surface. The background is never scaled or moved.
- Scroll edge: while its glass is on, the grabber strip at the top of a sheet or popover floats over the content that scrolls under it, and that content goes out of focus toward the top before it is seen (the surface is its own scroller; the edge is a `[data-vk-edge]` that sticks to its top). `scroll-edge` is absent for on, `off`, or `hard`.
- Attributes: `glass` (as on the menu), `kind`, `detents`, `detent`, `persistent`, `grabber-label`, `detent-labels`, `scroll-edge`. Properties: `a11y`,
  `sample`, `detent`, `open`, `anchor` (the box to grow from and return into instead of the trigger, cleared on close;
  `retractInto(el)` and `follow()` as on the menu). Reduced transparency and increased contrast make every form opaque, with the same geometry
  and no lens; glass off is a plain opaque body with a shadow.
- The lab forces states with `data-vire-force-state`: `open`, `open:<detent>` and `grow:<t>` (a growth frozen at `t`).

### Toolbar

`<vire-toolbar>` upgrades groups of buttons into one toolbar that fits its container: separate capsules, then neighbours
merge through a neck, then the lowest priorities go into a "…" menu, and where it stands (the bottom, the top, a trailing
strip) comes from the window. Every item stays reachable at every width.

```html
<vire-toolbar aria-label="Track actions" glass>
  <div data-group>
    <vire-icon-button><button aria-label="Back" data-priority="9">…</button></vire-icon-button>
  </div>
  <div data-spacer></div>
  <div data-group>
    <vire-icon-button><button aria-label="Share" data-priority="5">…</button></vire-icon-button>
    <vire-icon-button><button aria-label="Like" data-priority="6">…<span data-badge>2</span></button></vire-icon-button>
    <vire-menu>
      <vire-icon-button><button aria-label="Add" popovertarget="add">…</button></vire-icon-button>
      <div id="add" popover><button popovertarget="add" popovertargetaction="hide">New playlist</button></div>
    </vire-menu>
  </div>
  <div data-group>
    <vire-button data-primary><button>Done</button></vire-button>
  </div>
</vire-toolbar>
```

- The first HTML is buttons in groups, and works before the element is defined: write `vire-toolbar { display: flex;
  flex-wrap: wrap; gap: 8px 16px }` and the same for `[data-group]` and the groups wrap, every button is a Tab stop, and
  nothing is hidden or scrolled. There is no `role`: the role promises arrow keys and one Tab stop.
- An item is a bare `<button>`, a `<vire-button>`, a `<vire-icon-button>`, or a `<vire-menu>`, `<vire-popover>` or
  `<vire-sheet>` whose trigger button is the item. A button with no visible text is an icon (an `aria-label` names it, and
  it is its row's label in "…"); one with text is a text item, measured at its natural width. Put `data-priority` (a
  number, higher stays longer) and `data-primary` (the one main action: it stands last and never goes into "…") on the item
  or on its button, and a `[data-badge]` inside it for a status, which never goes into "…" either. Neighbours merge only
  inside their own `[data-group]`, and never a text item with an icon. A `[data-spacer]` after a group pushes the groups
  after it to the trailing end; without one the capsules pack from the leading edge, and are centred on the bottom edge.
- After the upgrade the element is the WAI-ARIA toolbar: `role="toolbar"` with your `aria-label`, `aria-orientation`, one
  Tab stop (a roving `tabindex`; the last item focused is the one Tab comes back to), the arrows along the axis, Home and
  End, with disabled items passed over. Removing the element gives the markup back.
- Where it stands is `toolbarPlacement`'s, reflected in `data-edge` (`bottom`, `top` or `trailing`) and
  `data-orientation`; the window is the nearest `data-vire-shell`, else the viewport, as for the sheet. The `placement`
  attribute fixes the edge for a host that knows it. A change of place is not a morph: the old form dematerialises and the
  new one materialises, laid out for its own container. The default style is:
  - `bottom`: floats `8px` above `--vire-nav-inset-bottom`, inline-centred, in its containing block (`position: absolute`,
    so give that block `position: relative`);
  - `top`: in flow at the top of its pane;
  - `trailing`: a vertical strip at the containing block's trailing side, icons only; text items stand in a horizontal row
    at its foot.

  A host that wants another place overrides `position`, `inset` and `margin`; the element's own extent along the toolbar is
  what the layout is computed for, and it needs no padding.
- Glass: `glass` as on the menu. Every capsule is a lens of the toolbar's own, and capsules that are joining or
  separating are one lens over their outline, so a toolbar never has glass on glass: the kit's controls inside it are set
  to `glass="off"` (and put back on removal) and draw no body of their own. All the capsules take one backdrop reading, so
  they agree on their ink; set the element's `sample` when you know what lies under it. Reduced transparency frosts the
  capsules, increased contrast makes them dense and outlined, glass off makes them plain, with the same geometry in every
  case: the gap is the one sign of a group.
- Stage changes move: merging closes the gap between two capsules through a neck, overflow collapses the leaving slot into
  "…", which buds out of the trailing end, and a glyph that stays moves continuously while the others defocus. A stage
  holds for 8 dp past its threshold, so a width on the edge does not flicker. Reduced motion lands a change in one frame.
- "…" is a `<vire-menu>` the element creates (`more-label`, "More" by default, names it) with a row, icon and label, for
  each overflowed item in toolbar order. Choosing a row clicks the original button once; for an item that opens a menu, a
  popover or a sheet, that surface grows from "…" (its `anchor`) once the menu has closed. "…" has no badge.
- An open menu, popover or sheet whose trigger goes into "…" runs back into "…" and closes, and focus goes to "…"; one whose
  trigger only merges stays open and follows it. A trigger removed from the toolbar closes its surface, and focus goes to
  the neighbouring item. A focused item that goes into "…" hands focus to it.
- Scroll edge: the bottom and top toolbars float over a scroller, and content that slides under them goes out of focus before the glass sees it, as on the navigation bar. `scroller` is the id of the scrolling element (resolved in the element's root) or the `scroller` property, as on `<vire-nav>`; with glass on, an edge sits at the scroller's edge the toolbar stands on (none on the trailing strip, and none for a toolbar that stands clear of the scroller). `scroll-edge` is absent for on, `off`, or `hard` for pinned content.
- Every item keeps a hit area of 44 dp wherever any coarse input is present, whatever its size. Attributes: `placement`,
  `more-label`, `glass`, `scroller`, `scroll-edge`. Properties: `a11y`, `sample`, `scroller`. It dispatches `vire-glass-ready` and `vire-toolbar-layout`
  (`{ edge, orientation, stage, overflow }`), and reflects `data-stage` (`separate`, `merged` or `overflow`).
- The lab forces states with `data-vire-force-state`: `stage:<separate|merged|overflow>` (the available extent is the
  stage's, and the group cap is lifted so every stage shows in every place), `morph:<t>` after it (that stage's change frozen
  at `t`) and `place:<t>` (a change of place frozen at `t`), separated by commas.

Sizes, behaviour state machines and accessibility modes are exported from `vireuikit` and shared by every
target. How an atom is accepted:
[design](https://github.com/pruffit/vireuikit/blob/main/docs/design.md),
[acceptance](https://github.com/pruffit/vireuikit/blob/main/docs/acceptance.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

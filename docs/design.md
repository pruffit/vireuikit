# VireUIKit design

How the kit is built and how an atom is accepted. Research behind it (the reference analysis and the atom
spec) lives outside this repository; this document only covers the code.

## Principles

- **The kit depends only on the glass and on research.** `vireglass` provides the material; behaviour, states,
  sizes and flows come from the reference. No application code is a source for the kit; applications adopt it.
- **One model, several targets.** Everything that must not differ between platforms (states and their meaning,
  what an atom flows into and on which event, accessibility responses, sizes in dp) is a pure model in
  `src/kit/`. Targets render it: the web first, Android after an atom matches the reference on the web.
- **An atom works before the glass.** On the web the first HTML is a working native control (button, checkbox,
  range, radio group, input). Glass is attached on top after the element upgrades, and an atom with glass off
  stays clickable, readable and announced by a screen reader.
- **Glass only in the navigation layer.** No glass inside content (cards, lists, form fields), no glass on glass,
  no solid fill instead of tint, no tint on everything, no mixing of Regular and Clear on neighbours.
- **The form comes from the adaptive model.** What an atom or a pattern becomes on a window class, an input and a
  posture is decided once, in `src/kit/adaptive`, and every target asks it; no target keeps its own breakpoints or
  input flags. A change of form is a morph of one body, and the person's state survives it.

## Layout

| Path | What | Published |
|---|---|---|
| `src/kit/` | Model: kinds, states, material per state (`atom.ts`), growth morph (`morph.ts`), the menu's keyboard, placement and surface (`menu.ts`), sizes in dp (`sizes.ts`), behaviours as pure state machines (`behavior/`), accessibility modes, the adaptive model (`adaptive/`) and boxes (`geometry.ts`) | yes, `vireuikit` |
| `src/web/` | Custom elements (`<vire-button>`, `<vire-icon-button>`, `<vire-menu>`, …). Each wraps native markup passed as light DOM, upgrades it, attaches glass with `vireglass/dom` where the atom is a navigation-layer piece, and drives states from the model. `environment.ts` collects the adaptive context (input layers, viewport segments) | yes, `vireuikit/web` |
| `src/native/` | Android target, after the web | not started; will be `vireuikit/native` |
| `lab/` | The test environment: a Vite app with a gallery per atom (every state, forced via URL), backdrops, accessibility toggles, glass on/off, an interaction sandbox, a reference viewer and the adaptive stage | no |
| `tests/lab/` | Playwright tests against the lab: behaviour (`*behavior.spec.ts`) and visual snapshots (`*visual.spec.ts`) | no |

Custom elements because the consumers differ: a React app (VireMusic web) and plain DOM in a shadow tree
(VireBook). A custom element works in both without a framework adapter.

## The lab

`npm run lab` serves it. Every view is addressable by URL (`?atom=button&state=pressed&backdrop=photo&glass=0`),
so a screenshot or a gate can open exactly one case. A state is forced with the `data-vire-force-state`
attribute, a development aid of the elements that the lab and the snapshots use.

- **Backdrops** are generated (gradients, a text page, a busy interface, photo-like noise), so the repository
  carries no third-party images.
- **Reference viewer** shows frames from the reference videos next to the atom. The frames are read from a
  local directory given by `VIREUIKIT_REFERENCE_DIR`; they are third-party material and are never committed.
- **Reference backdrop** (`?view=reference&ref=<id>`) puts our atom on the backdrop around a reference control, at the
  same relative size, so the two can be measured on the same pixels. `npx playwright test reference` prints the
  measurements side by side, our atom at rest and pressed (it is skipped when the directory is not set).
- **Image backdrops** hand the elements a backdrop sample (`sample`), because the lens's probe reads declared colours
  and cannot see an image: the photo the sample of the whole picture, the reference backdrop that of the control's
  footprint.
- **Adaptive stage** (`?view=adaptive&w=673&h=841&posture=book&input=touch`, or `preset=…`) draws a window at a size
  in dp with a resize handle, presets from a folded phone to an ultrawide desktop, a fold (posture, `fold` position,
  `band`, `occluding`) and the input layers (`touch`, `pointer`, `mixed`, `tablet-keyboard`, `keyboard`). The real atoms
  inside take their adaptive forms; the patterns not built yet are labelled outlines placed by the model. A readout
  lists every decision, and scenarios sweep the width, fold and unfold, rotate and attach a keyboard, checking the
  person's state on each step. `foldaware=0` hides the fold from the atoms only, for the canary.

## Gates

| Gate | Checks |
|---|---|
| `npm test` | the model: states, flow boundaries, sizes, accessibility responses, and the adaptive model's every class boundary and transition |
| `npm run check:lab` | Playwright behaviour tests on the lab, no screenshots: roles and keyboard, state transitions, events, upgrade while parsing, glass-off degradation, accessibility modes, hit area, the menu's growth sampled frame by frame and what it hands the lens, the resting body and rim measured on the pixels of a render against bounds taken from the reference (`docs/acceptance.md`, "Resting body"), the atoms' three input layers (a fine pointer with touch present through stubbed media queries) and a menu on a real fold (the DevTools display feature), and the adaptive stage (one navigation body through a sweep, morph continuity, state across thresholds, menus in their half), with canaries that must fail. Runs in CI |
| `npm run check:lab:visual` | the screenshot set: atom × state × backdrop × glass on/off, and the adaptive stage at six presets, against committed baselines in `tests/lab/__screenshots__/<platform>/`. Local only: the baselines are Windows renders and CI does not run it. `npm run check:lab:visual:update` rewrites them |
| existing | `check:english`, `check:package`, `check:readme`, `typecheck` (the model under `src/kit` is also checked with no DOM lib), `build` |

Visual baselines change only on purpose, in the same commit as the code that changes the look.

The comparison is strict: colour `threshold` 0.02 and `maxDiffPixelRatio` 0.0005. Playwright's default threshold of 0.2
passed a whole resting body unnoticed. Against the previous look (body alpha 0) 0.02 fails on every glass-on case, and
it is stable over repeated runs on the baselines' machine. It does not see a fifth off the body's lift (0.10 to 0.08);
that is what the numeric bounds in `check:lab` are for. `--update-snapshots` rewrites only files that fail, so delete a
baseline to force a rewrite.

## The menu

The research defines the menu by two things: it is the result of growth out of its trigger, with closing as the
same growth run backwards, and it closes after a choice. How the web element gets there:

- **The first HTML is the platform's popover.** A trigger `<button popovertarget>` (bare, or inside `<vire-button>`
  or `<vire-icon-button>`) and a `popover` list of item buttons with `popovertargetaction="hide"`. Without the
  element the browser opens and closes it, a choice closes it, Escape and a press outside dismiss it, and focus comes
  back to the trigger. The markup carries no menu roles: `role="menu"` promises arrow keys, so the element adds the
  roles together with the keyboard and takes them away on disconnect.
- **After the upgrade the element shows and hides the list.** The list becomes a `manual` popover and the
  `popovertarget` attributes are lifted (and restored on disconnect), because the platform hides a popover at once and
  the growth has to run back before the list leaves the top layer. Escape, a press outside and Tab are the element's
  then; the keyboard follows the menu-button pattern (`stepMenu`).
- **One body.** The menu replaces its trigger (M 5:11 and the showcase frames: the trigger is gone while the menu is
  out). The list is the one glass surface; while the menu is out the trigger hands its body over (`setCarried` on the
  control elements: no lens, no body, the glyph defocusing with the growth), so the two never stack as glass on glass,
  and the trigger takes the body back when the surface has retracted onto it.
- **The core's morph.** Each frame the surface's box is the growth frame's body (`menuSurfaceFrame`) and the second
  shape goes to the lens's `setMorph`, offset from the surface's centre; the content keeps its final position while
  the box moves, so it is revealed and comes into focus rather than sliding in.
- **Placement is under the finger.** The menu pins to the trigger's corner that points to the nearest corner of its
  region and grows into the open space (S: the button morphs into the menu so the grip does not change). The region is
  the trigger's segment of the window, so on a folding screen the menu stays in its half, and every frame of the growth,
  the overshoot included, is held inside it. The `corner` attribute fixes the corner for a host that knows its layout.
- **A menu does not flip.** Larger elements adapt but do not switch between light and dark (M 15:29), so the backdrop
  is read once as the menu opens (or taken from the host's `sample`) and held while it is out.
- **Disabled stays the author's.** The element never rewrites `disabled` or `aria-disabled`, so either can be set and
  cleared at any time (React clears `disabled` with `removeAttribute`). A native disabled button cannot take focus, so
  the arrows, typeahead and the pointer pass over it; an `aria-disabled="true"` item is the WAI-ARIA APG's variant,
  reached by all of them. Neither can be chosen. A focused item that turns natively disabled hands focus to the menu.
- **The press that opened the menu does not choose.** The first item grows in under the pointer, so a pointer click
  counts only once the menu has arrived (content in focus, surface past its overshoot) and its press began after that; a
  deliberate key, which is not under the pointer, counts once the content is in focus. The second click of a double
  click and held keys never count. A choice is taken in the capture phase, so it closes the
  menu even when an item's handler stops the click.
- **A closed shadow root hides the menu from the document**, so a press outside is judged in the innermost tree that
  can see it, one listener per tree from the element's root out to the document.
- **The list's `toggle` event comes late.** It fires when the list leaves the top layer, after the growth has run
  back; `aria-expanded` turns false as the closing begins.

## The adaptive layer

The adaptive map (research, outside this repository) says what every atom and pattern becomes across window classes,
input and posture. The kit holds it as data in, form out:

- **The context** (`AdaptiveContext`): the window in dp, the input in three layers (the primary pointer, any coarse
  input, hover available, a keyboard present), the posture (flat, tabletop or book, with the fold's bounds and whether
  it occludes) and reduced motion. `classifyWindow` holds every threshold: widths 600, 840, 1200 and 1600, heights 480
  and 900. `windowSegments` and `postureFromSegments` convert between a posture and the segments a target reports.
- **Pure functions** turn it into forms: `navigationForm` (bar, rail or sidebar, the search's form, what is secondary),
  `bottomAccessory`, `presentationForm` (what a menu, picker, popover, sheet, modal sheet, alert or dialog becomes,
  and the segment it lives in), `paneLayout` and `supportingPane`, `postureSplit`, `toolbarPlacement` from the window
  and `toolbarLayout` from the toolbar's own container, `sizeTier` and `hitTarget` from the input layers, and
  `formMorph` with `stepFormMorph` and `formMorphFrame`, which reshape one body on the growth's springs, turn back
  mid-way and land in one frame under reduced motion. Nothing in them is music-specific: a player maps onto the bottom
  accessory and the supporting pane.
- **Targets collect the context and draw the form.** The web's `environment.ts` reads `pointer`, `any-pointer` and
  `any-hover`, learns a keyboard from a key pressed outside a field, reads `window.viewport.segments`, and
  `watchAdaptiveContext(root, …)` gives a shell root its context whenever any part changes. The elements read what they
  need: the tier from the primary pointer, the hit area from any coarse input, hover from the event, and the menu its
  trigger's segment. `setInputOverride` and `setViewportOverride` let a host or a simulation decide instead; the stage
  uses both. Android will take the context from its window size class and `FoldingFeature`, and Material's own
  scaffolds must not decide forms in the model's place, or the targets drift apart.

Acceptance of the layer is the AD criteria in `docs/acceptance.md`.

## Acceptance of an atom

An atom is done when:

1. its model has unit tests;
2. the lab shows every state on every backdrop, with glass on and off;
3. Playwright covers its behaviour, keyboard and roles, degradation and accessibility toggles (`check:lab`);
4. every reference criterion for it is written in `docs/acceptance.md` with how it is checked — by a gate where
   it is measurable, by a side-by-side with the reference frame where it is visual;
5. its baselines are committed (`check:lab:visual`).

## Order

0. Foundation: `sizes.ts`, the behaviour base, the web element base with progressive enhancement and glass
   attach, the lab, `check:lab`.
1. Button and icon button: press, hover and focus where the input has them, disabled; the icon button lifts
   into the glass under the finger.
2. Menu: grows out of its trigger, closes after a choice, closing retraces the growth.
3. The adaptive model and its stage: classes, input layers, posture, the forms of every pattern, and the three input
   layers and segment placement in the atoms above.
4. Navigation: bar, rail and sidebar as one body that morphs between them, the search's forms, the bottom accessory.
5. Sheet and popover: a popover that becomes a sheet grown from its source, bottom and side sheets, the full-screen
   forms.
6. Toolbar: merging neighbours and overflow by priority into "…", in its container's width.
7. Search field: a button that flows into a bottom field on compact, a page with the field in focus, a persistent
   field.
8. Switch and slider: the knob lifts into the glass while held.
9. Segmented control: breaks into parts on entering selection mode.
10. Chip and field: grow into a popover or suggestions where they open a list.

Decided on 18.10.2026: the atoms the adaptive map names (4 to 7) come before switch, slider, segmented control and
chip. An atom has to know its adaptive forms before it is built; these four are the ones whose form changes with the
window, so building another atom first would build it against a frame that is not there yet, and the later atoms
(a segmented control that becomes a menu, a chip that opens a sheet on compact) are made of their forms.

Then each accepted atom is reproduced on Android in the same model.

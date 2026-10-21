# Changelog

## Unreleased

- **The menu's growth follows the reference frame by frame** (#37). The surface is one body of the capsule and the drop rising out of it (a bud on the way in, a bump merging back on the way out), the drop is bright, nearly opaque white that the glass lets go of as the body takes its size, the content rides inside the lens magnified and out of focus and clears after the body has reached it, the height of the body trails its width, and closing runs back to where the drop formed and a few dp past it. The drop is sized from the source's area, so a wide toolbar gathers more glass than a round button, and the sink past the drop is bounded by the source's size. `DEFAULT_GROWTH_TIMING` is refitted; the popover and the sheets keep the earlier pace (`POPOVER_GROWTH_TIMING`, from which `SHEET_GROWTH_TIMING` and `FORM_MORPH_TIMING` derive). `unionOutline` bridges a gap between its shapes. While the menu grows its items take no pointer (`data-arrived` turns them on), and a key chooses from the first frame the content is drawn. `npm run check:lab:reference` measures the `view=menu-reference` stage against the frames (the reference's frames one either side of each instant as an envelope; silhouette overlap, lightness, edge energy of the content, centroid), locally, since the frames are never committed. The resting menu is unchanged: the menu snapshots moved only in their growing and retracting tiles.
- **Breaking, for the next minor** (the kit is 0.x): `GrowthState` requires `height`, `focus`, `rise` and `glow` springs (`createGrowthState`, `heldGrowthState` and `growthStateAt` build them) and `GrowthPhase` gains the same as optional fields; `GrowthTiming` requires `heightOpen`, `heightDampingOpen`, `heightClose`, `riseOpen`, `riseDampingOpen`, `riseClose`, `riseDampingClose`, `focusOpen`, `focusClose`, `glowOpen` and `glowClose` (spread `DEFAULT_GROWTH_TIMING` to keep a custom timing working) and its default values changed; `stepSpring` takes a sixth parameter, `rest`; `menuSurfaceFrame` takes an options argument and returns `outline` and `capsule`, `menuMaterial` takes `capsule`, and `MENU_DROP_BODY` is now opaque; the drop's size follows the source's area, so a round button's drop is smaller than before; `menuCapsule`, `heldGrowthState`, `growthStateAt`, `POPOVER_GROWTH_TIMING`, `unionBounds` and `unionOutline` are public; the content's custom properties `--vk-cx` and `--vk-cy` are replaced by `--vk-tx`, `--vk-ty` and `--vk-s`. Behaviour of the menu (N25): a pointer click is still dropped until the menu has arrived (its content in focus and its surface past the overshoot, about 0.5 s now that the content comes into focus on its own spring), but a key chooses from the first frame the content is drawn (about 0.3 s) and no longer waits for focus, as before the refit; a key before that, a held key and the second press of an opening double press are still dropped.
- **The scroll edge** (reference §10; needs `vireglass` ^3.4.0, whose ramp is strongest at the scroller's edge). Content that scrolls under a floating bar goes out of focus toward the edge before the glass sees it, so text under the bar no longer fights the text on it (the list's "Track 13" reading through the navigation bar over Home and Library). `<vire-nav>` in its bar form, `<vire-toolbar>` on its top and bottom edges and a `<vire-sheet>` or `<vire-popover>`'s top strip each make an `aria-hidden`, `pointer-events: none` `[data-vk-edge]` under their glass and drive it with the core's `attachScrollEdge`: a dissolve over light glass, a light dimming over dark glass (it follows the glass's ink), a flat band for `scroll-edge="hard"`. `scroll-edge` is absent for on, `off` or `hard`; `<vire-toolbar>` takes `scroller` (an id, or the property) as the navigation does and looks an id up again whenever its markup is touched, and the navigation takes it without `minimize`. There is none with glass off, on the rail, the sidebar or the trailing strip, or for a toolbar clear of its scroller. The band follows resizes, a navigation accessory and a change of form or placement, the navigation's edge follows the glass when its ink flips, and a scroll reads no rect and no computed style (the core reads the scroller's `scrollHeight`). A sync that changes nothing reads no geometry.
- **The legibility gate.** The sheet's contrast gate (SH21) becomes `tests/lab/legibility-behavior.spec.ts`: the navigation bar, rail and sidebar, the toolbar on the bottom and the top, the menu, the popover, the button and the icon button are each rendered over a scroller of body text scrolled under them, on a page of text and on a photo, glass on and off, and their text must reach 4.5:1 and their glyphs 3:1 against what is behind them in a screenshot taken with the atom's ink made transparent (by the median and by the tenth hardest on the ink). The ink is measured as painted (its alpha and its elements' opacity count) from a screenshot that hides only the ink, so a tint painted with `currentColor` stays, and each scene must draw its expected labels and glyphs. The glass-off button and icon button get a Canvas body under their 10% tint and pass (they read 1.4 to 2.3:1 on the text page before). **Since `vireglass` 3.4.0 the rail and a button floating over body text pass too** (the control material's roughness goes from 0.035 to 0.18, a blur of σ 2.16 pt where Chromium rendered none): the text's hardest tenth reads 8.3 (rail, text page), 5.2 (rail, photo), 10.9 and 6.5 (button) against 4.0 and 3.1 before, and the icon button's glyphs 10.6 and 6.5. The kit adds no tint or density. The bars no longer fall under 4.5:1 without the scroll edge, so its canaries now assert the lift it still gives. The lab gains `?view=legibility`, `window.__lab.sample` and `window.__lab.probe`. `docs/acceptance.md` holds the SE and LG criteria.

- **Motion at frame rate** (needs `vireglass` ^3.2.1; a navigation lens or sheet drag held still sends the core a heartbeat once a second so it stays in interim). Every glass that changes shape over frames (the menu, the navigation's body, accessory and lens, the sheet and popover, the toolbar's capsules) is held in interim while it moves and baked once after it lands, so a morph, drag or growth with glass on costs the core no probe, bake or filter swap on any frame of the change (`check:lab` counts them over every transition) and its landing is one bake per surface. `check:lab:perf` times the frames from the start to 400 ms past the last active one and prints them beside the glass-off run: on this machine's integrated GPU the p90 is 16.8 ms for nearly every transition, and the single landing frames that run long are in its table. A trigger whose body a surface has taken carries no lens until the body comes back. While moving, a navigation body is not handed a new second shape, and a menu or sheet's morph is on a coarse grid. The definition of done gains motion gates (`docs/design.md`, `docs/acceptance.md` MO1 to MO7): the core's counters over every transition in `check:lab`, and `npm run check:lab:perf` for the frames in a headed GPU Chromium.
- **Presence is the lens's, never the element's opacity.** A toolbar capsule and the navigation's lens materialise by `setAppear` on every frame of a move or a lift (`vireglass` 3.2 writes it on the filter and bakes nothing), so the glass is never translucent on the way, as in the reference (B20). Without glass they still fade by opacity. The navigation lens's veil follows the lift, its glyph copy cross-fades with the glyph it replaces, and its material steps (ten, reduced bakes only) stay. The motion gate has a canary for a core that bakes for presence.
- **The navigation's drag lens** (#35). While held it shows a crisp magnified copy of the item under it, tinted by `--vire-nav-accent`, and the real glyphs under it are not drawn, so its bevel never tears one; the selected pill is gone from the bar while held; the dark fill under the lens (`data-lens-over`) is gone, and hover is a fainter response (5 %) than the pill. The lens is attached ahead, parked as a clipped speck. `itemsUnderLens` is in the model.

- **`<vire-toolbar>`** (`vireuikit/web`). Upgrades groups of buttons (bare, `<vire-button>`, `<vire-icon-button>`, or the trigger of a `<vire-menu>`, `<vire-popover>` or `<vire-sheet>`) into the WAI-ARIA toolbar the model lays out for its container: separate capsules, neighbours merging through a neck, the lowest priorities going into a "…" menu that buds out of the trailing end, and a change of place (bottom, top, trailing strip) that dematerialises one form and materialises the next. Each capsule is a lens, and capsules that join are one lens over their silhouette (`toolbarClusters`, `toolbarSilhouette`, `toolbarBounds`, `toolbarClipPath`); the kit's controls inside draw no body of their own. A row in "…" clicks the original once; `docs/acceptance.md` holds the TB criteria.
- **`anchor`, `retractInto()` and `follow()`** on `<vire-menu>`, `<vire-popover>` and `<vire-sheet>`. `anchor` is the box a surface grows from and returns into instead of its trigger (cleared when it closes); `retractInto(el)` runs the growth back into `el` and closes, `retractInto(null)` closes at once; `follow()` puts the surface back on its anchor. A surface whose trigger leaves the document now closes on the spot, and a toolbar retracts one whose trigger goes into "…".
- **The toolbar model** (`vireuikit`). `toolbarGeometry` places a `ToolbarLayout` in the toolbar's own coordinates (capsules, slots, "…", the strip's text row, and a spacer that aligns trailing capsules to the end); `toolbarLayoutWithHysteresis` keeps a stage or overflow set until the container is 8 dp past its threshold; `toolbarMorphFrame`, `createToolbarMorph`, `aimToolbarMorph`, `stepToolbarMorph` and `currentToolbarFrame` merge capsules through a neck, collapse leaving slots into "…" and bud it out of the trailing end, rebasing a new target from the current frame; `toolbarPlaceFrame` fades one toolbar out and the next one in. `TOOLBAR_MORPH_TIMING` passes 95 % at about 0.38 s, `TOOLBAR_PLACE_TIMING` at about 0.3 s.

## 0.10.0

- **`<vire-popover>` and `<vire-sheet>`** (`vireuikit/web`). Upgrade a `popovertarget` popover, a `<dialog>` opened by `command` and a `popover="manual"` into one surface that grows out of its trigger, runs back into it before it leaves the top layer, and takes the form `presentationForm` gives it on every window class (popover or bottom sheet, bottom, side and third-pane sheets, centred sheet, dialog, alert, full screen), reshaping while it stays open. A bottom sheet has detents, an inset that shrinks and a glass body that turns opaque as it rises, a grabber (`role="slider"`), a drag that follows the finger and a keyboard lift; a side sheet publishes `--vire-sheet-inset-end`. `docs/acceptance.md` holds the SH criteria; the model gained `defaultSheetDetents`, `sheetUsesGlass`, `scrimCloses`, `sheetContentDrag` and `sheetTouchAction`.
- **The sheet and popover model** (`vireuikit`). `SHEET_SIZES`, `sheetInset`, `sheetRadius`, `sheetOpacity` and `sheetDetents` give the bottom sheet its detents, inset, radius and glass-to-opaque blend by height; `sheetLayout`, `sheetGrabber` and `popoverPlacement` place every `PresentationForm` (popover, bottom, side and third-pane sheets, centred sheet, basic dialog, alert, full screen) with its scrim, grabber, `insetEnd` and scrolling; `popoverGrowthFrame`, `sheetGrowthFrame`, `createSheetGrowth`, `stepSheetGrowth`, `SHEET_GROWTH_TIMING` and `sheetEntryFrame` grow a surface out of its trigger and run it back, or bring it in without one; `createSheetDrag`, `pressSheetDrag`, `moveSheetDrag`, `releaseSheetDrag`, `sheetResistance` and `stepSheetHeight` drag a sheet between detents, past them with resistance, and close or settle it on release; `sheetForKeyboard` lifts a sheet above the keyboard.
- A sheet's body is denser as it rises (glass up to a quarter of the window, about half at medium, opaque from 90 %), a surface over a scrim is never thinner than 0.6, and its text takes the polarity (`surfaceInk`, `data-ink`) that reads on the body as drawn: every form reaches 4.5:1 on the light and the photo backdrops. A floating sheet stays clear of the bottom safe area, and the adaptive stage draws the real `<vire-popover>` and `<vire-sheet>`.
- **The sheet and popover after review.** Removing an open bottom sheet or a popover that became a sheet leaves no `detent` on the host. A popover takes focus in under reduced motion too. Content that changes size after the surface is out (a `<details>` opened, an element shown) is measured again, and the window is read when it changes, not on every scroll (the safe-area probe ran on 28 of 30 scrolled frames before, on none now); a colour-scheme change re-evaluates the ink. Closing: a `formmethod="dialog"` submitter closes by retraction, a close command on a dialog the element has not picked up closes natively, `data-kind` follows `kind`, and Escape belongs to a modal dialog opened from inside a popover. The side sheet publishes `--vire-sheet-inset-end` on its shell as the widest of the side sheets open in it and fires `vire-sheet-inset`; `<vire-nav>` reads it, and `navLayout` takes it as `endInset`, so a content accessory ends at the sheet's leading edge. Drag: a cancelled drag settles on the nearest detent and never closes (`cancelSheetDrag`), losing the pointer capture ends it, a touch is decided by the scroller under the finger, and a press on a control in the top strip is not a drag. With one detent the grabber is `aria-hidden` and not a slider; `detent-labels` says the detents in the page's language. The model: `namedSheetDetents` keeps `large` the tallest and merges detents under 24 dp apart, and a bottom or centred sheet stands in its region (`sheetClipBottom`, `SheetLayoutInput.lift`). A popover's scrim click is held for the one click that follows the press and no other.

## 0.9.0

- **`<vire-nav>`** (`vireuikit/web`). Upgrades a `<nav>` of links into one glass body that is a bar, a rail or a sidebar by the window it covers and changes form through the selected link (a lens that exists only while it moves); a drag on the bar, minimising on scroll, a bottom accessory, the sidebar's toggle and a rail that opens it over the content, a search shortcut, and the insets the content must clear. `docs/acceptance.md` holds the NV criteria; the model gained `fixedNavigationForm` and the toggle's box in `navLayout`. It follows its scroller (a new one, one that is gone, the document, a bounce past an end), hands focus on when a form hides the focused link, names its toggle once with `toggle-label`, hides `[data-badge]` from the tree and reads `[data-badge-label]`, scrolls a rail taller than its window, clears the bottom safe area and ends a press that outlives a change of form. The lab's adaptive stage draws it in place of the navigation outline, and the sidebar's search row reads as a field (a clear fill and a hairline) instead of a second selection.
- **The navigation model** (`vireuikit`). `navLayout` and `NAV_SIZES` place the bar, the minimised bar, the rail and the sidebar with their items, pill, search and accessory; `navMorphFrame` with `createNavMorph`, `aimNavMorph`, `stepNavMorph`, `currentNavFrame` and `NAV_MORPH_TIMING` change a form through the selection (lift, contract, travel, grow, settle), turn back mid-way and take a third form by swapping the target or rebasing from the current frame; `createNavDrag` with `pressNavDrag`, `moveNavDrag`, `releaseNavDrag`, `cancelNavDrag`, `stepNavDrag` and `navDragFrame` drag the selection along the bar; `createMinimize`, `stepMinimize`, `expandMinimize` and `MINIMIZE_THRESHOLD` minimise the bar on scroll.

## 0.8.0

**Changed behaviour.** The web elements no longer decide everything from one `(pointer: coarse)` query. The hit area
now reaches 44 dp wherever any coarse input is present (`any-pointer: coarse`), so a laptop with a touch screen gets it
where it had 24 dp; hover now comes from the pointer that entered, so a mouse on a touch-first tablet hovers where it
did not. The default size still follows the primary pointer.

- **The adaptive model** (`vireuikit`). `AdaptiveContext` (the window in dp, the input in three layers, the posture of a
  folding screen, reduced motion) with `adaptiveContext`, `halfOpen`, the `INPUT_*` presets, `windowSegments`,
  `postureFromSegments`, `segmentOf` and `surfaceRegion`; `classifyWindow`, `widthClass` and `heightClass` with every
  threshold (600, 840, 1200, 1600; 480, 900). From it: `navigationForm` and `bottomAccessory`, `presentationForm`,
  `paneLayout`, `supportingPane` and `postureSplit`, `toolbarPlacement` and `toolbarLayout`, `sizeTier`, `hitTarget` and
  `hoversWith`, and `formMorph` with `createFormMorph`, `stepFormMorph`, `formMorphFrame` and `rebaseFormMorph`.
  `docs/acceptance.md` holds the AD criteria, `docs/design.md` the layer and the new order: navigation, sheet and
  popover, toolbar and search field come before switch, slider, segmented control and chip.
- **A menu stays in its trigger's segment.** `menuPlacement` and `menuCorner` take a region with an origin (a size
  alone still works as a region at the origin); `<vire-menu>` passes its trigger's segment of the window, so on a
  folding screen it opens in its half and scrolls if it is taller. `menuSurfaceFrame` takes optional bounds that hold
  every frame of the growth inside the region, the overshoot included. `Rect` and `Size` now live in `geometry.ts`,
  exported under the same names with `intersectRect` and `rectContains`.
- **The web collects the context** (`vireuikit/web`): `systemInput` and `effectiveInput` (the input layers from media
  queries, a keyboard from a key pressed outside a field), `setInputOverride` and `getInputOverride`,
  `setViewportOverride` (an element as the window, with its own segments) and `viewportSegments` (from the Viewport
  Segments API), and `watchAdaptiveContext(root, …)` for a shell.
- The lab gains `?view=adaptive`: a resizable window with presets from a folded phone to an ultrawide desktop, a
  simulated fold and input, the real atoms in their forms, the unbuilt patterns as outlines placed by the model, a
  readout of every decision and scripted scenarios. `check:lab` holds the atoms' input layers (a fine pointer with
  touch present through stubbed media queries), a menu on a real fold (the DevTools display feature) and the stage,
  with canaries for a single coarse flag, a menu that ignores the fold and a navigation that swaps instead of morphing;
  `check:lab:visual` has six stage baselines.

## 0.7.0

**Changed behaviour of exported defaults (released as a minor).** Code that calls the growth model without passing
its own timing moves differently after this release: `DEFAULT_GROWTH_TIMING` has new values, so `stepGrowth`, which
uses it by default, opens and closes faster, and `growthFrame(...).ink.incoming` (via `growthInk`) now stays at 0 until
the growth is at 0.9 and reaches 1 at 1.0, where it used to run from 0.45 to 0.95. Pass the old timing
(`{ shrinkOpen: 0.38, shrinkClose: 0.3, growOpen: 0.46, growClose: 0.4, growDampingOpen: 0.72 }`) to keep the old
motion; the old ink window is not kept.

- **`<vire-menu>`.** Upgrades a platform popover menu (a `popovertarget` trigger, bare or inside `<vire-button>` or
  `<vire-icon-button>`, and a `popover` list of item buttons) that already works without the element. After the
  upgrade it adds the menu-button roles with their keyboard, grows its glass out of the trigger through the core's
  `setMorph`, closes after a choice, Escape, a press outside or Tab, and runs the growth back into the trigger before
  the list leaves the top layer. Attributes `glass`, `size`, `corner`; property `sample`. `MENU_TAG` and the
  `VireMenuElement` type are exported from `vireuikit/web`.
- **The press that opened the menu chooses nothing.** The first item grows in under the pointer, so an item click
  counts only once the menu has arrived and its press began after that (a key, once the content shows); the second
  click of a double click and a held Enter or Space never count. `disabled` and `aria-disabled` stay the author's: a
  native disabled item is passed over by the keyboard, an `aria-disabled` one is reached (WAI-ARIA APG), neither is
  chosen. A
  choice closes the menu even when an item's own handler stops the click, and a press outside is seen inside a closed
  shadow root too. The list's `toggle` event fires after the growth has run back.
- **The menu's model.** `stepMenu` (the menu-button keyboard as a pure state machine, typeahead included),
  `menuPlacement` and `menuCorner` (pinned to the trigger's corner, flipped or slid into the viewport),
  `menuSurfaceFrame` (the surface's box, the lens's second shape and the content's offset per growth frame),
  `menuActivity`, `menuMaterial`, `menuBody`, `menuGlass`, `MENU_DROP_BODY`, `menuItemFill`, and `menuSize` for rows,
  padding and a radius concentric with the items. Sizes, timing, the body and the drop are measured against Apple's
  reference of a menu growing out of its toolbar (`docs/acceptance.md`, "Menu").
- **The growth is refitted to that reference.** `DEFAULT_GROWTH_TIMING` is now `shrinkOpen` 0.21, `shrinkClose` 0.14,
  `growOpen` 0.38, `growClose` 0.4 (the drop forms at 0.10 s instead of 0.18 s, the overshoot comes at 0.37 s instead of
  0.51 s), and `growthInk` brings the incoming ink in over the last tenth of the growth instead of from 0.45.
- **`setCarried` on `<vire-button>` and `<vire-icon-button>`.** A menu growing out of the control carries its body:
  the control drops its lens (by modulating it out), its body and its rim, takes no pointer events, and its glyph
  defocuses with the growth; `null` takes the body back, to no lens at rest for `glass="touch"`. Both elements now
  remove a `style` attribute they emptied on disconnect.
- The lab gains `atom=menu` (the menu's states on every backdrop), `view=menu`, `early-menu.html` and
  `view=menu-reference`, which puts frames of the reference next to our menu at the same moment. `check:lab` holds the
  menu's behaviour, its growth sampled frame by frame and its body measured like the reference, with canaries;
  `check:lab:visual` has its baselines.

## 0.6.0

- **On `vireglass` 3.** The peer range is `^3.0.0`. The rim is the core's: its strength now follows the surround, within
  the reference tolerance on every smooth row, so the kit no longer scales the lens's `::after`, and a pressed control's
  rim no longer flares to full white. The kit keeps its own body and attaches with `body: false`: measured against the
  same reference, the core's body is not lighter than its surround over a light backdrop, off by more than 0.05 in
  lightness on two smooth rows, and near black under reduced transparency (`docs/acceptance.md`, "Resting body").
- **`sample` on the elements.** A host that knows the backdrop (an image, a video) sets it on `<vire-button>` or
  `<vire-icon-button>`, before or after the lens attaches; `null` returns to the probe.
- **Foundation.** `sizes.ts` (button and icon button sizes in dp, nested radius, hit slop), pure behaviour
  state machines (press, hover, focus, disabled) with spring visuals, and accessibility modes
  (reduce transparency, increase contrast, reduce motion) with a system-or-override resolver.
- **`vireuikit/web` returns, with new content.** It is the web elements below and has nothing to do with the GPU
  backdrop entry point removed in 0.5.0. `<vire-button>` and `<vire-icon-button>` upgrade a native button in place (waiting for
  it if the page is still being parsed), attach glass through `vireglass/dom` on demand (opt-in with the
  `glass` attribute), keep a 44 dp hit area on coarse pointers, and clean up on disconnect. The entry is safe
  to import on a server; `defineVireElements({ nonce })` supports a strict CSP.
- **Lab and gates.** `npm run lab` (Vite) with generated backdrops and a reference pane fed from
  `VIREUIKIT_REFERENCE_DIR`; `npm run check:lab` runs the Playwright behaviour tests (in CI),
  `npm run check:lab:visual` the local screenshot set. `npm run typecheck` also checks `src/kit` without a DOM lib.
- `docs/design.md` and `docs/acceptance.md`.
- **A resting body.** At rest the glass control carries a body that lifts the backdrop (`atomBody`), measured with the
  core's rim against reference frames in OKLab; the pressed tint is unchanged. `check:lab` gates body separation and rim
  contrast on pixels, with canaries for the old look.
- **Reduced transparency frosts the glass instead of removing it.** The lens stays, its blur and the body density come
  from `vireglass`'s own accessibility rules, and the ink follows the body. `Presentation` gains `frost`; the opaque
  `frosted` surface remains only as the stand-in when a lens cannot attach.
- The lab gains a reference backdrop view and a `mid` backdrop; `npx playwright test reference` compares our atom, at
  rest and pressed, with the reference controls, among them the pressed one at M 3:52 (needs `VIREUIKIT_REFERENCE_DIR`).
  Image backdrops hand the elements a backdrop sample instead of declaring their mean colour.

## 0.5.0

**Breaking.** The GPU backdrop is removed: `createMediumBackdrop`, the `vireuikit/web` entry point,
the medium model and everything that came with it — its params and defaults, track presets, light
rig (`lightRigForCover`/`lightRigForCharacter`), dynamics and track layer. The package is now the
kit only: atom states and the capsule-to-target growth morph. The cloud-chamber backdrop was dropped
as a design direction; stay on 0.4.x if you depend on it.

## 0.4.0

The medium now reads as a real cloud chamber — a dark volume lit by static lamps, with sharp
condensation tracks — instead of colored smoke clouds with no visible light source.

- **Lights, as data.** `lights` (`VireUIKitMediumParams`, up to `MEDIUM_MAX_LIGHTS = 3`): static
  sources — position, direction, cone half-angle, falloff, color, intensity — added in linear light
  on top of the near-neutral species mix. Defaults: an edge strip along the floor and two
  spotlights above the frame. A spotlight is a soft lobe with no edge and static shafts inside it;
  a cone of 180° or more is an edge strip.
- **Beams are shaped by the gas.** A grid-resolution shadow pass (`MEDIUM_SHADOW_SHADER`,
  `shadowExtinction`) dims each spotlight by the vapor and droplets between the lamp and a point.
- **Cover color goes to the lights.** `lightRigForCover`/`lightRigForCharacter` tint the spotlights
  toward the cover's hue like gels (gamut-mapped, so a saturated hue does not clip to another one)
  and nudge the edge strip only slightly. `channelScatter` replaces `channelColors`' old role in
  the lit layer.
- **Sharp tracks.** A screen-space track layer draws every emission as a droplet chain in content
  pixels over the soft grid residue (`trackLayerAmount`, `MEDIUM_TRACK_LAYER_LOOK`,
  `MEDIUM_TRACK_LAYER_LIFE_SECONDS`): a Gaussian core that beads along its length plus stray
  droplets, born at full length, then broadening as `sqrt(age)`, sagging and fading. Near tracks
  defocus into wide soft bands. An alpha burst lands a few rays on the beat and spreads the rest
  over `MEDIUM_TRACK_LAYER_BURST_SPREAD` seconds.
- **Three track kinds, not two plus a filler.** `MEDIUM_TRACK_PRESETS` is now `alpha`/`electron`/
  `muon` (was `alpha`/`beta`/`natural`). Tracks carry no color of their own; they are lit like the
  mist, plus `trackLightFloor`. `decay` moved from 0.06 to 1.1/s so the grid residue fades within
  one to two seconds. Calm-state background radiation now arrives every 8–20 s instead of 25–60 s.
- `check:medium` adds gates, each with a canary: a spotlight's beam reads brighter than the same
  distance outside it; a stamped grid track broadens and fades within +1.5s; the crisp layer is
  sharp at birth and broader and dimmer by +1.4s.

## 0.3.0

Fixes the backdrop reading as a lattice of straight lines at the product's own default size and
grid (1920x952, 74x37): four causes, four independent fixes.

- The curl-noise potential is now periodic over the simulation grid in space, not just in time:
  each octave's spatial frequency is adjusted per grid size to the nearest value that makes a full
  grid width/height an exact integer number of lattice cells (`computeMediumSpatialPeriods`,
  `vgPotentialSeamless`/`vgCurlVelocitySeamless` in `noise.ts`), so velocity no longer jumps at the
  domain's own wrap — the far plane's tile boundary reads as an ordinary point in the field. The
  period floor for a very-low-frequency octave (`MIN_SPATIAL_PERIOD`) scales both axes together
  rather than independently, or a non-square grid would land on different periods per axis and
  trade the seam for a directional stretch.
- The far plane's blur is an 8-tap ring rotated 22.5° off the axes, replacing the old ±x/±y 4-tap
  box: axis-aligned taps read the same column/row on both sides of any residual axis-aligned
  structure, which is how a single seam got doubled into four parallel lines.
- Condensate settling adds a second, unconditional share of the ambient curl field's own sideways
  push (`condensateSettleWiggle`) on top of the existing turbulence-gated one, so a droplet falling
  at a constant speed doesn't trace a dead-straight vertical line when ambient turbulence is
  otherwise low (rest/paused).
- The near plane's vapor and condensate reads use cubic B-spline reconstruction (4 bilinear taps,
  Sigg & Hadwiger 2005) instead of plain bilinear, so the grid's own cells stop reading as squares
  with staircase edges at typical (coarse) grid sizes. Track and the (already blurred) far plane
  stay plain bilinear.
- `check:medium` adds an isotropy gate on the composited frame at the product's own grid: Sobel
  gradient energy near the axes (0°/90°) against the diagonals (45°/135°) — 1.66 for this release,
  3.74 for a canary without spatial periodicity, threshold 2.5 — and a seam check at the far
  plane's tile-wrap column (0.55 of a typical step against 2.80 for the canary).

## 0.2.0

- The backdrop reads as a chamber seen from the side: the composite samples the same
  vapor/condensate grid a second time at a larger scale and a fractional offset (`depthFarScale`/
  `depthFarOffsetFrac` — a fraction of the grid, not a fixed grid-px value, so it stays clear of
  the periodic wrap at any grid size), which is both parallax and finer far-plane structure from
  one number, plus a cheap 4-tap blur (`depthFarBlurRadius`) that supplies aerial perspective's
  softness and lower contrast at once. Gravity is two separate properties: a small downward vapor
  drift (`gravityVaporDrift`, a motion cue — it adds no density on this periodic grid) and a
  compositing-only bottom density boost (`gravityBottomBoost`/`gravityBottomBoostStart`, the
  steady-state property that actually reads as denser) that cannot affect the conserved water
  total. Each track's emission also carries a `depth` that scales its width and intensity, so far
  tracks read thinner, dimmer and softer.
- `check:medium` also proves the far depth plane reads slower and lower-contrast than the near one,
  that it decorrelates from the near one rather than echoing it at the README's own 128x72, that
  the bottom boost is a steady-state property (no warmup needed) and that vapor drift is a valid,
  consistently-directed motion cue over a short window — each with a canary.

## 0.1.0

Initial standalone release, extracted from the VireMusic monorepo
([pruffit/vire](https://github.com/pruffit/vire)) into its own open-source package.

- Atom state model (`ATOM_AT_REST`, `atomMaterial`, `atomLift`, `atomAtRest`) shared across every
  client: press and selection change the glass's own medium, not a highlight over it.
- Two-phase "capsule → drop → target" growth morph (`growthFrame`, `stepGrowth`,
  `createGrowthState`) for a control opening into a menu or a sheet.
- A GPU backdrop (`createMediumBackdrop`, `vireuikit/web`) implementing a colored-vapor and
  condensation simulation — curl-noise advection with a MacCormack correction, phase exchange
  between vapor and condensate, decaying light tracks — composited directly into VireGlass's
  content texture via the `VireGlassBackdropPass` contract.
- Playback-driven dynamics (`createMediumDynamics`): turbulence and track emission scheduled from
  BPM, amplitude and a deterministic playback position, with a WCAG 2.3.1 floor between emissions.
- Species colors derived from a single platform tone rather than picked as a fixed palette
  (`speciesFamily`, `neutralSpecies`), mixed in Oklab so saturated hues don't collapse into gray.
- The medium runs for hours: the field phase accumulates on the CPU and wraps on a noise lattice
  that is periodic in time, so there is no seam and no float32 drift. A resize resamples the
  medium instead of reseeding it.
- `check:medium` drives the real VireGlass renderer headless and holds the behaviour, not the
  source: condensate settles toward the bottom of the screen, water is conserved, the frame does
  not flicker, a resize keeps the medium, the phase wrap is seamless — each with a canary that
  must fail.

Requires `vireglass` ^2.3.1 (2.3.0 read shader comments as code) for its `VireGlassBackdropPass`
contract and the public WebGL2 helpers (`createProgram`, `createTexture`, `createFramebuffer`,
`bindTextureAt`, `drawFullscreenTriangle`, `locationCache`, `setUniform`) it builds on.

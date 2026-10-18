# Acceptance: button, icon button, menu, the adaptive model and navigation

Each criterion is written in the kit's own words from the reference analysis. Sources are cited by code and
timestamp (`M 3:52`), and this is the one place the codes are defined:

| Code | Source |
|---|---|
| M | WWDC25 session 219, "Meet Liquid Glass" |
| D | WWDC25 session 356, "Get to know the new design system" |
| A | Apple, "iOS 26: Introducing Liquid Glass" |
| S | Meet with Apple session 208, "Showcase: how apps adopt the new design and Liquid Glass" |
| B | Tech Talk 111462, "Raise the bar with iPhone Duo" |
| H | Apple HIG ("Materials", "Color") and the SwiftUI `Glass` documentation |
| W | WCAG 2.2 |
| I | WWDC25 session 208, "Elevate the design of your iPad app" |
| K | WWDC25 session 282, "Make your UIKit app more flexible" |
| Q | WWDC25 session 256, "What's new in SwiftUI" |
| U | WWDC25 session 323, "Build a SwiftUI app with the new design" |
| G | Material 3: Breakpoints, Layout, Navigation bar and rail, Toolbars, Menus, Search, Bottom and side sheets, Dialogs, List-detail |
| J | Android Developers: window size classes, adaptive navigation, canonical layouts, foldables and fold awareness, input compatibility on large screens |
| F | Microsoft Learn (WinUI): NavigationView, command bar, dialogs and flyouts, screen sizes and breakpoints, input devices |
| E | The web platform: Media Queries 4 and 5, CSS Environment Variables 1, the Viewport Segments API, the Device Posture API |

H also covers the HIG's layout, tab bar, sidebar, toolbar, popover, sheet and search field pages and the UIKit and
SwiftUI presentation documentation. On I, K, Q and U only chapters carry times, so their timestamps are approximate (≈).

How a criterion is checked:

- **unit** — a test in `src/__tests__/`;
- **behaviour** — a Playwright test in `tests/lab/*behavior.spec.ts` (`npm run check:lab`, runs in CI);
- **snapshot** — a baseline in `tests/lab/__screenshots__/<platform>/` (`npm run check:lab:visual`, local, Windows
  baselines only);
- **side-by-side** — a visual comparison with the reference at the cited timestamp. It is not measurable, and
  the reference frames are third-party material that is never committed: the lab's reference pane shows them
  from a local directory named by `VIREUIKIT_REFERENCE_DIR`.

## Sizes: where every number comes from

| Value | Number | Source |
|---|---|---|
| Finger tier height (button, icon button) | 44 dp | HIG touch target, 44 pt. S says 44/48/52 are the result of a metrics revision, so this is a floor, not a constant. |
| Pointer tiers small / medium / large / xlarge | 24 / 32 / 40 / 48 dp | **Chosen.** D 4:23 names the tiers but gives no numbers. 24 is the W 2.5.8 target-size floor, 48 is the Material target; 32 and 40 split the span. |
| Shape per tier | small, medium: rounded rectangle; large, xlarge, touch: capsule | D 4:23: Mini, Small and Medium keep rounded rectangles on macOS, Large and X-Large become capsules; D 4:15: capsules for touch-friendly layouts. |
| Capsule radius | height / 2 | D 3:49. |
| Rounded-rectangle radius | height / 4 | **Chosen.** D 3:42 says a fixed shape keeps a constant radius but gives no value; a quarter of the height reads as the same family as the capsules. |
| Nested radius | outer radius minus the gap, optional floor | D 3:53, M 7:53 (`nestedRadius`, backed by `concentricRadius` from `vireglass`). |
| Icon box | height / 2 | **Derived:** the glyph fills half the body and leaves a quarter of the height on each side, which is exactly 6 dp at the smallest tier; the unit test requires at least 6. |
| Button horizontal padding | 10 / 14 / 18 / 22 / 20 dp (small … xlarge, touch) | **Derived:** about 0.45 × height, so the label starts after the curve of a capsule. The reference has no padding figures. |
| Hit area | 44 dp wherever any coarse input is present, for every tier; 24 dp with fine pointers only | HIG; W 2.5.8. The body keeps its size; the hit area reaches past it. The Android client raises the finger floor to 48. Which tier the layout uses is the primary pointer's (AD2). |
| Press growth | 18 % icon button, 6 % button | **Chosen** from M 3:51–3:52: the lifted icon button visibly grows by about a fifth, and S says the lift exists because the finger covers a small target, so the button, which sinks, grows less. |
| Menu row | the tier's height (44 dp at touch) | **Measured**, M 5:11: the rows are 287.5 px apart in a frame where the toolbar they grew from is 282 px tall (44.9 dp at 44). |
| Menu padding | 0.3 × the row: 7 / 10 / 12 / 14 / 13 dp (small … xlarge, touch) | **Measured**, M 5:11: the first glyph's centre is 34.6 dp below the top edge and 33.8 dp in from the leading edge, which is the padding plus half a row, so 12 to 13 dp at 44. |
| Item glyph and label | the glyph centred in a square of the row at the item's leading edge, the label after it, a square of the row left free after the longest label (a check mark or a chevron goes there) | **Measured**, M 5:11: the label starts 58.8 dp from the menu's edge (ours: padding + row = 57) and 60.5 dp are left after the longest one (ours 57). An item without a glyph starts its label at the button's padding. |
| Menu radius | the item's radius plus the padding, so the active item's highlight is concentric with the menu: 13 / 18 / 32 / 38 / 35 dp | D 3:53, M 7:53 (concentricity). **Measured**, M 5:11: a circle of 37 dp fits the head of the corner (the continuous corner's tail runs a few pixels longer). |

Checked by `sizes.test.ts` (floors, monotonic tiers, radius rule, nested radius, hit slop, the menu's rows, padding
and concentric radius) and the `size` and `hit area` tests in `behavior.spec.ts` (rendered boxes are 44 and 24, a
capsule's computed radius is half its height, and under touch emulation a tap `slop − 1` dp outside a `small` or
`medium` body clicks it while a point beyond the slop does not), and the `size` test in `menu-behavior.spec.ts`
(rendered rows of 44, a menu radius of 35).

The reference frames of M 5:11 are every frame of the video from 311.478 to 312.446 s (opening) and from 313.414 to
313.847 s (closing), at 29.97 fps, kept locally under `m511/` like the others; lengths are converted with the toolbar's
282 px as 44 dp (6.41 px/dp).

## Button

A button is an action: nothing grows out of it, and it sinks under press rather than lifting.

| # | Criterion | Check |
|---|---|---|
| B1 | Pressing changes the glass itself (denser, thicker, clearer), not a highlight on top (H: active is a state of the medium). | unit (the pressed state feeds `atomMaterial`); side-by-side M 3:52 |
| B2 | A press grows the body slightly, and the response is visible while the finger is down (M 3:51–3:52; S). | behaviour "the labeled button grows by about six percent" (scale between 1.055 and 1.07 while held) |
| B3 | The pressed body turns milkier and the label goes out of focus under the finger (M 3:52). | side-by-side M 3:52; snapshots of the pressed state on every backdrop |
| B4 | A button sinks, it does not lift (`atomLift('button') = 0`); it never becomes an enlarged lens. | unit |
| B5 | A button that is an action does not grow into anything; it grows only when it is the trigger of a `<vire-menu>`, and then the menu grows out of it (N8). `setMorph` exists on both elements as a hook for a host, but nothing in the kit calls it. | unit (`pressResponse` only grows the body); `setMorph` itself is not tested |
| B6 | The press is cancelled when the pointer leaves, and releasing outside does not activate. | unit; behaviour "the pointer leaving cancels the press" |
| B7 | A release outside never swallows a later click: a keyboard or scripted click, and a real click, still fire. | behaviour "after a release outside…", "a release outside followed by a real click…" |
| B8 | Hover comes from the pointer that entered: a mouse or a pen hovers on any device, a finger never does (AD3); keyboard focus draws a ring on any device (W 2.4.7), a click does not. A key press does not stay held when focus moves away. | unit; behaviour "hover comes with the cursor", "a mouse on a touch-first device hovers", "a finger never hovers…", "keyboard focus shows the ring…", "a key shows the focus ring even though the pointer is coarse", "a key press does not stick…" |
| B9 | Disabled stays glass but stops asserting itself: a quarter of the resting body, dimmed ink, no response, cannot be activated. | unit; behaviour "a disabled control cannot be activated"; snapshot of the disabled state |
| B10 | It works before the glass: the native button clicks, submits its form, is named and focusable with no element defined; a button that already has keyboard focus shows the ring as it upgrades. | behaviour "before the upgrade" |
| B11 | Upgrading while the page is still being parsed adopts the single native button; none is synthesized. | behaviour "upgrade while the page is parsed" (elements defined by a script before the markup) |
| B12 | Glass is opt-in: with no `glass` attribute there is no lens, and the plain control is complete (visible body, clickable, announced by role and name). | behaviour "glass is opt-in…", "glass off leaves a complete, clickable, named control"; `*-glass-off` snapshots |
| B13 | Keyboard: Enter and Space activate it; it is a `button` with a name. | behaviour "both atoms are buttons with a name, and activate by Enter and Space" |
| B14 | A click goes through the glass: the lens captures the pointer, and the native click still fires and submits forms. | behaviour "a click still submits the form it sits in, through the glass" |
| B15 | Glass belongs to the navigation layer only (hence opt-in, B12); no glass on glass; no solid fill instead of tint; no tint on every control; Regular and Clear are not mixed on neighbours (M 13:04, 13:24, 17:03, 17:21). | by construction: opt-in attribute, one material (`VIREGLASS_CONTROL_MATERIAL`), no accent. Not gated. |
| B16 | Reduced transparency keeps the glass and frosts it: the lens stays with its blur raised, the body goes to the density `vireglass` asks of the glass in that mode (0.82) and its ink follows the body, so the control is more opaque, not removed (B 10:36; M 18:22–18:30). Only a lens that cannot attach falls back to an opaque stand-in. | unit (`presentationFor`, `atomBody`); behaviour "reduced transparency keeps the lens and frosts it", "…keeps the ink readable against the lifted body"; snapshots `button-busy-reduce-transparency`, `button-mid-reduce-transparency`; measured against M 18:30 ("Resting body") |
| B17 | Increased contrast: the body goes near black or white and gets a contrasting border (M 18:29). | unit; behaviour "increased contrast adds a border" (glass off); snapshot `button-busy-increase-contrast` (glass on) |
| B18 | Reduced motion: springs are instant, the press response itself stays (M 18:35). | unit; behaviour "reduced motion makes the press instant" against "the same press without it is still moving one frame in" |
| B19 | The system settings are followed live, and a setting made on the page beats them. | behaviour "the system setting is followed…" (reduced motion only), "a setting made on the page changes live elements" |
| B20 | Appearance goes by modulating the lens, never by fading the element (M 2:55). | the element never animates opacity; the touch-only variant uses `setAppear`. Not gated. |
| B21 | The hit area meets the target floor wherever a coarse input is present, without changing layout (AD2), and a tap in it is exactly one click, seen once on the host and once on the button. | behaviour "hit area on a coarse pointer" (including "a tap in the hit area is exactly one click…"), "hit area on a fine pointer", "a laptop with a touch screen keeps the pointer tier…" |
| B22 | The element cleans up: removing it removes its lens and its filter; reconnecting upgrades again. | behaviour "removing the element removes its lens and its filter", "connecting again…" |
| B23 | Edge light and the rim's strength, adaptive shadow, dispersion, backdrop blur at the rim: the material's, not the kit's. | owned by `vireglass`; visible in the snapshots, not asserted here beyond B27 |
| B24 | If the lens cannot be loaded or attached, the control falls back to the plain surface (frosted under reduced transparency), stays clickable, raises no unhandled error, and the next change retries the attach. | behaviour "a lens that fails to attach" (an aborted module request; an `attachGlass` that throws, counting the retries) |
| B25 | Under forced colours the text keeps the system colour, undimmed, and the own tints and blur are dropped (W 1.4.11). | behaviour "forced colours" |
| B26 | At rest the glass body stands off its surround and carries its colour (see "Resting body"). | behaviour "resting body and rim", canary "a clear body fails the gate"; measured |
| B27 | At rest the rim reads clearly over a bright backdrop and faintly over a dark one (see "Resting body"). The strength is the core's, which follows the surround; the kit does not scale it. | behaviour "resting body and rim", canary "a rim at full strength fails the gate" (a white line all round); measured |
| B28 | The press end of the body is the milky tint the kit already drew: alpha 0.34, 35 % white (the body tint is unchanged; the pressed rim is the core's now). | unit `atomBody` |
| B29 | A host that knows its backdrop (an image, a video: the lens's probe reads declared colours only) gives it to the element as `sample`, at any time, even before the element is defined; `null` hands it back to the probe. | behaviour "a sample set on the element replaces the probe…", "a sample given before the lens attaches…", "a sample set before the element is defined…" |

## Icon button

The carrier of lift into the glass, and later of growth into a menu.

| # | Criterion | Check |
|---|---|---|
| I1 | Under the finger the piece lifts into the glass: an enlarged, clearer lens, visible during the press and not after release (S: the finger covers a small target and the lens under it is the only sign of a hit; M 4:10–4:30). | unit (`atomLift('iconButton') = 1`); behaviour "the lifted icon button responds while the finger is down" (scale above 1.1, the rendered pixels differ from rest, press value above 0.9) |
| I2 | It grows more than a button does (about 18 %) and its glyph is defocused harder (M 3:51–3:52). | unit `response.test.ts`; side-by-side M 3:52 |
| I3 | The lifted body is milky and its light is a concentrate of the surroundings, not its own whiteness: over a dark backdrop it brightens but does not turn white (M 2:29). | snapshot `iconButton-dark-glass-on` (forced pressed state); side-by-side M 3:52 (light backdrop only) |
| I4 | The finger response is physical: the glow starts at the point of contact and the body is pulled by the finger. | `vireglass` does this on a real pointer; not asserted here |
| I5 | It is a circle (a capsule of equal sides) of the tier's height with a glyph box of half of it. | unit; behaviour size tests |
| I6 | It returns to rest after release without leaving the press value behind. | behaviour (press value below 0.01 after release) |
| I7 | A menu grows out of it: `setCarried` hands its body to the menu's surface and takes its glyph out of focus, and `null` takes the body back (N12). | behaviour "the trigger hands its body over…" |
| I8 | Cancel on leave, release-outside, hover, disabled, glass opt-in and the three accessibility modes behave as for the button. | the same behaviour tests, run against both elements |

## Menu

The menu is the result of growth out of its trigger, and closing it is the same growth run backwards. It closes after
a choice: a scenario that needs several picks without closing is a popover, which is another atom (S, the Tide Guide
case, where a menu that "deconstructs every time" was replaced by a glass popover). The trigger is an icon button, a
button or a bare `<button>`; it grows only because it opens a menu (B5). Behaviour tests are in
`tests/lab/menu-behavior.spec.ts`.

| # | Criterion | Check |
|---|---|---|
| N1 | It works before the kit: a `<button popovertarget>` opens the list (a `popover`), the items are buttons with `popovertargetaction="hide"`, so a choice clicks the item once and closes the list; Escape and a press outside close it; Escape and a choice return focus to the trigger; Tab reaches the items. None of it needs the element's script or glass. | behaviour "before the upgrade" |
| N2 | The upgrade adds the menu-button semantics, and only together with the keyboard they promise: the trigger gets `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`; the list `role="menu"`, named by the trigger; the items `role="menuitem"`, out of the tab order. `disabled` and `aria-disabled` stay the author's: the element never rewrites either, and both can be set and cleared after the upgrade, by attribute or by property (React clears `disabled` with `removeAttribute`). Removing the element takes all of it away, leaves no attribute or empty `style` of its own behind and gives the list back to the platform popover; an item taken out of the list gets its markup back at once. | behaviour "roles", "removing the element gives the markup back", "an item taken out of the menu gets its markup back", "disabled items stay the author's" (set, cleared and set again, for each attribute) |
| N3 | On the trigger, Enter, Space and ArrowDown open the menu with focus on the first item focus can land on, ArrowUp on the last. A pointer opens it with focus on the menu itself and no item highlighted. | unit `stepMenu`; behaviour "the trigger opens it from the keyboard…", "a pointer opens it…" |
| N4 | In the menu, ArrowDown and ArrowUp move to the next and previous item and wrap, Home and End go to the first and last, and a printable character moves to the next item whose label starts with what was typed in the last half second (an arrow or the pointer ends the word). An item disabled the native way is passed over by all of these, because a disabled button cannot take focus; an `aria-disabled="true"` item is landed on, as the WAI-ARIA APG has it: focusable, not activatable. The pointer moving over an item it can focus makes it the active one. A focused item that turns natively disabled hands focus to the menu instead of dropping it to the page. | unit; behaviour "arrows, Home, End and typeahead pass over a natively disabled item, land on an aria-disabled one…", "the pointer makes an item active", "native disabled set, cleared and set again…" |
| N5 | A choice closes the menu, returns focus to the trigger and fires the item's own click exactly once, even when the item's own handler stops the click; neither kind of disabled item can be chosen, by pointer or key, and choosing one closes nothing. | unit; behaviour "a choice closes the menu…", "…even when the item's own handler stops the click", "an aria-disabled item can be reached but not chosen…" |
| N6 | Escape closes and returns focus to the trigger; a press outside closes without taking focus back, in the document or inside a closed shadow root; Tab closes, and focus moves on from the trigger as if the menu were not there. | unit; behaviour "Escape…", "a press outside…", "Tab…", "inside a closed shadow root" |
| N7 | There is no way to choose and stay open. | by construction (no such option); unit (`choose` always closes) |
| N8 | The glass grows out of the trigger: the surface's first frame is the trigger's body (box and radius), it contracts into a drop smaller than the trigger, the drop grows into the menu with a small overshoot, and the content comes into focus only near size (M 5:11, frame by frame; M 5:05 "the bubble simply pops open to reveal the content"). | unit (frames at the boundaries, the drop, the overshoot, the ink); behaviour "the surface starts on the trigger, passes a drop and lands on the menu", canary "a menu that pops open without growing fails it" |
| N9 | The timing is the reference's: the drop forms in about 0.10 s, the menu is at size at about 0.3 s and overshoots by about 3.5 % at about 0.37 s; closing reaches the drop at about 0.25 s and is back in the trigger at about 0.42 s (M 5:11, "Against the reference"). | unit `DEFAULT_GROWTH_TIMING` against these numbers |
| N10 | It stays under the finger: the menu shares the trigger's corner that points to the nearest corner of its region (the trigger's segment of the window, AD23) and grows into the open space, covering the trigger; it flips or slides only to stay in that region, and `corner` fixes the corner (S: the button morphs into the menu so that the grip does not change). | unit `menuPlacement`; behaviour "the menu pins to the trigger's corner" |
| N11 | Closing retraces the growth: the content defocuses first, the menu flows back into a drop and the drop into the trigger, ending on the trigger's body; reopening midway turns back from where it is. | unit (reverse path, turning back); behaviour "closing runs back through the drop into the trigger" |
| N12 | One body: on every frame the menu is out (growing, open, retracting) the trigger draws no lens, no body and no rim of its own and takes no pointer events, and its glyph goes out of focus as the growth begins, so there is never glass on glass; it takes the body back when the menu has retracted into it, and a trigger whose lens appears only under the finger goes back to no lens (M 13:24; M 5:11, the toolbar's glyphs defocus as it gathers into the drop). Under forced colours the trigger fades with its glyph. | behaviour "while the menu grows, is out and retracts, the trigger draws no lens, body or rim" (sampled every frame, glass on and `touch`), "the trigger hands its body over and takes it back", "a trigger whose lens appears only under the finger…", "the carried trigger fades…"; snapshots `menu-*` |
| N13 | Glass only on the menu's surface: the items are content on it and carry no lens, and the active item's highlight is ink on the glass (the nearer half of a press), concentric with the menu. | unit `menuItemFill`; behaviour "the surface is the only lens"; snapshots |
| N14 | The growth goes through the core's morph: while the drop and the menu are joined, the second shape is handed to the surface's lens through `setMorph`, offset from the surface's centre, and nothing is handed once they are one. | unit `menuSurfaceFrame`; behaviour "the lens is handed the second shape while they are joined" (a recording stand-in for `vireglass/dom`) |
| N15 | The drop and the menu are one medium. As a drop it is the gathered medium lit by a concentrate of its surroundings: the reference drop is white over its light grey (L 0.97 to 1.00 over 0.79 to 0.82), and over a dark backdrop it can only brighten (§5). As a menu at rest it carries the control's resting body: the reference menu is 0.058 to 0.072 lighter than what it covers, with ΔC 0.000 (M 5:11, two text-free regions, the open frame minus the same pixels before it opened). | unit `menuActivity`, `menuBody`; behaviour "the resting menu on the mid grey lifts what it covers as the reference menu does" (within 0.05 of it, ours +0.043), "…stands off what it covers…" (dark +0.019, photo +0.026, light +0.017, ΔC within 0.02), "the drop … is lit well above its surround" (ΔL above 0.1, under 0.7 over dark); canaries "a clear menu fails it", "the resting body in the drop's place fails the drop's bound" |
| N16 | A large element does not flip between light and dark (M 15:29): the backdrop is read once as the menu opens and held while it is out. | behaviour "the ink holds while the menu is out" |
| N17 | A larger piece is thicker glass, with a deeper shadow, more lensing and a softer scattering of light (M 7:02–7:25), and Regular turns text under it into soft spots (M 11:47). The menu's surface is the control material with the core's sheet scattering (roughness 0.85, a blur of about 10 dp where the control's is 0.4); the thickness and the shadow follow the geometry in the core. | unit `menuGlass`; behaviour "the surface scatters what lies under it far more softly…"; snapshot `menu-text-glass-on`; thickness and shadow owned by `vireglass`, not asserted |
| N18 | Reduced motion: no growth; the menu is at its size in its first frame and gone in the first frame of closing, its content in focus at once (M 18:35). | unit; behaviour "reduced motion opens and closes in one frame" |
| N19 | Reduced transparency frosts the surface (the lens stays, its blur rises, the body goes to `vireglass`'s density and the ink follows it); increased contrast borders it (M 18:22, 18:29). | behaviour; snapshots `menu-busy-reduce-transparency`, `menu-busy-increase-contrast` |
| N20 | Glass off leaves a complete menu: an opaque surface, the same keyboard and choice, and the same growth on the plain surface. | behaviour "glass off…"; snapshots `menu-*-glass-off` |
| N21 | A lens that cannot be loaded leaves the menu working on its plain surface, with no unhandled error. | behaviour "a lens that fails to load…" |
| N22 | Under forced colours the menu uses system colours: a Canvas surface with a border, the active item in Highlight, disabled items in GrayText. | behaviour "forced colours" (colours asserted, not the look) |
| N23 | Upgrading while the page is parsed adopts the trigger and the list and synthesizes nothing; items added later get their role. | behaviour "upgrade while the page is parsed" |
| N24 | `sample` on the menu reaches its surface, set before or after the lens attaches. | behaviour "a sample on the menu reaches its surface" |
| N25 | The press that opened the menu chooses nothing. The menu grows in under the pointer, so its first item lands where the trigger was: the second click of a double click, a pointer click before the menu has arrived (its content in focus and the surface past its overshoot, about 0.37 s) or whose press began before it had, and a held Enter or Space all leave it as it is; a pointer click once it has arrived chooses. A deliberate key is not under the pointer, so Enter or Space on an item chooses as soon as the content is in focus (about 0.31 s), before the surface settles; only a key before the content shows is dropped. The platform's own popover never puts an item under the pointer, so it needs none of this. | behaviour "input that began on the trigger" (a double click, second clicks 40 to 250 ms later, Enter and Space held on the trigger and on an item, a second Enter before the content, a key that chooses in the first frame the content shows while a pointer click there is still dropped, and a later click that does choose) |
| N26 | A scroll or a resize while the menu is out puts it back over its trigger once a frame, measures nothing and hands the lens nothing when the surface's shape has not changed; the lens is handed a morph only when it changes. | behaviour "a scroll or a resize while the menu is out costs the lens nothing…" (a recording stand-in for `vireglass/dom`) |
| N27 | `glass` parses as on the buttons: empty, `present` or `touch` is a lens, anything else none. Taking a forced state away closes the menu and resets `aria-expanded`. | behaviour "glass is parsed as on the buttons…", "taking a forced state away…" |
| N28 | The list's own `toggle` event fires once the growth has run back, when the list leaves the top layer; `aria-expanded` turns false as the closing begins. | behaviour "the list's own toggle event fires once the growth has run back…" |

### Against the reference

M 5:11 against ours at the touch tier, with the same label width:

| | reference | ours |
|---|---|---|
| row | 44.9 dp | 44 |
| first glyph centre from the top / from the leading edge | 34.6 / 33.8 dp | 35 / 35 |
| label start | 58.8 dp | 57 |
| room after the longest label | 60.5 dp | 57 |
| width, four rows, "Three" the longest | 167 dp | 162 |
| height, four rows | 206 dp | 202 |
| corner | ≈ 37 dp | 35 |
| body over what it covers, ΔL / ΔC | +0.058 to +0.072 / 0.000, over a grey of L 0.66 to 0.80 | +0.043 / 0.000 over the mid grey (L 0.62); +0.019 dark, +0.026 photo, +0.017 light |
| the drop's lightness | 0.97 to 1.00 over 0.79 to 0.82 (ΔL ≈ +0.2) | +0.220 over the mid grey; 0.99 over light; 0.46 over dark (+0.146) |
| the drop's size | ≈ 63 dp, from a 172 × 44 dp toolbar | 48 dp (1.1 × the source's smaller side) |
| the drop's shape | a flat-bottomed drop with a ridge, then a bulb on a neck while closing | a circle; the neck is in the lens (N14), not in the silhouette |
| the content | none until 95 % of the height (0.30 s), heavily blurred, sharp by about 0.40 s | none until 90 % of the growth, sharp at size (0.31 s) |
| where it sits | the toolbar's bottom-leading corner, 6 dp further out and 9.5 dp lower | flush on the trigger's corner |

Timing. The reference is tracked frame by frame (the box of everything lighter than the frame before the menu opened,
so ±0.033 s), from the first frame that changes (311.578 s opening, 313.447 s closing); the model is the growth
springs, with the drop "formed" when growth begins and "reached" on closing when growth is below 0.12 (a 66 dp body
for this menu, where the reference drop measures 67 to 77 dp):

| | reference | `DEFAULT_GROWTH_TIMING` before | after |
|---|---|---|---|
| the drop has formed and rises out of the source | 0.10 s | 0.18 | 0.10 |
| at size (95 % of the height) | 0.30 to 0.33 s | 0.40 | 0.28 |
| overshoot | 3.5 % of the height at 0.37 s (the top edge, 46 px past its rest) | 3.3 % at 0.51 | 3.2 % at 0.37 |
| settled | 0.83 s, sliding 13 dp down into its window-concentric place after reaching size | 0.69 | 0.52 |
| closing reaches the drop | 0.25 s | 0.23 | 0.23 |
| closing is back in the source, its ridge gone | 0.42 s | 0.57 | 0.44 |

The rows and their spacing, the timing up to the overshoot and the closing, the resting body and the drop's lightness
are held (unit tests and N15). The drop's size, the menu's offset from the toolbar and the slide that settles it there
are layout of the reference (a wide toolbar gathers more glass; the menu sits concentric with the window, which the kit
does not know), so they are reported, not held. The silhouette is one element's box, so the neck between the drop and
the menu shapes the refraction but not the outline. The lab's `view=menu-reference` puts ten of the frames (opening
and closing) next to ours at the same time since the start, over the frame before the menu opened with the toolbar
filled in from its surround.

## Resting body

At rest, over a smooth backdrop, a glass control with no body of its own is only its rim: the lens has nothing to
refract. The reference resting body is a visible smoky disc that carries the backdrop's colour, with a readable rim.
The kit gives the control a body at rest (`atomBody`, attached with `body: false` so the core does not paint its
own); the rim is the core's, whose strength follows the surround. Both are measured against the reference below.

### How it is measured

On an image, for a control with half sizes `hw`, `hh` and radius `R = min(hw, hh)` (a capsule or a circle; the
reference ellipses in perspective use an elliptical distance), in OKLab from sRGB:

- **body**: median over the ring from 0.15 R to 0.45 R inside the rim (clear of the rim and of the glyph);
- **surround**: median over the ring from 0.15 R to 0.55 R outside it;
- **ΔL**, **ΔC**: body minus surround, in lightness and in chroma; a body that carries the surroundings' colour keeps
  ΔC near zero;
- **rim over surround**: the brightest of 24 angular bins (90th percentile of lightness in each) over the band from
  0.07 R inside to 0.03 R outside the edge, minus the surround's lightness.

`tests/lab/measure.ts` does this for the gate and for `npx playwright test reference`, which measures every
reference control and our atom, at rest and pressed, on the same backdrop (`VIREUIKIT_REFERENCE_DIR` set; the lab's
`view=reference` paints the frame's backdrop around the control, scaled so that the reference control is as tall as
ours, with the control's own footprint filled smoothly from its surround, and hands the element the sample of that
footprint). Footprints are in `lab/reference-controls.ts`. Frames M 18:26 and M 18:30 are taken from the video at
that time; the rest are the extracted frames. sRGB is assumed for the video's colours.

### What the reference measures, and ours

Lightness and chroma differences are in OKLab; ours is the kit's atom at the touch size (44 dp) on the same
backdrop. "Before" is the kit on `vireglass` 2.3.1, which dimmed the core's full-white rim by a factor of its own;
"after" is the kit on 3.0.0 with the core's rim. The body is the kit's in both.

| Frame and control | ref ΔL | before | after | ref ΔC | after | ref rim | before | after |
|---|---|---|---|---|---|---|---|---|
| A 2:17 skip back, circle | +0.086 | +0.083 | +0.086 | +0.007 | -0.003 | 0.240 | 0.264 | 0.249 |
| A 2:17 pause, large circle | +0.071 | +0.104 | +0.106 | +0.013 | +0.005 | 0.257 | 0.321 | 0.302 |
| A 2:17 skip forward, circle | +0.045 | +0.093 | +0.093 | +0.004 | +0.002 | 0.268 | 0.324 | 0.311 |
| A 2:17 Continue Watching, capsule | +0.080 | +0.096 | +0.098 | +0.011 | +0.000 | 0.256 | 0.277 | 0.252 |
| A 2:17 Info, capsule over warm | +0.126 | +0.083 | +0.084 | +0.020 | -0.008 | 0.268 | 0.251 | 0.235 |
| M 2:52 next, circle over sky | +0.076 | +0.041 | +0.043 | -0.001 | -0.005 | 0.246 | 0.227 | 0.243 |
| A 2:18 more, circle over grass (a) | +0.232 | +0.093 | +0.097 | -0.013 | +0.004 | 0.372 | 0.356 | 0.375 |
| M 11:58 toolbar capsule over text (a) | +0.049 | -0.012 | -0.006 | -0.000 | -0.001 | 0.114 | 0.078 | 0.084 |
| M 18:26 circle over a flower (a) | +0.040 | +0.064 | +0.071 | +0.040 | +0.004 | 0.291 | 0.240 | 0.257 |
| M 18:30 the same, reduced transparency (a) | +0.169 | +0.169 | +0.177 | +0.010 | -0.023 | 0.187 | 0.266 | 0.231 |
| M 3:52 circle under the finger, pressed (a) (b) | +0.198 | +0.039 | +0.046 | +0.001 | -0.003 | 0.392 | 0.385 | 0.286 |

(a) The backdrop is not smooth: what lies under the control is not in the frame, so the surround is only a guess
for it. These rows are reported, not held to the tolerance. (b) The only reference control caught pressed, compared
with our pressed atom; the finger covers the lower part of the body and of the surround in both.

**Tolerance**, on the six rows not marked (a), all on smooth backdrops: ours is within 0.05 of the reference in ΔL,
within 0.08 in rim over surround and within 0.04 in ΔC. The largest gaps among them are ΔL +0.048 (skip forward)
and -0.042 (Info), rim +0.045 (pause) and ΔC 0.028 (Info). The kit's own rim factor left the rim up to +0.064 over
the reference (pause); the core's is within +0.045 of it. The (a) rows are further off in ΔL (grass -0.135, text
-0.055).

**Pressed.** Our pressed body is no milkier than before (+0.046 against the reference's +0.198 at M 3:52), and the
rim no longer flares: over the dark frames the pressed rim measured 0.72 to 0.81 over the surround before (the
core's lobe at full white) and 0.26 to 0.34 after. At M 3:52 that full-white lobe happened to match the reference
(0.385 against 0.392); the core's line reads 0.286 there, because its strength follows the surround and not the
press (see below).

### The gate

B26 and B27 hold on generated backdrops with headroom: ΔL between 0.02 and 0.14, |ΔC| at most 0.04, rim over
surround between 0.10 and 0.45. The bounds sit under the lowest and over the highest reference values above
(ΔL 0.040 to 0.232 on every resting row, 0.045 to 0.126 on the smooth ones; rim 0.11 to 0.37) with a margin. Over a
near-white backdrop the body cannot get much lighter, so there the gate asks only for a clearly positive ΔL (above
0.01): every reference row is positive, ours is 0.02 and a body of nothing measures 0.004. On the dark and photo
backdrops ours measures ΔL 0.03 to 0.04 and rim 0.15 to 0.19 (0.15 to 0.21 with the kit's rim factor), so the
bounds did not move. The canaries are a body of nothing (ΔL 0.004), the old look, and a rim drawn white all round (0.70 over a
dark backdrop), brighter than even the old white lobe.

The bounds come from the reference, not from our own output, and the gate measures pixels of a render, so a change
to the core's lens that moves the body or the rim fails it in either direction.

### What the core offers, and what the kit still does itself

- **The rim is the core's.** `vireglass` 3.0 draws a thin line round the whole contour whose strength follows the
  lightness around the element, and it lands within the tolerance on every smooth row (above), so the kit's factor
  (`atomRimOpacity`, `--vk-rim` on the lens's `::after`) is gone. What it does not do is brighten under press: the
  line's strength is capped at the reflectance of ordinary glass, so the denser pressed medium draws it barely
  brighter (0.286 against the reference's 0.392 at M 3:52). A core change would let the press reach the line.
- **The body stays the kit's.** The core now paints a body on the SVG path as well. Measured in place of
  `atomBody` (`body` left on, same lab, same samples), it misses the kit's bounds:

  | Where | reference | kit body | core body | bound |
  |---|---|---|---|---|
  | A 2:17 skip forward, ΔL | +0.045 | +0.093 | +0.114 | within 0.05 of the reference |
  | M 2:52 next, ΔL | +0.076 | +0.043 | +0.021 | within 0.05 of the reference |
  | M 18:30 reduced transparency, ΔL | +0.169 | +0.177 | -0.359 | lighter than the surround (B16) |
  | gate, light backdrop, ΔL | | 0.021 | -0.002 | above 0.01 |
  | M 3:52 pressed, ΔL | +0.198 | +0.046 | -0.051 | not held (a) |

  The other four smooth rows and the dark and photo gates (ΔL 0.069 and 0.024) are within the bounds with either
  body. Under reduced transparency the core takes the body to the ink's own pole once its density passes 0.8, so
  with a light glyph over M 18:30 it turns near black, where the reference is a light frosted body under a dark
  glyph. The control material also carries no presence any more, so a disabled control's core body would not thin
  (B9). Neither body comes near the reference's milky press.
- **The probe is blind to images and gradients.** The ambient colour that the body, the ink and the rim follow comes
  from declared backgrounds. A host that knows its backdrop sets `sample` on the element (B29), which goes to the
  lens's `setSample`; the lab does this for its photo and reference backdrops instead of declaring their mean colour.

## Adaptive model

What each atom and pattern becomes across window classes, input and posture. The model is `src/kit/adaptive`
(`docs/design.md`, "The adaptive layer"). It rests on decisions taken for VireMusic on 18.10.2026: a menu grows out of
its trigger on every class and a long pick is a sheet; search is a button at the bar's end on compact, a rail item on
medium and expanded and a persistent field from large; the bottom transport stays on every class, with a supporting
pane beside the content from large and over it on expanded; a rail on medium with one pane and on a compact height, a
bar on a compact width and in tabletop, a sidebar from large; foldables get postures; four primary destinations and a
search button, no "More". Behaviour tests are in `tests/lab/adaptive-behavior.spec.ts` (the stage) and
`tests/lab/input-behavior.spec.ts` (the atoms' input layers and a real fold).

| # | Criterion | Check |
|---|---|---|
| AD1 | Classes come from the window, never the device: width compact below 600 dp, medium to 839, expanded to 1199, large to 1599, xlarge from 1600; height compact below 480, medium to 899, expanded from 900 (G Breakpoints; J; H Layout: "not device type or orientation"). Orientation is not an input. | unit "width boundaries…", "height boundaries…"; behaviour "a view is addressed by its URL…" |
| AD2 | Input is three layers: the size tier follows the primary pointer, the hit area any coarse input, hover the event; a keyboard changes neither tier nor hit area (E MQ4: `pointer` describes the primary only; S Apple: iPad stays touch first; I ≈8:40). A laptop with a touch screen gets the pointer tier (32 dp) with a 44 dp hit area. | unit "density follows the primary pointer…", canary "one coarse flag cannot give…"; behaviour "a laptop with a touch screen keeps the pointer tier…" (stubbed media queries, the system path), canary "a single coarse flag fails that gate whichever way it reads", "a phone gets the finger tier…", "a device that gains or loses touch moves the hit area…", "the real atoms take the tier from the primary pointer…" |
| AD3 | Hover is the event's: a mouse on a touch-first device hovers, a finger never does, and a device that can no longer hover drops a hover that is showing while a held press stays. | unit "hover is the event's"; behaviour "a mouse on a touch-first device hovers", "a finger never hovers, even where the pointer is primary", "a hover that is showing goes…" |
| AD4 | A hardware keyboard is learned from a key pressed outside a field; typing into a field does not count, a field inside an open shadow root included, because an on-screen keyboard types only there (E MQ4: no query exists). | behaviour "is known from a key pressed outside a field…" |
| AD5 | A host or a simulation overrides the input layers live (`setInputOverride`); a key set to `undefined` follows the system again. | behaviour "the input override beats the system…" |
| AD6 | Posture: tabletop is a horizontal fold, book a vertical one; on the web two viewport segments count as half-open, since there is no hinge angle (E Viewport Segments; J fold-aware). An occluding band belongs to neither segment, a line splits at its centre; segments and posture convert both ways. | unit "posture and segments" |
| AD7 | Navigation's form: a bar on a compact width and in tabletop; a rail on medium with one pane, on expanded and on any compact height below large, whatever the window's proportions; a sidebar from large; medium with two panes takes the bar, except in book posture, where the rail stays; a sidebar the person collapsed stays a rail until they expand it (decision 4; G Navigation bar, rail; J adaptive navigation; F NavigationView). | unit "navigation"; behaviour per preset, "…the model's forms, and the atoms at the input's tier" (`data-form` of the real `<vire-nav>`, and the panes clear its body, search and accessory) |
| AD8 | The same primary destinations on every form, at most five bar slots with the search button, the rest secondary; secondary destinations show only in the sidebar; there is no "More" (decision 6; H Tab bars; G Navigation rail). | unit "the same destinations on every form…"; behaviour per preset (the links shown: the four primary and the search, the secondary two only in the sidebar) |
| AD9 | Search: a button at the bar's trailing end, a rail item, a persistent field from large (in the sidebar, or the toolbar's corner with the sidebar collapsed); a shortcut wherever there is a keyboard and from large (decision 2; Q ≈4:12; S Slack; I ≈10:24). | unit "search: …"; behaviour per preset, "…the model's forms, and the atoms at the input's tier" (`data-search`) |
| AD10 | Navigation is one body: through a sweep from 360 to 1600 dp and back the stage has one navigation element on every frame, and its form flows bar, rail, sidebar, rail, bar (M 8:35–8:47; I ≈1:25). | behaviour "a sweep across every breakpoint and back keeps one navigation body, asks for bar, rail, sidebar, rail, bar and never jumps" (one `<vire-nav>` and its first body on every frame, the form it asks for from `vire-nav-layout`), "the form it draws flows bar, rail, sidebar, rail, bar" (`data-form`); unit "never jumps across an aim…" (the form in sight never flips under an aim) |
| AD11 | A class change is a morph on the growth's springs (the menu's opening response, critically damped so a layout does not bounce off the window's edge): no frame covers 40 % of the change. | unit "moves at the growth's pace…", "every frame is one box between the two…"; behaviour (the same sweep, the body's box sampled frame by frame, glass off so that a frame is shorter than the spring's step cap, largest step below 0.4), canary "a navigation that swaps form in one frame fails the morph gate" (above 0.9) |
| AD12 | Turned back mid-way, a morph runs back from where it is and never reaches the other form; a third form starts from the current box (N11). | unit "turned back mid-way…", "a third form mid-way…"; behaviour "turned back mid-way, the body runs back from where it is and never reaches the other form" (the body's width falls and comes back, the form drawn stays the rail) |
| AD13 | Reduced motion: the new form is there in the next frame (B18, N18). | unit "under reduced motion…"; behaviour "under reduced motion the new form is there in the next frame" |
| AD14 | State is indestructible: the section, the selection, the list's scroll, typed text and an open sheet survive every threshold of a sweep, a fold and unfold and a rotation (I ≈1:25; D 13:43; J foldables). | behaviour "the section, the selection, the list's scroll, typed text and an open sheet survive every threshold, a fold and a rotation" (with the selected link and the focus on it), "a focused link that is not the selected one keeps focus…" |
| AD15 | A menu grows out of its trigger on every class; a long pick is a sheet (`picker`), never a menu (decision 1; M 5:11; S). | unit "a menu grows out of its trigger on every class", "a modal task is a bottom sheet…" |
| AD16 | A popover is a bottom sheet grown from its source below 600 dp and a popover from 600 (H `UIModalPresentationStyle.popover`; S Tide Guide). | unit "a popover is a sheet grown…"; behaviour "a popover becomes a sheet grown from its source below 600…" |
| AD17 | A supplementary sheet is a bottom sheet below 840 dp (at most 640 wide on medium), a side sheet that narrows the content from 840 (at most 400), and a third pane from 1600 (G Bottom sheets, Side sheets, Large and extra-large). | unit "a supplementary sheet is…"; behaviour "an open sheet changes form at 840 and 1600 and back…" (widths measured) |
| AD18 | A modal task or a picker is a bottom sheet below 600 dp and a centred sheet from 600, at most 560 wide (G Dialogs; U ≈6:20). | unit "a modal task is a bottom sheet below 600…" |
| AD19 | A dialog with fields is full screen below 600 dp and a basic dialog from 600; an alert is an alert on every class (G Dialogs: "full-screen dialogs are for compact breakpoints only"). | unit "a dialog with fields…"; behaviour "…a dialog with fields is full screen below 600" |
| AD20 | On a compact height every bottom or centred sheet is full screen; a side sheet is full height already and stays (H `presentationCompactAdaptation`). | unit "on a compact height every bottom or centred sheet is full screen…"; behaviour "…full screen on a compact height" |
| AD21 | An open surface stays open through a change of form; only one whose anchor is gone retracts into the anchor's new owner and closes. Fluent closes flyouts on a resize; that is not taken (F Dialogs and flyouts; H popover adaptation). | unit "describes what flows into what…"; behaviour "an open sheet… stays open", the state test |
| AD22 | No surface crosses the fold: it lives in its source's segment, or the largest one without a source; a side sheet in book posture takes the trailing segment, in tabletop its source's half like every other surface (J Learn about foldables). | unit "a surface never crosses the fold…", "in tabletop a side sheet stays in its source's half…", "a surface lives in its source's segment…" |
| AD23 | A menu is placed in its trigger's segment, pinned to the corner facing that segment's nearest corner, and every frame of its growth stays in the segment, the overshoot included; a menu taller than its segment scrolls inside it. | unit "a menu near the fold pins to the corner facing its own segment…", "every frame of the growth stays in the region…", "a menu opened in either half of a folded window never crosses the fold" (400 random cases per posture and band); behaviour on a real fold from the DevTools display feature: "beside a vertical fold it stays in its trigger's segment on every frame…", "above a horizontal fold a menu taller than its segment scrolls…", canary "without the segments the same menu crosses where the fold would be"; on the stage: "in book posture…", "in tabletop…", canary "a window that reports no fold lets the same menus cross it" |
| AD24 | List-detail: one pane below 840 dp and on a compact height; two from 840 with a 360 dp list, 412 from 1200; a medium window halves only for sparse content; book posture splits the panes at the fold (J canonical layouts; G List-detail). | unit "one pane below 840…", "a medium window splits in half only for sparse content…", "book posture splits the panes along the fold…"; behaviour per preset (list width measured), "a half-open posture…" |
| AD25 | Narrowing keeps the detail when something is selected and the person is on it, the list otherwise; widening shows the list with the selection drawn, or the detail's empty state; back exists only on a lone detail (J; K ≈5:00). | unit "narrowing keeps the detail…", "widening shows the list…" |
| AD26 | The supporting pane is beside the content from large (at most 400 dp), over it on expanded when opened, hidden below, and the person's choice to keep it is remembered, so it returns when the window widens (decision 3; J supporting pane). | unit "the supporting pane…", "a sweep down and back up returns the supporting pane…"; behaviour "a supporting pane shown beside the content hides below large and comes back…" |
| AD27 | The bottom accessory sits above the bar, in the bar's row once the bar minimises (transport only), and along the bottom of the content beside a rail or a sidebar (H Tab bars, bottom accessory; decision 3). | unit "the bottom accessory sits above the bar…"; behaviour "the bottom accessory sits above the bar, in the minimised bar's row between its circles, and along the bottom of the content beside a rail or a sidebar" (the real accessory's boxes and `data-placement`) |
| AD28 | A toolbar fits its container: separate capsules, then neighbours merge (text never with symbols, groups only within themselves), then the lowest priority goes into "…" first, the trailing one among equals; a badged item and the main action never overflow, and the main action is at the trailing end; "…" exists only for overflow; every item stays reachable at every width, and a wider container never shows fewer (M 4:43; H Toolbars; B 11:40; D 9:41–10:05). | unit "toolbar layout" (every width from 0 to 520 dp) |
| AD29 | The window places the toolbar: at the bottom on compact with at most three groups, at the pane's top above that, in a trailing vertical strip on a compact height, where text stays in a horizontal row (B 0:28; D: text buttons do not stand vertical). | unit "the window places it…", "vertical: symbols stand in the strip…"; behaviour per preset (toolbar edge) |
| AD30 | Tabletop splits what is watched (above the fold) from its controls (below), book the leading half from the trailing; the bar sits in tabletop's bottom half (J fold-aware; J adaptive navigation). | unit "a half-open posture splits watched content…"; behaviour "a half-open posture: tabletop puts the bar in the bottom half…" |
| AD31 | While the window is dragged no lens is rebuilt or reshaped: the atoms keep their geometry across every class, the navigation keeps its body's and its accessory's glass, and the selection's lens exists only while a form changes (K ≈14:44: re-rendering for every size within a resize is unnecessary). | behaviour "no lens is rebuilt: the atoms keep their glass and geometry, the navigation its body and accessory, and the selection's lens exists for a form change only" (a recording stand-in for `vireglass/dom`: the atoms' attaches and reshapes unchanged across the sweep, the body and the accessory attached once, the lens attached at most once for each of the four form changes and gone at rest; a press afterwards still reaches an atom), "within a class the window is dragged without reshaping the navigation's glass" |
| AD32 | The stage shows every preset at its URL: the real atoms and the real navigation in their forms and the unbuilt patterns as outlines placed by the model. | behaviour per preset, "…the model's forms, and the atoms at the input's tier" (one `<vire-nav>`, its form, its links); snapshots `adaptive stage: …` (`adaptive-*`) (phone portrait and landscape, book with a popover, tabletop, tablet landscape with a side sheet, desktop with the supporting pane) |

Side-by-side: the vertical strip of a toolbar and of panes on the folding phone's inner screen in landscape (B 0:28,
5:56) against the stage's `preset=phone-landscape`. The sidebar flowing into the tab bar and the tab bar's accessory are in the research (M 8:35–8:47,
U 5:31–5:52) against the stage's sweep and its `preset=phone-portrait`.

## Navigation

The bar, the rail and the sidebar are one glass body; a change of form goes through the selection, which lifts into a
lens, takes the old body in and grows the new one out (M 8:35–8:47, frame by frame at 15 fps). The selection on the
bar is also a knob the finger drags (U 298–299.7 s, 15 fps). Behaviour tests are in `tests/lab/nav-behavior.spec.ts`.

| # | Criterion | Check |
|---|---|---|
| NV1 | It works before the kit: a `<nav aria-label>` with a list of links, the current one `aria-current="page"`, an optional secondary list and search link; every link navigates and Tab walks them with no script and no glass. | behaviour "before the upgrade" |
| NV2 | The upgrade keeps the markup's meaning: one `navigation` landmark on every form with the author's label, links stay links (no `tablist`, no `role` added to them, arrows not taken), `aria-current` stays the host's. Removing the element gives the markup back with nothing of its own left. A `[data-badge]` is `aria-hidden` (restored on removal) and a `[data-badge-label]` in the link is visually hidden but stays in its name. | behaviour "roles", "removing the element gives the markup back", "badges" |
| NV3 | The form is the model's (AD7–AD9): bar, rail or sidebar from the element's own box and input, the secondary list only in the sidebar, the search as a circle on the bar, an item on the rail and a field-like row in the sidebar; a `form` attribute fixes it. | behaviour per form; on the stage "…the model's forms, and the atoms at the input's tier" per preset (`data-form`, `data-search`) |
| NV4 | The bar is a capsule centred at the bottom with 74 dp items, the icon over the label and a pill 3 dp inside the selected item; its search is a separate circle the bar's height with an 8 dp gap; the rail is a vertical capsule at the leading edge; the sidebar a 280 dp inset panel with rows beside their icons (U 4:45, t = 290 s; G Navigation rail; decision 4). | unit `navLayout`; behaviour (boxes measured) |
| NV5 | The insets the content must clear are published on the parent (`--vire-nav-inset-bottom`, `--vire-nav-inset-start`) and in `vire-nav-layout`, and change with the form. | behaviour "the insets follow the form" |
| NV6 | A change of form goes through the selection: the lens appears over the selected item, the body contracts until it is the lens (its area at the middle at most 1.1 × the lens's), the lens moves to the selection's place in the new form, the new body grows out of it and the lens settles into the pill; the body never jumps (no frame covers 40 % of the change, AD11) (M 8:36–8:37). | unit `navMorphFrame` (phases, boxes at the boundaries); behaviour, sampled frame by frame, canary "a navigation that swaps its form fails it" |
| NV7 | Old content defocuses out before the middle and new content focuses in after it; at the middle no content shows but the lens's copy of the selected destination, so the selection never leaves sight. | unit (ink by phase); behaviour (ink sampled; the lens holds the selected label on every frame) |
| NV8 | On the bar the search circle buds off the trailing end as the bar grows and merges back as it contracts: one lens with a second shape whose smoothing falls to 0 as they part (M 8:42). | unit (the second shape and its smoothing across the grow phase); behaviour (what the lens is handed) |
| NV9 | The whole change takes about 0.8–0.9 s (M 8:36.2–8:37.0); turned back mid-way it runs back from where it is; a third form swaps the target while the body is still the lens and rebases from the current frame once it grows; under reduced motion the new form is there in the next frame (AD12, AD13). | unit (timing, reversal, third form, reduced motion); behaviour "turned back…", "reduced motion…" |
| NV10 | Through a change of form the selected link and the secondary list's scroll stay; focus stays on the same link while that link stays shown, and a link the new form hides (minimising, a link moving to the secondary list, the sidebar over the content closing) hands focus to the selected link, or to the toggle, without scrolling; Escape or the scrim closing the sidebar over the content returns focus to the toggle if it was inside the navigation (AD14). | behaviour "a change of form keeps the selection and the focus", "a link the form hides…" |
| NV11 | At rest there is one glass surface for the body and its search (plus the accessory's); the lens is glass only while it moves and is gone at rest, where the selection is a fill (no glass on glass at rest). | behaviour (lenses counted at rest and while moving, a recording stand-in for `vireglass/dom`) |
| NV12 | Dragging on the bar lifts the selection into the lens under the finger; the lens follows the finger continuously (its centre within 2 px of the pointer, clamped to the bar), stretched along the motion; release settles it on the nearest item and activates that link exactly once; a cancelled press settles it back where it was (U 298–299.7 s). | unit `navDrag`; behaviour "the lens follows the finger…", "release activates the nearest…", canary "a lens that jumps from item to item fails it" |
| NV13 | A tap is a plain link click: one click on the link, nothing prevented; the pill slides to the link the host marks `aria-current`, without a lift. | behaviour "a tap is a link click…", "the pill follows aria-current" |
| NV14 | With `minimize="scroll"` the bar minimises after 24 dp scrolled down in its scroller and expands after 24 dp up, at the top, on a tap on it (which does not navigate) and when focus enters it; minimised, it is the selected icon's circle and the search circle, 44 dp each; only the bar minimises (U 5:07; H Tab bars). Jitter does not toggle it (a reversal under 4 dp counts into the run), a bounce past either end is the end, a new scroller expands it, a scroller that left the document or that its id no longer names is let go, and the document can be the scroller. | unit `stepMinimize`, `clampScrollTop`; behaviour "scrolling minimises and expands the bar…", "the scroller" |
| NV15 | The bottom accessory sits over the bar and its search, 48 dp high and 8 dp above; in the minimised bar's row between the circles; along the bottom of the content beside a rail or sidebar; it reshapes between them on springs and says where it is in `data-placement` (AD27; U 5:31–5:52; decision 3). | behaviour (boxes per placement, `data-placement`) |
| NV16 | The sidebar's toggle collapses it into a rail and back: the toggle's name is the `toggle-label` attribute (default "Sidebar"), constant, and `aria-expanded` alone carries the state (true while the sidebar is shown, beside or over the content); the `collapsed` attribute and `vire-nav-collapse`; the element stores nothing. An expandable rail on an expanded window opens the sidebar over the content with a scrim, and Escape, a press outside or a choice close it. | behaviour "the toggle…", "the rail opens over the content…" |
| NV17 | Where the model gives a shortcut, `search-key` (default `/`) pressed outside a field activates the search link, and the link carries `aria-keyshortcuts`; nowhere else. | behaviour "the search shortcut…" |
| NV18 | Hit areas: every destination meets 44 dp wherever any coarse input is present (AD2); sidebar rows are 44 dp on the touch tier and 36 dp on the pointer tier. | behaviour (hit areas measured with stubbed media queries) |
| NV19 | With glass off, under reduced transparency and increased contrast every form stays readable and works: a plain or frosted body, a filled pill, the same geometry. | behaviour (modes); snapshots |
| NV20 | The lab shows every form (bar, minimised bar, rail, sidebar) on every backdrop with glass on and off, and the stage draws the real navigation in place of its outline. | snapshots `nav-*`, and `adaptive stage: …` (`adaptive-*`) on the stage; behaviour "…the model's forms…" per preset |
| NV21 | A rail taller than its window stops at the window's edge and its rows scroll inside the body at rest, the offset remembered per form, as the sidebar's do. | unit `navLayout` (the rail's body capped); behaviour "a rail taller than its window…" |

Side-by-side: the cycle at M 8:35–8:47 against the stage's sweep, and the drag at U 298–299.7 s against the gallery's
bar.

## What is not covered

- Switch, slider, segmented control, chip, field; the Android target (`src/native/` does not exist yet).
- The adaptive patterns themselves: sheet, popover, toolbar and search field are outlines on the stage, placed by the
  model; their elements come next (`docs/design.md`, "Order"). The navigation is the real `<vire-nav>`; only it and the
  open surface morph on the stage, and panes move to their new boxes at once.
- A forced `minimized` state freezes the navigation's accessory where it was, so the stage's `barmin` and "bar
  minimised" leave it above the bar; scrolling the list minimises it for real.
- A surface whose anchor goes into overflow: the model says it retracts and closes (AD21); `<vire-menu>` does not yet
  see its trigger leave, which arrives with the toolbar.
- A dialog with fields on a compact height stays a basic dialog from 600 dp, by width only as Material has it; whether
  it should go full screen there like a sheet is open.
- In tabletop a list-detail keeps its panes side by side across the fold by the class rules; only the bar and the
  surfaces respect the halves.
- The context menu on a secondary click or a long press, the on-screen keyboard's inset and the window controls
  overlay (`titlebar-area`) are not modelled.
- The keyboard heuristic (AD4) counts an on-screen keyboard that sends keys outside a field as a hardware one, and
  one typing into a field inside a closed shadow root, which the document cannot see into.
- Postures are simulated: on the stage through `setViewportOverride`, in the browser through the DevTools display
  feature; no device was used.
- `accent` tinting for the one primary action: nothing in the kit sets it.
- `glass="touch"` (glass only under the finger): wired through `vireglass`'s interactive variant, not tested.
- `setMorph` on the button and the icon button: a hook for a host that nothing in the kit calls. The menu morphs its
  own surface's lens (N14).
- The menu: submenus, groups and separators, checkable items (`menuitemcheckbox`, `menuitemradio`), a context menu
  on a long press, and choosing by pressing the trigger, sliding onto an item and releasing. A menu taller than the
  viewport scrolls inside its surface; that is not tested.
- The growth is measured through what the element renders and what it hands the lens, not on pixels: the drop's
  shape (the neck between the drop and the menu) is not compared with M 5:11.
- System `prefers-contrast` and `prefers-reduced-transparency`: the lab only emulates reduced motion, so those two
  modes are tested through the programmatic override.
- Real finger gestures: touch is emulated (tap, coarse pointer), and the finger glow of B1/I4 is `vireglass`'s.
- The press timing: stills are compared, not the motion curve.
- The pressed body against M 3:52: measured (ΔL +0.046 against the reference's +0.198), not held. The press end is
  the tint the kit drew before (B28); a milkier press is open.
- A retry after a module that failed to load: browsers cache a failed dynamic import, so the retry is attempted but
  may fail again without a new request; only a throwing `attachGlass` is observed retrying.
- Forced colours: the colour of the text is asserted, not how the control looks.
- Snapshots: Windows baselines only, run locally, not in CI.

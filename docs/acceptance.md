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
| B20 | Appearance goes by modulating the lens, never by fading the element (M 2:55). | the element never animates opacity; the touch-only variant, the toolbar's capsules and the navigation's lens use `setAppear` on every frame. Gated for the toolbar and the navigation lens with glass on (capsule and lens opacity sampled against the lens's presence); the opacity of a lens-less element (glass off) is its fallback. |
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
| N8 | The glass grows out of the trigger: the surface's first frame is the trigger's body (box and radius), it contracts into a drop while a bud rises out of its top, the drop is a pear for a moment (narrow at the top) and then a bowl (wide at the top), rises toward the menu's centre as it swells (round on both axes, then the rounded rectangle, its height trailing its width), overshoots a little in width, and the content, magnified, 2.2 rows high and out of focus inside the lens, slides down into place and clears after the body has its size (M 5:11, frame by frame; M 5:05 "the bubble simply pops open to reveal the content"). | unit (frames at the boundaries, the drop, the rise, the overshoot, the ink and its own focus); behaviour "the surface starts on the trigger, passes a drop and lands on the menu", canary "a menu that pops open without growing fails it"; N29 |
| N9 | The timing is the reference's, tracked on the same frames as N29: the drop forms in about 0.12 s and the body is at 95 % of its width at about 0.33 s and of its height at about 0.44 s (the height does not overshoot); the width overshoots by about 5 % at about 0.43 s and is settled at about 0.62 s; the content is sharp at about 0.59 s; closing reaches the drop at about 0.26 s and is back in the trigger at about 0.35 s (M 5:11, "Against the reference"). | unit `DEFAULT_GROWTH_TIMING` against these numbers; N29 |
| N10 | It stays under the finger: the menu shares the trigger's corner that points to the nearest corner of its region (the trigger's segment of the window, AD23) and grows into the open space, covering the trigger; it flips or slides only to stay in that region, and `corner` fixes the corner (S: the button morphs into the menu so that the grip does not change). | unit `menuPlacement`; behaviour "the menu pins to the trigger's corner" |
| N11 | Closing retraces the growth: the content defocuses first, the menu flows back into a drop that sits where it grew from, and the drop into the trigger, which the body passes by a few dp (at most about 16 dp for a 44 dp trigger: the sink is bounded by the trigger's size, not by how far the menu's centre is) and settles back onto, ending on the trigger's body; reopening midway turns back from where it is. | unit (reverse path, the path past the trigger, turning back); behaviour "closing runs back through the drop into the trigger"; N29 (the centroid at the three closing instants) |
| N12 | One body: on every frame the menu is out (growing, open, retracting) the trigger draws no lens, no body and no rim of its own and takes no pointer events, so there is never glass on glass; its glyphs stay in focus under the surface, cut to the body as it contracts and seen through its veil, or through glass that scatters as the trigger's own does, until the drop has formed, and they come back with the capsule on the way in (M 13:24; M 5:11, the toolbar's glyphs are in focus as the bud rises and defocus as it gathers into the drop). It takes the body back when the menu has retracted into it, and a trigger whose lens appears only under the finger goes back to no lens. Under forced colours the trigger fades with its glyph. | behaviour "while the menu grows, is out and retracts, the trigger draws no lens, body or rim" (sampled every frame, glass on and `touch`), "the trigger hands its body over and takes it back", "a trigger whose lens appears only under the finger…", "the carried trigger fades…"; snapshots `menu-*`; unit `menuCapsule`, `growthInk` |
| N13 | Glass only on the menu's surface: the items are content on it and carry no lens, and the active item's highlight is ink on the glass (the nearer half of a press), concentric with the menu. | unit `menuItemFill`; behaviour "the surface is the only lens"; snapshots |
| N14 | While the drop and the capsule are joined, the surface is one body made of both: its box holds the two shapes and its silhouette is their smooth union (`unionOutline`, applied as a clip path), so a bud rises out of the capsule on the way in and a bump merges back into it on the way out (shapes with a gap between them are bridged, not lost); the drop's pear and bowl are one shape stretched sideways from its top to its bottom (`menuTaper`, from the width of the body at a quarter of its height against three quarters), drawn through the same outline, so a lone drop is clipped as well; once there is one shape the box is that shape and nothing is clipped. Chromium draws the lens's displacement filter with yellow fringes under a clip path, so while the shapes are joined the surface shows its body alone (`data-joined` takes the backdrop filter off), which at that moment is the white drop or the capsule's veil over its glyphs. A popover, whose surface does not take a clip path, hands the second shape to its lens through `setMorph` instead, offset from the surface's centre. | unit `unionOutline`, `menuSurfaceFrame` (with and without the outline), behaviour "while the drop and the capsule are joined the surface is drawn as their union and the lens is handed no second shape" (a recording stand-in for `vireglass/dom`); N29 |
| N15 | The drop and the menu are one medium. As a drop it is white: an opaque body (alpha 1) with a fifth of white and a lift of 0.3 over what it covers (`MENU_DROP_BODY`), through the menu's body and not an opacity on the surface: the reference drop is 0.97 to 0.98 inside its silhouette over a backdrop of 0.79 to 0.82, and over a dark backdrop it can only brighten (§5). The light falls away as the body takes its size and is gone when the content is in focus, and it lets go of the shape slowly on the way back, so the capsule that has re-formed is still lit. While the body swells it is lit from below, its top dimmer than its bottom (`menuLit`: the top half 0.15 to 0.19 darker than the bottom at 0.25 to 0.38 s, against 0.10 at rest), and light bleeds past its edge, a blurred copy of its outline under the surface (`[data-vk-halo]`, a hidden element that exists only while the surface is clipped to an outline; the surface's own clip path cannot draw outside itself). As a menu at rest it carries the control's resting body: the reference menu is 0.058 to 0.072 lighter than what it covers, with ΔC 0.000 (M 5:11, two text-free regions, the open frame minus the same pixels before it opened). | unit `menuActivity`, `menuBody`; behaviour "the resting menu on the mid grey lifts what it covers as the reference menu does" (within 0.05 of it, ours +0.043), "…stands off what it covers…" (dark +0.019, photo +0.026, light +0.017, ΔC within 0.02), "the drop … is lit well above its surround" (ΔL above 0.1, under 0.7 over dark); canaries "a clear menu fails it", "the resting body in the drop's place fails the drop's bound"; N29 (the lightness inside the silhouette) |
| N16 | A large element does not flip between light and dark (M 15:29): the backdrop is read once as the menu opens and held while it is out. | behaviour "the ink holds while the menu is out" |
| N17 | A larger piece is thicker glass, with a deeper shadow, more lensing and a softer scattering of light (M 7:02–7:25), and Regular turns text under it into soft spots (M 11:47). The menu's surface is the control material with the core's sheet scattering (roughness 0.85, a blur of about 10 dp where the control's is 2.2); the thickness and the shadow follow the geometry in the core. | unit `menuGlass`; behaviour "the surface scatters what lies under it far more softly…"; snapshot `menu-text-glass-on`; thickness and shadow owned by `vireglass`, not asserted |
| N18 | Reduced motion: no growth; the menu is at its size in its first frame and gone in the first frame of closing, its content in focus at once (M 18:35). | unit; behaviour "reduced motion opens and closes in one frame" |
| N19 | Reduced transparency frosts the surface (the lens stays, its blur rises, the body goes to `vireglass`'s density and the ink follows it); increased contrast borders it (M 18:22, 18:29). | behaviour; snapshots `menu-busy-reduce-transparency`, `menu-busy-increase-contrast` |
| N20 | Glass off leaves a complete menu: an opaque surface, the same keyboard and choice, and the same growth on the plain surface. | behaviour "glass off…"; snapshots `menu-*-glass-off` |
| N21 | A lens that cannot be loaded leaves the menu working on its plain surface, with no unhandled error. | behaviour "a lens that fails to load…" |
| N22 | Under forced colours the menu uses system colours: a Canvas surface with a border, the active item in Highlight, disabled items in GrayText. | behaviour "forced colours" (colours asserted, not the look) |
| N23 | Upgrading while the page is parsed adopts the trigger and the list and synthesizes nothing; items added later get their role. | behaviour "upgrade while the page is parsed" |
| N24 | `sample` on the menu reaches its surface, set before or after the lens attaches. | behaviour "a sample on the menu reaches its surface" |
| N25 | The press that opened the menu chooses nothing. The menu grows in under the pointer, so its first item lands where the trigger was: the second click of a double click, a pointer click before the menu has arrived (its content in focus and the surface past its overshoot, about 0.5 s) or whose press began before it had, and a held Enter or Space all leave it as it is; a pointer click once it has arrived chooses. A deliberate key is not under the pointer, so Enter or Space on an item chooses from the first frame the content is drawn (opaque, still out of focus, about 0.33 s), long before the surface settles; only a key before the content shows is dropped. Until the menu has arrived its items take no pointer events (`data-arrived`: no hover, no press), because the content is transformed while it grows and a hit would land on a row other than the one drawn there. The platform's own popover never puts an item under the pointer, so it needs none of this. | behaviour "input that began on the trigger" (a double click, second clicks 40 to 250 ms later, Enter and Space held on the trigger and on an item, a second Enter before the content, a key that chooses in the first frame the content is drawn while a pointer click there is still dropped, the items' pointer events off until arrival, and a later click that does choose) |
| N26 | A scroll or a resize while the menu is out puts it back over its trigger once a frame, measures nothing and hands the lens nothing when the surface's shape has not changed; the lens is handed a morph only when it changes. | behaviour "a scroll or a resize while the menu is out costs the lens nothing…" (a recording stand-in for `vireglass/dom`) |
| N27 | `glass` parses as on the buttons: empty, `present` or `touch` is a lens, anything else none. Taking a forced state away closes the menu and resets `aria-expanded`. | behaviour "glass is parsed as on the buttons…", "taking a forced state away…" |
| N28 | The list's own `toggle` event fires once the growth has run back, when the list leaves the top layer; `aria-expanded` turns false as the closing begins. | behaviour "the list's own toggle event fires once the growth has run back…" |
| N29 | The menu's rendering follows the reference's frame by frame at the ten instants of the lab's `view=menu-reference` stage (M 5:11, opening +0.051 to +0.852 s, closing +0.084 to +0.284 s). Per instant, ours and the reference are measured against the frame before the menu opened: (a) the glass silhouette (pixels more than 6/255 away from it, despeckled, holes filled; ours is taken over a dark backdrop, where a resting body is unmistakable and the halo of N15 is left out, since the silhouette is the surface's) and its intersection over union with the reference's; (b) the mean lightness inside it; (c) the edge energy inside it, pulled in 8 px from the rim (the mean distance of the luma from its 7 × 7 average) relative to the settled menu's, so a drop reads 0, content magnified and blurred reads between, sharp content reads 1; (d) its centroid; and what those four do not see, (e) its proportions (the box's height over its width) and taper (its width at a quarter of its height over its width at three quarters: under 1 a pear, over 1 a bowl), (f) where the light sits (the top half's mean lightness minus the bottom half's), (g) the softness of its rim (the contrast across the boundary over its steepest step on rings of one pixel, in pixels), and (h) the content's scale and shift (a two-dimensional match: the structure of the settled menu's content, its luma less a 25 × 25 average and a 5 × 5 blur, inside the settled silhouette, correlated with the frame's structure inside its own silhouette over scales 0.9 to 1.9 and vertical shifts of -130 to +50 dp, the shift being the content's centre against the body's centre; the rows differ in words and icons, so a match does not alias by a row; judged while the menu opens, the body at least 60 % of its height and the reference's content showing, edge energy 0.1; where the reference's content matches and ours does not, it fails). Ours may lead or lag by one reference frame (1/30 s), so (a) to (d) are judged against the reference's frames at t − 1, t and t + 1 as an envelope, not a radius: lightness and relative edge energy by their distance to the interval the three span, the centroid by its distance to the path through the three centroids, the silhouette by the best IoU against the three masks. (e) to (h) change fully within a frame (a pear lives for one), so they are judged at half a frame either way: the interval spanned by the reference's value at t and halfway to each neighbour. What the kit does not model, the reference's menu sitting 6 dp further out and 9.5 lower (window-concentric), is removed by registration, not by slack: the settled instant's centroid offset is measured in the run, printed, applied to centroids and silhouettes in proportion to how much of the settled menu the reference has grown, and fails the run beyond 12 dp (the documented layout, 11.2 dp, and a little). The slacks are fixed and have sources that are not the settled instant's residual: IoU at least 0.8 (the ceiling for shapes the kit draws is 0.89: 0.96 for the static size difference, 167 × 202 dp against 169 × 207, times 0.93 for a one-pixel boundary error on the smallest shape, the 57 × 51 dp drop; the rest allows what the union does not draw); lightness within 0.057 (the largest documented static body difference, the reference's +0.072 against ours +0.017 over a light backdrop, N15, plus 0.002, the spread of the reference's own settled frames); relative edge energy within 0.05 (bounded below by the same spread, 0.002, and above by what one frame of lead changes it by where the content comes into focus, 0.1 to 0.3); centroid within 3 dp (that spread, 0.86 dp, plus 1.6 dp, half of the static size difference, plus 0.5 dp, half a pixel of mask edge); proportions within 0.04 and taper within 0.04 (their spreads in the reference's settled frames, 0.007 and 0.006, plus the static size difference, 0.015 for the proportions, plus two pixels of a 57 dp drop's width, 0.035); the light within 0.04 (a spread of 0.001 plus a half of the lightness slack, since the body gap may sit on one half); the rim within 1 px (a spread of 0.1 px plus a pixel of ring); the content's scale within 0.3 (a step of 0.1 in the match, and the blur's own wash) and its shift within 9 dp (a fifth of a row; the match's own step is 3 dp, refined to 1). The table prints each measure's value and its margin (tolerance minus value; negative fails). A canary runs inside the gate: the reference's own frames, shifted in time by 0 and by ±3 frames (0.1 s), go through the same comparison as ours; the unshifted ones pass at every instant and the shifted ones fail at all nine moving instants (the gate holds 8); of the 18 shifted instants IoU catches 15, edge 15, the centroid 13, the taper 13, the proportions 12, the light 10, lightness 5, the content's shift 4 and the rim 4; the shift measure alone failed ours at 0.318 and 0.384 s before the ride was refitted (-26 and -17 dp of margin: the reference's content at -41 and -22 dp, ours at -1 and +6). A measure that cannot be matched goes on the spec's `KNOWN` list with its instant and reason, prints as KNOWN and is counted in the summary: o+0.051 IoU (ours contracts about 0.01 s early and has no bud) and c+0.084 IoU and taper (the reference drop's tail toward the capsule is not drawn). The stage is two rows of five tiles and lays out the same in a window of 1440 by 1100 and of 1920 by 1080 (a test holds it, every tile inside the window). | local gate `npm run check:lab:reference` (needs the frames in `VIREUIKIT_REFERENCE_DIR`; prints the tables and skips with a message without them; not in CI); unit `parity-measures` and `parity-shape` (thresholding, despeckle and hole fill, IoU, lightness, edge energy, centroid, the envelope, the proportions, the taper, the light, the rim, the content's fit, canaries: a shifted shape moves the centroid by as much, a blurred patch reads lower, a pear drawn as a pill has the pill's taper); `menuTaper`, `menuLit` |
| N30 | The popover takes the menu's drop, its rise, its lit glass and its content's own focus (blur and opacity on the focus spring), but not two things: the silhouette, which it hands to its lens as the second shape because its surface takes no clip path, and the content riding inside the lens (`--vk-tx`, `--vk-ty`, `--vk-s`), which exists only for the menu: a popover's layout is the author's, so its content is neither magnified nor moved. It keeps the pace the menu's growth had before it was fitted to the reference (`POPOVER_GROWTH_TIMING`: a longer closing held the lens on mid-size maps for frames that ran over 33 ms); a sheet takes that pace with every duration slowed by a quarter and a damping of 0.8 on opening (`SHEET_GROWTH_TIMING`), and a change of form takes its opening response (`FORM_MORPH_TIMING`), so the three cannot drift apart. A popover held part-way open (a forced phase) takes its springs from `growthStateAt`, the live curves run to that point, not from a separate approximation. | unit `POPOVER_GROWTH_TIMING`, `SHEET_GROWTH_TIMING`, `growthStateAt`; behaviour "a popover grows out of its trigger"; perf `popover growth`, `popover retraction` |

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
| the drop's lightness | 0.97 to 1.00 over 0.79 to 0.82 (ΔL ≈ +0.2), 0.97 mean inside the silhouette | an opaque body (alpha 1, a fifth of white and a lift of 0.3 over what it covers): 0.99 over light, 0.97 mean inside the silhouette on the stage; over a dark backdrop it brightens to about 0.6 |
| the drop's size | 57 × 51 dp at its smallest (the silhouette at 0.117 s), from a 172 × 44 dp toolbar (the stage's trigger is that toolbar) | 56 × 44 dp: 0.62 × the geometric mean of the source's sides (54 dp), so a round 44 dp button gets one of 27 dp, smaller than itself |
| the drop's shape | a bud on the capsule, a pear (width at a quarter of its height 0.73 of that at three quarters, at 0.117 s), a drop wider at the top (1.14 at 0.184 s), a bowl (1.11 at 0.251 s), the rounded rectangle; closing, a drop with a tail, then the capsule with a bump on top | the same in the silhouette: the union of the capsule and the drop (N14) stretched into a pear (0.89) and a bowl (1.09 at 0.251 s), the height trailing the width; the tail and the narrow ridge of the closing are not drawn |
| light and rim | the top half 0.17 to 0.19 darker than the bottom at 0.25 to 0.32 s (lit from below); a rim 3 to 4 px wide at its steepest from 0.117 to 0.318 s, against 1 to 2 px at rest | the top dimmed and the bottom whitened by `menuLit` (0.16 at 0.25 s, 0.15 at 0.32 s), a halo of the drop's light under its clip (3.3 to 3.5 px at 0.184 and 0.251 s, 1.8 at 0.318 s) |
| the content | none until the body is 80 % grown (0.25 s), then magnified about 1.5 times, 2 to 3 rows high (its centre 41 dp above the body's centre at 0.318 s, 22 at 0.384 s, none from 0.6 s) and heavily blurred inside the lens, sharp by about 0.58 s | the same: from the body's 70 % growth, 1.6 times, 2.2 rows high (the shift follows 1 − the content's focus, which now comes at the reference's pace) and 5 px of blur at first (fitted to the content's edge energy: 0.16 against the reference's 0.17 at 0.318 s, 0.50 against 0.45 at 0.384 s), in focus at about 0.59 s |
| where it sits | the toolbar's bottom-leading corner, 6 dp further out and 9.5 dp lower | flush on the trigger's corner (registered out in N29: 10.7 dp at the settled instant) |

Timing. The reference is tracked frame by frame (the box of everything that differs from the frame before the menu
opened by more than 6 of 255, so ±0.033 s), from the first frame that changes (311.578 s opening, 313.447 s closing);
the model is five springs: the capsule into the drop (`shrink`), the drop's swelling (`grow`, the width and height
of the body), its rise toward the menu's centre (`rise`, which overshoots it by 15 % and, closing, goes past the drop
by about 12 dp and back), the content's focus (`focus`) and the glass's light (`glow`). The drop is "formed" when
growth begins and "reached" on closing when growth is below 0.12:

| | reference | `DEFAULT_GROWTH_TIMING` before | after |
|---|---|---|---|
| the drop has formed and rises out of the source | 0.12 s | 0.10 | 0.12 |
| at size (95 % of the width) | 0.34 s | 0.28 | 0.33 |
| at size (95 % of the height) | 0.45 s | 0.28 | 0.44 |
| overshoot | 5.4 % of the width at 0.45 s | 3.2 % at 0.37 | 4.9 % at 0.43 (the height does not overshoot) |
| settled | 0.65 s in size, then sliding 13 dp down into its window-concentric place | 0.52 | 0.62 |
| the content is sharp | 0.58 s (its edge energy follows ours within the envelope from 0.32 s) | 0.31 | 0.59 |
| the body's centre at 0.18, 0.25, 0.32, 0.38 s | 144, 107, 92, 94 (the box's top edge 6 dp past its rest at 0.38 s) | 131, 112, 110, 108 | 149, 109, 88, 89 (within 2.3, 0.6, 2.3 and 1.1 dp of the reference's path once the layout offset is registered) |
| closing reaches the drop | 0.25 s | 0.23 | 0.26 |
| closing is back in the source, its ridge gone | 0.42 s | 0.44 | 0.35 |

The rows and their spacing, the timing, the silhouette, the lightness inside it, the content's edge energy and the
centroid are held (unit tests, N15 and N29). The reference's height trails its width (95 % at 0.45 s against 0.34 s), which
the body's second spring follows (critically damped, 0.46 s, against 0.44 s at 95 % for the height). The menu's offset from
the toolbar and the slide that settles it there are layout of the reference (the menu sits concentric with the window,
which the kit does not know): the gate registers them out and bounds them (N29). The lab's `view=menu-reference` puts ten of
the frames (opening and closing) next to ours at the same time since the start, over the frame before the menu opened with
the toolbar filled in from its surround; its trigger is the reference toolbar's size, 172 × 44 dp, and its menu is held to the
reference's width, 167 dp, since a label's width depends on the font; `npm run check:lab:reference` measures it.

### The parity gate on that stage

`check:lab:reference` measures both columns of the stage against the frame before the menu opened: the reference's JPEG
crop and our screenshot of one tile at a time (a menu's shadow reaches into the next tile), the silhouette of ours over a dark
backdrop (our resting body lifts what it covers by about 0.02 over this light backdrop, under the 6/255 threshold in places,
while the core's shadow at menu thickness reaches 14 dp, which the reference's does not: both would fake or hide a shape), without
the halo. The criteria and where the tolerances come from are N29. The last run, on this branch with vireglass 3.4.0:

```
instant        IoU   margin     L off   margin  edge off   margin  centroid   margin   ref x,y ours x,y  result
o+0.051       0.72   -0.08~    0.000   0.057      0.00    0.05       2.4     0.6   107,185  107,181  KNOWN iou
o+0.117       0.82    0.02     0.001   0.056      0.00    0.05       2.9     0.1   106,180  109,180  ok
o+0.184       0.90    0.10     0.000   0.057      0.03    0.02       2.7     0.3   104,144  107,147  ok
o+0.251       0.92    0.12     0.000   0.057      0.00    0.05       1.1     1.9   102,107  105,108  ok
o+0.318       0.93    0.13     0.000   0.057      0.00    0.05       0.2     2.8    100,92   104,88  ok
o+0.384       0.92    0.12     0.008   0.049      0.02    0.03       1.2     1.8    100,94   106,90  ok
o+0.852       0.98    0.18     0.041   0.016      0.00    0.05       0.0     3.0    99,111  105,103  ok
c+0.084       0.76   -0.04~    0.000   0.057      0.00    0.05       0.9     2.1   103,117  106,129  KNOWN iou+taper+rim
c+0.184       0.80    0.00     0.002   0.055      0.02    0.03       1.8     1.2   106,174  108,169  ok
c+0.284       0.91    0.11     0.005   0.052      0.00    0.05       0.5     2.5   108,190  107,190  ok
shape and content, each cell the reference's value over ours:
instant       aspect margin      taper margin    top-bot margin     rim px margin      scale margin   shift dp margin
o+0.051    0.34/0.36  0.04   0.96/1.01  0.01 -0.003/0.003 0.040     1.3/1.1   0.8         -/-     -         -/-     - 
o+0.117    0.89/0.70  0.04   0.73/0.83  0.04 -0.030/0.001 0.034     3.2/2.0   0.7         -/-     -         -/-     - 
o+0.184    1.12/1.10  0.04   1.14/1.13  0.04 -0.047/-0.042 0.034     3.6/3.3   1.0         -/-     -         -/-     - 
o+0.251    1.06/1.10  0.00   1.11/1.09  0.04 -0.171/-0.163 0.040     2.5/3.5   0.2         -/-     -         -/-     - 
o+0.318    1.09/1.07  0.02   1.05/1.01  0.01 -0.189/-0.180 0.036     3.1/2.0   0.3   1.30/1.40  0.23     -41/-44     9 
o+0.384    1.12/1.07  0.00   1.04/1.00  0.00 -0.161/-0.135 0.025     2.0/1.1   0.4   1.15/1.20  0.30     -22/-17     7 
o+0.852    1.22/1.21  0.02   0.99/1.00  0.03 -0.105/-0.084 0.020     1.2/1.1   0.9   1.00/1.00  0.30         0/0     9 
c+0.084    1.29/1.23  0.02   1.23/1.06 -0.02~-0.132/-0.166 0.006     3.2/5.9  -1.6~        -/-     -         -/-     - 
c+0.184    1.12/1.19  0.04   0.86/1.10  0.03 -0.014/-0.012 0.040     3.1/3.0   1.0         -/-     -         -/-     - 
c+0.284    0.42/0.40  0.04   0.34/0.40  0.01 0.031/-0.008 0.003     2.7/1.9   0.5         -/-     -         -/-     - 
registration, the settled menu's centroid (ours minus the reference's), taken off every centroid and silhouette: 6.3, -8.6 dp (10.7; bound 12)
noise of the new measures in the same frames: aspect 0.007, taper 0.006, top-bottom light 0.001, rim 0.08 px
slack: IoU 0.8, lightness 0.057, edge 0.05, centroid 3 dp
noise in the reference's own settled frames: IoU 0.990, lightness 0.002, edge 0.002, centroid 0.86 dp
caught by each measure over the 18 shifted moving instants (+3 and -3): iou 15, edge 15, centroid 13, aspect 12, taper 13, vertical 10, rim 4, lightness 5, shift 4, scale 1
summary: 8 of 10 instants pass clean, 0 fail, 4 measures known (o+0.051: iou; c+0.084: iou; c+0.084: taper; c+0.084: rim)
```

Before the content was matched in two dimensions and its ride refitted (the previous commit's kit, the same gate with the new match; the closing's ridge, now off the list, fails here as c+0.284 taper):

```
instant        IoU   margin     L off   margin  edge off   margin  centroid   margin   ref x,y ours x,y  result
o+0.051       0.72   -0.08~    0.000   0.057      0.00    0.05       2.4     0.6   107,185  107,181  KNOWN iou
o+0.117       0.82    0.02     0.001   0.056      0.00    0.05       2.6     0.4   106,180  109,179  ok
o+0.184       0.90    0.10     0.000   0.057      0.03    0.02       2.7     0.3   104,144  107,147  ok
o+0.251       0.92    0.12     0.000   0.057      0.00    0.05       1.1     1.9   102,107  105,108  ok
o+0.318       0.93    0.13     0.000   0.057      0.00    0.05       0.2     2.8    100,92   104,88  FAIL shift
o+0.384       0.92    0.12     0.029   0.028      0.05    0.00       1.2     1.8    100,94   106,90  FAIL shift
o+0.852       0.98    0.18     0.041   0.016      0.00    0.05       0.0     3.0    99,111  105,103  ok
c+0.084       0.76   -0.04~    0.000   0.057      0.00    0.05       0.9     2.1   103,117  106,129  KNOWN iou+taper+rim
c+0.184       0.80    0.00     0.001   0.056      0.02    0.03       1.8     1.2   106,174  108,169  ok
c+0.284       0.81    0.01     0.006   0.051      0.00    0.05       1.5     1.5   108,190  107,187  FAIL taper
shape and content, each cell the reference's value over ours:
instant       aspect margin      taper margin    top-bot margin     rim px margin      scale margin   shift dp margin
o+0.051    0.34/0.36  0.04   0.96/1.01  0.01 -0.003/0.003 0.040     1.3/1.1   0.8         -/-     -         -/-     - 
o+0.117    0.89/0.71  0.04   0.73/0.89  0.04 -0.030/-0.000 0.036     3.2/1.9   0.5         -/-     -         -/-     - 
o+0.184    1.12/1.10  0.04   1.14/1.13  0.04 -0.047/-0.042 0.034     3.6/3.3   1.0         -/-     -         -/-     - 
o+0.251    1.06/1.10  0.00   1.11/1.09  0.04 -0.171/-0.163 0.040     2.5/3.5   0.2         -/-     -         -/-     - 
o+0.318    1.09/1.07  0.02   1.05/1.01  0.01 -0.189/-0.155 0.011     3.1/1.8   0.2   1.30/1.30  0.30      -41/-1   -26!
o+0.384    1.12/1.07  0.00   1.04/1.00  0.00 -0.161/-0.119 0.009     2.0/0.9   0.2   1.15/1.10  0.25       -22/6   -17!
o+0.852    1.22/1.21  0.02   0.99/1.00  0.03 -0.105/-0.084 0.020     1.2/1.1   0.9   1.00/1.00  0.30         0/0     9 
c+0.084    1.29/1.23  0.02   1.23/1.06 -0.02~-0.132/-0.160 0.012     3.2/5.6  -1.4~        -/-     -         -/-     - 
c+0.184    1.12/1.19  0.04   0.86/1.10  0.03 -0.014/-0.014 0.040     3.1/3.0   1.0         -/-     -         -/-     - 
c+0.284    0.42/0.40  0.04   0.34/1.10 -0.69!0.031/-0.007 0.003     2.7/1.8   0.4         -/-     -         -/-     - 
registration, the settled menu's centroid (ours minus the reference's), taken off every centroid and silhouette: 6.3, -8.6 dp (10.7; bound 12)
noise of the new measures in the same frames: aspect 0.007, taper 0.006, top-bottom light 0.001, rim 0.08 px
slack: IoU 0.8, lightness 0.057, edge 0.05, centroid 3 dp
noise in the reference's own settled frames: IoU 0.990, lightness 0.002, edge 0.002, centroid 0.86 dp
caught by each measure over the 18 shifted moving instants (+3 and -3): iou 15, edge 15, centroid 13, aspect 12, taper 13, vertical 10, rim 4, lightness 5, shift 4, scale 1
summary: 5 of 10 instants pass clean, 3 fail, 4 measures known (o+0.051: iou; c+0.084: iou; c+0.084: taper; c+0.084: rim)
```

The `KNOWN` list is four entries, all shapes the union outline does not draw: o+0.051 IoU (0.72: ours contracts about 0.01 s ahead of the
reference and has no bud on the capsule) and c+0.084 IoU, taper and rim (0.76, 1.06 against 1.23 and 5.9 px against 3.2: the reference's drop has a tail
toward the capsule's centre). Nothing is on it as layout of the reference: that is registered (the settled offset, 6.3 and -8.6 dp, is printed and bounded).
The content's ride was what differed at 0.318 and 0.384 s: the reference's content enters 41 dp high and its focus follows at 0.59 s; the old
row-profile match let the reference and ours both fall to rest, the two-dimensional one did not. At 0.852 s the match reads scale 1.00 and shift 0 for both.
The closing's ridge is a bump on the capsule's top (the drop is held inside the capsule's far side while it re-forms, and the capsule sinks 2.5 dp per 0.01 of its
dip per 44 dp of its size), the bottom edge flat. One thing is left that the gate shows and does not fail: at o+0.117 ours is a pill (aspect 0.70 against 0.89) whose
pear is 0.83 against 0.73; a smaller drop core leads the aspect (0.85 at a core of 0.3) but pushes the centroid 5 dp to the right, so it was left. The stage is two rows of five
tiles, so a window of 1440 by 1100 or 1920 by 1080 holds it.

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
| AD14 | State is indestructible: the section, the selection, the list's scroll, typed text and an open sheet survive every threshold of a sweep, a fold and unfold and a rotation (I ≈1:25; D 13:43; J foldables). The sheet is the real `<vire-sheet>`: its field's text, its scroll and its detent come through too. | behaviour "the section, the selection, the list's scroll, typed text and an open sheet survive every threshold, a fold and a rotation" (with the selected link and the focus on it, and the sheet's own typed text and scroll), "an open bottom sheet keeps its detent and its content through every threshold and comes back to it", "a focused link that is not the selected one keeps focus…" |
| AD15 | A menu grows out of its trigger on every class; a long pick is a sheet (`picker`), never a menu (decision 1; M 5:11; S). | unit "a menu grows out of its trigger on every class", "a modal task is a bottom sheet…" |
| AD16 | A popover is a bottom sheet grown from its source below 600 dp and a popover from 600 (H `UIModalPresentationStyle.popover`; S Tide Guide). | unit "a popover is a sheet grown…"; behaviour "a popover becomes a sheet grown from its source below 600…" (on the stage, the real `<vire-popover>`'s `data-form`) |
| AD17 | A supplementary sheet is a bottom sheet below 840 dp (at most 640 wide on medium), a side sheet that narrows the content from 840 (at most 400), and a third pane from 1600 (G Bottom sheets, Side sheets, Large and extra-large). | unit "a supplementary sheet is…"; behaviour "an open sheet changes form at 840 and 1600 and back…" (the real `<vire-sheet>`'s `data-form`, `data-phase` and widths measured) |
| AD18 | A modal task or a picker is a bottom sheet below 600 dp and a centred sheet from 600, at most 560 wide (G Dialogs; U ≈6:20). | unit "a modal task is a bottom sheet below 600…" |
| AD19 | A dialog with fields is full screen below 600 dp and a basic dialog from 600; an alert is an alert on every class (G Dialogs: "full-screen dialogs are for compact breakpoints only"). | unit "a dialog with fields…"; behaviour "…a dialog with fields is full screen below 600" |
| AD20 | On a compact height every bottom or centred sheet is full screen; a side sheet is full height already and stays (H `presentationCompactAdaptation`). | unit "on a compact height every bottom or centred sheet is full screen…"; behaviour "…full screen on a compact height" (the real `<vire-popover>` and the modal `<vire-sheet>` on the stage) |
| AD21 | An open surface stays open through a change of form; only one whose anchor is gone retracts into the anchor's new owner and closes. Fluent closes flyouts on a resize; that is not taken (F Dialogs and flyouts; H popover adaptation). | unit "describes what flows into what…"; behaviour "an open sheet… stays open", the state test, "an open surface whose trigger goes" (toolbar) |
| AD22 | No surface crosses the fold: it lives in its source's segment, or the largest one without a source; a side sheet in book posture takes the trailing segment, in tabletop its source's half like every other surface (J Learn about foldables). | unit "a surface never crosses the fold…", "in tabletop a side sheet stays in its source's half…", "a surface lives in its source's segment…"; behaviour on the stage: "in book posture a popover grows inside the half of its trigger on every frame" (the real popover and sheet, every frame), canary "a window that reports no fold lets the same sheet cross it" |
| AD23 | A menu is placed in its trigger's segment, pinned to the corner facing that segment's nearest corner, and every frame of its growth stays in the segment, the overshoot included; a menu taller than its segment scrolls inside it. | unit "a menu near the fold pins to the corner facing its own segment…", "every frame of the growth stays in the region…", "a menu opened in either half of a folded window never crosses the fold" (400 random cases per posture and band); behaviour on a real fold from the DevTools display feature: "beside a vertical fold it stays in its trigger's segment on every frame…", "above a horizontal fold a menu taller than its segment scrolls…", canary "without the segments the same menu crosses where the fold would be"; on the stage: "in book posture…", "in tabletop…", canary "a window that reports no fold lets the same menus cross it" |
| AD24 | List-detail: one pane below 840 dp and on a compact height; two from 840 with a 360 dp list, 412 from 1200; a medium window halves only for sparse content; book posture splits the panes at the fold (J canonical layouts; G List-detail). | unit "one pane below 840…", "a medium window splits in half only for sparse content…", "book posture splits the panes along the fold…"; behaviour per preset (list width measured), "a half-open posture…" |
| AD25 | Narrowing keeps the detail when something is selected and the person is on it, the list otherwise; widening shows the list with the selection drawn, or the detail's empty state; back exists only on a lone detail (J; K ≈5:00). | unit "narrowing keeps the detail…", "widening shows the list…" |
| AD26 | The supporting pane is beside the content from large (at most 400 dp), over it on expanded when opened, hidden below, and the person's choice to keep it is remembered, so it returns when the window widens (decision 3; J supporting pane). | unit "the supporting pane…", "a sweep down and back up returns the supporting pane…"; behaviour "a supporting pane shown beside the content hides below large and comes back…" |
| AD27 | The bottom accessory sits above the bar, in the bar's row once the bar minimises (transport only), and along the bottom of the content beside a rail or a sidebar (H Tab bars, bottom accessory; decision 3). | unit "the bottom accessory sits above the bar…"; behaviour "the bottom accessory sits above the bar, in the minimised bar's row between its circles, and along the bottom of the content beside a rail or a sidebar" (the real accessory's boxes and `data-placement`) |
| AD28 | A toolbar fits its container: separate capsules, then neighbours merge (text never with symbols, groups only within themselves), then the lowest priority goes into "…" first, the trailing one among equals; a badged item and the main action never overflow, and the main action is at the trailing end; "…" exists only for overflow; every item stays reachable at every width, and a wider container never shows fewer (M 4:43; H Toolbars; B 11:40; D 9:41–10:05). | unit "toolbar layout" (every width from 0 to 520 dp); behaviour "what shows is the model's at every width" (toolbar) |
| AD29 | The window places the toolbar: at the bottom on compact with at most three groups, at the pane's top above that, in a trailing vertical strip on a compact height, where text stays in a horizontal row (B 0:28; D: text buttons do not stand vertical). | unit "the window places it…", "vertical: symbols stand in the strip…"; behaviour per preset (toolbar edge), "the bottom edge floats…" (toolbar) |
| AD30 | Tabletop splits what is watched (above the fold) from its controls (below), book the leading half from the trailing; the bar sits in tabletop's bottom half (J fold-aware; J adaptive navigation). | unit "a half-open posture splits watched content…"; behaviour "a half-open posture: tabletop puts the bar in the bottom half…" |
| AD31 | While the window is dragged no lens is rebuilt or reshaped: the atoms keep their geometry across every class, the navigation keeps its body's and its accessory's glass, and the selection's lens exists only while a form changes (K ≈14:44: re-rendering for every size within a resize is unnecessary). | behaviour "no lens is rebuilt: the atoms keep their glass and geometry, the navigation its body and accessory, and the selection's lens exists for a form change only" (a recording stand-in for `vireglass/dom`: the atoms' attaches and reshapes unchanged across the sweep, the body and the accessory attached once, the lens attached at most once for each of the four form changes and gone at rest; a press afterwards still reaches an atom), "within a class the window is dragged without reshaping the navigation's glass" |
| AD32 | The stage shows every preset at its URL: the real atoms, the real navigation and the real popover and sheet in their forms, and the unbuilt patterns (toolbar, supporting pane) as outlines placed by the model. | behaviour per preset, "…the model's forms, and the atoms at the input's tier" (one `<vire-nav>`, its form, its links); snapshots `adaptive stage: …` (`adaptive-*`) (phone portrait and landscape, book with a popover, tabletop, tablet landscape with a side sheet, desktop with the supporting pane) |

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
| NV8 | On the bar the search circle is the body's second shape at a standstill, joined to it by a neck. While the bar grows or contracts the lens is handed no new second shape, so the neck is not drawn on the way (a new one is a map to rebuild on every frame); the landed frame carries the exact one (M 8:42). | unit (the second shape and its smoothing at rest); behaviour (nothing with a smoothing above 0 is handed while it moves; the landed frame equals a cold render, MO5) |
| NV9 | The whole change takes about 0.8–0.9 s (M 8:36.2–8:37.0); turned back mid-way it runs back from where it is; a third form swaps the target while the body is still the lens and rebases from the current frame once it grows; under reduced motion the new form is there in the next frame (AD12, AD13). | unit (timing, reversal, third form, reduced motion); behaviour "turned back…", "reduced motion…" |
| NV10 | Through a change of form the selected link and the secondary list's scroll stay; focus stays on the same link while that link stays shown, and a link the new form hides (minimising, a link moving to the secondary list, the sidebar over the content closing) hands focus to the selected link, or to the toggle, without scrolling; Escape or the scrim closing the sidebar over the content returns focus to the toggle if it was inside the navigation (AD14). | behaviour "a change of form keeps the selection and the focus", "a link the form hides…" |
| NV11 | At rest there is one glass surface for the body and its search (plus the accessory's), and the lens, attached ahead and parked as a clipped speck so its first draw is not on the first frame of a morph; it is drawn only while it moves, and at rest the selection is a fill (no glass on glass at rest). | behaviour (lenses counted at rest and while moving, a recording stand-in for `vireglass/dom`; the lens parked) |
| NV12 | Dragging on the bar lifts the selection into the lens under the finger; the lens follows the finger continuously (its centre within 2 px of the pointer, clamped to the bar), stretched along the motion; release settles it on the nearest item and activates that link exactly once; a cancelled press settles it back where it was (U 298–299.7 s). While held it shows a crisp magnified copy of the item under it, centred and tinted, every real glyph under it is not drawn so its bevel never refracts one, the selected pill is gone from the bar and comes back on landing, nothing under it is filled like a hover, and hover is a fainter response than the pill (#35). | unit `navDrag`, `itemsUnderLens`; behaviour "the lens follows the finger…", "release activates the nearest…", "the lens held under the finger" (no real glyph under the lens, the copy centred, the pill, hover), canaries "a lens that jumps from item to item fails it", "a link that stays drawn under the lens fails it"; snapshots `motion-nav-drag-*` |
| NV13 | A tap is a plain link click: one click on the link, nothing prevented; the pill slides to the link the host marks `aria-current`, without a lift. | behaviour "a tap is a link click…", "the pill follows aria-current" |
| NV14 | With `minimize="scroll"` the bar minimises after 24 dp scrolled down in its scroller and expands after 24 dp up, at the top, on a tap on it (which does not navigate) and when focus enters it; minimised, it is the selected icon's circle and the search circle, 44 dp each; only the bar minimises (U 5:07; H Tab bars). Jitter does not toggle it (a reversal under 4 dp counts into the run), a bounce past either end is the end, a new scroller expands it, a scroller that left the document or that its id no longer names is let go, and the document can be the scroller. | unit `stepMinimize`, `clampScrollTop`; behaviour "scrolling minimises and expands the bar…", "the scroller" |
| NV15 | The bottom accessory sits over the bar and its search, 48 dp high and 8 dp above; in the minimised bar's row between the circles; along the bottom of the content beside a rail or sidebar, where it ends at the margin or at the leading edge of an open side sheet (`endInset`, read from `--vire-sheet-inset-end` on the shell); it reshapes between them on springs and says where it is in `data-placement` (AD27; U 5:31–5:52; decision 3). | unit `navLayout` (`endInset`); behaviour (boxes per placement, `data-placement`; the stage beside a side sheet) |
| NV16 | The sidebar's toggle collapses it into a rail and back: the toggle's name is the `toggle-label` attribute (default "Sidebar"), constant, and `aria-expanded` alone carries the state (true while the sidebar is shown, beside or over the content); the `collapsed` attribute and `vire-nav-collapse`; the element stores nothing. An expandable rail on an expanded window opens the sidebar over the content with a scrim, and Escape, a press outside or a choice close it. | behaviour "the toggle…", "the rail opens over the content…" |
| NV17 | Where the model gives a shortcut, `search-key` (default `/`) pressed outside a field activates the search link, and the link carries `aria-keyshortcuts`; nowhere else. | behaviour "the search shortcut…" |
| NV18 | Hit areas: every destination meets 44 dp wherever any coarse input is present (AD2); sidebar rows are 44 dp on the touch tier and 36 dp on the pointer tier. | behaviour (hit areas measured with stubbed media queries) |
| NV19 | With glass off, under reduced transparency and increased contrast every form stays readable and works: a plain or frosted body, a filled pill, the same geometry. | behaviour (modes); snapshots |
| NV20 | The lab shows every form (bar, minimised bar, rail, sidebar) on every backdrop with glass on and off, and the stage draws the real navigation in place of its outline. | snapshots `nav-*`, and `adaptive stage: …` (`adaptive-*`) on the stage; behaviour "…the model's forms…" per preset |
| NV21 | A rail taller than its window stops at the window's edge and its rows scroll inside the body at rest, the offset remembered per form, as the sidebar's do. | unit `navLayout` (the rail's body capped); behaviour "a rail taller than its window…" |

Side-by-side: the cycle at M 8:35–8:47 against the stage's sweep, and the drag at U 298–299.7 s against the gallery's
bar.

## Sheet and popover

A surface grows out of the control that presents it and runs back into it, and a class change reshapes it while it
stays open (U 6:56–7:20; D 6:54–7:10). A partial-height sheet is inset glass, and it becomes opaque and flush as it
rises (U 6:12–6:35, measured at t = 392, 400 and 411 s). Behaviour tests are in `tests/lab/sheet-behavior.spec.ts`.

| # | Criterion | Check |
|---|---|---|
| SH1 | It works before the kit. A popover is a `popovertarget` button and a `popover`: light dismiss, Escape and focus return. A modal sheet is a `<dialog>` opened by `command="show-modal"` and closed by `command="close"`: an inert background, Escape, focus moved in and returned. A supplementary sheet is a `popover="manual"` its button toggles, and the page stays usable. | behaviour "before the upgrade" (each kind) |
| SH2 | The upgrade keeps that meaning. No role is added to the surface but the grabber's `slider`, the dialog keeps its name from `aria-labelledby`, and removing the element gives the markup back with nothing of its own left, an open bottom sheet and a popover that became a sheet included (no `detent` stays on the host). | behaviour "roles", "removing the element gives the markup back", "removing an open surface" |
| SH3 | The form is `presentationForm`'s on every class (AD16–AD20), with `kind` overriding the markup's. | behaviour per kind and window (`data-form`) |
| SH4 | A popover grows out of its trigger the way the menu does: the trigger's body, a drop, the panel with a small overshoot, the content focusing near size. It closes back into the trigger. It never has an arrow and stays in its trigger's segment. | unit (frames); behaviour, sampled frame by frame |
| SH5 | Below 600 dp an open popover becomes a bottom sheet grown from its source, with a scrim, still a non-modal popover: a press on the scrim closes it, and the page behind is not inert. | behaviour "a popover becomes a sheet below 600…" |
| SH6 | Detents are fractions of the window's region: `medium` is 0.5, `large` leaves 56 dp at the top (and is the tallest even where the window is too small for that), `peek` is the content's height, and detents under 24 dp apart are one under the larger name. A bottom sheet's height, density and overhang clip use the region, a centred sheet's tallest height too. The current detent is reflected in `detent`, and the host can set it. | unit `sheetDetents`, `namedSheetDetents`, `sheetLayout` in a region; behaviour (boxes measured) |
| SH7 | The inset shrinks as the sheet rises: 12 dp up to 30 %, 6 dp at 55 %, flush from 90 %. The radius is 32 inset and 28 flush. The density follows the height from the bottom: glass up to 25 %, about 0.44 at medium (55 %), opaque from 90 % (U t = 392–411 s); a surface over a scrim (centred sheet, dialog, alert, a popover as a sheet) is at least 0.6 dense; a floating sheet stays clear of the bottom safe area. | unit `sheetInset`, `sheetOpacity`, `sheetLayout`; behaviour (boxes and density at each detent, the stubbed safe-area probe); snapshots |
| SH8 | The grabber shows whenever there is more than one detent or a swipe closes the sheet. It is a 32 × 4 dp line in a 44 dp hit area. With more than one detent it is a `role="slider"` with `aria-valuetext` naming the detent (`detent-labels` words, English names as the fallback); the arrow keys and a tap change the detent. With one it is `aria-hidden`, not focusable and not a slider, and the swipe, Escape and the close button still close the sheet. | behaviour "the grabber…", "the grabber with one detent or a spoken one"; unit `parseDetentLabels` |
| SH9 | While dragged, the sheet follows the finger with no spring and meets resistance past the largest detent. On release it springs to the detent position and velocity choose (56 dp, 125 dp/s), in about 0.4 s with at most 2 % overshoot. Below the lowest detent it closes, unless `persistent` is set. | unit `sheetDrag`; behaviour "the sheet follows the finger…", "release…", "persistent…" |
| SH10 | The content scrolls first: only from its top does a downward drag move the sheet, and its scroller has `overscroll-behavior: contain`. A touch is the scroller's under the finger, not only the surface's; a press on a control in the top strip does not drag; a cancelled drag settles on the nearest detent and never closes; losing the pointer capture ends the drag. | unit `cancelSheetDrag`; behaviour "scroll before drag", "dragging details" |
| SH11 | A sheet with a trigger grows straight out of the trigger's body (no drop) into its box and runs back into it. Without a trigger, a bottom sheet rises from the bottom edge and a centred one comes in from 96 % scale. While the surface is out its trigger draws no lens, body or rim. | unit (frames); behaviour, sampled frame by frame |
| SH12 | A class change keeps the surface open and reshapes it on springs: popover ↔ sheet at 600, bottom ↔ side at 840, side sheet ↔ third pane at 1600, sheet ↔ full screen on a compact height. The content, its scroll, the focus, the selection and the detent survive, and the detent comes back after a stay in full screen. | behaviour "an open sheet changes form…" (widths measured, state checked) |
| SH13 | The side sheet is 360 dp wide (280–400, at most a third of the window), inset 8 dp with radius 24, glass, and publishes `--vire-sheet-inset-end` on its shell (the widest of the side sheets open there, the shell's own value back when the last closes) and fires a bubbling `vire-sheet-inset` on it. From 1600 dp the third pane is opaque and not glass (decision 3). | behaviour (boxes, inset on the shell, two side sheets in one shell, the event); snapshots |
| SH14 | Centred sheets and basic dialogs are `min(560, window − 48)` wide, alerts `min(320, window − 48)`. They are as tall as their content up to the window minus 48, and taller content scrolls inside. Full-screen forms are opaque and flush. | unit; behaviour (boxes) |
| SH15 | The scrim dims at 32 % under a modal surface and under a popover's sheet form. A press on it closes a bottom sheet or a popover, never a centred sheet, a dialog, an alert or a `persistent` surface. The background is never scaled or moved. | behaviour "the scrim…" |
| SH16 | A field focused in a bottom sheet with a shrunken visual viewport takes the sheet to its largest detent with its bottom above the keyboard. The sheet goes back when the keyboard leaves, unless the person moved it. | behaviour (stubbed visual viewport) |
| SH17 | Every close runs the growth back first. A popover's Escape and outside press, a dialog's `cancel`, `command="close"` and a submit by `method="dialog"` or a `formmethod="dialog"` submitter, a drag past the lowest detent and a scrim press all leave the top layer only after the retraction, and focus returns to the trigger. A dialog the element has not picked up closes natively; a modal dialog opened from inside a popover keeps Escape; `data-kind` follows `kind`; the click after a press on a popover's scrim is the only one held. | behaviour "closing retraces the growth…", "the surface takes over closing only when it runs the surface", "the click after a press on a popover's scrim" |
| SH18 | Reduced motion lands opening, closing and every change of form in one frame. Reduced transparency and increased contrast make every form opaque and readable with the same geometry. Glass off works everywhere. | behaviour (modes); snapshots |
| SH19 | One glass surface per open surface: the trigger has handed its body over, and the third pane and full-screen forms attach no glass. | behaviour (lenses counted, a recording stand-in for `vireglass/dom`) |
| SH20 | The lab shows every kind and form (popover, popover as sheet, bottom sheet at each detent, side sheet, third pane, centred sheet, full screen, dialog, alert) on two backdrops with glass on and off, and the adaptive stage draws the real `<vire-popover>` and `<vire-sheet>` opened from its own triggers, in a window marked `data-vire-shell`, and clears a side sheet by the inset the element publishes. | snapshots `sheet-*`, `adaptive-*`; behaviour "the real surfaces on the stage" |
| SH21 | Text is legible on every surface: the title and two labels of every form (popover, popover as a sheet, bottom sheet at peek, medium and large, side sheet, third pane, centred sheet, full screen, dialog, alert) on the light and the photo backdrops, glass on and off, reach 4.5:1 against the median of the pixels around them in a screenshot. The ink is the polarity `surfaceInk` picks for the body as it is drawn, and the text's computed colour is the kit's near-black or near-white for the `data-ink` it carries; over a dark backdrop with dark and with light cards under a thin glass surface (the anchored popover, a peek bottom sheet) it picks the polarity that reads. A canary that puts the old mixing of the backdrop's ink back must fail the gate. | unit `surfaceInk`; behaviour "text on every surface" (with its canary), "the ink follows what is under a thin surface" |
| SH22 | A surface that changes size after it is out (a `<details>` opened, an element shown) is measured again. The window is read when it changes, not on every scroll. A popover takes focus in on open, with and without motion. | behaviour "a surface that grows after it is measured", "a popover takes focus in", "reduced motion…" |

Side-by-side: the detents at U 6:12–6:35 (t = 392–411 s) against the gallery's bottom sheet, and the action sheet at
D 6:54–7:10 against the popover's growth.

## Toolbar

Neighbours merge through a neck and the joined body contracts to the item that stays; glyphs defocus, never slide
(M 4:46–4:53, 15 fps). Overflow goes into "…", which opens a menu of the same actions (B 11:40, 5:56). Behaviour tests
are in `tests/lab/toolbar-behavior.spec.ts`.

| # | Criterion | Check |
|---|---|---|
| TB1 | It works before the kit: groups of buttons that wrap, every button its own Tab stop, nothing hidden and nothing scrolled, no `role="toolbar"`. | behaviour "before the upgrade" |
| TB2 | The upgrade makes it the APG toolbar. It has `role="toolbar"` with the author's label and `aria-orientation`, one Tab stop with a roving tabindex, the arrows along its axis, and Home and End; disabled items are passed over. Removing the element gives the markup back. | behaviour "roles and keys", "removing the element gives the markup back" |
| TB3 | What shows is `toolbarLayout`'s at the element's own width (height in the strip) and tier, at every width from 0 to the widest (AD28). | behaviour (a sweep of widths, the visible items compared with the model's) |
| TB4 | The placement is `toolbarPlacement`'s (AD29): floating 8 dp above the navigation on the bottom edge, at the pane's top above that, and a trailing vertical strip on a compact height with its text items in a horizontal row at the foot. | behaviour per edge (boxes, `data-edge`, `data-orientation`) |
| TB5 | A lens for each capsule (`vireglass` draws a body's `shapes` only inside its box), one lens over a set that is joining, all handed the one backdrop, and none on a control, so never glass on glass. | behaviour (lenses counted and what each is handed, a recording stand-in) |
| TB6 | Merging closes the gap between neighbours through a neck: the shapes approach with a smoothing above 0 and become one capsule, with no frame where a capsule jumps. Splitting runs it back (M 4:46–4:53). | unit (the merge frames); behaviour, sampled frame by frame, canary "a toolbar that swaps its stage in one frame fails it" |
| TB7 | Overflow contracts the leaving item's slot into "…" with its glyph defocusing. "…" grows out of the trailing end the first time and goes back into it when nothing overflows. | unit; behaviour, sampled |
| TB8 | A whole stage change takes about 0.35–0.4 s on the growth's springs. A threshold has 8 dp of hysteresis, and a width held just across a threshold does not toggle the stage. Under reduced motion it lands in one frame. | unit (timing, hysteresis); behaviour "reduced motion…" |
| TB9 | Glyphs never jump: through a stage change a glyph that stays in sight moves continuously and at most by the gaps that close, never past a neighbour, and the others defocus in or out. | unit (item boxes per frame); behaviour (glyph boxes sampled) |
| TB10 | A change of place (bottom ↔ top ↔ strip) dematerialises the old form and materialises the new one and lays the new one out for its own container. The capsules never fade by opacity: each frame hands every lens its presence (`setAppear` writes the filter and bakes nothing), and it lands exact. Without glass a capsule has no lens and fades by opacity. | behaviour (capsule opacity and lens presence sampled; boxes); MO1 with the presence changing on every frame, and a canary for a core that bakes for it |
| TB11 | "…" is a menu button (`aria-haspopup="menu"`, `aria-expanded`, named) that opens a `<vire-menu>` grown from it. Its rows show an icon and a label, the item's `aria-label` or text, in toolbar order. | behaviour "the overflow menu…" |
| TB12 | Choosing a row clicks the original button exactly once. A row for an item that opens a menu, a popover or a sheet opens that surface grown from "…". | behaviour "a row clicks…", "a row opens its surface from …" |
| TB13 | Badged items and the main action never overflow, at any width. "…" has no badge. | unit (AD28 rules); behaviour |
| TB14 | An open surface whose trigger goes into "…" runs back into "…" and closes, and focus moves to "…". One whose trigger only merges stays open on the trigger's new box. One whose trigger is removed closes, with focus on the neighbouring item (AD21). | behaviour (each case, for `<vire-menu>`, `<vire-popover>` and `<vire-sheet>`) |
| TB15 | A focused item that goes into "…" hands focus to "…", and the roving tabindex covers only what is in sight. | behaviour |
| TB16 | Hit areas: every item meets 44 dp wherever any coarse input is present (AD2). | behaviour (stubbed media queries) |
| TB17 | With glass off, under reduced transparency and under increased contrast the geometry is the same and the groups stay apart by their gap. | behaviour (modes); snapshots |
| TB18 | The lab shows the toolbar separate, merged and overflowing, in the strip, on two backdrops with glass on and off, and the stage draws the real toolbar in place of its outline. | snapshots `toolbar-*`, `adaptive-*` |

Side-by-side: the merge at M 4:46–4:53 (15 fps) against the gallery's toolbar narrowing; the strip and its overflow
menu at B 5:56 and 11:40 against `preset=phone-landscape`.

## Scroll edge and legibility

Content that scrolls under a floating bar goes out of focus toward the edge and dissolves into the background; over dark
glass it takes a subtle dimming, and pinned content gets a flat band (M 8:52–9:41; D 11:32–12:12, "they don't block or
darken like overlays"). It is the screen's job, not the material's, so the glass has to see the content already dissolved:
the effect sits behind it in the stack. The core paints it (`attachScrollEdge`); the kit places it. Behaviour tests are in
`tests/lab/scroll-edge-behavior.spec.ts` (SE) and `tests/lab/legibility-behavior.spec.ts` (LG).

| # | Criterion | Check |
|---|---|---|
| SE1 | The edge is on the navigation in its bar form at its scroller's bottom, on the toolbar at the top or bottom edge it stands on, and on the top strip of a sheet or a popover over its own content. The rail, the sidebar and the trailing strip have none, nor has a toolbar that stands clear of the scroller's box. The toolbar takes `scroller` as an id or a property, as the navigation does, and looks an id up again whenever its markup is touched, so a scroller that went and came back or was replaced is followed. | behaviour "the bar form puts one edge under the body…", "the toolbar has one at the edge it stands on…", "a toolbar that stands clear…", "the rail and the sidebar have none", "the toolbar takes the scroller as a property…", "the toolbar finds a scroller named by id…", "a sheet", "a popover has one too…" |
| SE2 | The edge is made by the atom: `aria-hidden`, `pointer-events: none`, before the bodies it sits under (the navigation's first child, the toolbar's first child; a sheet's a sticky child after the grabber, which paints over it), with no `z-index` on it or the bodies and no backdrop root between it and the page (a sheet's: between it and its surface, the root it blurs inside). Checked on the navigation bar, the toolbar on both edges and a sheet, with a hit test shown to find an edge that takes the pointer and an order check shown to fail for an edge that comes last. | behaviour "under the glass, and out of the way" (four cases), "a sheet" |
| SE3 | It lies over the scroller's visible width, from the scroller's edge to the bar's lip (the accessory above a navigation bar included, and taking the accessory away takes its depth back) plus `scrollEdgeReachDp` of the bar's height; it follows a resize of the window, the navigation becoming a rail and back, and a toolbar's placement, and takes no room in a sheet's content. A sync that changes nothing reads no geometry. | behaviour (boxes against the scroller, "the edge follows a resize…", "an accessory above the bar…", "a pass that changes nothing reads no geometry", the placement changed, the content's `scrollHeight` with and without it) |
| SE4 | Its style is the core's, by the glass's ink: light ink (dark glass) dims, dark ink dissolves, `scroll-edge="hard"` is a flat band with no ramp, on the navigation bar, the toolbar and a sheet; the navigation's edge follows the glass when its ink flips. It is nothing at the top of the scroller, partway short of `SCROLL_EDGE_ENGAGE_DP` (24 dp) of content under the bar and full from 24 dp, on the navigation bar, both toolbar edges and a sheet; the document works as a scroller. | behaviour "light ink dissolves, dark glass gets a dimming…", "the toolbar and a sheet take the same three styles", "the navigation's edge follows the glass when its ink flips", "a bar at the top of the scroller…", the four "none with nothing under it…" cases, "the page is a scroller too" |
| SE5 | `scroll-edge` is absent for on, `off` or `hard`, live, on the navigation, the toolbar and a sheet or popover. With glass off there is none. Reduced transparency and increased contrast keep the glass and the edge on the navigation and the toolbar, and the edge is drawn: laid out, visible, not transparent, with a size. Under forced colours the glass is replaced and the edge is not drawn (`display: none`). | behaviour "the attribute turns it off and back on…", "the toolbar takes the attribute too…", "forced colours replace the glass…", "a sheet", "a popover has one too…" |
| SE6 | In a screenshot the content under the bar is out of focus, not just styled: with the glass taken away the lines under a navigation bar keep under three tenths of their sharpness measured without the edge, and through the glass, with the ink taken away, under six tenths (the frost of vireglass 3.4.0 already blurs the lines without the edge, so the ratio is higher than it was; the reference's zone measures a tenth, M 9:12). Under a toolbar's capsule, which is 32 dp and so holds less of the ramp, they keep under 0.45 with the glass away and under 0.7 through it. A ramp that runs the wrong way fails it on the navigation bar. | behaviour "the content under the bar is out of focus in the screenshot" (with its canary) |
| SE7 | A scroll reads no rect and no computed style: the edge is written from the scroll position alone (the core reads the scroller's `scrollHeight` and `clientHeight` on each scroll), and its geometry is read on a resize or a change. | behaviour "scrolling reads no rect…" (twenty scrolls; it also asserts that the core reads `scrollHeight`) with its canary "the counter sees what it is for" (a resize reads rects) |
| SE8 | The dissolve, the dimming and the flat band, the toolbar's two edges, the bar with glass off and a sheet's top strip are in the visual set. | snapshots `scroll-edge-*` (`scroll-edge-visual.spec.ts`) |
| LG1 | Every glass atom is legible over body text and a photo: the navigation bar, rail and sidebar, the toolbar on the bottom and the top, the menu, the popover, the button and the icon button, each over a scroller of body text scrolled under it, on the text page and the photo, glass on and off. Each scene must draw its expected number of labels and glyphs. The text reaches 4.5:1 and the glyphs 3:1 against what is behind them, read per pixel from a screenshot in which only the ink is hidden (the text fill and shadow, the glyph fill and stroke; `color` is left alone, so a tint or border painted with `currentColor` stays), by the median and by the tenth hardest on the ink (a line of text under a label). The ink is the painted colour: its alpha and the opacity of its element up to the atom count. | behaviour "every glass atom stays legible over body text and a photo" |
| LG2 | The gate can fail. The scroll edge still lifts the text's hardest tenth: the navigation bar's by 1.0 on the text page (8.4 to 9.4) and 0.8 on the photo (4.5 to 5.3), a toolbar's on the photo by 0.5 to 0.6 (4.8 to 5.3 on the top, 4.5 to 5.0 on the bottom). Since vireglass 3.4.0 frosts the control material (roughness 0.18) the bars no longer fall under 4.5:1 without the edge, so the edge is held by its lift and no longer by a failing reading. An ink forced to the page's fails a toolbar's glyphs. | behaviour "the gate can fail" |
| LG3 | The atoms that are a bar over the edge of a scroller (the navigation bar, the toolbar on the top and the bottom, a sheet's top strip) have a scroll edge (SE1); every other atom over scrolling content (the rail, the sidebar, the menu, the popover's body, the button, the icon button) is held by LG1 alone, and a sheet's text also by SH21. | behaviour SE1 and LG1 |
| LG4 | The rail and a button floating over body text pass with glass on, since vireglass 3.4.0 (roughness 0.18 of the control material, blur σ 2.16 pt, where 0.035 rendered none). The text's hardest tenth: the rail 8.3 on the text page and 5.2 on the photo (was 4.0 and 3.1), the button 10.9 and 6.5 (was 4.0 and 3.1); the icon button's glyphs 10.6 and 6.5 (were 4.0 and 3.1 against 3:1). They have no scroll edge and the kit adds no tint or density: the frost is the core's. | behaviour (LG1) |

Side-by-side: the zone at M 9:12–9:41 and D 11:32–12:12 against `?view=legibility&lg=nav-bar&backdrop=text`.

## Motion

A glass element that changes shape over frames must cost no more per frame than the same element without glass. The core
(vireglass 3.1.1) holds a lens's probe and baked maps while it is in interim and ends an interim that hears nothing for 2 s; the kit puts every moving lens in interim when
its element starts to move and lands it once the page has been still, one surface at a time. Two gates measure it, over one
list of transitions (`tests/lab/transitions.ts`: navigation morph both ways, drag, minimising, expanding and the accessory's
reshape; menu, popover, sheet and popover-as-sheet growth and retraction; detent drag; a popover changing form; toolbar
merge, overflow and change of place). Adding an element's transition means adding it there.

| # | Criterion | Check |
|---|---|---|
| MO1 | On no frame of a transition does the core probe the backdrop, bake a full map or swap a filter (a surface the transition creates has its first bake and only that, and a transition states how many lenses it creates: more fails). | behaviour `motion-behavior.spec.ts`, per transition, with the backdrop handed over and without |
| MO2 | A transition lands once: at most one probe and two full bakes (displacement and spectral) per surface, none of them on a frame of the motion; with the backdrop handed over there is no probe at all. Every lens that entered interim has left it by the end of the recording, and a transition that reshapes a surface bakes when it lands. | behaviour `motion-behavior.spec.ts` |
| MO3 | The gate can fail: a surface that bypasses interim (navigation body, lens and accessory, menu, popover, sheet, toolbar capsule), one whose landing never fires, and a lens attached again on every frame each break MO1 or MO2. | behaviour canaries in `motion-behavior.spec.ts` (`window.__labNoInterim`, `window.__labNoLand`, `window.__labAttachGlass`, lab only) |
| MO4 | In a headed Chromium with the GPU, with glass on, no frame of a transition is longer than 33 ms unless the trace of its replay shows the time was not the page's (the main thread busy for less than a vsync in it, no GPU program compiled in it, and its missing time in the GPU process waiting in `Present` while that process was quiet), no main-thread task in it is longer than a vsync (16.7 ms), and no GPU program is compiled in a measured replay. The frames are timed from the first active one to 400 ms past the last, so the deferred landing and its full bakes are in the window. The run refuses software rendering (SwiftShader, llvmpipe, the Windows basic render driver and WARP), replays each transition three times to warm up and then three times, each after an idle control of the same length in the same page and under a trace (docs/design.md, "The frame gate"). Six canaries (`VIREUIKIT_PERF_CANARY`: 40 ms on a fixed frame, 40 ms on a seeded random frame of one replay, 40 ms from a script that is not the kit's, a 20 ms task after the frame, one expensive shader drawn once, and an unseen WebGL program linked) each fail it by their own rule, which `npm run check:lab:perf:canaries` checks. Three warm-ups because Playwright starts from an empty profile and the first two replays still compile shader programs in the GPU process, which a real profile keeps; the cold first replay is reported, not judged (first use on an empty profile: menu growth 333 ms, navigation bar to rail 133 ms on an AMD Vega 8). | local `npm run check:lab:perf` (`perf.spec.ts`): a table of frames, max and stalled replays, glass on and off, the idle controls, the counted and excused stalls, the cold replay, the headroom (main thread and GPU process per frame) and the longest main-thread task, and every stall, long task and compile with its frame, its phase and the rule that decided it |
| MO5 | While moving, what would rebuild a map on every frame is held back or coarsened (a navigation body's second shape, a surface's morph on a coarse grid; presence is not one of them, it is written on every frame); the final frame is exact. | unit (`moveGlass` applies the exact frame when the motion stops, before the interim ends); behaviour (toolbar and navigation-lens presence, navigation second shape); "the landing frame is exact": once landed, the navigation's and the toolbar's lenses hold the size of their element and what a cold render of the end state gives them; the forced states in the snapshots stay exact |
| MO6 | The visual set holds mid-motion frames: a navigation morph, a popover and a sheet growing, a toolbar merge at about 0.25, 0.5 and 0.75, and the drag lens held at three places on light and photo. | snapshots `motion-*` (`motion-visual.spec.ts`) |
| MO7 | Before a release the motion is looked at at speed in Chrome or Yandex Browser on a machine with a GPU, beside the reference; what is seen goes into issues. | process (`docs/design.md`, "Acceptance of an atom") |
| MO8 | A drag or press held still keeps its lens in interim: the navigation and the sheet send `setInterim(true)` once a second for the life of the gesture, so nothing is probed or baked while it is held, and a surface that never lands still falls back on the core's 2 s net. | behaviour "a gesture held still" (2.5 s, navigation lens and sheet, only the heartbeat reaching the core) and its canary with the heartbeat silenced (`window.__labHear`, lab only) |

## What is not covered

- Switch, slider, segmented control, chip, field; the Android target (`src/native/` does not exist yet).
- The adaptive patterns themselves: the toolbar and the supporting pane are outlines on the stage, placed by the model;
  their elements come next (`docs/design.md`, "Order"). The navigation, the popover and the sheet are the real
  elements; only they morph on the stage, and panes move to their new boxes at once.
- A forced `minimized` state freezes the navigation's accessory where it was, so the stage's `barmin` and "bar
  minimised" leave it above the bar; scrolling the list minimises it for real.
- A surface whose anchor goes into overflow retracts and closes (AD21, TB14) for a trigger in a `<vire-toolbar>`; the
  stage's triggers sit in its own row, so no stage test removes one.
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
- The sheet's drag from the content follows the scroller the touch began in and the surface, not every nested scroller's
  position; `touch-action` is set from the surface's own scroll. A real on-screen keyboard is stubbed through the visual
  viewport; the bottom safe area is not read for the sheet.
- The side sheet and the third pane sit at the right edge of the window; right-to-left layout is not modelled.
- A host that calls `showModal()` itself, with no trigger, cannot have the backdrop read (the page is inert); it sets
  `sample`.
- The scroll edge is the core's cross-fade of a blur and the sharp content, so up to three tenths of the lines' sharpness is
  left under a bar against the reference's tenth (SE6), and more under a toolbar's 32 dp capsule. A sheet's edge is a strip over
  the grabber, and its text is gated by SH21 as well as LG1. A host that puts a filter, an opacity, a mask or a clip-path
  between the edge and the page makes a backdrop root, and the glass then sees the content sharp; the lab checks its own
  ancestors only. The toolbar and the navigation look an id-named scroller up again when their own markup is touched, not when
  it appears elsewhere in the document on its own.
- Snapshots: Windows baselines only, run locally, not in CI.

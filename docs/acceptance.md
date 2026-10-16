# Acceptance: button and icon button

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

How a criterion is checked:

- **unit** — a test in `src/__tests__/`;
- **behaviour** — a Playwright test in `tests/lab/behavior.spec.ts` (`npm run check:lab`, runs in CI);
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
| Hit area | 44 dp on a coarse pointer for every tier, 24 dp on a fine one | HIG; W 2.5.8. The body keeps its size; the hit area reaches past it. The Android client raises the finger floor to 48. |
| Press growth | 18 % icon button, 6 % button | **Chosen** from M 3:51–3:52: the lifted icon button visibly grows by about a fifth, and S says the lift exists because the finger covers a small target, so the button, which sinks, grows less. |

Checked by `sizes.test.ts` (floors, monotonic tiers, radius rule, nested radius, hit slop) and the `size` and
`hit area` tests in `behavior.spec.ts` (rendered boxes are 44 and 24, a capsule's computed radius is half its
height, and under touch emulation a tap `slop − 1` dp outside a `small` or `medium` body clicks it while a point
beyond the slop does not).

## Button

A button is an action: nothing grows out of it, and it sinks under press rather than lifting.

| # | Criterion | Check |
|---|---|---|
| B1 | Pressing changes the glass itself (denser, thicker, clearer), not a highlight on top (H: active is a state of the medium). | unit (the pressed state feeds `atomMaterial`); side-by-side M 3:52 |
| B2 | A press grows the body slightly, and the response is visible while the finger is down (M 3:51–3:52; S). | behaviour "the labeled button grows by about six percent" (scale between 1.055 and 1.07 while held) |
| B3 | The pressed body turns milkier and the label goes out of focus under the finger (M 3:52). | side-by-side M 3:52; snapshots of the pressed state on every backdrop |
| B4 | A button sinks, it does not lift (`atomLift('button') = 0`); it never becomes an enlarged lens. | unit |
| B5 | A button does not grow into anything. `setMorph` exists on both elements as a hook for a host, but the button never calls it and nothing opens out of it. | unit (`pressResponse` only grows the body); `setMorph` itself is not tested (step 2) |
| B6 | The press is cancelled when the pointer leaves, and releasing outside does not activate. | unit; behaviour "the pointer leaving cancels the press" |
| B7 | A release outside never swallows a later click: a keyboard or scripted click, and a real click, still fire. | behaviour "after a release outside…", "a release outside followed by a real click…" |
| B8 | Hover exists only with a cursor; keyboard focus draws a ring on any device (W 2.4.7), a click does not. A key press does not stay held when focus moves away. | unit; behaviour "hover comes with the cursor", "keyboard focus shows the ring…", "a key shows the focus ring even though the pointer is coarse", "a key press does not stick…" |
| B9 | Disabled stays glass but stops asserting itself: lower presence, no response, cannot be activated. | unit; behaviour "a disabled control cannot be activated"; snapshot of the disabled state |
| B10 | It works before the glass: the native button clicks, submits its form, is named and focusable with no element defined; a button that already has keyboard focus shows the ring as it upgrades. | behaviour "before the upgrade" |
| B11 | Upgrading while the page is still being parsed adopts the single native button; none is synthesized. | behaviour "upgrade while the page is parsed" (elements defined by a script before the markup) |
| B12 | Glass is opt-in: with no `glass` attribute there is no lens, and the plain control is complete (visible body, clickable, announced by role and name). | behaviour "glass is opt-in…", "glass off leaves a complete, clickable, named control"; `*-glass-off` snapshots |
| B13 | Keyboard: Enter and Space activate it; it is a `button` with a name. | behaviour "both atoms are buttons with a name, and activate by Enter and Space" |
| B14 | A click goes through the glass: the lens captures the pointer, and the native click still fires and submits forms. | behaviour "a click still submits the form it sits in, through the glass" |
| B15 | Glass belongs to the navigation layer only (hence opt-in, B12); no glass on glass; no solid fill instead of tint; no tint on every control; Regular and Clear are not mixed on neighbours (M 13:04, 13:24, 17:03, 17:21). | by construction: opt-in attribute, one material (`VIREGLASS_CONTROL_MATERIAL`), no accent. Not gated. |
| B16 | Reduced transparency removes the lens and leaves an opaque, complete control (B 10:36; M 18:22). | unit; behaviour "reduced transparency drops the lens…"; snapshot `button-busy-reduce-transparency` |
| B17 | Increased contrast: the body goes near black or white and gets a contrasting border (M 18:29). | unit; behaviour "increased contrast adds a border" (glass off); snapshot `button-busy-increase-contrast` (glass on) |
| B18 | Reduced motion: springs are instant, the press response itself stays (M 18:35). | unit; behaviour "reduced motion makes the press instant" against "the same press without it is still moving one frame in" |
| B19 | The system settings are followed live, and a setting made on the page beats them. | behaviour "the system setting is followed…" (reduced motion only), "a setting made on the page changes live elements" |
| B20 | Appearance goes by modulating the lens, never by fading the element (M 2:55). | the element never animates opacity; the touch-only variant uses `setAppear`. Not gated. |
| B21 | The hit area meets the target floor on a coarse pointer without changing layout, and a tap in it is exactly one click, seen once on the host and once on the button. | behaviour "hit area on a coarse pointer" (including "a tap in the hit area is exactly one click…"), "hit area on a fine pointer" |
| B22 | The element cleans up: removing it removes its lens and its filter; reconnecting upgrades again. | behaviour "removing the element removes its lens and its filter", "connecting again…" |
| B23 | Edge light, adaptive shadow, dispersion, backdrop blur at the rim: the material's, not the kit's. | owned by `vireglass`; visible in the snapshots, not asserted here |
| B24 | If the lens cannot be loaded or attached, the control falls back to the plain surface (frosted under reduced transparency), stays clickable, raises no unhandled error, and the next change retries the attach. | behaviour "a lens that fails to attach" (an aborted module request; an `attachGlass` that throws, counting the retries) |
| B25 | Under forced colours the text keeps the system colour, undimmed, and the own tints and blur are dropped (W 1.4.11). | behaviour "forced colours" |

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
| I7 | The growth hook exists: `setMorph` hands a merge shape to the lens. | not tested; the menu is step 2 |
| I8 | Cancel on leave, release-outside, hover, disabled, glass opt-in and the three accessibility modes behave as for the button. | the same behaviour tests, run against both elements |

## What is not covered

- Menu, switch, slider, segmented control, chip, field; the Android target (`src/native/` does not exist yet).
- `accent` tinting for the one primary action: nothing in the kit sets it.
- `glass="touch"` (glass only under the finger): wired through `vireglass`'s interactive variant, not tested.
- `setMorph`: no test until the menu uses it.
- System `prefers-contrast` and `prefers-reduced-transparency`: the lab only emulates reduced motion, so those two
  modes are tested through the programmatic override.
- Real finger gestures: touch is emulated (tap, coarse pointer), and the finger glow of B1/I4 is `vireglass`'s.
- The press timing: stills are compared, not the motion curve.
- A retry after a module that failed to load: browsers cache a failed dynamic import, so the retry is attempted but
  may fail again without a new request; only a throwing `attachGlass` is observed retrying.
- Forced colours: the colour of the text is asserted, not how the control looks.
- Snapshots: Windows baselines only, run locally, not in CI.

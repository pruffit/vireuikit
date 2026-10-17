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
| B21 | The hit area meets the target floor on a coarse pointer without changing layout, and a tap in it is exactly one click, seen once on the host and once on the button. | behaviour "hit area on a coarse pointer" (including "a tap in the hit area is exactly one click…"), "hit area on a fine pointer" |
| B22 | The element cleans up: removing it removes its lens and its filter; reconnecting upgrades again. | behaviour "removing the element removes its lens and its filter", "connecting again…" |
| B23 | Edge light and the rim's strength, adaptive shadow, dispersion, backdrop blur at the rim: the material's, not the kit's. | owned by `vireglass`; visible in the snapshots, not asserted here beyond B27 |
| B24 | If the lens cannot be loaded or attached, the control falls back to the plain surface (frosted under reduced transparency), stays clickable, raises no unhandled error, and the next change retries the attach. | behaviour "a lens that fails to attach" (an aborted module request; an `attachGlass` that throws, counting the retries) |
| B25 | Under forced colours the text keeps the system colour, undimmed, and the own tints and blur are dropped (W 1.4.11). | behaviour "forced colours" |
| B26 | At rest the glass body stands off its surround and carries its colour (see "Resting body"). | behaviour "resting body and rim", canary "a clear body fails the gate"; measured |
| B27 | At rest the rim reads clearly over a bright backdrop and faintly over a dark one (see "Resting body"). The strength is the core's, which follows the surround; the kit does not scale it. | behaviour "resting body and rim", canary "a rim at full strength fails the gate" (a white line all round); measured |
| B28 | The press end of the body is the milky tint the kit already drew: alpha 0.34, 35 % white (pixel-identical to before). | unit `atomBody` |
| B29 | A host that knows its backdrop (an image, a video: the lens's probe reads declared colours only) gives it to the element as `sample`, at any time; `null` hands it back to the probe. | behaviour "a sample set on the element replaces the probe…", "a sample given before the lens attaches…" |

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
bounds did not move. The canaries are the old look: a body of nothing (ΔL 0.004) and a rim drawn white all round
(0.70 over a dark backdrop).

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

## What is not covered

- Menu, switch, slider, segmented control, chip, field; the Android target (`src/native/` does not exist yet).
- `accent` tinting for the one primary action: nothing in the kit sets it.
- `glass="touch"` (glass only under the finger): wired through `vireglass`'s interactive variant, not tested.
- `setMorph`: no test until the menu uses it.
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

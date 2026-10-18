# Changelog

## Unreleased

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

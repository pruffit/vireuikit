# Changelog

## Unreleased

The medium now reads as a real cloud chamber — a dark, mist-filled volume lit by static lights —
instead of colored smoke clouds with no visible light source.

- **Lights, as data.** `lights` (`VireUIKitMediumParams`, up to `MEDIUM_MAX_LIGHTS = 3`): static
  point sources — position, direction, cone half-angle, falloff, color, intensity — composited
  additively in linear light on top of the existing (now near-neutral by default) species mix, so a
  rig that never binds a light uniform renders bit-for-bit as before. Defaults echo the reference: a
  wide edge strip near the chamber floor plus two angled spotlights from opposite top corners, off
  the vertical/horizontal axes on purpose (an on-axis beam edge is itself axis-aligned).
- **Species become scattering strength, not hue.** `channelScatter` replaces `channelColors`' old
  role in the lit layer — colour now lives on `lights`; a caller deriving a light rig from cover art
  applies `characterOf`/`speciesFamily` (`species.ts`) to the lights' colors instead.
- **Mist grain.** A stateless, per-pixel hashed speck (`mistGrainAmount`/`mistGrainCellPx`/
  `mistGrainFallSpeed`/`mistGrainJitterPx`/`mistGrainJitterFreq`) reads as fine droplets rather than
  a smooth field — one extra pass of cheap hashing, no fourth simulated buffer — visible only where
  both lit and where there's mist to scatter.
- **Three track kinds, not two plus a filler.** `MEDIUM_TRACK_PRESETS` is now `alpha`/`electron`/
  `muon` (was `alpha`/`beta`/`natural`): `alpha` is a short, thick, round-ended ray — the playing
  source now stamps a starburst of 8–16 of these at once from the cover's position, not a lone
  track. `electron` (thin, wiggly) and `muon` (long, straight, thin) are rare calm-state background
  radiation with no source; `alpha` never appears there. Tracks carry no color of their own any more
  (the `channel`/`u_channelMask` per-track RGB tint is gone) — a track is lit the same way as the
  mist around it, plus `trackLightFloor` so one doesn't vanish just because it drifted out of a
  cone. `decay` moved from 0.06 to 1.1/s so a stamped track fades within the reference's own
  "roughly one to two seconds" instead of an ~11s half-life. Depth of field now also widens the
  NEAREST tracks slightly past the base preset (`MEDIUM_TRACK_DEPTH_WIDTH_RANGE`'s near end is 1.2,
  not 1) — a Gaussian stamp's edge softness scales with its own width, so the same knob gives "large
  and soft" for near tracks the way it already gave "thin and soft" for far ones.
- `check:medium` adds three gates, each with a canary: a light's cone reads as a visibly brighter
  luminance than the same distance outside it; the calm-state composite carries real high-frequency
  (grain) energy, not a smooth field; a stamped track's cross-section broadens and its total density
  fades within +1.5s.

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

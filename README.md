# VireUIKit

A UI kit built on top of [VireGlass](https://github.com/pruffit/vireglass)'s physically-derived
glass material: atom state and press/hover/selection behavior for controls, a capsule-to-target
growth morph, and a live GPU backdrop — a lit cloud-chamber: dark mist, static lights, and
condensation tracks — that plugs into VireGlass's WebGL2 renderer as a backdrop pass.

**Status: 0.x.** The API can still change between minor versions.

## Install

```bash
npm install vireuikit vireglass
```

`vireglass` is a peer dependency — this package draws on its material model and its WebGL2 render
pipeline rather than shipping its own.

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

## GPU backdrop: a lit chamber, not colored smoke

`createMediumBackdrop()` returns a `VireGlassBackdropPass` factory: a self-contained fluid
simulation (curl-noise vapor, condensing droplets, decaying condensation tracks) that composites
straight into the texture VireGlass's lens samples — no offscreen canvas, no readback.

The chamber itself is dark; what's visible is light scattered by mist and tracks inside a light's
reach, not the gas's own color. `lights` (`VireUIKitMediumParams`, up to `MEDIUM_MAX_LIGHTS`) are
static point sources — position, direction, cone half-angle, falloff, color, intensity — defaulting
to a wide edge strip near the chamber floor plus two angled spotlights from opposite top corners
(angled off the vertical/horizontal axes on purpose: an on-axis beam edge is itself axis-aligned).
Vapor species (`channelColors`) fold into a near-neutral ambient base by default; `channelScatter`
is how strongly each species scatters a light's color, now that hue lives on the lights rather than
the gas — a caller deriving a light rig from cover art applies `characterOf`/`speciesFamily`
(`species.ts`) to the lights' colors, not to `channelColors`. A stateless, per-pixel grain
(`mistGrainAmount`/`mistGrainCellPx`/`mistGrainFallSpeed`) reads as fine droplets rather than a
smooth field, visible only where both lit and where there's mist to scatter — no fourth simulated
buffer, one extra pass of cheap hashing.

Tracks come in three kinds (`MEDIUM_TRACK_PRESETS`): `alpha` (short, thick, round-ended — the
playing source stamps a dozen or so of these at once, radiating from the cover's position, a
starburst rather than a lone ray), `electron` (thin, wiggly) and `muon` (long, straight, thin). The
calm state schedules rare electron/muon background radiation from no source at all; `alpha` only
ever comes from a driven source. A track is lit the same way as the mist, plus `trackLightFloor` so
one already on screen doesn't vanish just because it drifted out of a cone.

```ts
import { createMediumBackdrop } from 'vireuikit/web';
import { createVireGlassRenderer } from 'vireglass/web';

const medium = createMediumBackdrop();
const renderer = createVireGlassRenderer(canvas);
renderer.resize(canvas.width, canvas.height);

let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  renderer.render({
    density: window.devicePixelRatio,
    debug: 'normal',
    pieces,
    backdrop: medium.pass({ gridWidth: 128, gridHeight: 72, dt }),
  });
  requestAnimationFrame(frame);
}
```

Turbulence and light-track emission in response to playback come from `createMediumDynamics()`,
which is platform-neutral: feed `step()` a playback state, BPM and a deterministic position, and
pass the `emissions` it returns on as `MediumFrame.emissions`.

The backdrop reads as a chamber seen from the side, not a flat field, without a second simulation:
the composite samples the same vapor/condensate grid twice, once at identity and once at a larger
scale and a fixed offset (`MEDIUM_DEFAULTS.depthFarScale`/`depthFarOffsetFrac`, the offset as a
fraction of the grid so it stays clear of the wrap at any grid size) — the far read is both slower
on screen and finer-grained, since the field's own motion maps to screen motion as `v / scale`. An
8-tap rotated ring blur on that far read (`depthFarBlurRadius`) supplies aerial perspective's
softness and lower contrast in the same pass, weighted down (`depthFarWeight`) so it never competes
with the near plane; the ring (not an axis-aligned box) keeps that blur from turning a residual
seam or resize artifact into parallel straight lines. Gravity is two separate properties: a small
downward drift on vapor's own velocity (`gravityVaporDrift`, a motion cue only — a uniform drift on
this periodic grid cannot itself accumulate density) and a compositing-only density boost near the
bottom of the frame (`gravityBottomBoost`/`gravityBottomBoostStart`, a steady-state property that
cannot affect the conserved water total) that actually produces the "denser at the bottom" reading.
Condensate settling adds a second, always-on share of the ambient curl field's own sideways push
(`condensateSettleWiggle`) so a droplet falling at a constant speed doesn't trace a dead-straight
vertical line when turbulence is otherwise low. Each emitted track also carries a `depth` (0 far …
1 near) that scales its own width and intensity, so a far track reads thinner, dimmer and finer,
while the nearest tracks read a little LARGER than the base preset, not merely full-size — a
Gaussian stamp's edge softness scales with its own width, so the same knob gives depth of field too.

The curl-noise potential itself is periodic over the simulation grid in space, the same way it
already was in time: each octave's spatial frequency is adjusted, per grid size, to the nearest
value that makes a full grid width (or height) an exact integer number of lattice cells
(`computeMediumSpatialPeriods`) — so velocity never jumps at the domain's own wrap, and the far
plane's tile boundary reads as an ordinary point in the field rather than a seam. The near plane's
vapor and condensate reads use cubic B-spline reconstruction (4 bilinear taps) instead of plain
bilinear, so the simulation grid's own cells don't read as squares at typical (coarse) grid sizes.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

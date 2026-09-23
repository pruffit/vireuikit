# VireUIKit

A UI kit built on top of [VireGlass](https://github.com/pruffit/vireglass)'s physically-derived
glass material: atom state and press/hover/selection behavior for controls, a capsule-to-target
growth morph, and a live GPU backdrop — colored vapor, condensation and light tracks — that plugs
into VireGlass's WebGL2 renderer as a backdrop pass.

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

## GPU backdrop: colored vapor and condensation

`createMediumBackdrop()` returns a `VireGlassBackdropPass` factory: a self-contained fluid
simulation (curl-noise vapor, condensing droplets, decaying light tracks) that composites straight
into the texture VireGlass's lens samples — no offscreen canvas, no readback.

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
on screen and finer-grained, since the field's own motion maps to screen motion as `v / scale`. A
cheap 4-tap blur on that far read (`depthFarBlurRadius`) supplies aerial perspective's softness and
lower contrast in the same pass, weighted down (`depthFarWeight`) so it never competes with the near
plane. Gravity is two separate properties: a small downward drift on vapor's own velocity
(`gravityVaporDrift`, a motion cue only — a uniform drift on this periodic grid cannot itself
accumulate density) and a compositing-only density boost near the bottom of the frame
(`gravityBottomBoost`/`gravityBottomBoostStart`, a steady-state property that cannot affect the
conserved water total) that actually produces the "denser at the bottom" reading.
Each emitted track also carries a `depth` (0 far … 1 near) that scales its own width and intensity,
so a track reads thinner, dimmer and softer the farther back it lives.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

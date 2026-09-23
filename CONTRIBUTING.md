# Contributing

## Setup

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

`check:glsl` drives a real Chromium, so the playwright install is not optional.

## The rule that matters most

**Every number in the medium model is calibrated.** Rates, thresholds, floors, hue spreads — they
came from measurement and from watching the simulation run, and most of them have a comment
explaining what broke when they were something else. A patch that changes a constant without a
measurement behind it will be turned down, however much better the frame looks on your screen.

If you want to move a number, bring the frame: what you rendered, at which settings, and what
changed before and after.

## Gates

All must be green before a PR is considered:

```bash
npm run typecheck
npm test
npm run check:glsl
npm run check:english
```

`check:glsl` compiles every medium shader (AGSL, transpiled through VireGlass's `toGLSL`) in a
real WebGL2 context — a syntax error in a shader string is otherwise invisible until it runs.

## Depending on VireGlass

This package builds on top of [`vireglass`](https://github.com/pruffit/vireglass)'s WebGL2
renderer and its `VireGlassBackdropPass` contract — it does not fork or reimplement the material.
If your change needs a capability the core doesn't expose yet, that's a change to propose there
first.

## What is not here

The physically-derived glass material itself lives in `vireglass`, not here. This repository is
only the kit built on top of it: atom states, morphs, and the vapor/condensate backdrop.

## Language

Code, comments, tests and documentation are in English.

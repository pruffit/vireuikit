# Contributing

## Setup

```bash
npm install
npm test
```

The package itself runs on Node 20; developing it (the lab runs on Vite 8) needs Node 20.19 or newer.

## Gates

All must be green before a PR is considered:

```bash
npm run check:english
npm run typecheck
npm test
npm run build
npm run check:package
npm run check:readme
npm run check:lab
npm run check:lab:visual   # local, Windows baselines
npm run check:lab:perf     # local, a headed Chromium with a GPU
npm run check:lab:reference # local, needs VIREUIKIT_REFERENCE_DIR (frames, never committed)
```

`check:package` packs the package, installs it into an empty project and loads every entry point
in CommonJS and ESM. `check:readme` checks that every name the documentation tells you to import
exists.

`check:lab` starts the lab and runs the Playwright behaviour tests against it (`npx playwright install chromium`
once); it runs in CI. `npm run check:lab:visual` runs the screenshot set against the committed baselines in
`tests/lab/__screenshots__/<platform>/`; the baselines are Windows renders, so it is a local gate and CI does not
run it. The comparison is strict (`docs/design.md`); refresh the baselines with
`npm run check:lab:visual:update` only when the look changes on purpose. `npm run lab`
serves the lab; set `VIREUIKIT_REFERENCE_DIR` to a local folder of reference frames to see them in its side pane.
Reference frames are third-party and are never committed.

`npm run check:lab:perf` replays every transition of `tests/lab/transitions.ts` in a headed Chromium and times its
frames with glass on and off, each replay after an idle control of the same page, under a trace; it prints a table
with the headroom of a frame and requires with glass on no frame over 33 ms that the trace does not show outside the
page, no main-thread task over a vsync, and a p90 of at most 20 ms (`docs/design.md`, "The frame gate", which also
lists its switches and canaries). It measures the installed vireglass. It starts its own lab on port 5180
(`VIREUIKIT_LAB_PORT`) with reloading off, so a save during a run does not reach the page it times, and it fails if
something already listens there. It refuses software rendering (SwiftShader and the like),
because headless and software timing hid the problem it exists for, so it runs on a machine with a GPU and a screen and
not in CI. The same list of transitions is counted in `check:lab` (`motion-behavior.spec.ts`), which runs anywhere.

## Depending on VireGlass

This package builds on top of [`vireglass`](https://github.com/pruffit/vireglass)'s material model
— it does not fork or reimplement the material. If your change needs a capability the core doesn't
expose yet, that's a change to propose there first.

## What is not here

The physically-derived glass material itself lives in `vireglass`, not here. This repository is
only the kit built on top of it: atom states and morphs.

## Language

Code, comments, tests and documentation are in English.

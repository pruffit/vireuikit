# Contributing

## Setup

```bash
npm install
npm test
```

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
```

`check:package` packs the package, installs it into an empty project and loads every entry point
in CommonJS and ESM. `check:readme` checks that every name the documentation tells you to import
exists.

`check:lab` starts the lab and runs the Playwright behaviour tests against it (`npx playwright install chromium`
once); it runs in CI. `npm run check:lab:visual` runs the screenshot set against the committed baselines in
`tests/lab/__screenshots__/<platform>/`; the baselines are Windows renders, so it is a local gate and CI does not
run it. Refresh them with `npm run check:lab:visual:update` only when the look changes on purpose. `npm run lab`
serves the lab; set `VIREUIKIT_REFERENCE_DIR` to a local folder of reference frames to see them in its side pane.
Reference frames are third-party and are never committed.

## Depending on VireGlass

This package builds on top of [`vireglass`](https://github.com/pruffit/vireglass)'s material model
— it does not fork or reimplement the material. If your change needs a capability the core doesn't
expose yet, that's a change to propose there first.

## What is not here

The physically-derived glass material itself lives in `vireglass`, not here. This repository is
only the kit built on top of it: atom states and morphs.

## Language

Code, comments, tests and documentation are in English.

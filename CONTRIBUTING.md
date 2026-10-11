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
```

`check:package` packs the package, installs it into an empty project and loads every entry point
in CommonJS and ESM. `check:readme` checks that every name the documentation tells you to import
exists.

## Depending on VireGlass

This package builds on top of [`vireglass`](https://github.com/pruffit/vireglass)'s material model
— it does not fork or reimplement the material. If your change needs a capability the core doesn't
expose yet, that's a change to propose there first.

## What is not here

The physically-derived glass material itself lives in `vireglass`, not here. This repository is
only the kit built on top of it: atom states and morphs.

## Language

Code, comments, tests and documentation are in English.

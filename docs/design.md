# VireUIKit design

How the kit is built and how an atom is accepted. Research behind it (the reference analysis and the atom
spec) lives outside this repository; this document only covers the code.

## Principles

- **The kit depends only on the glass and on research.** `vireglass` provides the material; behaviour, states,
  sizes and flows come from the reference. No application code is a source for the kit; applications adopt it.
- **One model, several targets.** Everything that must not differ between platforms (states and their meaning,
  what an atom flows into and on which event, accessibility responses, sizes in dp) is a pure model in
  `src/kit/`. Targets render it: the web first, Android after an atom matches the reference on the web.
- **An atom works before the glass.** On the web the first HTML is a working native control (button, checkbox,
  range, radio group, input). Glass is attached on top after the element upgrades, and an atom with glass off
  stays clickable, readable and announced by a screen reader.
- **Glass only in the navigation layer.** No glass inside content (cards, lists, form fields), no glass on glass,
  no solid fill instead of tint, no tint on everything, no mixing of Regular and Clear on neighbours.

## Layout

| Path | What | Published |
|---|---|---|
| `src/kit/` | Model: kinds, states, material per state (`atom.ts`), growth morph (`morph.ts`), sizes in dp (`sizes.ts`), behaviours as pure state machines (`behavior/`), accessibility modes | yes, `vireuikit` |
| `src/web/` | Custom elements (`<vire-button>`, `<vire-icon-button>`, …). Each wraps a native control passed as light DOM, upgrades it, attaches glass with `vireglass/dom` where the atom is a navigation-layer piece, and drives states from the model | yes, `vireuikit/web` |
| `src/native/` | Android target, after the web | not started; will be `vireuikit/native` |
| `lab/` | The test environment: a Vite app with a gallery per atom (every state, forced via URL), backdrops, accessibility toggles, glass on/off, an interaction sandbox and a reference viewer | no |
| `tests/lab/` | Playwright tests against the lab: behaviour (`behavior.spec.ts`) and visual snapshots (`visual.spec.ts`) | no |

Custom elements because the consumers differ: a React app (VireMusic web) and plain DOM in a shadow tree
(VireBook). A custom element works in both without a framework adapter.

## The lab

`npm run lab` serves it. Every view is addressable by URL (`?atom=button&state=pressed&backdrop=photo&glass=0`),
so a screenshot or a gate can open exactly one case. A state is forced with the `data-vire-force-state`
attribute, a development aid of the elements that the lab and the snapshots use.

- **Backdrops** are generated (gradients, a text page, a busy interface, photo-like noise), so the repository
  carries no third-party images.
- **Reference viewer** shows frames from the reference videos next to the atom. The frames are read from a
  local directory given by `VIREUIKIT_REFERENCE_DIR`; they are third-party material and are never committed.
- **Reference backdrop** (`?view=reference&ref=<id>`) puts our atom on the backdrop around a reference control, at the
  same relative size, so the two can be measured on the same pixels. `npx playwright test reference` prints the
  measurements side by side (it is skipped when the directory is not set).

## Gates

| Gate | Checks |
|---|---|
| `npm test` | the model: states, flow boundaries, sizes, accessibility responses |
| `npm run check:lab` | Playwright behaviour tests on the lab, no screenshots: roles and keyboard, state transitions, events, upgrade while parsing, glass-off degradation, accessibility modes, hit area, and the resting body and rim measured on the pixels of a render against bounds taken from the reference (`docs/acceptance.md`, "Resting body"), with canaries that must fail. Runs in CI |
| `npm run check:lab:visual` | the screenshot set: atom × state × backdrop × glass on/off against committed baselines in `tests/lab/__screenshots__/<platform>/`. Local only: the baselines are Windows renders and CI does not run it. `npm run check:lab:visual:update` rewrites them |
| existing | `check:english`, `check:package`, `check:readme`, `typecheck` (the model under `src/kit` is also checked with no DOM lib), `build` |

Visual baselines change only on purpose, in the same commit as the code that changes the look.

The comparison is strict: colour `threshold` 0.02 and `maxDiffPixelRatio` 0.0005. Playwright's default threshold of 0.2
passed a whole resting body unnoticed. Against the previous look (body alpha 0) 0.02 fails on every glass-on case, and
it is stable over repeated runs on the baselines' machine. It does not see a fifth off the body's lift (0.10 to 0.08);
that is what the numeric bounds in `check:lab` are for. `--update-snapshots` rewrites only files that fail, so delete a
baseline to force a rewrite.

## Acceptance of an atom

An atom is done when:

1. its model has unit tests;
2. the lab shows every state on every backdrop, with glass on and off;
3. Playwright covers its behaviour, keyboard and roles, degradation and accessibility toggles (`check:lab`);
4. every reference criterion for it is written in `docs/acceptance.md` with how it is checked — by a gate where
   it is measurable, by a side-by-side with the reference frame where it is visual;
5. its baselines are committed (`check:lab:visual`).

## Order

0. Foundation: `sizes.ts`, the behaviour base, the web element base with progressive enhancement and glass
   attach, the lab, `check:lab`.
1. Button and icon button: press, hover and focus where the input has them, disabled; the icon button lifts
   into the glass under the finger.
2. Menu: grows out of its icon button, closes after a choice, closing retraces the growth.
3. Switch and slider: the knob lifts into the glass while held.
4. Segmented control: breaks into parts on entering selection mode.
5. Chip and field: grow into a popover or suggestions where they open a list.

Then each accepted atom is reproduced on Android in the same model.

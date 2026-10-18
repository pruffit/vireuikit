# Handoff: the adaptive model (branch `feat/adaptive`)

State on 18.10.2026. The work stopped early because of a usage limit. Everything listed as done is committed and green.

## Done

- **Model** `src/kit/adaptive/` (pure, checked with no DOM by `tsconfig.kit.json`): `AdaptiveContext` (window in dp,
  three input layers, posture with fold and occlusion, reduced motion), `classifyWindow` (600/840/1200/1600,
  480/900), `halfOpen`, `windowSegments`, `postureFromSegments`, `segmentOf`, `surfaceRegion`, `navigationForm`,
  `bottomAccessory`, `presentationForm`, `paneLayout`, `supportingPane`, `postureSplit`, `toolbarPlacement`,
  `toolbarLayout`, `sizeTier`, `hitTarget`, `hoversWith`, `formMorph` with its springs. `Rect`/`Size` moved to
  `src/kit/geometry.ts`. Unit tests: `src/__tests__/adaptive.test.ts`, `adaptive-forms.test.ts`.
- **Atoms**: button, icon button and menu read three input layers (`src/web/environment.ts` replaces `input.ts`);
  `menuPlacement` takes the trigger's segment, `menuSurfaceFrame` holds every frame inside it. Web API:
  `setInputOverride`, `setViewportOverride`, `watchAdaptiveContext`, `systemInput`, `effectiveInput`,
  `viewportSegments`.
- **Lab** `?view=adaptive` (`lab/adaptive.ts`): presets, posture and input simulation, scenarios, real atoms, outlines.
- **Gates**: `tests/lab/input-behavior.spec.ts`, `tests/lab/adaptive-behavior.spec.ts` (with canaries),
  `tests/lab/adaptive-visual.spec.ts` with six baselines.
- **Docs**: AD1 to AD32 in `docs/acceptance.md`, the adaptive layer and the new order in `docs/design.md`, README,
  CHANGELOG (Unreleased).

Last run: `npm run check:english`, `typecheck`, `npm test` (174), `build`, `check:package`, `check:readme`, and
`npm run check:lab` (167 passed) are green. The six stage baselines passed three runs in a row.

## Remaining from the brief

- [ ] Run the full `npm run check:lab:visual` once (the existing gallery and menu baselines were not rerun after the
  input-layer change; the stage's own six were).
- [ ] Open the PR from `feat/adaptive` (the coordinator does this).

## Known issues and open questions

- A dialog with fields on a compact height stays a basic dialog from 600 dp (Material, by width only); whether it
  should go full screen like a sheet is open.
- `<vire-menu>` does not yet close when its trigger goes into overflow; the model's `formMorph` says it should
  (`anchorGone`). It belongs with the toolbar atom.
- In tabletop a list-detail keeps its panes side by side across the fold (class rules).
- Panes do not morph on the stage; only the navigation and the open surface do.
- The keyboard heuristic counts an on-screen keyboard that sends keys outside a field as a hardware one.

## Next step to resume

Run `npm run check:lab:visual` (one worker, local, Windows baselines). If it is green, the branch is ready for review;
the next atom by `docs/design.md` "Order" is navigation (bar, rail and sidebar as one body).

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
- **The form comes from the adaptive model.** What an atom or a pattern becomes on a window class, an input and a
  posture is decided once, in `src/kit/adaptive`, and every target asks it; no target keeps its own breakpoints or
  input flags. A change of form is a morph of one body, and the person's state survives it.
- **A motion draws the same frames every time it runs.** A motion counts whole frames from its first one
  (`stepMotion`), at the page's refresh period: the median of the last 16 frame intervals the kit saw (a probe of
  eight frames seeds it when the first element connects), snapped to the nearest standard rate within 5 %. The
  motion keeps the period it began with, and each frame integrates the springs over exactly that period in equal
  sub-steps of at most 1/240 s. A frame's state follows from how many frames have passed, not from the jitter of
  their times, and is even at any refresh rate; a late frame skips states and adds none, at most 50 ms at a time.
  Chromium compiles a GPU program for each blur size, texture fit and clip shape it meets, and a motion whose middle
  frames differed from run to run kept meeting new ones (and stalling on them) long after its first use.

## Layout

| Path | What | Published |
|---|---|---|
| `src/kit/` | Model: kinds, states, material per state (`atom.ts`), growth morph (`morph.ts`), the menu's keyboard, placement and surface (`menu.ts`), sizes in dp (`sizes.ts`), behaviours as pure state machines (`behavior/`), accessibility modes, the adaptive model (`adaptive/`) and boxes (`geometry.ts`) | yes, `vireuikit` |
| `src/web/` | Custom elements (`<vire-button>`, `<vire-icon-button>`, `<vire-menu>`, …). Each wraps native markup passed as light DOM, upgrades it, attaches glass with `vireglass/dom` where the atom is a navigation-layer piece, and drives states from the model. `environment.ts` collects the adaptive context (input layers, viewport segments) | yes, `vireuikit/web` |
| `src/native/` | Android target, after the web | not started; will be `vireuikit/native` |
| `lab/` | The test environment: a Vite app with a gallery per atom (every state, forced via URL), backdrops, accessibility toggles, glass on/off, an interaction sandbox, a reference viewer and the adaptive stage | no |
| `tests/lab/` | Playwright tests against the lab: behaviour (`*behavior.spec.ts`) and visual snapshots (`*visual.spec.ts`) | no |

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
  measurements side by side, our atom at rest and pressed (it is skipped when the directory is not set).
- **Image backdrops** hand the elements a backdrop sample (`sample`), because the lens's probe reads declared colours
  and cannot see an image: the photo the sample of the whole picture, the reference backdrop that of the control's
  footprint.
- **Adaptive stage** (`?view=adaptive&w=673&h=841&posture=book&input=touch`, or `preset=…`) draws a window at a size
  in dp with a resize handle, presets from a folded phone to an ultrawide desktop, a fold (posture, `fold` position,
  `band`, `occluding`) and the input layers (`touch`, `pointer`, `mixed`, `tablet-keyboard`, `keyboard`). The real atoms
  and the real `<vire-nav>` inside take their adaptive forms (the navigation covers the window frame, takes its form from
  its own box and the stage's overrides, and the panes are laid out by the insets it publishes), and the real
  `<vire-popover>` and `<vire-sheet>`: the window is marked `data-vire-shell`, a row of the stage's own triggers at its
  top (`Filters`, `Sheet`, `Modal`, outside every pane that can hide) opens them, and `app.surface` (the `surface=` URL
  parameter and the select) only asks the stage to press the right trigger or close button. The stage draws nothing of
  a surface: it reads the element's `data-form`, `data-phase` and `detent`, and a side sheet's `--vire-sheet-inset-end`
  on the row, which the panes clear. The patterns not built yet (the toolbar, the supporting pane) are labelled outlines
  placed by the model. A readout lists every decision (an open surface's form, phase, detent and what it clears among them), and scenarios sweep the width, fold and unfold, rotate and attach a keyboard, checking the
  person's state on each step. `foldaware=0` hides the fold from the atoms only, for the canary.

- **Legibility scene** (`?view=legibility&lg=<atom>&backdrop=<text|photo|dark>&glass=&scroll=&edge=`). One atom (`nav-bar`, `nav-rail`,
  `nav-sidebar`, `toolbar-bottom`, `toolbar-top`, `menu`, `popover`, `button`, `icon-button`) in a window frame, floating over a
  scroller full of body text scrolled `scroll` dp (420), with the bars given `scroller` and `edge` as their `scroll-edge`.
  `window.__lab.sample` is the backdrop the lab handed the elements and `window.__lab.probe(selector)` what the core's probe
  reads behind an element.

- **Sheet gallery and sandbox** (`?atom=sheet&form=<form>&detent=&content=&backdrop=&glass=`, `?view=sheet&w=&h=`). The gallery draws
  one open surface in a window frame (`data-vire-shell`) of the size that gives it its form: `popover` (700 wide),
  `popover-sheet`, `bottom-sheet` (390), `side-sheet` (1000), `side-pane` (1700, the third pane), `centered-sheet`,
  `full-screen`, `basic-dialog` and `alert`, with page content behind it so the scrim and the glass show. The sandbox is
  a resizable frame with a trigger for every kind, one surface opened by script, the events logged in `#log` and
  `window.__lab.sheet` (`resize`, `record`, `setViewport` with `stubvv=1`). The elements take `data-vire-force-state`: `open`,
  `open:<detent>` and `grow:<t>` (a growth frozen at `t`, 0 to 1).

## Gates

| Gate | Checks |
|---|---|
| `npm test` | the model: states, flow boundaries, sizes, accessibility responses, and the adaptive model's every class boundary and transition |
| `npm run check:lab` | Playwright behaviour tests on the lab, no screenshots: roles and keyboard, state transitions, events, upgrade while parsing, glass-off degradation, accessibility modes, hit area, the menu's growth sampled frame by frame and what it hands the lens, the resting body and rim measured on the pixels of a render against bounds taken from the reference (`docs/acceptance.md`, "Resting body"), the atoms' three input layers (a fine pointer with touch present through stubbed media queries) and a menu on a real fold (the DevTools display feature), and the adaptive stage (one navigation body through a sweep, morph continuity, state across thresholds, menus in their half), and the navigation element (a change of form sampled frame by frame and what it hands the lens, the drag, minimising, the accessory, the toggle, the shortcut, hit areas and modes), the scroll edge (where it sits, what it is made of, that the lines under a bar are out of focus in a screenshot) and the legibility of every glass atom over body text and a photo, with canaries that must fail. Runs in CI |
| `npm run check:lab:visual` | the screenshot set: atom × state × backdrop × glass on/off, the navigation's four forms and the lens frozen mid-morph, the scroll edge's dissolve, dimming and flat band, and the adaptive stage at six presets, against committed baselines in `tests/lab/__screenshots__/<platform>/`. Local only: the baselines are Windows renders and CI does not run it. `npm run check:lab:visual:update` rewrites them |
| `npm run check:lab:reference` | local only, needs the third-party frames in `VIREUIKIT_REFERENCE_DIR` (never committed): the menu parity gate on the `view=menu-reference` stage, ours against the reference at ten instants of the growth and the retraction (silhouette overlap, lightness, edge energy of the content, centroid; acceptance N29). Skips with a message without the frames |
| `npm run check:lab:perf` | local only, a headed Chromium with the GPU: the frames of every transition of `tests/lab/transitions.ts` with glass on and off beside an idle control, and the headroom of a frame (see "The frame gate") |
| `npm run check:lab:scenarios` | local only, headless in two projects (`gpu` on the machine's adapter, which judges, and `swiftshader`, the control): every presented frame of what a user does with the menu, popover, sheet, toolbar, navigation and the atoms (open, close, drag, click, hover, press, resize, scroll), at its own size and as the owner opens it, through 1.5 s after the last motion, with gates on those frames (seam, pop, hole, converge, vanish, shape, state, highlight, ghost, scrollbar) and canaries that must fail them (see "Scenario recordings") |
| existing | `check:english`, `check:package`, `check:readme`, `typecheck` (the model under `src/kit` is also checked with no DOM lib), `build` |

Visual baselines change only on purpose, in the same commit as the code that changes the look.

The comparison is strict: colour `threshold` 0.02 and `maxDiffPixelRatio` 0.0005. Playwright's default threshold of 0.2
passed a whole resting body unnoticed. Against the previous look (body alpha 0) 0.02 fails on every glass-on case, and
it is stable over repeated runs on the baselines' machine. It does not see a fifth off the body's lift (0.10 to 0.08);
that is what the numeric bounds in `check:lab` are for. `--update-snapshots` rewrites only files that fail, so delete a
baseline to force a rewrite.

### The frame gate

`check:lab:perf` (`tests/lab/perf.spec.ts`) builds the lab once (`scripts/serve-lab-build.mjs`, an unminified `vite build`
of `lab/` with the same entry points, `?view=` and `?case=` switches and vireglass as the dev server) and serves the
build on port 5180 or `VIREUIKIT_LAB_PORT`; `VIREUIKIT_LAB_STILL` keeps `/__early.js` built once. The dev server hands
the page every module as its own request, and some 150 page loads of that exhausted the socket buffers of Windows
(`net::ERR_NO_BUFFER_SPACE`); a built page is a handful of requests, and a save cannot reach the page being timed. A
request of the page that fails on the network fails its row, naming the URL and the error, and a row that threw before
it had a result is listed under "rows with no result" beside the table. It measures the kit with the vireglass installed in `node_modules`, not a branch of it.

Each transition is replayed three times to warm up (the cold first replay is printed, not judged), then three times
with glass on and once with glass off, each after an idle control: the same recorder over the same page, still, for as
long, less its first 100 ms, which are the recorder's own start. The frames are timed from the first active one to
400 ms past the last, so the deferred landing is in the window. Every replay but the cold one is traced (light
categories); the warm-ups only so that the first measured replay does not pay the trace's own start.

With glass on, a transition fails on:

- a frame over 33 ms (rule `frame`), unless its replay's trace shows the time was not the page's. The test, in this
  order, and the first that applies decides: the page's main thread busy for a vsync or more in that interval counts; a
  GPU program compiled in it counts; missing time that is not spent in the GPU process's `Present` counts; a
  `Present` wait counts when the GPU process's own main-thread work (less `Present`) exceeds 4 ms in the interval or
  either neighbour; only a `Present` wait with a quiet GPU process is excused. `Present` blocks on the GPU's
  backlog, so a wait behind work the kit queued is the kit's. The bound is read off the data: a still page costs the
  GPU process's main thread 0 ms at p90 and 3.5 ms at most per frame, the kit's motion frames 8.7 ms at p90 (Vega 8),
  and a quarter of a vsync sits between them. Every stall prints the rule that decided it and its numbers; a counted
  stall also prints the scripts of the long animation frames over it, which are a diagnosis and neither excuse nor
  judge: only frames over 50 ms are reported, and they say who ran, not whether the time was the page's;
- a GPU program compiled in a measured replay (rule `compile`): Skia's, stored by a GPU-process task, or linked by a
  context. The warm-ups compile every program the transition needs, so one in a measured replay is a variant they
  missed, which is the kit's cost and is never excused;
- a main-thread task over a vsync (16.7 ms) anywhere in the window (rule `task`), which an animation-frame gap does
  not always show: a task of 17 to 20 ms may delay the next frame by less than the bound;
- a measured replay with no trace (rule `untraced`), when tracing is on: nothing can be excused or checked on it, and
  it is not replayed again.

Headroom is printed, not judged: the busy ms per frame interval of the page's main thread and of the GPU process less
its wait in `Present` (p90/max), and the longest main-thread task. There is no bound on a p90 of the intervals, which
sit on the vsync whatever a frame costs; the popover's headroom is issue #40. A run prints every rule it broke
(`rules broken:`), so a canary can be held to its own. The table prints, per transition, glass on (stalled replays,
counted and excused stalls), the idle controls, glass off and the cold replay. A kept trace goes under the system temp
directory, never the repository.

Switches: `VIREUIKIT_PERF_KEEP=all` keeps the trace of every traced replay, not only those that broke a rule; `VIREUIKIT_PERF_TRACE=0` runs untraced (then nothing is excused and the task bound, compiles and traces are
not checked); `VIREUIKIT_PERF_OFF_REPLAYS` sets the replays with glass off (1); `VIREUIKIT_PERF_OUT=<file>` writes one JSON
line per recording; `VIREUIKIT_PERF_FRESH=browser` launches a browser for each transition; `VIREUIKIT_PERF_SEED` seeds the
random canary (20241024, printed); `VIREUIKIT_LAB_BOOT_MS` is how long a lab case may take to boot (30 000, for
`check:lab` too). The gate starts its own lab and fails at once, naming the port and how to find its owner, when
something already listens there.

`VIREUIKIT_PERF_CANARY=<kind>:<transition>[@frame]` puts a cost into the measured replays with glass on, and every kind
must fail every run by its own rule, which the run prints (`CANARY <kind>: must break "<rule>", broke [...]`).
`fixed` blocks 40 ms on that frame of each (`frame`), `random` 40 ms on a seeded random frame of one (`frame`),
`foreign` 40 ms from an init script of its own rather than the kit's (`frame`), `short` a 20 ms task started after
the frame callback, which breaks `task` and may leave the frame gap under the bound, `gpu` one expensive fragment
shader drawn once on a canvas, about 100 to 150 ms of GPU time, which must be counted as a busy GPU and not excused as
a `Present` wait (`frame`), and `compile` a WebGL program of unseen source linked in the replay (`compile`).
`npm run check:lab:perf:canaries` runs every kind on one row (`VIREUIKIT_PERF_CANARY_ROW`, "menu growth") and fails
unless each run fails by its rule. Run it after any change to the gate.

The runs behind these choices, on a Ryzen 5 3500U with Vega 8, are in issue #39.

### Scenario recordings

`check:lab:scenarios` (`tests/lab/scenarios/`) plays what a user does with an element and judges the frames the user
sees, from just before the input to 1.5 s after the last kit motion ends. The frame gate above times frames and the
visual baselines hold forced still states; neither looks at the picture during and after an interaction, which is
where the acceptance of 25.10 (issue #44) found a pop after every motion, hover that cannot be seen, items that vanish
in a drag and shapes that are square for a second. It is local (`npm run check:lab:scenarios`), and runs its own lab on
port 5180 (`VIREUIKIT_LAB_PORT`) built the way the frame gate's is.

**Two projects, both headless.** Nothing opens on the desktop and nothing takes focus.

- `gpu` renders on the machine's adapter: `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist
  --enable-gpu-rasterization`. Before its first test the run reads the GPU process (`SystemInfo.getInfo`) and fails if
  the adapter is a software one; the evidence is written to `lab-scenarios/gpu/adapter.txt`. On the Ryzen 5 3500U
  it reads `ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.21925.1001)` with
  `gpu_compositing: enabled`. This project judges.
- `swiftshader` is the software render (`Vulkan 1.3.0 (SwiftShader Device)`, `gpu_compositing: disabled_software`): the
  same pixels on every run, the control. It plays the cases at their own size only.

The GPU project plays every case twice: at its own size (the 450 × 780 window of the case), and *as the owner opens it*
(`@owner`): a 1920 × 960 viewport at DPR 1, the lab with its chrome on and no size parameter (`/?view=menu`, `nav`,
`sheet`, `toolbar`, `adaptive`; the `?view=sandbox` for the atoms), which is a maximised Chrome window on a 1920 × 1080
screen. Playwright's headless mode passes `--hide-scrollbars`; the recorder removes it, since the owner's browser shows them.

A GPU process compiles shaders in its first seconds and stalls frames while it does; one throw-away page with a filter
and a moving backdrop pays that before the first recording (`warmUp`). On an idle machine the GPU then delivers a frame
every 16 ms (a page changing on every frame gave 180 of 180 frames over 3 s at 1920 × 960, PNG, and the same on
SwiftShader); on a machine in use some frames are dropped, and uneven gaps are printed in the sheet's header. The gates
judge pixels, not cadence, and the one that looks at the frame before a motion's last tick compares it only when that
frame is a neighbour (at most 26 ms before).

**Capture.** `Page.startScreencast` as lossless PNG, every frame acknowledged at once. A frame comes with the
compositor's timestamp, which is on the page's clock (`performance.timeOrigin + now()`; the frame of a change lands 2
to 4 ms after it), so frames, inputs and motion edges share one timeline. A frame is delivered for each presented
frame that changed, so a still page gives none, and that is what "nothing changed" means here. Tracing screenshots
(`disabled-by-default-devtools.screenshot`) were measured and rejected: they are scaled to 498 px wide and compressed to
about 6 kB, and they come at roughly every second to third frame. Software rendering makes a frame slower than on a GPU,
and the GPU makes shapes and filters the way the owner sees them; the recording is a verdict on what is drawn, not on how
fast; `check:lab:perf` is the verdict on speed.

**Motion edges.** `requestMotionFrame` in `src/web/dom.ts` calls `globalThis.__vireMotion('start' | 'end')` when the
count of pending motion frames goes 0 → 1 and when, at the end of a frame's callback, it is 0 again; without a probe
that is a property read at two instants per motion. The recorder installs the probe before the page's scripts, merges
motions less than 50 ms apart, and reads the boxes of the elements a scenario names after each frame's callbacks
(`MessageChannel`; `samples.json` beside the sheet), so a frame can be judged against where its elements were.

**Regions.** A gate that looks at pixels near an element looks at each element in its own region, not at the union of
them: the seam gate takes one region per element of every key (its boxes at the motion's start and end, 20 px around)
and the union, so the pop of a 44 px trigger is not diluted by the 390 × 720 surface beside it. The trigger is tracked
through its host (`trigHost`), which stays in the layout while the surface has its body, so its place is watched
through the whole motion. A scenario that resizes a window names the layouts (`layouts`, with a mark in the act), and the
backdrop the shape gate compares with is read again in each.

**Gates**, each printing its numbers; the limits are `LIMITS` in `gates.ts`. Colour difference is CIE76 ΔE in Lab; a
pixel "changed" above ΔE 3. A still page between two frames of the same content measures 0.000 (the render is
deterministic and the PNG lossless), so there is no noise floor to hide a threshold in; on the GPU a few pixels at a
limit move from run to run, so a gate near its limit can flip (see the ledger below).

| Gate | Definition | Limit | Data behind it |
| --- | --- | --- | --- |
| seam | in the region of each element (its boxes at the motion's start and end, 20 px around) and of all of them, the frame that presents a motion's last tick and every frame after it, up to 1.5 s or the next motion, differ from the frame before by no more than the limit; and the first of them differs from the last by less than the drift limit | share of pixels changed ≤ 0.2 %, mean ΔE ≤ 0.15, drift ≤ 0.4 % | still steps 0.000; a canary that settles 0.000; pops of #44 from mean ΔE 0.08 (0.5 % changed) to 3.8 (35 %) |
| pop | the region of an element whose box is the same in two consecutive frames does not change between them by more than the limit: a body, a label or a grabber swapped in one frame, which the seam gate cannot see because it only looks after the motion's end; every frame is judged with this limit, the one that hands a place back included, and a frame after a stall of the compositor against the last frame before it, with the limit once per 20 ms it spans | mean ΔE ≤ 1.2 | a label that fades 0.2 to 0.3 per frame, one that goes at once 4.1; the menu's hand-back to its trigger 0.6 to 1.0 (a body and a label swapped in a frame, built in memory in `handover.spec.ts`: 6.0, and 3.0 after a stall); the sheet's trigger 7.1 to 7.3, the adaptive popover's 13.5 |
| hole | a trigger that is alone in its place (its surface closed, or back at its size) keeps the ink of its label: the pixels that stand out from the box's median colour by ΔE 14 or, for a glyph out of focus, the sum of how far they stand out beyond ΔE 3 are at least half of what they are at rest | ≥ 50 % | a label gone for 360 ms: 0 %; the sheet's trigger 37 %, the adaptive popover's 0 % |
| converge | the distance (mean ΔE over the region) between a frame and the picture the motion settles to falls; after it has fallen it does not rise by more than the limit, which is the picture turning back | ≤ 3 ΔE | a box that runs past its place and returns 17.3; a straight one 0.0; a navigation tap 0.9 to 1.7; a tap while the selection still moves 3.2 to 3.6 (swiftshader 2.8 to 3.5) |
| vanish | every item keeps its ink in every frame: ink is the pixels more than ΔE 14 from the median colour of the item's box, counted against the same count in the frame before the input; the real glyph or the lens's magnified copy both count | ≥ 50 % of the ink at rest | tapping and clicking every item: lowest 82 to 95 %; items that vanish in a drag: 0 to 33 % |
| shape | outside the radius of a capsule (half the short side, whatever the element declares), further than a fifth of the radius from the arc, a frame shows the backdrop (the page with the kit hidden, in the layout of that frame, or the frame before the input for an element on glass of its own); judged in frames outside the kit's motions, and with `during` also inside them, in a frame where the element's box is the size it was a frame before | ≤ 15 % of those pixels more than ΔE 6 from the reference | a resting capsule 0.8 % (its shadow); a square behind a capsule 100 %; the toolbar collapsing: 29 % on the GPU (10 frames), 16 % on SwiftShader (1 frame) |
| state | the element's box at the mark a scenario sets (hover, press, settled) differs from its box before the input in one of three ways: the mean ΔE is at least a just noticeable difference, or, over at least 1 % of the box, the 95th percentile of the changed pixels' ΔE is at least 8 (a thin rim) or their relative luminance step is at least 8 % (a small step on a dark surface) | mean ≥ 2.3, or p95 ΔE ≥ 8, or p95 relative step ≥ 0.08 | see the hover table below |
| highlight | what a state paints is the element's own shape: the box of the pixels it changes leaves the corners of a capsule on that box alone | ≤ 36 % of those corners | capsule hovers 0 %; a navigation item 0 to 32 %; the toolbar's items 42 to 60 % (a rectangle) |
| ghost | while a surface is the size of its target (± 8 px), the part of it that belongs to the open form (the grabber) looks like the settled target in its box | ≤ 5 % of the part's pixels over ΔE 3 | a clean pill 0 %, a strip left on it 100 %; the sheet 83 to 89 % |
| scrollbar | a container that scrolls inside a kit surface hides the platform's bar: `scrollbar-width: none` or a `::-webkit-scrollbar` with no display, and the gutter the bar would take at its edge is not drawn unlike the content beside it | no platform bar | the sheet's list: `scrollbar-width: thin`, a 10 px gutter, 88 % of it drawn; a canary with `none` 0 % |

**Hover over every backdrop.** The state metric first read the mean ΔE of the box only; a rim a pixel or two wide barely
moves a mean over 63 × 42 px, and a step of 4 ΔE is large on a dark surface and small on a light one. The same hover on
both projects (the numbers are within noise of each other, GPU first, then SwiftShader):

| backdrop | button mean / p95 ΔE / relative step | icon button | seen |
| --- | --- | --- | --- |
| light | 1.12 / 7.9 / 0.04 · 1.13 / 7.7 / 0.04 | 1.14 / 9.3 / 0.04 · 1.15 / 8.6 / 0.04 | the icon button by its rim; the button not |
| mid | 0.85 / 5.1 / 0.04 · 0.80 / 5.7 / 0.04 | 0.86 / 5.2 / 0.04 · 0.86 / 5.8 / 0.04 | neither |
| dark | 1.06 / 3.9 / 0.10 · 1.08 / 3.9 / 0.10 | 0.96 / 4.1 / 0.09 · 0.99 / 4.1 / 0.10 | both, by the relative step (not by ΔE) |
| busy | 1.37 / 10.5 / 0.25 · 1.42 / 11.0 / 0.26 | 1.14 / 8.3 / 0.19 · 1.17 / 8.8 / 0.20 | both |
| split | 1.56 / 7.3 / 0.21 · 1.54 / 7.8 / 0.31 | 1.50 / 7.8 / 0.21 · 1.58 / 8.1 / 0.31 | both, by the relative step |

Dark does not read weak only on SwiftShader: on both, a hover on dark moves little in ΔE (peak 4.3) and a lot in
relative terms (about 10 %, against 4 % on light), which is why the owner saw it and the ΔE mean did not. The threshold of
8 % sits between the 4 % of light and mid and the 10 % of dark; 8 ΔE at the 95th percentile is the 95th percentile of the
button's rim on busy (10.5) and on light (7.9). The toolbar's buttons hover at a mean of 3.2 to 4.4 and the navigation's
at 2.3 to 2.8, so both are seen; what the highlight gate adds is that the toolbar's is a 32 × 32 px rectangle.

**Scenarios** are in `scenarios.ts`: the menu opening, closing and opening again; the popover, the popover as a bottom
sheet and both in the adaptive stage; the sheet growing and collapsing into its trigger, dragged between detents and
scrolled; the toolbar collapsing into its button and back (at the owner's default width it is already collapsed, so that
variant expands it first), changing place, hovered button by button; the navigation with its lens dragged across every item
and back at 600 px/s (moves every 8 ms), every item tapped by mouse and by touch, a tap during a form morph, resized bar →
rail → sidebar and back, hovered item by item, and clicked as a hand clicks: each item at normal speed (a move at 800 px/s,
150 ms on the item, 90 ms down), different items 250 ms apart, the selected item, a click while the selection is still
moving, and each item with a slip of 3 to 6 px between down and up; button and icon button hover and press over the lab's
light, dark, busy and mid backdrops and across a light/dark border (`backdrop=split&split=<selector>`).
`VIREUIKIT_SCENARIOS_ONLY=<regex>` runs some scenarios; `VIREUIKIT_LAB_REUSE=1` reuses a lab already served on the port,
for work on the gates only; `--project=gpu` or `--project=swiftshader` runs one project.

**The ledger** (`known.ts`) lists, per scenario and profile (`gpu`, `gpu@owner`, `swiftshader`), the gates that fail on a
finding of #44. The table marks them as known and the run stays green; the run fails on a failure that is not listed.
A listed gate that passes is printed as possibly stale (with `VIREUIKIT_SCENARIOS_STALE=1` it fails the run), because a
gate near its limit passes on the GPU from time to time; `VIREUIKIT_SCENARIOS_STRICT=1` fails on the known ones too.
The ledger is also the record of what each project sees: an entry missing from `swiftshader` is a finding only the GPU
sees (the toolbar's shape while it moves is at 29 % there and at 16 % in software).

**Output**, in `lab-scenarios/<project>/` (git-ignored; `VIREUIKIT_SCENARIOS_OUT`): per scenario `sheet.png` (every
presented frame in a grid, labelled in ms from the input; the frame that presents a motion's last tick is blue, a frame
a gate points at is red), `sheet.html` and `frames/` (the frames as PNG), `metrics.json` (frame times and gaps, motions,
marks, each gate's numbers and per-frame series), `samples.json` (the boxes in every frame), and at the end `summary.txt`
and `summary.json`; the table is printed per project. Look at the sheets before a handoff.

**Canaries** (`canaries.ts`, `canaries.spec.ts`, run with the scenarios in both projects): a synthetic page per gate that
must fail it and the same page without the defect that must pass it: a label that arrives 400 ms after the motion; an
item erased in a drag; a square behind a capsule; a capsule that is square for the first 350 ms of its motion; a strip left
on a pill; a hover of ΔE 1.3; a rim on a dark button; a rectangle hovered inside a capsule; a label that goes in one frame;
a trigger without its label for 360 ms; a box that runs past its place and comes back; a scroll container with the
platform's bar. Run them after any change to a gate.

**What it does not see.** A gate reads the boxes of the elements a scenario names, so a defect in an element nobody tracked
is not in it. A defect that is a single wrong pixel colour in a region that moves with the motion (a spring's last tick) is
bounded by the seam's limit, not zero. Two of the owner's findings are not caught by a gate; the frames show them and
the issue records them: the navigation's tap, in which two selection indicators are on screen for about 350 ms (the old
pill fades where it was while the lens and a blue copy of the label grow on the new item, and the settled pill arrives
at about 850 ms; the picture still falls monotonically toward its settled one, which is all `converge` asks), and the
trigger of a sheet that comes back to its place full width and centred (no frame of the lab's sheet, popover or adaptive
popover at 1920 × 960 shows a body at that size; the trigger's glass does arrive late, without its label and with the
grabber on it, then swaps in one step, which `ghost`, `hole` and `pop` fail).

## The menu

The research defines the menu by two things: it is the result of growth out of its trigger, with closing as the
same growth run backwards, and it closes after a choice. How the web element gets there:

- **The first HTML is the platform's popover.** A trigger `<button popovertarget>` (bare, or inside `<vire-button>`
  or `<vire-icon-button>`) and a `popover` list of item buttons with `popovertargetaction="hide"`. Without the
  element the browser opens and closes it, a choice closes it, Escape and a press outside dismiss it, and focus comes
  back to the trigger. The markup carries no menu roles: `role="menu"` promises arrow keys, so the element adds the
  roles together with the keyboard and takes them away on disconnect.
- **After the upgrade the element shows and hides the list.** The list becomes a `manual` popover and the
  `popovertarget` attributes are lifted (and restored on disconnect), because the platform hides a popover at once and
  the growth has to run back before the list leaves the top layer. Escape, a press outside and Tab are the element's
  then; the keyboard follows the menu-button pattern (`stepMenu`).
- **One body.** The menu replaces its trigger (M 5:11 and the showcase frames: the trigger is gone while the menu is
  out). The list is the one glass surface; while the menu is out the trigger hands its body over (`setCarried` on the
  control elements: no lens, no body), so the two never stack as glass on glass, and the trigger takes the body back
  when the surface has retracted onto it and waited there a moment. Both ends of that hand-back are the same picture: the
  trigger's lens reads its backdrop once, when the menu comes out, the drop leaves the join at its trigger and brings its own
  lens in (`setAppear`) over the wait, the glyph is out of focus and faint as the drop's lens shows it and sharpens after the
  hand-back (its blur, which the platform draws as none under a pixel, ending first), and the focus ring ramps in after it,
  all on the springs' own clock so they end with the motion. Its glyphs stay in focus until the drop has formed: they are cut to the body
  as it contracts, and seen through the surface's veil, or through glass that scatters as the trigger's own does, while the surface is still the capsule.
- **One body of two shapes.** Each frame the surface's box is the growth frame's body (`menuSurfaceFrame`). While a drop
  and the capsule are joined (a bud rising out of it, a bump merging back into it) the box holds both and the surface
  is clipped to their smooth union (`unionOutline`); the lens's `setMorph` shapes only the refraction and cannot draw
  outside its element, so the popover, which takes no clip path, still hands it the second shape. The drop is bright
  white and nearly opaque through the body, lit by `glow`; it rises toward the menu's centre ahead of its swelling
  (`rise`), the content rides inside the lens magnified and out of focus (`focus`, its own spring) and clears after the
  body has its size, and the content keeps its final position while the box moves, so it is revealed rather than
  sliding in. Closing is the same path back, the body running a few dp past the trigger and settling onto it.
- **Placement is under the finger.** The menu pins to the trigger's corner that points to the nearest corner of its
  region and grows into the open space (S: the button morphs into the menu so the grip does not change). The region is
  the trigger's segment of the window, so on a folding screen the menu stays in its half, and every frame of the growth,
  the overshoot included, is held inside it. The `corner` attribute fixes the corner for a host that knows its layout.
- **A menu does not flip.** Larger elements adapt but do not switch between light and dark (M 15:29), so the backdrop
  is read once as the menu opens (or taken from the host's `sample`) and held while it is out.
- **Disabled stays the author's.** The element never rewrites `disabled` or `aria-disabled`, so either can be set and
  cleared at any time (React clears `disabled` with `removeAttribute`). A native disabled button cannot take focus, so
  the arrows, typeahead and the pointer pass over it; an `aria-disabled="true"` item is the WAI-ARIA APG's variant,
  reached by all of them. Neither can be chosen. A focused item that turns natively disabled hands focus to the menu.
- **The press that opened the menu does not choose.** The first item grows in under the pointer, so a pointer click
  counts only once the menu has arrived (content in focus, surface past its overshoot) and its press began after that; a
  deliberate key, which is not under the pointer, counts once the content is in focus. The second click of a double
  click and held keys never count. A choice is taken in the capture phase, so it closes the
  menu even when an item's handler stops the click.
- **A closed shadow root hides the menu from the document**, so a press outside is judged in the innermost tree that
  can see it, one listener per tree from the element's root out to the document.
- **The list's `toggle` event comes late.** It fires when the list leaves the top layer, after the growth has run
  back; `aria-expanded` turns false as the closing begins.

## The adaptive layer

The adaptive map (research, outside this repository) says what every atom and pattern becomes across window classes,
input and posture. The kit holds it as data in, form out:

- **The context** (`AdaptiveContext`): the window in dp, the input in three layers (the primary pointer, any coarse
  input, hover available, a keyboard present), the posture (flat, tabletop or book, with the fold's bounds and whether
  it occludes) and reduced motion. `classifyWindow` holds every threshold: widths 600, 840, 1200 and 1600, heights 480
  and 900. `windowSegments` and `postureFromSegments` convert between a posture and the segments a target reports.
- **Pure functions** turn it into forms: `navigationForm` (bar, rail or sidebar, the search's form, what is secondary),
  `bottomAccessory`, `presentationForm` (what a menu, picker, popover, sheet, modal sheet, alert or dialog becomes,
  and the segment it lives in), `paneLayout` and `supportingPane`, `postureSplit`, `toolbarPlacement` from the window
  and `toolbarLayout` from the toolbar's own container, `sizeTier` and `hitTarget` from the input layers, and
  `formMorph` with `stepFormMorph` and `formMorphFrame`, which reshape one body on the growth's springs, turn back
  mid-way and land in one frame under reduced motion. Nothing in them is music-specific: a player maps onto the bottom
  accessory and the supporting pane.
- **Targets collect the context and draw the form.** The web's `environment.ts` reads `pointer`, `any-pointer` and
  `any-hover`, learns a keyboard from a key pressed outside a field, reads `window.viewport.segments`, and
  `watchAdaptiveContext(root, …)` gives a shell root its context whenever any part changes. The elements read what they
  need: the tier from the primary pointer, the hit area from any coarse input, hover from the event, and the menu its
  trigger's segment. `setInputOverride` and `setViewportOverride` let a host or a simulation decide instead; the stage
  uses both. Android will take the context from its window size class and `FoldingFeature`, and Material's own
  scaffolds must not decide forms in the model's place, or the targets drift apart.

Acceptance of the layer is the AD criteria in `docs/acceptance.md`.

## The navigation

The research (outside this repository: the navigation note of 18.10.2026, after the adaptive map) defines navigation by
one thing: the bar, the rail and the sidebar are one glass body, and a change of form goes through the selection. At
M 8:35–8:47 the selected item lifts into a lens, the old body contracts into it, the new form grows out of it and the
lens settles into the new form's selection. The menu's growth is the same mechanism with the trigger as the anchor;
here the anchor is the selected destination. `<vire-nav>` builds it:

- **The first HTML is links.** A `<nav aria-label>` holding a `<ul>` of `<a>` destinations, the current one with
  `aria-current="page"`; an optional second `<ul data-secondary>` (shown only in the sidebar, decision 6); an optional
  `<a data-search>` (the search destination). Before the upgrade it is a list of links that works with no script.
  Navigation between sections is navigation, not tabs: no `tablist`, no arrow keys, Tab walks the links (APG Tabs is
  for panels of one page). An optional `[data-accessory]` child outside the `<nav>` is the bottom accessory, host content
  that is not navigation.
- **The form comes from the model.** The element covers its containing block (the shell), takes the adaptive context
  of its own box with `watchAdaptiveContext` and asks `navigationForm` with the destinations it counts; a `form`
  attribute fixes the form for a host that knows. It publishes what the content must clear as
  `--vire-nav-inset-bottom` and `--vire-nav-inset-start` on its parent and fires `vire-nav-layout`. It takes what a side
  sheet clears at the trailing edge from its shell (`--vire-sheet-inset-end`, announced by `vire-sheet-inset`) and gives
  it to `navLayout` as `endInset`.
- **Forms.** The bar: a floating capsule centred at the bottom, items 74 dp wide with the icon over the label, a pill 3 dp
  inside it marking the selection, and the search as its own circle the bar's height at its trailing end (U 4:45,
  measured at t = 290 s). The rail: a floating vertical capsule at the leading edge with the bar's items and the search
  as its last item; a toggle at its head when the model makes it expandable. The sidebar: a floating inset panel, 280
  dp wide, rows with the icon beside the label, the secondary list under a separator, the search as a field-like row
  at the top and the collapse toggle in its head. All three are glass; the content flows under them (D 12:34).
- **One body, one lens.** The body is one glass surface; the bar's search circle is its second shape (`setMorph`), so
  at rest a bar and its search are one lens with two silhouettes. A form change is `navMorphFrame` on one spring: the
  selection lifts into a lens, the body contracts into it while its content defocuses, the lens travels to the
  selection's place in the new form, the new body grows out of it while the new content comes into focus, and the lens
  settles into the pill. The search circle is the bar's second shape at a standstill (M 8:42, the split of an organ, M 5:02); while the bar
  moves the lens is handed no new second shape, so the neck is not drawn on the way and the landed frame is exact. The DOM switches `data-form` at the middle, where the body is the lens and no
  content shows; the lens carries a copy of the selected destination, magnified, so the selection is never out of
  sight. Turning back runs the same frames backwards; a third form swaps the target while the body is still the lens,
  and rebases from the current frame once it grows. Under reduced motion the new form is there in the next frame.
- **The lens is the one exception to "no glass on glass".** While the selection travels or is dragged it is its own
  glass over the body, as the reference draws it (its own rim, magnifying what is under it: U 298–299.7 s, M 8:36).
  It exists only while it moves and lands back into the pill, which is a fill, not glass.
- **Dragging on the bar.** A press on the bar lifts the selection into the lens under the finger; the lens follows the
  finger continuously, stretched along the motion, clamped to the bar, the item under it tinted and magnified; release
  settles it on the nearest item and activates that link once (U 298–299.7 s at 15 fps). A tap is a plain link click;
  the pill slides to the new `aria-current` whenever the host moves it.
- **Minimising.** With `minimize="scroll"` and a scroller (the `scroller` property or attribute), the bar minimises after
  24 dp scrolled down and expands after 24 dp up, at the top, on a tap on it and when focus enters it (U 5:07; H Tab
  bars). Minimised, the bar is a circle with the selected destination's icon at the leading end and the search circle at
  the trailing end, both 44 dp; the transition is the same contraction into the selection. Only the bar minimises. A reversal shorter than 4 dp is
  counted into the run, not taken for a change of direction; the position is clamped to the scrollable range, so a bounce
  past an end cannot expand the bar; the scroller is resolved again on every change, and the document can be it.
- **The bottom accessory** is placed by `bottomAccessory`: a capsule over the bar and its search (48 dp high, 8 dp above),
  in the minimised bar's row between the two circles, or along the bottom of the content beside a rail or sidebar. It
  has its own glass and reshapes between placements by `formMorphFrame`; `data-placement` on it tells the host which
  content to show (transport only when `in-bar`). Along the content it ends at the margin, or at the leading edge of a
  side sheet when one is open (`endInset`), so it never runs under it.
  In a form change it starts reshaping when the body starts to contract, not while the selection lifts: the reference's
  phases run lift, contract, grow, settle (M 8:35-8:47). The accessory's own timing has no local reference footage (the U
  video is not downloaded), so only that order is taken from it; the accessory's spring is unchanged.
- **The person's choices stay theirs.** The `collapsed` attribute is the sidebar collapsed into a rail: the toggle sets
  and clears it and fires `vire-nav-collapse`; the host remembers it (a cookie, so the server renders the right form).
  An expandable rail on an expanded window opens the sidebar over the content with a scrim and closes on Escape, a press
  outside or a choice. The toggle's name is constant (`toggle-label`, default "Sidebar"); `aria-expanded` alone says
  whether the sidebar is shown, so name and state never contradict each other. The kit stores nothing.
- **Search.** The model's search form decides where the search destination shows. Where the model gives a shortcut,
  `search-key` (default `/`) pressed outside a field activates the search link, announced by `aria-keyshortcuts`. The
  field itself is the search atom (order 7).
- **Badges.** A `[data-badge]` is a picture, `aria-hidden` by the element, so a count is never read glued to the label;
  a `[data-badge-label]` in the link says it and is visually hidden, not hidden from the tree.
- **A rail taller than its window** stops at the window's edge like the sidebar, and its rows (the search item too) scroll
  inside the body at rest (`data-scroll`); each of the rail and the sidebar remembers its own offset.
- **Safe area.** `bottomInset` of the model comes from `env(safe-area-inset-bottom)`, read through a probe the element
  keeps in itself only while it reads; the bar sits above it (never closer than its 16 dp margin).
- **Sizes and input.** Rows and items keep the 44 dp hit area wherever any coarse input is present (AD2); the sidebar's
  rows are 44 dp on the touch tier and 36 dp on the pointer tier. Focus shows as a ring on the link; a morph keeps
  focus on the same link while that link stays shown, and a link the new form hides hands it to the selected link (or
  the toggle) without scrolling. Closing the sidebar opened over the content by Escape or the scrim returns focus to the
  toggle that opened it; there is no focus trap and no `aria-modal`.

Acceptance is the NV criteria in `docs/acceptance.md`.

## Sheet and popover

The research (outside this repository: the sheet and popover note of 18.10.2026) and the adaptive map decide what a
transient surface becomes on each class (`presentationForm`); this is how it sits, moves and closes. A surface is one
body: it grows out of the control that presents it and runs back into it on close (U 6:56–7:20: sheets "morph out of
buttons that present them"; D 6:54: the action sheet "springs from the action itself"), and a class change reshapes it
while it stays open.

- **The first HTML is the platform's.** Each kind keeps the semantics it has without the kit:
  - `<vire-popover>`: a `<button popovertarget>` and a `popover` (auto). Light dismiss, Escape and focus return are
    the platform's; several picks keep it open, so it is not a menu.
  - `<vire-sheet>` modal (`modal-sheet`, `picker`, `dialog`, `alert`): a `<dialog>` opened by
    `<button commandfor command="show-modal">` and closed by `command="close"`. The background is inert, Escape closes,
    focus moves in and comes back, all by the browser.
  - `<vire-sheet>` supplementary (`sheet`, beside a parallel task): a `popover="manual"` toggled by its
    `popovertarget`. The page stays usable and nothing closes it but the person.

  The kind comes from the markup; a `kind` attribute overrides it. After the upgrade the element runs the show and the
  hide itself, as the menu does, so the growth can run back before the surface leaves the top layer: it intercepts the
  `command` and `cancel` events, a dialog's submit (the form's method or the submitter's `formmethod` is `dialog`) and
  the popover's toggles, only while it runs the surface, and gives everything back on disconnect, the reflected
  `detent` included. The trigger belongs inside the element: a `popovertarget` button outside it is the platform's
  and toggles the popover with no growth.
- **The form is the model's.** `presentationForm(kind, ctx, source)` on the window the element lives in. A popover is a
  bottom sheet grown from its source below 600 dp. A supplementary sheet is a bottom sheet below 840 dp (at most 640
  wide, centred), a side sheet that narrows the content from 840 dp and a third pane from 1600 dp. A modal task or
  picker is a bottom sheet below 600 dp and a centred sheet from 600 dp. A dialog with fields is full screen below
  600 dp; an alert is an alert everywhere. Every bottom or centred sheet is full screen on a compact height.
- **Below 600 dp a popover stays a popover.** Its sheet form carries a scrim to say where the surface is, and a press
  on the scrim is the popover's own light dismiss. It is not made modal: a `popover` cannot be, and its task is
  supplementary.
- **The bottom sheet sits by its height** (U at t = 392, 400, 411 s, measured):
  - Detents are fractions of the window: `medium` is half of it, `large` leaves 56 dp at the top, and an optional
    `peek` is the content's own height. The detents a sheet has come from its kind or the `detents` attribute, and the
    current one is reflected in `detent`.
  - The side and bottom inset shrinks as the sheet rises: 12 dp up to 30 % of the window, 6 dp at 55 %, flush from
    90 % (`sheetInset`). The radius is 32 dp while inset and 28 dp when flush; a flush sheet runs its bottom corners
    past the window's edge.
  - The density follows the height from the bottom: glass up to a quarter of the window (`peek`), about half dense at
    `medium` (0.55 gives 0.44, a smoothstep from 0.25 to 0.9) and opaque from 90 % (`sheetOpacity`; U 407.0 s: about
    0.47 s, opaque by the large detent). Glass cannot carry text over vivid content, so a surface over a scrim (a
    centred sheet, a basic dialog, an alert, a popover that became a sheet) is never thinner than
    `SHEET_SIZES.opacity.overScrim` (0.6). A popover that keeps its anchored form keeps the menu's body.
  - The ink follows the body as it is drawn, not the page: `surfaceInk` lays the opaque body (the colour the kit paints,
    read from `Canvas`) over the backdrop's luma, with the scrim in it, at the surface's density and takes the polarity
    with the higher contrast. The element sets `data-ink` (`dark` or `light`) and the styles paint a near-black or a
    near-white from it. Reduced transparency and increased contrast are opaque already and keep `Canvas` and
    `CanvasText`. The lab's gate measures it on screenshots: the title and two labels of every form on both backdrops
    reach 4.5:1 (SH21).
  - A floating sheet stays clear of the bottom safe area: the element reads `env(safe-area-inset-bottom)` through a
    probe, as `<vire-nav>` does, and gives it to `sheetLayout` as `bottomInset`.
  - The background only dims; it is never scaled or moved.
- **The grabber** shows whenever a sheet has more than one detent or closes by a swipe. It is a 32 × 4 dp line with a
  44 dp hit area. With more than one detent it is a `role="slider"`: `aria-valuetext` names the detent (`detent-labels`
  says the names in the page's language, the English ones stand in), the arrows change it, and a tap moves to the next
  one. With one detent it is only a picture of the swipe: `aria-hidden`, no role, not focusable; Escape, the swipe and
  the close button close the sheet.
- **A bottom sheet stands in its region.** Its detents, its height, the density's share of it and the clip of its
  overhang use the part of the window the form is in (`form.region`, one half on a folded screen); a centred sheet's
  tallest height uses it too. `large` is the tallest detent even in a window too small to leave 56 dp, and detents
  under 24 dp apart are one (`namedSheetDetents`, the larger name).
- **Dragging.**
  - While the finger is down the box follows it with no spring, and past the largest detent it meets resistance (a
    125 dp dampening zone).
  - On release it springs to the detent chosen by position and velocity (56 dp and 125 dp/s to leave the current one,
    from Material as starting values), at about 0.4 s with at most 2 % overshoot (U 403.6 and 407.0 s: 0.35 to 0.47 s).
  - Below the lowest detent by the same thresholds it closes, unless `persistent` is set.
  - Content scrolls first. Only from its top does a downward drag move the sheet, and the content's scroller takes
    `overscroll-behavior: contain`. Whose a touch is follows the scroller under the finger (the nearest scrollable
    ancestor within the surface), not only the surface's own offset.
  - A press on a control (a button, link, field, a widget role, an editable) in the top strip is the control's, not a
    drag. A drag the system cancels, or one that loses its pointer capture, settles on the nearest detent with no
    velocity and never closes the sheet (`cancelSheetDrag`).
- **Growth and closing.** A surface with a trigger grows out of it and runs back into it, and the trigger hands its
  body over while the surface is out (`setCarried`), as with the menu:
  - A popover takes the menu's growth (`growthFrame`, the drop included, `DEFAULT_GROWTH_TIMING`): the drop is bright and
    rises ahead of its swelling and the content comes into focus on its own spring after the body has its size, but at
    the pace the menu had before it was fitted to M 5:11 (`POPOVER_GROWTH_TIMING`: a longer closing ran the lens over
    33 ms on mid-size maps). It does not take the clip path of the union, so it hands the lens the second shape, and its
    content is not magnified (its layout is the author's, there is no row to scale about).
  - A sheet grows straight from the trigger's body into its box with no drop, on that pace slowed by a quarter,
    because the path is longer.
  - A sheet without a trigger rises from the bottom edge on the detent spring; a centred one without a trigger comes in
    from 96 % scale.
  - Content comes into focus once the body has its size, as in the menu; a sheet's follows its single spring.
- **Changes of form** reshape the one body on `FORM_MORPH_TIMING` (`formMorphFrame`): popover ↔ bottom sheet at 600,
  bottom ↔ side sheet at 840, side sheet ↔ third pane at 1600, sheet ↔ full screen on a compact height. The content,
  its scroll, the focus, the selection and the detent survive; a sheet that left its detent for full screen comes back
  to it. Reduced motion lands every change in one frame.
- **Layers.**
  - The side sheet: 360 dp wide (280 to 400, at most a third of the window), inset 8 dp from the top, trailing and
    bottom edges with radius 24. It is glass, and the element publishes `--vire-sheet-inset-end` on its shell (the widest of
    the side sheets open in it; the last to close gives back the shell's own value) and fires `vire-sheet-inset` there,
    for everything inside the shell that lays out content: custom properties inherit, and `<vire-nav>` listens.
  - From 1600 dp it is a third pane: the content layer, opaque, never glass (decision 3).
  - Centred sheets and basic dialogs are `min(560, window − 48)` wide, alerts `min(320, window − 48)`; they are as tall
    as their content up to the window minus 48, with the content scrolling inside.
  - Full-screen forms are opaque and flush.
- **The scrim** dims at 32 % black under a modal surface and under a popover's sheet form. A press on it closes a
  bottom sheet or a popover, never a centred sheet, a dialog or an alert, and never a `persistent` surface.
- **The keyboard.** When a field in a bottom sheet takes focus and the visual viewport shrinks, the sheet moves to its
  largest detent and keeps its bottom above the keyboard. When the keyboard leaves, the sheet goes back to the detent the
  person had, if they did not move it.
- **The window and what the element reads.**
  - The window is the nearest ancestor marked `data-vire-shell`, else the root given to `setViewportOverride`, else the
    viewport. A positioned ancestor is no window: a trigger sits in toolbars and cards.
  - A trigger's `command="show-modal"` is intercepted and run through the element, so the backdrop is laid out and read
    before the dialog is presented (an inert page cannot be read), and dimmed by the scrim it will lie under. A host that
    calls `showModal()` itself gets a backdrop that cannot be read and should set `sample`.
  - While the surface is out its trigger takes no pointer of its own, but the control that wraps it still passes the click
    on, so a supplementary sheet closes by its button.
  - A drag in the content starts from a touch or a pen, not a mouse (a mouse selects text there); the grabber and the
    top strip drag with any pointer. A touch is the content's while it scrolls (`touch-action` follows the scroll
    position and the detent).
  - `detent` is reflected, and `vire-sheet-detent` fired, while the surface is a bottom sheet; a peek as tall as the
    sheet is also `large`. Removing the element takes the reflected `detent` off (an authored one is put back).
  - The content's size is observed (a `ResizeObserver` on the surface's children) as well as its markup: a `<details>`
    opened or an element shown after the surface is out is measured again.
  - The window is read when it changes, not while it scrolls: the safe area and the colour of an opaque body on open, on
    resize and when the mode or the colour scheme changes (the ink is evaluated again then); a scroll re-places only a
    form that follows its source (the popover), and the surface's own scroll offset is cached from its `scroll` event.
  - A popover's `::backdrop` takes no pointer (the platform's UA sheet fixes `pointer-events: none`), so a press on its
    sheet form's scrim is stopped by the element, and so is the click that follows that press and no other: the next
    press elsewhere ends the hold.
  - Escape closes a popover unless a modal dialog outside it is open, which owns the key.
- **Glass budget.** An open surface is one glass surface: its trigger has handed its body over, and the side pane and
  full-screen forms are not glass.

Acceptance is the SH criteria in `docs/acceptance.md`.

## The toolbar

The research (outside this repository: the toolbar note of 19.10.2026) and the adaptive map decide what a toolbar keeps
in sight. `toolbarLayout` and `toolbarPlacement` already hold the rules:
- neighbours merge first, then the lowest priority goes into "…";
- badged items and the main action stay;
- "…" exists only for overflow;
- text never stands in the vertical strip.

What M 4:46–4:53 shows at 15 fps is how it moves: two capsules reach for each other, a neck forms, the bodies join, and
the joined body contracts to the item that stays. Glyphs defocus and come back into focus; they never slide. `<vire-toolbar>` builds that:

- **The first HTML is buttons in groups.** A `<vire-toolbar aria-label>` holds `[data-group]` elements of buttons.
  - A button can be bare, `<vire-button>` or `<vire-icon-button>`, or the trigger of a `<vire-menu>`, `<vire-popover>`
    or `<vire-sheet>`.
  - Item attributes: `data-priority` (a number, higher stays longer), `data-primary` on the one main action, a
    `[data-badge]` inside for a status.
  - An icon button needs an `aria-label`, which is also its row's label in "…".
  - Before the upgrade the groups wrap (`flex-wrap`) and every button is its own Tab stop, so nothing is hidden or
    scrolled. There is no `role="toolbar"`: the role promises arrows and one Tab stop.
- **After the upgrade the element is the APG toolbar.**
  - `role="toolbar"` and `aria-orientation` from the placement.
  - One Tab stop with a roving tabindex: the arrows along the axis, Home and End; disabled items are passed over.
  - Removing the element gives the markup back.
- **The form is the model's.**
  - `toolbarPlacement(ctx)` on the shell gives the edge, the orientation and the most groups. The element reflects
    `data-edge` and `data-orientation`.
  - On the bottom edge it floats 8 dp above the navigation (the inherited `--vire-nav-inset-bottom`), in its
    containing block. On the top edge it stays in flow at its pane's top. On the trailing edge it is a vertical strip,
    with its text items in a horizontal row at the strip's foot (`aside`).
  - `toolbarLayout` runs on the element's own width (its height in the strip) with the tier from the input. Groups,
    merges and the overflow come from it; the element invents none.
- **A lens for each capsule, one over a joining set.**
  - The material draws a body's `shapes` only inside the body element's own box (checked on `vireglass` 3.0.0: a shape
    offset past the box shows nothing), so one lens whose body is the first capsule cannot draw capsules that stand apart.
  - Each capsule is a created `[data-vk-capsule]` element with a lens of its own, sized to the capsule; "…" and the strip's
    text row are capsules too.
  - Where the frame's neck joins neighbours (`toolbarClusters`: a gap under a quarter of the smoothing), the leading
    capsule's lens takes their bounds and is clipped to the smooth union's outline (`toolbarSilhouette`, the material's
    own `smin`), and the others hide until they come apart. A resting toolbar is therefore a lens per capsule, and a
    merge is one lens over a pair with the neck between them.
  - All the lenses take one backdrop reading (the element's `sample`, else one probe of the toolbar's box), so the capsules
    agree on their ink, and the items take that ink.
  - The kit's controls inside are `glass="off"` (put back on removal) and drawn without a body, so there is never glass on
    glass.
- **Stage changes move.**
  - Merging closes the gap between two capsules: the smoothing builds a neck, the union becomes one capsule, and the
    glyphs stay put.
  - Overflow contracts the leaving item's slot into "…": its glyph defocuses, and "…" grows out of the trailing end
    the first time.
  - Splitting and coming back run the same path backwards.
  - The springs are the growth's (about 0.35–0.4 s for the whole path, M 4:46–4:53).
  - A threshold has 8 dp of hysteresis, so a capsule does not flicker on its edge.
  - While the window is dragged the layout follows, and a stage change runs once per crossing.
  - Under reduced motion every change lands in one frame.
- **A change of place is not a morph.** Bottom, top and the strip are different places (B 0:28, 5:56): the old one
  dematerialises (`setAppear` on every frame, never opacity) and the new one materialises, and its layout is computed
  for its own container. The frame that swaps the form lays it out and paints once, dropping the old form's lenses, and runs
  inside the motion's own frame chain without scheduling another. The text direction is read when the toolbar measures
  (outside the frame), not in a frame. An item's placement properties (`--vk-ix/iy/iw/ih`) are registered as not inherited
  in the document, since a shadow root ignores `@property`, so a moving frame restyles the items and not what is inside them.
- **"…" is a menu.**
  - A `<vire-menu>` the element creates, with a row (icon and label) for each overflowed item in toolbar order.
  - Choosing a row clicks the original button once.
  - A row for an item that opens a menu, a popover or a sheet opens that surface from "…" once the menu has put itself
    back: the surface elements take an `anchor` (an element, or null) that is the box they grow from and return into in
    place of their trigger, cleared when they close.
  - "…" carries no badge: badged items never overflow.
- **An anchor that leaves closes its surface** (AD21). An open menu, popover or sheet whose trigger goes into "…" runs
  its growth back into "…" and closes (`retractInto`), and focus moves to "…". A trigger that only merges keeps its
  surface, which follows the trigger's new box (the toolbar calls `follow()` on each frame of a change, because a surface
  watches scrolls and resizes, not a trigger that moves). A trigger removed from the toolbar closes its surface at once,
  and focus goes to the neighbouring item. A surface closes by itself when its trigger leaves the document, toolbar or not.
- **Focus.** A focused item that goes into "…" hands focus to "…"; the roving tabindex is recomputed over what is in
  sight.
- **Sizes and modes.**
  - Slots are squares of the tier's height.
  - Text buttons are padded as `<vire-button>`.
  - The gap between capsules is 8.
  - Every item meets the 44 dp hit area wherever any coarse input is present.
  - Glass off, reduced transparency and increased contrast keep the same geometry. The gap is the one sign of a group
    there.

Acceptance is the TB criteria in `docs/acceptance.md`.

## Scroll edge and legibility

Content that scrolls under a floating bar fights the bar's own text through the glass. The reference answers it at the
screen, not in the material (M 8:52–9:41, D 11:32–12:12; `vireglass` `docs/reference.md` §10): what slides under a bar goes
out of focus toward the edge and dissolves, over dark glass it becomes a light dimming, and pinned content gets a flat
band. The glass has to see the content already dissolved, so the effect sits behind it in the stack. `attachScrollEdge`
in the core does the painting; the kit places it.

- **Where.** The navigation in its bar form, the toolbar on its top and bottom edges, and a sheet's top strip over its own
  content. Not the rail, the sidebar or the trailing strip (§10 is about top and bottom bars), and not with glass off,
  which draws a solid body. Reduced transparency and increased contrast keep the glass, so they keep the edge.
- **The element.** `[data-vk-edge]`, made by the atom: `aria-hidden`, `pointer-events: none`. In the navigation and the
  toolbar it is the host's first child (a toolbar's capsules go in after it), so it paints under the glass in the same
  stacking context and the glass's backdrop filter samples what the edge has made. In a sheet it is a sticky child after the
  grabber, at the top of the surface that is the scroller, and takes no room in the content. Nothing between it and the page
  may be a backdrop root (a filter, an opacity under 1, a mask, a clip-path or a backdrop filter): a backdrop filter sees only
  up to the nearest ancestor that is one, which is why the gate checks the ancestors in the lab.
- **Geometry.** `src/web/scroll-edge.ts` lays it over the scroller's visible width, from the scroller's edge to the bar's
  inner lip (the accessory above a navigation bar counts) plus `scrollEdgeReachDp` of the bar's own height, which the core
  measured off the reference as 1.9 times the bar. A bar that stands clear of the scroller's box gets `display: none`. It
  is written when a `ResizeObserver` on the host, the bar and the scroller says so, and when the atom's form, placement,
  scroller or attributes change; a scroll only runs the core's own listener, which writes style from `scrollTop` and reads
  no layout (SE7). The document works as a scroller through a stand-in, since its scroll events go to the window.
- **Ink.** The edge's style follows the glass's own ink, read from the `--vireglass-ink` the lens writes on its element (the
  toolbar's host, a sheet's `data-ink`): light ink on dark glass takes the dimming, dark ink the dissolve. It is read again
  when the lens chooses another.
- **Attribute.** `scroll-edge`: absent is on whenever a scroller is known and glass is on, `off`, or `hard` for pinned content
  (a flat band). The toolbar takes `scroller` (an id, or the property) with the navigation's meaning; the navigation takes
  it without `minimize`; a sheet scrolls itself.
- **The ramp's direction.** The core's ramp runs from full at the start of the band to nothing at its end, written for a band
  that starts at the bar; laid over the scroller's edge it would be strongest away from the bar. The element is mirrored
  (`data-flip`) when the written ramp runs that way, which a check of the mask makes at attach, so a core that turns it round
  loses the mirror by itself. A gate measures it: a ramp that runs the wrong way leaves the lines sharp (SE6).
- **How well it works.** The text under a navigation bar keeps a fifth of its sharpness through the glass, against the
  reference's tenth. It is a cross-fade of the blurred and the sharp content, so what shows under the far end of a bar is
  fainter, not gone.

**Legibility.** `view=legibility&lg=<atom>&backdrop=<text|photo|dark>` draws one atom floating over a scroller full of
body text, scrolled under it (the navigation bar, rail and sidebar, the toolbar on the bottom and the top, a menu, a
popover, the buttons). `tests/lab/legibility-behavior.spec.ts` renders each on the text page and the photo with glass on
and off, and measures what the atom writes against what is behind it (LG1): the text and glyphs are found, their computed
ink is read, the ink is made transparent, and a screenshot gives what is left behind it, the glass and what shows through. Two
readings of the contrast of the ink with that: the median (the sheet gate's), and the tenth of it hardest on the ink, which is
where a line of text showing through the glass lands. Text needs 4.5:1 and glyphs 3:1 on both. A median alone cannot see a
line of text under a label: the strokes are a small part of the box.

Everything passes with glass on and off (LG1, LG4). Until vireglass 3.4.0 the rail and a floating button over body text fell short for the text's hardest tenth (4.0:1 on the text page, 3.1:1 on the photo): the control material's roughness of 0.035 rendered no blur in Chromium, so the text under a control read through almost untouched. At 0.18 (σ 2.16 pt) it is out of focus, and the kit adds nothing of its own over it: it paints its own body (`body: false`) and takes the frost from the material.

## Acceptance of an atom

An atom is done when:

1. its model has unit tests;
2. the lab shows every state on every backdrop, with glass on and off;
3. Playwright covers its behaviour, keyboard and roles, degradation and accessibility toggles (`check:lab`);
4. every reference criterion for it is written in `docs/acceptance.md` with how it is checked — by a gate where
   it is measurable, by a side-by-side with the reference frame where it is visual;
5. its baselines are committed (`check:lab:visual`);
6. **it moves at frame rate.** Every transition that changes a glass element's shape over frames is in
   `tests/lab/transitions.ts`. `check:lab` counts the core's work over it (`renderStats`): no backdrop probe, no
   full bake and no filter swap on any frame of the change, one landing after it. `check:lab:perf` replays it in a
   headed Chromium with the GPU, timing the frames from the start to 400 ms past the last active one (the landing's
   bakes fall there), and requires with glass on no frame over 33 ms that its trace does not show outside the page, no
   main-thread task over a vsync and no GPU program compiled after the warm-ups ("The frame gate"). Gates that
   read the model's boxes frame by frame say nothing about what the browser draws; these two say it (MO1–MO5);
7. **its mid-motion frames are in the visual set.** The change is frozen at about a quarter, a half and three quarters
   through (`check:lab:visual`), and a drag is held at a few places, not only the resting forms (MO6);
8. **its text is legible on the glass.** Contrast of the ink to what lies behind it, over a page of text and over a
   photo, for every glass atom (WCAG 2.2: 4.5:1 for text, 3:1 for glyphs), gated in `legibility-behavior.spec.ts` (LG1);
   an atom that floats over scrolling content has a scroll edge (SE1);
9. **it has been looked at, moving, at speed, before a release:** in Chrome or Yandex Browser on a machine with a GPU,
   beside the reference, not in headless and not frozen. What is seen goes into issues (MO7).

The gates in 6 and 7 exist because every gate before them measured what the model and the script decide, and none
measured what the browser draws in motion: atoms passed all of them and ran at 10 to 20 frames a second.

## Order

0. Foundation: `sizes.ts`, the behaviour base, the web element base with progressive enhancement and glass
   attach, the lab, `check:lab`.
1. Button and icon button: press, hover and focus where the input has them, disabled; the icon button lifts
   into the glass under the finger.
2. Menu: grows out of its trigger, closes after a choice, closing retraces the growth.
3. The adaptive model and its stage: classes, input layers, posture, the forms of every pattern, and the three input
   layers and segment placement in the atoms above.
4. Navigation: bar, rail and sidebar as one body that morphs between them, the search's forms, the bottom accessory.
5. Sheet and popover: a popover that becomes a sheet grown from its source, bottom and side sheets, the full-screen
   forms.
6. Toolbar: merging neighbours and overflow by priority into "…", in its container's width. The element is built; the
   adaptive stage still draws its outline.
7. Search field: a button that flows into a bottom field on compact, a page with the field in focus, a persistent
   field.
8. Switch and slider: the knob lifts into the glass while held.
9. Segmented control: breaks into parts on entering selection mode.
10. Chip and field: grow into a popover or suggestions where they open a list.

Decided on 18.10.2026: the atoms the adaptive map names (4 to 7) come before switch, slider, segmented control and
chip. An atom has to know its adaptive forms before it is built; these four are the ones whose form changes with the
window, so building another atom first would build it against a frame that is not there yet, and the later atoms
(a segmented control that becomes a menu, a chip that opens a sheet on compact) are made of their forms.

Then each accepted atom is reproduced on Android in the same model.

import { expect, test } from '@playwright/test';
import { TRANSITIONS, frameReport, recordTransition, type FrameReport } from './transitions';

// Local, headed, GPU: `npm run check:lab:perf`. Replays every transition of the motion gate with glass on and off and
// times the animation frames. No frame over 33 ms and a p90 of at most 20 ms with glass on; the glass-off run is the
// reference the table prints beside it. A transition is replayed once to warm it up (shaders, decoding, first layout)
// and then three times to measure; the middle one of the three is judged, because a shared GPU drops a frame here and
// there on any replay, and a kit that costs a frame in every replay is what the gate is for.
const MAX_FRAME = 33;
const MAX_P90 = 20;
const REPLAYS = 3;

const rows: { name: string; on: FrameReport; off: FrameReport }[] = [];

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/?chrome=0');
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'none';
  });
  await page.close();
  expect(renderer, `the GPU is not in use (${renderer}); this gate does not accept software rendering`).not.toMatch(/swiftshader|software|llvmpipe|none/i);
  console.log(`renderer: ${renderer}`);
});

test.afterAll(() => {
  const cell = (r: FrameReport) => `${String(r.frames).padStart(4)} ${r.p90.toFixed(1).padStart(6)} ${r.max.toFixed(1).padStart(6)} ${String(r.over).padStart(5)}`;
  const width = Math.max(...rows.map((r) => r.name.length), 10);
  const lines = [
    `${'transition'.padEnd(width)} | glass on: frames   p90    max  >33 | glass off: frames   p90    max  >33`,
    ...rows.map((r) => `${r.name.padEnd(width)} |           ${cell(r.on)} |            ${cell(r.off)}`),
  ];
  console.log(`\n${lines.join('\n')}\n`);
});

for (const transition of TRANSITIONS) {
  test(transition.name, async ({ page }) => {
    await recordTransition(page, transition, '1');
    const replays: FrameReport[] = [];
    for (let i = 0; i < REPLAYS; i += 1) replays.push(frameReport(await recordTransition(page, transition, '1')));
    replays.sort((a, b) => a.over - b.over || a.max - b.max);
    const on = replays[Math.floor(REPLAYS / 2)]!;
    await recordTransition(page, transition, '0');
    const off = frameReport(await recordTransition(page, transition, '0'));
    rows.push({ name: transition.name, on, off });
    console.log(`ROW ${transition.name} | on ${JSON.stringify(on)} | off ${JSON.stringify(off)}`);
    expect.soft(on.over, `frames over ${MAX_FRAME} ms with glass on`).toBe(0);
    expect.soft(on.max, 'slowest frame with glass on').toBeLessThanOrEqual(MAX_FRAME);
    expect.soft(on.p90, 'p90 with glass on').toBeLessThanOrEqual(MAX_P90);
  });
}

import { expect, test, type Page } from '@playwright/test';
import { TRANSITIONS, recordTransition } from './transitions';

// A ResizeObserver loop is the browser saying an observer's write changed something it had no turn left to report, or an
// observer was set up from inside another's delivery. The first notification of such an observation is dropped for the
// frame, so the layout it was meant to follow lags a frame behind.

const count = (page: Page) => page.evaluate(() => (window as unknown as { __roLoops: number }).__roLoops);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __roLoops: number };
    w.__roLoops = 0;
    window.addEventListener('error', (event) => {
      if (/ResizeObserver loop/.test(event.message)) w.__roLoops += 1;
    });
  });
});

const named = (name: string) => TRANSITIONS.find((t) => t.name === name)!;

for (const name of ['navigation morph, bar to rail', 'navigation morph, rail to bar', 'toolbar change of place']) {
  test(`${name}: no ResizeObserver loop with the scroll edge on`, async ({ page }) => {
    await recordTransition(page, named(name), '1');
    expect(await page.evaluate(() => document.querySelector('vire-nav, vire-toolbar')?.getAttribute('scroll-edge') ?? null)).toBeNull();
    expect(await count(page)).toBe(0);
  });
}

test('the canary: an observer that resizes what it observes is counted', async ({ page }) => {
  await page.goto('/?chrome=0&view=toolbar');
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;height:10px;width:10px';
    document.body.append(box);
    new ResizeObserver(() => {
      box.style.width = `${box.offsetWidth + 1}px`;
    }).observe(box);
    box.style.width = '20px';
  });
  await page.waitForFunction(() => (window as unknown as { __roLoops: number }).__roLoops > 0);
  expect(await count(page)).toBeGreaterThan(0);
});

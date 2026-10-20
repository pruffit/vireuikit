import { expect, test, type Page } from '@playwright/test';
import { nextFrame, openCase } from './helpers';

// What the browser draws in the middle of a change, not at rest: a navigation morph, a popover and a sheet growing out of
// their trigger, a toolbar merge, each frozen at about a quarter, a half and three quarters of the way, and the drag lens
// held at a few places, with glass on. Baselines are per platform and move only on purpose.
const T = [0.25, 0.5, 0.75] as const;
const attached = (page: Page, selector: string) =>
  page.waitForFunction((s) => [...document.querySelectorAll<HTMLElement>(s)].every((el) => /url\(|blur/.test(el.style.backdropFilter)), selector);

test.use({ viewport: { width: 1400, height: 1000 } });

for (const t of T) {
  test(`nav in a change of form at ${t}`, async ({ page }) => {
    await openCase(page, `atom=nav&form=rail&backdrop=light&glass=1&state=morph:bar:${t}`);
    await attached(page, 'vire-nav > nav, vire-nav > [data-vk-lens]');
    await nextFrame(page);
    await nextFrame(page);
    await expect(page.locator('#stage')).toHaveScreenshot(`motion-nav-morph-${t}.png`);
  });

  test(`toolbar in a merge at ${t}`, async ({ page }) => {
    await openCase(page, `atom=toolbar&stage=merged&place=top&backdrop=light&glass=1&force=morph:${t}`);
    await attached(page, 'vire-toolbar > [data-vk-capsule]:not([hidden])');
    await nextFrame(page);
    await nextFrame(page);
    await expect(page.locator('#stage')).toHaveScreenshot(`motion-toolbar-merge-${t}.png`);
  });
}

test.describe('surfaces growing out of their trigger', () => {
  test.use({ viewport: { width: 1900, height: 1000 } });
  for (const [name, form] of [
    ['popover', 'popover'],
    ['sheet', 'bottom-sheet'],
  ] as const) {
    for (const t of T) {
      test(`${name} growing at ${t}`, async ({ page }) => {
        await openCase(page, `atom=sheet&form=${form}&state=grow:${t}&backdrop=light&glass=1`);
        await page.waitForFunction(() => document.querySelector('vire-popover,vire-sheet')?.getAttribute('data-phase') === 'growing');
        await attached(page, 'vire-popover > [popover], vire-sheet > [popover]');
        await nextFrame(page);
        await nextFrame(page);
        await expect(page.locator('#stage')).toHaveScreenshot(`motion-${name}-growth-${t}.png`);
      });
    }
  }
});

for (const backdrop of ['light', 'photo'] as const) {
  for (const at of [0.375, 0.5, 0.65]) {
    test(`the drag lens held at ${at} on ${backdrop}`, async ({ page }) => {
      await openCase(page, `atom=nav&form=bar&backdrop=${backdrop}&glass=1&state=drag:${at}`);
      await attached(page, 'vire-nav > nav, vire-nav > [data-vk-lens]');
      await nextFrame(page);
      await nextFrame(page);
      await expect(page.locator('#stage')).toHaveScreenshot(`motion-nav-drag-${at}-${backdrop}.png`);
    });
  }
}

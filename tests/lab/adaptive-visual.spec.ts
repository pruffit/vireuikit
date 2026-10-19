import { expect, test } from '@playwright/test';
import { nextFrame, openStage } from './helpers';

// The stage at a few presets that between them show every navigation form, both postures, the real side sheet and popover and
// the supporting pane. Baselines are per platform and move only on purpose.
const CASES = [
  ['phone-portrait', 'preset=phone-portrait&selected=2', 360, 800],
  ['phone-landscape', 'preset=phone-landscape&selected=2', 915, 412],
  ['foldable-book', 'preset=foldable-book&selected=2&surface=popover', 673, 841],
  ['foldable-tabletop', 'preset=foldable-tabletop&selected=2', 841, 673],
  ['tablet-landscape-sheet', 'preset=tablet-landscape&selected=2&surface=sheet', 1280, 800],
  ['desktop-wide-supporting', 'preset=desktop-wide&selected=2&pinned=1', 1440, 900],
] as const;

for (const [name, query, width, height] of CASES) {
  test(`adaptive stage: ${name}`, async ({ page }) => {
    await openStage(page, query, { width, height });
    if (query.includes('surface=')) {
      await page.waitForFunction(() => /url\(|blur/.test(document.querySelector<HTMLElement>('[data-phase] > :is(dialog, [popover])')!.style.backdropFilter));
      await nextFrame(page);
    }
    await expect(page.locator('#window')).toHaveScreenshot(`adaptive-${name}.png`);
  });
}

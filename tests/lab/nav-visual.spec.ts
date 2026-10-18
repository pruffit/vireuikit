import { expect, test, type Page } from '@playwright/test';
import { nextFrame, openCase } from './helpers';

// Each case is one navigation in its window frame over one backdrop: the bar, the minimised bar, the rail and the
// sidebar, with glass on and off, and the lens frozen at the middle of a change of form. Baselines are per platform
// and move only on purpose.
const FORMS = ['bar', 'minimized', 'rail', 'sidebar'] as const;
const BACKDROPS = ['light', 'photo'] as const;
const GLASS = [
  ['glass-on', '1'],
  ['glass-off', '0'],
] as const;

test.use({ viewport: { width: 1400, height: 1000 } });

/** Waits until every glass surface the case asked for is attached and has painted. */
async function ready(page: Page, glass: boolean, lens = false): Promise<void> {
  if (glass) {
    await page.waitForFunction((withLens) => {
      const host = document.querySelector('vire-nav')!;
      const attached = (el: Element | null) => /url\(|blur/.test((el as HTMLElement | null)?.style.backdropFilter ?? '');
      const parts = [host.querySelector(':scope > nav'), host.querySelector(':scope > [data-accessory]')];
      if (withLens) parts.push(host.querySelector(':scope > [data-vk-lens]'));
      return parts.every((part) => part === null || attached(part));
    }, lens);
  }
  await nextFrame(page);
  await nextFrame(page);
}

for (const form of FORMS) {
  for (const backdrop of BACKDROPS) {
    for (const [name, value] of GLASS) {
      test(`nav ${form} on ${backdrop}, ${name}`, async ({ page }) => {
        await openCase(page, `atom=nav&form=${form}&backdrop=${backdrop}&glass=${value}`);
        await ready(page, value === '1');
        await expect(page.locator('#stage')).toHaveScreenshot(`nav-${form}-${backdrop}-${name}.png`);
      });
    }
  }
}

test('nav in the middle of a change of form, the body contracted to the lens', async ({ page }) => {
  await openCase(page, 'atom=nav&form=rail&backdrop=light&glass=1&state=morph:bar:0.46');
  await ready(page, true, true);
  await expect(page.locator('#stage')).toHaveScreenshot('nav-morph-bar-rail-light-glass-on.png');
});

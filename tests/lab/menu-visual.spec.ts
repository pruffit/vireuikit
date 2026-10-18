import { expect, test } from '@playwright/test';
import { openCase } from './helpers';

// Each case is the menu gallery (closed, growing, open, an active and a pressed item, retracting; a disabled item in
// every menu) over one backdrop. Baselines are per platform and move only on purpose.
const BACKDROPS = ['light', 'dark', 'text', 'busy', 'photo'] as const;
const GLASS = [
  ['glass-on', '1'],
  ['glass-off', '0'],
] as const;

for (const backdrop of BACKDROPS) {
  for (const [name, value] of GLASS) {
    test(`menu on ${backdrop}, ${name}`, async ({ page }) => {
      await openCase(page, `atom=menu&backdrop=${backdrop}&glass=${value}`);
      await expect(page.locator('#stage')).toHaveScreenshot(`menu-${backdrop}-${name}.png`);
    });
  }
}

test('menu under reduced transparency and increased contrast, glass requested', async ({ page }) => {
  await openCase(page, 'atom=menu&backdrop=busy&glass=1&rt=1');
  await expect(page.locator('#stage')).toHaveScreenshot('menu-busy-reduce-transparency.png');
  await openCase(page, 'atom=menu&backdrop=busy&glass=1&ic=1');
  await expect(page.locator('#stage')).toHaveScreenshot('menu-busy-increase-contrast.png');
});

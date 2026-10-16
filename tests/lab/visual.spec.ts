import { expect, test } from '@playwright/test';
import { openCase } from './helpers';

// Every case is a row of the five states over one generated backdrop. Baselines are per platform
// and move only on purpose, in the same commit as the code that moves the look.
const BACKDROPS = ['light', 'dark', 'text', 'busy', 'photo'] as const;
const ATOMS = ['button', 'iconButton'] as const;
const GLASS = [
  ['glass-on', '1'],
  ['glass-off', '0'],
] as const;

for (const atom of ATOMS) {
  for (const backdrop of BACKDROPS) {
    for (const [name, value] of GLASS) {
      test(`${atom} on ${backdrop}, ${name}`, async ({ page }) => {
        await openCase(page, `atom=${atom}&backdrop=${backdrop}&glass=${value}`);
        await expect(page.locator('#stage')).toHaveScreenshot(`${atom}-${backdrop}-${name}.png`);
      });
    }
  }
}

test('reduced transparency and increased contrast, glass requested', async ({ page }) => {
  await openCase(page, 'atom=button&backdrop=busy&glass=1&rt=1');
  await expect(page.locator('#stage')).toHaveScreenshot('button-busy-reduce-transparency.png');
  await openCase(page, 'atom=button&backdrop=busy&glass=1&ic=1');
  await expect(page.locator('#stage')).toHaveScreenshot('button-busy-increase-contrast.png');
});

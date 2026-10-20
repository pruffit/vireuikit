import { expect, test } from '@playwright/test';
import { nextFrame, openCase } from './helpers';
import { settleGlass } from './legibility';

test.use({ viewport: { width: 1700, height: 1000 } });

const CASES: { name: string; query: string; glass?: boolean }[] = [
  { name: 'nav-dissolve', query: 'view=legibility&lg=nav-bar&backdrop=text' },
  { name: 'nav-dim', query: 'view=legibility&lg=nav-bar&backdrop=dark' },
  { name: 'nav-hard', query: 'view=legibility&lg=nav-bar&backdrop=text&edge=hard' },
  { name: 'nav-glass-off', query: 'view=legibility&lg=nav-bar&backdrop=text', glass: false },
  { name: 'toolbar-top-dissolve', query: 'view=legibility&lg=toolbar-top&backdrop=photo' },
  { name: 'toolbar-bottom-dissolve', query: 'view=legibility&lg=toolbar-bottom&backdrop=photo' },
  { name: 'toolbar-bottom-dim', query: 'view=legibility&lg=toolbar-bottom&backdrop=dark' },
];

for (const c of CASES) {
  test(`scroll edge: ${c.name}`, async ({ page }) => {
    const glass = c.glass !== false;
    await openCase(page, `${c.query}&glass=${glass ? 1 : 0}`);
    await settleGlass(page, glass);
    await expect(page.locator('#frame')).toHaveScreenshot(`scroll-edge-${c.name}.png`);
  });
}

test('scroll edge: a sheet\'s top strip over content scrolled beneath it', async ({ page }) => {
  await openCase(page, 'atom=sheet&form=bottom-sheet&detent=medium&backdrop=photo&glass=1');
  await page.waitForFunction(() => document.querySelector('vire-sheet')?.getAttribute('data-phase') === 'open');
  await settleGlass(page, true);
  await page.locator('vire-sheet > [popover]').evaluate((el) => (el.scrollTop = 140));
  await nextFrame(page);
  await nextFrame(page);
  await expect(page.locator('#stage')).toHaveScreenshot('scroll-edge-sheet-dissolve.png');
});

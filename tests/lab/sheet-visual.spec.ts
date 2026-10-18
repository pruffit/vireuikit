import { expect, test, type Page } from '@playwright/test';
import { nextFrame, openCase } from './helpers';

// Each case is one open surface in the window frame that gives it its form, over one backdrop with glass on and off:
// the popover, the popover as a sheet, the bottom sheet at each detent, the side sheet, the third pane, the centred
// sheet, the full-screen dialog, the basic dialog and the alert. Baselines are per platform and move only on purpose.
type Case = { name: string; query: string; /** The frame is wider than the surface needs: only its trailing part is compared. */ trailing?: number; glass?: boolean };

const CASES: Case[] = [
  { name: 'popover', query: 'form=popover' },
  { name: 'popover-sheet', query: 'form=popover-sheet' },
  { name: 'bottom-peek', query: 'form=bottom-sheet&detent=peek&content=filters' },
  { name: 'bottom-medium', query: 'form=bottom-sheet&detent=medium' },
  { name: 'bottom-large', query: 'form=bottom-sheet&detent=large' },
  { name: 'side-sheet', query: 'form=side-sheet', trailing: 760 },
  { name: 'third-pane', query: 'form=side-pane', trailing: 760, glass: false },
  { name: 'centered', query: 'form=centered-sheet' },
  { name: 'full-screen', query: 'form=full-screen', glass: false },
  { name: 'dialog', query: 'form=basic-dialog' },
  { name: 'alert', query: 'form=alert' },
];
const BACKDROPS = ['light', 'photo'] as const;
const GLASS = [
  ['glass-on', '1'],
  ['glass-off', '0'],
] as const;

test.use({ viewport: { width: 1900, height: 1000 } });

/** Waits until the surface has arrived and, where it is glass, its lens is attached and has painted. */
async function ready(page: Page, lens: boolean): Promise<void> {
  await page.waitForFunction(() => document.querySelector('vire-popover,vire-sheet')?.getAttribute('data-phase') === 'open');
  if (lens) {
    await page.waitForFunction(() => {
      const surface = document.querySelector<HTMLElement>('vire-popover > [popover], vire-sheet > dialog, vire-sheet > [popover]')!;
      return /url\(|blur/.test(surface.style.backdropFilter);
    });
  }
  await nextFrame(page);
  await nextFrame(page);
}

async function shot(page: Page, name: string, trailing?: number): Promise<void> {
  const stage = page.locator('#stage');
  if (!trailing) return expect(stage).toHaveScreenshot(name);
  const box = (await stage.boundingBox())!;
  await expect(page).toHaveScreenshot(name, { clip: { x: box.x + box.width - trailing - 36, y: box.y, width: trailing + 36, height: box.height } });
}

for (const c of CASES) {
  for (const backdrop of BACKDROPS) {
    for (const [name, value] of GLASS) {
      test(`sheet ${c.name} on ${backdrop}, ${name}`, async ({ page }) => {
        await openCase(page, `atom=sheet&${c.query}&backdrop=${backdrop}&glass=${value}`);
        await ready(page, value === '1' && c.glass !== false);
        await shot(page, `sheet-${c.name}-${backdrop}-${name}.png`, c.trailing);
      });
    }
  }
}

test('sheet in the middle of its growth, out of its trigger', async ({ page }) => {
  for (const [name, query] of [
    ['popover', 'form=popover&state=grow:0.8'],
    ['bottom', 'form=bottom-sheet&state=grow:0.5'],
  ] as const) {
    await openCase(page, `atom=sheet&${query}&backdrop=light&glass=1`);
    await page.waitForFunction(() => document.querySelector('vire-popover,vire-sheet')?.getAttribute('data-phase') === 'growing');
    await page.waitForFunction(() => /url\(|blur/.test(document.querySelector<HTMLElement>('vire-popover > [popover], vire-sheet > [popover]')!.style.backdropFilter));
    await nextFrame(page);
    await nextFrame(page);
    await expect(page.locator('#stage')).toHaveScreenshot(`sheet-growing-${name}-light-glass-on.png`);
  }
});

test('sheet under reduced transparency and increased contrast, glass requested', async ({ page }) => {
  for (const [name, flag] of [
    ['reduce-transparency', 'rt=1'],
    ['increase-contrast', 'ic=1'],
  ] as const) {
    for (const [label, query] of [
      ['bottom', 'form=bottom-sheet&detent=medium'],
      ['centered', 'form=centered-sheet'],
    ] as const) {
      await openCase(page, `atom=sheet&${query}&backdrop=photo&glass=1&${flag}`);
      await ready(page, false);
      await expect(page.locator('#stage')).toHaveScreenshot(`sheet-${label}-photo-${name}.png`);
    }
  }
});

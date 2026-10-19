import { expect, test, type Page } from '@playwright/test';
import { nextFrame, openCase } from './helpers';

// Each case is one toolbar in its window frame over one backdrop, held at a stage: separate capsules, merged
// neighbours, and overflow with "…", on the bottom edge, the top edge and the trailing strip, with glass on and off,
// frozen in the middle of a merge and of a bud, and under reduced transparency and increased contrast. Baselines are
// per platform and move only on purpose.
type Stage = 'separate' | 'merged' | 'overflow';
type Place = 'bottom' | 'top' | 'trailing';

test.use({ viewport: { width: 1400, height: 1000 } });

/** Waits until every capsule the case asked for has its lens attached and has painted. */
async function ready(page: Page, glass: boolean): Promise<void> {
  await page.waitForFunction(() => {
    const bar = document.querySelector('vire-toolbar');
    return bar?.hasAttribute('data-vk') && bar.hasAttribute('data-stage');
  });
  if (glass) {
    await page.waitForFunction(() => {
      const capsules = [...document.querySelectorAll<HTMLElement>('vire-toolbar > [data-vk-capsule]:not([hidden])')];
      return capsules.length > 0 && capsules.every((el) => /url\(|blur/.test(el.style.backdropFilter));
    });
  }
  await nextFrame(page);
  await nextFrame(page);
}

const CASES: { stage: Stage; place: Place; backdrop: 'light' | 'photo'; glass: boolean; extra?: string }[] = [
  ...(['separate', 'merged', 'overflow'] as const).flatMap((stage) =>
    (['light', 'photo'] as const).map((backdrop) => ({ stage, place: 'bottom' as const, backdrop, glass: true })),
  ),
  ...(['separate', 'merged', 'overflow'] as const).map((stage) => ({ stage, place: 'bottom' as const, backdrop: 'light' as const, glass: false })),
  ...(['separate', 'merged', 'overflow'] as const).map((stage) => ({ stage, place: 'top' as const, backdrop: 'light' as const, glass: true })),
  { stage: 'overflow', place: 'top', backdrop: 'photo', glass: true },
  { stage: 'merged', place: 'top', backdrop: 'light', glass: false },
  ...(['separate', 'merged', 'overflow'] as const).map((stage) => ({ stage, place: 'trailing' as const, backdrop: 'light' as const, glass: true })),
  { stage: 'separate', place: 'trailing', backdrop: 'photo', glass: true },
  { stage: 'overflow', place: 'trailing', backdrop: 'light', glass: false },
];

for (const c of CASES) {
  const name = `toolbar-${c.place}-${c.stage}-${c.backdrop}-${c.glass ? 'glass-on' : 'glass-off'}`;
  test(`toolbar ${c.place}, ${c.stage} on ${c.backdrop}, glass ${c.glass ? 'on' : 'off'}`, async ({ page }) => {
    await openCase(page, `atom=toolbar&stage=${c.stage}&place=${c.place}&backdrop=${c.backdrop}&glass=${c.glass ? 1 : 0}`);
    await ready(page, c.glass);
    await expect(page.locator('#stage')).toHaveScreenshot(`${name}.png`);
  });
}

test('toolbar in the middle of a merge, the neck between two capsules', async ({ page }) => {
  await openCase(page, 'atom=toolbar&stage=merged&place=top&backdrop=light&glass=1&force=morph:0.6');
  await ready(page, true);
  await expect(page.locator('#stage')).toHaveScreenshot('toolbar-top-morph-merged-light-glass-on.png');
});

test('toolbar in the middle of overflow, "…" budding out of the trailing end', async ({ page }) => {
  await openCase(page, 'atom=toolbar&stage=overflow&place=bottom&backdrop=light&glass=1&force=morph:0.45');
  await ready(page, true);
  await expect(page.locator('#stage')).toHaveScreenshot('toolbar-bottom-morph-overflow-light-glass-on.png');
});

test('toolbar under reduced transparency', async ({ page }) => {
  await openCase(page, 'atom=toolbar&stage=merged&place=bottom&backdrop=photo&glass=1&rt=1');
  await ready(page, true);
  await expect(page.locator('#stage')).toHaveScreenshot('toolbar-bottom-merged-photo-reduced-transparency.png');
});

test('toolbar under increased contrast', async ({ page }) => {
  await openCase(page, 'atom=toolbar&stage=merged&place=bottom&backdrop=light&glass=1&ic=1');
  await ready(page, true);
  await expect(page.locator('#stage')).toHaveScreenshot('toolbar-bottom-merged-light-increased-contrast.png');
});

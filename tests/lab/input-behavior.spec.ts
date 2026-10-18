import { expect, test, type Page } from '@playwright/test';
import { centerOf, emulateInput, openCase, type MediaInput } from './helpers';

const log = (page: Page) => page.locator('#log').evaluate((el) => (el.textContent ?? '').split('\n').filter(Boolean));
const slop = (page: Page, id: string) => page.locator(id).evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--vk-slop-y')));

const LAPTOP_WITH_TOUCH: MediaInput = { pointer: 'fine', anyCoarse: true, anyHover: true };
const PHONE: MediaInput = { pointer: 'coarse', anyCoarse: true, anyHover: false };
const DESKTOP: MediaInput = { pointer: 'fine', anyCoarse: false, anyHover: true };

/** What a laptop with a touch screen needs at once: the pointer's tier for layout and the finger's hit area. */
async function mixedGate(page: Page, input: MediaInput): Promise<{ size: string | null; menuRow: number; slop: number; ok: boolean }> {
  await emulateInput(page, input);
  await openCase(page, '', '/early.html');
  const size = await page.locator('#early-play').getAttribute('data-size');
  await openCase(page, '', '/early-menu.html');
  const menuRow = await page.locator('#early-menu').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--vk-menu-row')));
  await openCase(page, 'view=sandbox&size=medium&glass=0');
  const reach = await slop(page, '#share');
  return { size, menuRow, slop: reach, ok: size === 'medium' && menuRow === 32 && reach === 6 };
}

test.describe('three input layers', () => {
  test('a laptop with a touch screen keeps the pointer tier and still reaches the finger\'s hit area', async ({ page }) => {
    const gate = await mixedGate(page, LAPTOP_WITH_TOUCH);
    expect(gate).toEqual({ size: 'medium', menuRow: 32, slop: 6, ok: true });
    const { box, y } = await centerOf(page.locator('#share button'));
    const hitAt = (dx: number) =>
      page.evaluate(([px, py]) => (document.elementFromPoint(px!, py!) as HTMLElement | null)?.closest('vire-icon-button')?.id ?? '', [box.x - dx, y]);
    expect(await hitAt(5)).toBe('share');
    expect(await hitAt(9)).toBe('');
  });

  test('canary: a single coarse flag fails that gate whichever way it reads', async ({ page }) => {
    expect((await mixedGate(page, PHONE)).ok).toBe(false);
    const fine = await mixedGate(page, DESKTOP);
    expect(fine).toMatchObject({ size: 'medium', slop: 0, ok: false });
  });

  test('a phone gets the finger tier and the finger\'s hit area from the same layers', async ({ page }) => {
    const gate = await mixedGate(page, PHONE);
    expect(gate).toMatchObject({ size: 'touch', menuRow: 44, slop: 6 });
  });

  test('the input override beats the system, live, and the system comes back when it is cleared', async ({ page }) => {
    await emulateInput(page, DESKTOP);
    await openCase(page, 'view=sandbox&size=medium&glass=0');
    expect(await slop(page, '#share')).toBe(0);
    await page.evaluate(() => window.__lab.setInputOverride({ anyCoarse: true }));
    await expect.poll(() => slop(page, '#share')).toBe(6);
    await page.evaluate(() => window.__lab.setInputOverride({ anyCoarse: undefined }));
    await expect.poll(() => slop(page, '#share')).toBe(0);
  });

  test('a device that gains or loses touch moves the hit area with it, not the layout', async ({ page }) => {
    await emulateInput(page, DESKTOP);
    await openCase(page, '', '/early.html');
    const before = await page.locator('#early-play button').boundingBox();
    await page.evaluate(() => (window as unknown as { __input: { set(n: object): void } }).__input.set({ anyCoarse: true }));
    await expect.poll(() => slop(page, '#early-share')).toBeGreaterThan(0);
    await expect(page.locator('#early-play')).toHaveAttribute('data-size', 'medium');
    expect(await page.locator('#early-play button').boundingBox()).toEqual(before);
  });
});

test.describe('hover belongs to the event', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('a mouse on a touch-first device hovers', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    expect(await page.evaluate(() => window.__lab.input())).toMatchObject({ primary: 'coarse', hover: false });
    await page.locator('#play button').hover();
    await expect(page.locator('#play')).toHaveAttribute('data-hovered', '');
  });

  test('a finger never hovers, even where the pointer is primary', async ({ page }) => {
    await emulateInput(page, LAPTOP_WITH_TOUCH);
    await openCase(page, 'view=sandbox&glass=0');
    const { x, y } = await centerOf(page.locator('#play button'));
    await page.touchscreen.tap(x, y);
    expect(await log(page)).toEqual(['click:play']);
    await expect(page.locator('#play')).not.toHaveAttribute('data-hovered', '');
  });
});

test.describe('losing the hover', () => {
  test('a hover that is showing goes when the device can no longer hover, and a press is left alone', async ({ page }) => {
    await emulateInput(page, DESKTOP);
    await openCase(page, 'view=sandbox&glass=0');
    await page.locator('#play button').hover();
    await expect(page.locator('#play')).toHaveAttribute('data-hovered', '');
    await page.mouse.down();
    await expect(page.locator('#play')).toHaveAttribute('data-pressed', '');
    await page.evaluate(() => (window as unknown as { __input: { set(n: object): void } }).__input.set({ anyHover: false }));
    await expect(page.locator('#play')).not.toHaveAttribute('data-hovered', '');
    await expect(page.locator('#play')).toHaveAttribute('data-pressed', '');
    await page.mouse.up();
    expect(await log(page)).toEqual(['click:play']);
  });
});

test.describe('a hardware keyboard', () => {
  test('is known from a key pressed outside a field; typing into a field does not count', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    expect(await page.evaluate(() => window.__lab.input().keyboard)).toBe(false);
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.id = 'field';
      document.body.append(field);
    });
    await page.locator('#field').pressSequentially('ab');
    expect(await page.evaluate(() => window.__lab.input().keyboard)).toBe(false);
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'shadow-host';
      host.attachShadow({ mode: 'open' }).append(document.createElement('input'));
      document.body.append(host);
    });
    await page.locator('#shadow-host input').pressSequentially('cd');
    expect(await page.evaluate(() => window.__lab.input().keyboard)).toBe(false);
    await page.locator('#shadow-host input').blur();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => window.__lab.input().keyboard)).toBe(true);
  });
});

type MenuFrame = { x: number; y: number; w: number; h: number; open: boolean };

async function recordMenu(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const list = document.getElementById(id)!.querySelector<HTMLElement>(':scope > [popover]')!;
    const frames: MenuFrame[] = [];
    (window as unknown as { __menuFrames: MenuFrame[] }).__menuFrames = frames;
    const loop = () => {
      const r = list.getBoundingClientRect();
      frames.push({ x: r.x, y: r.y, w: r.width, h: r.height, open: list.matches(':popover-open') });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, id);
}

const menuFrames = (page: Page) =>
  page.evaluate(() => (window as unknown as { __menuFrames: MenuFrame[] }).__menuFrames.filter((f) => f.open && f.w > 0));

async function displayFeature(page: Page, orientation: 'vertical' | 'horizontal', offset: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const size = page.viewportSize()!;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: size.width,
    height: size.height,
    deviceScaleFactor: 1,
    mobile: false,
    displayFeature: { orientation, offset, maskLength: 0 },
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { viewport?: { segments?: unknown[] } }).viewport?.segments?.length ?? 1)).toBe(2);
}

test.describe('a menu on a folding screen', () => {
  test('beside a vertical fold it stays in its trigger\'s segment on every frame of the growth', async ({ page }) => {
    await openCase(page, 'view=menu');
    const trigger = (await page.locator('#more > vire-icon-button').boundingBox())!;
    const foldX = Math.round(trigger.x + trigger.width + 40);
    await displayFeature(page, 'vertical', foldX);
    await recordMenu(page, 'more');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const frames = await menuFrames(page);
    expect(frames.length).toBeGreaterThan(5);
    for (const f of frames) expect(f.x + f.w).toBeLessThanOrEqual(foldX + 0.5);
    await page.keyboard.press('Escape');
  });

  test('above a horizontal fold a menu taller than its segment scrolls inside it rather than crossing', async ({ page }) => {
    await openCase(page, 'view=menu');
    const trigger = (await page.locator('#more > vire-icon-button').boundingBox())!;
    const foldY = Math.round(trigger.y + trigger.height + 120);
    await displayFeature(page, 'horizontal', foldY);
    await recordMenu(page, 'more');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    for (const f of await menuFrames(page)) expect(f.y + f.h).toBeLessThanOrEqual(foldY + 0.5);
    expect(await page.locator('#more-list').evaluate((el) => el.hasAttribute('data-scroll'))).toBe(true);
  });

  test('canary: without the segments the same menu crosses where the fold would be', async ({ page }) => {
    await openCase(page, 'view=menu');
    const trigger = (await page.locator('#more > vire-icon-button').boundingBox())!;
    const foldX = Math.round(trigger.x + trigger.width + 40);
    await recordMenu(page, 'more');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const frames = await menuFrames(page);
    expect(frames.some((f) => f.x + f.w > foldX + 0.5)).toBe(true);
  });
});

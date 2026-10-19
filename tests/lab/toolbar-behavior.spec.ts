import { expect, test, type Page } from '@playwright/test';
import { toolbarLayout, toolbarLayoutWithHysteresis, type ToolbarItem, type ToolbarLayout } from '../../src';
import type { ToolbarSnapshot } from '../../lab/toolbar';
import { emulateInput, nextFrame, openCase } from './helpers';

const log = (page: Page) => page.locator('#log').evaluate((el) => (el.textContent ?? '').split('\n').filter(Boolean));
const clicks = async (page: Page) => (await log(page)).filter((line) => line.startsWith('click:'));
const snap = (page: Page) => page.evaluate(() => window.__lab.toolbar!.snapshot());

const settle = async (page: Page) => {
  await page.waitForFunction(() => {
    const bar = document.querySelector('vire-toolbar');
    return bar?.hasAttribute('data-vk') && bar.hasAttribute('data-stage') && !bar.hasAttribute('data-moving');
  });
  await nextFrame(page);
};

/** Opens the sandbox in a window of `w` × `h` dp and waits until the toolbar has settled. */
async function openToolbar(page: Page, query = '', w = 720, h = 500): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openCase(page, `view=toolbar&w=${w}&h=${h}&${query}`);
  await settle(page);
}

const resize = (page: Page, w: number, h: number) => page.evaluate(([width, height]) => window.__lab.toolbar!.resize(width!, height!), [w, h]);

/** Resizes the window and waits for the change to land. */
async function reflow(page: Page, w: number, h: number): Promise<void> {
  await resize(page, w, h);
  await nextFrame(page);
  await nextFrame(page);
  await settle(page);
}

const TOP = 'toolbar-placement=top';
const TIER = 'medium';

/** The sandbox's items as the model sees them; the main action's width is read from the page. */
const items = (done: number): ToolbarItem[] => [
  { id: 'Back', kind: 'icon', priority: 9, group: 'g0' },
  { id: 'Share', kind: 'icon', priority: 5, group: 'g1' },
  { id: 'Like', kind: 'icon', priority: 6, badge: true, group: 'g1' },
  { id: 'Add', kind: 'icon', priority: 4, group: 'g1' },
  { id: 'Info', kind: 'icon', priority: 3, group: 'g1' },
  { id: 'Queue', kind: 'icon', priority: 2, group: 'g1' },
  { id: 'Edit', kind: 'icon', priority: 2, group: 'g2' },
  { id: 'Delete', kind: 'icon', priority: 1, group: 'g2' },
  { id: 'Done', kind: 'text', primary: true, priority: 9, width: done, group: 'g3' },
];

const doneWidth = async (page: Page) => (await snap(page)).items.find((i) => i.label === 'Done')!.box.w;
const SIDE = 32;

const shown = (s: ToolbarSnapshot) => s.items.filter((i) => !i.hidden).map((i) => i.label);
const visibleLabels = (layout: ToolbarLayout, all: ToolbarItem[]) => all.filter((i) => !layout.overflow.includes(i.id)).map((i) => i.id);

// ---- before the upgrade -----------------------------------------------------------------------------------------------

test.describe('before the upgrade', () => {
  test('groups of buttons that wrap, every button its own Tab stop, nothing hidden, no role', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await openCase(page, 'view=toolbar&w=260&h=500&upgrade=0&glass=0');
    const bar = page.locator('vire-toolbar');
    await expect(bar).not.toHaveAttribute('role', /./);
    await expect(bar).not.toHaveAttribute('data-vk', /./);
    const buttons = page.locator('vire-toolbar button');
    const total = await buttons.count();
    const tabbable = await buttons.evaluateAll((els) => els.filter((el) => el.closest('[popover]') === null).length);
    expect(tabbable).toBeGreaterThan(8);
    for (let i = 0; i < total; i += 1) {
      expect(await buttons.nth(i).getAttribute('tabindex')).toBeNull();
      if (!(await buttons.nth(i).evaluate((el) => el.closest('[popover]') !== null))) await expect(buttons.nth(i)).toBeVisible();
    }
    // The groups wrap onto more than one row and nothing scrolls sideways.
    const tops = await page.locator('vire-toolbar [data-group] > *').evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
    expect(tops).toBeGreaterThan(1);
    const scroll = await bar.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(scroll.sw).toBeLessThanOrEqual(scroll.cw);
    // Tab walks all of them.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Tab');
    const seen = new Set<string>();
    for (let i = 0; i < tabbable + 2; i += 1) {
      seen.add(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id || (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || ''));
      await page.keyboard.press('Tab');
    }
    expect(seen.size).toBeGreaterThanOrEqual(tabbable);
  });
});

// ---- roles and keys ---------------------------------------------------------------------------------------------------

test.describe('roles and keys', () => {
  test('the upgrade makes it the APG toolbar: a role, the author\'s label, the orientation and one Tab stop', async ({ page }) => {
    await openToolbar(page, `${TOP}&glass=0`);
    const bar = page.locator('vire-toolbar');
    await expect(bar).toHaveAttribute('role', 'toolbar');
    await expect(bar).toHaveAttribute('aria-label', 'Track actions');
    await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
    const stops = await bar.evaluate((el) => [...el.querySelectorAll('button')].filter((b) => !b.closest('[hidden]') && b.getAttribute('tabindex') === '0').length);
    expect(stops).toBe(1);
    await page.locator('body').click({ position: { x: 900, y: 900 } });
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(first).toBe('Back');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('vire-toolbar'))).toBeNull();
  });

  test('the arrows move along the axis, Home and End go to the ends, a disabled item is passed over, and Tab comes back to the last one', async ({ page }) => {
    await openToolbar(page, `${TOP}&glass=0`);
    await page.evaluate(() => {
      (document.getElementById('toolbar-add-trigger') as HTMLButtonElement).disabled = true;
    });
    await nextFrame(page);
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim());
    await page.locator('vire-toolbar button[aria-label="Share"]').focus();
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('Like');
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('Info');
    await page.keyboard.press('ArrowLeft');
    expect(await active()).toBe('Like');
    await page.keyboard.press('End');
    expect(await active()).toBe('Done');
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('Done');
    await page.keyboard.press('Home');
    expect(await active()).toBe('Back');
    await page.keyboard.press('ArrowDown');
    expect(await active()).toBe('Back');
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('vire-toolbar'))).toBeNull();
    await page.keyboard.press('Shift+Tab');
    expect(await active()).toBe('Done');
    const stops = await page.locator('vire-toolbar').evaluate((el) => [...el.querySelectorAll('button')].filter((b) => b.getAttribute('tabindex') === '0').map((b) => b.getAttribute('aria-label') ?? b.textContent!.trim()));
    expect(stops).toEqual(['Done']);
  });

  test('removing the element gives the markup back', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await openCase(page, 'view=toolbar&w=720&h=500&upgrade=0&glass=1&toolbar-placement=top&surfaces=1');
    // The attributes a menu restores come back in the order it re-adds them, so the markup is compared by what it says.
    const canon = () =>
      page.evaluate(() => {
        const walk = (el: Element): string =>
          `<${el.localName} ${[...el.attributes].map((a) => `${a.name}=${a.value}`).sort().join(' ')}>${[...el.childNodes].map((n) => (n.nodeType === 1 ? walk(n as Element) : n.textContent)).join('')}</${el.localName}>`;
        return walk(document.getElementById('toolbar')!);
      });
    const before = await canon();
    await page.evaluate(() => window.__lab.define());
    await page.waitForFunction(() => document.getElementById('toolbar')!.hasAttribute('data-vk'));
    await nextFrame(page);
    await expect(page.locator('vire-toolbar')).toHaveAttribute('role', 'toolbar');
    expect(await page.locator('vire-toolbar [data-vk-capsule]').count()).toBeGreaterThan(0);
    const after = await page.evaluate(() => {
      const bar = document.getElementById('toolbar')!;
      bar.remove();
      const walk = (el: Element): string =>
        `<${el.localName} ${[...el.attributes].map((a) => `${a.name}=${a.value}`).sort().join(' ')}>${[...el.childNodes].map((n) => (n.nodeType === 1 ? walk(n as Element) : n.textContent)).join('')}</${el.localName}>`;
      return walk(bar);
    });
    expect(after).toBe(before);
  });
});

// ---- the model's layout -----------------------------------------------------------------------------------------------

test.describe('layout', () => {
  test('what shows is the model\'s at every width from 0 to the widest, narrowing and widening', async ({ page }) => {
    await openToolbar(page, `${TOP}&glass=0&rm=1`, 720, 400);
    const all = items(await doneWidth(page));
    const full = toolbarLayout(all, { available: 1e6, tier: TIER });
    let previous: ToolbarLayout | null = null;
    const widths = [...Array.from({ length: 80 }, (_, i) => full.extent + 40 - i * 8), 12, 4, 0];
    const failures: string[] = [];
    const check = async (w: number, down: boolean) => {
      await reflow(page, w + 16, 400);
      const s = await snap(page);
      const options = { available: s.width, tier: TIER, orientation: 'horizontal' as const };
      const expected: ToolbarLayout = down ? toolbarLayout(all, options) : toolbarLayoutWithHysteresis(all, options, previous);
      previous = expected;
      const want = visibleLabels(expected, all);
      const got = shown(s).filter((label) => all.some((i) => i.id === label));
      if (want.join() !== got.join()) failures.push(`${s.width}: want ${want.join(' ')} got ${got.join(' ')}`);
      if ((expected.overflow.length > 0) === s.more!.hidden) failures.push(`${s.width}: "…" ${s.more!.hidden ? 'hidden' : 'shown'} with ${expected.overflow.length} overflowed`);
      if (s.stage !== expected.stage) failures.push(`${s.width}: stage ${s.stage}, want ${expected.stage}`);
    };
    for (const w of widths.filter((x) => x >= 0)) await check(w, true);
    previous = toolbarLayout(all, { available: 0, tier: TIER });
    for (const w of [...widths].reverse()) await check(w, false);
    expect(failures).toEqual([]);
  });

  test('a badged item and the main action never overflow, and "…" has no badge', async ({ page }) => {
    await openToolbar(page, `${TOP}&glass=0&rm=1`, 720, 400);
    for (const w of [300, 200, 120, 80]) {
      await reflow(page, w, 400);
      const s = await snap(page);
      expect(shown(s)).toEqual(expect.arrayContaining(['Like', 'Done']));
      expect(s.more!.hidden).toBe(false);
    }
    expect(await page.locator('[data-vk-more] [data-badge]').count()).toBe(0);
  });

  test('the bottom edge floats 8 dp above the navigation, the top edge stays in flow, and the strip stands at the trailing side with its text in a row at the foot', async ({ page }) => {
    await openToolbar(page, 'glass=0&rm=1', 390, 720);
    const frame = page.locator('#frame');
    const bar = page.locator('vire-toolbar');
    await expect(bar).toHaveAttribute('data-edge', 'bottom');
    await expect(bar).toHaveAttribute('data-orientation', 'horizontal');
    await frame.evaluate((el) => el.style.setProperty('--vire-nav-inset-bottom', '60px'));
    // With no spacer the capsules are centred in what the toolbar has.
    await page.evaluate(() => document.querySelector('vire-toolbar [data-spacer]')!.remove());
    await nextFrame(page);
    await nextFrame(page);
    const f = (await frame.boundingBox())!;
    const b = (await bar.boundingBox())!;
    expect(Math.round(f.y + f.height - (b.y + b.height))).toBe(68);
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
    const centred = await bar.evaluate((el) => {
      const kids = [...el.querySelectorAll<HTMLElement>('[data-vk-item]:not([hidden])')].map((k) => k.getBoundingClientRect());
      const bar = el.getBoundingClientRect();
      const left = Math.min(...kids.map((k) => k.left)) - bar.left;
      const right = bar.right - Math.max(...kids.map((k) => k.right));
      return Math.abs(left - right);
    });
    expect(centred).toBeLessThan(2);

    await reflow(page, 720, 500);
    await expect(bar).toHaveAttribute('data-edge', 'top');
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('relative');
    const top = (await bar.boundingBox())!;
    const topFrame = (await frame.boundingBox())!;
    expect(top.y - topFrame.y).toBeLessThanOrEqual(16);

    await reflow(page, 740, 360);
    await expect(bar).toHaveAttribute('data-edge', 'trailing');
    await expect(bar).toHaveAttribute('data-orientation', 'vertical');
    await expect(bar).toHaveAttribute('aria-orientation', 'vertical');
    const strip = await snap(page);
    const side = (await bar.boundingBox())!;
    const stripFrame = (await frame.boundingBox())!;
    expect(Math.round(stripFrame.x + stripFrame.width - (side.x + side.width))).toBe(8);
    expect(side.height).toBeGreaterThan(side.width * 3);
    const done = strip.items.find((i) => i.label === 'Done')!;
    expect(done.hidden).toBe(false);
    expect(done.box.w).toBeGreaterThan(done.box.h);
    const icons = strip.items.filter((i) => !i.hidden && !i.text);
    for (const icon of icons) expect(done.box.y).toBeGreaterThanOrEqual(icon.box.y + icon.box.h);
    for (const icon of icons) expect(icon.box.w).toBe(icon.box.h);
  });
});

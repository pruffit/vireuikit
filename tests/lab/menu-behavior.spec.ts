import { expect, test, type Page } from '@playwright/test';
import type { VireMenuElement } from '../../src/web';
import { openCase } from './helpers';
import { regionStats, type Region } from './measure';

const log = (page: Page) =>
  page.locator('#log').evaluate((el) => (el.textContent ?? '').split('\n').filter(Boolean));
const isOpen = (page: Page, id = 'more') => page.locator(`#${id}-list`).evaluate((el) => el.matches(':popover-open'));
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el?.id || el?.textContent?.trim() || el?.tagName || '';
  });
const DARK = { luma: 0.06, busy: 0, lo: 0.06, hi: 0.06, r: 0.06, g: 0.06, b: 0.06 };
const openNow = (page: Page, id = 'more') => expect(page.locator(`#${id}`)).toHaveAttribute('data-phase', 'open');

// VIREUIKIT_CPU_THROTTLE=4 runs the whole file on a CPU slowed through the DevTools protocol, to show it does not flake.
const THROTTLE = Number(process.env.VIREUIKIT_CPU_THROTTLE ?? 1);
if (THROTTLE > 1) {
  test.beforeEach(async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  });
}

test.describe('before the upgrade', () => {
  test('the platform popover opens, closes on a choice, Escape and a press outside, and gives focus back', async ({ page }) => {
    await openCase(page, 'view=menu&upgrade=0&glass=0');
    await expect(page.locator('vire-menu[data-vk]')).toHaveCount(0);
    const trigger = page.locator('#more-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');
    expect(await isOpen(page)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('Copy link');
    await page.keyboard.press('Escape');
    expect(await isOpen(page)).toBe(false);
    expect(await focused(page)).toBe('more-trigger');

    await trigger.click();
    await page.getByRole('button', { name: 'Rename' }).click();
    expect(await log(page)).toEqual(['click:rename']);
    expect(await isOpen(page)).toBe(false);
    expect(await focused(page)).toBe('more-trigger');

    await trigger.click();
    await page.mouse.click(850, 650);
    expect(await isOpen(page)).toBe(false);
    await expect(page.locator('#more-list button').nth(2)).toBeDisabled();
  });
});

test.describe('roles', () => {
  test('the upgrade adds the menu-button semantics', async ({ page }) => {
    await openCase(page, 'view=menu');
    const trigger = page.locator('#more-trigger');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveAttribute('aria-controls', 'more-list');
    expect(await trigger.getAttribute('popovertarget')).toBeNull();
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'More' });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = menu.getByRole('menuitem');
    await expect(items).toHaveCount(6);
    await expect(items.nth(2)).toBeDisabled();
    expect(await items.nth(2).evaluate((el) => [el.hasAttribute('disabled'), el.getAttribute('aria-disabled')])).toEqual([true, null]);
    await expect(items.nth(4)).toBeDisabled();
    expect(await items.nth(4).evaluate((el) => [el.hasAttribute('disabled'), el.getAttribute('aria-disabled')])).toEqual([false, 'true']);
    for (const tabindex of await items.evaluateAll((els) => els.map((el) => el.getAttribute('tabindex')))) {
      expect(tabindex).toBe('-1');
    }
  });

  test('removing the element gives the markup back, and connecting it again upgrades it', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 200 });
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await openNow(page);
    expect(await page.locator('#more-list').evaluate((el) => el.hasAttribute('data-scroll'))).toBe(true);
    const read = () =>
      page.evaluate(() => {
        const menu = (window as unknown as { __menu: HTMLElement }).__menu;
        const trigger = menu.querySelector('#more-trigger')!;
        const list = menu.querySelector('[popover]')!;
        const deleted = list.querySelectorAll('button')[2]!;
        return {
          target: trigger.getAttribute('popovertarget'),
          haspopup: trigger.getAttribute('aria-haspopup'),
          popover: list.getAttribute('popover'),
          role: list.getAttribute('role'),
          item: list.querySelector('button')!.getAttribute('popovertargetaction'),
          itemRole: list.querySelector('button')!.getAttribute('role'),
          disabled: deleted.hasAttribute('disabled'),
          ariaDisabled: deleted.getAttribute('aria-disabled'),
          listAttributes: [...list.attributes].map((a) => a.name).sort(),
          menuStyle: menu.getAttribute('style'),
          open: list.matches(':popover-open'),
        };
      });
    await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('#more')!;
      (window as unknown as { __menu: HTMLElement; __parent: HTMLElement }).__menu = menu;
      (window as unknown as { __parent: HTMLElement }).__parent = menu.parentElement!;
      menu.remove();
    });
    expect(await read()).toEqual({
      target: 'more-list',
      haspopup: null,
      popover: '',
      role: null,
      item: 'hide',
      itemRole: null,
      disabled: true,
      ariaDisabled: null,
      listAttributes: ['id', 'popover'],
      menuStyle: null,
      open: false,
    });
    await page.evaluate(() => {
      const w = window as unknown as { __menu: HTMLElement; __parent: HTMLElement };
      w.__parent.append(w.__menu);
    });
    expect(await read()).toMatchObject({ target: null, haspopup: 'menu', popover: 'manual', role: 'menu', itemRole: 'menuitem', disabled: true, ariaDisabled: null });
  });

  test('an item taken out of the menu gets its markup back', async ({ page }) => {
    await openCase(page, 'view=menu');
    const taken = await page.evaluate(() => {
      const items = document.querySelectorAll('#more-list > button');
      const rename = items[1]!;
      const remove = items[2]!;
      rename.remove();
      remove.remove();
      return new Promise<string[][]>((resolve) =>
        requestAnimationFrame(() =>
          resolve(
            [rename, remove].map((el) =>
              ['role', 'tabindex', 'popovertarget', 'popovertargetaction', 'disabled', 'aria-disabled'].map((n) => `${n}=${el.getAttribute(n)}`),
            ),
          ),
        ),
      );
    });
    expect(taken[0]).toEqual(['role=null', 'tabindex=null', 'popovertarget=more-list', 'popovertargetaction=hide', 'disabled=null', 'aria-disabled=null']);
    expect(taken[1]).toEqual(['role=null', 'tabindex=null', 'popovertarget=more-list', 'popovertargetaction=hide', 'disabled=', 'aria-disabled=null']);
  });
});

test.describe('keyboard', () => {
  for (const [key, expected] of [
    ['Enter', 'Copy link'],
    ['Space', 'Copy link'],
    ['ArrowDown', 'Copy link'],
    ['ArrowUp', 'Copy text'],
  ] as const) {
    test(`the trigger opens it from the keyboard: ${key} lands on ${expected}`, async ({ page }) => {
      await openCase(page, 'view=menu');
      await page.locator('#more-trigger').focus();
      await page.keyboard.press(key);
      await expect.poll(() => focused(page)).toBe(expected);
      await expect(page.locator('#more-trigger')).toHaveAttribute('aria-expanded', 'true');
    });
  }

  test('a pointer opens it with focus on the menu and no item active', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    expect(await focused(page)).toBe('more-list');
    expect(await page.locator('#more-list button:focus').count()).toBe(0);
  });

  // Delete is a native disabled button, which cannot take focus; Pin is aria-disabled, which can (WAI-ARIA APG).
  test('arrows, Home, End and typeahead pass over a natively disabled item, land on an aria-disabled one, and wrap', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    const steps: [string, string][] = [
      ['ArrowDown', 'Rename'],
      ['ArrowDown', 'Remove from list'],
      ['ArrowDown', 'Pin'],
      ['ArrowDown', 'Copy text'],
      ['ArrowDown', 'Copy link'],
      ['ArrowUp', 'Copy text'],
      ['Home', 'Copy link'],
      ['End', 'Copy text'],
      ['p', 'Pin'],
      ['d', 'Pin'],
      ['Home', 'Copy link'],
    ];
    for (const [key, expected] of steps) {
      await page.keyboard.press(key);
      expect(await focused(page), key).toBe(expected);
    }
    // Typed together, letters refine the match; the events carry their own time, so a slow machine cannot split them.
    const typed = (keys: string[]) =>
      page.evaluate((keys) => {
        for (const key of keys) document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        return document.activeElement?.textContent?.trim();
      }, keys);
    expect(await typed(['r', 'e', 'm'])).toBe('Remove from list');
    await page.waitForTimeout(600);
    expect(await typed(['c'])).toBe('Copy text');
    expect(await typed(['c'])).toBe('Copy link');
  });

  test('the pointer makes an item active', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    await page.getByRole('menuitem', { name: 'Remove from list' }).hover();
    expect(await focused(page)).toBe('Remove from list');
  });
});

test.describe('choice and dismissal', () => {
  test('a choice closes the menu, returns focus to the trigger and clicks the item once', async ({ page }) => {
    await openCase(page, 'view=menu');
    const trigger = page.locator('#more-trigger');
    await trigger.click();
    await openNow(page);
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    expect(await log(page)).toEqual(['click:rename']);
    expect(await focused(page)).toBe('more-trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => isOpen(page)).toBe(false);

    await page.keyboard.press('Enter');
    await openNow(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await log(page)).toEqual(['click:rename', 'click:rename']);
    expect(await focused(page)).toBe('more-trigger');
  });

  test('a choice closes the menu even when the item\'s own handler stops the click', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.evaluate(() => {
      const rename = [...document.querySelectorAll('#more-list button')].find((b) => b.textContent === 'Rename')!;
      rename.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('log')!.textContent += 'own:rename\n';
      });
    });
    await page.locator('#more-trigger').click();
    await openNow(page);
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    expect(await log(page)).toEqual(['own:rename']);
    await expect(page.locator('#more-trigger')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test('an aria-disabled item can be reached but not chosen, and a natively disabled one cannot be chosen either', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await openNow(page);
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp');
    expect(await focused(page)).toBe('Pin');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.getByRole('menuitem', { name: 'Pin' }).click({ force: true });
    await page.getByRole('menuitem', { name: 'Delete' }).click({ force: true });
    expect(await log(page)).toEqual([]);
    expect(await isOpen(page)).toBe(true);
    await expect(page.locator('#more-trigger')).toHaveAttribute('aria-expanded', 'true');
  });
});

// Both stay the author's after the upgrade: React sets disabled={true} with setAttribute and clears it with removeAttribute.
test.describe('disabled items stay the author\'s', () => {
  const rename = (page: Page) => page.locator('#more-list > button').nth(1);
  const afterFirst = async (page: Page) => {
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    return focused(page);
  };
  const openByKey = async (page: Page) => {
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await openNow(page);
  };

  test('native disabled set, cleared and set again, by attribute and by property', async ({ page }) => {
    await openCase(page, 'view=menu');
    await openByKey(page);
    expect(await afterFirst(page)).toBe('Rename');
    await rename(page).evaluate((el) => el.setAttribute('disabled', ''));
    // The focused item turned disabled: focus stays in the menu rather than dropping to the page.
    await expect.poll(() => focused(page)).toBe('more-list');
    expect(await afterFirst(page)).toBe('Remove from list');
    await rename(page).evaluate((el) => el.removeAttribute('disabled'));
    expect(await afterFirst(page)).toBe('Rename');
    await rename(page).evaluate((el) => ((el as HTMLButtonElement).disabled = true));
    expect(await afterFirst(page)).toBe('Remove from list');
    await page.getByRole('menuitem', { name: 'Rename' }).click({ force: true });
    expect(await log(page)).toEqual([]);
    await rename(page).evaluate((el) => ((el as HTMLButtonElement).disabled = false));
    expect(await afterFirst(page)).toBe('Rename');
    expect(await rename(page).evaluate((el) => [el.hasAttribute('disabled'), el.getAttribute('aria-disabled')])).toEqual([false, null]);
    await page.keyboard.press('Enter');
    expect(await log(page)).toEqual(['click:rename']);
    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test('aria-disabled set, cleared and set again', async ({ page }) => {
    await openCase(page, 'view=menu');
    await openByKey(page);
    await rename(page).evaluate((el) => el.setAttribute('aria-disabled', 'true'));
    expect(await afterFirst(page)).toBe('Rename');
    await page.keyboard.press('Enter');
    expect(await log(page)).toEqual([]);
    expect(await isOpen(page)).toBe(true);
    await rename(page).evaluate((el) => el.removeAttribute('aria-disabled'));
    await page.keyboard.press('Enter');
    expect(await log(page)).toEqual(['click:rename']);
    await expect.poll(() => isOpen(page)).toBe(false);
    await openByKey(page);
    await rename(page).evaluate((el) => el.setAttribute('aria-disabled', 'true'));
    expect(await afterFirst(page)).toBe('Rename');
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Rename' }).click({ force: true });
    expect(await log(page)).toEqual(['click:rename']);
    expect(await isOpen(page)).toBe(true);
    expect(await rename(page).evaluate((el) => [el.hasAttribute('disabled'), el.getAttribute('aria-disabled')])).toEqual([false, 'true']);
  });
});

// The menu grows in under the pointer that opened it, and the first item lands where the trigger was.
test.describe('input that began on the trigger', () => {
  test('a double click on the trigger opens the menu and chooses nothing', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').dblclick();
    await openNow(page);
    await page.waitForTimeout(300);
    expect(await log(page)).toEqual([]);
    expect(await isOpen(page)).toBe(true);
  });

  for (const gap of [40, 120, 200, 250]) {
    test(`a second click ${gap} ms after the first chooses nothing while the content is still arriving`, async ({ page }) => {
      await openCase(page, 'view=menu');
      const box = (await page.locator('#more-trigger').boundingBox())!;
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.click(x, y);
      await page.waitForTimeout(gap);
      await page.mouse.click(x, y);
      await openNow(page);
      expect(await log(page)).toEqual([]);
      expect(await isOpen(page)).toBe(true);
    });
  }

  for (const key of ['Enter', 'Space']) {
    test(`${key} held on the trigger opens the menu once and chooses nothing`, async ({ page }) => {
      await openCase(page, 'view=menu');
      await page.locator('#more-trigger').focus();
      await page.keyboard.down(key);
      await page.keyboard.down(key);
      await page.keyboard.down(key);
      await page.keyboard.up(key);
      await openNow(page);
      await page.waitForTimeout(200);
      expect(await log(page)).toEqual([]);
      expect(await isOpen(page)).toBe(true);
      expect(await focused(page)).toBe('Copy link');
    });
  }

  test('Enter held on an item chooses it once and does not open the menu again', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await openNow(page);
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect.poll(() => isOpen(page)).toBe(false);
    expect(await log(page)).toEqual(['click:copy']);
    await expect(page.locator('#more-trigger')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a second Enter before the content has arrived chooses nothing', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').focus();
    await page.evaluate(() => {
      const trigger = document.getElementById('more-trigger')!;
      trigger.click();
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      (document.activeElement as HTMLElement).click();
    });
    await openNow(page);
    expect(await log(page)).toEqual([]);
    expect(await isOpen(page)).toBe(true);
  });

  // Judged inside the first frame the content is drawn (opaque, still out of focus), while the surface still grows.
  test('a key chooses as soon as the content shows, where a pointer click there still waits for the menu', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    const seen = await page.evaluate(
      () =>
        new Promise<{ phase: string | null; afterPointer: string; afterKey: string }>((resolve) => {
          const list = document.getElementById('more-list')!;
          const read = () => document.getElementById('log')!.textContent!.trim();
          const step = () => {
            if (Number(list.style.getPropertyValue('--vk-ink-in')) < 0.1) return requestAnimationFrame(step);
            const item = document.activeElement as HTMLElement;
            const phase = document.getElementById('more')!.getAttribute('data-phase');
            item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
            const afterPointer = read();
            // What Enter does on a focused button: a click with no pointer behind it.
            item.click();
            resolve({ phase, afterPointer, afterKey: read() });
          };
          requestAnimationFrame(step);
        }),
    );
    expect(seen).toEqual({ phase: 'moving', afterPointer: '', afterKey: 'click:copy' });
  });

  test('the items take no pointer until the menu has arrived: no hover, no press, no hit on a row that is drawn elsewhere', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    const first = page.locator('#more-list button').first();
    await expect.poll(() => page.locator('#more').getAttribute('data-phase')).toBe('moving');
    expect(await first.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    const hit = await page.evaluate(() => {
      const box = document.getElementById('more-list')!.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.id ?? 'item';
    });
    expect(hit).toBe('more-list');
    await openNow(page);
    await expect(page.locator('#more')).toHaveAttribute('data-arrived', '');
    expect(await first.evaluate((el) => getComputedStyle(el).pointerEvents)).not.toBe('none');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('#more').getAttribute('data-arrived')).toBeNull();
  });

  test('a click after the content has arrived still chooses', async ({ page }) => {
    await openCase(page, 'view=menu');
    const box = (await page.locator('#more-trigger').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await openNow(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await log(page)).toEqual(['click:copy']);
    await expect.poll(() => isOpen(page)).toBe(false);
  });
});

test.describe('dismissal', () => {

  test('Escape closes and returns focus to the trigger', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    expect(await focused(page)).toBe('more-trigger');
    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test('a press outside closes without taking focus back', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await page.mouse.click(850, 650);
    await expect.poll(() => isOpen(page)).toBe(false);
    expect(await focused(page)).not.toBe('more-trigger');
    expect(await log(page)).toEqual([]);
  });

  test('Tab closes, and focus moves on from the trigger', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('sort-trigger');
    await expect(page.locator('#more-trigger')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => isOpen(page)).toBe(false);
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Tab');
    expect(await focused(page)).toBe('before');
  });
});

type Frame = {
  open: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  ink: number;
  carried: boolean;
  phase: string | null;
  /** The trigger's own lens, body and rim as rendered. */
  triggerLens: string;
  triggerBody: string;
  triggerRim: string;
  source: 'frame' | 'click' | 'key';
};

/** Records the surface on every frame, and right after the element's own click and key handlers. */
async function record(page: Page, id = 'more'): Promise<void> {
  await page.evaluate((id) => {
    const menu = document.getElementById(id)!;
    const list = menu.querySelector<HTMLElement>(':scope > [popover]')!;
    const carrier = menu.querySelector(':scope > vire-icon-button, :scope > vire-button');
    const button = menu.querySelector<HTMLElement>(':scope > vire-icon-button > button, :scope > vire-button > button');
    const frames: Frame[] = [];
    (window as unknown as { __frames: Frame[] }).__frames = frames;
    const snap = (source: Frame['source']) => {
      const r = list.getBoundingClientRect();
      const ink = list.style.getPropertyValue('--vk-ink-in');
      frames.push({
        open: list.matches(':popover-open'),
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        radius: parseFloat(getComputedStyle(list).borderTopLeftRadius),
        ink: ink === '' ? 1 : Number(ink),
        carried: carrier?.hasAttribute('data-carried') ?? false,
        phase: menu.getAttribute('data-phase'),
        triggerLens: button ? getComputedStyle(button).backdropFilter : 'none',
        triggerBody: button ? getComputedStyle(button).backgroundColor : 'rgba(0, 0, 0, 0)',
        triggerRim: button ? getComputedStyle(button, '::after').visibility : 'hidden',
        source,
      });
    };
    document.addEventListener('click', () => snap('click'));
    document.addEventListener('keydown', () => snap('key'));
    const loop = () => {
      snap('frame');
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, id);
}

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
const mark = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.length);

type Run = { opening: Frame[]; closing: Frame[]; trigger: { x: number; y: number; width: number; height: number } };

// The drop is smaller than a 44 dp trigger for about 30 ms; a quarter-speed clock lets every frame be seen.
async function slowTime(page: Page, factor = 0.25): Promise<void> {
  await page.addInitScript((k) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => cb(t * k));
  }, factor);
}

async function openAndClose(page: Page, query: string): Promise<Run> {
  await slowTime(page);
  await openCase(page, query);
  const trigger = (await page.locator('#more > vire-icon-button').boundingBox())!;
  await record(page);
  const start = await mark(page);
  await page.locator('#more-trigger').click();
  await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
  await page.waitForTimeout(150);
  const middle = await mark(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => isOpen(page)).toBe(false);
  await page.waitForTimeout(50);
  const all = await frames(page);
  return {
    opening: all.slice(start, middle).filter((f) => f.open),
    closing: all.slice(middle).filter((f) => f.open),
    trigger,
  };
}

const near = (a: number, b: number, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

/** The surface starts on the trigger, passes a drop smaller than it, and overshoots the menu's width before settling. */
function grows(run: Run): boolean {
  const { opening, trigger } = run;
  const first = opening[0]!;
  const last = opening.at(-1)!;
  const smallest = Math.min(...opening.map((f) => Math.max(f.w, f.h)));
  const widest = Math.max(...opening.map((f) => f.w));
  return (
    near(first.x, trigger.x) &&
    near(first.y, trigger.y) &&
    near(first.w, trigger.width) &&
    near(first.h, trigger.height) &&
    smallest < trigger.height * 0.9 &&
    widest / last.w > 1.005 &&
    widest / last.w < 1.08
  );
}

test.describe('growth', () => {
  test('the surface starts on the trigger, passes a drop and lands on the menu', async ({ page }) => {
    const run = await openAndClose(page, 'view=menu');
    expect(grows(run)).toBe(true);
    const first = run.opening[0]!;
    expect(near(first.radius, run.trigger.height / 2)).toBe(true);
    const last = run.opening.at(-1)!;
    for (const f of run.opening) if (f.w < last.w * 0.7) expect(f.ink).toBe(0);
    expect(last.ink).toBe(1);
  });

  test('the menu pins to the trigger\'s corner and covers it', async ({ page }) => {
    const { opening, trigger } = await openAndClose(page, 'view=menu');
    const last = opening.at(-1)!;
    expect(near(last.x, trigger.x, 0.5)).toBe(true);
    expect(near(last.y, trigger.y, 0.5)).toBe(true);
    expect(last.w).toBeGreaterThan(trigger.width);
    expect(last.h).toBeGreaterThan(trigger.height);
  });

  test('closing runs back through the drop into the trigger, the content going first', async ({ page }) => {
    const { opening, closing, trigger } = await openAndClose(page, 'view=menu');
    const menu = opening.at(-1)!;
    const end = closing.at(-1)!;
    expect(Math.max(...closing.map((f) => Math.max(f.w, f.h)))).toBeGreaterThan(menu.h * 0.9);
    expect(Math.min(...closing.map((f) => Math.max(f.w, f.h)))).toBeLessThanOrEqual(trigger.height * 1.3);
    expect(near(end.x, trigger.x) && near(end.y, trigger.y) && near(end.w, trigger.width) && near(end.h, trigger.height)).toBe(true);
    for (const f of closing) if (f.h < menu.h * 0.65) expect(f.ink).toBeLessThan(0.1);
  });

  test('canary: a menu that pops open without growing fails it', async ({ page }) => {
    const run = await openAndClose(page, 'view=menu&rm=1');
    expect(grows(run)).toBe(false);
  });

  test('reopening while it closes turns back from where it is', async ({ page }) => {
    await slowTime(page);
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await openNow(page);
    await record(page);
    // Counted in frames, not milliseconds, so a slow machine turns back at the same point of the closing.
    const turn = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const list = document.getElementById('more-list')!;
          list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          let left = 4;
          const step = () => {
            if ((left -= 1) > 0) return requestAnimationFrame(step);
            document.getElementById('more-trigger')!.click();
            resolve((window as unknown as { __frames: unknown[] }).__frames.length);
          };
          requestAnimationFrame(step);
        }),
    );
    await openNow(page);
    const after = (await frames(page)).slice(turn);
    expect(after.every((f) => f.open)).toBe(true);
    expect(Math.min(...after.map((f) => f.h))).toBeGreaterThan(44);
    await expect(page.locator('#more-trigger')).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('one body', () => {
  for (const glass of ['1', 'touch']) {
    test(`while the menu grows, is out and retracts, the trigger draws no lens, body or rim (glass=${glass})`, async ({ page }) => {
      const { opening, closing } = await openAndClose(page, `view=menu&glass=${glass}`);
      const out = [...opening, ...closing];
      expect(out.length).toBeGreaterThan(10);
      for (const f of out) {
        expect(f.carried).toBe(true);
        expect(f.triggerLens).toBe('none');
        expect(f.triggerBody).toBe('rgba(0, 0, 0, 0)');
        expect(f.triggerRim).toBe('hidden');
      }
    });
  }

  test('a trigger whose lens appears only under the finger goes back to no lens at rest', async ({ page }) => {
    await openCase(page, 'view=menu&glass=touch');
    const lens = () =>
      page.locator('#more-trigger').evaluate((el) => {
        const id = /#([\w-]+)/.exec(el.style.backdropFilter)?.[1];
        const filter = document.getElementById(id ?? '');
        return {
          blur: filter?.querySelector('feGaussianBlur')?.getAttribute('stdDeviation') ?? null,
          displacement: [...(filter?.querySelectorAll('feDisplacementMap') ?? [])].map((d) => d.getAttribute('scale')),
          shadow: el.style.boxShadow,
        };
      });
    const before = await lens();
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await openNow(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page)).toBe(false);
    await expect.poll(lens).toEqual(before);
  });

  test('the trigger hands its body over while the menu is out and takes it back', async ({ page }) => {
    await openCase(page, 'view=menu');
    const host = page.locator('#more > vire-icon-button');
    const button = page.locator('#more-trigger');
    const lensBlur = () =>
      button.evaluate((el) => {
        const id = /#([\w-]+)/.exec(el.style.backdropFilter)?.[1];
        return Number(document.getElementById(id ?? '')?.querySelector('feGaussianBlur')?.getAttribute('stdDeviation') ?? NaN);
      });
    const background = () => button.evaluate((el) => getComputedStyle(el).backgroundColor);
    const restBlur = await lensBlur();
    expect(restBlur).toBeGreaterThan(0);
    await button.click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    await expect(host).toHaveAttribute('data-carried', '');
    expect(await background()).toBe('rgba(0, 0, 0, 0)');
    expect(await lensBlur()).toBeNaN();
    expect(await button.evaluate((el) => getComputedStyle(el, '::after').visibility)).toBe('hidden');
    expect(await host.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--vk-carry')))).toBe(0);
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page)).toBe(false);
    await expect(host).not.toHaveAttribute('data-carried', '');
    expect(await background()).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.move(5, 5);
    await expect.poll(lensBlur).toBe(restBlur);
  });

  test('the surface scatters what lies under it several times more softly than the control it grew from', async ({ page }) => {
    await openCase(page, 'view=menu');
    const blurOf = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const id = /#([\w-]+)/.exec((el as HTMLElement).style.backdropFilter)?.[1];
        return Number(document.getElementById(id ?? '')?.querySelector('feGaussianBlur')?.getAttribute('stdDeviation') ?? NaN);
      });
    const control = await blurOf('#more-trigger');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const menu = await blurOf('#more-list');
    expect(menu).toBeGreaterThan(control * 3);
    expect(menu).toBeGreaterThanOrEqual(8);
  });

  test('the surface is the only lens', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    expect(await page.locator('#more-list').evaluate((el) => el.style.backdropFilter)).toContain('url(');
    const itemFilters = await page.locator('#more-list button').evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.backdropFilter + getComputedStyle(el).backdropFilter),
    );
    for (const filter of itemFilters) expect(filter).toBe('none');
  });
});

// The recording stand-in for `vireglass/dom` sees exactly what the element hands the lens.
const RECORDING_LENS = `
const flat = { luma: 0.9, busy: 0, lo: 0.9, hi: 0.9, r: 0.9, g: 0.9, b: 0.9 };
export function probeBackdrop() { return flat; }
export function statsFromSamples() { return flat; }
export function attachGlass(el, opts) {
  const rec = { id: el.id, calls: [] };
  (window.__lenses ??= []).push(rec);
  el.style.setProperty('backdrop-filter', 'blur(1px)');
  const note = (morph) => rec.calls.push({ geometry: { ...opts.geometry }, morph });
  return {
    update() { note(undefined); },
    setMorph(m) { note(m); },
    setAppear(t) { rec.appear = t; },
    setSample() {}, setInterim() {}, setAccent() {}, setNeighbourGlow() {},
    destroy() {},
  };
}`;

test.describe('the core\'s morph', () => {
  test('while the drop and the capsule are joined the surface is drawn as their union and the lens is handed no second shape', async ({ page }) => {
    await page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS }));
    await openCase(page, 'view=menu');
    await page.evaluate(() => {
      const list = document.getElementById('more-list')!;
      const seen: boolean[] = [];
      (window as unknown as { __outlines: boolean[] }).__outlines = seen;
      const loop = () => {
        seen.push(list.style.getPropertyValue('--vk-outline') !== '');
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    type Call = { geometry: { width: number; height: number }; morph: unknown };
    const calls = await page.evaluate(
      () => (window as unknown as { __lenses: { id: string; calls: Call[] }[] }).__lenses.find((l) => l.id === 'more-list')!.calls,
    );
    expect(calls[0]!.geometry).toMatchObject({ width: 44, height: 44 });
    expect(calls.filter((c) => c.morph)).toHaveLength(0);
    const outlines = await page.evaluate(() => (window as unknown as { __outlines: boolean[] }).__outlines);
    expect(outlines.filter(Boolean).length).toBeGreaterThan(1);
    expect(outlines.at(-1)).toBe(false);
    expect(calls.at(-1)!.geometry.width).toBeGreaterThan(44 * 3);
  });

  test('a scroll or a resize while the menu is out costs the lens nothing and lays out once a frame', async ({ page }) => {
    await page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS }));
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await openNow(page);
    const calls = () =>
      page.evaluate(() => (window as unknown as { __lenses: { id: string; calls: unknown[] }[] }).__lenses.find((l) => l.id === 'more-list')!.calls.length);
    const before = await calls();
    const measured = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let toggles = 0;
          const menu = document.getElementById('more')!;
          const watch = new MutationObserver((records) => (toggles += records.length));
          watch.observe(menu, { attributes: true, attributeFilter: ['data-measure'] });
          for (let i = 0; i < 10; i += 1) {
            document.dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new Event('resize'));
          }
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              watch.disconnect();
              resolve(toggles);
            }),
          );
        }),
    );
    expect(measured).toBe(0);
    expect(await calls()).toBe(before);
  });
});

test.describe('while the surface is one body of the capsule and the drop', () => {
  const clipOf = (page: Page) => page.locator('#more-trigger').evaluate((el) => (el as HTMLElement).style.clipPath);
  const joined = (page: Page) => page.locator('#more').evaluate((el) => el.hasAttribute('data-joined'));
  const gone = async (page: Page) => {
    expect(await joined(page)).toBe(false);
    expect(await clipOf(page)).toBe('');
  };

  test('the trigger is cut to the body from where the trigger is now, after the page moves under a growing menu', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      document.getElementById('more')!.style.position = 'relative';
      document.getElementById('more')!.style.top = '30px';
      window.dispatchEvent(new Event('resize'));
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const read = () =>
      page.evaluate(() => {
        const button = document.getElementById('more-trigger')!.getBoundingClientRect();
        const list = document.getElementById('more-list')!.getBoundingClientRect();
        const inset = document.getElementById('more-trigger')!.style.clipPath.split(' round')[0]!.match(/[0-9.]+/g);
        return {
          moving: document.getElementById('more')!.getAttribute('data-phase') === 'moving',
          inset: inset ? inset.slice(0, 4).map(Number) : null,
          want: [Math.max(list.y - button.y, 0), Math.max(button.x + button.width - (list.x + list.width), 0), Math.max(button.y + button.height - (list.y + list.height), 0), Math.max(list.x - button.x, 0)],
        };
      });
    const seen = await read();
    expect(seen.moving).toBe(true);
    expect(seen.inset).not.toBeNull();
    seen.inset!.forEach((v, i) => expect(Math.abs(v - seen.want[i]!)).toBeLessThan(2));
  });

  test('the light that bleeds past the drop is a hidden element while the menu grows, and is gone once it has settled and when it closes', async ({ page }) => {
    await openCase(page, 'view=menu');
    const halos = () => page.locator('#more').evaluate((el) => ({ n: el.querySelectorAll(':scope > [data-vk-halo]').length, hidden: el.querySelector(':scope > [data-vk-halo]')?.getAttribute('aria-hidden') ?? null, vars: [...el.style].filter((k) => k.startsWith('--vk-halo')).length }));
    await page.locator('#more-trigger').click();
    await page.waitForTimeout(150);
    expect(await halos()).toMatchObject({ n: 1, hidden: 'true' });
    await openNow(page);
    expect(await halos()).toEqual({ n: 0, hidden: null, vars: 0 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    expect((await halos()).n).toBeLessThanOrEqual(1);
    await expect.poll(() => isOpen(page)).toBe(false);
    expect(await halos()).toEqual({ n: 0, hidden: null, vars: 0 });
  });

  test('closing midway and opening again leaves neither the joined window nor the clip behind', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await page.waitForTimeout(120);
    expect(await joined(page)).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    await page.locator('#more-trigger').click({ force: true });
    await openNow(page);
    await gone(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page)).toBe(false);
    await gone(page);
  });

  test('removing the menu mid-growth takes both away', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await page.waitForTimeout(120);
    const left = await page.evaluate(() => {
      const menu = document.getElementById('more')!;
      const trigger = document.getElementById('more-trigger')!;
      menu.remove();
      return { joined: menu.hasAttribute('data-joined'), clip: trigger.style.clipPath };
    });
    expect(left).toEqual({ joined: false, clip: '' });
  });

  test('reduced motion turned on mid-growth lands the menu and takes both away', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await page.waitForTimeout(120);
    expect(await joined(page)).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openNow(page);
    await gone(page);
  });
});

test.describe('the ink', () => {
  test('the ink holds while the menu is out, and the backdrop is read again on the next open', async ({ page }) => {
    await openCase(page, 'view=menu&backdrop=light');
    // The page behind the stage is the backdrop too, wherever the menu reaches past the stage.
    const page_ = (color: string) => page.addStyleTag({ content: `html,body{background:${color}!important}` });
    await page_('#f2f2f4');
    const ink = () => page.locator('#more-list').evaluate((el) => el.style.getPropertyValue('--vireglass-ink'));
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    expect(await ink()).toBe('0');
    await page.evaluate(() => {
      document.getElementById('stage')!.setAttribute('data-backdrop', 'dark');
      window.dispatchEvent(new Event('resize'));
    });
    await page_('#15161a');
    await page.waitForTimeout(100);
    expect(await ink()).toBe('0');
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page)).toBe(false);
    await page.locator('#more-trigger').click();
    await expect.poll(ink).toBe('1');
  });

  test('a sample on the menu reaches its surface, set before the element is defined or after', async ({ page }) => {
    await openCase(page, 'view=menu&upgrade=0&backdrop=light&glass=0');
    await page.evaluate((dark) => {
      (document.querySelector('#more') as VireMenuElement).sample = dark;
      window.__lab.define();
      document.querySelector('#more')!.setAttribute('glass', '');
      document.querySelector('#sort')!.setAttribute('glass', '');
      (document.querySelector('#sort') as VireMenuElement).sample = dark;
    }, DARK);
    for (const id of ['more', 'sort']) {
      await expect.poll(() => page.locator(`#${id}-list`).evaluate((el) => el.style.backdropFilter)).toContain('url(');
      await page.locator(`#${id}-trigger`).click();
      await expect.poll(() => page.locator(`#${id}-list`).evaluate((el) => el.style.getPropertyValue('--vireglass-ink'))).toBe('1');
      await page.keyboard.press('Escape');
      await expect.poll(() => isOpen(page, id)).toBe(false);
    }
  });
});

test.describe('accessibility modes', () => {
  test('reduced motion opens and closes in one frame, the content in focus at once', async ({ page }) => {
    await openCase(page, 'view=menu&rm=1');
    await record(page);
    const start = await mark(page);
    await page.locator('#more-trigger').click();
    const opened = (await frames(page)).slice(start).find((f) => f.source === 'click')!;
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const settled = (await frames(page)).at(-1)!;
    expect(opened.open).toBe(true);
    expect([opened.x, opened.y, opened.w, opened.h]).toEqual([settled.x, settled.y, settled.w, settled.h]);
    expect(opened.ink).toBe(1);
    const before = await mark(page);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await frames(page)).slice(before).some((f) => f.source === 'key')).toBe(true);
    const closed = (await frames(page)).slice(before).find((f) => f.source === 'key')!;
    expect(closed.open).toBe(false);
  });

  test('the system setting is followed when nothing overrides it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    expect(await page.locator('#more').getAttribute('data-phase')).toBe('open');
  });

  test('reduced transparency keeps the lens on the surface and frosts it', async ({ page }) => {
    const alpha = async () => {
      await page.locator('#more-trigger').click();
      await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
      return page.locator('#more-list').evaluate((el) => Number(el.style.getPropertyValue('--vk-body-alpha')));
    };
    await openCase(page, 'view=menu&glass=1&rt=0');
    const clear = await alpha();
    await openCase(page, 'view=menu&glass=1&rt=1');
    await expect(page.locator('#more')).toHaveAttribute('data-frost', '');
    const frosted = await alpha();
    expect(await page.locator('#more-list').evaluate((el) => el.style.backdropFilter)).toContain('url(');
    expect(frosted).toBeGreaterThan(clear * 2);
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    expect(await log(page)).toEqual(['click:rename']);
  });

  test('increased contrast borders the surface', async ({ page }) => {
    await openCase(page, 'view=menu&glass=0&ic=1');
    await expect(page.locator('#more')).toHaveAttribute('data-contrast', '');
    await page.locator('#more-trigger').click();
    expect(await page.locator('#more-list').evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');
  });
});

test.describe('glass and its absence', () => {
  test('glass off leaves a complete menu that still grows', async ({ page }) => {
    const run = await openAndClose(page, 'view=menu&glass=0');
    expect(grows(run)).toBe(true);
    await expect(page.locator('#more')).toHaveAttribute('data-surface', 'plain');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const list = page.locator('#more-list');
    expect(await list.evaluate((el) => el.style.backdropFilter)).toBe('');
    expect(await list.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/rgba\(.*, 0\)$/);
    await page.getByRole('menuitem', { name: 'Copy text' }).click();
    expect(await log(page)).toEqual(['click:text']);
  });

  test('a lens that fails to load leaves the menu working on its plain surface', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/vireglass_dom.js*', (route) => route.abort());
    await page.goto('/?chrome=0&view=menu&glass=1');
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    const menu = page.locator('#more');
    await expect(menu).toHaveAttribute('data-glass', 'off');
    await expect(menu).toHaveAttribute('data-surface', 'plain');
    await page.locator('#more-trigger').click();
    await openNow(page);
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    expect(await log(page)).toEqual(['click:rename']);
    expect(errors).toEqual([]);
  });
});

test.describe('forced colours', () => {
  test('the surface, the active item and a disabled item take system colours', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openCase(page, 'view=menu&glass=1');
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const colours = await page.evaluate(() => {
      const probe = (css: string, prop: 'backgroundColor' | 'color') => {
        const el = document.createElement('div');
        el.style.cssText = css;
        document.body.append(el);
        const value = getComputedStyle(el)[prop];
        el.remove();
        return value;
      };
      const list = document.getElementById('more-list')!;
      const items = list.querySelectorAll('button');
      return {
        surface: getComputedStyle(list).backgroundColor,
        canvas: probe('background:Canvas', 'backgroundColor'),
        active: getComputedStyle(items[0]!).backgroundColor,
        highlight: probe('background:Highlight', 'backgroundColor'),
        disabled: getComputedStyle(items[2]!).color,
        gray: probe('color:GrayText', 'color'),
      };
    });
    expect(colours.surface).toBe(colours.canvas);
    expect(colours.active).toBe(colours.highlight);
    expect(colours.disabled).toBe(colours.gray);
  });

  test('the carried trigger fades with the growth instead of standing over the drop', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openCase(page, 'atom=menu&state=growing');
    const button = page.locator('#menu-growing-trigger');
    await expect(page.locator('#menu-growing > vire-icon-button')).toHaveAttribute('data-carried', '');
    expect(await button.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(0);
    await page.locator('#menu-growing').evaluate((el) => el.removeAttribute('data-vire-force-state'));
    await expect.poll(() => button.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
  });
});

test.describe('upgrade while the page is parsed', () => {
  test('elements defined before the markup adopt the trigger and the list, and items added later get their role', async ({ page }) => {
    await openCase(page, '', '/early-menu.html');
    await expect(page.locator('#early-menu')).toHaveAttribute('data-vk', '');
    await expect(page.locator('#early-menu button')).toHaveCount(3);
    await expect(page.locator('#early-trigger')).toHaveAttribute('aria-haspopup', 'menu');
    await page.locator('#early-trigger').click();
    await expect(page.getByRole('menu', { name: 'More' }).getByRole('menuitem')).toHaveCount(2);
    await page.evaluate(() => {
      const late = document.createElement('button');
      late.type = 'button';
      late.textContent = 'Three';
      document.getElementById('early-list')!.append(late);
    });
    await expect(page.getByRole('menuitem', { name: 'Three' })).toHaveAttribute('tabindex', '-1');
    await openNow(page, 'early-menu');
    await page.getByRole('menuitem', { name: 'Two' }).click();
    expect(await log(page)).toEqual(['click:Two']);
  });
});

test.describe('attributes and forced states', () => {
  test('glass is parsed as on the buttons: "off" or an unknown value is no glass', async ({ page }) => {
    await openCase(page, 'view=menu');
    const menu = page.locator('#more');
    await expect(menu).toHaveAttribute('data-glass', 'on');
    for (const [value, expected] of [['off', 'off'], ['nonsense', 'off'], ['present', 'on'], ['touch', 'on'], ['', 'on']] as const) {
      await menu.evaluate((el, v) => el.setAttribute('glass', v), value);
      await expect(menu, value).toHaveAttribute('data-glass', expected);
    }
    await menu.evaluate((el) => el.removeAttribute('glass'));
    await expect(menu).toHaveAttribute('data-glass', 'off');
  });

  test('taking a forced state away closes the menu and resets aria-expanded', async ({ page }) => {
    await openCase(page, 'atom=menu&state=open');
    const trigger = page.locator('#menu-open-trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#menu-open').evaluate((el) => el.removeAttribute('data-vire-force-state'));
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(await isOpen(page, 'menu-open')).toBe(false);
  });

  test('the list\'s own toggle event fires once the growth has run back, aria-expanded as the closing begins', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await openNow(page);
    const order = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const out: string[] = [];
          const list = document.getElementById('more-list')!;
          const trigger = document.getElementById('more-trigger')!;
          new MutationObserver(() => out.push('expanded=' + trigger.getAttribute('aria-expanded'))).observe(trigger, {
            attributes: true,
            attributeFilter: ['aria-expanded'],
          });
          list.addEventListener('toggle', (e) => {
            out.push('toggle=' + (e as ToggleEvent).newState + '@' + (list.getBoundingClientRect().height < 45 ? 'trigger' : 'menu'));
            resolve(out);
          });
          list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }),
    );
    expect(order).toEqual(['expanded=false', 'toggle=closed@trigger']);
  });
});

// A closed shadow root hides everything inside it from a listener on the document.
test.describe('inside a closed shadow root', () => {
  type Shadow = { root: ShadowRoot; picks: string[] };

  async function shadowMenu(page: Page) {
    await openCase(page, 'view=menu&glass=1');
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'shadow-host';
      host.style.cssText = 'position:absolute;left:420px;top:300px;width:420px;height:320px';
      document.body.append(host);
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML =
        '<div id="pad" style="position:absolute;inset:0;background:#eef"></div>' +
        '<vire-menu id="shadow-menu" glass style="position:absolute;left:24px;top:24px">' +
        '<vire-icon-button glass><button id="shadow-trigger" type="button" popovertarget="shadow-list" aria-label="More">M</button></vire-icon-button>' +
        '<div id="shadow-list" popover>' +
        '<button type="button" popovertarget="shadow-list" popovertargetaction="hide">Copy link</button>' +
        '<button type="button" popovertarget="shadow-list" popovertargetaction="hide">Rename</button>' +
        '</div></vire-menu>';
      const shadow = { root, picks: [] as string[] };
      (window as unknown as { __shadow: typeof shadow }).__shadow = shadow;
      root.getElementById('shadow-list')!.addEventListener('click', (e) => shadow.picks.push((e.target as HTMLElement).textContent!));
    });
    await page.waitForFunction(() => /url\(/.test((window as unknown as { __shadow: { root: ShadowRoot } }).__shadow.root.getElementById('shadow-list')!.style.backdropFilter));
  }
  const centreOf = (page: Page, id: string, label?: string) =>
    page.evaluate(
      ([id, label]) => {
        const root = (window as unknown as { __shadow: { root: ShadowRoot } }).__shadow.root;
        const el = label ? [...root.getElementById(id)!.querySelectorAll('button')].find((b) => b.textContent === label)! : root.getElementById(id)!;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      [id, label] as const,
    );
  const state = (page: Page) =>
    page.evaluate(() => {
      const { root, picks } = (window as unknown as { __shadow: Shadow }).__shadow;
      return {
        open: root.getElementById('shadow-list')!.matches(':popover-open'),
        phase: root.getElementById('shadow-menu')!.getAttribute('data-phase'),
        picks: [...picks],
      };
    });

  test('a choice inside it is a choice, and a press elsewhere in it or outside it dismisses', async ({ page }) => {
    await shadowMenu(page);
    const trigger = await centreOf(page, 'shadow-trigger');
    const openIt = async () => {
      await page.mouse.click(trigger.x, trigger.y);
      await expect.poll(async () => (await state(page)).phase).toBe('open');
    };
    await openIt();
    const rename = await centreOf(page, 'shadow-list', 'Rename');
    await page.mouse.click(rename.x, rename.y);
    expect((await state(page)).picks).toEqual(['Rename']);
    await expect.poll(async () => (await state(page)).open).toBe(false);

    await openIt();
    await page.mouse.click(800, 600);
    await expect.poll(async () => (await state(page)).open).toBe(false);

    await openIt();
    await page.mouse.click(60, 650);
    await expect.poll(async () => (await state(page)).open).toBe(false);
    expect((await state(page)).picks).toEqual(['Rename']);
  });
});

test.describe('size', () => {
  test('rows are as tall as the tier and the menu is concentric with its items', async ({ page }) => {
    await openCase(page, 'view=menu&size=touch');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const list = page.locator('#more-list');
    expect((await list.locator('button').first().boundingBox())!.height).toBe(44);
    expect(await list.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('35px');
    expect(await list.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('13px');
    expect(await list.locator('button').first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('22px');
  });
});

// Measured like the reference menu: the open surface minus the same pixels with no menu at all, in a text-free
// region (the room left after the labels). Over the mid grey, the backdrop nearest the reference's, it is held within
// 0.05 of the reference's +0.058 to +0.072 as the controls are (B26); elsewhere it has to stand off at all.
test.describe('the menu\'s body', () => {
  const DPR = 2;
  test.use({ deviceScaleFactor: DPR });

  async function againstBackdrop(page: Page, backdrop: string, force: string, region: (box: Region) => Region, css = '') {
    await openCase(page, `atom=menu&state=open&backdrop=${backdrop}&glass=1`);
    if (css) await page.addStyleTag({ content: css });
    await page.locator('#menu-open').evaluate((el, force) => el.setAttribute('data-vire-force-state', force), force);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const stage = page.locator('#stage');
    const origin = (await stage.boundingBox())!;
    const box = (await page.locator('#menu-open-list').boundingBox())!;
    const at = region({ x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height });
    const scaled = { x: at.x * DPR, y: at.y * DPR, width: at.width * DPR, height: at.height * DPR };
    const withMenu = await regionStats(page, await stage.screenshot(), scaled);
    await page.locator('#menu-open').evaluate((el) => ((el as HTMLElement).style.visibility = 'hidden'));
    const bare = await regionStats(page, await stage.screenshot(), scaled);
    return { dL: withMenu.L - bare.L, dC: withMenu.C - bare.C, L: withMenu.L };
  }

  const trailing = (box: Region): Region => ({ x: box.x + box.width - 57 + 6, y: box.y + 19, width: 57 - 13 - 12, height: box.height - 38 });
  const centre = (box: Region): Region => ({ x: box.x + box.width / 4, y: box.y + box.height / 4, width: box.width / 2, height: box.height / 2 });

  const REFERENCE_DL = 0.065;
  const holds = (m: { dL: number; dC: number }) => m.dL >= 0.02 && Math.abs(m.dL - REFERENCE_DL) <= 0.05 && Math.abs(m.dC) <= 0.04;

  test('the resting menu on the mid grey lifts what it covers as the reference menu does', async ({ page }) => {
    expect(holds(await againstBackdrop(page, 'mid', 'open', trailing))).toBe(true);
  });

  for (const backdrop of ['dark', 'photo', 'light']) {
    test(`the resting menu on ${backdrop} stands off what it covers and carries its colour`, async ({ page }) => {
      const m = await againstBackdrop(page, backdrop, 'open', trailing);
      expect(m.dL).toBeGreaterThan(0.01);
      expect(Math.abs(m.dC)).toBeLessThanOrEqual(0.04);
    });
  }

  test('canary: a clear menu fails it', async ({ page }) => {
    const m = await againstBackdrop(page, 'mid', 'open', trailing, 'vire-menu[data-vk]>[popover]{background:none!important}');
    expect(holds(m)).toBe(false);
    expect(m.dL).toBeLessThan(0.01);
  });

  // M 5:11: the drop is about 0.2 lighter than what it covers; over a dark backdrop it brightens without turning white.
  for (const backdrop of ['dark', 'mid']) {
    test(`the drop on ${backdrop} is lit well above its surround`, async ({ page }) => {
      const m = await againstBackdrop(page, backdrop, '1 0', centre);
      expect(m.dL).toBeGreaterThan(0.1);
      if (backdrop === 'dark') expect(m.L).toBeLessThan(0.7);
    });
  }

  test('canary: the resting body in the drop\'s place fails the drop\'s bound', async ({ page }) => {
    expect((await againstBackdrop(page, 'dark', 'open', centre)).dL).toBeLessThan(0.1);
  });
});

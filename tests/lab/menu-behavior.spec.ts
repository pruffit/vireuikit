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
    await expect(items).toHaveCount(5);
    await expect(items.nth(2)).toBeDisabled();
    for (const tabindex of await items.evaluateAll((els) => els.map((el) => el.getAttribute('tabindex')))) {
      expect(tabindex).toBe('-1');
    }
  });

  test('removing the element gives the markup back, and connecting it again upgrades it', async ({ page }) => {
    await openCase(page, 'view=menu');
    const read = () =>
      page.evaluate(() => {
        const menu = (window as unknown as { __menu: HTMLElement }).__menu;
        const trigger = menu.querySelector('#more-trigger')!;
        const list = menu.querySelector('[popover]')!;
        return {
          target: trigger.getAttribute('popovertarget'),
          haspopup: trigger.getAttribute('aria-haspopup'),
          popover: list.getAttribute('popover'),
          role: list.getAttribute('role'),
          item: list.querySelector('button')!.getAttribute('popovertargetaction'),
          itemRole: list.querySelector('button')!.getAttribute('role'),
        };
      });
    await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('#more')!;
      (window as unknown as { __menu: HTMLElement; __parent: HTMLElement }).__menu = menu;
      (window as unknown as { __parent: HTMLElement }).__parent = menu.parentElement!;
      menu.remove();
    });
    expect(await read()).toEqual({ target: 'more-list', haspopup: null, popover: '', role: null, item: 'hide', itemRole: null });
    await page.evaluate(() => {
      const w = window as unknown as { __menu: HTMLElement; __parent: HTMLElement };
      w.__parent.append(w.__menu);
    });
    expect(await read()).toMatchObject({ target: null, haspopup: 'menu', popover: 'manual', role: 'menu', itemRole: 'menuitem' });
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

  test('arrows, Home, End and typeahead move over enabled items and wrap', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    const steps: [string, string][] = [
      ['ArrowDown', 'Rename'],
      ['ArrowDown', 'Remove from list'],
      ['ArrowDown', 'Copy text'],
      ['ArrowDown', 'Copy link'],
      ['ArrowUp', 'Copy text'],
      ['Home', 'Copy link'],
      ['End', 'Copy text'],
      ['Home', 'Copy link'],
      ['r', 'Rename'],
      ['e', 'Rename'],
      ['m', 'Remove from list'],
    ];
    for (const [key, expected] of steps) {
      await page.keyboard.press(key);
      expect(await focused(page), key).toBe(expected);
    }
    await page.waitForTimeout(600);
    await page.keyboard.press('c');
    expect(await focused(page)).toBe('Copy text');
    await page.keyboard.press('c');
    expect(await focused(page)).toBe('Copy link');
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
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    expect(await log(page)).toEqual(['click:rename']);
    expect(await focused(page)).toBe('more-trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => isOpen(page)).toBe(false);

    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await log(page)).toEqual(['click:rename', 'click:rename']);
    expect(await focused(page)).toBe('more-trigger');
  });

  test('a disabled item cannot be chosen and closes nothing', async ({ page }) => {
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    await page.getByRole('menuitem', { name: 'Delete' }).click({ force: true });
    expect(await log(page)).toEqual([]);
    expect(await isOpen(page)).toBe(true);
    await expect(page.locator('#more-trigger')).toHaveAttribute('aria-expanded', 'true');
  });

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

type Frame = { open: boolean; x: number; y: number; w: number; h: number; radius: number; ink: number; carried: boolean; phase: string | null };

/** Records the surface on every frame, and right after the element's own click and key handlers. */
async function record(page: Page, id = 'more'): Promise<void> {
  await page.evaluate((id) => {
    const menu = document.getElementById(id)!;
    const list = menu.querySelector<HTMLElement>(':scope > [popover]')!;
    const carrier = menu.querySelector(':scope > vire-icon-button, :scope > vire-button');
    const frames: Frame[] = [];
    (window as unknown as { __frames: Frame[] }).__frames = frames;
    const snap = () => {
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
      });
    };
    document.addEventListener('click', snap);
    document.addEventListener('keydown', snap);
    const loop = () => {
      snap();
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

/** The surface starts on the trigger, passes a drop smaller than it, and overshoots the menu before settling. */
function grows(run: Run): boolean {
  const { opening, trigger } = run;
  const first = opening[0]!;
  const last = opening.at(-1)!;
  const smallest = Math.min(...opening.map((f) => Math.max(f.w, f.h)));
  const tallest = Math.max(...opening.map((f) => f.h));
  return (
    near(first.x, trigger.x) &&
    near(first.y, trigger.y) &&
    near(first.w, trigger.width) &&
    near(first.h, trigger.height) &&
    smallest < trigger.height * 0.9 &&
    tallest / last.h > 1.005 &&
    tallest / last.h < 1.08
  );
}

test.describe('growth', () => {
  test('the surface starts on the trigger, passes a drop and lands on the menu', async ({ page }) => {
    const run = await openAndClose(page, 'view=menu');
    expect(grows(run)).toBe(true);
    const first = run.opening[0]!;
    expect(near(first.radius, run.trigger.height / 2)).toBe(true);
    const last = run.opening.at(-1)!;
    for (const f of run.opening) if (f.h < last.h * 0.8) expect(f.ink).toBe(0);
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
    expect(Math.min(...closing.map((f) => Math.max(f.w, f.h)))).toBeLessThan(trigger.height * 0.9);
    expect(near(end.x, trigger.x) && near(end.y, trigger.y) && near(end.w, trigger.width) && near(end.h, trigger.height)).toBe(true);
    for (const f of closing) if (f.h < menu.h * 0.8) expect(f.ink).toBe(0);
  });

  test('canary: a menu that pops open without growing fails it', async ({ page }) => {
    const run = await openAndClose(page, 'view=menu&rm=1');
    expect(grows(run)).toBe(false);
  });

  test('reopening while it closes turns back from where it is', async ({ page }) => {
    await openCase(page, 'view=menu');
    await record(page);
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    const turn = await mark(page);
    await page.locator('#more-trigger').click({ force: true });
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const after = (await frames(page)).slice(turn);
    expect(after.every((f) => f.open)).toBe(true);
    expect(Math.min(...after.map((f) => f.h))).toBeGreaterThan(44);
  });
});

test.describe('one body', () => {
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
    expect(await lensBlur()).toBe(0);
    expect(await button.evaluate((el) => getComputedStyle(el, '::after').visibility)).toBe('hidden');
    expect(await host.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--vk-carry')))).toBe(0);
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page)).toBe(false);
    await expect(host).not.toHaveAttribute('data-carried', '');
    expect(await background()).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.move(5, 5);
    await expect.poll(lensBlur).toBe(restBlur);
  });

  test('the surface scatters what lies under it far more softly than the control it grew from', async ({ page }) => {
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
    expect(menu).toBeGreaterThan(control * 10);
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
    setSample() {}, setAccent() {}, setNeighbourGlow() {},
    destroy() {},
  };
}`;

test.describe('the core\'s morph', () => {
  test('the lens is handed the second shape while the drop and the menu are joined', async ({ page }) => {
    await page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS }));
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    type Call = { geometry: { width: number; height: number }; morph: { smoothing: number; shape: { offsetX: number; offsetY: number; width: number } } | null | undefined };
    const calls = await page.evaluate(
      () => (window as unknown as { __lenses: { id: string; calls: Call[] }[] }).__lenses.find((l) => l.id === 'more-list')!.calls,
    );
    const frames = calls.filter((c) => c.morph !== undefined);
    expect(frames[0]!.geometry).toMatchObject({ width: 44, height: 44 });
    expect(frames[0]!.morph).toBeNull();
    const joined = frames.filter((c) => c.morph);
    expect(joined.length).toBeGreaterThan(1);
    const last = frames.at(-1)!;
    for (const c of joined) {
      expect(c.morph!.smoothing).toBeGreaterThan(0);
      expect(Math.abs(c.morph!.shape.offsetX)).toBeLessThan(last.geometry.width);
      expect(Math.abs(c.morph!.shape.offsetY)).toBeLessThan(last.geometry.height);
    }
    expect(last.morph).toBeNull();
    expect(last.geometry.width).toBeGreaterThan(44 * 3);
  });
});

test.describe('the ink', () => {
  test('the ink holds while the menu is out, and the backdrop is read again on the next open', async ({ page }) => {
    await openCase(page, 'view=menu&backdrop=light');
    const ink = () => page.locator('#more-list').evaluate((el) => el.style.getPropertyValue('--vireglass-ink'));
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    expect(await ink()).toBe('0');
    await page.evaluate(() => {
      document.getElementById('stage')!.setAttribute('data-backdrop', 'dark');
      window.dispatchEvent(new Event('resize'));
    });
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
    const opened = (await frames(page)).slice(start).find((f) => f.open)!;
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    const settled = (await frames(page)).at(-1)!;
    expect([opened.x, opened.y, opened.w, opened.h]).toEqual([settled.x, settled.y, settled.w, settled.h]);
    expect(opened.ink).toBe(1);
    const before = await mark(page);
    await page.keyboard.press('Escape');
    const closed = (await frames(page)).slice(before)[0]!;
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
    await page.getByRole('menuitem', { name: 'Two' }).click();
    expect(await log(page)).toEqual(['click:Two']);
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

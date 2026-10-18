import { expect, test, type Page } from '@playwright/test';
import { SHEET_SIZES, sheetInset, sheetOpacity, sheetRadius } from '../../src';
import { nextFrame, openCase } from './helpers';

// Every frame is sampled from the page: the box of the surface, what the trigger draws, the ink, on each animation
// frame, so a surface that pops open, jumps to a detent or leaves the top layer early cannot pass.
test.use({ viewport: { width: 1900, height: 1100 } });

const log = (page: Page) => page.locator('#log').evaluate((el) => (el.textContent ?? '').split('\n').filter(Boolean));
const surfaceOf = (page: Page, id: string) => page.locator(`#${id}-surface`);
const shown = (page: Page, id: string) =>
  surfaceOf(page, id).evaluate((el) => (el instanceof HTMLDialogElement ? el.open : el.matches(':popover-open')));
const focused = (page: Page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || '');
const opened = (page: Page, id: string) => expect(page.locator(`#${id}`)).toHaveAttribute('data-phase', 'open');
const resting = async (page: Page, id: string) => {
  await opened(page, id);
  await expect(page.locator(`#${id}`)).not.toHaveAttribute('data-height', /./);
};
const closed = (page: Page, id: string) => expect.poll(() => shown(page, id)).toBe(false);
const resize = (page: Page, width: number, height: number) => page.evaluate(([w, h]) => window.__lab.sheet!.resize(w!, h!), [width, height]);

type Box = { x: number; y: number; width: number; height: number };
const frameBox = async (page: Page): Promise<Box> => (await page.locator('#frame').boundingBox())!;
const boxOf = (page: Page, id: string) =>
  surfaceOf(page, id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
const near = (a: number, b: number, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
const css = (page: Page, id: string, prop: string, pseudo?: string) =>
  surfaceOf(page, id).evaluate((el, [p, ps]) => getComputedStyle(el, ps || null).getPropertyValue(p!), [prop, pseudo ?? ''] as const);
const opaque = (page: Page, id: string) => surfaceOf(page, id).evaluate((el) => Number(el.style.getPropertyValue('--vk-opaque')));

/** A quarter-speed clock, so every frame of a spring that settles in 0.4 s can be seen. */
async function slowTime(page: Page, factor = 0.25): Promise<void> {
  await page.addInitScript((k) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => cb(t * k));
  }, factor);
}

type Frame = {
  source: string;
  t: number;
  open: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  opaque: number;
  scrim: number;
  ink: number;
  phase: string | null;
  form: string | null;
  carried: boolean;
  lens: string;
  body: string;
  rim: string;
};
const record = (page: Page, id: string) => page.evaluate((id) => window.__lab.sheet!.record(id), id);
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
const mark = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.length);

const sandbox = (page: Page, query = '', size = { w: 390, h: 720 }) =>
  openCase(page, `view=sheet&w=${size.w}&h=${size.h}&${query}${query.includes('glass=') ? '' : '&glass=0'}`);

// ---- before the upgrade --------------------------------------------------------------------------------------------

test.describe('before the upgrade', () => {
  test('a popover is the platform\'s: it opens, dismisses on Escape and a press outside, and gives focus back', async ({ page }) => {
    await sandbox(page, 'upgrade=0', { w: 700, h: 720 });
    await expect(page.locator('vire-popover[data-vk]')).toHaveCount(0);
    const trigger = page.locator('#pop-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');
    expect(await shown(page, 'pop')).toBe(true);
    await page.keyboard.press('Escape');
    expect(await shown(page, 'pop')).toBe(false);
    expect(await focused(page)).toBe('pop-trigger');
    await trigger.click();
    expect(await shown(page, 'pop')).toBe(true);
    await page.mouse.click(1800, 1000);
    expect(await shown(page, 'pop')).toBe(false);
    await trigger.click();
    await page.locator('#pop-close').click();
    expect(await shown(page, 'pop')).toBe(false);
    expect(await focused(page)).toBe('pop-trigger');
  });

  test('a modal sheet is a dialog the command opens and closes: an inert background, Escape, focus moved in and returned', async ({ page }) => {
    await sandbox(page, 'upgrade=0');
    await expect(page.locator('vire-sheet[data-vk]')).toHaveCount(0);
    await page.locator('#modal-trigger').click();
    expect(await shown(page, 'modal')).toBe(true);
    expect(await surfaceOf(page, 'modal').evaluate((el) => el.matches(':modal'))).toBe(true);
    expect(await page.evaluate(() => document.getElementById('modal-surface')!.contains(document.activeElement))).toBe(true);
    const reached = await page.evaluate(() => {
      document.getElementById('before')!.focus();
      return document.activeElement === document.getElementById('before');
    });
    expect(reached).toBe(false);
    await page.keyboard.press('Escape');
    expect(await shown(page, 'modal')).toBe(false);
    expect(await focused(page)).toBe('modal-trigger');
    await page.locator('#modal-trigger').click();
    await page.locator('#modal-close').click();
    expect(await shown(page, 'modal')).toBe(false);
    expect(await focused(page)).toBe('modal-trigger');
    expect((await log(page)).filter((line) => line.startsWith('close:'))).toEqual(['close:modal', 'close:modal']);
  });

  test('a supplementary sheet is a manual popover its button toggles, and the page stays usable', async ({ page }) => {
    await sandbox(page, 'upgrade=0');
    await page.locator('#sup-trigger').click();
    expect(await shown(page, 'sup')).toBe(true);
    await page.locator('#before').click();
    expect(await log(page)).toContain('click:before');
    expect(await shown(page, 'sup')).toBe(true);
    await page.locator('#before').focus();
    await page.keyboard.press('Escape');
    expect(await shown(page, 'sup')).toBe(true);
    await page.locator('#sup-trigger').click();
    expect(await shown(page, 'sup')).toBe(false);
  });
});

// ---- roles and the markup given back -------------------------------------------------------------------------------

test.describe('roles', () => {
  test('the upgrade adds no role to a surface; the grabber is a slider and the dialog keeps its name', async ({ page }) => {
    await sandbox(page);
    for (const id of ['pop', 'sup', 'modal', 'dlg', 'alert']) {
      expect(await surfaceOf(page, id).getAttribute('role'), id).toBeNull();
    }
    await expect(page.locator('#modal-trigger')).toHaveAttribute('command', 'show-modal');
    await expect(page.locator('#modal-trigger')).toHaveAttribute('commandfor', 'modal-surface');
    await page.locator('#modal-trigger').click();
    await opened(page, 'modal');
    await expect(page.getByRole('dialog', { name: 'Add to playlist' })).toBeVisible();
    const slider = page.getByRole('slider', { name: 'Sheet height' });
    await expect(slider).toHaveCount(1);
    expect(await page.evaluate(() => [...document.querySelectorAll('[role]')].filter((el) => el.closest('#frame') && !el.closest('[hidden]')).map((el) => el.getAttribute('role')))).toEqual(['slider']);
    await page.keyboard.press('Escape');
    await closed(page, 'modal');
    await page.locator('#pop-trigger').click();
    await opened(page, 'pop');
    await expect(page.locator('#pop-trigger')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#pop-trigger')).toHaveAttribute('aria-controls', 'pop-surface');
    expect(await page.locator('#pop-trigger').getAttribute('popovertarget')).toBeNull();
  });

  // The markup as the platform sees it: every element's attributes by name, so the order they were put back in is not held.
  const FINGERPRINT = `(node) => {
    const fp = (n) => {
      if (n.nodeType === 3) return n.textContent;
      if (n.nodeType !== 1) return '';
      const attrs = [...n.attributes].map((a) => a.name + '=' + a.value).sort().join(' ');
      return '<' + n.localName + ' ' + attrs + '>' + [...n.childNodes].map(fp).join('') + '</' + n.localName + '>';
    };
    return fp(node);
  }`;
  const read = (page: Page) =>
    page.evaluate((src) => {
      const fp = eval(src) as (n: Node) => string;
      const out: Record<string, string> = {};
      for (const id of ['pop', 'sup', 'modal', 'dlg', 'alert', 'hosted']) {
        const host = document.getElementById(id)!;
        out[`${id}:host`] = fp(host.cloneNode(false));
        out[`${id}:surface`] = fp(host.querySelector(':scope > dialog, :scope > [popover]')!);
        const trigger = host.querySelector('button[id$=-trigger]');
        if (trigger) out[`${id}:trigger`] = fp(trigger);
      }
      return out;
    }, FINGERPRINT);

  test('removing the element gives the markup back with nothing of its own left, and connecting it again upgrades it', async ({ page }) => {
    await sandbox(page, 'upgrade=0', { w: 1200, h: 720 });
    const before = await read(page);
    await page.evaluate(() => window.__lab.define());
    await expect(page.locator('vire-sheet[data-vk]')).toHaveCount(6);
    await page.locator('#pop-trigger').click();
    await opened(page, 'pop');
    await page.keyboard.press('Escape');
    await closed(page, 'pop');
    await page.locator('#sup-trigger').click();
    await opened(page, 'sup');
    await page.locator('#modal-trigger').evaluate((el) => (el as HTMLElement).focus());
    expect(await page.evaluate(() => document.querySelector<HTMLElement>('.sh-bar')!.style.getPropertyValue('--vire-sheet-inset-end'))).toBe('376px');
    await page.evaluate(() => {
      const w = window as unknown as { __removed: HTMLElement[]; __bar: HTMLElement };
      w.__bar = document.querySelector('.sh-bar')!;
      w.__removed = ['pop', 'sup', 'modal', 'dlg', 'alert', 'hosted'].map((id) => document.getElementById(id)!);
      for (const el of w.__removed) el.remove();
    });
    expect(await page.evaluate(() => (window as unknown as { __bar: HTMLElement }).__bar.getAttribute('style'))).toBeNull();
    const after = await page.evaluate((src) => {
      const fp = eval(src) as (n: Node) => string;
      const w = window as unknown as { __removed: HTMLElement[] };
      const out: Record<string, string> = {};
      for (const host of w.__removed) {
        const id = host.id;
        out[`${id}:host`] = fp(host.cloneNode(false));
        out[`${id}:surface`] = fp(host.querySelector(':scope > dialog, :scope > [popover]')!);
        const trigger = host.querySelector('button[id$=-trigger]');
        if (trigger) out[`${id}:trigger`] = fp(trigger);
      }
      return out;
    }, FINGERPRINT);
    expect(Object.keys(after).length).toBeGreaterThan(10);
    for (const key of Object.keys(after)) expect(after[key], key).toBe(before[key]);
    await page.evaluate(() => {
      const w = window as unknown as { __removed: HTMLElement[]; __bar: HTMLElement };
      for (const el of w.__removed) w.__bar.append(el);
    });
    await expect(page.locator('vire-sheet[data-vk]')).toHaveCount(6);
    await expect(page.locator('vire-popover[data-vk]')).toHaveCount(1);
  });
});

// ---- the form is the model's ---------------------------------------------------------------------------------------

test.describe('the form', () => {
  const MATRIX: [string, number, number, string][] = [
    ['pop', 390, 720, 'bottom-sheet'],
    ['pop', 700, 720, 'popover'],
    ['pop', 1000, 720, 'popover'],
    ['sup', 390, 720, 'bottom-sheet'],
    ['sup', 700, 720, 'bottom-sheet'],
    ['sup', 1000, 720, 'side-sheet'],
    ['sup', 1700, 800, 'side-pane'],
    ['sup', 390, 420, 'full-screen'],
    ['modal', 390, 720, 'bottom-sheet'],
    ['modal', 700, 720, 'centered-sheet'],
    ['modal', 700, 420, 'full-screen'],
    ['picker', 390, 720, 'bottom-sheet'],
    ['picker', 900, 720, 'centered-sheet'],
    ['dlg', 390, 720, 'full-screen'],
    ['dlg', 700, 720, 'basic-dialog'],
    ['alert', 390, 720, 'alert'],
    ['alert', 1000, 720, 'alert'],
  ];
  for (const [id, width, height, form] of MATRIX) {
    test(`${id} is a ${form} in a ${width} by ${height} window`, async ({ page }) => {
      await sandbox(page, 'rm=1', { w: width, h: height });
      await page.locator(`#${id}-trigger`).click();
      await opened(page, id);
      await expect(page.locator(`#${id}`)).toHaveAttribute('data-form', form);
      await expect(surfaceOf(page, id)).toHaveAttribute('data-form', form);
    });
  }

  test('a kind attribute overrides the markup\'s', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 390, h: 720 });
    await page.locator('#modal').evaluate((el) => el.setAttribute('kind', 'alert'));
    await page.locator('#modal-trigger').click();
    await opened(page, 'modal');
    await expect(page.locator('#modal')).toHaveAttribute('data-form', 'alert');
  });
});

// ---- growth out of the trigger -------------------------------------------------------------------------------------

type Run = { opening: Frame[]; closing: Frame[]; trigger: Box; frame: Box };

/** Opens a surface from its trigger, lets it arrive, closes it with `close`, and keeps every frame of both. */
async function growRun(
  page: Page,
  id: string,
  query: string,
  size: { w: number; h: number },
  close: (page: Page) => Promise<void> = (p) => p.keyboard.press('Escape'),
): Promise<Run> {
  await slowTime(page);
  await sandbox(page, query, size);
  const trigger = (await page.locator(`#${id} > vire-button`).boundingBox())!;
  const frame = await frameBox(page);
  await record(page, id);
  const start = await mark(page);
  await page.locator(`#${id}-trigger`).click();
  await opened(page, id);
  await page.waitForTimeout(150);
  const middle = await mark(page);
  await close(page);
  await closed(page, id);
  await page.waitForTimeout(50);
  const all = await frames(page);
  return { opening: all.slice(start, middle).filter((f) => f.open), closing: all.slice(middle).filter((f) => f.open), trigger, frame };
}

/** The surface starts on the trigger, passes a drop smaller than it, and overshoots the panel a little before settling. */
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

/** The surface starts on the trigger and goes straight to its box: never smaller than the trigger, a little past on the way. */
function growsStraight(run: Run): boolean {
  const { opening, trigger } = run;
  const first = opening[0]!;
  const last = opening.at(-1)!;
  const smallest = Math.min(...opening.map((f) => Math.min(f.w, f.h)));
  const tallest = Math.max(...opening.map((f) => f.h));
  const steps = opening.filter((f, i) => i > 0 && Math.abs(f.h - opening[i - 1]!.h) > 0.5).length;
  return (
    near(first.x, trigger.x) &&
    near(first.y, trigger.y) &&
    near(first.w, trigger.width) &&
    near(first.h, trigger.height) &&
    smallest >= Math.min(trigger.width, trigger.height) - 1 &&
    tallest / last.h < 1.03 &&
    steps >= 6
  );
}

test.describe('a popover grows out of its trigger', () => {
  test('the surface starts on the trigger, passes a drop and lands on the panel', async ({ page }) => {
    const run = await growRun(page, 'pop', '', { w: 700, h: 720 });
    expect(grows(run)).toBe(true);
    const first = run.opening[0]!;
    const last = run.opening.at(-1)!;
    expect(near(first.radius, run.trigger.height / 2)).toBe(true);
    for (const f of run.opening) if (f.h < last.h * 0.8) expect(f.ink).toBe(0);
    expect(last.ink).toBe(1);
    expect(last.form).toBe('popover');
  });

  test("it pins to the trigger's corner, covers it, and stays in its segment without an arrow", async ({ page }) => {
    const run = await growRun(page, 'pop', '', { w: 700, h: 720 });
    const last = run.opening.at(-1)!;
    expect(near(last.x, run.trigger.x, 0.5)).toBe(true);
    expect(near(last.y, run.trigger.y, 0.5)).toBe(true);
    expect(last.w).toBeGreaterThan(run.trigger.width);
    const { frame } = run;
    for (const f of [...run.opening, ...run.closing]) {
      expect(f.x).toBeGreaterThanOrEqual(frame.x - 1);
      expect(f.y).toBeGreaterThanOrEqual(frame.y - 1);
      expect(f.x + f.w).toBeLessThanOrEqual(frame.x + frame.width + 1);
      expect(f.y + f.h).toBeLessThanOrEqual(frame.y + frame.height + 1);
    }
    expect(await css(page, 'pop', 'background-color', '::before')).toBe('rgba(0, 0, 0, 0)');
    expect(await css(page, 'pop', 'background-image', '::before')).toBe('none');
    expect(await css(page, 'pop', 'content', '::after')).toMatch(/none|normal/);
    expect(await surfaceOf(page, 'pop').evaluate((el) => el.querySelectorAll(':scope > :not(h2,label,button,[data-vk-grabber])').length)).toBe(0);
  });

  test('closing runs back through the drop into the trigger, the content going first', async ({ page }) => {
    const run = await growRun(page, 'pop', '', { w: 700, h: 720 });
    const end = run.closing.at(-1)!;
    const panel = run.opening.at(-1)!;
    expect(run.closing.length).toBeGreaterThan(8);
    expect(Math.min(...run.closing.map((f) => Math.max(f.w, f.h)))).toBeLessThan(run.trigger.height);
    expect(near(end.x, run.trigger.x) && near(end.y, run.trigger.y) && near(end.w, run.trigger.width) && near(end.h, run.trigger.height)).toBe(true);
    for (const f of run.closing) if (f.h < panel.h * 0.8) expect(f.ink).toBe(0);
  });

  test('canary: a popover that pops open without growing fails it', async ({ page }) => {
    const run = await growRun(page, 'pop', 'rm=1', { w: 700, h: 720 });
    expect(grows(run)).toBe(false);
  });
});

test.describe('a popover becomes a sheet below 600 dp', () => {
  test('it grows from its source into a bottom sheet with a scrim, still a non-modal popover, and the page is not inert', async ({ page }) => {
    await sandbox(page, 'rm=1');
    const before = await page.locator('#page').evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
    await page.locator('#pop-trigger').click();
    await opened(page, 'pop');
    await expect(page.locator('#pop')).toHaveAttribute('data-form', 'bottom-sheet');
    const frame = await frameBox(page);
    const box = await boxOf(page, 'pop');
    expect(near(box.x + box.width / 2, frame.x + frame.width / 2)).toBe(true);
    expect(near(frame.y + frame.height - (box.y + box.height), sheetInset(box.height / 720), 1.5)).toBe(true);
    expect(await surfaceOf(page, 'pop').evaluate((el) => [el.matches(':popover-open'), el.matches(':modal')])).toEqual([true, false]);
    expect(await css(page, 'pop', 'background-color', '::backdrop')).toBe(`rgba(0, 0, 0, ${SHEET_SIZES.scrimAlpha})`);
    const usable = await page.evaluate(() => {
      document.getElementById('before')!.focus();
      return document.activeElement === document.getElementById('before');
    });
    expect(usable).toBe(true);
    expect(await shown(page, 'pop')).toBe(true);
    expect(await page.locator('#page').evaluate((el) => JSON.stringify(el.getBoundingClientRect()))).toBe(before);
  });

  test('a press on the scrim closes it, as its own light dismiss', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#pop-trigger').click();
    await opened(page, 'pop');
    const frame = await frameBox(page);
    await page.mouse.click(frame.x + 200, frame.y + 60);
    await closed(page, 'pop');
    expect((await log(page)).filter((l) => l.startsWith('toggle:pop'))).toEqual(['toggle:pop:open', 'toggle:pop:closed']);
  });
});

// ---- the bottom sheet ----------------------------------------------------------------------------------------------

const sheetHeight = async (page: Page, id: string) => {
  const frame = await frameBox(page);
  return frame.y + frame.height - (await boxOf(page, id)).y;
};

test.describe('the bottom sheet sits by its height', () => {
  test('medium is half the window and large leaves 56 dp at the top; the current one is reflected and the host can set it', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await expect(page.locator('#sup')).toHaveAttribute('detent', 'medium');
    expect(near(await sheetHeight(page, 'sup'), 360, 0.5)).toBe(true);
    await page.locator('#sup').evaluate((el) => ((el as unknown as { detent: string }).detent = 'large'));
    await expect.poll(() => sheetHeight(page, 'sup').then((h) => Math.round(h))).toBe(720 - SHEET_SIZES.detent.largeTopGap);
    await expect(page.locator('#sup')).toHaveAttribute('detent', 'large');
    await page.locator('#sup').evaluate((el) => el.setAttribute('detent', 'medium'));
    await expect.poll(() => sheetHeight(page, 'sup').then((h) => Math.round(h))).toBe(360);
    await page.locator('#sup').evaluate((el) => el.setAttribute('detent', 'peek'));
    expect(near(await sheetHeight(page, 'sup'), 360, 0.5)).toBe(true);
    expect(await page.locator('#sup').getAttribute('detent')).toBe('medium');
  });

  test("peek is the content's own height", async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 390, h: 1000 });
    await page.locator('#pop-trigger').click();
    await resting(page, 'pop');
    await expect(page.locator('#pop')).toHaveAttribute('detent', 'peek');
    const content = await surfaceOf(page, 'pop').evaluate((el) => el.scrollHeight);
    expect(content).toBeGreaterThan(SHEET_SIZES.detent.peekMin);
    expect(near(await sheetHeight(page, 'pop'), content + 12, 2)).toBe(true);
    expect(await surfaceOf(page, 'pop').evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  });

  test('a detents attribute names the detents', async ({ page }) => {
    await sandbox(page, 'rm=1&detents=medium');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await expect(page.locator('#sup [data-vk-grabber]')).toHaveAttribute('aria-valuemax', '0');
    expect(near(await sheetHeight(page, 'sup'), 360, 0.5)).toBe(true);
    await page.locator('#sup > vire-button').click();
    await closed(page, 'sup');
  });

  test('a modal sheet has only large', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#modal-trigger').click();
    await resting(page, 'modal');
    expect(near(await sheetHeight(page, 'modal'), 720 - 56, 0.5)).toBe(true);
  });
});

const BOTTOM = (height: number, fraction = height / 720) => ({
  inset: sheetInset(fraction),
  radius: sheetRadius(fraction),
  opaque: sheetOpacity(fraction),
});

test.describe('the inset, the radius and the body follow the height', () => {
  test('inset glass at medium, flush and opaque at large', async ({ page }) => {
    await sandbox(page, 'rm=1&glass=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const frame = await frameBox(page);
    const read = async () => {
      const box = await boxOf(page, 'sup');
      return {
        left: box.x - frame.x,
        right: frame.x + frame.width - (box.x + box.width),
        bottom: frame.y + frame.height - (box.y + box.height),
        radius: parseFloat(await css(page, 'sup', 'border-top-left-radius')),
        opaque: await opaque(page, 'sup'),
      };
    };
    const medium = await read();
    const m = BOTTOM(360);
    expect([medium.left, medium.right, medium.bottom].map((v) => Math.round(v * 10) / 10)).toEqual([7.2, 7.2, 7.2]);
    expect(near(medium.radius, m.radius, 0.2)).toBe(true);
    expect(medium.opaque).toBe(0);
    expect(await page.locator('#sup').getAttribute('data-glass')).toBe('on');
    await page.locator('#sup').evaluate((el) => ((el as unknown as { detent: string }).detent = 'large'));
    await expect.poll(async () => Math.round((await read()).left)).toBe(0);
    const large = await read();
    expect([large.left, large.right]).toEqual([0, 0]);
    expect(large.bottom).toBeLessThanOrEqual(0);
    expect(near(large.radius, SHEET_SIZES.radius.flush, 0.1)).toBe(true);
    expect(large.opaque).toBe(1);
  });

  test('up to 30 % of the window the inset is 12 dp and the radius 32', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 390, h: 1000 });
    await page.locator('#pop-trigger').click();
    await resting(page, 'pop');
    const frame = await frameBox(page);
    const box = await boxOf(page, 'pop');
    expect(box.height / 1000).toBeLessThan(0.3);
    expect(near(box.x - frame.x, 12, 0.1)).toBe(true);
    expect(near(frame.y + frame.height - (box.y + box.height), 12, 0.1)).toBe(true);
    expect(near(parseFloat(await css(page, 'pop', 'border-top-left-radius')), 32, 0.1)).toBe(true);
    expect(await opaque(page, 'pop')).toBe(0);
  });

  test('the blend runs with the height while the sheet is dragged: 3 dp and half opaque near 72 %', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const grab = await page.locator('#sup [data-vk-grabber]').boundingBox();
    const x = grab!.x + grab!.width / 2;
    const y = grab!.y + grab!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const target = 0.725 * 720;
    await page.mouse.move(x, y - (target - 360));
    const frame = await frameBox(page);
    const box = await boxOf(page, 'sup');
    expect(near(frame.y + frame.height - box.y, target, 1)).toBe(true);
    const expected = BOTTOM(target);
    expect(near(box.x - frame.x, expected.inset, 0.2)).toBe(true);
    expect(near(await opaque(page, 'sup'), expected.opaque, 0.01)).toBe(true);
    expect(expected.opaque).toBeGreaterThan(0.3);
    expect(expected.opaque).toBeLessThan(0.7);
    await page.mouse.up();
  });
});

// ---- the grabber ---------------------------------------------------------------------------------------------------

test.describe('the grabber', () => {
  test('is a slider of 44 dp holding a 32 by 4 dp line, named for the detent and the sheet', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const grabber = page.getByRole('slider', { name: 'Sheet height' });
    await expect(grabber).toBeVisible();
    await expect(grabber).toHaveAttribute('aria-orientation', 'vertical');
    await expect(grabber).toHaveAttribute('aria-valuemin', '0');
    await expect(grabber).toHaveAttribute('aria-valuemax', '1');
    await expect(grabber).toHaveAttribute('aria-valuenow', '0');
    await expect(grabber).toHaveAttribute('aria-valuetext', 'medium');
    await expect(grabber).toHaveAttribute('tabindex', '0');
    const box = (await grabber.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([44, 44]);
    const line = await grabber.evaluate((el) => {
      const s = getComputedStyle(el, '::before');
      return [s.width, s.height, s.top];
    });
    expect(line).toEqual(['32px', '4px', '8px']);
    const surface = await boxOf(page, 'sup');
    expect(near(box.x + box.width / 2, surface.x + surface.width / 2)).toBe(true);
    expect(near(box.y, surface.y, 1)).toBe(true);
    await page.locator('#sup').evaluate((el) => el.setAttribute('grabber-label', 'Playlists height'));
    await expect(page.getByRole('slider', { name: 'Playlists height' })).toHaveCount(1);
  });

  test('shows whenever there is more than one detent or a swipe closes the sheet', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#modal-trigger').click();
    await resting(page, 'modal');
    await expect(page.locator('#modal [data-vk-grabber]')).toBeVisible();
    await page.keyboard.press('Escape');
    await closed(page, 'modal');
    await page.locator('#modal').evaluate((el) => el.setAttribute('persistent', ''));
    await page.locator('#modal-trigger').click();
    await resting(page, 'modal');
    await expect(page.locator('#modal [data-vk-grabber]')).toBeHidden();
    await page.keyboard.press('Escape');
    await closed(page, 'modal');
    await page.locator('#sup').evaluate((el) => el.setAttribute('persistent', ''));
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await expect(page.locator('#sup [data-vk-grabber]')).toBeVisible();
  });

  test('the arrows, Home and End change the detent, and a tap moves to the next', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const grabber = page.locator('#sup [data-vk-grabber]');
    const detent = () => page.locator('#sup').getAttribute('detent');
    await grabber.focus();
    await page.keyboard.press('ArrowUp');
    await expect(grabber).toHaveAttribute('aria-valuetext', 'large');
    expect(await detent()).toBe('large');
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(664);
    await page.keyboard.press('ArrowDown');
    await expect(grabber).toHaveAttribute('aria-valuetext', 'medium');
    await page.keyboard.press('End');
    expect(await detent()).toBe('large');
    await page.keyboard.press('Home');
    expect(await detent()).toBe('medium');
    await page.keyboard.press('ArrowDown');
    expect(await detent()).toBe('medium');
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);
    await grabber.click();
    expect(await detent()).toBe('large');
    await expect(grabber).toHaveAttribute('aria-valuenow', '1');
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(664);
    await grabber.click();
    expect(await detent()).toBe('medium');
  });
});

// ---- dragging ------------------------------------------------------------------------------------------------------

const grabberAt = async (page: Page, id: string) => {
  const box = (await page.locator(`#${id} [data-vk-grabber]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** The sheet's height under the finger on each move, against what the finger asked for. */
const follows = (samples: { dy: number; height: number }[], start: number) =>
  samples.length >= 4 && samples.every((s) => near(s.height, start - s.dy, 1.5)) && new Set(samples.map((s) => Math.round(s.height))).size === samples.length;

async function dragSamples(page: Page, id: string, moves: number[]): Promise<{ dy: number; height: number }[]> {
  return (await drag(page, id, moves)).samples;
}

async function drag(page: Page, id: string, moves: number[]) {
  const g = await grabberAt(page, id);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  const out: { dy: number; height: number }[] = [];
  for (const dy of moves) {
    await page.mouse.move(g.x, g.y + dy);
    out.push({ dy, height: await sheetHeight(page, id) });
  }
  return { samples: out, g };
}

test.describe('dragging the sheet', () => {
  test('the sheet follows the finger with no spring, and meets resistance past the largest detent', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const { samples, g } = await drag(page, 'sup', [-20, -50, -90, -130, -180]);
    expect(follows(samples, 360)).toBe(true);
    await expect(page.locator('#sup')).toHaveAttribute('data-height', 'dragging');
    await page.mouse.move(g.x, g.y - 330);
    const near1 = await sheetHeight(page, 'sup');
    await page.mouse.move(g.x, g.y - 420);
    const near2 = await sheetHeight(page, 'sup');
    expect(near1).toBeGreaterThan(664);
    expect(near1).toBeLessThan(360 + 330);
    expect(near2).toBeGreaterThan(near1);
    expect(near2 - near1).toBeLessThan(90);
    expect(near2).toBeLessThanOrEqual(720);
    await page.mouse.up();
  });

  test('canary: a sheet that does not follow the finger fails it', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup').evaluate((el) => el.setAttribute('data-vire-force-state', 'open'));
    await resting(page, 'sup');
    const samples = await dragSamples(page, 'sup', [-20, -50, -90, -130, -180]);
    expect(follows(samples, 360)).toBe(false);
    await page.mouse.up();
  });

  const settle = async (page: Page, id: string, release: () => Promise<void>) => {
    await page.evaluate((id) => window.__lab.sheet!.record(id), id);
    const frame = await frameBox(page);
    const start = await mark(page);
    await release();
    await expect(page.locator(`#${id}`)).not.toHaveAttribute('data-height', /./);
    await nextFrame(page);
    const run = (await frames(page)).slice(start).map((f) => ({ t: f.t, height: frame.y + frame.height - f.y }));
    return run;
  };

  test('release springs to the detent the position chooses, in about 0.4 s with at most 2 % overshoot', async ({ page }) => {
    await sandbox(page);
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await dragSamples(page, 'sup', [-200]);
    await page.waitForTimeout(300);
    const run = await settle(page, 'sup', () => page.mouse.up());
    const last = run.at(-1)!;
    expect(Math.round(last.height)).toBe(664);
    const overshoot = Math.max(...run.map((r) => r.height)) - 664;
    expect(overshoot).toBeLessThanOrEqual(0.02 * (664 - 560) + 0.5);
    const moving = run.filter((r) => Math.abs(r.height - 664) > 1);
    const duration = (moving.at(-1)!.t - run[0]!.t) / 1000;
    expect(duration).toBeGreaterThan(0.2);
    expect(duration).toBeLessThan(0.75);
    expect(moving.length).toBeGreaterThan(5);
    await expect(page.locator('#sup')).toHaveAttribute('detent', 'large');
  });

  test('a fling goes to the next detent and a slow release to the nearest', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await dragSamples(page, 'sup', [-60]);
    await page.mouse.up();
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(664);
    await expect(page.locator('#sup')).toHaveAttribute('detent', 'large');
    await page.locator('#sup').evaluate((el) => el.setAttribute('detent', 'medium'));
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);
    await dragSamples(page, 'sup', [-60]);
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);
    await expect(page.locator('#sup')).toHaveAttribute('detent', 'medium');
  });

  test('below the lowest detent by 56 dp it closes, and a smaller pull returns', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await dragSamples(page, 'sup', [30]);
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);
    expect(await shown(page, 'sup')).toBe(true);
    await dragSamples(page, 'sup', [90]);
    await page.waitForTimeout(300);
    await page.mouse.up();
    await closed(page, 'sup');
    expect((await log(page)).filter((l) => l.startsWith('toggle:sup'))).toEqual(['toggle:sup:open', 'toggle:sup:closed']);
    expect(await focused(page)).toBe('sup-trigger');
  });

  test('persistent keeps it open however far it is pulled down', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup').evaluate((el) => el.setAttribute('persistent', ''));
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await dragSamples(page, 'sup', [260]);
    expect(await sheetHeight(page, 'sup')).toBeLessThan(160);
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);
    expect(await shown(page, 'sup')).toBe(true);
  });
});

test.describe('a drag from the chrome and from a touch screen', () => {
  test('the top strip of the sheet drags it as the grabber does', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const box = await boxOf(page, 'sup');
    await page.mouse.move(box.x + 40, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y - 60);
    expect(near(await sheetHeight(page, 'sup'), 430, 1.5)).toBe(true);
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);
  });

  test('a mouse pressed on the content selects text instead of dragging the sheet', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const box = await boxOf(page, 'sup');
    await page.mouse.move(box.x + 100, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 40);
    expect(near(await sheetHeight(page, 'sup'), 360, 0.5)).toBe(true);
    await page.mouse.up();
  });
});

// ---- scroll before drag --------------------------------------------------------------------------------------------

type Touch = { x: number; y0: number };
const touch = {
  down: (page: Page, id: string, offset: number) =>
    page.evaluate(
      ([id, offset]) => {
        const s = document.getElementById(`${id}-surface`)!;
        const r = s.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y0 = r.top + (offset as number);
        const target = document.elementFromPoint(x, y0)!;
        (window as unknown as { __touch: Touch }).__touch = { x, y0 };
        target.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y0, bubbles: true, composed: true }));
      },
      [id, offset] as const,
    ),
  move: (page: Page, dy: number) =>
    page.evaluate((dy) => {
      const { x, y0 } = (window as unknown as { __touch: Touch }).__touch;
      const target = document.elementFromPoint(x, y0 + dy) ?? document.body;
      target.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y0 + dy, bubbles: true, composed: true }));
    }, dy),
  up: (page: Page, dy: number) =>
    page.evaluate((dy) => {
      const { x, y0 } = (window as unknown as { __touch: Touch }).__touch;
      const target = document.elementFromPoint(x, y0 + dy) ?? document.body;
      target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: x, clientY: y0 + dy, bubbles: true, composed: true }));
    }, dy),
};

test.describe('scroll before drag', () => {
  test('the content scrolls first: a downward drag moves the sheet only from the content\'s top', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    expect(await css(page, 'sup', 'overscroll-behavior-y')).toBe('contain');
    await surfaceOf(page, 'sup').evaluate((el) => (el.scrollTop = 120));
    await touch.down(page, 'sup', 150);
    await touch.move(page, 40);
    await touch.move(page, 90);
    expect(near(await sheetHeight(page, 'sup'), 360, 0.5)).toBe(true);
    await expect(page.locator('#sup')).not.toHaveAttribute('data-height', /./);
    await touch.up(page, 90);
    await surfaceOf(page, 'sup').evaluate((el) => (el.scrollTop = 0));
    await touch.down(page, 'sup', 150);
    await touch.move(page, 20);
    await touch.move(page, 60);
    // The drag begins where the gesture is recognised, so the sheet does not jump.
    expect(near(await sheetHeight(page, 'sup'), 320, 1.5)).toBe(true);
    await expect(page.locator('#sup')).toHaveAttribute('data-height', 'dragging');
    await page.waitForTimeout(150);
    await touch.up(page, 60);
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);
  });

  test('an upward drag raises the sheet below its largest detent, and is the content\'s at the largest', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await touch.down(page, 'sup', 150);
    await touch.move(page, -30);
    await touch.move(page, -80);
    expect(near(await sheetHeight(page, 'sup'), 410, 1.5)).toBe(true);
    await touch.up(page, -80);
    await page.locator('#sup').evaluate((el) => el.setAttribute('detent', 'large'));
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(664);
    await touch.down(page, 'sup', 150);
    await touch.move(page, -30);
    await touch.move(page, -80);
    expect(near(await sheetHeight(page, 'sup'), 664, 0.5)).toBe(true);
    await touch.up(page, -80);
    await touch.down(page, 'sup', 150);
    await touch.move(page, 30);
    await touch.move(page, 80);
    expect(near(await sheetHeight(page, 'sup'), 614, 1.5)).toBe(true);
    await touch.up(page, 80);
  });

  test('the browser is told whose a touch is: the content\'s while it scrolls, the sheet\'s from its top', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const action = () => surfaceOf(page, 'sup').evaluate((el) => getComputedStyle(el).touchAction);
    expect(await action()).toBe('none');
    await surfaceOf(page, 'sup').evaluate((el) => (el.scrollTop = 80));
    await expect.poll(action).toBe('pan-y');
    await surfaceOf(page, 'sup').evaluate((el) => (el.scrollTop = 0));
    await expect.poll(action).toBe('none');
    await page.locator('#sup').evaluate((el) => el.setAttribute('detent', 'large'));
    await expect.poll(action).toBe('pan-up');
  });
});

// ---- the sheet grows out of its trigger ----------------------------------------------------------------------------

test.describe('a sheet grows out of its trigger', () => {
  test('it starts on the trigger, goes straight to its box with no drop, and the trigger is carried while it is out', async ({ page }) => {
    const run = await growRun(page, 'modal', 'glass=1', { w: 390, h: 720 });
    expect(growsStraight(run)).toBe(true);
    const last = run.opening.at(-1)!;
    for (const f of run.opening) if (f.h < last.h * 0.8) expect(f.ink).toBeLessThan(0.05);
    expect(last.ink).toBe(1);
    expect(run.opening[0]!.radius).toBeGreaterThan(8);
    expect(last.radius).toBeLessThan(33);
    const out = [...run.opening, ...run.closing];
    expect(out.length).toBeGreaterThan(20);
    for (const f of out) {
      expect(f.carried).toBe(true);
      expect(f.lens).toBe('none');
      expect(f.body).toBe('rgba(0, 0, 0, 0)');
      expect(f.rim).toBe('hidden');
    }
  });

  test('closing runs the same path back into the trigger', async ({ page }) => {
    const run = await growRun(page, 'modal', '', { w: 390, h: 720 });
    const end = run.closing.at(-1)!;
    expect(run.closing.length).toBeGreaterThan(8);
    expect(near(end.x, run.trigger.x) && near(end.y, run.trigger.y) && near(end.w, run.trigger.width) && near(end.h, run.trigger.height)).toBe(true);
    for (const f of run.closing) if (f.h < run.opening.at(-1)!.h * 0.8) expect(f.ink).toBe(0);
    await expect(page.locator('#modal > vire-button')).not.toHaveAttribute('data-carried', '');
  });

  test('canary: a sheet that pops open without growing fails it', async ({ page }) => {
    const run = await growRun(page, 'modal', 'rm=1', { w: 390, h: 720 });
    expect(growsStraight(run)).toBe(false);
  });

  test('without a trigger a bottom sheet rises from the bottom edge and the scrim comes in', async ({ page }) => {
    await slowTime(page);
    await sandbox(page);
    await record(page, 'hosted');
    const frame = await frameBox(page);
    const start = await mark(page);
    await page.locator('#host-open').click();
    await opened(page, 'hosted');
    const run = (await frames(page)).slice(start).filter((f) => f.open);
    const last = run.at(-1)!;
    expect(run[0]!.y).toBeGreaterThanOrEqual(frame.y + frame.height - 2);
    expect(near(last.y, frame.y + 56, 1)).toBe(true);
    const ys = run.map((f) => f.y);
    expect(ys.every((y, i) => i === 0 || y <= ys[i - 1]! + 0.5)).toBe(true);
    expect(new Set(ys.map(Math.round)).size).toBeGreaterThan(10);
    expect(run[0]!.scrim).toBeLessThan(0.05);
    expect(near(last.scrim, SHEET_SIZES.scrimAlpha, 0.001)).toBe(true);
    const scrims = run.map((f) => f.scrim);
    expect(scrims.every((s, i) => i === 0 || s >= scrims[i - 1]! - 0.001)).toBe(true);
    expect(last.carried).toBe(false);
  });

  test('without a trigger a centred sheet comes in from 96 % of its size', async ({ page }) => {
    await slowTime(page);
    await sandbox(page, '', { w: 900, h: 720 });
    await record(page, 'hosted');
    const start = await mark(page);
    await page.locator('#host-open').click();
    await opened(page, 'hosted');
    const run = (await frames(page)).slice(start).filter((f) => f.open);
    const last = run.at(-1)!;
    expect(last.form).toBe('centered-sheet');
    expect(near(run[0]!.w / last.w, SHEET_SIZES.entryScale, 0.01)).toBe(true);
    expect(near(run[0]!.h / last.h, SHEET_SIZES.entryScale, 0.01)).toBe(true);
    expect(run[0]!.ink).toBeLessThan(0.1);
    expect(last.ink).toBe(1);
    const center = (f: Frame) => [f.x + f.w / 2, f.y + f.h / 2];
    for (const f of run) expect([near(center(f)[0]!, center(last)[0]!, 0.6), near(center(f)[1]!, center(last)[1]!, 0.6)]).toEqual([true, true]);
  });

  test('a host that calls showPopover or showModal itself gets the same surface, and one that closes it gets a clean settle', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 700, h: 720 });
    await page.locator('#host-pop').click();
    await opened(page, 'pop');
    await expect(page.locator('#pop-trigger')).toHaveAttribute('aria-expanded', 'true');
    await surfaceOf(page, 'pop').evaluate((el) => (el as HTMLElement).hidePopover());
    await expect.poll(() => page.locator('#pop').getAttribute('data-phase')).toBeNull();
    await expect(page.locator('#pop-trigger')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#pop > vire-button')).not.toHaveAttribute('data-carried', '');
    await page.locator('#host-open').click();
    await opened(page, 'hosted');
    await surfaceOf(page, 'hosted').evaluate((el) => (el as HTMLDialogElement).close());
    await expect.poll(() => page.locator('#hosted').getAttribute('data-phase')).toBeNull();
    expect(await shown(page, 'hosted')).toBe(false);
    await page.locator('#host-open').click();
    await opened(page, 'hosted');
    expect(await shown(page, 'hosted')).toBe(true);
  });
});

// ---- the scrim -----------------------------------------------------------------------------------------------------

const watchPage = (page: Page) =>
  page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { __seen: Set<string> }).__seen = seen;
    const loop = () => {
      const el = document.getElementById('page')!;
      const r = el.getBoundingClientRect();
      seen.add(`${r.x},${r.y},${r.width},${r.height},${getComputedStyle(el).transform},${getComputedStyle(document.body).transform},${getComputedStyle(document.documentElement).transform}`);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

test.describe('the scrim', () => {
  test('dims at 32 % under a modal surface, comes in with the growth, and never scales or moves the background', async ({ page }) => {
    await slowTime(page);
    await sandbox(page);
    await watchPage(page);
    await record(page, 'modal');
    const start = await mark(page);
    await page.locator('#modal-trigger').click();
    await opened(page, 'modal');
    const run = (await frames(page)).slice(start).filter((f) => f.open);
    expect(await css(page, 'modal', 'background-color', '::backdrop')).toBe(`rgba(0, 0, 0, ${SHEET_SIZES.scrimAlpha})`);
    const scrims = run.map((f) => f.scrim);
    expect(scrims[0]).toBeLessThan(0.05);
    expect(scrims.every((s, i) => i === 0 || s >= scrims[i - 1]! - 0.001)).toBe(true);
    expect(new Set(scrims.map((s) => s.toFixed(2))).size).toBeGreaterThan(5);
    expect(await page.evaluate(() => (window as unknown as { __seen: Set<string> }).__seen.size)).toBe(1);
  });

  test('a supplementary sheet dims nothing and leaves the page its pointer', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    expect(await css(page, 'sup', 'background-color', '::backdrop')).toBe('rgba(0, 0, 0, 0)');
    expect(await css(page, 'sup', 'pointer-events', '::backdrop')).toBe('none');
    await page.locator('#before').click();
    expect(await log(page)).toContain('click:before');
    expect(await shown(page, 'sup')).toBe(true);
  });

  for (const [id, size, query] of [
    ['modal', { w: 390, h: 720 }, ''],
    ['picker', { w: 390, h: 720 }, ''],
  ] as const) {
    test(`a press on the scrim closes a ${id} bottom sheet`, async ({ page }) => {
      await sandbox(page, `rm=1&${query}`, size);
      await page.locator(`#${id}-trigger`).click();
      await resting(page, id);
      const frame = await frameBox(page);
      await page.mouse.click(frame.x + 190, frame.y + 40);
      await closed(page, id);
    });
  }

  const STAYS: [string, { w: number; h: number }, string][] = [
    ['modal', { w: 900, h: 720 }, 'a centred sheet'],
    ['dlg', { w: 700, h: 720 }, 'a dialog'],
    ['alert', { w: 390, h: 720 }, 'an alert'],
    ['modal', { w: 390, h: 720 }, 'a persistent bottom sheet'],
  ];
  for (const [id, size, what] of STAYS) {
    test(`a press on the scrim leaves ${what} open`, async ({ page }) => {
      await sandbox(page, 'rm=1', size);
      if (what.startsWith('a persistent')) await page.locator(`#${id}`).evaluate((el) => el.setAttribute('persistent', ''));
      await page.locator(`#${id}-trigger`).click();
      await resting(page, id);
      const frame = await frameBox(page);
      expect(await css(page, id, 'background-color', '::backdrop')).toBe(`rgba(0, 0, 0, ${SHEET_SIZES.scrimAlpha})`);
      await page.mouse.click(frame.x + 12, frame.y + 12);
      await page.waitForTimeout(300);
      expect(await shown(page, id)).toBe(true);
      await page.keyboard.press('Escape');
      await closed(page, id);
    });
  }
});

// ---- a change of form while open -----------------------------------------------------------------------------------

type Size = { w: number; h: number };

/** Opens `id` in a window of size `from`, resizes it to `to`, and keeps every frame of the surface on the way. */
async function morphRun(page: Page, id: string, from: Size, to: Size, query = '', prepare?: () => Promise<void>) {
  await slowTime(page, 0.5);
  await sandbox(page, query, from);
  await page.locator(`#${id}-trigger`).click();
  await resting(page, id);
  await prepare?.();
  await record(page, id);
  const start = await mark(page);
  await resize(page, to.w, to.h);
  if (!query.includes('rm=1')) await expect(page.locator(`#${id}`)).toHaveAttribute('data-phase', 'morph');
  await resting(page, id);
  await nextFrame(page);
  return (await frames(page)).slice(start);
}

/** One body that goes from the old width to the new one through widths in between, never leaving the top layer. */
const reshapes = (run: Frame[], from: number, to: number) => {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const between = run.filter((f) => f.open && f.w > lo + 4 && f.w < hi - 4);
  const ws = run.filter((f) => f.open).map((f) => f.w);
  const monotonic = ws.every((w, i) => i === 0 || (to > from ? w >= ws[i - 1]! - 0.5 : w <= ws[i - 1]! + 0.5));
  return run.every((f) => f.open) && between.length >= 3 && monotonic;
};

test.describe('an open sheet changes form', () => {
  test('a modal sheet becomes a centred one at 600 dp; the field, its selection, the focus and the scroll survive', async ({ page }) => {
    const run = await morphRun(page, 'modal', { w: 390, h: 720 }, { w: 900, h: 720 }, '', async () => {
      await page.locator('#modal-field').fill('Road Trip');
      await page.locator('#modal-field').evaluate((el: HTMLInputElement) => {
        el.setSelectionRange(1, 4);
        (window as unknown as { __kept: Element }).__kept = document.getElementById('modal-surface')!;
      });
      await surfaceOf(page, 'modal').evaluate((el) => (el.scrollTop = 150));
    });
    await expect(page.locator('#modal')).toHaveAttribute('data-form', 'centered-sheet');
    const from = run[0]!.w;
    expect(reshapes(run, from, 560)).toBe(true);
    const state = await page.evaluate(() => {
      const field = document.getElementById('modal-field') as HTMLInputElement;
      const surface = document.getElementById('modal-surface')!;
      return {
        same: (window as unknown as { __kept: Element }).__kept === surface,
        value: field.value,
        selection: [field.selectionStart, field.selectionEnd],
        focus: document.activeElement === field,
        scroll: surface.scrollTop,
        open: (surface as HTMLDialogElement).open,
      };
    });
    expect(state).toEqual({ same: true, value: 'Road Trip', selection: [1, 4], focus: true, scroll: 150, open: true });
  });

  test('canary: a form that changes in one jump fails the gate', async ({ page }) => {
    const run = await morphRun(page, 'modal', { w: 390, h: 720 }, { w: 900, h: 720 }, 'rm=1');
    expect(reshapes(run, run[0]!.w, 560)).toBe(false);
  });

  test('a popover becomes a bottom sheet below 600 dp and back, keeping what the person set', async ({ page }) => {
    const box = (page: Page) => page.locator('#pop-surface input').nth(1);
    const run = await morphRun(page, 'pop', { w: 700, h: 720 }, { w: 390, h: 720 }, '', async () => {
      await box(page).focus();
      await page.keyboard.press('Space');
    });
    await expect(page.locator('#pop')).toHaveAttribute('data-form', 'bottom-sheet');
    expect(run.every((f) => f.open)).toBe(true);
    expect(run.filter((f) => f.w > 160 && f.w < 360).length).toBeGreaterThanOrEqual(3);
    expect(await box(page).evaluate((el: HTMLInputElement) => [el.checked, document.activeElement === el])).toEqual([true, true]);
    expect(await shown(page, 'pop')).toBe(true);
    await resize(page, 700, 720);
    await expect(page.locator('#pop')).toHaveAttribute('data-form', 'popover');
    await resting(page, 'pop');
    expect(await box(page).evaluate((el: HTMLInputElement) => [el.checked, document.activeElement === el])).toEqual([true, true]);
  });

  test('a supplementary sheet goes bottom, side, third pane and back through the widths, keeping its detent and its scroll', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 700, h: 720 });
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await page.locator('#sup').evaluate((el) => el.setAttribute('detent', 'large'));
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(664);
    await page.locator('#sup-field').focus();
    await surfaceOf(page, 'sup').evaluate((el) => (el.scrollTop = 90));
    const state = () =>
      page.evaluate(() => {
        const surface = document.getElementById('sup-surface')!;
        return { focus: document.activeElement?.id, scroll: surface.scrollTop, open: surface.matches(':popover-open'), detent: document.getElementById('sup')!.getAttribute('detent') };
      });
    const steps: [Size, string][] = [
      [{ w: 1000, h: 720 }, 'side-sheet'],
      [{ w: 1700, h: 800 }, 'side-pane'],
      [{ w: 1000, h: 720 }, 'side-sheet'],
      [{ w: 700, h: 720 }, 'bottom-sheet'],
    ];
    for (const [size, form] of steps) {
      await resize(page, size.w, size.h);
      await expect(page.locator('#sup')).toHaveAttribute('data-form', form);
      await resting(page, 'sup');
      const now = await state();
      expect(now.focus, form).toBe('sup-field');
      expect(now.scroll, form).toBe(90);
      expect(now.open, form).toBe(true);
    }
    expect((await state()).detent).toBe('large');
    expect(near(await sheetHeight(page, 'sup'), 664, 0.5)).toBe(true);
    expect(await page.locator('.sh-bar').getAttribute('style')).toBeNull();
  });

  test('a sheet goes full screen on a compact height and comes back to its detent', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 700, h: 720 });
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await page.locator('#sup').evaluate((el) => el.setAttribute('detent', 'large'));
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(664);
    await page.locator('#sup-field').focus();
    await resize(page, 700, 420);
    await expect(page.locator('#sup')).toHaveAttribute('data-form', 'full-screen');
    await resting(page, 'sup');
    const frame = await frameBox(page);
    expect(await boxOf(page, 'sup')).toEqual({ x: frame.x, y: frame.y, width: 700, height: 420 });
    expect(await focused(page)).toBe('sup-field');
    await resize(page, 700, 720);
    await expect(page.locator('#sup')).toHaveAttribute('data-form', 'bottom-sheet');
    await resting(page, 'sup');
    expect(near(await sheetHeight(page, 'sup'), 664, 0.5)).toBe(true);
    await expect(page.locator('#sup')).toHaveAttribute('detent', 'large');
    expect(await focused(page)).toBe('sup-field');
  });

  test('reduced motion lands a change of form in one frame', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 390, h: 720 });
    await page.locator('#modal-trigger').click();
    await resting(page, 'modal');
    await record(page, 'modal');
    const start = await mark(page);
    await resize(page, 900, 720);
    await expect(page.locator('#modal')).toHaveAttribute('data-form', 'centered-sheet');
    await nextFrame(page);
    const run = (await frames(page)).slice(start);
    const first = run.findIndex((f) => f.form === 'centered-sheet');
    expect(run.slice(first).every((f) => near(f.w, 560, 0.5))).toBe(true);
    expect(run.slice(0, first).every((f) => !f.form || f.form === 'bottom-sheet')).toBe(true);
  });
});

// ---- the layers ----------------------------------------------------------------------------------------------------

test.describe('the side sheet and the third pane', () => {
  test('a side sheet is 360 wide, inset 8 with a radius of 24, glass, and narrows what is under it', async ({ page }) => {
    await sandbox(page, 'rm=1&glass=1', { w: 1200, h: 720 });
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const frame = await frameBox(page);
    const box = await boxOf(page, 'sup');
    expect(box).toEqual({ x: frame.x + frame.width - 8 - 360, y: frame.y + 8, width: 360, height: 720 - 16 });
    expect(parseFloat(await css(page, 'sup', 'border-top-left-radius'))).toBe(24);
    expect(await opaque(page, 'sup')).toBe(0);
    expect(await page.locator('#sup').getAttribute('data-glass')).toBe('on');
    expect(await page.locator('.sh-bar').evaluate((el) => el.style.getPropertyValue('--vire-sheet-inset-end'))).toBe(`${360 + 16}px`);
    await page.locator('#sup > vire-button').click();
    await closed(page, 'sup');
    expect(await page.locator('.sh-bar').getAttribute('style')).toBeNull();
  });

  test('it holds to a third of the window and never below 280', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 1000, h: 720 });
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const box = await boxOf(page, 'sup');
    expect(near(box.width, 1000 / 3, 0.1)).toBe(true);
    expect(box.width).toBeGreaterThanOrEqual(280);
  });

  test('from 1600 dp the third pane is the same box, opaque and not glass', async ({ page }) => {
    await sandbox(page, 'rm=1&glass=1', { w: 1700, h: 800 });
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const frame = await frameBox(page);
    expect(await boxOf(page, 'sup')).toEqual({ x: frame.x + 1700 - 8 - 360, y: frame.y + 8, width: 360, height: 800 - 16 });
    expect(await opaque(page, 'sup')).toBe(1);
    expect(await css(page, 'sup', 'backdrop-filter')).toBe('none');
    expect(await page.locator('.sh-bar').evaluate((el) => el.style.getPropertyValue('--vire-sheet-inset-end'))).toBe('376px');
  });
});

test.describe('centred sheets, dialogs, alerts and full screen', () => {
  test('a centred sheet is min(560, window - 48) wide, as tall as its content up to the window minus 48, and scrolls inside', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 900, h: 720 });
    await page.locator('#modal-trigger').click();
    await resting(page, 'modal');
    const frame = await frameBox(page);
    const box = await boxOf(page, 'modal');
    expect(box.width).toBe(560);
    expect(box.height).toBe(720 - 48);
    expect(near(box.x + box.width / 2, frame.x + 450)).toBe(true);
    expect(near(box.y + box.height / 2, frame.y + 360)).toBe(true);
    expect(parseFloat(await css(page, 'modal', 'border-top-left-radius'))).toBe(28);
    expect(await surfaceOf(page, 'modal').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.keyboard.press('Escape');
    await closed(page, 'modal');
    await resize(page, 600, 720);
    await page.locator('#modal-trigger').click();
    await resting(page, 'modal');
    expect((await boxOf(page, 'modal')).width).toBe(600 - 48);
  });

  test('a basic dialog is as tall as its content, an alert is min(320, window - 48) wide', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 700, h: 720 });
    await page.locator('#dlg-trigger').click();
    await resting(page, 'dlg');
    const box = await boxOf(page, 'dlg');
    expect(box.width).toBe(560);
    expect(near(box.height, await surfaceOf(page, 'dlg').evaluate((el) => el.scrollHeight), 1)).toBe(true);
    expect(box.height).toBeLessThan(300);
    await page.keyboard.press('Escape');
    await closed(page, 'dlg');
    await page.locator('#alert-trigger').click();
    await resting(page, 'alert');
    expect((await boxOf(page, 'alert')).width).toBe(320);
    await page.keyboard.press('Escape');
    await closed(page, 'alert');
    await resize(page, 340, 720);
    await page.locator('#alert-trigger').click();
    await resting(page, 'alert');
    expect((await boxOf(page, 'alert')).width).toBe(340 - 48);
  });

  test('a full-screen dialog is opaque and flush', async ({ page }) => {
    await sandbox(page, 'rm=1&glass=1', { w: 390, h: 720 });
    await page.locator('#dlg-trigger').click();
    await resting(page, 'dlg');
    const frame = await frameBox(page);
    expect(await boxOf(page, 'dlg')).toEqual({ x: frame.x, y: frame.y, width: 390, height: 720 });
    expect(await css(page, 'dlg', 'border-top-left-radius')).toBe('0px');
    expect(await opaque(page, 'dlg')).toBe(1);
    expect(await css(page, 'dlg', 'backdrop-filter')).toBe('none');
  });
});

// ---- the keyboard --------------------------------------------------------------------------------------------------

test.describe('the on-screen keyboard', () => {
  const keyboard = async (page: Page, height: number) => {
    const frame = await frameBox(page);
    await page.evaluate((h) => window.__lab.sheet!.setViewport({ height: h }), frame.y + frame.height - height);
    return frame.y + frame.height - height;
  };

  test('a field takes the sheet up above the keyboard, and it goes back when the keyboard leaves', async ({ page }) => {
    await sandbox(page, 'rm=1&stubvv=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const frame = await frameBox(page);
    expect(near(frame.y + 720 - (await boxOf(page, 'sup')).y, 360, 0.5)).toBe(true);
    await page.locator('#sup-field').focus();
    const top = await keyboard(page, 200);
    await expect.poll(async () => Math.round((await boxOf(page, 'sup')).y - frame.y)).toBe(SHEET_SIZES.detent.largeTopGap);
    const box = await boxOf(page, 'sup');
    expect(box.y + box.height).toBeLessThanOrEqual(top + 0.5);
    expect(top - (box.y + box.height)).toBeLessThan(20);
    await page.locator('#sup-field').evaluate((el) => (el as HTMLElement).blur());
    await keyboard(page, 0);
    await expect.poll(async () => Math.round(frame.y + 720 - (await boxOf(page, 'sup')).y)).toBe(360);
    const back = await boxOf(page, 'sup');
    expect(near(frame.y + 720 - (back.y + back.height), sheetInset(0.5), 0.5)).toBe(true);
  });

  test('it does not go back if the person moved it', async ({ page }) => {
    await sandbox(page, 'rm=1&stubvv=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    const frame = await frameBox(page);
    await page.locator('#sup-field').focus();
    await keyboard(page, 200);
    await expect.poll(async () => Math.round((await boxOf(page, 'sup')).y - frame.y)).toBe(SHEET_SIZES.detent.largeTopGap);
    await page.locator('#sup [data-vk-grabber]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#sup')).toHaveAttribute('detent', 'medium');
    await keyboard(page, 0);
    await expect.poll(async () => Math.round(frame.y + 720 - (await boxOf(page, 'sup')).y)).toBe(360);
    await page.locator('#sup').evaluate((el) => el.setAttribute('detent', 'large'));
    await expect.poll(async () => Math.round(frame.y + 720 - (await boxOf(page, 'sup')).y)).toBe(664);
    await page.locator('#sup-field').focus();
    await keyboard(page, 200);
    await page.locator('#sup [data-vk-grabber]').focus();
    await page.keyboard.press('ArrowDown');
    await keyboard(page, 0);
    await expect.poll(async () => Math.round(frame.y + 720 - (await boxOf(page, 'sup')).y)).toBe(360);
  });
});

// ---- closing runs the growth back first ----------------------------------------------------------------------------

/** The surface stays in the top layer through a retraction onto its trigger and only then leaves. */
const retraces = (run: Run) => {
  const end = run.closing.at(-1);
  return (
    run.closing.length >= 6 &&
    end !== undefined &&
    near(end.x, run.trigger.x, 2) &&
    near(end.y, run.trigger.y, 2) &&
    near(end.w, run.trigger.width, 2) &&
    near(end.h, run.trigger.height, 2) &&
    run.closing[0]!.h > end.h * 2
  );
};

const closeRun = async (page: Page, id: string, size: Size, close: (page: Page, run: { trigger: Box; frame: Box }) => Promise<void>, query = '') => {
  await slowTime(page, 0.5);
  await sandbox(page, query, size);
  const trigger = (await page.locator(`#${id} > vire-button`).boundingBox())!;
  const frame = await frameBox(page);
  await record(page, id);
  const start = await mark(page);
  await page.locator(`#${id}-trigger`).click();
  await resting(page, id);
  const middle = await mark(page);
  await page.waitForTimeout(100);
  await close(page, { trigger, frame });
  await closed(page, id);
  await page.waitForTimeout(50);
  const all = await frames(page);
  return { opening: all.slice(start, middle).filter((f) => f.open), closing: all.slice(middle).filter((f) => f.open), trigger, frame };
};

test.describe('closing retraces the growth', () => {
  const CASES: [string, string, Size, (page: Page, at: { frame: Box }) => Promise<void>, string][] = [
    ['pop', 'a popover\'s Escape', { w: 700, h: 720 }, (p) => p.keyboard.press('Escape'), ''],
    ['pop', 'a popover press outside', { w: 700, h: 720 }, (p, { frame }) => p.mouse.click(frame.x + 650, frame.y + 650), ''],
    ['pop', 'a popover trigger pressed from the keyboard', { w: 700, h: 720 }, (p) => p.locator('#pop-trigger').press('Enter'), ''],
    ['pop', 'a popover\'s Done button', { w: 700, h: 720 }, (p) => p.locator('#pop-close').click(), ''],
    ['pop', 'a popover sheet\'s scrim', { w: 390, h: 720 }, (p, { frame }) => p.mouse.click(frame.x + 200, frame.y + 40), ''],
    ['modal', 'a dialog\'s cancel', { w: 390, h: 720 }, (p) => p.keyboard.press('Escape'), ''],
    ['modal', 'a dialog\'s close command', { w: 390, h: 720 }, (p) => p.locator('#modal-close').click(), ''],
    ['modal', 'a modal sheet\'s scrim', { w: 390, h: 720 }, (p, { frame }) => p.mouse.click(frame.x + 190, frame.y + 40), ''],
    ['modal', 'a centred sheet\'s Escape', { w: 900, h: 720 }, (p) => p.keyboard.press('Escape'), ''],
    ['dlg', 'a form method dialog submit', { w: 700, h: 720 }, (p) => p.locator('#dlg-save').click(), ''],
    ['alert', 'an alert\'s close command', { w: 390, h: 720 }, (p) => p.locator('#alert-delete').click(), ''],
    [
      'sup',
      'a swipe below the lowest detent',
      { w: 390, h: 720 },
      async (p) => {
        const g = await grabberAt(p, 'sup');
        await p.mouse.move(g.x, g.y);
        await p.mouse.down();
        await p.mouse.move(g.x, g.y + 140);
        await p.waitForTimeout(250);
        await p.mouse.up();
      },
      '',
    ],
  ];
  for (const [id, what, size, close, query] of CASES) {
    test(`${what} runs the growth back before the surface leaves the top layer, and focus returns to the trigger`, async ({ page }) => {
      const run = await closeRun(page, id, size, close, query);
      expect(retraces(run)).toBe(true);
      expect(run.closing.every((f) => f.open)).toBe(true);
      // A press outside takes focus where it lands, as a popover's light dismiss does; every other way back returns it.
      if (!what.includes('press outside')) expect(await focused(page)).toBe(`${id}-trigger`);
    });
  }

  test('the dialog keeps the value of the button that submitted it', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 700, h: 720 });
    await page.locator('#dlg-trigger').click();
    await resting(page, 'dlg');
    await page.locator('#dlg-save').click();
    await closed(page, 'dlg');
    expect(await surfaceOf(page, 'dlg').evaluate((el) => (el as HTMLDialogElement).returnValue)).toBe('save');
  });

  test('canary: a surface that leaves the top layer at once fails it', async ({ page }) => {
    const run = await closeRun(page, 'modal', { w: 390, h: 720 }, (p) => p.keyboard.press('Escape'), 'rm=1');
    expect(retraces(run)).toBe(false);
  });

  test('opening it again while it retracts turns it back from where it is', async ({ page }) => {
    await slowTime(page, 0.5);
    await sandbox(page, '', { w: 390, h: 720 });
    await page.locator('#modal-trigger').click();
    await resting(page, 'modal');
    await record(page, 'modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    const turn = await mark(page);
    await page.locator('#modal > vire-button').evaluate((el) => (el as HTMLElement).click());
    await resting(page, 'modal');
    const after = (await frames(page)).slice(turn);
    expect(after.every((f) => f.open)).toBe(true);
    expect(await shown(page, 'modal')).toBe(true);
    expect(Math.min(...after.map((f) => f.h))).toBeGreaterThan(60);
  });

  test('a second Escape while a popover retracts changes nothing, and its trigger turns it back', async ({ page }) => {
    await slowTime(page, 0.5);
    await sandbox(page, '', { w: 700, h: 720 });
    await page.locator('#pop-trigger').click();
    await resting(page, 'pop');
    await record(page, 'pop');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    const turn = await mark(page);
    await page.locator('#pop-trigger').press('Enter');
    await resting(page, 'pop');
    const after = (await frames(page)).slice(turn);
    expect(after.every((f) => f.open)).toBe(true);
    expect(await shown(page, 'pop')).toBe(true);
    expect(Math.min(...after.map((f) => f.h))).toBeGreaterThan(44);
  });
});

// ---- accessibility modes -------------------------------------------------------------------------------------------

const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

test.describe('accessibility modes', () => {
  test('reduced motion opens and closes in one frame, the content in focus at once', async ({ page }) => {
    await sandbox(page, 'rm=1', { w: 700, h: 720 });
    await record(page, 'pop');
    const start = await mark(page);
    await page.locator('#pop-trigger').click();
    const opened = (await frames(page)).slice(start).find((f) => f.source === 'click')!;
    await resting(page, 'pop');
    const settled = (await frames(page)).at(-1)!;
    expect(opened.open).toBe(true);
    expect([opened.x, opened.y, opened.w, opened.h]).toEqual([settled.x, settled.y, settled.w, settled.h]);
    expect(opened.ink).toBe(1);
    const before = await mark(page);
    await page.keyboard.press('Escape');
    const closedAt = (await frames(page)).slice(before).find((f) => f.source === 'key')!;
    expect(closedAt.open).toBe(false);
  });

  test('the system setting is followed when nothing overrides it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCase(page, 'view=sheet&glass=0');
    await page.locator('#modal-trigger').click();
    expect(await page.locator('#modal').getAttribute('data-phase')).toBe('open');
  });

  const READABLE = async (page: Page, id: string) => {
    const colours = await surfaceOf(page, id).evaluate((el) => {
      const rgb = (v: string) => (v.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const s = getComputedStyle(el);
      return { ink: rgb(s.color), body: rgb(s.backgroundColor), alpha: Number((s.backgroundColor.match(/[\d.]+/g) ?? [])[3] ?? 1), filter: s.backdropFilter };
    });
    const a = luminance(colours.ink);
    const b = luminance(colours.body);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { ...colours, ratio };
  };

  const CASES: [string, Size, string][] = [
    ['sup', { w: 390, h: 720 }, 'a bottom sheet'],
    ['modal', { w: 900, h: 720 }, 'a centred sheet'],
    ['pop', { w: 700, h: 720 }, 'a popover'],
  ];

  for (const [id, size, what] of CASES) {
    for (const backdrop of ['light', 'dark']) {
      test(`reduced transparency makes ${what} opaque and readable on ${backdrop}, with the same geometry`, async ({ page }) => {
        const open = async (query: string) => {
          await sandbox(page, `rm=1&glass=1&backdrop=${backdrop}&${query}`, size);
          await page.locator(`#${id}-trigger`).click();
          await resting(page, id);
        };
        await open('rt=0');
        const glass = await boxOf(page, id);
        await open('rt=1');
        expect(await boxOf(page, id)).toEqual(glass);
        await expect(page.locator(`#${id}`)).toHaveAttribute('data-surface', 'plain');
        const read = await READABLE(page, id);
        expect(read.alpha).toBe(1);
        expect(read.filter).toBe('none');
        expect(read.ratio).toBeGreaterThan(7);
        expect(await opaque(page, id)).toBe(1);
      });

      test(`increased contrast makes ${what} opaque, bordered and readable on ${backdrop}, with the same geometry`, async ({ page }) => {
        await sandbox(page, `rm=1&glass=1&backdrop=${backdrop}&ic=0`, size);
        await page.locator(`#${id}-trigger`).click();
        await resting(page, id);
        const glass = await boxOf(page, id);
        await sandbox(page, `rm=1&glass=1&backdrop=${backdrop}&ic=1`, size);
        await page.locator(`#${id}-trigger`).click();
        await resting(page, id);
        expect(await boxOf(page, id)).toEqual(glass);
        await expect(page.locator(`#${id}`)).toHaveAttribute('data-contrast', '');
        expect(await css(page, id, 'box-shadow')).toContain('inset');
        const read = await READABLE(page, id);
        expect(read.alpha).toBe(1);
        expect(read.ratio).toBeGreaterThan(7);
      });
    }
  }

  test('glass on is a lens over a clear body, and glass off is an opaque body that works for every kind', async ({ page }) => {
    await sandbox(page, 'rm=1&glass=1');
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    expect((await READABLE(page, 'sup')).alpha).toBeLessThan(0.5);
    expect(await css(page, 'sup', 'backdrop-filter')).toContain('url(');
    for (const [id, size] of [
      ['pop', { w: 700, h: 720 }],
      ['sup', { w: 390, h: 720 }],
      ['modal', { w: 390, h: 720 }],
      ['picker', { w: 900, h: 720 }],
      ['dlg', { w: 700, h: 720 }],
      ['alert', { w: 390, h: 720 }],
    ] as const) {
      await sandbox(page, 'rm=1&glass=0', size);
      await expect(page.locator(`#${id}`)).toHaveAttribute('data-glass', 'off');
      await page.locator(`#${id}-trigger`).click();
      await resting(page, id);
      const read = await READABLE(page, id);
      expect(read.alpha, id).toBe(1);
      expect(read.filter, id).toBe('none');
      expect(read.ratio, id).toBeGreaterThan(7);
      if (id === 'sup') await page.locator('#sup > vire-button').click();
      else await page.keyboard.press('Escape');
      await closed(page, id);
    }
  });
});

// ---- one lens per open surface -------------------------------------------------------------------------------------

// The recording stand-in for `vireglass/dom` sees which lens is attached to what, which are alive and which are present.
const RECORDING_LENS = (appear: boolean) => `
const flat = { luma: 0.9, busy: 0, lo: 0.9, hi: 0.9, r: 0.9, g: 0.9, b: 0.9 };
export function probeBackdrop() { return flat; }
export function statsFromSamples() { return flat; }
export function attachGlass(el, opts) {
  const rec = { id: el.id, el, alive: true, appear: 1, calls: [] };
  (window.__lenses ??= []).push(rec);
  el.style.setProperty('backdrop-filter', 'blur(1px)');
  const note = (morph) => rec.calls.push({ geometry: { ...opts.geometry }, morph });
  return {
    update() { note(undefined); },
    setMorph(m) { note(m); },
    setAppear(t) { ${appear ? 'rec.appear = t;' : ''} },
    setSample() {}, setAccent() {}, setNeighbourGlow() {},
    destroy() { rec.alive = false; },
  };
}`;
const stubGlass = (page: Page, appear = true) =>
  page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS(appear) }));

/** The glass surfaces a host shows: lenses alive, present and drawn. */
const lenses = (page: Page, host: string) =>
  page.evaluate((host) => {
    const root = document.getElementById(host)!;
    const all = ((window as unknown as { __lenses?: { id: string; el: HTMLElement; alive: boolean; appear: number }[] }).__lenses ?? []);
    return all.filter((l) => l.alive && l.appear > 0 && root.contains(l.el) && l.el.getClientRects().length > 0).map((l) => l.id);
  }, host);

test.describe('one glass surface per open surface', () => {
  test('the trigger has handed its body over: a popover and a sheet each show one lens while open, the trigger\'s while closed', async ({ page }) => {
    await stubGlass(page);
    await sandbox(page, 'rm=1&glass=1', { w: 700, h: 720 });
    await expect.poll(() => lenses(page, 'pop')).toEqual(['pop-trigger']);
    await page.locator('#pop-trigger').click();
    await resting(page, 'pop');
    expect(await lenses(page, 'pop')).toEqual(['pop-surface']);
    await page.keyboard.press('Escape');
    await closed(page, 'pop');
    await expect.poll(() => lenses(page, 'pop')).toEqual(['pop-trigger']);
    await page.locator('#modal-trigger').click();
    await resting(page, 'modal');
    expect(await lenses(page, 'modal')).toEqual(['modal-surface']);
    expect(await lenses(page, 'sup')).toEqual(['sup-trigger']);
  });

  test('the third pane and full screen attach no glass, and a side sheet does', async ({ page }) => {
    await stubGlass(page);
    const alive = (id: string) =>
      page.evaluate((id) => ((window as unknown as { __lenses?: { id: string; alive: boolean }[] }).__lenses ?? []).filter((l) => l.id === id && l.alive).length, id);
    await sandbox(page, 'rm=1&glass=1', { w: 1700, h: 800 });
    await page.locator('#sup-trigger').click();
    await resting(page, 'sup');
    await expect.poll(() => alive('sup-surface')).toBe(0);
    expect(await lenses(page, 'sup')).toEqual([]);
    await resize(page, 1000, 720);
    await expect(page.locator('#sup')).toHaveAttribute('data-form', 'side-sheet');
    await expect.poll(() => alive('sup-surface')).toBe(1);
    await expect.poll(() => lenses(page, 'sup')).toEqual(['sup-surface']);
    await page.locator('#sup > vire-button').click();
    await closed(page, 'sup');
    await resize(page, 390, 720);
    await page.locator('#dlg-trigger').click();
    await resting(page, 'dlg');
    await expect.poll(() => alive('dlg-surface')).toBe(0);
    expect(await lenses(page, 'dlg')).toEqual([]);
    expect(await alive('dlg-trigger')).toBe(1);
  });

  test('the lens is handed the box of the surface on every size', async ({ page }) => {
    await stubGlass(page);
    await sandbox(page, 'rm=1&glass=1', { w: 700, h: 720 });
    await page.locator('#pop-trigger').click();
    await resting(page, 'pop');
    const box = await boxOf(page, 'pop');
    const last = await page.evaluate(() => {
      const rec = (window as unknown as { __lenses: { id: string; calls: { geometry: { width: number; height: number; cornerRadius: number } }[] }[] }).__lenses.find((l) => l.id === 'pop-surface')!;
      return rec.calls.at(-1)!.geometry;
    });
    expect([last.width, last.height]).toEqual([Math.round(box.width), Math.round(box.height)]);
    expect(last.cornerRadius).toBe(28);
  });

  test('canary: a trigger that keeps its lens while the surface is out fails the count', async ({ page }) => {
    await stubGlass(page, false);
    await sandbox(page, 'rm=1&glass=1', { w: 700, h: 720 });
    await page.locator('#pop-trigger').click();
    await resting(page, 'pop');
    expect((await lenses(page, 'pop')).length).toBe(2);
  });
});

// ---- a real touch ----------------------------------------------------------------------------------------------------

test.describe('a touch on a touch screen', () => {
  test.use({ hasTouch: true });

  const fingers = async (page: Page) => {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y! }] });
    return {
      down: (x: number, y: number) => send('touchStart', x, y),
      move: (x: number, y: number) => send('touchMove', x, y),
      up: () => send('touchEnd'),
    };
  };

  test('a finger on the grabber drags the sheet, and one on the content\'s top does too, while the browser leaves the page where it is', async ({ page }) => {
    await sandbox(page, 'rm=1');
    await page.locator('#sup-trigger').tap();
    await resting(page, 'sup');
    const finger = await fingers(page);
    const g = await grabberAt(page, 'sup');
    await finger.down(g.x, g.y);
    for (const dy of [-10, -30, -60, -90]) await finger.move(g.x, g.y + dy);
    expect(near(await sheetHeight(page, 'sup'), 450, 2)).toBe(true);
    await page.waitForTimeout(250);
    await finger.up();
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);

    const box = await boxOf(page, 'sup');
    const x = box.x + box.width / 2;
    const y = box.y + 150;
    await finger.down(x, y);
    for (const dy of [10, 30, 60]) await finger.move(x, y + dy);
    const pulled = await sheetHeight(page, 'sup');
    expect(pulled).toBeLessThan(360 - 20);
    expect(await surfaceOf(page, 'sup').evaluate((el) => el.scrollTop)).toBe(0);
    await page.waitForTimeout(250);
    await finger.up();
    await expect.poll(() => sheetHeight(page, 'sup').then(Math.round)).toBe(360);

    await surfaceOf(page, 'sup').evaluate((el) => (el.scrollTop = 100));
    await finger.down(x, y);
    for (const dy of [-10, -30, -60]) await finger.move(x, y + dy);
    await finger.up();
    expect(near(await sheetHeight(page, 'sup'), 360, 0.5)).toBe(true);
    expect(await surfaceOf(page, 'sup').evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  });
});

import { expect, test, type Page } from '@playwright/test';
import { openCase } from './helpers';

test.use({ viewport: { width: 1900, height: 1100 } });

// A surface measures its content while the page is idle so the click that opens it does not. These tests watch the
// measuring state (`data-measure`) and the per-paint custom properties from outside, through spies installed before
// the page runs.

type Spy = { measures: Record<string, number>; framed: Record<string, number>; props: Record<string, number>; click: { measures: number; props: Record<string, number>; lens: number } | null };
declare global {
  interface Window {
    __spy: Spy;
  }
}

const SPY = () => {
  const spy: Spy = { measures: {}, framed: {}, props: {}, click: null };
  window.__spy = spy;
  // Work inside an animation-frame callback or a resize observer's callback is work inside a frame.
  let inFrame = 0;
  const inside = <A extends unknown[]>(run: (...args: A) => void) => (...args: A) => {
    inFrame += 1;
    try {
      run(...args);
    } finally {
      inFrame -= 1;
    }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf(inside(callback));
  const Observer = window.ResizeObserver;
  window.ResizeObserver = class extends Observer {
    constructor(callback: ResizeObserverCallback) {
      super(inside(callback));
    }
  };
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (name === 'data-measure') {
      const id = (this as Element).id;
      spy.measures[id] = (spy.measures[id] ?? 0) + 1;
      if (inFrame > 0) spy.framed[id] = (spy.framed[id] ?? 0) + 1;
    }
    return setAttribute.call(this, name, value);
  };
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name: string, value: string | null, priority?: string) {
    spy.props[name] = (spy.props[name] ?? 0) + 1;
    return setProperty.call(this, name, value, priority);
  };
  // Registered before the surface's own frame, so it runs first in the frame after the click.
  document.addEventListener(
    'click',
    () => {
      const lensCalls = () => ((window as unknown as { __lenses?: { calls: unknown[] }[] }).__lenses ?? []).reduce((n, l) => n + l.calls.length, 0);
      const was = { measures: { ...spy.measures }, props: { ...spy.props }, lens: lensCalls() };
      requestAnimationFrame(() => {
        const props: Record<string, number> = {};
        for (const [k, n] of Object.entries(spy.props)) props[k] = n - (was.props[k] ?? 0);
        spy.click = { measures: Object.keys(spy.measures).reduce((n, k) => n + spy.measures[k]! - (was.measures[k] ?? 0), 0), props, lens: lensCalls() - was.lens };
      });
    },
    true,
  );
};

const measures = (page: Page, id: string) => page.evaluate((id) => window.__spy.measures[id] ?? 0, id);
const framed = (page: Page, id: string) => page.evaluate((id) => window.__spy.framed[id] ?? 0, id);
const clickWork = (page: Page) => page.waitForFunction(() => window.__spy.click !== null).then(() => page.evaluate(() => window.__spy.click!));
const noIdleCallback = (page: Page) => page.addInitScript(() => Reflect.deleteProperty(window, 'requestIdleCallback'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(SPY);
});

const RECORDING_LENS = `
const flat = { luma: 0.9, busy: 0, lo: 0.9, hi: 0.9, r: 0.9, g: 0.9, b: 0.9 };
export function probeBackdrop() { return flat; }
export function statsFromSamples() { return flat; }
export function attachGlass(el, opts) {
  const rec = { id: el.id, calls: [] };
  (window.__lenses ??= []).push(rec);
  el.style.setProperty('backdrop-filter', 'blur(1px)');
  const note = (morph) => rec.calls.push({ morph });
  return {
    update() { note(undefined); },
    setMorph(m) { note(m); },
    setAppear() {}, setSample() {}, setInterim() {}, setAccent() {}, setNeighbourGlow() {},
    destroy() {},
  };
}`;
const stubGlass = (page: Page) => page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS }));
const morphs = (page: Page, id: string) =>
  page.evaluate((id) => (window as unknown as { __lenses: { id: string; calls: { morph: unknown }[] }[] }).__lenses.filter((l) => l.id === id).flatMap((l) => l.calls.map((c) => c.morph)), id);

// ---- the menu ------------------------------------------------------------------------------------------------------

const menu = async (page: Page, query = '') => {
  await openCase(page, `view=menu&glass=0${query}`);
  await expect.poll(() => measures(page, 'more')).toBeGreaterThan(0);
};
const listBox = (page: Page) => page.locator('#more-list').evaluate((el) => el.getBoundingClientRect().height);

test.describe('a menu measures while the page is idle', () => {
  test('the click that opens it does not measure, and paints once', async ({ page }) => {
    await menu(page);
    await page.locator('#more-trigger').click();
    expect(await clickWork(page)).toMatchObject({ measures: 0, props: { '--vk-ink-in': 1 } });
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
  });

  test('a text edit inside an item, a font that finished loading and an image that loaded each measure again', async ({ page }) => {
    await menu(page);
    const changes: (() => unknown)[] = [
      () => (document.querySelector('#more-list > button')!.lastChild!.textContent = 'A much longer label than the others'),
      () => document.fonts.dispatchEvent(new Event('loadingdone')),
      () => document.querySelector('#more-list > button')!.dispatchEvent(new Event('load')),
    ];
    for (const [i, change] of changes.entries()) {
      const was = await measures(page, 'more');
      await page.evaluate(change);
      await expect.poll(() => measures(page, 'more'), `change ${i}`).toBeGreaterThan(was);
    }
  });

  test('a size change nothing observed is found after the open settles, and the menu ends at the size it needs', async ({ page }) => {
    await menu(page);
    const before = await listBox(page);
    await page.addStyleTag({ content: '#more-list > button { min-height: 80px !important; }' });
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    await expect.poll(() => listBox(page)).toBeGreaterThan(80 * 5);
    expect(before).toBeLessThan(80 * 5);
  });

  test('with reduced motion the same stale measure is corrected too', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await menu(page);
    await page.addStyleTag({ content: '#more-list > button { min-height: 80px !important; }' });
    await page.locator('#more-trigger').click();
    await expect.poll(() => listBox(page)).toBeGreaterThan(80 * 5);
  });

  test('opened from the keyboard on the idle measure, the first item has focus', async ({ page }) => {
    await menu(page);
    await page.locator('#more-trigger').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Copy link');
  });

  test('its lens is handed no null morph on the way open', async ({ page }) => {
    await stubGlass(page);
    await openCase(page, 'view=menu');
    await page.locator('#more-trigger').click();
    await expect(page.locator('#more')).toHaveAttribute('data-phase', 'open');
    expect((await morphs(page, 'more-list')).filter((m) => m === null)).toHaveLength(0);
  });

  test('a menu taken out of the page before its idle callback runs never measures, and one put back measures', async ({ page }) => {
    await noIdleCallback(page);
    await openCase(page, 'view=menu&glass=0');
    const count = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const host = document.getElementById('more')!;
          const parent = host.parentElement!;
          const next = host.nextSibling;
          const at = window.__spy.measures.more ?? 0;
          host.remove();
          setTimeout(() => {
            const gone = (window.__spy.measures.more ?? 0) - at;
            parent.insertBefore(host, next);
            setTimeout(() => resolve([gone, (window.__spy.measures.more ?? 0) - at]), 600);
          }, 400);
        }),
    );
    expect(count[0]).toBe(0);
    expect(count[1]).toBeGreaterThan(0);
    await page.locator('#more-trigger').click();
    expect((await clickWork(page)).measures).toBe(0);
  });

  test('without requestIdleCallback it measures after a timer, and the open still does not', async ({ page }) => {
    await noIdleCallback(page);
    await menu(page);
    await page.locator('#more-trigger').click();
    expect((await clickWork(page)).measures).toBe(0);
  });
});

// ---- the sheet -----------------------------------------------------------------------------------------------------

const sheet = async (page: Page, query = '') => {
  await openCase(page, `view=sheet&w=390&h=1000&glass=0${query}`);
  await expect.poll(() => measures(page, 'pop')).toBeGreaterThan(0);
};
const rested = async (page: Page) => {
  await expect(page.locator('#pop')).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('#pop')).not.toHaveAttribute('data-height', /./);
};
const fit = (page: Page) => page.evaluate(() => ({ height: document.getElementById('pop-surface')!.getBoundingClientRect().height }));

test.describe('a sheet measures while the page is idle', () => {
  test('the click that opens it does not measure', async ({ page }) => {
    await sheet(page);
    await page.locator('#pop-trigger').click();
    expect((await clickWork(page)).measures).toBe(0);
    await rested(page);
  });

  test('a style inside the closed content, a font and an image each measure again', async ({ page }) => {
    await sheet(page, '&rm=1');
    const changes: (() => unknown)[] = [
      () => ((document.querySelector('#pop-surface h2') as HTMLElement).style.minHeight = '40px'),
      () => document.fonts.dispatchEvent(new Event('loadingdone')),
      () => document.querySelector('#pop-surface h2')!.dispatchEvent(new Event('load')),
    ];
    for (const [i, change] of changes.entries()) {
      const was = await measures(page, 'pop');
      await page.evaluate(change);
      await expect.poll(() => measures(page, 'pop'), `change ${i}`).toBeGreaterThan(was);
    }
  });

  for (const [what, query] of [['', '&rm=1'], [' with motion', '']] as const) {
    test(`a size change nothing observed is found after the open settles, and the sheet ends as tall as one opened with it${what}`, async ({ page, context }) => {
      const css = '#pop-surface h2 { min-height: 240px !important; }';
      const reference = await context.newPage();
      await reference.addInitScript((css) => document.addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: css }))), css);
      await openCase(reference, `view=sheet&w=390&h=1000&glass=0&rm=1`);
      await reference.locator('#pop-trigger').click();
      await rested(reference);
      const want = (await fit(reference)).height;
      await reference.close();
      await sheet(page, query);
      const before = (await fit(page)).height;
      await page.addStyleTag({ content: css });
      await page.locator('#pop-trigger').click();
      await rested(page);
      await expect.poll(async () => Math.abs((await fit(page)).height - want), { timeout: 5000 }).toBeLessThan(3);
      expect(want - before).toBeGreaterThan(100);
    });
  }

  test('a content size found once the sheet is open is measured on the idle page, not in the frame that reports it, and the sheet follows', async ({ page }) => {
    await sheet(page);
    await page.locator('#pop-trigger').click();
    await rested(page);
    const [was, before] = [await measures(page, 'pop'), (await fit(page)).height];
    const inFrame = await framed(page, 'pop');
    await page.addStyleTag({ content: '#pop-surface h2 { min-height: 240px !important; }' });
    await expect.poll(() => measures(page, 'pop')).toBeGreaterThan(was);
    await expect.poll(async () => (await fit(page)).height - before).toBeGreaterThan(100);
    expect(await framed(page, 'pop')).toBe(inFrame);
  });

  test('a content size held until the height comes to rest is measured on the idle page too, and the sheet follows', async ({ page }) => {
    await sheet(page);
    await page.locator('#sup-trigger').click();
    await expect(page.locator('#sup')).toHaveAttribute('data-phase', 'open');
    await expect(page.locator('#sup')).not.toHaveAttribute('data-height', /./);
    const [was, inFrame] = [await measures(page, 'sup'), await framed(page, 'sup')];
    const height = () => page.evaluate(() => document.getElementById('sup-surface')!.getBoundingClientRect().height);
    const before = await height();
    await page.evaluate(() => {
      document.getElementById('sup')!.setAttribute('detent', 'large');
      document.querySelector<HTMLElement>('#sup-surface h2')!.style.minHeight = '300px';
    });
    await expect.poll(() => measures(page, 'sup')).toBeGreaterThan(was);
    await expect(page.locator('#sup')).not.toHaveAttribute('data-height', /./);
    await expect.poll(async () => (await height()) - before).toBeGreaterThan(40);
    expect(await framed(page, 'sup')).toBe(inFrame);
  });

  test('opened on the idle measure, the first control has focus', async ({ page }) => {
    await sheet(page, '&rm=1');
    await page.locator('#pop-trigger').click();
    await rested(page);
    expect(await page.evaluate(() => document.activeElement?.closest('#pop-surface') !== null && document.activeElement !== document.body)).toBe(true);
  });

  test('its open hands the lens nothing inside the click: its first shape comes with the first frame', async ({ page }) => {
    await stubGlass(page);
    await openCase(page, 'view=sheet&w=390&h=1000&glass=1');
    await expect.poll(() => measures(page, 'pop')).toBeGreaterThan(0);
    await page.locator('#pop-trigger').click();
    expect((await clickWork(page)).lens).toBe(0);
    await rested(page);
    expect((await morphs(page, 'pop-surface')).length).toBeGreaterThan(0);
  });

  test('its open sends the lens no null morph', async ({ page }) => {
    await stubGlass(page);
    await openCase(page, 'view=sheet&w=390&h=1000&rm=1&glass=1');
    await page.locator('#pop-trigger').click();
    await rested(page);
    expect((await morphs(page, 'pop-surface')).filter((m) => m === null)).toHaveLength(0);
  });

  test('a sheet taken out of the page before its fallback timer runs never measures, and one put back does', async ({ page }) => {
    await noIdleCallback(page);
    await openCase(page, 'view=sheet&w=390&h=1000&glass=0');
    const gone = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const host = document.getElementById('pop')!;
          const parent = host.parentElement!;
          const next = host.nextSibling;
          const at = window.__spy.measures.pop ?? 0;
          host.remove();
          setTimeout(() => {
            const n = (window.__spy.measures.pop ?? 0) - at;
            parent.insertBefore(host, next);
            resolve(n);
          }, 500);
        }),
    );
    expect(gone).toBe(0);
    await expect.poll(() => measures(page, 'pop')).toBeGreaterThan(0);
  });
});

// ---- the popover's backdrop and environment ------------------------------------------------------------------------

type Reads = { hits: number; env: number; click: { hits: number; env: number } | null };
declare global {
  interface Window {
    __reads: Reads;
  }
}

// Counts the page hit tests and the environment reads (the probe element the surface appends); the click's share is what
// happens between the click's capture and the next frame.
const READS = () => {
  const reads: Reads = { hits: 0, env: 0, click: null };
  window.__reads = reads;
  const hit = document.elementsFromPoint.bind(document);
  document.elementsFromPoint = (x: number, y: number) => {
    reads.hits += 1;
    return hit(x, y);
  };
  const computed = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    if (el.hasAttribute('data-vk-probe')) reads.env += 1;
    return computed(el, pseudo);
  }) as typeof window.getComputedStyle;
  document.addEventListener(
    'click',
    () => {
      const was = { hits: reads.hits, env: reads.env };
      requestAnimationFrame(() => (reads.click = { hits: reads.hits - was.hits, env: reads.env - was.env }));
    },
    true,
  );
};

const popover = async (page: Page, query = '') => {
  await page.addInitScript(READS);
  await openCase(page, `view=sheet&w=700&h=720&glass=1${query}`);
  await calm(page);
};
// The idle reads are done once nothing reads for a while.
const calm = async (page: Page) => {
  let last = -1;
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => window.__reads.hits + window.__reads.env);
      const same = now === last && now > 0;
      last = now;
      return same;
    }, { intervals: [400] })
    .toBe(true);
};
const clickReads = (page: Page) => page.waitForFunction(() => window.__reads.click !== null).then(() => page.evaluate(() => window.__reads.click!));
const reads = (page: Page) => page.evaluate(() => ({ hits: window.__reads.hits, env: window.__reads.env }));
const restOpen = (page: Page) => expect(page.locator('#pop')).toHaveAttribute('data-phase', 'open');

test.describe('a popover reads its backdrop and its environment while the page is idle', () => {
  test('the click that opens it hit-tests nothing and reads no environment', async ({ page }) => {
    await popover(page);
    await page.locator('#pop-trigger').click();
    expect(await clickReads(page)).toEqual({ hits: 0, env: 0 });
    await restOpen(page);
  });

  test('a scroll of a container behind it drops the sample, and the click reads the page', async ({ page }) => {
    await popover(page);
    await page.evaluate(() => {
      const inner = document.createElement('div');
      inner.id = 'inner';
      inner.style.cssText = 'position:absolute;left:500px;top:300px;width:80px;height:80px;overflow:auto';
      inner.innerHTML = '<div style="height:400px"></div>';
      document.getElementById('frame')!.append(inner);
    });
    await calm(page);
    await page.evaluate(() => (window.__reads.click = null));
    // Clicked in the scroll event itself, before the page is idle again to read what the scroll dropped.
    await page.evaluate(() => {
      const inner = document.getElementById('inner')!;
      inner.addEventListener('scroll', () => document.getElementById('pop-trigger')!.click(), { once: true });
      inner.scrollTop = 40;
    });
    expect((await clickReads(page)).hits).toBeGreaterThan(0);
  });

  test('a backdrop that changed without a signal is read again once the open settles, and the ink follows', async ({ page }) => {
    await popover(page);
    // An adopted sheet is no mutation, so nothing tells the surface.
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.sh-frame, .sh-frame * { background: #000 !important; color: #fff !important; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    await page.locator('#pop-trigger').click();
    expect((await clickReads(page)).hits).toBe(0);
    await restOpen(page);
    await expect.poll(() => page.locator('#pop').getAttribute('data-ink')).toBe('light');
  });

  test('its environment is read again after the colour scheme changes, and the click still reads none', async ({ page }) => {
    await popover(page);
    const was = (await reads(page)).env;
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await reads(page)).env).toBeGreaterThan(was);
    await calm(page);
    await page.locator('#pop-trigger').click();
    expect((await clickReads(page)).env).toBe(0);
    await restOpen(page);
  });

  test('opened from the keyboard on the idle reads, the first control has focus', async ({ page }) => {
    await popover(page);
    await page.locator('#pop-trigger').focus();
    await page.keyboard.press('Enter');
    await restOpen(page);
    expect(await page.evaluate(() => document.activeElement?.closest('#pop-surface') !== null && document.activeElement !== document.body)).toBe(true);
  });

  test('with reduced motion the open takes the idle reads too', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await popover(page);
    await page.locator('#pop-trigger').click();
    expect(await clickReads(page)).toEqual({ hits: 0, env: 0 });
    await restOpen(page);
  });
});

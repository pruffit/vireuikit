import { expect, test, type Page } from '@playwright/test';
import { emulateInput, nextFrame, openCase } from './helpers';

const log = (page: Page) => page.locator('#log').evaluate((el) => (el.textContent ?? '').split('\n').filter(Boolean));
const clicks = async (page: Page) => (await log(page)).filter((line) => line.startsWith('click:'));
const attr = (page: Page, name: string) => page.locator('vire-nav').getAttribute(name);

/** Opens the sandbox in a window of `w` × `h` dp and waits until the navigation has settled. */
async function openNav(page: Page, query = '', w = 430, h = 720): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openCase(page, `view=nav&w=${w}&h=${h}&${query}`);
  await settle(page);
}

const settle = async (page: Page) => {
  await page.waitForFunction(() => {
    const host = document.querySelector('vire-nav');
    return host?.hasAttribute('data-vk') && !host.hasAttribute('data-moving') && !host.querySelector(':scope > [data-accessory][data-moving]');
  });
  await nextFrame(page);
};

const resize = async (page: Page, w: number, h: number) => {
  await page.evaluate(([width, height]) => window.__lab.nav!.resize(width!, height!), [w, h]);
};

/** Resizes the window and waits for the form it asks for, and for the change to land. */
const reform = async (page: Page, w: number, h: number, form: string) => {
  await resize(page, w, h);
  await page.waitForFunction((wanted) => document.querySelector('vire-nav')!.getAttribute('data-form') === wanted, form);
  await settle(page);
};

type Box = { x: number; y: number; w: number; h: number };
type Sample = {
  now: number;
  form: string | undefined;
  min: boolean;
  moving: boolean;
  ink: number;
  body: Box;
  lens: (Box & { text: string; lift: number; dragging: boolean }) | null;
  focus: string;
  acc: (Box & { placement: string }) | null;
};

/**
 * Samples the navigation once per animation frame while `steps` resize the window, until it has been still for
 * a few frames after the last step.
 */
async function sampleFrames(page: Page, steps: { at: number; w?: number; h?: number; scroll?: number }[], limit = 4000): Promise<Sample[]> {
  return page.evaluate(
    ([plan, max]) =>
      new Promise<Sample[]>((resolve) => {
        const host = document.querySelector('vire-nav') as HTMLElement;
        const nav = host.querySelector(':scope > nav') as HTMLElement;
        const lens = host.querySelector(':scope > [data-vk-lens]') as HTMLElement;
        const acc = host.querySelector(':scope > [data-accessory]') as HTMLElement | null;
        const num = (el: HTMLElement, name: string) => parseFloat(el.style.getPropertyValue(name));
        const box = (el: HTMLElement): Box => ({ x: num(el, '--vk-x'), y: num(el, '--vk-y'), w: num(el, '--vk-w'), h: num(el, '--vk-h') });
        const out: Sample[] = [];
        let start = 0;
        let next = 0;
        let calm = 0;
        const tick = (now: number) => {
          if (!start) start = now;
          const elapsed = now - start;
          while (next < plan.length && elapsed >= plan[next]!.at) {
            const step = plan[next]!;
            if (step.w !== undefined) window.__lab.nav!.resize(step.w, step.h!);
            if (step.scroll !== undefined) document.getElementById('scroller')!.scrollTop = step.scroll;
            next += 1;
          }
          const moving = host.hasAttribute('data-moving');
          const shown = host.hasAttribute('data-lens');
          out.push({
            now: elapsed,
            form: host.dataset.form,
            min: host.hasAttribute('data-minimized'),
            moving,
            ink: parseFloat(host.style.getPropertyValue('--vk-ink')),
            body: box(nav),
            lens: shown
              ? {
                  ...box(lens),
                  text: (lens.textContent ?? '').trim(),
                  lift: num(lens, '--vk-lift'),
                  dragging: lens.hasAttribute('data-dragging'),
                }
              : null,
            focus: (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '',
            acc: acc
              ? { ...box(acc), placement: acc.getAttribute('data-placement') ?? '' }
              : null,
          });
          calm = next >= plan.length && !moving && !acc?.hasAttribute('data-moving') ? calm + 1 : 0;
          if (calm >= 6 || elapsed > max) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [steps, limit] as const,
  );
}

// ---- gates over sampled frames, shared by the tests and their canaries ----------------------------------------------

const area = (b: Box) => b.w * b.h;

/** The body never jumps: no frame covers 40 % of the whole way it travels in any of its numbers. */
function jumps(samples: Sample[]): string[] {
  const out: string[] = [];
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const values = samples.map((s) => s.body[key]);
    const total = Math.max(...values) - Math.min(...values);
    if (total < 20) continue;
    for (let i = 1; i < samples.length; i += 1) {
      const step = Math.abs(samples[i]!.body[key] - samples[i - 1]!.body[key]);
      if (step > 0.4 * total) out.push(`${key} jumps ${step.toFixed(0)} of ${total.toFixed(0)} at frame ${i}`);
    }
  }
  return out;
}

/** A change of form goes through the selection: a lens, a body contracted to it, the form swapped at the middle. */
function morphGate(samples: Sample[]): string[] {
  const out = jumps(samples);
  const withLens = samples.filter((s) => s.lens);
  if (withLens.length < 5) out.push(`the lens shows in ${withLens.length} frames`);
  const ratio = Math.min(...withLens.map((s) => area(s.body) / area(s.lens!)));
  if (!(ratio <= 1.1)) out.push(`the body never contracts to the lens (closest ${ratio.toFixed(2)})`);
  const flips = samples.filter((s, i) => i > 0 && s.form !== samples[i - 1]!.form);
  if (flips.length !== 1) out.push(`the form changes ${flips.length} times`);
  else if (!flips[0]!.lens || area(flips[0]!.body) > 1.5 * area(flips[0]!.lens)) out.push('the form swaps while the body is not the lens');
  return out;
}

test.describe('before the upgrade', () => {
  test('a nav of links works with no script: one landmark, links that navigate, Tab walking them', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openCase(page, 'atom=nav&form=bar&upgrade=0&glass=0');
    await expect(page.locator('vire-nav[data-vk]')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(1);
    const links = page.getByRole('link');
    await expect(links).toHaveCount(7);
    expect(await page.locator('[aria-current="page"]').textContent()).toBe('Library');
    await links.first().focus();
    const walked: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      walked.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
    }
    expect(walked).toEqual(['Library', 'Friends', 'Messages3, 3 new', 'Feed', 'Dashboard', 'Search']);
    await Promise.all([page.waitForURL(/\/friends$/), page.getByRole('link', { name: 'Friends' }).click()]);
  });
});

test.describe('roles', () => {
  for (const [form, w, h] of [
    ['bar', 430, 720],
    ['rail', 700, 720],
    ['sidebar', 1280, 800],
  ] as const) {
    test(`the ${form} is one navigation landmark with the author's label, links stay links`, async ({ page }) => {
      await openNav(page, 'glass=0', w, h);
      expect(await attr(page, 'data-form')).toBe(form);
      await expect(page.getByRole('navigation')).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
      expect(await page.locator('vire-nav [role]').count()).toBe(0);
      expect(await page.locator('vire-nav [role="tablist"], vire-nav [role="tab"]').count()).toBe(0);
      const links = page.locator('vire-nav nav a:visible');
      for (const role of await links.evaluateAll((els) => els.map((el) => el.getAttribute('role')))) expect(role).toBeNull();
      expect(await page.locator('vire-nav [aria-current]').evaluateAll((els) => els.map((el) => el.textContent?.trim()))).toEqual(['Home']);
    });
  }

  test('the arrow keys are not taken, and aria-current stays the host\'s', async ({ page }) => {
    await openNav(page, 'glass=0');
    await page.getByRole('link', { name: 'Library' }).focus();
    const prevented: boolean[] = [];
    await page.exposeFunction('seen', (value: boolean) => prevented.push(value));
    await page.evaluate(() => document.addEventListener('keydown', (e) => void (window as unknown as { seen(v: boolean): void }).seen(e.defaultPrevented)));
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) await page.keyboard.press(key);
    await nextFrame(page);
    expect(prevented.length).toBe(6);
    expect(prevented.every((p) => !p)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Library');
    await page.evaluate(() => document.querySelector('vire-nav [aria-current]')!.removeAttribute('aria-current'));
    await reform(page, 700, 720, 'rail');
    expect(await page.locator('vire-nav [aria-current]').count()).toBe(0);
  });

  test('removing the element gives the markup back with nothing of its own left', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await openCase(page, 'view=nav&w=430&h=720&upgrade=0&glass=0');
    const read = () =>
      page.evaluate(() => {
        const frame = document.getElementById('frame')!;
        return { html: frame.querySelector('vire-nav')?.outerHTML ?? null, frameStyle: frame.getAttribute('style') };
      });
    // Upgrade-less markup: the element is not defined, so the page holds the author's own.
    await page.waitForFunction(() => !document.querySelector('vire-nav[data-vk]'));
    const before = await read();
    await page.evaluate(() => {
      window.__lab.define();
    });
    await settle(page);
    await page.evaluate(() => (document.querySelector('vire-nav') as HTMLElement).focus());
    await page.getByRole('link', { name: 'Library' }).focus();
    await page.evaluate(() => {
      const w = window as unknown as { __nav: HTMLElement };
      w.__nav = document.querySelector('vire-nav')!;
      w.__nav.remove();
    });
    const removed = await page.evaluate(() => (window as unknown as { __nav: HTMLElement }).__nav.outerHTML);
    expect(removed).toBe(before.html);
    expect((await read()).frameStyle).toBe(before.frameStyle);
    expect(await page.evaluate(() => document.querySelectorAll('[data-vk-pill],[data-vk-lens],[data-vk-toggle],[data-vk-scrim]').length)).toBe(0);
  });

  test('connecting it again upgrades it, and it upgrades markup that arrives after it', async ({ page }) => {
    await openNav(page, 'glass=0');
    await page.evaluate(() => {
      const host = document.querySelector('vire-nav')!;
      const parent = host.parentElement!;
      host.remove();
      parent.append(host);
    });
    await settle(page);
    expect(await attr(page, 'data-form')).toBe('bar');
    const late = await page.evaluate(
      () =>
        new Promise<string | null>((resolve) => {
          const empty = document.createElement('vire-nav');
          empty.id = 'late';
          document.getElementById('frame')!.append(empty);
          const nav = document.createElement('nav');
          nav.setAttribute('aria-label', 'Late');
          nav.innerHTML = '<ul><li><a href="/a" aria-current="page">A</a></li><li><a href="/b">B</a></li></ul>';
          setTimeout(() => {
            empty.append(nav);
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(empty.getAttribute('data-form'))));
          }, 30);
        }),
    );
    expect(late).toBe('bar');
  });
});

test.describe('badges', () => {
  test('a badge is a picture and a [data-badge-label] says it: the link reads "Messages, 3 new", the count is not read glued to the label', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    // The link is a flex container, so the browsers put a space between the text and the label's element.
    await expect(page.getByRole('link', { name: /^Messages ?, 3 new$/ })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /Messages ?3/ })).toHaveCount(0);
    expect(await page.locator('vire-nav [data-badge]').getAttribute('aria-hidden')).toBe('true');
    const label = (await page.locator('vire-nav [data-badge-label]').boundingBox())!;
    expect(label.width).toBeLessThanOrEqual(1);
    expect(label.height).toBeLessThanOrEqual(1);
    const badge = (await page.locator('vire-nav [data-badge]').boundingBox())!;
    expect(badge.width).toBeGreaterThan(8);
  });

  test('a badge added later is hidden from the tree too, and removing the element gives the authors attribute back', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('vire-nav nav a')].find((a) => a.textContent === 'Friends')!;
      link.insertAdjacentHTML('beforeend', '<span data-badge></span><span data-badge-label>, new activity</span>');
      document.querySelector('vire-nav [data-badge]')!.setAttribute('aria-hidden', 'false');
    });
    await settle(page);
    await expect(page.getByRole('link', { name: /^Friends ?, new activity$/ })).toHaveCount(1);
    const hidden = await page.locator('vire-nav [data-badge]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-hidden')));
    expect(hidden).toEqual(['true', 'true']);
    const restored = await page.evaluate(() => {
      const host = document.querySelector('vire-nav')!;
      host.remove();
      return [...host.querySelectorAll('[data-badge]')].map((el) => el.getAttribute('aria-hidden'));
    });
    expect(restored).toEqual(['false', null]);
  });
});

test.describe('the form', () => {
  for (const [name, w, h, form, search] of [
    ['a phone', 430, 720, 'bar', 'button'],
    ['a medium window', 700, 720, 'rail', 'item'],
    ['an expanded window', 1000, 720, 'rail', 'item'],
    ['a short window', 900, 440, 'rail', 'item'],
    ['a large window', 1280, 800, 'sidebar', 'field'],
  ] as const) {
    test(`${name} is a ${form}, its search ${search === 'button' ? 'a circle' : search === 'item' ? 'an item' : 'a field-like row'}`, async ({ page }) => {
      await openNav(page, 'glass=0', w, h);
      expect(await attr(page, 'data-form')).toBe(form);
      expect(await attr(page, 'data-search')).toBe(search);
      const secondary = page.locator('vire-nav ul[data-secondary] a');
      if (form === 'sidebar') await expect(secondary).toHaveCount(2);
      await expect(page.locator('vire-nav ul[data-secondary] a:visible')).toHaveCount(form === 'sidebar' ? 2 : 0);
      const searchBox = (await page.locator('vire-nav a[data-search]').boundingBox())!;
      const navBox = (await page.locator('vire-nav > nav').boundingBox())!;
      if (form === 'bar') {
        expect(searchBox.width).toBe(56);
        expect(searchBox.x).toBeGreaterThanOrEqual(navBox.x + navBox.width);
      } else {
        expect(searchBox.x).toBeGreaterThanOrEqual(navBox.x);
        expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(navBox.x + navBox.width);
      }
    });
  }

  test('the form attribute fixes it, and collapsed holds a large window\'s sidebar as a rail', async ({ page }) => {
    await openNav(page, 'glass=0&nav-form=rail', 430, 720);
    expect(await attr(page, 'data-form')).toBe('rail');
    await openNav(page, 'glass=0&nav-form=sidebar', 430, 720);
    expect(await attr(page, 'data-form')).toBe('sidebar');
    await openNav(page, 'glass=0&nav-collapsed=', 1280, 800);
    expect(await attr(page, 'data-form')).toBe('rail');
    await page.evaluate(() => document.querySelector('vire-nav')!.removeAttribute('collapsed'));
    await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'sidebar');
  });

  test('two panes on a medium window take the bar', async ({ page }) => {
    await openNav(page, 'glass=0&nav-panes=2', 700, 720);
    expect(await attr(page, 'data-form')).toBe('bar');
  });

  test('destinations beyond the bar\'s slots become secondary and show only in the sidebar', async ({ page }) => {
    await openNav(page, 'glass=0&extra=0', 430, 720);
    await page.evaluate(() => {
      const list = document.querySelector('vire-nav nav > ul')!;
      for (const [href, label] of [['/a', 'Alpha'], ['/b', 'Beta']] as const) {
        const li = document.createElement('li');
        li.innerHTML = `<a href="${href}">${label}</a>`;
        list.append(li);
      }
    });
    await settle(page);
    // six primary links, five slots with the search: four on the bar, two more behind
    await expect(page.locator('vire-nav nav > ul:not([data-secondary]) a:visible')).toHaveCount(4);
    await reform(page, 1280, 800, 'sidebar');
    await expect(page.locator('vire-nav nav a:visible')).toHaveCount(6 + 2 + 1);
  });
});

test.describe('the boxes', () => {
  test('the bar is a capsule centred at the bottom with 74 dp items and the pill on the selection', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const frame = (await page.locator('#frame').boundingBox())!;
    const nav = (await page.locator('vire-nav > nav').boundingBox())!;
    const search = (await page.locator('vire-nav a[data-search]').boundingBox())!;
    expect(nav.height).toBe(56);
    expect(nav.width).toBe(4 * 74 + 6);
    expect(frame.y + frame.height - (nav.y + nav.height)).toBe(16);
    expect(search.width).toBe(56);
    expect(search.height).toBe(56);
    expect(search.x - (nav.x + nav.width)).toBeCloseTo(8, 1);
    expect(nav.x - frame.x).toBeCloseTo(frame.x + frame.width - (search.x + search.width), 1);
    const items = await page.locator('vire-nav nav > ul:not([data-secondary]) a').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, column: getComputedStyle(el).flexDirection };
      }),
    );
    expect(items.map((i) => i.w)).toEqual([74, 74, 74, 74]);
    expect(items[0]!.x - nav.x).toBe(3);
    expect(items[0]!.y - nav.y).toBe(3);
    expect(items.every((i) => i.column === 'column')).toBe(true);
    const pill = (await page.locator('[data-vk-pill]').boundingBox())!;
    expect([pill.x, pill.y, pill.width, pill.height]).toEqual([items[0]!.x, items[0]!.y, items[0]!.w, items[0]!.h]);
  });

  test('the rail is a vertical capsule at the leading edge, the sidebar a 280 dp inset panel with rows beside their icons', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 700, 720);
    const frame = (await page.locator('#frame').boundingBox())!;
    const rail = (await page.locator('vire-nav > nav').boundingBox())!;
    expect(rail.x - frame.x).toBe(8);
    expect(rail.y - frame.y).toBe(8);
    expect(rail.width).toBe(80);
    expect(rail.height).toBeGreaterThan(rail.width * 3);
    const rows = page.locator('vire-nav nav > ul:not([data-secondary]) a');
    expect(await rows.first().evaluate((el) => getComputedStyle(el).flexDirection)).toBe('column');
    await reform(page, 1280, 800, 'sidebar');
    const side = (await page.locator('vire-nav > nav').boundingBox())!;
    expect(side.width).toBe(280);
    expect(side.x - frame.x).toBe(8);
    expect(side.height).toBe(800 - 16);
    const row = await rows.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const icon = el.querySelector('svg')!.getBoundingClientRect();
      return { direction: getComputedStyle(el).flexDirection, h: r.height, iconRight: icon.right, iconTop: icon.top, rowTop: r.top };
    });
    expect(row.direction).toBe('row');
    expect(row.h).toBe(36);
    expect(row.iconRight).toBeLessThan(side.x + 60);
  });
});

test.describe('the insets', () => {
  test('follow the form, on the parent and in the event', async ({ page }) => {
    await openNav(page, 'glass=0', 430, 720);
    const insets = () =>
      page.locator('#frame').evaluate((el) => [el.style.getPropertyValue('--vire-nav-inset-bottom'), el.style.getPropertyValue('--vire-nav-inset-start')]);
    // the bar's 72 and 16 below it, and the accessory's 48 and 8 above
    expect(await insets()).toEqual(['128px', '0px']);
    await reform(page, 700, 720, 'rail');
    const rail = await insets();
    expect(rail[1]).toBe('96px');
    await reform(page, 1280, 800, 'sidebar');
    expect((await insets())[1]).toBe('296px');
    const layouts = (await log(page)).filter((line) => line.startsWith('layout:'));
    expect(layouts[0]).toBe('layout:bar:full:above-bar:128:0');
    expect(layouts.some((line) => line.startsWith('layout:rail:full:content-bottom:'))).toBe(true);
    expect(layouts.at(-1)).toMatch(/^layout:sidebar:full:content-bottom:\d+:296$/);
    expect(new Set(layouts).size).toBe(layouts.length);
  });

  test('are taken away with the element', async ({ page }) => {
    await openNav(page, 'glass=0');
    await page.evaluate(() => document.querySelector('vire-nav')!.remove());
    expect(await page.locator('#frame').evaluate((el) => el.style.getPropertyValue('--vire-nav-inset-bottom'))).toBe('');
  });
});

// The recording stand-in for `vireglass/dom` sees exactly what the element hands each lens, and which are alive.
const RECORDING_LENS = `
const flat = { luma: 0.9, busy: 0, lo: 0.9, hi: 0.9, r: 0.9, g: 0.9, b: 0.9 };
export function probeBackdrop() { return flat; }
export function statsFromSamples() { return flat; }
export function attachGlass(el, opts) {
  const kind = el.matches('vire-nav > nav') ? 'body' : el.hasAttribute('data-vk-lens') ? 'lens' : el.hasAttribute('data-accessory') ? 'accessory' : 'other';
  const rec = { kind, alive: true, calls: [], appears: [] };
  (window.__lenses ??= []).push(rec);
  el.style.setProperty('backdrop-filter', 'blur(1px)');
  const note = (morph) => rec.calls.push({ geometry: { ...opts.geometry }, morph, at: performance.now() });
  return {
    update() { note(undefined); },
    setMorph(m) { note(m); },
    setAppear(t) { rec.appears.push(t); },
    setSample() {}, setAccent() {}, setNeighbourGlow() {},
    destroy() { rec.alive = false; },
  };
}`;

type Rec = {
  kind: string;
  alive: boolean;
  calls: { geometry: { width: number; height: number }; morph: { smoothing: number; shape: { width: number; offsetX: number } } | null | undefined }[];
  appears: number[];
};
const lenses = (page: Page) => page.evaluate(() => (window as unknown as { __lenses?: Rec[] }).__lenses ?? []);
const stubGlass = (page: Page) => page.route('**/vireglass_dom.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: RECORDING_LENS }));

test.describe('a change of form', () => {
  for (const [name, first, second] of [
    ['bar to rail', [430, 720], [700, 720]],
    ['rail to sidebar', [700, 720], [1280, 800]],
    ['sidebar to bar', [1280, 800], [430, 720]],
    ['bar to sidebar', [430, 720], [1280, 800]],
  ] as const) {
    test(`${name} goes through the selection: a lens, the body contracted to it, the form swapped at the middle, no jump`, async ({ page }) => {
      await openNav(page, 'glass=0&accessory=0', first[0], first[1]);
      const samples = await sampleFrames(page, [{ at: 60, w: second[0], h: second[1] }]);
      expect(morphGate(samples)).toEqual([]);
      expect(samples.at(-1)!.lens).toBeNull();
      expect(samples.at(-1)!.ink).toBeCloseTo(1, 2);
    });
  }

  test('a navigation that swaps its form fails it', async ({ page }) => {
    // Reduced motion is the stub: the form flips in one frame, with no lens and no body travelling.
    await openNav(page, 'glass=0&accessory=0&rm=1', 430, 720);
    const samples = await sampleFrames(page, [{ at: 60, w: 700, h: 720 }]);
    const failures = morphGate(samples);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toMatch(/lens|jumps/);
  });

  test('the old content defocuses out before the middle, the new focuses in after it, and the lens holds the selection throughout', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const samples = await sampleFrames(page, [{ at: 60, w: 700, h: 720 }]);
    const swap = samples.findIndex((s, i) => i > 0 && s.form !== samples[i - 1]!.form);
    expect(swap).toBeGreaterThan(0);
    const before = samples.slice(0, swap).map((s) => s.ink);
    const after = samples.slice(swap).map((s) => s.ink);
    for (let i = 1; i < before.length; i += 1) expect(before[i]!).toBeLessThanOrEqual(before[i - 1]! + 0.01);
    for (let i = 1; i < after.length; i += 1) expect(after[i]!).toBeGreaterThanOrEqual(after[i - 1]! - 0.01);
    expect(Math.min(...samples.map((s) => s.ink))).toBeLessThan(0.02);
    expect(samples[swap]!.ink).toBeLessThan(0.05);
    const showing = samples.filter((s) => s.lens);
    expect(showing.length).toBeGreaterThan(10);
    for (const s of showing) expect(s.lens!.text).toBe('Home');
    for (const s of samples.filter((x) => x.ink < 0.05)) expect(s.lens).not.toBeNull();
  });

  test('the whole change takes about 0.8 to 0.9 s', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const samples = await sampleFrames(page, [{ at: 60, w: 700, h: 720 }]);
    const start = samples.find((s) => s.moving)!.now;
    const landed = samples.find((s) => s.moving && s.lens && s.now > start + 300 && s.lens.lift < 0.05)!.now;
    expect(landed - start).toBeGreaterThan(700);
    expect(landed - start).toBeLessThan(1000);
  });

  test('turned back mid-way it runs back from where it is, and a third form swaps the target while the body is the lens', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const back = await sampleFrames(page, [
      { at: 60, w: 700, h: 720 },
      { at: 230, w: 430, h: 720 },
    ]);
    expect(new Set(back.map((s) => s.form))).toEqual(new Set(['bar']));
    expect(back.some((s) => s.lens)).toBe(true);
    expect(back.at(-1)!.lens).toBeNull();
    const excursion = Math.max(...back.map((s) => s.body.w)) - Math.min(...back.map((s) => s.body.w));
    expect(excursion).toBeGreaterThan(100);
    for (let i = 1; i < back.length; i += 1) expect(Math.abs(back[i]!.body.w - back[i - 1]!.body.w)).toBeLessThan(0.4 * excursion);

    const third = await sampleFrames(page, [
      { at: 60, w: 700, h: 720 },
      { at: 330, w: 1280, h: 800 },
    ]);
    expect(third.at(-1)!.form).toBe('sidebar');
    expect(third.at(-1)!.body).toMatchObject({ w: 280 });
    expect(third.some((s) => s.form === 'rail')).toBe(false);
    const flips = third.filter((s, i) => i > 0 && s.form !== third[i - 1]!.form);
    expect(flips).toHaveLength(1);
    expect(third.at(-1)!.lens).toBeNull();
  });

  test('reduced motion lands the new form in the next frame, with no lens', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0&rm=1', 430, 720);
    const samples = await sampleFrames(page, [{ at: 60, w: 700, h: 720 }]);
    const flip = samples.findIndex((s, i) => i > 0 && s.form !== samples[i - 1]!.form);
    expect(flip).toBeGreaterThan(0);
    expect(samples[flip + 1]!.body).toMatchObject({ x: 8, y: 8, w: 80 });
    expect(samples[flip + 1]!.moving).toBe(false);
    expect(samples.every((s) => s.lens === null)).toBe(true);
  });

  test('a change of form keeps the selection and the focus', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await page.getByRole('link', { name: 'Library' }).focus();
    const samples = await sampleFrames(
      page,
      [
        { at: 60, w: 700, h: 720 },
        { at: 1500, w: 1280, h: 800 },
      ],
      6000,
    );
    expect(new Set(samples.map((s) => s.form))).toEqual(new Set(['bar', 'rail', 'sidebar']));
    for (const s of samples) expect(s.focus).toBe('Library');
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Library');
    expect(await page.locator('vire-nav [aria-current]').evaluateAll((els) => els.map((el) => el.textContent?.trim()))).toEqual(['Home']);
  });

  test("the sidebar's scroll comes back after a trip through the rail", async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0&extra=12', 1280, 480);
    await expect(page.locator('vire-nav')).toHaveAttribute('data-scroll', '');
    await page.locator('vire-nav > nav').evaluate((el) => (el.scrollTop = 150));
    await nextFrame(page);
    await reform(page, 900, 480, 'rail');
    await expect(page.locator('vire-nav')).not.toHaveAttribute('data-scroll', '');
    await reform(page, 1280, 480, 'sidebar');
    await expect(page.locator('vire-nav')).toHaveAttribute('data-scroll', '');
    expect(await page.locator('vire-nav > nav').evaluate((el) => el.scrollTop)).toBe(150);
  });
});

test.describe('a rail taller than its window', () => {
  test('stops at the window edge and scrolls its rows inside the body, remembering the offset', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0&nav-form=rail', 700, 280);
    const host = page.locator('vire-nav');
    await expect(host).toHaveAttribute('data-scroll', '');
    const frame = await rect(page, '#frame');
    const body = await rect(page, 'vire-nav > nav');
    expect(body.y + body.height).toBeCloseTo(frame.y + frame.height - 8, 1);
    const search = page.locator('vire-nav a[data-search]');
    const before = (await search.boundingBox())!;
    expect(before.y + before.height).toBeGreaterThan(body.y + body.height + 1);
    await page.locator('vire-nav > nav').evaluate((el) => (el.scrollTop = 1000));
    await nextFrame(page);
    const top = await page.locator('vire-nav > nav').evaluate((el) => el.scrollTop);
    expect(top).toBeGreaterThan(20);
    const end = (await search.boundingBox())!;
    expect(end.y + end.height).toBeLessThanOrEqual(body.y + body.height + 1);
    await resize(page, 700, 600);
    await expect(host).not.toHaveAttribute('data-scroll', '');
    await resize(page, 700, 280);
    await expect(host).toHaveAttribute('data-scroll', '');
    await settle(page);
    expect(await page.locator('vire-nav > nav').evaluate((el) => el.scrollTop)).toBe(top);
  });
});

test.describe('the lens', () => {
  test("on the bar the search circle is the lens's second shape, and buds off the trailing end as the bar grows and merges back as it contracts", async ({ page }) => {
    await stubGlass(page);
    await openNav(page, 'accessory=0', 700, 720);
    await page.waitForFunction(() => (window as unknown as { __lenses?: Rec[] }).__lenses?.some((l) => l.kind === 'body' && l.calls.length > 0));
    const body = async () => (await lenses(page)).find((l) => l.kind === 'body')!;
    const railCalls = (await body()).calls.length;
    expect((await body()).calls.at(-1)!.morph ?? null).toBeNull();

    await reform(page, 430, 720, 'bar');
    const grown = (await body()).calls.slice(railCalls).filter((c) => c.morph !== undefined);
    const shapes = grown.filter((c) => c.morph).map((c) => c.morph!);
    expect(shapes.length).toBeGreaterThan(3);
    const smoothing = shapes.map((m) => m.smoothing);
    expect(Math.max(...smoothing)).toBeGreaterThan(0);
    expect(smoothing.at(-1)).toBe(0);
    for (let i = 1; i < smoothing.length; i += 1) expect(smoothing[i]!).toBeLessThanOrEqual(smoothing[i - 1]!);
    const widths = shapes.map((m) => m.shape.width);
    for (let i = 1; i < widths.length; i += 1) expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]!);
    expect(widths.at(-1)).toBe(56);
    expect(shapes.at(-1)!.shape.offsetX).toBeGreaterThan(100);

    const barCalls = (await body()).calls.length;
    await reform(page, 700, 720, 'rail');
    const merged = (await body()).calls.slice(barCalls).filter((c) => c.morph);
    const out = merged.map((c) => c.morph!.smoothing);
    for (let i = 1; i < out.length; i += 1) expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
    expect(Math.max(...out)).toBeGreaterThan(10);
    const shrinking = merged.map((c) => c.morph!.shape.width);
    for (let i = 1; i < shrinking.length; i += 1) expect(shrinking[i]!).toBeLessThanOrEqual(shrinking[i - 1]!);
    expect((await body()).calls.at(-1)!.morph ?? null).toBeNull();
  });

  test("at rest there is one glass surface for the body and its search, plus the accessory's; the lens is glass only while it moves", async ({ page }) => {
    await stubGlass(page);
    await openNav(page, '', 430, 720);
    await page.waitForFunction(() => (window as unknown as { __lenses?: Rec[] }).__lenses?.filter((l) => l.alive).length === 2);
    const alive = async () =>
      (await lenses(page))
        .filter((l) => l.alive)
        .map((l) => l.kind)
        .sort();
    expect(await alive()).toEqual(['accessory', 'body']);

    await page.evaluate(() => {
      (window as unknown as { __peak: number }).__peak = 0;
      const watch = () => {
        const live = ((window as unknown as { __lenses: Rec[] }).__lenses ?? []).filter((l) => l.alive && l.kind === 'lens').length;
        const w = window as unknown as { __peak: number };
        w.__peak = Math.max(w.__peak, live);
        requestAnimationFrame(watch);
      };
      watch();
    });
    await reform(page, 700, 720, 'rail');
    expect(await page.evaluate(() => (window as unknown as { __peak: number }).__peak)).toBe(1);
    expect((await lenses(page)).filter((l) => l.kind === 'lens')).toHaveLength(1);
    expect(await alive()).toEqual(['accessory', 'body']);
  });
});

// ---- the selection under the finger ----------------------------------------------------------------------------------

const linkBox = async (page: Page, name: string) => {
  const box = (await page.locator('vire-nav nav a', { hasText: name }).first().boundingBox())!;
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
};

type Drag = { pointer: number; centre: number; width: number; dragging: boolean; frameLeft: number };

/** The lens as drawn now against the pointer, in the window's coordinates. */
const lensNow = (page: Page): Promise<{ centre: number; width: number; dragging: boolean; lift: number } | null> =>
  page.evaluate(() => {
    const host = document.querySelector('vire-nav') as HTMLElement;
    const lens = host.querySelector(':scope > [data-vk-lens]') as HTMLElement;
    if (!host.hasAttribute('data-lens')) return null;
    const num = (name: string) => parseFloat(lens.style.getPropertyValue(name));
    return { centre: num('--vk-x') + num('--vk-w') / 2, width: num('--vk-w'), dragging: lens.hasAttribute('data-dragging'), lift: num('--vk-lift') };
  });

/** The lens follows the finger: its centre within 2 px of the pointer, clamped to the bar. */
function followsFinger(drags: Drag[], bar: { left: number; right: number }, half: number): string[] {
  const out: string[] = [];
  for (const d of drags) {
    const wanted = Math.min(Math.max(d.pointer - d.frameLeft, bar.left + half - 4), bar.right - half + 4);
    if (Math.abs(d.centre - wanted) > 2) out.push(`the lens is ${(d.centre - wanted).toFixed(1)} px from the finger at ${d.pointer}`);
  }
  return out;
}

test.describe('dragging on the bar', () => {
  test('the lens follows the finger continuously, stretched along the motion, clamped to the bar', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const frame = (await page.locator('#frame').boundingBox())!;
    const bar = (await page.locator('vire-nav > nav').boundingBox())!;
    const home = await linkBox(page, 'Home');
    const messages = await linkBox(page, 'Messages');
    await page.mouse.move(home.cx + 4, home.cy);
    await page.mouse.down();
    const drags: Drag[] = [];
    let widest = 0;
    const read = async (pointer: number) => {
      const lens = await lensNow(page);
      expect(lens).not.toBeNull();
      expect(lens!.dragging).toBe(true);
      widest = Math.max(widest, lens!.width);
      drags.push({ pointer, centre: lens!.centre, width: lens!.width, dragging: lens!.dragging, frameLeft: frame.x });
    };
    await read(home.cx + 4);
    for (let x = home.cx + 14; x <= messages.cx; x += 14) {
      await page.mouse.move(x, home.cy);
      await read(x);
    }
    await page.mouse.move(bar.x + bar.width + 40, home.cy);
    await read(bar.x + bar.width + 40);
    const bounds = { left: bar.x - frame.x, right: bar.x + bar.width - frame.x };
    expect(followsFinger(drags, bounds, 43)).toEqual([]);
    expect(widest).toBeGreaterThan(86.5);
    expect(drags.at(-1)!.centre).toBeLessThanOrEqual(bounds.right - 43 + 4 + 2);
    await page.mouse.up();
    await settle(page);
    expect(await lensNow(page)).toBeNull();
  });

  test('a lens that jumps from item to item fails it', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const frame = (await page.locator('#frame').boundingBox())!;
    const bar = (await page.locator('vire-nav > nav').boundingBox())!;
    const home = await linkBox(page, 'Home');
    const messages = await linkBox(page, 'Messages');
    await page.mouse.move(home.cx + 4, home.cy);
    await page.mouse.down();
    const drags: Drag[] = [];
    for (let x = home.cx + 14; x <= messages.cx; x += 14) {
      await page.mouse.move(x, home.cy);
      const lens = (await lensNow(page))!;
      drags.push({ pointer: x, centre: lens.centre, width: lens.width, dragging: true, frameLeft: frame.x });
    }
    await page.mouse.up();
    const bounds = { left: bar.x - frame.x, right: bar.x + bar.width - frame.x };
    expect(followsFinger(drags, bounds, 43)).toEqual([]);
    // The same drag with the lens snapping to the centre of the item under it
    const items = await page.locator('vire-nav nav > ul:not([data-secondary]) a').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map((r) => r.x + r.width / 2),
    );
    const snapped = drags.map((d) => ({
      ...d,
      centre: items.reduce((best, c) => (Math.abs(c - d.pointer) < Math.abs(best - d.pointer) ? c : best), items[0]!) - frame.x,
    }));
    expect(followsFinger(snapped, bounds, 43).length).toBeGreaterThan(0);
  });

  test('release activates the nearest link exactly once, and the lens lands in the pill', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const home = await linkBox(page, 'Home');
    const messages = await linkBox(page, 'Messages');
    await page.evaluate(() => {
      const w = window as unknown as { __clicks: { target: string; prevented: boolean }[] };
      w.__clicks = [];
      document.addEventListener('click', (e) => w.__clicks.push({ target: (e.target as Element).localName, prevented: e.defaultPrevented }));
    });
    await page.mouse.move(home.cx, home.cy);
    await page.mouse.down();
    await page.mouse.move(messages.cx - 6, messages.cy, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    expect(await clicks(page)).toEqual(['click:Messages']);
    const seen = await page.evaluate(() => (window as unknown as { __clicks: unknown[] }).__clicks);
    expect(seen).toHaveLength(1);
    expect(await lensNow(page)).toBeNull();
    await expect(page.locator('vire-nav [aria-current]')).toHaveText(/Messages/);
    const landed = await linkBox(page, 'Messages');
    await expect.poll(async () => (await page.locator('[data-vk-pill]').boundingBox())!.x).toBeCloseTo(landed.x, 1);
    expect((await page.locator('[data-vk-pill]').boundingBox())!.width).toBe(landed.width);
  });

  test('a cancelled press settles the lens back where it was, and activates nothing', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const home = await linkBox(page, 'Home');
    const friends = await linkBox(page, 'Friends');
    await page.evaluate(() => window.addEventListener('pointerdown', (e) => ((window as unknown as { __pid: number }).__pid = e.pointerId), true));
    await page.mouse.move(home.cx, home.cy);
    await page.mouse.down();
    await page.mouse.move(friends.cx, friends.cy, { steps: 6 });
    expect((await lensNow(page))!.dragging).toBe(true);
    await page.evaluate(() => {
      const id = (window as unknown as { __pid: number }).__pid;
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, bubbles: true }));
    });
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-lens'));
    await page.mouse.up();
    await settle(page);
    expect(await clicks(page)).toEqual([]);
    await expect(page.locator('vire-nav [aria-current]')).toHaveText('Home');
  });

  test('a press that ends while the form is changing ends the drag: no lens is left, and the next press works', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const home = await linkBox(page, 'Home');
    await page.mouse.move(home.cx, home.cy);
    await page.mouse.down();
    await page.mouse.move(home.cx + 30, home.cy, { steps: 3 });
    await resize(page, 700, 720);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-moving'));
    await page.waitForTimeout(150);
    expect(await attr(page, 'data-form')).toBe('bar');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'rail');
    await settle(page);
    expect(await lensNow(page)).toBeNull();
    await resize(page, 430, 720);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'bar');
    await settle(page);
    await page.waitForTimeout(200);
    expect(await lensNow(page)).toBeNull();
    expect(await attr(page, 'data-moving')).toBeNull();

    const before = (await clicks(page)).length;
    const start = await linkBox(page, 'Home');
    const messages = await linkBox(page, 'Messages');
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(messages.cx - 6, messages.cy, { steps: 8 });
    expect((await lensNow(page))!.dragging).toBe(true);
    await page.mouse.up();
    await settle(page);
    expect((await clicks(page)).slice(before)).toEqual(['click:Messages']);
    expect(await lensNow(page)).toBeNull();
  });

  test('a tap is a link click: a press that does not move 6 px clicks the link once, with nothing prevented', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await page.evaluate(() => {
      const w = window as unknown as { __clicks: { prevented: boolean }[] };
      w.__clicks = [];
      window.addEventListener('click', (e) => w.__clicks.push({ prevented: e.defaultPrevented }), true);
    });
    const friends = await linkBox(page, 'Friends');
    await page.mouse.move(friends.cx, friends.cy);
    await page.mouse.down();
    await page.mouse.move(friends.cx + 4, friends.cy);
    await page.mouse.up();
    await settle(page);
    expect(await page.evaluate(() => (window as unknown as { __clicks: unknown[] }).__clicks)).toEqual([{ prevented: false }]);
    expect(await clicks(page)).toEqual(['click:Friends']);
  });

  test('the pill follows aria-current, sliding without a lift', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const frames = await page.evaluate(
      () =>
        new Promise<{ x: number; lens: boolean; opacity: string }[]>((resolve) => {
          const host = document.querySelector('vire-nav') as HTMLElement;
          const pill = host.querySelector('[data-vk-pill]') as HTMLElement;
          const out: { x: number; lens: boolean; opacity: string }[] = [];
          host.querySelector('[aria-current]')!.removeAttribute('aria-current');
          [...host.querySelectorAll('nav a')].find((a) => a.textContent!.startsWith('Messages'))!.setAttribute('aria-current', 'page');
          let calm = 0;
          let last = -1;
          const tick = () => {
            const x = pill.getBoundingClientRect().x;
            out.push({ x, lens: host.hasAttribute('data-lens'), opacity: pill.style.getPropertyValue('--vk-pill-op') });
            calm = Math.abs(x - last) < 0.01 ? calm + 1 : 0;
            last = x;
            if (calm > 8 || out.length > 200) resolve(out);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    const target = (await linkBox(page, 'Messages')).x;
    expect(frames.at(-1)!.x).toBeCloseTo(target, 1);
    expect(frames.length).toBeGreaterThan(8);
    const xs = frames.map((f) => f.x);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 0.01);
    expect(xs.some((x) => x > xs[0]! + 20 && x < target - 20)).toBe(true);
    expect(frames.some((f) => f.lens)).toBe(false);
    expect(new Set(frames.map((f) => f.opacity))).toEqual(new Set(['1.000']));
  });

  test('only the bar is dragged: on a rail a press is just a press', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 700, 720);
    const home = await linkBox(page, 'Home');
    await page.mouse.move(home.cx, home.cy);
    await page.mouse.down();
    await page.mouse.move(home.cx + 30, home.cy + 30, { steps: 4 });
    expect(await lensNow(page)).toBeNull();
    await page.mouse.up();
  });

  test('lenses are counted while the selection is dragged: one lens, gone at rest', async ({ page }) => {
    await stubGlass(page);
    await openNav(page, '', 430, 720);
    await page.waitForFunction(() => (window as unknown as { __lenses?: Rec[] }).__lenses?.filter((l) => l.alive).length === 2);
    const home = await linkBox(page, 'Home');
    await page.mouse.move(home.cx, home.cy);
    await page.mouse.down();
    await page.mouse.move(home.cx + 60, home.cy, { steps: 5 });
    await expect.poll(async () => (await lenses(page)).filter((l) => l.alive && l.kind === 'lens').length).toBe(1);
    await page.mouse.up();
    await settle(page);
    await expect.poll(async () => (await lenses(page)).filter((l) => l.alive && l.kind === 'lens').length).toBe(0);
    expect((await lenses(page)).filter((l) => l.alive).map((l) => l.kind).sort()).toEqual(['accessory', 'body']);
  });
});

// ---- minimising and the accessory ---------------------------------------------------------------------------------

const scrollTo = async (page: Page, top: number) => {
  await page.evaluate((y) => (document.getElementById('scroller')!.scrollTop = y), top);
  await nextFrame(page);
};
const rect = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test.describe('minimising', () => {
  test('scrolling minimises and expands the bar: a circle with the selected icon and the search circle, 44 dp each', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await expect(page.locator('vire-nav')).not.toHaveAttribute('data-minimized', '');
    await scrollTo(page, 100);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    const frame = await rect(page, '#frame');
    const body = await rect(page, 'vire-nav > nav');
    const search = await rect(page, 'vire-nav a[data-search]');
    expect([body.width, body.height, search.width, search.height]).toEqual([44, 44, 44, 44]);
    expect(body.x - frame.x).toBe(16);
    expect(frame.x + frame.width - (search.x + search.width)).toBe(16);
    await expect(page.locator('vire-nav nav > ul:not([data-secondary]) a:visible')).toHaveCount(1);
    await expect(page.locator('vire-nav nav > ul:not([data-secondary]) a:visible')).toHaveText('Home');
    // a few dp one way does not toggle it
    await scrollTo(page, 90);
    expect(await attr(page, 'data-minimized')).toBe('');
    await scrollTo(page, 60);
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    expect((await rect(page, 'vire-nav > nav')).width).toBe(4 * 74 + 6);
    await scrollTo(page, 300);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    await scrollTo(page, 0);
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
  });

  test('a tap on the minimised bar expands it and does not navigate, and so does focus entering it', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await scrollTo(page, 100);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    await page.evaluate(() => {
      const home = [...document.querySelectorAll('vire-nav nav a')].find((a) => a.textContent === 'Home')!;
      const w = window as unknown as { __prevented: boolean[] };
      w.__prevented = [];
      home.addEventListener('click', (e) => w.__prevented.push(e.defaultPrevented));
    });
    const home = await linkBox(page, 'Home');
    await page.mouse.click(home.cx, home.cy);
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    expect(await page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented)).toEqual([true]);
    expect(await clicks(page)).toEqual([]);
    await settle(page);

    await scrollTo(page, 300);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.getByRole('link', { name: 'Home' }).focus();
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
  });

  test('only the bar minimises', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 700, 720);
    await scrollTo(page, 100);
    await scrollTo(page, 300);
    await page.waitForTimeout(100);
    expect(await attr(page, 'data-minimized')).toBeNull();
    expect(await attr(page, 'data-form')).toBe('rail');
  });

  test('without minimize="scroll" the bar stays whole', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0&nav-minimize=off', 430, 720);
    await scrollTo(page, 300);
    await page.waitForTimeout(100);
    expect(await attr(page, 'data-minimized')).toBeNull();
  });

  test('the scroller can be given as a property', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0&nav-scroller=nothing', 430, 720);
    await scrollTo(page, 300);
    await page.waitForTimeout(100);
    expect(await attr(page, 'data-minimized')).toBeNull();
    await page.evaluate(() => {
      (document.querySelector('vire-nav') as unknown as { scroller: Element }).scroller = document.getElementById('scroller')!;
    });
    await scrollTo(page, 0);
    await scrollTo(page, 100);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
  });
});

test.describe('the scroller', () => {
  const minimise = async (page: Page, top = 100) => {
    await scrollTo(page, top);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
  };
  const expanded = async (page: Page) => {
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
  };

  test('giving a new scroller expands a minimised bar, and the new one minimises it', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await minimise(page);
    await page.evaluate(() => {
      const other = document.createElement('div');
      other.id = 'other';
      other.style.cssText = 'position:absolute;width:100px;height:100px;overflow:auto;left:0;top:0';
      other.innerHTML = '<div style="height:900px"></div>';
      document.getElementById('frame')!.append(other);
      (document.querySelector('vire-nav') as unknown as { scroller: Element }).scroller = other;
    });
    await expanded(page);
    await page.evaluate(() => (document.getElementById('other')!.scrollTop = 120));
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
  });

  test('a scroller id that no longer resolves lets go of the node, and the bar expands', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await minimise(page);
    await page.evaluate(() => document.getElementById('scroller')!.remove());
    await resize(page, 431, 720);
    await expanded(page);
    await page.evaluate(() => {
      const next = document.createElement('div');
      next.id = 'scroller';
      next.style.cssText = 'position:absolute;width:100px;height:100px;overflow:auto;left:0;top:0';
      next.innerHTML = '<div style="height:900px"></div>';
      document.getElementById('frame')!.append(next);
      document.querySelector('vire-nav nav ul')!.append(document.createElement('li'));
    });
    await nextFrame(page);
    await scrollTo(page, 120);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
  });

  test('a node the id has moved away from is let go: the id names the new one', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await minimise(page);
    await page.evaluate(() => {
      const old = document.getElementById('scroller')!;
      old.id = 'retired';
      const next = old.cloneNode(true) as HTMLElement;
      next.id = 'scroller';
      next.dataset.new = '';
      document.getElementById('frame')!.append(next);
    });
    await resize(page, 431, 720);
    await expanded(page);
    await page.evaluate(() => (document.getElementById('retired')!.scrollTop = 300));
    await page.waitForTimeout(100);
    expect(await attr(page, 'data-minimized')).toBeNull();
    await page.evaluate(() => (document.querySelector('[data-new]')!.scrollTop = 300));
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
  });

  test('the document itself can be the scroller: the window scrolls it, and the bar minimises and expands', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await page.evaluate(() => window.__lab.nav!.scrollOnDocument());
    await nextFrame(page);
    await page.evaluate(() => window.scrollTo(0, 120));
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 60));
    await expanded(page);
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await page.evaluate(() => window.scrollTo(0, 0));
    await expanded(page);
    // the old scroller no longer counts
    await scrollTo(page, 400);
    await page.waitForTimeout(100);
    expect(await attr(page, 'data-minimized')).toBeNull();
  });

  test('a bounce past the end is the end: it does not expand the bar', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const max = await page.evaluate(() => {
      const el = document.getElementById('scroller')!;
      return el.scrollHeight - el.clientHeight;
    });
    await minimise(page, max);
    await page.evaluate((end) => {
      const el = document.getElementById('scroller')!;
      let fake = end;
      Object.defineProperty(el, 'scrollTop', { get: () => fake, configurable: true });
      for (const top of [end + 30, end + 60, end + 20, end]) {
        fake = top;
        el.dispatchEvent(new Event('scroll'));
      }
    }, max);
    await page.waitForTimeout(1000);
    expect(await attr(page, 'data-minimized')).toBe('');
  });
});

test.describe('the bottom accessory', () => {
  test('sits over the bar and its search, 48 dp high and 8 above; in the minimised bar between the circles; beside a rail or sidebar along the bottom of the content', async ({ page }) => {
    await openNav(page, 'glass=0', 430, 720);
    const acc = () => rect(page, 'vire-nav > [data-accessory]');
    let body = await rect(page, 'vire-nav > nav');
    let search = await rect(page, 'vire-nav a[data-search]');
    let a = await acc();
    expect(a.height).toBe(48);
    expect(body.y - (a.y + a.height)).toBe(8);
    expect(a.x).toBeCloseTo(body.x, 1);
    expect(a.width).toBeCloseTo(body.width + 8 + search.width, 1);
    expect(await page.locator('[data-accessory]').getAttribute('data-placement')).toBe('above-bar');

    await scrollTo(page, 100);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    body = await rect(page, 'vire-nav > nav');
    search = await rect(page, 'vire-nav a[data-search]');
    a = await acc();
    expect(a.height).toBe(44);
    expect(a.x - (body.x + body.width)).toBeCloseTo(8, 1);
    expect(search.x - (a.x + a.width)).toBeCloseTo(8, 1);
    expect(await page.locator('[data-accessory]').getAttribute('data-placement')).toBe('in-bar');

    await reform(page, 700, 720, 'rail');
    const frame = await rect(page, '#frame');
    body = await rect(page, 'vire-nav > nav');
    a = await acc();
    expect(a.height).toBe(56);
    expect(a.x - (body.x + body.width)).toBeCloseTo(8, 1);
    expect(frame.y + frame.height - (a.y + a.height)).toBeCloseTo(8, 1);
    expect(await page.locator('[data-accessory]').getAttribute('data-placement')).toBe('content-bottom');
    await reform(page, 1280, 800, 'sidebar');
    expect(await page.locator('[data-accessory]').getAttribute('data-placement')).toBe('content-bottom');
  });

  test('reshapes between placements on springs, and says where it is in data-placement', async ({ page }) => {
    await openNav(page, 'glass=0', 430, 720);
    const samples = await sampleFrames(page, [{ at: 60, scroll: 100 }]);
    const boxes = samples.map((s) => s.acc!);
    expect(new Set(boxes.map((b) => b.placement))).toEqual(new Set(['above-bar', 'in-bar']));
    expect(boxes.filter((b, i) => i > 0 && b.placement !== boxes[i - 1]!.placement)).toHaveLength(1);
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const values = boxes.map((b) => b[key]);
      const total = Math.max(...values) - Math.min(...values);
      for (let i = 1; i < boxes.length; i += 1) expect(Math.abs(boxes[i]![key] - boxes[i - 1]![key])).toBeLessThan(0.4 * total + 0.01);
    }
    expect(new Set(boxes.map((b) => b.h)).size).toBeGreaterThan(3);
  });
});

// ---- the toggle ----------------------------------------------------------------------------------------------------

test.describe('the toggle', () => {
  test('collapses the sidebar into a rail and back: aria-expanded, collapsed, the event; the element stores nothing', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1280, 800);
    const toggle = page.locator('vire-nav button[data-vk-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('Sidebar');
    expect(await toggle.getAttribute('type')).toBe('button');
    await toggle.click();
    await expect(page.locator('vire-nav')).toHaveAttribute('collapsed', '');
    await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'rail');
    await settle(page);
    expect(await clicks(page)).toEqual([]);
    expect((await log(page)).filter((line) => line.startsWith('collapse:'))).toEqual(['collapse:true']);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName('Sidebar');
    await toggle.click();
    await expect(page.locator('vire-nav')).not.toHaveAttribute('collapsed', '');
    await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'sidebar');
    await settle(page);
    expect((await log(page)).filter((line) => line.startsWith('collapse:'))).toEqual(['collapse:true', 'collapse:false']);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
  });

  test('keeps focus on itself through the change, and its name is the toggle-label attribute, constant while aria-expanded carries the state', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0&nav-toggle-label=Menu', 1280, 800);
    const toggle = page.locator('vire-nav button[data-vk-toggle]');
    await expect(toggle).toHaveAccessibleName('Menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'rail');
    await settle(page);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAccessibleName('Menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => document.querySelector('vire-nav')!.setAttribute('toggle-label', 'Navigation'));
    await expect(toggle).toHaveAccessibleName('Navigation');
    await page.evaluate(() => document.querySelector('vire-nav')!.removeAttribute('toggle-label'));
    await expect(toggle).toHaveAccessibleName('Sidebar');
  });

  test('the bar has none', async ({ page }) => {
    await openNav(page, 'glass=0', 430, 720);
    await expect(page.locator('vire-nav button[data-vk-toggle]')).toBeHidden();
  });

  test('the rail opens over the content on an expanded window, and Escape, a press on the scrim or a link chosen close it', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1000, 720);
    const frame = await rect(page, '#frame');
    const toggle = page.locator('vire-nav button[data-vk-toggle]');
    const startInset = () => page.locator('#frame').evaluate((el) => el.style.getPropertyValue('--vire-nav-inset-start'));
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await startInset()).toBe('96px');
    const open = async () => {
      await toggle.click();
      await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'sidebar');
      await settle(page);
      await expect(page.locator('vire-nav > [data-vk-scrim]')).toHaveCount(1);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect((await rect(page, 'vire-nav > nav')).width).toBe(280);
      expect(await startInset()).toBe('96px');
      await expect(page.locator('vire-nav')).not.toHaveAttribute('collapsed', '');
    };
    const closed = async () => {
      await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'rail');
      await settle(page);
      await expect(page.locator('vire-nav > [data-vk-scrim]')).toHaveCount(0);
      expect((await rect(page, 'vire-nav > nav')).width).toBe(80);
    };
    await open();
    await page.keyboard.press('Escape');
    await closed();
    await open();
    await page.mouse.click(frame.x + 700, frame.y + 400);
    await closed();
    await open();
    await page.getByRole('link', { name: 'Library' }).click();
    await closed();
    expect(await clicks(page)).toEqual(['click:Library']);
    await expect(page.locator('vire-nav')).not.toHaveAttribute('collapsed', '');
    expect((await log(page)).filter((line) => line.startsWith('collapse:'))).toEqual([]);
  });
});

// ---- focus through a change ----------------------------------------------------------------------------------------

const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return !el || el === document.body ? 'body' : el.matches('a') ? (el.textContent ?? '').trim().replace(/[0-9]+(, [0-9]+ new)?$/, '') : el.localName;
  });

test.describe('a link the form hides', () => {
  test('hands focus to the selected link when the bar minimises', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await page.getByRole('link', { name: 'Friends' }).focus();
    await scrollTo(page, 100);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    expect(await focusedName(page)).toBe('Home');
    expect(await attr(page, 'data-minimized')).toBe('');
  });

  test('hands focus to the toggle on a rail, or to the first link where there is none, when the selected link is hidden too', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1280, 800);
    await page.evaluate(() => {
      for (const a of document.querySelectorAll('vire-nav [aria-current]')) a.removeAttribute('aria-current');
      [...document.querySelectorAll('vire-nav nav a')].find((a) => a.textContent === 'Feed')!.setAttribute('aria-current', 'page');
    });
    await settle(page);
    await page.getByRole('link', { name: 'Feed' }).focus();
    await reform(page, 900, 720, 'rail');
    expect(await focusedName(page)).toBe('button');
    await expect(page.locator('vire-nav button[data-vk-toggle]')).toBeFocused();
    await page.getByRole('link', { name: 'Library' }).focus();
    await reform(page, 1280, 800, 'sidebar');
    await page.getByRole('link', { name: 'Dashboard' }).focus();
    await reform(page, 430, 720, 'bar');
    expect(await focusedName(page)).toBe('Home');
  });

  test('keeps focus on the same link while that link stays shown', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1280, 800);
    await page.getByRole('link', { name: 'Library' }).focus();
    await reform(page, 430, 720, 'bar');
    expect(await focusedName(page)).toBe('Library');
  });

  for (const how of ['Escape', 'the scrim'] as const) {
    test(`closing the sidebar over the content by ${how} returns focus to the toggle that opened it`, async ({ page }) => {
      await openNav(page, 'glass=0&accessory=0', 1000, 720);
      const frame = await rect(page, '#frame');
      const toggle = page.locator('vire-nav button[data-vk-toggle]');
      await toggle.click();
      await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'sidebar');
      await settle(page);
      await page.getByRole('link', { name: 'Feed' }).focus();
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await page.mouse.click(frame.x + 700, frame.y + 400);
      await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'rail');
      await settle(page);
      await expect(toggle).toBeFocused();
    });
  }

  test('closing it leaves focus alone when it was outside the navigation', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1000, 720);
    await page.locator('vire-nav button[data-vk-toggle]').click();
    await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'sidebar');
    await settle(page);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('vire-nav')!.getAttribute('data-form') === 'rail');
    await settle(page);
    expect(await focusedName(page)).toBe('body');
  });
});

// ---- the search shortcut -------------------------------------------------------------------------------------------

test.describe('the search shortcut', () => {
  test('on a large window the key outside a field clicks the search link, which announces it; in a field it types', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1280, 800);
    const search = page.locator('vire-nav a[data-search]');
    await expect(search).toHaveAttribute('aria-keyshortcuts', '/');
    await page.keyboard.press('/');
    expect(await clicks(page)).toEqual(['click:Search']);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'field';
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.press('/');
    expect(await page.locator('#field').inputValue()).toBe('/');
    expect(await clicks(page)).toEqual(['click:Search']);
  });

  test('where the model gives none, there is no shortcut and no announcement; a keyboard in use gives one', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await page.evaluate(() => window.__lab.setInputOverride({ keyboard: false }));
    await nextFrame(page);
    const search = page.locator('vire-nav a[data-search]');
    await expect(search).not.toHaveAttribute('aria-keyshortcuts', /.*/);
    await page.keyboard.press('/');
    expect(await clicks(page)).toEqual([]);
    await page.evaluate(() => window.__lab.setInputOverride({ keyboard: true }));
    await expect(search).toHaveAttribute('aria-keyshortcuts', '/');
    await page.keyboard.press('/');
    expect(await clicks(page)).toEqual(['click:Search']);
    await page.keyboard.press('s');
    expect(await clicks(page)).toEqual(['click:Search']);
  });

  test('search-key names another key, and the announcement follows', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0&nav-search-key=s', 1280, 800);
    await expect(page.locator('vire-nav a[data-search]')).toHaveAttribute('aria-keyshortcuts', 's');
    await page.keyboard.press('/');
    expect(await clicks(page)).toEqual([]);
    await page.keyboard.press('s');
    expect(await clicks(page)).toEqual(['click:Search']);
    await page.keyboard.press('Control+s');
    expect(await clicks(page)).toEqual(['click:Search']);
  });

  test('removing the element takes the announcement away', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1280, 800);
    await page.evaluate(() => {
      (window as unknown as { __link: Element }).__link = document.querySelector('vire-nav a[data-search]')!;
      document.querySelector('vire-nav')!.remove();
    });
    expect(await page.evaluate(() => (window as unknown as { __link: Element }).__link.hasAttribute('aria-keyshortcuts'))).toBe(false);
  });
});

// ---- hit areas -----------------------------------------------------------------------------------------------------

test.describe('hit areas', () => {
  const slop = (page: Page, name: string) =>
    page.evaluate((text) => {
      const link = [...document.querySelectorAll('vire-nav nav a')].find((a) => a.textContent!.startsWith(text))!;
      const before = getComputedStyle(link, '::before');
      const r = link.getBoundingClientRect();
      return { x: Math.abs(parseFloat(before.left)), y: Math.abs(parseFloat(before.top)), w: r.width, h: r.height };
    }, name);

  test('a laptop with a touch screen: every link reaches 44 dp, and the sidebar\'s rows stay 36', async ({ page }) => {
    await emulateInput(page, { pointer: 'fine', anyCoarse: true, anyHover: true });
    await openNav(page, 'glass=0&accessory=0', 1280, 800);
    const row = await slop(page, 'Library');
    expect(row.h).toBe(36);
    expect(row.h + 2 * row.y).toBe(44);
    await page.evaluate(() => (window as unknown as { __input: { set(n: object): void } }).__input.set({ anyCoarse: false }));
    await nextFrame(page);
    const pointer = await slop(page, 'Library');
    expect(pointer.h).toBe(36);
    expect(pointer.y).toBe(0);
    await page.evaluate(() => (window as unknown as { __input: { set(n: object): void } }).__input.set({ pointer: 'coarse', anyCoarse: true, anyHover: false }));
    await page.waitForFunction(() => [...document.querySelectorAll('vire-nav nav a')].some((a) => a.getBoundingClientRect().height === 44));
    const touch = await slop(page, 'Library');
    expect(touch.h).toBe(44);
    expect(touch.y).toBe(0);
  });

  test('on the bar every destination, the search and the minimised circles meet 44 dp', async ({ page }) => {
    await emulateInput(page, { pointer: 'coarse', anyCoarse: true, anyHover: false });
    await openNav(page, 'glass=0&accessory=0', 360, 720);
    for (const name of ['Home', 'Library', 'Friends', 'Messages', 'Search']) {
      const hit = await slop(page, name);
      expect(Math.min(hit.w + 2 * hit.x, hit.h + 2 * hit.y), name).toBeGreaterThanOrEqual(44);
    }
    await scrollTo(page, 100);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    for (const name of ['Home', 'Search']) {
      const hit = await slop(page, name);
      expect(Math.min(hit.w + 2 * hit.x, hit.h + 2 * hit.y), name).toBeGreaterThanOrEqual(44);
    }
  });
});

// ---- modes ---------------------------------------------------------------------------------------------------------

const alphaOf = (color: string) => {
  const slash = /\/\s*([\d.]+%?)\s*\)/.exec(color) ?? /rgba\([^)]*,\s*([\d.]+)\)/.exec(color);
  if (!slash) return 1;
  return slash[1]!.endsWith('%') ? parseFloat(slash[1]!) / 100 : parseFloat(slash[1]!);
};

test.describe('modes', () => {
  const read = (page: Page) =>
    page.evaluate(() => {
      const host = document.querySelector('vire-nav') as HTMLElement;
      const nav = host.querySelector(':scope > nav') as HTMLElement;
      const pill = host.querySelector('[data-vk-pill]') as HTMLElement;
      const r = nav.getBoundingClientRect();
      return {
        surface: host.dataset.surface,
        glass: host.dataset.glass,
        frost: host.hasAttribute('data-frost'),
        contrast: host.hasAttribute('data-contrast'),
        body: getComputedStyle(nav).backgroundColor,
        shadow: getComputedStyle(nav).boxShadow,
        pill: getComputedStyle(pill).backgroundColor,
        box: [r.x, r.y, r.width, r.height],
        links: [...nav.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().width > 0).length,
      };
    });

  test('glass off, reduced transparency and increased contrast keep every form readable, with the same geometry and a filled pill', async ({ page }) => {
    const modes: Record<string, string> = { off: 'glass=0', glass: 'glass=1', frost: 'glass=1&rt=1', contrast: 'glass=1&ic=1' };
    const seen: Record<string, Awaited<ReturnType<typeof read>>> = {};
    for (const [name, query] of Object.entries(modes)) {
      await openNav(page, `${query}&accessory=0`, 430, 720);
      seen[name] = await read(page);
    }
    expect(seen.off).toMatchObject({ surface: 'plain', glass: 'off', frost: false, contrast: false });
    expect(seen.glass).toMatchObject({ surface: 'glass', glass: 'on', frost: false, contrast: false });
    expect(seen.frost).toMatchObject({ surface: 'glass', glass: 'on', frost: true });
    expect(seen.contrast).toMatchObject({ surface: 'glass', contrast: true });
    expect(alphaOf(seen.off!.body)).toBe(1);
    expect(alphaOf(seen.frost!.body)).toBeGreaterThan(alphaOf(seen.glass!.body));
    expect(alphaOf(seen.contrast!.body)).toBeGreaterThan(0.8);
    for (const mode of Object.values(seen)) {
      expect(mode.box).toEqual(seen.glass!.box);
      expect(mode.links).toBe(5);
      expect(alphaOf(mode.pill)).toBeGreaterThan(0.05);
    }
    await openNav(page, 'glass=0&ic=1&accessory=0', 430, 720);
    expect((await read(page)).shadow).toContain('inset');
    // and it still works
    const friends = await linkBox(page, 'Friends');
    await page.mouse.click(friends.cx, friends.cy);
    expect(await clicks(page)).toEqual(['click:Friends']);
  });

  test('the glass attribute asks for glass when empty or "present", and for nothing otherwise', async ({ page }) => {
    await openNav(page, 'glass=0', 430, 720);
    const set = async (value: string | null) => {
      await page.evaluate((v) => {
        const host = document.querySelector('vire-nav')!;
        if (v === null) host.removeAttribute('glass');
        else host.setAttribute('glass', v);
      }, value);
      await nextFrame(page);
      return page.locator('vire-nav').getAttribute('data-glass');
    };
    expect(await set('')).toBe('on');
    expect(await set('touch')).toBe('off');
    expect(await set('present')).toBe('on');
    expect(await set(null)).toBe('off');
  });
});

// ---- forced states -------------------------------------------------------------------------------------------------

test.describe('forced states', () => {
  const open = async (page: Page, query: string) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await openCase(page, `atom=nav&glass=0&${query}`);
    await nextFrame(page);
  };

  test('minimized holds the bar as its circle', async ({ page }) => {
    await open(page, 'form=minimized');
    await expect(page.locator('vire-nav')).toHaveAttribute('data-minimized', '');
    expect((await rect(page, 'vire-nav > nav')).width).toBe(44);
    await page.evaluate(() => document.querySelector('vire-nav')!.removeAttribute('data-vire-force-state'));
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
  });

  test('morph:<form>:<t> freezes a lens morph from that form to the current one, and removing it goes back to the live state', async ({ page }) => {
    await open(page, 'form=rail&state=morph:bar:0.46');
    await nextFrame(page);
    const frozen = await page.evaluate(() => {
      const host = document.querySelector('vire-nav') as HTMLElement;
      const lens = host.querySelector(':scope > [data-vk-lens]') as HTMLElement;
      const nav = host.querySelector(':scope > nav') as HTMLElement;
      const num = (el: HTMLElement, n: string) => parseFloat(el.style.getPropertyValue(n));
      return {
        lens: host.hasAttribute('data-lens'),
        form: host.dataset.form,
        body: num(nav, '--vk-w') * num(nav, '--vk-h'),
        lensArea: num(lens, '--vk-w') * num(lens, '--vk-h'),
        text: lens.textContent!.trim(),
      };
    });
    expect(frozen.lens).toBe(true);
    expect(frozen.text).toBe('Library');
    expect(frozen.body / frozen.lensArea).toBeLessThanOrEqual(1.1);
    await page.waitForTimeout(300);
    const again = await page.evaluate(() => (document.querySelector('vire-nav > nav') as HTMLElement).style.getPropertyValue('--vk-w'));
    expect(parseFloat(again) * 1).toBeLessThan(120);
    await page.evaluate(() => document.querySelector('vire-nav')!.removeAttribute('data-vire-force-state'));
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-lens'));
    expect((await rect(page, 'vire-nav > nav')).width).toBe(80);
  });

  test('drag:<0..1> holds the lens at that fraction of the bar', async ({ page }) => {
    await open(page, 'form=bar&state=drag:0.5');
    const bar = await rect(page, 'vire-nav > nav');
    const frame = await rect(page, '.nav-frame');
    const lens = (await lensNow(page))!;
    expect(lens.dragging).toBe(true);
    expect(lens.centre).toBeCloseTo(bar.x - frame.x + bar.width / 2, 0);
  });
});

// ---- later changes to the markup and the attributes ------------------------------------------------------------------

const formIs = (page: Page, form: string) => page.waitForFunction((wanted) => document.querySelector('vire-nav')!.getAttribute('data-form') === wanted, form);

test.describe('the selection under the finger, details', () => {
  test('a press on the inset of the bar that ends without a drag settles the lens back on the selected item, not the neighbour', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const nav = (await page.locator('vire-nav > nav').boundingBox())!;
    const home = await linkBox(page, 'Home');
    await page.mouse.move(nav.x + nav.width - 1.5, nav.y + nav.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-lens'));
    await page.evaluate(() => {
      const host = document.querySelector('vire-nav') as HTMLElement;
      const lens = host.querySelector(':scope > [data-vk-lens]') as HTMLElement;
      const out: number[] = ((window as unknown as { __c: number[] }).__c = []);
      const tick = () => {
        if (host.hasAttribute('data-lens')) out.push(parseFloat(lens.style.getPropertyValue('--vk-x')) + parseFloat(lens.style.getPropertyValue('--vk-w')) / 2);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.up();
    await settle(page);
    const centres = await page.evaluate(() => (window as unknown as { __c: number[] }).__c);
    const frame = await rect(page, '#frame');
    expect(centres.length).toBeGreaterThan(5);
    expect(centres[0]! - centres.at(-1)!).toBeGreaterThan(100);
    for (let i = 1; i < centres.length; i += 1) expect(centres[i]!).toBeLessThanOrEqual(centres[i - 1]! + 0.5);
    expect(centres.at(-1)!).toBeLessThan(home.cx - frame.x + 60);
    expect(await clicks(page)).toEqual([]);
    await expect(page.locator('vire-nav [aria-current]')).toHaveText('Home');
  });

  test('the copy in the lens follows the content of its link, and the nodes the element made changing replan nothing', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const home = await linkBox(page, 'Home');
    await page.mouse.move(home.cx, home.cy);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-lens'));
    await page.evaluate(() => {
      const host = document.querySelector('vire-nav') as HTMLElement;
      const w = window as unknown as { __probes: number };
      w.__probes = 0;
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) if ((n as Element).hasAttribute?.('data-vk-probe')) w.__probes += 1;
      }).observe(host, { childList: true });
    });
    const probes = () => page.evaluate(() => (window as unknown as { __probes: number }).__probes);
    await page.evaluate(() => {
      const inner = document.querySelector('vire-nav > [data-vk-lens] > div')!;
      inner.append(document.createElement('i'));
      document.querySelector('vire-nav > nav [data-vk-pill]')!.setAttribute('data-x', '1');
    });
    await page.waitForTimeout(150);
    expect(await probes()).toBe(0);
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('vire-nav nav a')].find((a) => a.textContent === 'Home')!;
      link.insertAdjacentHTML('beforeend', '<span data-badge>9</span>');
    });
    await page.waitForTimeout(150);
    expect(await probes()).toBeGreaterThan(0);
    expect((await page.locator('vire-nav > [data-vk-lens]').textContent())!).toContain('9');
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('vire-nav nav a')].find((a) => a.textContent!.startsWith('Home'))!;
      ([...link.childNodes].find((n) => n.nodeType === 3) as Text).data = 'Start';
    });
    await page.waitForTimeout(150);
    expect((await page.locator('vire-nav > [data-vk-lens]').textContent())!).toContain('Start');
    await page.mouse.up();
  });

  test('the bottom safe area lifts the bar: the value the probe reads is the bottom inset', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    const gap = async () => {
      const frame = await rect(page, '#frame');
      const nav = await rect(page, 'vire-nav > nav');
      return frame.y + frame.height - (nav.y + nav.height);
    };
    expect(await gap()).toBe(16);
    await page.addStyleTag({ content: '[data-vk-probe]{padding-bottom:34px !important}' });
    await resize(page, 431, 720);
    await settle(page);
    expect(await gap()).toBe(34);
    expect(await page.locator('vire-nav [data-vk-probe]').count()).toBe(0);
  });
});

test.describe('attributes changed at runtime', () => {
  test('form can be set and removed: the form follows, and goes back to the one the window asks for', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1280, 800);
    await page.evaluate(() => document.querySelector('vire-nav')!.setAttribute('form', 'bar'));
    await formIs(page, 'bar');
    await settle(page);
    await page.evaluate(() => document.querySelector('vire-nav')!.setAttribute('form', 'rail'));
    await formIs(page, 'rail');
    await settle(page);
    await page.evaluate(() => document.querySelector('vire-nav')!.removeAttribute('form'));
    await formIs(page, 'sidebar');
    await settle(page);
  });

  test('removing minimize while the bar is minimised expands it', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await scrollTo(page, 100);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    await page.evaluate(() => document.querySelector('vire-nav')!.removeAttribute('minimize'));
    await page.waitForFunction(() => !document.querySelector('vire-nav')!.hasAttribute('data-minimized'));
    await settle(page);
    expect((await rect(page, 'vire-nav > nav')).width).toBe(4 * 74 + 6);
    await scrollTo(page, 400);
    await page.waitForTimeout(100);
    expect(await attr(page, 'data-minimized')).toBeNull();
  });

  test('glass toggled detaches and reattaches the glass of the body and changes nothing else', async ({ page }) => {
    await stubGlass(page);
    await openNav(page, 'accessory=0', 430, 720);
    const alive = async () => (await lenses(page)).filter((l) => l.alive).map((l) => l.kind);
    expect(await alive()).toEqual(['body']);
    const before = await rect(page, 'vire-nav > nav');
    await page.evaluate(() => document.querySelector('vire-nav')!.removeAttribute('glass'));
    await expect.poll(alive).toEqual([]);
    await expect(page.locator('vire-nav')).toHaveAttribute('data-glass', 'off');
    expect(await rect(page, 'vire-nav > nav')).toEqual(before);
    expect(await attr(page, 'data-form')).toBe('bar');
    await page.evaluate(() => document.querySelector('vire-nav')!.setAttribute('glass', ''));
    await expect.poll(alive).toEqual(['body']);
    await expect(page.locator('vire-nav')).toHaveAttribute('data-glass', 'on');
    expect(await rect(page, 'vire-nav > nav')).toEqual(before);
  });

  test('collapsed set and removed by the host holds the large window as a rail and lets it go', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 1280, 800);
    await page.evaluate(() => document.querySelector('vire-nav')!.setAttribute('collapsed', ''));
    await formIs(page, 'rail');
    await settle(page);
    await expect(page.locator('vire-nav button[data-vk-toggle]')).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => document.querySelector('vire-nav')!.removeAttribute('collapsed'));
    await formIs(page, 'sidebar');
    await settle(page);
    await expect(page.locator('vire-nav button[data-vk-toggle]')).toHaveAttribute('aria-expanded', 'true');
    expect((await log(page)).filter((line) => line.startsWith('collapse:'))).toEqual([]);
  });
});

test.describe('markup replaced at runtime', () => {
  test('links added, removed and reordered by a re-render: the plan follows, the pill follows aria-current, the removed links keep nothing', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await page.evaluate(() => {
      const w = window as unknown as { __old: Element[] };
      w.__old = [...document.querySelectorAll('vire-nav nav li, vire-nav nav li a')];
    });
    await page.evaluate(() => {
      const icon = document.querySelector('vire-nav nav a svg')!.outerHTML;
      const items: [string, string, boolean, string][] = [
        ['Friends', '/friends', true, ''],
        ['Home', '/', false, ''],
        ['Library', '/library', false, '<span data-badge>2</span><span data-badge-label>, 2 new</span>'],
        ['Fresh', '/fresh', false, ''],
      ];
      const lists = document.querySelectorAll('vire-nav nav > ul');
      lists[0]!.innerHTML = items.map(([label, href, current, extra]) => '<li><a href="' + href + '"' + (current ? ' aria-current="page"' : '') + '>' + icon + label + extra + '</a></li>').join('');
      lists[1]!.innerHTML = '';
    });
    await settle(page);
    const links = page.locator('vire-nav nav > ul:not([data-secondary]) a');
    await expect(links).toHaveCount(4);
    const boxes = await links.evaluateAll((els) => els.map((el) => ({ text: el.textContent!.trim(), x: el.getBoundingClientRect().x, w: el.getBoundingClientRect().width })));
    expect(boxes.map((b) => b.text.replace(/[0-9]+, [0-9]+ new$/, ''))).toEqual(['Friends', 'Home', 'Library', 'Fresh']);
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x + boxes[i - 1]!.w - 1);
    const pill = (await page.locator('[data-vk-pill]').boundingBox())!;
    expect(pill.x).toBeCloseTo(boxes[0]!.x, 0);
    await expect(page.getByRole('link', { name: /^Library ?, 2 new$/ })).toHaveCount(1);
    const leftovers = await page.evaluate(() =>
      (window as unknown as { __old: HTMLElement[] }).__old.map((el) => [el.hasAttribute('hidden'), (el.getAttribute('style') ?? '').includes('--vk-'), el.hasAttribute('data-lens-over')]),
    );
    expect(leftovers.flat().some(Boolean)).toBe(false);
    await page.mouse.click(boxes[2]!.x + 30, (await rect(page, 'vire-nav > nav')).y + 28);
    expect(await clicks(page)).toEqual(['click:Library']);
    await reform(page, 1280, 800, 'sidebar');
    await expect(page.locator('vire-nav nav a:visible')).toHaveCount(4 + 1);
  });

  test('aria-current moving during a change of form: it lands with the pill on the new link and the copy in the lens shows it', async ({ page }) => {
    await openNav(page, 'glass=0&accessory=0', 430, 720);
    await resize(page, 700, 720);
    await page.waitForFunction(() => document.querySelector('vire-nav')!.hasAttribute('data-lens'));
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.querySelector('vire-nav [aria-current]')!.removeAttribute('aria-current');
      [...document.querySelectorAll('vire-nav nav a')].find((a) => a.textContent === 'Friends')!.setAttribute('aria-current', 'page');
    });
    const samples = await sampleFrames(page, []);
    expect(samples.some((s) => s.lens?.text === 'Friends')).toBe(true);
    expect(samples.at(-1)!.lens).toBeNull();
    expect(await attr(page, 'data-form')).toBe('rail');
    const link = await linkBox(page, 'Friends');
    const pill = (await page.locator('[data-vk-pill]').boundingBox())!;
    expect(pill.y).toBeCloseTo(link.y + 3, 0);
    expect(pill.x).toBeCloseTo(link.x + 3, 0);
  });
});

import { expect, test, type Page } from '@playwright/test';
import { SCROLL_EDGE_ENGAGE_DP, scrollEdgeReachDp, scrollEdgeStrength } from 'vireglass';
import { nextFrame, openCase } from './helpers';
import { settleGlass } from './legibility';

test.use({ viewport: { width: 1700, height: 1000 } });

const scene = async (page: Page, atom: string, backdrop = 'text', extra = ''): Promise<void> => {
  await openCase(page, `view=legibility&lg=${atom}&backdrop=${backdrop}&glass=1${extra}`);
  await settleGlass(page, !/glass=0/.test(extra));
};

const SURFACE = 'vire-sheet > [popover]';
const openSheet = async (page: Page, glass: string, backdrop = 'photo', form = 'bottom-sheet'): Promise<void> => {
  await openCase(page, `atom=sheet&form=${form}&detent=medium&backdrop=${backdrop}&glass=${glass}`);
  await page.waitForFunction(() => document.querySelector('vire-sheet, vire-popover')?.getAttribute('data-phase') === 'open');
  await settleGlass(page, glass === '1');
};

type Box = { x: number; y: number; w: number; h: number };
const BOX = `(el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }`;

const edgeBox = (page: Page, host: string): Promise<Box | null> =>
  page.evaluate(
    ([host, fn]) => {
      const el = document.querySelector<HTMLElement>(`${host} > [data-vk-edge]`);
      return el ? (eval(fn as string) as (el: Element) => Box)(el) : null;
    },
    [host, BOX] as const,
  );

const boxOf = (page: Page, selector: string): Promise<Box> =>
  page.evaluate(([selector, fn]) => (eval(fn as string) as (el: Element) => Box)(document.querySelector(selector as string)!), [selector, BOX] as const);

const opacityOf = (page: Page, selector: string): Promise<number> =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return el ? Number(getComputedStyle(el).opacity) : -1;
  }, selector);

/** On screen: laid out, visible and not transparent, which for the edge also means the content has slid under the bar. */
const rendered = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0 && r.width > 0 && r.height > 0;
  }, selector);

const paint = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => ({ blur: el.style.backdropFilter, mask: el.style.maskImage, tone: el.style.backgroundImage }));

/** The mean change of luminance between neighbouring pixels in a region of a screenshot: what is left of the text's strokes. */
async function sharpness(page: Page, region: Box): Promise<number> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, region }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const x0 = Math.round(region.x);
      const y0 = Math.round(region.y);
      const w = Math.round(region.w);
      const h = Math.round(region.h);
      const { data } = ctx.getImageData(x0, y0, w, h);
      const luma = (i: number) => 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      let sum = 0;
      for (let y = 0; y < h - 1; y += 1) {
        for (let x = 0; x < w - 1; x += 1) {
          const i = (y * w + x) * 4;
          sum += Math.abs(luma(i) - luma(i + 4)) + Math.abs(luma(i) - luma(i + w * 4));
        }
      }
      return sum / (w * h);
    },
    { png, region },
  );
}

const hideBodies = (page: Page): Promise<unknown> =>
  page.addStyleTag({ content: 'vire-nav>nav,vire-nav>[data-accessory],vire-toolbar>[data-vk-capsule],vire-toolbar button{visibility:hidden!important}' });

const inkAway = (page: Page): Promise<unknown> =>
  page.addStyleTag({
    content: 'vire-nav *,vire-toolbar *{-webkit-text-fill-color:transparent!important;text-shadow:none!important;fill:transparent!important;stroke:transparent!important}',
  });

/** How far the navigation bar's edge is from where it belongs, in dp: 0 over the scroller's width to its bottom, reaching past the bar (and its accessory) by the core's reach. */
async function navMismatch(page: Page): Promise<number> {
  const g = await page.evaluate(() => {
    const edge = document.querySelector<HTMLElement>('vire-nav > [data-vk-edge]');
    if (!edge) return null;
    const host = document.querySelector('vire-nav')!;
    const nav = host.querySelector(':scope > nav')!.getBoundingClientRect();
    const accessory = host.querySelector('[data-accessory]')?.getBoundingClientRect();
    const scroller = document.querySelector<HTMLElement>('#lg-scroll')!;
    const s = scroller.getBoundingClientRect();
    const r = edge.getBoundingClientRect();
    return { r: { x: r.x, width: r.width, bottom: r.bottom, height: r.height }, s: { x: s.x, width: scroller.clientWidth, bottom: s.bottom }, bar: nav.height, top: Math.min(nav.top, accessory && accessory.width > 0 ? accessory.top : Infinity) };
  });
  if (!g) return Infinity;
  const want = g.s.bottom - g.top + scrollEdgeReachDp(g.bar);
  return Math.abs(g.r.x - g.s.x) + Math.abs(g.r.width - g.s.width) + Math.abs(g.r.bottom - g.s.bottom) + Math.abs(g.r.height - want);
}

/** Patches the reads, does one thing to the page and returns how many times the page read layout. */
function countReads(page: Page, act: 'scroll' | 'resize') {
  return page.evaluate(async (act) => {
    const counts = { rects: 0, styles: 0, scrollHeights: 0 };
    const rect = Element.prototype.getBoundingClientRect;
    const style = window.getComputedStyle;
    const height = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')!;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      counts.rects += 1;
      return rect.call(this);
    };
    window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
      counts.styles += 1;
      return style(el, pseudo);
    }) as typeof getComputedStyle;
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get(this: Element) {
        counts.scrollHeights += 1;
        return height.get!.call(this);
      },
    });
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    if (act === 'scroll') {
      const scroller = document.querySelector<HTMLElement>('#lg-scroll')!;
      for (let i = 0; i < 20; i += 1) {
        scroller.scrollTop += 30;
        await frame();
      }
    } else {
      document.querySelector<HTMLElement>('#frame')!.style.width = '340px';
      for (let i = 0; i < 4; i += 1) await frame();
    }
    Element.prototype.getBoundingClientRect = rect;
    window.getComputedStyle = style;
    Object.defineProperty(Element.prototype, 'scrollHeight', height);
    return counts;
  }, act);
}

test.describe('where the edge sits', () => {
  test('the bar form puts one edge under the body: first in the host, over the scroller\'s width, reaching past the bar by the core\'s reach', async ({ page }) => {
    await scene(page, 'nav-bar');
    const order = await page.evaluate(() => {
      const edge = document.querySelector<HTMLElement>('vire-nav > [data-vk-edge]')!;
      const host = document.querySelector('vire-nav')!;
      return { first: host.firstElementChild === edge, before: Boolean(edge.compareDocumentPosition(host.querySelector(':scope > nav')!) & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    expect(order.first).toBe(true);
    expect(order.before).toBe(true);
    expect(await navMismatch(page)).toBeLessThan(1);
  });

  test('the toolbar has one at the edge it stands on, and none on the strip', async ({ page }) => {
    await scene(page, 'toolbar-top');
    const frame = await boxOf(page, '#lg-scroll');
    const top = (await edgeBox(page, 'vire-toolbar'))!;
    expect(top.y).toBeCloseTo(frame.y, 0);
    expect(top.w).toBeCloseTo(frame.w, 0);
    await page.locator('vire-toolbar').evaluate((el) => el.setAttribute('placement', 'bottom'));
    await expect.poll(async () => (await edgeBox(page, 'vire-toolbar'))?.y).toBeGreaterThan(frame.y + frame.h / 2);
    const bottom = (await edgeBox(page, 'vire-toolbar'))!;
    expect(bottom.y + bottom.h).toBeCloseTo(frame.y + frame.h, 0);
    await page.locator('vire-toolbar').evaluate((el) => el.setAttribute('placement', 'trailing'));
    await expect.poll(() => edgeBox(page, 'vire-toolbar')).toBeNull();
  });

  test('a toolbar that stands clear of the scroller has none', async ({ page }) => {
    await scene(page, 'toolbar-top');
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#lg-scroll')!.style.top = '80px';
    });
    await expect.poll(async () => (await page.locator('vire-toolbar > [data-vk-edge]').evaluate((el) => (el as HTMLElement).style.display))).toBe('none');
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#lg-scroll')!.style.top = '0';
    });
    await expect.poll(async () => (await page.locator('vire-toolbar > [data-vk-edge]').evaluate((el) => (el as HTMLElement).style.display))).toBe('');
  });

  test('the rail and the sidebar have none', async ({ page }) => {
    for (const atom of ['nav-rail', 'nav-sidebar']) {
      await scene(page, atom);
      expect(await edgeBox(page, 'vire-nav'), atom).toBeNull();
    }
  });

  test('the toolbar takes the scroller as a property, and the element follows it', async ({ page }) => {
    await scene(page, 'toolbar-top');
    await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement & { scroller: Element | null }>('vire-toolbar')!;
      bar.removeAttribute('scroller');
      bar.scroller = null;
    });
    await expect.poll(() => edgeBox(page, 'vire-toolbar')).toBeNull();
    await page.evaluate(() => {
      document.querySelector<HTMLElement & { scroller: Element | null }>('vire-toolbar')!.scroller = document.querySelector('#lg-scroll');
    });
    await expect.poll(() => edgeBox(page, 'vire-toolbar')).not.toBeNull();
  });

  test('the toolbar finds a scroller named by id that went and came back or was replaced, whenever its markup is touched, as the navigation does', async ({ page }) => {
    await scene(page, 'toolbar-top');
    const edge = 'vire-toolbar > [data-vk-edge]';
    const touch = () => page.locator('vire-toolbar > [data-vk-capsule]').first().evaluate((el) => el.setAttribute('data-vk', String(Math.random())));
    const scrollTo = (top: number) => page.evaluate((top) => void (document.querySelector('#lg-scroll')!.scrollTop = top), top);
    await page.evaluate(() => {
      const el = document.querySelector('#lg-scroll')!;
      el.remove();
      (window as unknown as { __gone: Element }).__gone = el;
    });
    await touch();
    await expect.poll(() => edgeBox(page, 'vire-toolbar')).toBeNull();
    await page.evaluate(() => {
      const el = (window as unknown as { __gone: Element }).__gone.cloneNode(true);
      document.querySelector('#frame')!.prepend(el);
    });
    await touch();
    await expect.poll(() => edgeBox(page, 'vire-toolbar')).not.toBeNull();
    await scrollTo(0);
    await expect.poll(() => opacityOf(page, edge)).toBe(0);
    await scrollTo(300);
    await expect.poll(() => opacityOf(page, edge)).toBe(1);
    await page.evaluate(() => {
      const old = document.querySelector('#lg-scroll')!;
      old.replaceWith(old.cloneNode(true));
    });
    await touch();
    await scrollTo(0);
    await expect.poll(() => opacityOf(page, edge)).toBe(0);
    await scrollTo(300);
    await expect.poll(() => opacityOf(page, edge)).toBe(1);
  });

  test('the edge follows a resize of the window and the navigation turning into a rail and back', async ({ page }) => {
    await scene(page, 'nav-bar');
    const frame = (w: number, h: number) =>
      page.locator('#frame').evaluate(
        (el, [w, h]) => {
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        },
        [w, h] as const,
      );
    expect(await navMismatch(page)).toBeLessThan(1);
    const was = (await edgeBox(page, 'vire-nav'))!;
    await frame(330, 600);
    await expect.poll(() => navMismatch(page)).toBeLessThan(1);
    expect((await edgeBox(page, 'vire-nav'))!.w).toBeLessThan(was.w);
    await frame(390, 720);
    await expect.poll(() => navMismatch(page)).toBeLessThan(1);
    await frame(900, 720);
    await expect.poll(() => edgeBox(page, 'vire-nav')).toBeNull();
    await frame(390, 720);
    await expect.poll(() => navMismatch(page)).toBeLessThan(1);
  });

  test('an accessory above the bar deepens the band, and taking it away takes the depth back', async ({ page }) => {
    await scene(page, 'nav-bar');
    const height = async () => (await edgeBox(page, 'vire-nav'))!.h;
    const accessory = page.locator('vire-nav > [data-accessory]');
    const full = await height();
    await accessory.evaluate((el) => el.style.setProperty('display', 'none'));
    await expect.poll(height).toBeLessThan(full - 20);
    expect(await navMismatch(page)).toBeLessThan(1);
    await accessory.evaluate((el) => el.style.removeProperty('display'));
    await expect.poll(height).toBeCloseTo(full, 0);
    expect(await navMismatch(page)).toBeLessThan(1);
  });

  for (const [host, atom] of [
    ['vire-nav', 'nav-bar'],
    ['vire-toolbar', 'toolbar-top'],
  ] as const) {
    test(`a pass that changes nothing reads no geometry: ${host}, and one that does is the control`, async ({ page }) => {
      await scene(page, atom);
      const reads = (value: string) =>
        page.evaluate(
          async ([host, value]) => {
            const scroller = document.querySelector<HTMLElement>('#lg-scroll')!;
            let count = 0;
            const rect = scroller.getBoundingClientRect.bind(scroller);
            scroller.getBoundingClientRect = () => {
              count += 1;
              return rect();
            };
            document.querySelector(host!)!.setAttribute('scroll-edge', value!);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            delete (scroller as Partial<HTMLElement>).getBoundingClientRect;
            return count;
          },
          [host, value],
        );
      expect(await reads('on')).toBe(0);
      expect(await reads('hard')).toBeGreaterThan(0);
    });
  }
});

test.describe('under the glass, and out of the way', () => {
  const HOSTS: { name: string; open: (page: Page) => Promise<void>; edge: string; stop: string; bodies: string }[] = [
    { name: 'the navigation bar', open: (page) => scene(page, 'nav-bar'), edge: 'vire-nav > [data-vk-edge]', stop: 'html', bodies: 'vire-nav > :is(nav,[data-accessory])' },
    { name: 'the toolbar at the top', open: (page) => scene(page, 'toolbar-top'), edge: 'vire-toolbar > [data-vk-edge]', stop: 'html', bodies: 'vire-toolbar > [data-vk-capsule]' },
    { name: 'the toolbar at the bottom', open: (page) => scene(page, 'toolbar-bottom'), edge: 'vire-toolbar > [data-vk-edge]', stop: 'html', bodies: 'vire-toolbar > [data-vk-capsule]' },
    {
      name: 'a sheet (the surface it blurs inside is the root)',
      open: async (page) => {
        await openSheet(page, '1');
        await page.locator(SURFACE).evaluate((el) => (el.scrollTop = 120));
      },
      edge: `${SURFACE} > [data-vk-edge]`,
      stop: SURFACE,
      bodies: '',
    },
  ];

  for (const host of HOSTS) {
    test(`${host.name}: aria-hidden, pointer-events none, in the stack with the bodies and no backdrop root between it and the page, and a hit test that can fail`, async ({ page }) => {
      await host.open(page);
      const info = await page.evaluate(
        ([edgeSelector, stopSelector, bodiesSelector]) => {
          const edge = document.querySelector<HTMLElement>(edgeSelector!)!;
          const bodies = bodiesSelector ? [...document.querySelectorAll(bodiesSelector)] : [];
          const before = () => bodies.every((body) => Boolean(edge.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING));
          const order = before();
          const parent = edge.parentElement!;
          const next = edge.nextSibling;
          parent.append(edge);
          const orderWhenLast = before();
          parent.insertBefore(edge, next);
          const stacked = [edge, ...bodies].every((el) => getComputedStyle(el).zIndex === 'auto');
          const stop = document.querySelector(stopSelector!);
          const roots: string[] = [];
          for (let el: Element | null = edge.parentElement; el && el !== stop; el = el.parentElement) {
            const s = getComputedStyle(el);
            if (s.filter !== 'none' || s.backdropFilter !== 'none' || Number(s.opacity) < 1 || (s.maskImage ?? 'none') !== 'none' || s.clipPath !== 'none' || s.mixBlendMode !== 'normal') {
              roots.push(el.localName);
            }
          }
          const r = edge.getBoundingClientRect();
          const x = r.x + r.width * 0.2;
          const y = r.y + 2;
          const events = getComputedStyle(edge).pointerEvents;
          const hit = document.elementFromPoint(x, y) === edge;
          edge.style.pointerEvents = 'auto';
          const hitWhenOn = document.elementFromPoint(x, y) === edge;
          edge.style.removeProperty('pointer-events');
          return { hidden: edge.getAttribute('aria-hidden'), events, roots, hit, hitWhenOn, bodies: bodies.length, order, orderWhenLast, stacked };
        },
        [host.edge, host.stop, host.bodies],
      );
      if (host.bodies) expect(info.bodies).toBeGreaterThan(0);
      expect(info.order, 'the edge comes before the bodies, so it paints under them').toBe(true);
      if (host.bodies) expect(info.orderWhenLast, 'the order check sees an edge that comes last').toBe(false);
      expect(info.stacked, 'no z-index on the edge or the bodies').toBe(true);
      expect(info.hidden).toBe('true');
      expect(info.events).toBe('none');
      expect(info.roots, 'nothing between the edge and the page is a backdrop root').toEqual([]);
      expect(info.hit).toBe(false);
      expect(info.hitWhenOn, 'the hit test finds an edge that takes the pointer').toBe(true);
    });
  }
});

test.describe('what it is made of', () => {
  test('light ink dissolves, dark glass gets a dimming, a pinned view a flat band', async ({ page }) => {
    const nav = 'vire-nav > [data-vk-edge]';
    await scene(page, 'nav-bar', 'text');
    const light = await paint(page, nav);
    expect(light.blur).toMatch(/^blur\(/);
    expect(light.mask).toContain('linear-gradient');
    expect(light.tone).toBe('none');
    await scene(page, 'nav-bar', 'dark');
    expect(await page.locator('vire-nav > nav').evaluate((el) => el.style.getPropertyValue('--vireglass-ink'))).toBe('1');
    const dark = await paint(page, nav);
    expect(dark.mask).toContain('linear-gradient');
    expect(dark.tone).toContain('rgba(0, 0, 0, 0.1)');
    await scene(page, 'nav-bar', 'text', '&edge=hard');
    const hard = await paint(page, nav);
    expect(hard.mask).toBe('');
    expect(hard.tone).toContain('rgba(0, 0, 0, 0.18)');
  });

  test('the toolbar and a sheet take the same three styles', async ({ page }) => {
    const toolbar = 'vire-toolbar > [data-vk-edge]';
    await scene(page, 'toolbar-bottom', 'text');
    const light = await paint(page, toolbar);
    expect(light.blur).toMatch(/^blur\(/);
    expect(light.mask).toContain('linear-gradient');
    expect(light.tone).toBe('none');
    await scene(page, 'toolbar-bottom', 'dark');
    const dark = await paint(page, toolbar);
    expect(dark.mask).toContain('linear-gradient');
    expect(dark.tone).toContain('rgba(0, 0, 0, 0.1)');
    await scene(page, 'toolbar-bottom', 'text', '&edge=hard');
    const hard = await paint(page, toolbar);
    expect(hard.mask).toBe('');
    expect(hard.tone).toContain('rgba(0, 0, 0, 0.18)');

    const sheet = `${SURFACE} > [data-vk-edge]`;
    await openSheet(page, '1', 'light');
    expect(await page.locator('vire-sheet').getAttribute('data-ink')).toBe('dark');
    const sheetLight = await paint(page, sheet);
    expect(sheetLight.blur).toMatch(/^blur\(/);
    expect(sheetLight.mask).toContain('linear-gradient');
    expect(sheetLight.tone).toBe('none');
    await openSheet(page, '1', 'dark');
    expect(await page.locator('vire-sheet').getAttribute('data-ink')).toBe('light');
    const sheetDark = await paint(page, sheet);
    expect(sheetDark.mask).toContain('linear-gradient');
    expect(sheetDark.tone).toContain('rgba(0, 0, 0, 0.1)');
    await page.locator('vire-sheet').evaluate((el) => el.setAttribute('scroll-edge', 'hard'));
    await expect.poll(async () => (await paint(page, sheet)).mask).toBe('');
    expect((await paint(page, sheet)).tone).toContain('rgba(0, 0, 0, 0.18)');
  });

  test('the navigation\'s edge follows the glass when its ink flips', async ({ page }) => {
    await scene(page, 'nav-bar', 'text');
    const nav = 'vire-nav > [data-vk-edge]';
    expect((await paint(page, nav)).tone).toBe('none');
    await page.locator('vire-nav > nav').evaluate((el) => el.style.setProperty('--vireglass-ink', '1'));
    await expect.poll(async () => (await paint(page, nav)).tone).toContain('rgba(0, 0, 0, 0.1)');
    await page.locator('vire-nav > nav').evaluate((el) => el.style.setProperty('--vireglass-ink', '0'));
    await expect.poll(async () => (await paint(page, nav)).tone).toBe('none');
  });

  test('the attribute turns it off and back on, live; glass off has none, and the modes that keep the glass keep it', async ({ page }) => {
    await scene(page, 'nav-bar');
    const nav = 'vire-nav > [data-vk-edge]';
    expect(await rendered(page, nav)).toBe(true);
    await page.locator('vire-nav').evaluate((el) => el.setAttribute('scroll-edge', 'off'));
    await expect.poll(() => edgeBox(page, 'vire-nav')).toBeNull();
    await page.locator('vire-nav').evaluate((el) => el.removeAttribute('scroll-edge'));
    await expect.poll(() => rendered(page, nav)).toBe(true);
    await page.locator('vire-nav').evaluate((el) => el.setAttribute('glass', 'off'));
    await expect.poll(() => edgeBox(page, 'vire-nav')).toBeNull();
    for (const mode of ['rt', 'ic']) {
      await scene(page, 'nav-bar', 'text', `&${mode}=1`);
      expect(await rendered(page, nav), mode).toBe(true);
    }
    await openCase(page, 'view=legibility&lg=nav-bar&backdrop=text&glass=0');
    expect(await edgeBox(page, 'vire-nav')).toBeNull();
  });

  test('the toolbar takes the attribute too, and has none with glass off', async ({ page }) => {
    const toolbar = 'vire-toolbar > [data-vk-edge]';
    await scene(page, 'toolbar-top');
    expect(await rendered(page, toolbar)).toBe(true);
    await page.locator('vire-toolbar').evaluate((el) => el.setAttribute('scroll-edge', 'off'));
    await expect.poll(() => edgeBox(page, 'vire-toolbar')).toBeNull();
    await page.locator('vire-toolbar').evaluate((el) => el.removeAttribute('scroll-edge'));
    await expect.poll(() => rendered(page, toolbar)).toBe(true);
    await page.locator('vire-toolbar').evaluate((el) => el.setAttribute('glass', 'off'));
    await expect.poll(() => edgeBox(page, 'vire-toolbar')).toBeNull();
    await openCase(page, 'view=legibility&lg=toolbar-top&backdrop=text&glass=0');
    expect(await edgeBox(page, 'vire-toolbar')).toBeNull();
    for (const mode of ['rt', 'ic']) {
      await scene(page, 'toolbar-top', 'text', `&${mode}=1`);
      expect(await rendered(page, toolbar), mode).toBe(true);
    }
  });

  test('forced colours replace the glass, and the edge goes with it', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await scene(page, 'nav-bar');
    expect(await edgeBox(page, 'vire-nav')).not.toBeNull();
    expect(await rendered(page, 'vire-nav > [data-vk-edge]')).toBe(false);
    await scene(page, 'toolbar-top');
    expect(await rendered(page, 'vire-toolbar > [data-vk-edge]')).toBe(false);
    await openSheet(page, '1');
    await page.locator(SURFACE).evaluate((el) => (el.scrollTop = 120));
    expect(await rendered(page, `${SURFACE} > [data-vk-edge]`)).toBe(false);
  });

  test('a bar at the top of the scroller, where nothing has slid under it yet, shows none of it; scrolling brings it in', async ({ page }) => {
    await scene(page, 'toolbar-top', 'text', '&scroll=0');
    const opacity = () => opacityOf(page, 'vire-toolbar > [data-vk-edge]');
    expect(await opacity()).toBe(0);
    await page.locator('#lg-scroll').evaluate((el) => (el.scrollTop = 200));
    await expect.poll(opacity).toBe(1);
  });

  const BARS: { name: string; open: (page: Page) => Promise<void>; scroller: string; edge: string; side: 'top' | 'bottom' }[] = [
    { name: 'the navigation bar', open: (page) => scene(page, 'nav-bar'), scroller: '#lg-scroll', edge: 'vire-nav > [data-vk-edge]', side: 'bottom' },
    { name: 'the toolbar at the top', open: (page) => scene(page, 'toolbar-top'), scroller: '#lg-scroll', edge: 'vire-toolbar > [data-vk-edge]', side: 'top' },
    { name: 'the toolbar at the bottom', open: (page) => scene(page, 'toolbar-bottom'), scroller: '#lg-scroll', edge: 'vire-toolbar > [data-vk-edge]', side: 'bottom' },
    { name: 'a sheet', open: (page) => openSheet(page, '1'), scroller: SURFACE, edge: `${SURFACE} > [data-vk-edge]`, side: 'top' },
  ];
  for (const bar of BARS) {
    test(`${bar.name}: none with nothing under it, partway short of ${SCROLL_EDGE_ENGAGE_DP} dp, full from ${SCROLL_EDGE_ENGAGE_DP} dp`, async ({ page }) => {
      await bar.open(page);
      const max = await page.locator(bar.scroller).evaluate((el) => el.scrollHeight - el.clientHeight);
      const slide = async (dp: number) => {
        const top = bar.side === 'top' ? dp : max - dp;
        await page.locator(bar.scroller).evaluate((el, top) => (el.scrollTop = top), top);
        return top;
      };
      await slide(0);
      await expect.poll(() => opacityOf(page, bar.edge)).toBe(0);
      const half = await slide(SCROLL_EDGE_ENGAGE_DP / 2);
      await expect.poll(() => opacityOf(page, bar.edge)).toBeCloseTo(scrollEdgeStrength(bar.side, half, max), 1);
      expect(await opacityOf(page, bar.edge)).toBeGreaterThan(0.2);
      expect(await opacityOf(page, bar.edge)).toBeLessThan(0.8);
      await slide(SCROLL_EDGE_ENGAGE_DP);
      await expect.poll(() => opacityOf(page, bar.edge)).toBe(1);
      await slide(SCROLL_EDGE_ENGAGE_DP * 3);
      await expect.poll(() => opacityOf(page, bar.edge)).toBe(1);
    });
  }

  test('scrolling reads no rect and no computed style: the edge is driven by the scroll position alone', async ({ page }) => {
    await scene(page, 'nav-bar');
    const reads = await countReads(page, 'scroll');
    expect(reads.rects).toBe(0);
    expect(reads.styles).toBe(0);
    expect(reads.scrollHeights, 'the core reads the scroller\'s scrollHeight on a scroll').toBeGreaterThan(0);
  });

  test('the counter sees what it is for: resizing the window reads rects', async ({ page }) => {
    await scene(page, 'nav-bar');
    expect((await countReads(page, 'resize')).rects).toBeGreaterThan(0);
  });
});

test.describe('the content under the bar is out of focus in the screenshot', () => {
  const NAV = 'vire-nav > nav';

  test('the text under the navigation bar keeps under three tenths of its sharpness, with the glass away', async ({ page }) => {
    const read = async (edge: string) => {
      await scene(page, 'nav-bar', 'text', edge);
      await hideBodies(page);
      await nextFrame(page);
      return sharpness(page, await boxOf(page, NAV));
    };
    const off = await read('&edge=off');
    const on = await read('');
    expect(off).toBeGreaterThan(1);
    expect(on / off).toBeLessThan(0.3);
  });

  test('the glass shows it dissolved: through the body, with the ink taken away, the lines keep under a third of their sharpness', async ({ page }) => {
    const read = async (edge: string) => {
      await scene(page, 'nav-bar', 'text', edge);
      await inkAway(page);
      await nextFrame(page);
      return sharpness(page, await boxOf(page, NAV));
    };
    const off = await read('&edge=off');
    const on = await read('');
    expect(on / off).toBeLessThan(0.34);
  });

  for (const atom of ['toolbar-top', 'toolbar-bottom']) {
    test(`the toolbar's edge is under its glass too (${atom}): with the glass away and through a capsule with the ink taken away`, async ({ page }) => {
      const read = async (edge: string, away: 'glass' | 'ink') => {
        await scene(page, atom, 'text', edge);
        const capsule = await boxOf(page, 'vire-toolbar > [data-vk-capsule]');
        if (away === 'glass') await hideBodies(page);
        else await inkAway(page);
        await nextFrame(page);
        return sharpness(page, capsule);
      };
      const glassOff = await read('&edge=off', 'glass');
      expect(glassOff).toBeGreaterThan(1);
      expect((await read('', 'glass')) / glassOff).toBeLessThan(0.45);
      const inkOff = await read('&edge=off', 'ink');
      expect((await read('', 'ink')) / inkOff).toBeLessThan(0.6);
    });
  }

  test('a ramp that runs the wrong way leaves it sharp, and the gate sees it', async ({ page }) => {
    await scene(page, 'nav-bar', 'text');
    await page.addStyleTag({ content: 'vire-nav>[data-vk-edge]{mask-image:linear-gradient(to bottom,#000,transparent)!important;-webkit-mask-image:linear-gradient(to bottom,#000,transparent)!important}' });
    await hideBodies(page);
    await nextFrame(page);
    const wrong = await sharpness(page, await boxOf(page, NAV));
    await scene(page, 'nav-bar', 'text', '&edge=off');
    await hideBodies(page);
    await nextFrame(page);
    const off = await sharpness(page, await boxOf(page, NAV));
    expect(wrong / off).toBeGreaterThan(0.5);
  });
});

test.describe('a sheet', () => {
  test('has one under its top strip that sticks to the top of its content and is there once the content has scrolled', async ({ page }) => {
    await openSheet(page, '1');
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(1);
    const info = () =>
      page.evaluate((surface) => {
        const el = document.querySelector<HTMLElement>(surface)!;
        const edge = el.querySelector<HTMLElement>(':scope > [data-vk-edge]')!;
        const grabber = el.querySelector<HTMLElement>(':scope > [data-vk-grabber]')!;
        const r = edge.getBoundingClientRect();
        return {
          position: getComputedStyle(edge).position,
          opacity: Number(getComputedStyle(edge).opacity),
          behindGrabber: Boolean(edge.compareDocumentPosition(grabber) & Node.DOCUMENT_POSITION_PRECEDING),
          gap: r.top - el.getBoundingClientRect().top,
          height: r.height,
          grabber: grabber.getBoundingClientRect().height,
        };
      }, SURFACE);
    const rest = await info();
    expect(rest.position).toBe('sticky');
    expect(rest.opacity).toBe(0);
    expect(rest.behindGrabber, 'the grabber comes first, so it paints over the edge').toBe(true);
    await page.locator(SURFACE).evaluate((el) => (el.scrollTop = 120));
    await expect.poll(async () => (await info()).opacity).toBe(1);
    const scrolled = await info();
    expect(scrolled.gap).toBeCloseTo(0, 0);
    expect(scrolled.height).toBeCloseTo(scrollEdgeReachDp(rest.grabber), 0);
    expect(await rendered(page, `${SURFACE} > [data-vk-edge]`)).toBe(true);
  });

  test('has none with glass off or with the attribute off', async ({ page }) => {
    await openSheet(page, '0');
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(0);
    await openSheet(page, '1');
    await page.locator('vire-sheet').evaluate((el) => el.setAttribute('scroll-edge', 'off'));
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(0);
    await page.locator('vire-sheet').evaluate((el) => el.removeAttribute('scroll-edge'));
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(1);
  });

  test('takes nothing from the measure of its content', async ({ page }) => {
    await openSheet(page, '1');
    const height = () => page.locator(SURFACE).evaluate((el) => el.scrollHeight);
    const with_ = await height();
    await page.locator('vire-sheet').evaluate((el) => el.setAttribute('scroll-edge', 'off'));
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(0);
    expect(with_).toBe(await height());
  });

  test('a popover has one too, in its sheet form, once its content scrolls', async ({ page }) => {
    await openSheet(page, '1', 'photo', 'popover-sheet');
    const surface = 'vire-popover > [popover]';
    await expect(page.locator(`${surface} > [data-vk-edge]`)).toHaveCount(1);
    await page.locator(surface).evaluate((el) => {
      const filler = document.createElement('div');
      filler.style.height = '900px';
      el.append(filler);
    });
    await page.locator(surface).evaluate((el) => (el.scrollTop = 120));
    await expect.poll(() => opacityOf(page, `${surface} > [data-vk-edge]`)).toBe(1);
    expect(await rendered(page, `${surface} > [data-vk-edge]`)).toBe(true);
    await page.locator('vire-popover').evaluate((el) => el.setAttribute('scroll-edge', 'off'));
    await expect(page.locator(`${surface} > [data-vk-edge]`)).toHaveCount(0);
  });
});

test('the page is a scroller too: the document scrolls under the bar and the edge follows it', async ({ page }) => {
  await openCase(page, 'view=nav&backdrop=photo&glass=1');
  await page.evaluate(() => window.__lab.nav!.scrollOnDocument());
  await expect(page.locator('vire-nav > [data-vk-edge]')).toHaveCount(1);
  const opacity = () => opacityOf(page, 'vire-nav > [data-vk-edge]');
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(opacity).toBe(1);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(opacity).toBe(0);
});

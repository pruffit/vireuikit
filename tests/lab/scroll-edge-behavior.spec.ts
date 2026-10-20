import { expect, test, type Page } from '@playwright/test';
import { scrollEdgeReachDp } from 'vireglass';
import { nextFrame, openCase } from './helpers';
import { settleGlass } from './legibility';

// The scroll edge (reference §10): an element under a bar's glass that blurs what scrolls beneath it, so the glass sees
// content that has already dissolved. `tests/lab/legibility-behavior.spec.ts` measures what it does for the atoms' text.
test.use({ viewport: { width: 1700, height: 1000 } });

const scene = async (page: Page, atom: string, backdrop = 'text', extra = ''): Promise<void> => {
  await openCase(page, `view=legibility&lg=${atom}&backdrop=${backdrop}&glass=1${extra}`);
  await settleGlass(page, !/glass=0/.test(extra));
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
  page.addStyleTag({ content: 'vire-nav>nav,vire-nav>[data-accessory],vire-toolbar>[data-vk-capsule]{visibility:hidden!important}' });

test.describe('where the edge sits', () => {
  test('the bar form puts one edge under the body: first in the host, over the scroller\'s width, reaching past the bar by the core\'s reach', async ({ page }) => {
    await scene(page, 'nav-bar');
    const info = await page.evaluate(() => {
      const edge = document.querySelector<HTMLElement>('vire-nav > [data-vk-edge]')!;
      const host = document.querySelector('vire-nav')!;
      const nav = host.querySelector(':scope > nav')!;
      const scroller = document.querySelector<HTMLElement>('#lg-scroll')!;
      const roots: string[] = [];
      for (let el: Element | null = edge.parentElement; el && el !== document.documentElement; el = el.parentElement) {
        const s = getComputedStyle(el);
        if (s.filter !== 'none' || s.backdropFilter !== 'none' || Number(s.opacity) < 1 || (s.maskImage ?? 'none') !== 'none' || s.clipPath !== 'none' || s.mixBlendMode !== 'normal') {
          roots.push(el.localName);
        }
      }
      const r = edge.getBoundingClientRect();
      const probe = document.elementFromPoint(r.x + 6, r.y + 6);
      return {
        first: host.firstElementChild === edge,
        before: Boolean(edge.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING),
        events: getComputedStyle(edge).pointerEvents,
        hidden: edge.getAttribute('aria-hidden'),
        roots,
        reachedBy: probe === edge,
        scroller: { x: scroller.getBoundingClientRect().x, width: scroller.clientWidth, bottom: scroller.getBoundingClientRect().bottom },
        edge: { x: r.x, width: r.width, bottom: r.bottom, height: r.height },
        bar: nav.getBoundingClientRect().height,
        top: Math.min(nav.getBoundingClientRect().top, host.querySelector('[data-accessory]')?.getBoundingClientRect().top ?? Infinity),
      };
    });
    expect(info.first).toBe(true);
    expect(info.before).toBe(true);
    expect(info.events).toBe('none');
    expect(info.hidden).toBe('true');
    expect(info.roots, 'nothing between the edge and the page is a backdrop root').toEqual([]);
    expect(info.reachedBy).toBe(false);
    expect(info.edge.x).toBeCloseTo(info.scroller.x, 0);
    expect(info.edge.width).toBeCloseTo(info.scroller.width, 0);
    expect(info.edge.bottom).toBeCloseTo(info.scroller.bottom, 0);
    expect(info.edge.height).toBeCloseTo(info.scroller.bottom - info.top + scrollEdgeReachDp(info.bar), 0);
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
});

test.describe('what it is made of', () => {
  test('light ink dissolves, dark glass gets a dimming, a pinned view a flat band', async ({ page }) => {
    const paint = () => page.locator('vire-nav > [data-vk-edge]').evaluate((el) => ({ blur: el.style.backdropFilter, mask: el.style.maskImage, tone: el.style.backgroundImage }));
    await scene(page, 'nav-bar', 'text');
    const light = await paint();
    expect(light.blur).toMatch(/^blur\(/);
    expect(light.mask).toContain('linear-gradient');
    expect(light.tone).toBe('none');
    await scene(page, 'nav-bar', 'dark');
    expect(await page.locator('vire-nav > nav').evaluate((el) => el.style.getPropertyValue('--vireglass-ink'))).toBe('1');
    const dark = await paint();
    expect(dark.mask).toContain('linear-gradient');
    expect(dark.tone).toContain('rgba(0, 0, 0, 0.1)');
    await scene(page, 'nav-bar', 'text', '&edge=hard');
    const hard = await paint();
    expect(hard.mask).toBe('');
    expect(hard.tone).toContain('rgba(0, 0, 0, 0.18)');
  });

  test('the attribute turns it off and back on, live; glass off has none, and the modes that keep the glass keep it', async ({ page }) => {
    await scene(page, 'nav-bar');
    expect(await edgeBox(page, 'vire-nav')).not.toBeNull();
    await page.locator('vire-nav').evaluate((el) => el.setAttribute('scroll-edge', 'off'));
    await expect.poll(() => edgeBox(page, 'vire-nav')).toBeNull();
    await page.locator('vire-nav').evaluate((el) => el.removeAttribute('scroll-edge'));
    await expect.poll(() => edgeBox(page, 'vire-nav')).not.toBeNull();
    await page.locator('vire-nav').evaluate((el) => el.setAttribute('glass', 'off'));
    await expect.poll(() => edgeBox(page, 'vire-nav')).toBeNull();
    for (const mode of ['rt', 'ic']) {
      await scene(page, 'nav-bar', 'text', `&${mode}=1`);
      expect(await edgeBox(page, 'vire-nav'), mode).not.toBeNull();
    }
    await openCase(page, 'view=legibility&lg=nav-bar&backdrop=text&glass=0');
    expect(await edgeBox(page, 'vire-nav')).toBeNull();
  });

  test('a bar at the top of the scroller, where nothing has slid under it yet, shows none of it; scrolling brings it in', async ({ page }) => {
    await scene(page, 'toolbar-top', 'text', '&scroll=0');
    const opacity = () => page.locator('vire-toolbar > [data-vk-edge]').evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(await opacity()).toBe(0);
    await page.locator('#lg-scroll').evaluate((el) => (el.scrollTop = 200));
    await expect.poll(opacity).toBe(1);
  });

  test('scrolling reads no layout: the edge is driven by the scroll position alone', async ({ page }) => {
    await scene(page, 'nav-bar');
    const reads = await page.evaluate(async () => {
      let count = 0;
      const rect = Element.prototype.getBoundingClientRect;
      const style = window.getComputedStyle;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        count += 1;
        return rect.call(this);
      };
      window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
        count += 1;
        return style(el, pseudo);
      }) as typeof getComputedStyle;
      const scroller = document.querySelector<HTMLElement>('#lg-scroll')!;
      for (let i = 0; i < 20; i += 1) {
        scroller.scrollTop += 30;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      Element.prototype.getBoundingClientRect = rect;
      window.getComputedStyle = style;
      return count;
    });
    expect(reads).toBe(0);
  });
});

test.describe('the content under the bar is out of focus in the screenshot', () => {
  const region = async (page: Page): Promise<Box> => {
    const bar = await boxOf(page, 'vire-nav > nav');
    return { x: bar.x, y: bar.y, w: bar.w, h: bar.h };
  };

  test('the text under the navigation bar keeps under three tenths of its sharpness, with the glass away', async ({ page }) => {
    const read = async (edge: string) => {
      await scene(page, 'nav-bar', 'text', edge);
      await hideBodies(page);
      await nextFrame(page);
      return sharpness(page, await region(page));
    };
    const off = await read('&edge=off');
    const on = await read('');
    expect(off).toBeGreaterThan(1);
    expect(on / off).toBeLessThan(0.3);
  });

  test('the glass shows it dissolved: through the body, with the ink taken away, the lines keep under a third of their sharpness', async ({ page }) => {
    const read = async (edge: string) => {
      await scene(page, 'nav-bar', 'text', edge);
      await page.addStyleTag({ content: 'vire-nav,vire-nav *{color:transparent!important;-webkit-text-fill-color:transparent!important}' });
      await nextFrame(page);
      return sharpness(page, await region(page));
    };
    const off = await read('&edge=off');
    const on = await read('');
    expect(on / off).toBeLessThan(0.34);
  });

  test('a ramp that runs the wrong way leaves it sharp, and the gate sees it', async ({ page }) => {
    await scene(page, 'nav-bar', 'text');
    await page.locator('vire-nav > [data-vk-edge]').evaluate((el) => el.removeAttribute('data-flip'));
    await hideBodies(page);
    await nextFrame(page);
    const wrong = await sharpness(page, await region(page));
    await scene(page, 'nav-bar', 'text', '&edge=off');
    await hideBodies(page);
    await nextFrame(page);
    const off = await sharpness(page, await region(page));
    expect(wrong / off).toBeGreaterThan(0.5);
  });
});

test.describe('a sheet', () => {
  const SURFACE = 'vire-sheet > [popover]';
  const open = async (page: Page, glass: string): Promise<void> => {
    await openCase(page, `atom=sheet&form=bottom-sheet&detent=medium&backdrop=photo&glass=${glass}`);
    await page.waitForFunction(() => document.querySelector('vire-sheet')?.getAttribute('data-phase') === 'open');
    await settleGlass(page, glass === '1');
  };

  test('has one under its top strip that sticks to the top of its content and is there once the content has scrolled', async ({ page }) => {
    await open(page, '1');
    const edge = page.locator(`${SURFACE} > [data-vk-edge]`);
    await expect(edge).toHaveCount(1);
    const info = () =>
      page.evaluate((surface) => {
        const el = document.querySelector<HTMLElement>(surface)!;
        const edge = el.querySelector<HTMLElement>(':scope > [data-vk-edge]')!;
        const grabber = el.querySelector<HTMLElement>(':scope > [data-vk-grabber]')!;
        const r = edge.getBoundingClientRect();
        return {
          position: getComputedStyle(edge).position,
          opacity: Number(getComputedStyle(edge).opacity),
          events: getComputedStyle(edge).pointerEvents,
          hidden: edge.getAttribute('aria-hidden'),
          behindGrabber: Boolean(edge.compareDocumentPosition(grabber) & Node.DOCUMENT_POSITION_PRECEDING),
          gap: r.top - el.getBoundingClientRect().top,
          height: r.height,
          grabber: grabber.getBoundingClientRect().height,
        };
      }, SURFACE);
    const rest = await info();
    expect(rest.position).toBe('sticky');
    expect(rest.opacity).toBe(0);
    expect(rest.events).toBe('none');
    expect(rest.hidden).toBe('true');
    expect(rest.behindGrabber, 'the grabber comes first, so it paints over the edge').toBe(true);
    await page.locator(SURFACE).evaluate((el) => (el.scrollTop = 120));
    await expect.poll(async () => (await info()).opacity).toBe(1);
    const scrolled = await info();
    expect(scrolled.gap).toBeCloseTo(0, 0);
    expect(scrolled.height).toBeCloseTo(scrollEdgeReachDp(rest.grabber), 0);
  });

  test('has none with glass off or with the attribute off', async ({ page }) => {
    await open(page, '0');
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(0);
    await open(page, '1');
    await page.locator('vire-sheet').evaluate((el) => el.setAttribute('scroll-edge', 'off'));
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(0);
    await page.locator('vire-sheet').evaluate((el) => el.removeAttribute('scroll-edge'));
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(1);
  });

  test('takes nothing from the measure of its content', async ({ page }) => {
    await open(page, '1');
    const height = () => page.locator(SURFACE).evaluate((el) => el.scrollHeight);
    const with_ = await height();
    await page.locator('vire-sheet').evaluate((el) => el.setAttribute('scroll-edge', 'off'));
    await expect(page.locator(`${SURFACE} > [data-vk-edge]`)).toHaveCount(0);
    expect(with_).toBe(await height());
  });
});

test('the page is a scroller too: the document scrolls under the bar and the edge follows it', async ({ page }) => {
  await openCase(page, 'view=nav&backdrop=photo&glass=1');
  await page.evaluate(() => window.__lab.nav!.scrollOnDocument());
  await expect(page.locator('vire-nav > [data-vk-edge]')).toHaveCount(1);
  const opacity = () => page.locator('vire-nav > [data-vk-edge]').evaluate((el) => Number(getComputedStyle(el).opacity));
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(opacity).toBe(1);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(opacity).toBe(0);
});

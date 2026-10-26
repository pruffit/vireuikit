import type { ConsoleMessage, Frame, Locator, Page, Request, Response } from '@playwright/test';

const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

export type PageLog = { lines: string[]; stop(): void };

/** What a page says while it is watched: console messages, page errors, failed or refused requests and navigations; the last `cap` lines. */
export function watchPage(page: Page, cap = 200): PageLog {
  const lines: string[] = [];
  const start = Date.now();
  let dropped = 0;
  const add = (line: string) => {
    lines.push(`+${String(Date.now() - start).padStart(5)} ms ${line}`);
    if (lines.length <= cap) return;
    lines.splice(0, lines.length - cap);
    dropped += 1;
    lines[0] = `(${dropped} earlier lines dropped)`;
  };
  const onConsole = (m: ConsoleMessage) => add(`console.${m.type()}: ${m.text()}`);
  const onError = (e: Error) => add(`pageerror: ${e.stack ?? e.message}`);
  const onFailed = (r: Request) => add(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`);
  const onResponse = (r: Response) => {
    if (r.status() >= 400) add(`response ${r.status()}: ${r.url()}`);
  };
  const onNavigated = (f: Frame) => {
    if (f === page.mainFrame()) add(`navigated: ${f.url()}`);
  };
  const onCrash = () => add('crash');
  page.on('console', onConsole);
  page.on('pageerror', onError);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);
  page.on('framenavigated', onNavigated);
  page.on('crash', onCrash);
  return {
    lines,
    stop() {
      page.off('console', onConsole);
      page.off('pageerror', onError);
      page.off('requestfailed', onFailed);
      page.off('response', onResponse);
      page.off('framenavigated', onNavigated);
      page.off('crash', onCrash);
    },
  };
}

/** Opens one lab case and waits until every control is upgraded and every lens it asked for is attached. */
export async function openCase(page: Page, query: string, path = '/'): Promise<void> {
  const log = watchPage(page);
  try {
    await bootCase(page, query, path);
  } catch (error) {
    const said = log.lines.length > 0 ? log.lines.join('\n') : '(nothing)';
    throw new Error(`openCase(${path}?${query}) failed: ${(error as Error).message}\nWhat the page said:\n${said}`, { cause: error });
  } finally {
    log.stop();
  }
}

/** How long a case may take to boot; a slow CI machine can raise it. */
const BOOT_MS = Number(process.env.VIREUIKIT_LAB_BOOT_MS ?? 30_000);

async function bootCase(page: Page, query: string, path: string): Promise<void> {
  await page.goto(`${path}?${/(^|&)chrome=/.test(query) ? '' : 'chrome=0&'}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', undefined, { timeout: BOOT_MS });
  await page.waitForFunction(() => {
    if (window.__lab && !window.__lab.upgraded) return true;
    return [...document.querySelectorAll<HTMLElement>('vire-button,vire-icon-button,vire-menu,vire-nav,vire-popover,vire-sheet')].every((host) => {
      if (!host.hasAttribute('data-vk')) return false;
      if (host.hasAttribute('data-carried')) return true;
      if (host.dataset.glass !== 'on' || host.localName === 'vire-popover' || host.localName === 'vire-sheet') return true;
      const lens = host.querySelector<HTMLElement>(
        host.localName === 'vire-menu' ? ':scope > [popover]' : host.localName === 'vire-nav' ? ':scope > nav' : 'button',
      );
      return /url\(|blur/.test(lens?.style.backdropFilter ?? '');
    });
  }, undefined, { timeout: BOOT_MS });
  await nextFrame(page);
}

export const press = (host: Locator) =>
  host.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--vk-press')));

/** Presses the button with a synthetic pointerdown and reads the press value one frame later: a
 *  spring has barely moved by then, an instant one is done. */
export const pressFirstFrame = (host: Locator) =>
  host.evaluate(
    (el) =>
      new Promise<number>((resolve) => {
        el.querySelector('button')!.dispatchEvent(
          new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' }),
        );
        requestAnimationFrame(() => resolve(Number(getComputedStyle(el).getPropertyValue('--vk-press'))));
      }),
  );

export const scaleOf = (button: Locator) =>
  button.evaluate((el) => {
    const m = getComputedStyle(el).transform;
    return m === 'none' ? 1 : Number(m.slice(7).split(',')[0]);
  });

export async function centerOf(locator: Locator): Promise<{ x: number; y: number; box: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>> }> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

export type MediaInput = { pointer: 'fine' | 'coarse'; anyCoarse: boolean; anyHover: boolean };

/**
 * Answers the input media queries the way a given device would, through the real `matchMedia` path, and lets a test
 * change them live (`window.__input.set`). Playwright's touch emulation turns every one of them coarse at once, so a
 * laptop with a touch screen (a fine primary pointer with touch present) cannot be emulated otherwise.
 */
export async function emulateInput(page: Page, input: MediaInput): Promise<void> {
  await page.addInitScript((init: MediaInput) => {
    const state = { ...init };
    const real = window.matchMedia.bind(window);
    const answers: Record<string, () => boolean> = {
      '(pointer: coarse)': () => state.pointer === 'coarse',
      '(pointer: fine)': () => state.pointer === 'fine',
      '(any-pointer: coarse)': () => state.pointer === 'coarse' || state.anyCoarse,
      '(any-pointer: fine)': () => state.pointer === 'fine',
      '(hover: hover)': () => state.pointer === 'fine' && state.anyHover,
      '(any-hover: hover)': () => state.anyHover,
    };
    const lists: { query: string; list: EventTarget }[] = [];
    class FakeList extends EventTarget {
      constructor(readonly media: string) {
        super();
      }
      get matches() {
        return answers[this.media]!();
      }
      onchange = null;
      addListener(cb: EventListener) {
        this.addEventListener('change', cb);
      }
      removeListener(cb: EventListener) {
        this.removeEventListener('change', cb);
      }
    }
    window.matchMedia = (query: string) => {
      if (!(query in answers)) return real(query);
      const list = new FakeList(query);
      lists.push({ query, list });
      return list as unknown as MediaQueryList;
    };
    (window as unknown as { __input: { set(next: Partial<MediaInput>): void } }).__input = {
      set(next) {
        Object.assign(state, next);
        for (const { list } of lists) list.dispatchEvent(new Event('change'));
      },
    };
  }, input);
}

/** Opens the adaptive stage with a viewport that holds its window. */
export async function openStage(page: Page, query: string, size?: { width: number; height: number }): Promise<void> {
  if (size) await page.setViewportSize({ width: Math.max(size.width + 24, 400), height: Math.max(size.height + 24, 400) });
  await openCase(page, `view=adaptive&${query}`);
  await page.waitForFunction(() => window.__adaptive?.ctx() !== null && window.__adaptive.settled());
  await nextFrame(page);
}

export { nextFrame };

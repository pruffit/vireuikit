import type { Locator, Page } from '@playwright/test';

const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

/** Opens one lab case and waits until every control is upgraded and every lens it asked for is attached. */
export async function openCase(page: Page, query: string, path = '/'): Promise<void> {
  await page.goto(`${path}?chrome=0&${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await page.waitForFunction(() => {
    if (window.__lab && !window.__lab.upgraded) return true;
    return [...document.querySelectorAll<HTMLElement>('vire-button,vire-icon-button,vire-menu')].every((host) => {
      if (!host.hasAttribute('data-vk')) return false;
      if (host.dataset.glass !== 'on') return true;
      const lens = host.querySelector<HTMLElement>(host.localName === 'vire-menu' ? ':scope > [popover]' : 'button');
      return /url\(|blur/.test(lens?.style.backdropFilter ?? '');
    });
  });
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

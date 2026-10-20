import type { Page } from '@playwright/test';
import { nextFrame } from './helpers';

export type Run = { kind: 'text' | 'glyph'; label: string; x: number; y: number; w: number; h: number; ink: number };

export type Legible = Run & {
  /** The ink against the median of what is behind it, WCAG contrast. */
  median: number;
  /** The ink against the part of what is behind it that is hardest on it: the darkest tenth under a dark ink, the lightest under a light one. */
  worst: number;
};

const MARK = 'data-lg-run';

/**
 * The text and glyphs an atom draws, with the ink each is painted in. Every owner is marked so `behindRuns` can take
 * the ink away and read what is left behind it.
 */
export function collectRuns(page: Page, tag: string): Promise<Run[]> {
  return page.evaluate(
    ({ tag, mark }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const channel = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const luminance = (css: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
      };
      const skip = '[data-vk-lens],[data-badge],[data-badge-label],[data-vk-probe],[data-vk-grabber],[hidden]';
      const runs: Run[] = [];
      const seen = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        }
        return true;
      };
      const push = (kind: Run['kind'], label: string, rect: DOMRect, owner: Element) => {
        if (rect.width < 8 || rect.height < 6 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return;
        owner.setAttribute(mark, String(runs.length));
        runs.push({ kind, label, x: rect.x, y: rect.y, w: rect.width, h: rect.height, ink: luminance(getComputedStyle(owner).color) });
      };
      for (const host of document.querySelectorAll(tag)) {
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim() ?? '';
          const owner = node.parentElement;
          if (!text || !owner || owner.closest(skip) || !seen(owner)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          push('text', text, range.getBoundingClientRect(), owner);
        }
        for (const glyph of host.querySelectorAll('svg')) {
          if (glyph.closest(skip) || !seen(glyph)) continue;
          push('glyph', glyph.parentElement?.getAttribute('aria-label') ?? glyph.parentElement?.textContent?.trim() ?? 'glyph', glyph.getBoundingClientRect(), glyph);
        }
      }
      return runs;
    },
    { tag, mark: MARK },
  );
}

/** Contrast of each run's ink against what is behind it: a screenshot taken with the ink made transparent, so only the glass and what shows through it are left. */
export async function behindRuns(page: Page, runs: Run[]): Promise<Legible[]> {
  await page.addStyleTag({ content: `[${MARK}]{color:transparent!important;-webkit-text-fill-color:transparent!important}` });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, runs }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const channel = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return runs.map((run) => {
        const x0 = Math.floor(run.x);
        const y0 = Math.floor(run.y);
        const area = ctx.getImageData(x0, y0, Math.ceil(run.x + run.w) - x0, Math.ceil(run.y + run.h) - y0);
        const behind: number[] = [];
        for (let i = 0; i < area.data.length; i += 4) {
          behind.push(0.2126 * channel(area.data[i]!) + 0.7152 * channel(area.data[i + 1]!) + 0.0722 * channel(area.data[i + 2]!));
        }
        behind.sort((a, b) => a - b);
        const median = behind[Math.floor(behind.length / 2)]!;
        const tenth = run.ink < median ? behind[Math.floor(behind.length * 0.1)]! : behind[Math.ceil(behind.length * 0.9) - 1]!;
        return { ...run, median: ratio(run.ink, median), worst: ratio(run.ink, tenth) };
      });
    },
    { png, runs },
  );
}

/** Waits until the lenses the case attached have painted: the elements carrying a backdrop filter stop changing in number. */
export async function settleGlass(page: Page, glass: boolean): Promise<void> {
  let last = -1;
  for (let i = 0; i < 40 && glass; i += 1) {
    const count = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('*')].filter((el) => /url\(|blur/.test(el.style.backdropFilter)).length);
    if (count > 0 && count === last) break;
    last = count;
    await page.waitForTimeout(150);
  }
  await nextFrame(page);
  await nextFrame(page);
}

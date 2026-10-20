import type { Page } from '@playwright/test';
import { nextFrame } from './helpers';

export type Run = {
  kind: 'text' | 'glyph';
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The ink as painted: the colour's channels, its alpha times the opacity of the run's element and its ancestors up to the atom. */
  rgb: [number, number, number];
  alpha: number;
};

export type Legible = Run & {
  /** Contrast of the ink against the median of what is behind it, WCAG. */
  median: number;
  /** Contrast against the hardest tenth of what is behind it: the lowest tenth of the per-pixel ratios. */
  worst: number;
};

const MARK = 'data-lg-run';

export function collectRuns(page: Page, tag: string): Promise<Run[]> {
  return page.evaluate(
    ({ tag, mark }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const parse = (css: string): { rgb: [number, number, number]; alpha: number } => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return { rgb: [r!, g!, b!], alpha: a! / 255 };
      };
      const skip = '[data-vk-lens],[data-badge],[data-badge-label],[data-vk-probe],[data-vk-grabber],[hidden]';
      const runs: Run[] = [];
      const seen = (el: Element, host: Element) => {
        let opacity = 1;
        for (let node: Element | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return 0;
          if (host.contains(node)) opacity *= Number(style.opacity);
        }
        return opacity;
      };
      const push = (kind: Run['kind'], label: string, rect: DOMRect, owner: Element, paint: string, opacity: number) => {
        if (rect.width < 8 || rect.height < 6 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return;
        owner.setAttribute(mark, '');
        const ink = parse(paint);
        runs.push({ kind, label, x: rect.x, y: rect.y, w: rect.width, h: rect.height, rgb: ink.rgb, alpha: ink.alpha * opacity });
      };
      for (const host of document.querySelectorAll(tag)) {
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim() ?? '';
          const owner = node.parentElement;
          if (!text || !owner || owner.closest(skip)) continue;
          const opacity = seen(owner, host);
          if (opacity === 0) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          push('text', text, range.getBoundingClientRect(), owner, getComputedStyle(owner).webkitTextFillColor, opacity);
        }
        for (const glyph of host.querySelectorAll('svg')) {
          if (glyph.closest(skip)) continue;
          const opacity = seen(glyph, host);
          if (opacity === 0) continue;
          const style = getComputedStyle(glyph);
          const label = glyph.parentElement?.getAttribute('aria-label') ?? glyph.parentElement?.textContent?.trim() ?? 'glyph';
          push('glyph', label, glyph.getBoundingClientRect(), glyph, style.stroke !== 'none' ? style.stroke : style.fill, opacity);
        }
      }
      return runs;
    },
    { tag, mark: MARK },
  );
}

/**
 * Contrast of each run's ink against what is behind it, from a screenshot with the ink made transparent and nothing else
 * touched: `color` stays, because the tint and the borders of some atoms are painted with it.
 */
export async function behindRuns(page: Page, runs: Run[]): Promise<Legible[]> {
  await page.addStyleTag({
    content: `[${MARK}],[${MARK}] *{-webkit-text-fill-color:transparent!important;text-shadow:none!important;fill:transparent!important;stroke:transparent!important}`,
  });
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
      const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return runs.map((run) => {
        const x0 = Math.floor(run.x);
        const y0 = Math.floor(run.y);
        const area = ctx.getImageData(x0, y0, Math.ceil(run.x + run.w) - x0, Math.ceil(run.y + run.h) - y0);
        const ratios: number[] = [];
        for (let i = 0; i < area.data.length; i += 4) {
          const [r, g, b] = [0, 1, 2].map((c) => run.alpha * run.rgb[c]! + (1 - run.alpha) * area.data[i + c]!) as [number, number, number];
          ratios.push(ratio(luminance(r, g, b), luminance(area.data[i]!, area.data[i + 1]!, area.data[i + 2]!)));
        }
        ratios.sort((a, b) => a - b);
        return { ...run, median: ratios[Math.floor(ratios.length / 2)]!, worst: ratios[Math.floor(ratios.length * 0.1)]! };
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

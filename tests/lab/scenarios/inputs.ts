import type { Locator, Page } from '@playwright/test';
import { sleep } from './capture';

export type Point = { x: number; y: number };

/** Walks the pointer from `from` to `to` at `speed` px/s with a move about every 8 ms, the way a hand does, never a teleport. */
export async function walk(page: Page, from: Point, to: Point, speed = 600): Promise<void> {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = (distance / speed) * 1000;
  const start = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - start) / duration);
    await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    if (k >= 1) return;
    await sleep(8);
  }
}

export async function centerOf(target: Locator): Promise<Point> {
  const b = (await target.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Drags from `from` through `via` points, holding the button, at `speed` px/s. */
export async function drag(page: Page, from: Point, via: Point[], speed = 600): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  let at = from;
  for (const p of via) {
    await walk(page, at, p, speed);
    at = p;
  }
  await page.mouse.up();
}

/** A press as a finger gives it: down, about 80 ms, up. */
export async function tap(page: Page, at: Point, hold = 80): Promise<void> {
  await walk(page, { x: at.x + 40, y: at.y + 30 }, at, 800);
  await page.mouse.down();
  await sleep(hold);
  await page.mouse.up();
}

export async function wheelScroll(page: Page, at: Point, total: number, speed = 900): Promise<void> {
  await page.mouse.move(at.x, at.y);
  const steps = Math.ceil((Math.abs(total) / speed) * 60);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, total / steps);
    await sleep(16);
  }
}

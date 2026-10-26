import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';

export type Project = 'gpu' | 'swiftshader';
export type Adapter = { renderer: string; devices: string[]; compositing: string; software: boolean };

/** What the browser renders with, from the GPU process itself: the adapter, and whether the compositor runs on it. */
export async function adapterOf(browser: Browser): Promise<Adapter> {
  const session = await browser.newBrowserCDPSession();
  try {
    const info = await session.send('SystemInfo.getInfo');
    const renderer = String((info.gpu.auxAttributes as Record<string, unknown>)['glRenderer'] ?? '');
    const compositing = String((info.gpu.featureStatus as Record<string, unknown>)['gpu_compositing'] ?? '');
    const software = /swiftshader|software|basic render/i.test(renderer) || compositing !== 'enabled';
    return { renderer, devices: info.gpu.devices.map((d) => d.deviceString), compositing, software };
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/** The `gpu` project must be on a hardware adapter and `swiftshader` on the software one; a run on the wrong one would judge nothing it claims to. */
export async function assertAdapter(browser: Browser, project: Project, dir: string): Promise<Adapter> {
  const adapter = await adapterOf(browser);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'adapter.txt'), `${project}: ${adapter.renderer}\ngpu_compositing: ${adapter.compositing}\ndevices: ${adapter.devices.join(' | ')}\n`);
  if (project === 'gpu' && adapter.software) throw new Error(`the gpu project rendered with a software adapter: ${adapter.renderer} (gpu_compositing ${adapter.compositing})`);
  if (project === 'swiftshader' && !adapter.software) throw new Error(`the swiftshader project rendered on hardware: ${adapter.renderer}`);
  return adapter;
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import type { Recording } from './capture';
import { pad, union, type Rect } from './color';
import type { GateResult } from './gates';

export const OUT_DIR = process.env.VIREUIKIT_SCENARIOS_OUT ?? join(process.cwd(), 'lab-scenarios');

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const PAGE_WIDTH = 1448;
const MAX_HEIGHT = 15000;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The part of the page worth looking at: every tracked box that was ever drawn, with room around it. */
export function viewOf(rec: Recording, keys: string[]): Rect {
  const boxes: Rect[] = [];
  for (const sample of rec.samples) for (const key of keys) for (const b of sample.boxes[key] ?? []) if (!b.hidden) boxes.push(b);
  const whole = { x: 0, y: 0, w: rec.viewport.width, h: rec.viewport.height };
  const u = union(boxes);
  if (!u) return whole;
  const p = pad(u, 28);
  const x = Math.max(0, p.x);
  const y = Math.max(0, p.y);
  return { x, y, w: Math.min(whole.w - x, p.w), h: Math.min(whole.h - y, p.h) };
}

/** Every presented frame in a grid, labelled in ms from the input; the frame in which the last motion ended is blue, a frame a gate points at is red. */
export async function contactSheet(page: Page, rec: Recording, results: GateResult[], view: Rect, file: string): Promise<void> {
  const flags = new Map<number, string[]>();
  for (const r of results) for (const i of r.flagged) flags.set(i, [...(flags.get(i) ?? []), r.gate]);
  const endFrames = new Set(
    rec.motion.map((m) => {
      const i = rec.shots.findIndex((s) => s.t >= m.end);
      return i < 0 ? rec.shots.length - 1 : i;
    }),
  );
  const startFrames = new Set(rec.motion.map((m) => rec.shots.findIndex((s) => s.t >= m.start)));
  const cellW = Math.round(Math.min(view.w, view.h > view.w * 1.4 ? 200 : view.h < view.w * 0.4 ? 300 : 168));
  const scale = cellW / view.w;
  const cellH = Math.round(view.h * scale);
  const cols = Math.floor(PAGE_WIDTH / (cellW + 10));
  const maxCells = cols * Math.floor(MAX_HEIGHT / (cellH + 26));
  const keep = new Set<number>();
  const dir = join(file, '..');
  mkdirSync(join(dir, 'frames'), { recursive: true });
  const every = Math.max(1, Math.ceil(rec.shots.length / maxCells));
  rec.shots.forEach((_, i) => {
    if (i % every === 0 || flags.has(i) || endFrames.has(i)) keep.add(i);
  });
  const full = { w: rec.viewport.width * scale, h: rec.viewport.height * scale };
  const cells = [...keep]
    .map((i) => {
      const shot = rec.shots[i]!;
      const rel = Math.round(shot.t - rec.input);
      const tags = [endFrames.has(i) ? 'motion ends' : '', startFrames.has(i) ? 'motion starts' : '', ...(flags.get(i) ?? [])].filter(Boolean);
      const cls = flags.has(i) ? 'bad' : endFrames.has(i) ? 'end' : startFrames.has(i) ? 'start' : '';
      return `<figure class="${cls}"><div class="cell" style="width:${cellW}px;height:${cellH}px"><img style="width:${full.w}px;left:${-view.x * scale}px;top:${-view.y * scale}px" src="frames/${String(i).padStart(3, '0')}.png"></div><figcaption>${rel >= 0 ? '+' : ''}${rel} ms${tags.length ? `<b>${escapeHtml(tags.join(', '))}</b>` : ''}</figcaption></figure>`;
    })
    .join('');
  const head = results.map((r) => `<span class="${r.verdict}">${r.gate} ${r.verdict}: ${escapeHtml(r.line)}</span>`).join('');
  const gaps = rec.shots.map((s, i) => (i ? s.t - rec.shots[i - 1]!.t : 0));
  for (const i of keep) writeFileSync(join(dir, 'frames', `${String(i).padStart(3, '0')}.png`), rec.shots[i]!.png);
  await page.setViewportSize({ width: PAGE_WIDTH + 24, height: 600 });
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:12px;font:12px system-ui;background:#fff;color:#111}
h1{font-size:15px;margin:0 0 4px}
.meta{margin:0 0 8px;color:#555}
.gates span{display:block;margin:1px 0}.gates .fail{color:#b00020}.gates .pass{color:#146c2e}.gates .skip{color:#777}
.grid{display:flex;flex-wrap:wrap;gap:6px 6px;margin-top:8px}
figure{margin:0;border:2px solid #ddd;background:#eee}figure.end{border-color:#0a64ff}figure.start{border-color:#999}figure.bad{border-color:#d00}
.cell{position:relative;overflow:hidden}.cell img{position:absolute;max-width:none}
figcaption{font:10px/1.25 ui-monospace,monospace;padding:1px 3px;background:#fff;max-width:${cellW}px}figcaption b{display:block;color:#d00;font-weight:600}figure.end figcaption b{color:#0a64ff}
</style><h1>${escapeHtml(rec.name)}</h1>
<p class="meta">${rec.shots.length} frames, longest gap ${Math.round(Math.max(0, ...gaps))} ms; motion ${rec.motion.map((m) => `${Math.round(m.start - rec.input)}..${Math.round(m.end - rec.input)} ms`).join(', ') || 'none'}; ${keep.size === rec.shots.length ? 'all frames shown' : `${keep.size} of ${rec.shots.length} frames shown`}</p>
<div class="gates">${head}</div><div class="grid">${cells}</div>`;
  writeFileSync(join(dir, 'sheet.html'), html);
  await page.goto(pathToFileURL(join(dir, 'sheet.html')).href);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await page.screenshot({ path: file, fullPage: true });
}

export function writeMetrics(dir: string, rec: Recording, results: GateResult[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'samples.json'), JSON.stringify(rec.samples.map((s) => ({ t: Math.round((s.t - rec.input) * 10) / 10, boxes: Object.fromEntries(Object.entries(s.boxes).map(([k, v]) => [k, v.map((b) => [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.w * 10) / 10, Math.round(b.h * 10) / 10, Math.round(b.r * 10) / 10, b.hidden ? 1 : 0])])) }))));
  const rel = (t: number) => Math.round((t - rec.input) * 10) / 10;
  writeFileSync(
    join(dir, 'metrics.json'),
    JSON.stringify(
      {
        name: rec.name,
        viewport: rec.viewport,
        frames: rec.shots.map((s, i) => ({ i, at: rel(s.t), gap: i ? Math.round((s.t - rec.shots[i - 1]!.t) * 10) / 10 : 0 })),
        motion: rec.motion.map((m) => ({ start: rel(m.start), end: rel(m.end) })),
        marks: Object.fromEntries(Object.entries(rec.marks).map(([k, v]) => [k, rel(v)])),
        pageErrors: rec.pageErrors,
        gates: results,
      },
      null,
      1,
    ),
  );
}

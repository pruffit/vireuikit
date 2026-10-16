import { readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { REFERENCE_CONTROLS } from '../../lab/reference-controls';
import { openCase } from './helpers';
import type { Footprint } from '../../lab/footprint';
import { measureImage, type Measure } from './measure';

// A development aid, not a gate: it needs the uncommitted frames (`playwright test reference`).
const DIR = process.env.VIREUIKIT_REFERENCE_DIR;
const DPR = 3;

// The shots and the numbers hold third-party pixels or derive from them: they go outside the repository or nowhere.
function outsideRepo(path: string | undefined): string | null {
  if (!path) return null;
  const rel = relative(process.cwd(), resolve(path));
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new Error(`refusing to write inside the repository: ${path}`);
  }
  return resolve(path);
}
const SHOTS = outsideRepo(process.env.VIREUIKIT_MEASURE_SHOTS);
const OUT = outsideRepo(process.env.VIREUIKIT_MEASURE_OUT);

test.skip(!DIR, 'VIREUIKIT_REFERENCE_DIR is not set');
test.use({ deviceScaleFactor: DPR });

const FIELDS = ['bodyL', 'bodyC', 'surroundL', 'surroundC', 'dL', 'dC', 'dAB', 'rimPeak', 'rimMin', 'rimOverSurround'] as const;

test('reference against ours, control by control', async ({ page }) => {
  test.setTimeout(240_000);
  const rows: { id: string; at: string; atom: string; reference: Measure; ours: Measure }[] = [];
  for (const control of REFERENCE_CONTROLS) {
    const file = join(DIR!, control.file);
    const mime = extname(file).toLowerCase() === '.png' ? 'png' : 'jpeg';
    await page.goto('about:blank');
    const reference = await measureImage(page, readFileSync(file), mime, control);

    const rt = control.mode === 'reduce-transparency' ? '&rt=1' : '';
    await openCase(page, `view=reference&ref=${control.id}&glass=1${rt}`);
    const stage = page.locator('#stage');
    const box = (await stage.boundingBox())!;
    const body = (await page.locator('vire-button button, vire-icon-button button').boundingBox())!;
    const circle = control.atom === 'iconButton';
    const at: Footprint = {
      cx: (body.x - box.x + body.width / 2) * DPR,
      cy: (body.y - box.y + body.height / 2) * DPR,
      hw: (body.width / 2) * DPR,
      hh: (body.height / 2) * DPR,
    };
    if (circle) at.hw = at.hh;
    const shot = await stage.screenshot();
    if (SHOTS) writeFileSync(join(SHOTS, `${control.id}${rt ? '-rt' : ''}.png`), shot);
    const ours = await measureImage(page, shot, 'png', at);
    rows.push({ id: control.id, at: control.at, atom: control.atom, reference, ours });
  }
  const f = (v: number) => v.toFixed(3).padStart(8);
  const lines = [['control'.padEnd(18), ...FIELDS.map((k) => k.padStart(8))].join('')];
  for (const r of rows) {
    lines.push([`${r.id} ref`.padEnd(18), ...FIELDS.map((k) => f(r.reference[k]))].join(''));
    lines.push([`${r.id} ours`.padEnd(18), ...FIELDS.map((k) => f(r.ours[k]))].join(''));
  }
  console.log(lines.join('\n'));
  if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1));
  expect(rows.length).toBe(REFERENCE_CONTROLS.length);
});

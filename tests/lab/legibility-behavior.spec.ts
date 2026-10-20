import { expect, test, type Page } from '@playwright/test';
import { openCase } from './helpers';
import { behindRuns, collectRuns, settleGlass, type Legible, type Run } from './legibility';

const TEXT = 4.5;
const GLYPH = 3;

// How many labels and glyphs each scene draws: a scene that lost some is not measuring what it says.
type Atom = { atom: string; tag: string; text: number; glyph: number };
const ATOMS: Atom[] = [
  { atom: 'nav-bar', tag: 'vire-nav', text: 6, glyph: 6 },
  { atom: 'nav-rail', tag: 'vire-nav', text: 5, glyph: 6 },
  { atom: 'nav-sidebar', tag: 'vire-nav', text: 7, glyph: 8 },
  { atom: 'toolbar-bottom', tag: 'vire-toolbar', text: 1, glyph: 6 },
  { atom: 'toolbar-top', tag: 'vire-toolbar', text: 1, glyph: 6 },
  { atom: 'menu', tag: 'vire-menu', text: 4, glyph: 4 },
  { atom: 'popover', tag: 'vire-popover > [popover]', text: 5, glyph: 0 },
  { atom: 'button', tag: 'vire-button', text: 3, glyph: 0 },
  { atom: 'icon-button', tag: 'vire-icon-button', text: 0, glyph: 3 },
];
const COUNTS = new Map(ATOMS.map((a) => [a.atom, a]));

// What falls short with glass on, measured. The text's hardest tenth is the only reading that does, and it is pinned to a
// range: a broken scene or another failure is red, and so is one that starts to pass.
const RAIL = 'The rail has no scroll edge, and the core reads the lines under it as calm (busy 0) and raises no ground for them (pruffit/vireglass#31).';
const FLOATING = 'A button floating over body text has no scroll edge, and the core raises no ground for it either (pruffit/vireglass#31).';
const KNOWN: Record<string, { why: string; worst: [number, number] }> = {
  'nav-rail|text|on': { why: RAIL, worst: [3.5, 4.4] },
  'nav-rail|photo|on': { why: RAIL, worst: [2.6, 3.6] },
  'button|text|on': { why: FLOATING, worst: [3.5, 4.4] },
  'button|photo|on': { why: FLOATING, worst: [2.6, 3.6] },
};

test.use({ viewport: { width: 1700, height: 1000 } });

async function measure(page: Page, atom: string, backdrop: string, glass: boolean, edge?: string): Promise<Legible[]> {
  await openCase(page, `view=legibility&lg=${atom}&backdrop=${backdrop}&glass=${glass ? 1 : 0}${edge ? `&edge=${edge}` : ''}`);
  await settleGlass(page, glass);
  const runs = await collectRuns(page, COUNTS.get(atom)!.tag);
  expectRuns(runs, atom);
  return behindRuns(page, runs);
}

function expectRuns(runs: Run[], atom: string): void {
  const want = COUNTS.get(atom)!;
  expect(runs.filter((run) => run.kind === 'text'), `${atom}'s labels`).toHaveLength(want.text);
  expect(runs.filter((run) => run.kind === 'glyph'), `${atom}'s glyphs`).toHaveLength(want.glyph);
}

const least = (runs: Legible[], kind: Legible['kind'], reading: 'median' | 'worst') =>
  Math.min(...runs.filter((run) => run.kind === kind).map((run) => run[reading]));

test.describe('every glass atom stays legible over body text and a photo', () => {
  for (const { atom } of ATOMS) {
    for (const backdrop of ['text', 'photo']) {
      for (const glass of [true, false]) {
        test(`${atom} on ${backdrop}, glass ${glass ? 'on' : 'off'}`, async ({ page }) => {
          const known = KNOWN[`${atom}|${backdrop}|${glass ? 'on' : 'off'}`];
          const runs = await measure(page, atom, backdrop, glass);
          if (known) {
            const [low, high] = known.worst;
            const worst = least(runs, 'text', 'worst');
            expect(worst, `${known.why} Text against the hardest tenth`).toBeGreaterThan(low);
            expect(worst, `${known.why} Text against the hardest tenth`).toBeLessThan(high);
            expect(least(runs, 'text', 'median'), 'text against the median').toBeGreaterThanOrEqual(TEXT);
            expect(least(runs, 'glyph', 'median'), 'glyphs against the median').toBeGreaterThanOrEqual(GLYPH);
            expect(least(runs, 'glyph', 'worst'), 'glyphs against the hardest tenth').toBeGreaterThanOrEqual(GLYPH);
            return;
          }
          for (const run of runs) {
            const need = run.kind === 'text' ? TEXT : GLYPH;
            expect(run.median, `${run.kind} "${run.label}" against the median behind it`).toBeGreaterThanOrEqual(need);
            expect(run.worst, `${run.kind} "${run.label}" against the hardest tenth behind it`).toBeGreaterThanOrEqual(need);
          }
        });
      }
    }
  }
});

test.describe('the gate can fail', () => {
  for (const backdrop of ['text', 'photo']) {
    test(`with the scroll edge off the navigation bar fails it on ${backdrop}, and the edge is what lifts it`, async ({ page }) => {
      const off = await measure(page, 'nav-bar', backdrop, true, 'off');
      expect(least(off, 'text', 'worst'), 'text without the edge').toBeLessThan(TEXT);
      const on = await measure(page, 'nav-bar', backdrop, true);
      expect(least(on, 'text', 'worst'), 'text with the edge').toBeGreaterThanOrEqual(TEXT);
      expect(least(on, 'text', 'worst') - least(off, 'text', 'worst')).toBeGreaterThan(1.5);
    });
  }

  for (const atom of ['toolbar-top', 'toolbar-bottom']) {
    test(`with the scroll edge off the ${atom} fails it on the photo, and the edge is what lifts it`, async ({ page }) => {
      const off = await measure(page, atom, 'photo', true, 'off');
      expect(least(off, 'text', 'worst'), 'text without the edge').toBeLessThan(TEXT);
      const on = await measure(page, atom, 'photo', true);
      expect(least(on, 'text', 'worst'), 'text with the edge').toBeGreaterThanOrEqual(TEXT);
      expect(least(on, 'text', 'worst') - least(off, 'text', 'worst')).toBeGreaterThan(0.5);
    });
  }

  test('an ink that is not the glass\'s fails it: the toolbar with its ink forced to the page\'s', async ({ page }) => {
    await openCase(page, 'view=legibility&lg=toolbar-top&backdrop=text&glass=1');
    await settleGlass(page, true);
    await page.addStyleTag({ content: 'vire-toolbar{color:#fbfbf8!important}' });
    const collected = await collectRuns(page, 'vire-toolbar');
    expectRuns(collected, 'toolbar-top');
    expect(least(await behindRuns(page, collected), 'glyph', 'median')).toBeLessThan(GLYPH);
  });
});

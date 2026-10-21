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
          const runs = await measure(page, atom, backdrop, glass);
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
    test(`the scroll edge still lifts the navigation bar's text on ${backdrop}`, async ({ page }) => {
      const off = await measure(page, 'nav-bar', backdrop, true, 'off');
      const on = await measure(page, 'nav-bar', backdrop, true);
      expect(least(on, 'text', 'worst') - least(off, 'text', 'worst')).toBeGreaterThan(0.3);
    });
  }

  for (const atom of ['toolbar-top', 'toolbar-bottom']) {
    test(`the scroll edge still lifts the ${atom}'s text on the photo`, async ({ page }) => {
      const off = await measure(page, atom, 'photo', true, 'off');
      const on = await measure(page, atom, 'photo', true);
      expect(least(on, 'text', 'worst') - least(off, 'text', 'worst')).toBeGreaterThan(0.3);
    });
  }

  test("an ink that is not the glass's fails it: the toolbar with its ink forced to the page's", async ({ page }) => {
    await openCase(page, 'view=legibility&lg=toolbar-top&backdrop=text&glass=1');
    await settleGlass(page, true);
    await page.addStyleTag({ content: 'vire-toolbar{color:#fbfbf8!important}' });
    const collected = await collectRuns(page, 'vire-toolbar');
    expectRuns(collected, 'toolbar-top');
    const behind = await behindRuns(page, collected);
    expect(least(behind, 'glyph', 'median')).toBeLessThan(GLYPH);
  });
});

import { expect, test, type Page } from '@playwright/test';
import { openCase } from './helpers';
import { behindRuns, collectRuns, settleGlass, type Legible } from './legibility';

// Every glass atom is rendered over a scroller full of body text, with the text scrolled under it, on the text page and on
// the photo, glass on and off. What the atom writes (its text 4.5:1, its glyphs 3:1) is measured against what is behind it
// in a screenshot taken with the atom's own ink made transparent: the ink is the computed colour, and what is behind is the
// glass with whatever shows through it. Two readings per run: the median of what is behind (the sheet gate's), and the
// tenth of it that is hardest on the ink, which is where a line of text showing through the glass lands.
const TEXT = 4.5;
const GLYPH = 3;

type Atom = { atom: string; tag: string };
const ATOMS: Atom[] = [
  { atom: 'nav-bar', tag: 'vire-nav' },
  { atom: 'nav-rail', tag: 'vire-nav' },
  { atom: 'nav-sidebar', tag: 'vire-nav' },
  { atom: 'toolbar-bottom', tag: 'vire-toolbar' },
  { atom: 'toolbar-top', tag: 'vire-toolbar' },
  { atom: 'menu', tag: 'vire-menu' },
  { atom: 'popover', tag: 'vire-popover > [popover]' },
  { atom: 'button', tag: 'vire-button' },
  { atom: 'icon-button', tag: 'vire-icon-button' },
];

// What fails today, measured, and why. A case listed here is expected to fail: the gate turns red when one starts to pass,
// so the list shrinks when the cause is fixed.
const RAIL = 'The rail has no scroll edge (reference §10 is about top and bottom bars), so body text under it reaches the labels through the glass.';
const FLOATING = 'A button floating over body text has no scroll edge to dissolve it and the control material shows the lines through.';
const PLAIN = 'Glass off draws a button as a 10% tint of the page ink with no body, so it reads as well as the page does behind it.';
const KNOWN: Record<string, string> = {
  'nav-rail|text|on': RAIL,
  'nav-rail|photo|on': RAIL,
  'button|text|on': FLOATING,
  'button|photo|on': FLOATING,
  'button|text|off': PLAIN,
  'button|photo|off': PLAIN,
  'icon-button|text|off': PLAIN,
  'icon-button|photo|off': PLAIN,
};

test.use({ viewport: { width: 1700, height: 1000 } });

async function measure(page: Page, tag: string, atom: string, backdrop: string, glass: boolean, edge?: string): Promise<Legible[]> {
  await openCase(page, `view=legibility&lg=${atom}&backdrop=${backdrop}&glass=${glass ? 1 : 0}${edge ? `&edge=${edge}` : ''}`);
  await settleGlass(page, glass);
  const runs = await collectRuns(page, tag);
  expect(runs.length, `${atom} draws text or glyphs`).toBeGreaterThan(0);
  return behindRuns(page, runs);
}

const least = (runs: Legible[], kind: Legible['kind'], reading: 'median' | 'worst') =>
  Math.min(...runs.filter((run) => run.kind === kind).map((run) => run[reading]));

test.describe('every glass atom stays legible over body text and a photo', () => {
  for (const { atom, tag } of ATOMS) {
    for (const backdrop of ['text', 'photo']) {
      for (const glass of [true, false]) {
        test(`${atom} on ${backdrop}, glass ${glass ? 'on' : 'off'}`, async ({ page }) => {
          const known = KNOWN[`${atom}|${backdrop}|${glass ? 'on' : 'off'}`];
          test.fail(known !== undefined, known);
          const runs = await measure(page, tag, atom, backdrop, glass);
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
      const off = await measure(page, 'vire-nav', 'nav-bar', backdrop, true, 'off');
      expect(least(off, 'text', 'worst'), 'text without the edge').toBeLessThan(TEXT);
      const on = await measure(page, 'vire-nav', 'nav-bar', backdrop, true);
      expect(least(on, 'text', 'worst'), 'text with the edge').toBeGreaterThanOrEqual(TEXT);
      expect(least(on, 'text', 'worst') - least(off, 'text', 'worst')).toBeGreaterThan(1.5);
    });
  }

  test('an ink that is not the glass\'s fails it: the toolbar with its ink forced to the page\'s', async ({ page }) => {
    await openCase(page, 'view=legibility&lg=toolbar-top&backdrop=text&glass=1');
    await settleGlass(page, true);
    await page.addStyleTag({ content: 'vire-toolbar{color:#fbfbf8!important}' });
    const runs = await behindRuns(page, await collectRuns(page, 'vire-toolbar'));
    expect(least(runs, 'glyph', 'median')).toBeLessThan(GLYPH);
  });
});

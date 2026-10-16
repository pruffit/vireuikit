import { expect, test, type Locator, type Page } from '@playwright/test';
import { centerOf, openCase, press, pressFirstFrame, scaleOf } from './helpers';
import type { Footprint } from '../../lab/footprint';
import { atomRimOpacity } from '../../src/kit/atom';
import { measureImage, type Measure } from './measure';

const log = (page: Page) =>
  page.locator('#log').evaluate((el) => (el.textContent ?? '').split('\n').filter(Boolean));

const ATOMS = [
  { name: 'button', id: '#play', off: '#off', click: 'click:play' },
  { name: 'icon button', id: '#share', off: '#share-off', click: 'click:share' },
] as const;

test.describe('before the upgrade', () => {
  test('the native buttons work with no element defined', async ({ page }) => {
    await openCase(page, 'view=sandbox&upgrade=0&glass=0');
    await expect(page.locator('[data-vk]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Send' }).click();
    expect(await log(page)).toEqual(['click:play', 'submit']);
    await expect(page.getByRole('button', { name: 'Off' })).toBeDisabled();
  });

  test('a button that already has keyboard focus shows the ring as it upgrades', async ({ page }) => {
    await openCase(page, 'view=sandbox&upgrade=0&glass=0');
    await page.keyboard.press('Tab');
    await expect(page.locator('#play button')).toBeFocused();
    await page.evaluate(() => window.__lab.define());
    await expect(page.locator('#play')).toHaveAttribute('data-focus', '');
  });
});

test.describe('upgrade while the page is parsed', () => {
  test('elements defined before the markup adopt the one native button', async ({ page }) => {
    await openCase(page, '', '/early.html');
    await expect(page.locator('#early-play')).toHaveAttribute('data-vk', '');
    await expect(page.locator('#early-share')).toHaveAttribute('data-vk', '');
    await expect(page.locator('vire-button button')).toHaveCount(1);
    await expect(page.locator('vire-icon-button button')).toHaveCount(1);
    await expect(page.getByRole('button')).toHaveCount(2);
    await page.getByRole('button', { name: 'Play' }).click();
    expect(await log(page)).toEqual(['click:early-play']);
  });

  test('glass is opt-in: with no glass attribute there is no lens', async ({ page }) => {
    await openCase(page, '', '/early.html');
    for (const id of ['#early-play', '#early-share']) {
      await expect(page.locator(id)).toHaveAttribute('data-glass', 'off');
      await expect(page.locator(id)).toHaveAttribute('data-surface', 'plain');
      expect(await page.locator(id + ' button').evaluate((el) => el.style.backdropFilter)).toBe('');
    }
  });

  test('without a pointer-coarse match the default size is a pointer tier', async ({ page }) => {
    await openCase(page, '', '/early.html');
    await expect(page.locator('#early-play')).toHaveAttribute('data-size', 'medium');
  });
});

test.describe('strict CSP', () => {
  test('the injected stylesheet carries the nonce given to defineVireElements', async ({ page }) => {
    await openCase(page, 'view=sandbox&nonce=abc123');
    expect(await page.evaluate(() => document.querySelector<HTMLStyleElement>('style[data-vireuikit]')?.nonce)).toBe(
      'abc123',
    );
  });
});

test.describe('roles and keyboard', () => {
  test('both atoms are buttons with a name, and activate by Enter and Space', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(page.locator('#share').getByRole('button', { name: 'Share' })).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    expect(await log(page)).toEqual(['click:play', 'click:share']);
  });

  test('keyboard focus shows the ring, a click does not', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    const play = page.locator('#play');
    await page.keyboard.press('Tab');
    await expect(play).toHaveAttribute('data-focus', '');
    await page.keyboard.press('Tab');
    await expect(play).not.toHaveAttribute('data-focus', '');
    await page.locator('#send button').click();
    await expect(page.locator('#send')).not.toHaveAttribute('data-focus', '');
  });

  test('a key press does not stick when focus moves away, and the next press works', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    const play = page.locator('#play');
    await page.keyboard.press('Tab');
    await page.keyboard.down('Space');
    await expect(play).toHaveAttribute('data-pressed', '');
    await page.locator('#send button').focus();
    await expect(play).not.toHaveAttribute('data-pressed', '');
    await page.keyboard.up('Space');
    await page.locator('#play button').focus();
    await page.keyboard.press('Enter');
    await expect(play).not.toHaveAttribute('data-pressed', '');
    expect(await log(page)).toContain('click:play');
  });

  test('a click still submits the form it sits in, through the glass', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    await page.locator('#send button').click();
    expect(await log(page)).toEqual(['submit']);
  });
});

for (const atom of ATOMS) {
  test.describe(`${atom.name}: press, hover, disabled`, () => {
    test('a disabled control cannot be activated', async ({ page }) => {
      await openCase(page, 'view=sandbox');
      const off = page.locator(atom.off);
      await expect(off.locator('button')).toBeDisabled();
      await expect(off).toHaveAttribute('data-disabled', '');
      await off.locator('button').click({ force: true });
      expect(await log(page)).toEqual([]);
    });

    test('the pointer leaving cancels the press and the release does not click', async ({ page }) => {
      await openCase(page, 'view=sandbox');
      const host = page.locator(atom.id);
      const { x, y, box } = await centerOf(host.locator('button'));
      await page.mouse.move(x, y);
      await page.mouse.down();
      await expect(host).toHaveAttribute('data-pressed', '');
      await page.mouse.move(x, box.y + box.height + 60, { steps: 4 });
      await expect(host).not.toHaveAttribute('data-pressed', '');
      await page.mouse.up();
      expect(await log(page)).toEqual([]);
    });

    test('after a release outside, keyboard and scripted clicks still fire', async ({ page }) => {
      await openCase(page, 'view=sandbox');
      const host = page.locator(atom.id);
      const { x, y, box } = await centerOf(host.locator('button'));
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, box.y + box.height + 60, { steps: 4 });
      await page.mouse.up();
      expect(await log(page)).toEqual([]);
      await page.keyboard.press('Enter');
      await host.locator('button').evaluate((el: HTMLButtonElement) => el.click());
      expect(await log(page)).toEqual([atom.click, atom.click]);
    });

    test('a release outside followed by a real click on it still clicks', async ({ page }) => {
      await openCase(page, 'view=sandbox');
      const host = page.locator(atom.id);
      const { x, y, box } = await centerOf(host.locator('button'));
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, box.y + box.height + 60, { steps: 4 });
      await page.mouse.up();
      await host.locator('button').click();
      expect(await log(page)).toEqual([atom.click]);
    });

    test('hover comes with the cursor and goes with it', async ({ page }) => {
      await openCase(page, 'view=sandbox');
      const host = page.locator(atom.id);
      await host.locator('button').hover();
      await expect(host).toHaveAttribute('data-hovered', '');
      await page.mouse.move(5, 5);
      await expect(host).not.toHaveAttribute('data-hovered', '');
    });
  });
}

test.describe('press response', () => {
  test('the lifted icon button responds while the finger is down, not after release', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    const share = page.locator('#share');
    const button = share.locator('button');
    const rest = await button.screenshot();
    expect(await scaleOf(button)).toBe(1);

    const { x, y } = await centerOf(button);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect.poll(() => press(share)).toBeGreaterThan(0.9);
    await expect(share).toHaveAttribute('data-pressed', '');
    expect(await scaleOf(button)).toBeGreaterThan(1.1);
    await expect.poll(async () => (await button.screenshot()).equals(rest)).toBe(false);
    expect(await log(page)).toEqual([]);

    await page.mouse.up();
    await expect(share).not.toHaveAttribute('data-pressed', '');
    expect(await log(page)).toEqual(['click:share']);
    await expect.poll(() => press(share)).toBeLessThan(0.01);
  });

  test('the labeled button grows by about six percent and sinks rather than lifts', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    const play = page.locator('#play');
    const button = play.locator('button');
    const { x, y } = await centerOf(button);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect.poll(() => press(play)).toBeGreaterThan(0.98);
    await expect.poll(() => scaleOf(button)).toBeGreaterThan(1.055);
    expect(await scaleOf(button)).toBeLessThan(1.07);
    await page.mouse.up();
  });
});

test.describe('glass and its absence', () => {
  test('glass on attaches a lens, and the control keeps working', async ({ page }) => {
    await openCase(page, 'view=sandbox&glass=1');
    const button = page.locator('#play button');
    await expect(page.locator('#play')).toHaveAttribute('data-glass', 'on');
    expect(await button.evaluate((el) => el.style.backdropFilter)).toContain('url(');
    await button.click();
    expect(await log(page)).toEqual(['click:play']);
  });

  test('glass off leaves a complete, clickable, named control', async ({ page }) => {
    await openCase(page, 'view=sandbox&glass=0');
    const button = page.locator('#play button');
    await expect(page.locator('#play')).toHaveAttribute('data-glass', 'off');
    await expect(page.locator('#play')).toHaveAttribute('data-surface', 'plain');
    expect(await button.evaluate((el) => el.style.backdropFilter)).toBe('');
    expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await page.getByRole('button', { name: 'Play' }).click();
    expect(await log(page)).toEqual(['click:play']);
  });

  test('removing the element removes its lens and its filter', async ({ page }) => {
    await openCase(page, 'view=sandbox&glass=1');
    const filters = () => page.locator('svg[data-vireglass-filters] filter').count();
    expect(await filters()).toBeGreaterThan(0);
    await page.evaluate(() => document.querySelectorAll('[data-vk]').forEach((el) => el.remove()));
    await expect.poll(filters).toBe(0);
  });

  test('removing the element leaves none of its own custom properties behind', async ({ page }) => {
    await openCase(page, 'view=sandbox&glass=1');
    const left = await page.evaluate(() => {
      const hosts = [...document.querySelectorAll<HTMLElement>('[data-vk]')];
      hosts.forEach((el) => el.remove());
      return hosts.flatMap((el) => [...el.style].filter((name) => name.startsWith('--vk-')));
    });
    expect(left).toEqual([]);
  });

  // The kit reads the lens's probe as `r g b` in 0..1; if that format changes, the rim must fail here, not fall back quietly.
  test('the rim strength follows the probe the lens publishes', async ({ page }) => {
    const read = async (backdrop: string) => {
      await openCase(page, `atom=button&state=rest&backdrop=${backdrop}&glass=1`);
      return page.locator('.cell[data-state=rest] vire-button').evaluate((host) => ({
        tint: host.querySelector('button')!.style.getPropertyValue('--vireglass-tint'),
        rim: Number(host.style.getPropertyValue('--vk-rim')),
      }));
    };
    const dark = await read('dark');
    const light = await read('light');
    for (const { tint, rim } of [dark, light]) {
      expect(tint).toMatch(/^[\d.]+ [\d.]+ [\d.]+$/);
      const [r, g, b] = tint.split(' ').map(Number) as [number, number, number];
      expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
      expect(rim).toBeCloseTo(atomRimOpacity(0.2126 * r + 0.7152 * g + 0.0722 * b), 3);
    }
    expect(light.rim).toBeGreaterThan(dark.rim + 0.2);
  });

  test('connecting again after removal upgrades it once more', async ({ page }) => {
    await openCase(page, 'view=sandbox&glass=1');
    await page.evaluate(() => {
      const host = document.querySelector('#play')!;
      const parent = host.parentElement!;
      host.remove();
      parent.append(host);
    });
    await expect(page.locator('#play')).toHaveAttribute('data-vk', '');
    await expect
      .poll(() => page.locator('#play button').evaluate((el) => el.style.backdropFilter))
      .toContain('url(');
  });
});

for (const atom of ATOMS) {
  test.describe(`${atom.name}: accessibility modes`, () => {
    test('reduced transparency keeps the lens and frosts it', async ({ page }) => {
      const read = (host: Locator) =>
        host.evaluate((el) => ({
          alpha: Number(el.style.getPropertyValue('--vk-body-alpha')),
          blur: Number(document.querySelector('svg[data-vireglass-filters] feGaussianBlur')?.getAttribute('stdDeviation')),
        }));
      await openCase(page, 'view=sandbox&glass=1&rt=0');
      const clear = await read(page.locator(atom.id));
      await openCase(page, 'view=sandbox&glass=1&rt=1');
      const host = page.locator(atom.id);
      await expect(host).toHaveAttribute('data-surface', 'glass');
      await expect(host).toHaveAttribute('data-glass', 'on');
      await expect(host).toHaveAttribute('data-frost', '');
      expect(await host.locator('button').evaluate((el) => el.style.backdropFilter)).toContain('url(');
      const frosted = await read(host);
      expect(frosted.alpha).toBeGreaterThan(clear.alpha * 2);
      expect(frosted.blur).toBeGreaterThan(clear.blur * 2);
      await host.locator('button').click();
      expect(await log(page)).toEqual([atom.click]);
    });

    // The frosted body is lighter than the backdrop, so the ink follows the body, not the probe.
    test('reduced transparency keeps the ink readable against the lifted body', async ({ page }) => {
      const inkLightness = async () => {
        const color = await page.locator(atom.id).locator('button').evaluate((el) => getComputedStyle(el).color);
        return color.startsWith('oklab') ? Number(/oklab\(([\d.]+)/.exec(color)![1]) : Number(/\d+/.exec(color)![0]) / 255;
      };
      await openCase(page, 'view=sandbox&backdrop=mid&glass=1&rt=0');
      expect(await inkLightness()).toBeGreaterThan(0.8);
      await openCase(page, 'view=sandbox&backdrop=mid&glass=1&rt=1');
      expect(await inkLightness()).toBeLessThan(0.2);
    });

    test('increased contrast adds a border', async ({ page }) => {
      await openCase(page, 'view=sandbox&glass=0&ic=1');
      const host = page.locator(atom.id);
      await expect(host).toHaveAttribute('data-contrast', '');
      expect(await host.locator('button').evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');
    });

    test('reduced motion makes the press instant', async ({ page }) => {
      await openCase(page, 'view=sandbox&rm=1');
      const host = page.locator(atom.id);
      expect(await pressFirstFrame(host)).toBe(1);
    });

    test('the same press without it is still moving one frame in', async ({ page }) => {
      await openCase(page, 'view=sandbox&rm=0');
      const host = page.locator(atom.id);
      expect(await pressFirstFrame(host)).toBeLessThan(0.9);
    });

    test('the system setting is followed when nothing overrides it', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openCase(page, 'view=sandbox');
      const host = page.locator(atom.id);
      expect(await pressFirstFrame(host)).toBe(1);
    });
  });
}

test.describe('accessibility override', () => {
  test('a setting made on the page changes live elements', async ({ page }) => {
    await openCase(page, 'view=sandbox&glass=0');
    const host = page.locator('#play');
    await expect(host).not.toHaveAttribute('data-contrast', '');
    await page.evaluate(() => window.__lab.setA11yOverride({ increaseContrast: true }));
    await expect(host).toHaveAttribute('data-contrast', '');
  });
});

test.describe('size', () => {
  test('the finger tier meets the touch target, small is its own 24', async ({ page }) => {
    await openCase(page, 'view=sandbox&size=touch');
    for (const id of ['play', 'share']) {
      const box = (await page.locator('#' + id + ' button').boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await openCase(page, 'view=sandbox&size=small');
    const small = (await page.locator('#share button').boundingBox())!;
    expect(small.height).toBe(24);
    expect(small.width).toBe(24);
  });

  test('a capsule has half its height as radius', async ({ page }) => {
    await openCase(page, 'view=sandbox&size=large');
    const radius = await page.locator('#play button').evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(radius).toBe('20px');
  });
});

test.describe('hit area on a coarse pointer', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('the default size is the finger tier', async ({ page }) => {
    await openCase(page, '', '/early.html');
    await expect(page.locator('#early-play')).toHaveAttribute('data-size', 'touch');
  });

  for (const [size, body, slop] of [
    ['small', 24, 10],
    ['medium', 32, 6],
  ] as const) {
    test(`at ${size} the hit area reaches ${slop} dp past the body and no further`, async ({ page }) => {
      await openCase(page, `view=sandbox&size=${size}&glass=0`);
      const button = page.locator('#share button');
      const { x, y, box } = await centerOf(button);
      expect(box.height).toBe(body);
      const hitAt = (dx: number) =>
        page.evaluate(
          ([px, py]) => (document.elementFromPoint(px!, py!) as HTMLElement | null)?.closest('vire-icon-button')?.id ?? '',
          [box.x - dx, y],
        );
      expect(await hitAt(slop - 1)).toBe('share');
      expect(await hitAt(slop + 3)).toBe('');
      await page.touchscreen.tap(box.x - (slop - 1), y);
      expect(await log(page)).toEqual(['click:share']);
      expect(x).toBeGreaterThan(0);
    });
  }

  test('a tap in the hit area is exactly one click, seen on the host and on the button', async ({ page }) => {
    await openCase(page, 'view=sandbox&size=small&glass=0');
    await page.evaluate(() => {
      const counts = { host: 0, button: 0 };
      (window as unknown as { __clicks: typeof counts }).__clicks = counts;
      const host = document.querySelector('#share')!;
      host.addEventListener('click', () => (counts.host += 1));
      host.querySelector('button')!.addEventListener('click', () => (counts.button += 1));
    });
    const { box, y } = await centerOf(page.locator('#share button'));
    await page.touchscreen.tap(box.x - 5, y);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __clicks: object }).__clicks)).toEqual({
      host: 1,
      button: 1,
    });
    expect(await log(page)).toEqual(['click:share']);
  });

  test('a key shows the focus ring even though the pointer is coarse', async ({ page }) => {
    await openCase(page, 'view=sandbox');
    await page.keyboard.press('Tab');
    await expect(page.locator('#play')).toHaveAttribute('data-focus', '');
  });
});

test.describe('forced colours', () => {
  test('text keeps the system colour, undimmed', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openCase(page, 'view=sandbox&glass=1');
    const { color, fill, native, nativeDisabled, disabled } = await page.evaluate(() => {
      const probe = document.createElement('button');
      probe.textContent = 'x';
      document.body.append(probe);
      const off = document.createElement('button');
      off.disabled = true;
      document.body.append(off);
      const own = getComputedStyle(document.querySelector('#play button')!);
      const dis = getComputedStyle(document.querySelector('#off button')!);
      return {
        color: own.color,
        fill: own.webkitTextFillColor,
        native: getComputedStyle(probe).color,
        nativeDisabled: getComputedStyle(off).color,
        disabled: dis.color,
      };
    });
    expect(color).toBe(native);
    expect(fill).not.toMatch(/\/ 0\.\d/);
    expect(disabled).toBe(nativeDisabled);
  });
});

test.describe('a lens that fails to attach', () => {
  test('a module that cannot be loaded leaves a complete plain control and no unhandled error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/vireglass_dom.js*', (route) => route.abort());
    await page.goto('/?chrome=0&view=sandbox&glass=1');
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    const play = page.locator('#play');
    await expect(play).toHaveAttribute('data-glass', 'off');
    await expect(play).toHaveAttribute('data-surface', 'plain');
    expect(await play.locator('button').evaluate((el) => el.style.backdropFilter)).toBe('');
    await play.locator('button').click();
    expect(await log(page)).toEqual(['click:play']);
    expect(errors).toEqual([]);
  });

  test('an attach that throws falls back to the mode surface and is tried again, for every element, on the next change', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/vireglass_dom.js*', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: 'export function attachGlass() { window.__attempts = (window.__attempts ?? 0) + 1; throw new Error("boom"); }',
      }),
    );
    await page.goto('/?chrome=0&view=sandbox&glass=1&rt=1');
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    const play = page.locator('#play');
    await expect(play).toHaveAttribute('data-surface', 'frosted');
    const attempts = () => page.evaluate(() => (window as unknown as { __attempts?: number }).__attempts ?? 0);
    await expect.poll(attempts).toBeGreaterThan(0);
    let seen = await attempts();

    await page.evaluate(() => window.__lab.setA11yOverride({ reduceTransparency: false }));
    await expect.poll(attempts).toBeGreaterThan(seen);
    seen = await attempts();
    await expect(play).toHaveAttribute('data-glass', 'off');
    await expect(play).toHaveAttribute('data-surface', 'plain');

    await page.evaluate(() => window.__lab.setA11yOverride({ increaseContrast: true }));
    await expect.poll(attempts).toBeGreaterThan(seen);
    await play.locator('button').click();
    expect(await log(page)).toEqual(['click:play']);
    expect(errors).toEqual([]);
  });
});

// Bounds come from the same measurement on the reference frames (docs/acceptance.md, "Resting body"), with a margin.
test.describe('resting body and rim', () => {
  const DPR = 2;
  test.use({ deviceScaleFactor: DPR });

  const BODY_L = [0.02, 0.14] as const;
  const RIM_OVER_SURROUND = [0.1, 0.45] as const;
  const CARRIED_CHROMA = 0.04;

  const separates = (m: Measure) =>
    m.dL >= BODY_L[0] &&
    m.dL <= BODY_L[1] &&
    m.rimOverSurround >= RIM_OVER_SURROUND[0] &&
    m.rimOverSurround <= RIM_OVER_SURROUND[1] &&
    Math.abs(m.dC) <= CARRIED_CHROMA;

  async function measureRest(page: Page, atom: 'button' | 'iconButton', backdrop: string, css = ''): Promise<Measure> {
    await openCase(page, `atom=${atom}&state=rest&size=touch&backdrop=${backdrop}&glass=1`);
    if (css) await page.addStyleTag({ content: css });
    const stage = page.locator('#stage');
    const box = (await stage.boundingBox())!;
    const body = (await page.locator('.cell[data-state=rest] button').boundingBox())!;
    const at: Footprint = {
      cx: (body.x - box.x + body.width / 2) * DPR,
      cy: (body.y - box.y + body.height / 2) * DPR,
      hw: (atom === 'iconButton' ? body.height : body.width) * (DPR / 2),
      hh: body.height * (DPR / 2),
    };
    return measureImage(page, await stage.screenshot(), 'png', at);
  }

  // Only dark and photo have headroom; over near-white the body cannot get much lighter than its surround.
  for (const atom of ['button', 'iconButton'] as const) {
    for (const backdrop of ['dark', 'photo']) {
      test(`${atom} on ${backdrop} stands off its surround and carries its colour`, async ({ page }) => {
        const m = await measureRest(page, atom, backdrop);
        expect(m.dL).toBeGreaterThanOrEqual(BODY_L[0]);
        expect(m.dL).toBeLessThanOrEqual(BODY_L[1]);
        expect(m.rimOverSurround).toBeGreaterThanOrEqual(RIM_OVER_SURROUND[0]);
        expect(m.rimOverSurround).toBeLessThanOrEqual(RIM_OVER_SURROUND[1]);
        expect(Math.abs(m.dC)).toBeLessThanOrEqual(CARRIED_CHROMA);
      });
    }

    test(`${atom} is lighter than the light backdrop around it`, async ({ page }) => {
      expect((await measureRest(page, atom, 'light')).dL).toBeGreaterThan(0.01);
    });
  }

  // The old look (no body, rim at full strength) has to fail the gate.
  test('canary: a clear body fails the gate', async ({ page }) => {
    expect(separates(await measureRest(page, 'button', 'dark'))).toBe(true);
    const m = await measureRest(page, 'button', 'dark', ':is(vire-button,vire-icon-button)[data-vk]>button{background:none !important}');
    expect(separates(m)).toBe(false);
    expect(m.dL).toBeLessThan(BODY_L[0]);
  });

  test('canary: a rim at full strength fails the gate', async ({ page }) => {
    const m = await measureRest(page, 'button', 'dark', ':is(vire-button,vire-icon-button)[data-vk]>button::after{opacity:1 !important}');
    expect(separates(m)).toBe(false);
    expect(m.rimOverSurround).toBeGreaterThan(RIM_OVER_SURROUND[1]);
  });
});

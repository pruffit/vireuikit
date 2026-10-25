import type { Page } from '@playwright/test';
import { centerOf, walk } from './inputs';
import type { GateName } from './gates';
import type { Scenario } from './run';

/** A synthetic page that must fail one gate (`bad`), and the same page without the defect, which must pass it (`clean`). */
export type Canary = { gate: GateName; defect: string; bad: Scenario; clean: Scenario };

const head = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:linear-gradient(135deg,#f6e6c4,#dfe9f7);font:600 20px system-ui}
#el{position:absolute;left:90px;top:100px;width:60px;height:60px;border-radius:16px;background:#4a8f6a;color:#fff;display:grid;place-items:center}
.row{position:absolute;left:60px;top:110px;display:flex;gap:16px}.it{width:52px;height:52px;display:grid;place-items:center;font-size:32px;background:#e8e8ee;border-radius:12px;color:#222}
#cap{position:absolute;left:100px;top:110px;width:160px;height:48px;border-radius:24px;background:#3b6fd4;box-shadow:0 0 0 0 transparent}
#cap.wide::before{content:'';position:absolute;inset:0;background:#3b6fd4}
.pill{position:absolute;left:100px;top:100px;width:90px;height:44px;border-radius:22px;background:#3b6fd4}
#cap.on{background:#3a66c4}
#b{position:absolute;left:110px;top:110px;width:140px;height:48px;border:0;border-radius:24px;font:600 18px system-ui;background:#e7e7ec;color:#222}
</style>`;

const page = (body: string, script = '') => async (p: Page): Promise<void> => {
  await p.route('**/__canary', (route) => route.fulfill({ contentType: 'text/html', body: `${head}${body}<script>${script}</script>` }));
  await p.goto('/__canary');
};

const base = { query: '', viewport: { width: 400, height: 300 } } as const;

/** A box that grows for 300 ms and reports its motion the way the kit does; `late` then changes it 400 ms after the motion has ended. */
const grower = (late: boolean) =>
  page(
    '<div id="el"></div>',
    `const el=document.getElementById('el');let on=false;
window.go=()=>{on=true;globalThis.__vireMotion?.('start');const t0=performance.now();const tick=(t)=>{const k=Math.min(1,(t-t0)/300);const e=1-(1-k)**3;el.style.width=60+100*e+'px';if(k<1)requestAnimationFrame(tick);else{globalThis.__vireMotion?.('end');${late ? "setTimeout(()=>{el.textContent='Label';el.style.background='#3f9a72'},400);" : ''}}};requestAnimationFrame(tick)};`,
  );

const glyphRow = (hide: boolean) =>
  page(
    '<div class="row"><div class="it">★</div><div class="it">♥</div><div class="it">✚</div><div class="it">●</div></div>',
    hide ? "const its=[...document.querySelectorAll('.it')];addEventListener('pointermove',(e)=>{its.forEach((el,i)=>{const r=el.getBoundingClientRect();el.style.color=e.buttons&&e.clientX>r.left&&e.clientX<r.right&&i===2?'transparent':''})});" : '',
  );

const capsule = (square: boolean) =>
  page(`<div id="cap" data-scn-hide${square ? ' class="wide"' : ''}></div>`, "window.go=()=>{document.getElementById('cap').classList.add('on')};");

const button = (delta: 'faint' | 'clear') =>
  page(
    '<button id="b">Play</button>',
    `const b=document.getElementById('b');const s=document.createElement('style');s.textContent='#b:hover{background:${delta === 'faint' ? '#e3e3e8' : '#b8b8c4'}}';document.head.append(s);`,
  );

const moveInto = async (ctx: { page: Page; quiet(ms?: number): Promise<void>; mark(n: string): Promise<void> }, selector: string, mark: string) => {
  await ctx.page.mouse.move(4, 4);
  await walk(ctx.page, { x: 4, y: 4 }, await centerOf(ctx.page.locator(selector)), 500);
  await ctx.quiet(900);
  await ctx.mark(mark);
};

const grow = (name: string, late: boolean): Scenario => ({
  ...base,
  name,
  open: grower(late),
  track: { el: '#el' },
  view: ['el'],
  async act(ctx) {
    await ctx.page.evaluate(() => (window as unknown as { go(): void }).go());
  },
  gates: { seam: { keys: ['el'], pad: 24 } },
});

const drags = (name: string, hide: boolean): Scenario => ({
  ...base,
  name,
  open: glyphRow(hide),
  track: { items: '.it' },
  view: ['items'],
  async act(ctx) {
    const { page } = ctx;
    const targets = await page.evaluate(() => [...document.querySelectorAll('.it')].map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })));
    await page.mouse.move(targets[0]!.x, targets[0]!.y);
    await page.mouse.down();
    let at = targets[0]!;
    for (const p of [...targets.slice(1), ...targets.slice(0, -1).reverse()]) {
      await walk(page, at, p, 600);
      at = p;
    }
    await page.mouse.up();
  },
  gates: { vanish: { key: 'items' } },
});

const shapes = (name: string, square: boolean): Scenario => ({
  ...base,
  name,
  open: capsule(square),
  track: { cap: '#cap' },
  view: ['cap'],
  async act(ctx) {
    await ctx.page.evaluate(() => (window as unknown as { go(): void }).go());
    await ctx.sleep(300);
  },
  gates: { shape: { keys: ['cap'] } },
});

const ghosts = (name: string, strip: boolean): Scenario => ({
  ...base,
  name,
  open: page(
    '<div id="t" class="pill" data-scn-hide></div><div id="s" class="pill" style="visibility:hidden;background:#3b6fd5"><div id="g" style="position:absolute;left:25px;top:8px;width:40px;height:6px;border-radius:3px;background:' + (strip ? '#d8d8d8' : '#3b6fd5') + '"></div></div>',
    "window.go=()=>{document.getElementById('s').style.visibility='visible';setTimeout(()=>{document.getElementById('s').style.visibility='hidden'},400)};",
  ),
  track: { surface: '#s', target: '#t', part: '#g' },
  view: ['target'],
  async act(ctx) {
    await ctx.page.evaluate(() => (window as unknown as { go(): void }).go());
    await ctx.sleep(800);
  },
  gates: { ghost: { surface: 'surface', target: 'target', part: 'part' } },
});

const states = (name: string, delta: 'faint' | 'clear'): Scenario => ({
  ...base,
  name,
  open: button(delta),
  track: { atom: '#b' },
  view: ['atom'],
  async act(ctx) {
    await moveInto(ctx, '#b', 'hover');
  },
  gates: { state: { key: 'atom', at: 'hover' } },
});

export const CANARIES: Canary[] = [
  { gate: 'seam', defect: 'a label and a colour that arrive 400 ms after the motion ended', bad: grow('canary seam: a late change', true), clean: grow('canary seam: a motion that settles', false) },
  { gate: 'vanish', defect: 'an item whose glyph is erased while the pointer drags over it', bad: drags('canary vanish: an item hidden in a drag', true), clean: drags('canary vanish: a drag that hides nothing', false) },
  { gate: 'shape', defect: 'a capsule with a square box of colour behind it', bad: shapes('canary shape: a square behind a capsule', true), clean: shapes('canary shape: a plain capsule', false) },
  { gate: 'ghost', defect: 'a grabber left on the pill a surface has shrunk to', bad: ghosts('canary ghost: a strip left on the pill', true), clean: ghosts('canary ghost: a clean pill', false) },
  { gate: 'state', defect: 'a hover that changes the body by a ΔE of about 1.5', bad: states('canary state: a faint hover', 'faint'), clean: states('canary state: a clear hover', 'clear') },
];

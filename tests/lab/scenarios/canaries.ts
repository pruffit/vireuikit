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
#d{position:absolute;left:110px;top:110px;width:140px;height:48px;border:0;border-radius:24px;font:600 18px system-ui;background:#101014;color:#ddd}
#trg{position:absolute;left:100px;top:110px;width:120px;height:48px;border-radius:24px;background:#e7e7ec;color:#222;display:grid;place-items:center}
#sc{position:absolute;left:60px;top:40px;width:200px;height:200px;overflow-y:auto;background:#fff}#sc>div{height:900px;background:linear-gradient(#fff,#cde)}
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

const hoverShape = (square: boolean) =>
  page(
    '<button id="b">Play</button>',
    `const s=document.createElement('style');s.textContent='#b{overflow:visible}#b:hover::after{content:"";position:absolute;left:4px;right:4px;top:4px;bottom:4px;background:#2a8f5a;${square ? '' : 'border-radius:20px;'}}';document.head.append(s);`,
  );

const darkRim = (rim: boolean) =>
  page('<button id="d">Play</button>', `const s=document.createElement('style');s.textContent='${rim ? '#d:hover{box-shadow:inset 0 0 0 2px #26262c}' : '#d:hover{}'}';document.head.append(s);`);

const swap = (atOnce: boolean) =>
  page(
    '<div id="el">Label</div>',
    `const el=document.getElementById('el');el.style.color='#fff';window.go=()=>{let n=0;const tick=()=>{n+=1;el.style.color='rgba(255,255,255,'+(${atOnce ? 'n<12?1:0' : '1-n/20'})+')';if(n<20)requestAnimationFrame(tick)};requestAnimationFrame(tick)};`,
  );

const holes = (gap: boolean) =>
  page(
    '<div id="trg">Filters</div><div id="s" style="visibility:hidden;position:absolute;left:100px;top:110px;width:120px;height:48px"></div>',
    `window.go=()=>{const t=document.getElementById('trg');${gap ? "setTimeout(()=>{t.style.color='transparent'},120);setTimeout(()=>{t.style.color=''},480);" : "setTimeout(()=>{t.style.color='#333'},120);"}};`,
  );

const bounces = (back: boolean) =>
  page(
    '<div id="el"></div>',
    `const el=document.getElementById('el');el.style.left='60px';window.go=()=>{globalThis.__vireMotion?.('start');const t0=performance.now();const path=${back ? '(k)=>k<.4?60+k/.4*60:k<.7?120-(k-.4)/.3*40:80+(k-.7)/.3*60' : '(k)=>60+80*(1-(1-k)**3)'};const tick=(t)=>{const k=Math.min(1,(t-t0)/600);el.style.left=path(k)+'px';if(k<1)requestAnimationFrame(tick);else globalThis.__vireMotion?.('end')};requestAnimationFrame(tick)};`,
  );

const scrollers = (platform: boolean) =>
  page(`<div id="host"><div id="sc" style="${platform ? 'scrollbar-width:thin' : 'scrollbar-width:none'}"><div></div></div></div>`);

const roundWhileMoving = (square: boolean) =>
  page(
    '<div id="cap" data-scn-hide></div>',
    `window.go=()=>{const c=document.getElementById('cap');globalThis.__vireMotion?.('start');${square ? "c.style.borderRadius='0';setTimeout(()=>{c.style.borderRadius='24px'},350);" : ''}setTimeout(()=>globalThis.__vireMotion?.('end'),600)};`,
  );

const quietAct: Scenario['act'] = async (ctx) => {
  await ctx.page.evaluate(() => (window as unknown as { go?: () => void }).go?.());
  await ctx.sleep(800);
};

const highlights = (name: string, square: boolean): Scenario => ({
  ...base,
  name,
  open: hoverShape(square),
  track: { atom: '#b' },
  view: ['atom'],
  async act(ctx) {
    await moveInto(ctx, '#b', 'hover');
  },
  gates: { highlight: { key: 'atom', at: 'hover' } },
});

const relative = (name: string, rim: boolean): Scenario => ({
  ...base,
  name,
  open: darkRim(rim),
  track: { atom: '#d' },
  view: ['atom'],
  async act(ctx) {
    await moveInto(ctx, '#d', 'hover');
  },
  gates: { state: { key: 'atom', at: 'hover' } },
});

const pops = (name: string, atOnce: boolean): Scenario => ({
  ...base,
  name,
  open: swap(atOnce),
  track: { el: '#el' },
  view: ['el'],
  act: quietAct,
  gates: { pop: { keys: ['el'] } },
});

const holed = (name: string, gap: boolean): Scenario => ({
  ...base,
  name,
  open: holes(gap),
  track: { target: '#trg', surface: '#s' },
  view: ['target'],
  act: quietAct,
  gates: { hole: { target: 'target', surface: 'surface' } },
});

const converges = (name: string, back: boolean): Scenario => ({
  ...base,
  name,
  open: bounces(back),
  track: { el: '#el' },
  view: ['el'],
  act: quietAct,
  gates: { converge: { keys: ['el'] } },
});

const bars = (name: string, platform: boolean): Scenario => ({
  ...base,
  name,
  open: scrollers(platform),
  track: { sc: '#sc' },
  view: ['sc'],
  act: quietAct,
  gates: { scrollbar: { within: '#host' } },
});

const roundings = (name: string, square: boolean): Scenario => ({
  ...base,
  name,
  open: roundWhileMoving(square),
  track: { cap: '#cap' },
  view: ['cap'],
  act: quietAct,
  gates: { shape: { keys: ['cap'], during: true } },
});

export const CANARIES: Canary[] = [
  { gate: 'seam', defect: 'a label and a colour that arrive 400 ms after the motion ended', bad: grow('canary seam: a late change', true), clean: grow('canary seam: a motion that settles', false) },
  { gate: 'vanish', defect: 'an item whose glyph is erased while the pointer drags over it', bad: drags('canary vanish: an item hidden in a drag', true), clean: drags('canary vanish: a drag that hides nothing', false) },
  { gate: 'shape', defect: 'a capsule with a square box of colour behind it', bad: shapes('canary shape: a square behind a capsule', true), clean: shapes('canary shape: a plain capsule', false) },
  { gate: 'ghost', defect: 'a grabber left on the pill a surface has shrunk to', bad: ghosts('canary ghost: a strip left on the pill', true), clean: ghosts('canary ghost: a clean pill', false) },
  { gate: 'state', defect: 'a hover that changes the body by a ΔE of about 1.5', bad: states('canary state: a faint hover', 'faint'), clean: states('canary state: a clear hover', 'clear') },
  { gate: 'highlight', defect: 'a hover that paints a rectangle inside a capsule', bad: highlights('canary highlight: a square hover in a capsule', true), clean: highlights('canary highlight: a capsule hover in a capsule', false) },
  { gate: 'state', defect: 'a rim on a dark button whose step is small in ΔE and large to the eye', bad: relative('canary state: a rim as dark as the body', false), clean: relative('canary state: a rim a little lighter than the dark body', true) },
  { gate: 'pop', defect: 'a label that vanishes in one frame in the middle of nothing moving', bad: pops('canary pop: a label that goes at once', true), clean: pops('canary pop: a label that fades', false) },
  { gate: 'hole', defect: 'a trigger whose label is gone for 360 ms while its surface is closed', bad: holed('canary hole: a trigger without its label', true), clean: holed('canary hole: a trigger with its label', false) },
  { gate: 'converge', defect: 'a box that runs past its place and comes back', bad: converges('canary converge: a box that turns back', true), clean: converges('canary converge: a box that goes straight', false) },
  { gate: 'scrollbar', defect: 'a scroll container that shows the platform scrollbar', bad: bars('canary scrollbar: the platform bar', true), clean: bars('canary scrollbar: no platform bar', false) },
  { gate: 'shape', defect: 'a capsule that is square for the first 350 ms of its motion', bad: roundings('canary shape: square while moving', true), clean: roundings('canary shape: round while moving', false) },
];

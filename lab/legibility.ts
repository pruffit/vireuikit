import type { BackdropSample } from 'vireglass';
import { makeMenu } from './menu';
import { ensureCss as navCss, makeNav } from './nav';
import { ensureCss as sheetCss, makeSheet } from './sheet';
import { ensureCss as toolbarCss, makeToolbar } from './toolbar';

export const LEGIBILITY_ATOMS = ['nav-bar', 'nav-rail', 'nav-sidebar', 'toolbar-bottom', 'toolbar-top', 'menu', 'popover', 'button', 'icon-button'] as const;
export type LegibilityAtom = (typeof LEGIBILITY_ATOMS)[number];

const FRAMES: Record<LegibilityAtom, { width: number; height: number }> = {
  'nav-bar': { width: 390, height: 720 },
  'nav-rail': { width: 900, height: 720 },
  'nav-sidebar': { width: 1280, height: 800 },
  'toolbar-bottom': { width: 390, height: 460 },
  'toolbar-top': { width: 720, height: 300 },
  menu: { width: 420, height: 440 },
  popover: { width: 700, height: 520 },
  button: { width: 420, height: 260 },
  'icon-button': { width: 420, height: 260 },
};

const WORDS = 'glass lens edge light rim body ink press lift hover focus rest touch surface material depth blur'.split(' ');
const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const sentence = (seed: number) => Array.from({ length: 12 }, (_, i) => WORDS[Math.floor(hash(seed, i) * WORDS.length)]).join(' ');
const bodyText = () => Array.from({ length: 70 }, (_, i) => `<p>${sentence(i + 1)}. ${sentence(i + 90)}.</p>`).join('');

const glyph = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const CSS = `
.lg-frame { position: relative; overflow: clip; border-radius: 28px; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.12); font: 14px system-ui; }
.lg-scroll { position: absolute; inset: 0; overflow-y: auto; padding: 0 24px; box-sizing: border-box; font: 15px/1.5 Georgia, serif; color: #2a2a2e; scrollbar-width: none; }
.lg-scroll p { margin: 0 0 12px; }
.lg-scroll::before { content: ''; display: block; height: 16px; }
.lg-frame[data-backdrop-kind='text'] .lg-scroll { background: #fbfbf8; }
.lg-frame[data-backdrop-kind='dark'] .lg-scroll { color: #e8e8ec; }
.lg-frame vire-popover > vire-button { position: absolute; left: 40px; top: 60px; }
.lg-frame .lg-row { position: absolute; left: 32px; right: 32px; top: 90px; display: flex; flex-wrap: wrap; gap: 24px; align-items: center; }
.lg-frame .lg-menu { position: absolute; left: 40px; top: 190px; }
.lg-frame vire-toolbar[data-edge='top'] { margin: 8px; }
`;

function ensureCss(): void {
  if (document.getElementById('lab-legibility-css')) return;
  const style = document.createElement('style');
  style.id = 'lab-legibility-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export type LegibilityOptions = {
  backdrop: string;
  glass: '1' | '0' | 'touch';
  sample: BackdropSample | null;
  /** Where the page of text is scrolled to, in dp. */
  scroll: number;
  /** The `scroll-edge` attribute the bars are given; null leaves it to the default. */
  edge: string | null;
};

function control(tag: 'vire-button' | 'vire-icon-button', options: LegibilityOptions, label: string, icon: string | null): HTMLElement {
  const host = document.createElement(tag);
  host.setAttribute('size', 'touch');
  if (options.glass !== '0') host.setAttribute('glass', options.glass === 'touch' ? 'touch' : 'present');
  const button = document.createElement('button');
  button.type = 'button';
  if (icon) {
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
  } else {
    button.textContent = label;
  }
  host.append(button);
  if (options.sample) (host as HTMLElement & { sample: BackdropSample | null }).sample = options.sample;
  return host;
}

/** One atom floating over a scroller full of body text, over a backdrop: what the glass must stay legible against. */
export function legibilityScene(stage: HTMLElement, rows: HTMLElement, atom: LegibilityAtom, options: LegibilityOptions): void {
  ensureCss();
  const size = FRAMES[atom];
  stage.style.width = `${size.width + 72}px`;
  const frame = document.createElement('div');
  frame.className = 'lg-frame';
  frame.id = 'frame';
  frame.dataset.vireShell = '';
  frame.dataset.backdropKind = options.backdrop;
  frame.style.cssText = `width:${size.width}px;height:${size.height}px`;
  const scroll = document.createElement('div');
  scroll.className = 'lg-scroll';
  scroll.id = 'lg-scroll';
  scroll.innerHTML = bodyText();
  frame.append(scroll);
  const edge: Record<string, string> = options.edge ? { 'scroll-edge': options.edge } : {};

  if (atom.startsWith('nav-')) {
    navCss();
    frame.append(makeNav({ id: 'nav', glass: options.glass, sample: options.sample, current: 0, accessory: atom === 'nav-bar', attrs: { scroller: 'lg-scroll', ...edge } }));
  } else if (atom === 'toolbar-bottom' || atom === 'toolbar-top') {
    toolbarCss();
    frame.classList.add('tb-frame');
    const bar = makeToolbar({ id: 'toolbar', glass: options.glass, sample: options.sample, place: atom === 'toolbar-bottom' ? 'bottom' : 'top', attrs: { scroller: 'lg-scroll', ...edge } });
    bar.setAttribute('data-vire-force-state', 'stage:separate');
    frame.append(bar);
  } else if (atom === 'menu') {
    const holder = document.createElement('div');
    holder.className = 'lg-menu';
    holder.append(
      makeMenu({
        id: 'menu',
        size: 'touch',
        glass: options.glass,
        sample: options.sample,
        trigger: { kind: 'icon', label: 'More', glyph: 'more' },
        items: [
          { label: 'Copy link', glyph: 'link' },
          { label: 'Rename', glyph: 'pencil' },
          { label: 'Move', glyph: 'folder' },
          { label: 'Delete', glyph: 'trash' },
        ],
        force: 'open',
        corner: 'bottom-left',
      }),
    );
    frame.append(holder);
  } else if (atom === 'popover') {
    sheetCss();
    frame.append(makeSheet({ id: 'sheet', tag: 'vire-popover', surface: 'popover', body: 'filters', trigger: 'Filters', glass: options.glass, sample: options.sample, force: 'open' }));
  } else {
    const row = document.createElement('div');
    row.className = 'lg-row';
    const tag = atom === 'button' ? 'vire-button' : 'vire-icon-button';
    const labels = atom === 'button' ? ['Play', 'Shuffle', 'Add to queue'] : ['Share', 'Like', 'Queue'];
    const icons = [glyph('<path d="M12 15V4M8 8l4-4 4 4M5 12v7h14v-7"/>'), glyph('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'), glyph('<path d="M5 6h14M5 12h14M5 18h8"/>')];
    labels.forEach((label, i) => row.append(control(tag, options, label, atom === 'button' ? null : icons[i]!)));
    frame.append(row);
  }
  rows.append(frame);
  scroll.scrollTop = options.scroll;
}

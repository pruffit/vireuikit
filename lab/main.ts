import { CONTROL_SIZES, type ControlSize } from '../src/kit/sizes';
import { defineVireElements, setA11yOverride } from 'vireuikit/web';
import { BACKDROPS, paintBackdrop, type Backdrop } from './backdrops';

const FORCEABLE_STATES = ['rest', 'hover', 'focus', 'pressed', 'disabled'] as const;

type Atom = 'button' | 'iconButton';
const ATOMS: Atom[] = ['button', 'iconButton'];
const TAGS: Record<Atom, string> = { button: 'vire-button', iconButton: 'vire-icon-button' };

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 12v7h14v-7"/></svg>';

const params = new URLSearchParams(location.search);
const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
  const v = params.get(name);
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
};
const flag = (name: string): boolean | undefined => {
  const v = params.get(name);
  return v === '1' ? true : v === '0' ? false : undefined;
};

const view = pick('view', ['gallery', 'sandbox'] as const, 'gallery');
const atomParam = pick('atom', ['all', ...ATOMS] as const, 'all');
const stateParam = pick('state', ['all', ...FORCEABLE_STATES] as const, 'all');
const backdrop = pick('backdrop', BACKDROPS, 'light') as Backdrop;
const glass = pick('glass', ['1', '0', 'touch'] as const, '1');
const size = pick('size', CONTROL_SIZES, 'touch') as ControlSize;
const chrome = params.get('chrome') !== '0';
const upgrade = params.get('upgrade') !== '0';

const app = document.getElementById('app')!;
app.dataset.chrome = chrome ? '1' : '0';
app.dataset.labels = params.get('labels') === '1' ? '1' : '0';

if (upgrade) {
  setA11yOverride({
    reduceTransparency: flag('rt'),
    increaseContrast: flag('ic'),
    reduceMotion: flag('rm'),
  });
  defineVireElements({ nonce: params.get('nonce') ?? undefined });
}

const stage = document.getElementById('stage')!;
paintBackdrop(stage, backdrop);

function make(atom: Atom, state: string | null): HTMLElement {
  const host = document.createElement(TAGS[atom]);
  host.setAttribute('size', size);
  if (glass !== '0') host.setAttribute('glass', glass === '1' ? 'present' : 'touch');
  if (state) host.setAttribute('data-vire-force-state', state);
  const button = document.createElement('button');
  button.type = 'button';
  if (atom === 'iconButton') {
    button.setAttribute('aria-label', 'Share');
    button.innerHTML = ICON;
  } else {
    button.textContent = 'Play';
  }
  host.append(button);
  return host;
}

function gallery(): void {
  const rows = document.getElementById('rows')!;
  const atoms = atomParam === 'all' ? ATOMS : [atomParam];
  const states = stateParam === 'all' ? FORCEABLE_STATES : [stateParam];
  for (const atom of atoms) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.atom = atom;
    row.innerHTML = `<div class="name">${atom}</div>`;
    const cells = document.createElement('div');
    cells.className = 'cells';
    for (const state of states) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.state = state;
      cell.append(make(atom, state));
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = state;
      cell.append(cap);
      cells.append(cell);
    }
    row.append(cells);
    rows.append(row);
  }
}

function sandbox(): void {
  const rows = document.getElementById('rows')!;
  const log = document.getElementById('log')!;
  const note = (text: string) => {
    log.textContent += `${text}\n`;
    log.dataset.count = String(log.textContent!.split('\n').filter(Boolean).length);
  };
  const form = document.createElement('form');
  form.className = 'sandbox';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    note('submit');
  });
  const play = make('button', null);
  play.id = 'play';
  play.querySelector('button')!.addEventListener('click', () => note('click:play'));
  const share = make('iconButton', null);
  share.id = 'share';
  share.querySelector('button')!.addEventListener('click', () => note('click:share'));
  const off = make('button', null);
  off.id = 'off';
  off.setAttribute('disabled', '');
  off.querySelector('button')!.disabled = true;
  off.querySelector('button')!.textContent = 'Off';
  off.querySelector('button')!.addEventListener('click', () => note('click:off'));
  const send = make('button', null);
  send.id = 'send';
  send.querySelector('button')!.type = 'submit';
  send.querySelector('button')!.textContent = 'Send';
  const shareOff = make('iconButton', null);
  shareOff.id = 'share-off';
  shareOff.setAttribute('disabled', '');
  shareOff.querySelector('button')!.disabled = true;
  shareOff.querySelector('button')!.addEventListener('click', () => note('click:share-off'));
  form.append(play, share, off, shareOff, send);
  rows.append(form);
}

if (view === 'sandbox') sandbox();
else gallery();

function buildChrome(): void {
  const bar = document.getElementById('bar')!;
  const select = (name: string, options: readonly string[], current: string) =>
    `<label>${name}<select data-param="${name}">${options
      .map((o) => `<option${o === current ? ' selected' : ''}>${o}</option>`)
      .join('')}</select></label>`;
  const check = (name: string, label: string) =>
    `<label><input type="checkbox" data-flag="${name}"${params.get(name) === '1' ? ' checked' : ''}>${label}</label>`;
  bar.innerHTML = [
    select('view', ['gallery', 'sandbox'], view),
    select('atom', ['all', ...ATOMS], atomParam),
    select('state', ['all', ...FORCEABLE_STATES], stateParam),
    select('backdrop', BACKDROPS, backdrop),
    select('glass', ['1', '0', 'touch'], glass),
    select('size', CONTROL_SIZES, size),
    check('rt', 'reduce transparency'),
    check('ic', 'increase contrast'),
    check('rm', 'reduce motion'),
    check('labels', 'labels'),
  ].join('');
  bar.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const next = new URLSearchParams(location.search);
    if (target instanceof HTMLInputElement) {
      if (target.checked) next.set(target.dataset.flag!, '1');
      else next.delete(target.dataset.flag!);
    } else {
      next.set(target.dataset.param!, target.value);
    }
    location.search = next.toString();
  });
}

type Listing = { configured: boolean; files: string[] };

async function buildReference(): Promise<void> {
  const side = document.getElementById('side')!;
  side.innerHTML = '<h2>Reference frames</h2><div id="ref-body">Loading</div>';
  const body = document.getElementById('ref-body')!;
  let listing: Listing;
  try {
    listing = (await (await fetch('/__reference/list')).json()) as Listing;
  } catch {
    body.textContent = 'The reference service is not available (dev server only).';
    return;
  }
  if (!listing.configured) {
    body.textContent =
      'VIREUIKIT_REFERENCE_DIR is not set. Point it at a local directory of reference frames and restart the lab.';
    return;
  }
  body.innerHTML = '<img id="big" alt=""><input id="filter" placeholder="filter, e.g. knob" style="width:100%;margin-bottom:6px"><div id="thumbs"></div>';
  const big = document.getElementById('big') as HTMLImageElement;
  const thumbs = document.getElementById('thumbs')!;
  const src = (p: string) => `/__reference/file?path=${encodeURIComponent(p)}`;
  const render = (needle: string) => {
    thumbs.innerHTML = '';
    for (const file of listing.files.filter((f) => f.includes(needle)).slice(0, 90)) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = src(file);
      img.title = file;
      img.addEventListener('click', () => (big.src = src(file)));
      thumbs.append(img);
    }
  };
  (document.getElementById('filter') as HTMLInputElement).addEventListener('input', (e) =>
    render((e.target as HTMLInputElement).value),
  );
  render('');
}

if (chrome) {
  buildChrome();
  void buildReference();
}

window.__lab = { setA11yOverride, define: () => defineVireElements(), upgraded: upgrade };
document.documentElement.dataset.ready = '1';

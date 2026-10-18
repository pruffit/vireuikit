import type { BackdropSample } from 'vireglass';
import type { VireNavElement } from 'vireuikit/web';

export const NAV_FORMS = ['bar', 'minimized', 'rail', 'sidebar'] as const;
export type NavLabForm = (typeof NAV_FORMS)[number];

/** The window each form is drawn in, in dp: the model picks the form from it. */
export const NAV_FRAMES: Record<NavLabForm, { width: number; height: number }> = {
  bar: { width: 390, height: 720 },
  minimized: { width: 390, height: 720 },
  rail: { width: 900, height: 720 },
  sidebar: { width: 1280, height: 800 },
};

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICONS = {
  home: svg('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
  library: svg('<path d="M5 4v16M10 4v16M15 5l4 15"/>'),
  friends: svg('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.8.8 3 2.6 3 5.5"/>'),
  messages: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  feed: svg('<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>'),
  dashboard: svg('<rect x="4" y="4" width="7" height="9" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="11" width="7" height="9" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  play: svg('<path d="M8 5l11 7-11 7z"/>'),
  extra: svg('<circle cx="12" cy="12" r="8"/>'),
} as const;

const PRIMARY = [
  { label: 'Home', href: '/', icon: ICONS.home },
  { label: 'Library', href: '/library', icon: ICONS.library },
  { label: 'Friends', href: '/friends', icon: ICONS.friends },
  { label: 'Messages', href: '/messages', icon: ICONS.messages, badge: '3' },
] as const;
const SECONDARY = [
  { label: 'Feed', href: '/feed', icon: ICONS.feed },
  { label: 'Dashboard', href: '/dashboard', icon: ICONS.dashboard },
] as const;

export type NavSpec = {
  id: string;
  glass: '1' | '0' | 'touch';
  sample: BackdropSample | null;
  current?: number;
  search?: boolean;
  accessory?: boolean;
  /** More secondary destinations, to make the sidebar's list scroll. */
  extra?: number;
  attrs?: Record<string, string>;
};

const link = (item: { label: string; href: string; icon: string; badge?: string }, current: boolean) =>
  `<li><a href="${item.href}"${current ? ' aria-current="page"' : ''}>${item.icon}${item.label}${item.badge ? `<span data-badge>${item.badge}</span>` : ''}</a></li>`;

/** The first HTML of a navigation: a working list of links that needs nothing defined. */
export function makeNav(spec: NavSpec): HTMLElement {
  const nav = document.createElement('vire-nav');
  nav.id = spec.id;
  if (spec.glass !== '0') nav.setAttribute('glass', '');
  for (const [name, value] of Object.entries(spec.attrs ?? {})) nav.setAttribute(name, value);
  const current = spec.current ?? 0;
  const extra = Array.from({ length: spec.extra ?? 0 }, (_, i) => ({ label: `Playlist ${i + 1}`, href: `/playlist/${i + 1}`, icon: ICONS.extra }));
  nav.innerHTML = `<nav aria-label="Sections"><ul>${PRIMARY.map((item, i) => link(item, i === current)).join('')}</ul><ul data-secondary>${[...SECONDARY, ...extra]
    .map((item, i) => link(item, PRIMARY.length + i === current))
    .join('')}</ul>${spec.search === false ? '' : `<a href="/search" data-search>${ICONS.search}Search</a>`}</nav>${
    spec.accessory === false
      ? ''
      : `<div data-accessory><div class="acc"><i class="art"></i><span class="meta"><b>Night Drive</b><small>Vire Ensemble</small></span><button type="button" aria-label="Play" class="acc-play">${ICONS.play}</button></div></div>`
  }`;
  if (spec.sample) (nav as VireNavElement).sample = spec.sample;
  return nav;
}

/** Content for the glass to refract, clear of the navigation by the insets it publishes. */
function content(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'nav-content';
  const hues = [12, 48, 150, 210, 275, 330, 30, 190];
  el.innerHTML = `<h2>Good evening</h2>${hues
    .map((h, i) => `<section style="background:hsl(${h} 62% ${i % 2 ? 58 : 72}%)"><b>Mix ${i + 1}</b><small>${12 + i * 3} tracks</small></section>`)
    .join('')}`;
  return el;
}

const CSS = `
.nav-frame { position: relative; overflow: clip; border-radius: 28px; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.12); }
.nav-frame > vire-nav:not([data-vk]) { position: relative; display: block; }
.nav-frame > vire-nav:not([data-vk]) svg { width: 24px; height: 24px; }
.nav-content { position: absolute; inset: 0; overflow: clip; padding: 24px 16px calc(var(--vire-nav-inset-bottom, 0px) + 16px) calc(var(--vire-nav-inset-start, 0px) + 16px); display: grid; align-content: start; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); font: 14px system-ui; color: #1b1c20; }
.nav-content h2 { grid-column: 1 / -1; margin: 0; font: 600 22px system-ui; }
.nav-content section { height: 96px; border-radius: 18px; padding: 14px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-end; }
.nav-content small { opacity: 0.7; }
.nav-scroll { position: absolute; inset: 0; overflow-y: auto; padding: 24px 16px calc(var(--vire-nav-inset-bottom, 0px) + 16px) calc(var(--vire-nav-inset-start, 0px) + 16px); box-sizing: border-box; color: #1b1c20; font: 14px system-ui; }
.nav-scroll .row { height: 50px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid rgb(0 0 0 / 0.08); }
.nav-scroll .row i { width: 32px; height: 32px; border-radius: 8px; flex: none; }
[data-accessory] .acc { display: flex; align-items: center; gap: 10px; height: 100%; padding: 0 8px 0 8px; box-sizing: border-box; font: 13px system-ui; }
[data-accessory] .art { width: 32px; height: 32px; border-radius: 50%; flex: none; background: linear-gradient(135deg, #f0a, #08f); }
[data-accessory] .meta { display: grid; flex: 1; min-width: 0; white-space: nowrap; }
[data-accessory] .meta small { opacity: 0.65; }
[data-accessory] .acc-play { width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: inherit; display: grid; place-items: center; padding: 0; }
[data-accessory] .acc-play svg { width: 18px; height: 18px; }
[data-accessory][data-placement=in-bar] .meta { display: none; }
[data-accessory][data-placement=in-bar] .acc { justify-content: center; }
`;

function ensureCss(): void {
  if (document.getElementById('lab-nav-css')) return;
  const style = document.createElement('style');
  style.id = 'lab-nav-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export type NavGalleryOptions = {
  glass: '1' | '0' | 'touch';
  sample: BackdropSample | null;
  /** A forced state beyond the form: `morph:bar:0.46`, `drag:0.5`. */
  force?: string | null;
};

/** One navigation in a window frame over the backdrop, the form given by the frame's size. */
export function navGallery(stage: HTMLElement, rows: HTMLElement, form: NavLabForm, options: NavGalleryOptions): void {
  ensureCss();
  const size = NAV_FRAMES[form];
  stage.style.width = `${size.width + 72}px`;
  const frame = document.createElement('div');
  frame.className = 'nav-frame';
  frame.dataset.form = form;
  frame.style.cssText = `width:${size.width}px;height:${size.height}px`;
  const nav = makeNav({ id: 'nav', glass: options.glass, sample: options.sample, current: 1, accessory: form === 'bar' || form === 'minimized' });
  const force = options.force ?? (form === 'minimized' ? 'minimized' : null);
  if (force) nav.setAttribute('data-vire-force-state', force);
  frame.append(content(), nav);
  rows.append(frame);
}

export type NavSandboxOptions = {
  glass: '1' | '0' | 'touch';
  sample: BackdropSample | null;
  width: number;
  height: number;
  attrs: Record<string, string>;
  search: boolean;
  accessory: boolean;
  extra: number;
};

/** A resizable window with a scrolling list, SPA-style links and the events logged. */
export type NavSandboxHandle = { frame: HTMLElement; resize(width: number, height: number): void };

export function navSandbox(rows: HTMLElement, note: (text: string) => void, options: NavSandboxOptions): NavSandboxHandle {
  ensureCss();
  const frame = document.createElement('div');
  frame.className = 'nav-frame';
  frame.id = 'frame';
  frame.style.cssText = `width:${options.width}px;height:${options.height}px;margin:24px`;
  const scroll = document.createElement('div');
  scroll.className = 'nav-scroll';
  scroll.id = 'scroller';
  scroll.innerHTML = Array.from({ length: 40 }, (_, i) => `<div class="row"><i style="background:hsl(${(i * 37) % 360} 60% 70%)"></i>Track ${i + 1}</div>`).join('');
  const nav = makeNav({
    id: 'nav',
    glass: options.glass,
    sample: options.sample,
    search: options.search,
    accessory: options.accessory,
    extra: options.extra,
    attrs: { minimize: 'scroll', scroller: 'scroller', ...options.attrs },
  });
  frame.append(scroll, nav);

  nav.addEventListener('click', (e) => {
    const link = (e.target as Element).closest('a');
    if (!link || !nav.contains(link) || e.defaultPrevented) return;
    e.preventDefault();
    if (!link.hasAttribute('data-search')) {
      for (const other of nav.querySelectorAll('[aria-current]')) other.removeAttribute('aria-current');
      link.setAttribute('aria-current', 'page');
    }
    note(`click:${link.textContent!.replace(/\d+$/, '')}`);
  });
  nav.addEventListener('vire-nav-layout', (e) => {
    const d = (e as CustomEvent<{ form: string; minimized: boolean; accessoryPlacement: string | null; insets: { bottom: number; start: number } }>).detail;
    note(`layout:${d.form}:${d.minimized ? 'min' : 'full'}:${d.accessoryPlacement ?? '-'}:${d.insets.bottom}:${d.insets.start}`);
  });
  nav.addEventListener('vire-nav-collapse', (e) => note(`collapse:${(e as CustomEvent<{ collapsed: boolean }>).detail.collapsed}`));
  rows.append(frame);

  return {
    frame,
    resize(width, height) {
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
    },
  };
}

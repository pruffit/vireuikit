const HOST = ':is(vire-button,vire-icon-button)[data-vk]';
const BODY = `${HOST}>button`;

// Every rule is keyed on `data-vk`, set at upgrade, so a native button keeps its own look until
// then. Text takes the page's colour; frosted and contrast bodies assume `color-scheme` matches it.
export const STYLES = `
vire-button,vire-icon-button{display:inline-flex;vertical-align:middle}
${HOST}{position:relative;--vk-press:0;--vk-hover:0;--vk-body-alpha:0;--vk-body-white:0;--vk-body-lift:0;--vk-rim:1;--vk-grow:0;--vk-defocus:0;--vk-slop-x:0;--vk-slop-y:0}
${HOST}::before{content:'';position:absolute;inset:calc(var(--vk-slop-y)*-1px) calc(var(--vk-slop-x)*-1px)}
${BODY}{appearance:none;-webkit-appearance:none;box-sizing:border-box;margin:0;border:0;outline:none;
 font:inherit;font-weight:500;line-height:1;white-space:nowrap;color:inherit;
 display:inline-flex;align-items:center;justify-content:center;gap:8px;position:relative;
 height:var(--vk-height);min-width:var(--vk-height);padding:0 var(--vk-pad-x);border-radius:var(--vk-radius);
 -webkit-text-fill-color:color-mix(in srgb,currentColor calc((1 - var(--vk-press)*.55)*100%),transparent);
 text-shadow:0 0 calc(var(--vk-press)*var(--vk-defocus)*1px) currentColor;
 background:transparent;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-tap-highlight-color:transparent;
 transform:scale(calc(1 + var(--vk-press)*var(--vk-grow)))}
vire-icon-button[data-vk]>button{padding:0;width:var(--vk-height)}
${BODY}>svg{width:var(--vk-icon);height:var(--vk-icon);flex:none;
 opacity:calc(1 - var(--vk-press)*.45);filter:blur(calc(var(--vk-press)*var(--vk-defocus)*1px))}
${BODY}:disabled{cursor:default}
${HOST}[data-disabled]>button{-webkit-text-fill-color:color-mix(in srgb,currentColor 40%,transparent)}
${HOST}[data-disabled]>button>svg{opacity:.4}
${HOST}[data-focus]>button{outline:2px solid currentColor;outline-offset:2px}

${HOST}[data-surface=glass]>button{color:var(--vireglass-ink-color,inherit);
 background:color-mix(in srgb,color-mix(in srgb,#fff calc((var(--vk-body-white) + var(--vk-body-lift)*2)*100%),var(--vireglass-tint-color,#fff)) calc(var(--vk-body-alpha)*100%),transparent);
 background:oklab(from color-mix(in srgb,#fff calc(var(--vk-body-white)*100%),var(--vireglass-tint-color,#fff)) calc(l + var(--vk-body-lift)) a b / var(--vk-body-alpha))}
${HOST}[data-surface=glass]>button::after{opacity:var(--vk-rim)}
${HOST}[data-frost][data-surface=glass]>button{color:oklab(from var(--vireglass-tint-color,#fff) calc(.95 - .87*clamp(0,(l + var(--vk-body-lift) - .6)*20,1)) 0 0)}

${HOST}[data-surface=plain]>button{background:color-mix(in srgb,currentColor calc(10% + var(--vk-hover)*6% + var(--vk-press)*14%),transparent)}

${HOST}[data-surface=frosted]>button{
 background:color-mix(in srgb,Canvas calc(88% - var(--vk-hover)*4% - var(--vk-press)*10%),currentColor);
 backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
 box-shadow:0 1px 3px color-mix(in srgb,currentColor 22%,transparent)}

@supports not (color:oklab(from red l a b)){
${HOST}[data-frost][data-surface=glass]>button{color:inherit;background:color-mix(in srgb,Canvas 82%,currentColor)}
}

${HOST}[data-contrast]:is([data-surface=plain],[data-surface=frosted])>button{box-shadow:inset 0 0 0 2px currentColor}
${HOST}[data-contrast][data-surface=frosted]>button{background:Canvas}
${HOST}[data-contrast][data-surface=glass]>button{background:color-mix(in srgb,color-mix(in srgb,#fff calc((1 - var(--vireglass-ink,0))*100%),#000) 88%,transparent)}

@media (forced-colors:active){
${BODY}{-webkit-text-fill-color:currentColor;text-shadow:none;color:ButtonText;background:ButtonFace;border:1px solid ButtonText;backdrop-filter:none;-webkit-backdrop-filter:none;transform:none}
${BODY}>svg{opacity:1;filter:none}
${HOST}[data-disabled]>button{-webkit-text-fill-color:currentColor;color:GrayText;border-color:GrayText}
${HOST}[data-focus]>button{outline-color:Highlight}
}
`;

const STYLE_ATTR = 'data-vireuikit';

export function ensureStyles(from: Element, nonce?: string): void {
  const root = from.getRootNode();
  const host: Document | ShadowRoot = root instanceof ShadowRoot ? root : from.ownerDocument;
  if (host.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = from.ownerDocument.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  if (nonce) style.nonce = nonce;
  style.textContent = STYLES;
  (host instanceof ShadowRoot ? host : host.head).appendChild(style);
}

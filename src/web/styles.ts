const HOST = ':is(vire-button,vire-icon-button)[data-vk]';
const BODY = `${HOST}>button`;
const MENU = 'vire-menu[data-vk]';
const SURFACE = `${MENU}>[popover]`;
const ITEM = `${SURFACE}>button`;
const NAV = 'vire-nav[data-vk]';
const BODIES = `${NAV}>nav,${NAV}>[data-accessory]`;
const LINKS = `${NAV}>nav a`;
const CIRCLE = '[data-form=bar]>nav>a[data-search]';

const GLASS_BODY = `background:color-mix(in srgb,color-mix(in srgb,#fff calc((var(--vk-body-white) + var(--vk-body-lift)*2)*100%),var(--vireglass-tint-color,#fff)) calc(var(--vk-body-alpha)*100%),transparent);
 background:oklab(from color-mix(in srgb,#fff calc(var(--vk-body-white)*100%),var(--vireglass-tint-color,#fff)) calc(l + var(--vk-body-lift)) a b / var(--vk-body-alpha))`;
const FROST_INK = 'color:oklab(from var(--vireglass-tint-color,#fff) calc(.95 - .87*clamp(0,(l + var(--vk-body-lift) - .6)*20,1)) 0 0)';
const CONTRAST_GLASS = 'background:color-mix(in srgb,color-mix(in srgb,#fff calc((1 - var(--vireglass-ink,0))*100%),#000) 88%,transparent)';
const SHADOW = 'box-shadow:0 0 0 1px color-mix(in srgb,currentColor 14%,transparent),0 10px 30px color-mix(in srgb,currentColor 18%,transparent)';

// Every rule is keyed on `data-vk`, set at upgrade, so native markup keeps its own look until
// then. Text takes the page's colour; frosted and contrast bodies assume `color-scheme` matches it.
export const STYLES = `
vire-button,vire-icon-button,vire-menu{display:inline-flex;vertical-align:middle}
${HOST}{position:relative;--vk-press:0;--vk-hover:0;--vk-carry:1;--vk-body-alpha:0;--vk-body-white:0;--vk-body-lift:0;--vk-grow:0;--vk-defocus:0;--vk-slop-x:0;--vk-slop-y:0}
${HOST}::before{content:'';position:absolute;inset:calc(var(--vk-slop-y)*-1px) calc(var(--vk-slop-x)*-1px)}
${BODY}{appearance:none;-webkit-appearance:none;box-sizing:border-box;margin:0;border:0;outline:none;
 font:inherit;font-weight:500;line-height:1;white-space:nowrap;color:inherit;
 display:inline-flex;align-items:center;justify-content:center;gap:8px;position:relative;
 height:var(--vk-height);min-width:var(--vk-height);padding:0 var(--vk-pad-x);border-radius:var(--vk-radius);
 -webkit-text-fill-color:color-mix(in srgb,currentColor calc((1 - var(--vk-press)*.55)*var(--vk-carry)*100%),transparent);
 text-shadow:0 0 calc((var(--vk-press)*var(--vk-defocus) + (1 - var(--vk-carry))*4)*1px) color-mix(in srgb,currentColor calc(var(--vk-carry)*100%),transparent);
 background:transparent;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-tap-highlight-color:transparent;
 transform:scale(calc(1 + var(--vk-press)*var(--vk-grow)))}
vire-icon-button[data-vk]>button{padding:0;width:var(--vk-height)}
${BODY}>svg{width:var(--vk-icon);height:var(--vk-icon);flex:none;
 opacity:calc((1 - var(--vk-press)*.45)*var(--vk-carry));filter:blur(calc((var(--vk-press)*var(--vk-defocus) + (1 - var(--vk-carry))*4)*1px))}
${BODY}:disabled{cursor:default}
${HOST}[data-disabled]>button{-webkit-text-fill-color:color-mix(in srgb,currentColor 40%,transparent)}
${HOST}[data-disabled]>button>svg{opacity:.4}
${HOST}[data-focus]>button{outline:2px solid currentColor;outline-offset:2px}

${HOST}[data-surface=glass]>button{color:var(--vireglass-ink-color,inherit);
 ${GLASS_BODY}}
${HOST}[data-frost][data-surface=glass]>button{${FROST_INK}}

${HOST}[data-surface=plain]>button{background:color-mix(in srgb,currentColor calc(10% + var(--vk-hover)*6% + var(--vk-press)*14%),transparent)}

${HOST}[data-surface=frosted]>button{
 background:color-mix(in srgb,Canvas calc(88% - var(--vk-hover)*4% - var(--vk-press)*10%),currentColor);
 backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
 box-shadow:0 1px 3px color-mix(in srgb,currentColor 22%,transparent)}

${MENU}{position:relative;--vk-ink-in:1;--vk-cx:0px;--vk-cy:0px}
${SURFACE}{position:fixed;inset:auto;left:var(--vk-x,0);top:var(--vk-y,0);width:var(--vk-w,auto);height:var(--vk-h,auto);
 margin:0;padding:var(--vk-menu-pad);border:0;border-radius:var(--vk-r,var(--vk-menu-radius));box-sizing:border-box;
 overflow:clip;color:inherit;font:inherit;background:transparent;outline:none;
 --vk-body-alpha:0;--vk-body-white:0;--vk-body-lift:0}
${SURFACE}:popover-open{display:flex;flex-direction:column;align-items:flex-start}
${MENU}[data-phase=open]>[popover][data-scroll]{overflow-y:auto}
${ITEM}{appearance:none;-webkit-appearance:none;box-sizing:border-box;margin:0;border:0;outline:none;flex:none;position:relative;
 font:inherit;line-height:1.2;color:inherit;text-align:start;white-space:nowrap;
 display:flex;align-items:center;width:var(--vk-content-w,auto);height:var(--vk-menu-row);
 padding-block:0;padding-inline:var(--vk-label-pad) var(--vk-menu-row);border-radius:var(--vk-item-radius);
 background:color-mix(in srgb,currentColor calc(var(--vk-fill,0)*100%),transparent);
 cursor:pointer;user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
${SURFACE}:has(>button>svg)>button{padding-inline-start:var(--vk-menu-row)}
${ITEM}>svg{position:absolute;inset-inline-start:calc((var(--vk-menu-row) - var(--vk-menu-icon))/2);top:calc((var(--vk-menu-row) - var(--vk-menu-icon))/2);
 width:var(--vk-menu-icon);height:var(--vk-menu-icon)}
${ITEM}:is(:focus,[data-vire-force-state=hover]){--vk-fill:var(--vk-fill-active)}
${ITEM}:is([data-pressed],[data-vire-force-state=pressed]){--vk-fill:var(--vk-fill-pressed)}
${ITEM}:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
${ITEM}:is(:disabled,[aria-disabled=true]){cursor:default;--vk-fill:0;-webkit-text-fill-color:color-mix(in srgb,currentColor 40%,transparent)}
${ITEM}:is(:disabled,[aria-disabled=true])>svg{opacity:.4}
${MENU}[data-phase=moving]>[popover]{padding:0}
${MENU}[data-phase=moving]>[popover]>*{transform:translate(calc(var(--vk-cx) + var(--vk-menu-pad)),calc(var(--vk-cy) + var(--vk-menu-pad)));
 opacity:min(1,calc(var(--vk-ink-in)*2));filter:blur(calc((1 - var(--vk-ink-in))*8px))}
${MENU}[data-measure]>[popover]{width:max-content!important;height:auto!important;left:0!important;top:0!important;padding:var(--vk-menu-pad)!important;visibility:hidden}
${MENU}[data-measure]>[popover]>*{width:auto!important;transform:none!important}

${MENU}[data-surface=glass]>[popover]{color:var(--vireglass-ink-color,inherit);
 ${GLASS_BODY}}
${MENU}[data-frost][data-surface=glass]>[popover]{${FROST_INK}}
${MENU}[data-surface=plain]>[popover]{background:Canvas;${SHADOW}}
${MENU}[data-surface=frosted]>[popover]{background:color-mix(in srgb,Canvas 88%,currentColor);
 backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);${SHADOW}}

${NAV}{display:block;position:absolute;inset:0;pointer-events:none;--vk-ink:1;--vk-nav-icon:24px;--vk-body-alpha:0;--vk-body-white:0;--vk-body-lift:0}
${BODIES}{position:absolute;left:var(--vk-x,0px);top:var(--vk-y,0px);width:var(--vk-w,0px);height:var(--vk-h,0px);
 box-sizing:border-box;margin:0;padding:0;border-radius:var(--vk-r,0px);color:inherit;font:inherit}
${NAV}>nav{pointer-events:auto;touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;scrollbar-width:none}
${NAV}>[data-accessory]{pointer-events:auto;overflow:clip}
${NAV}>nav ul{position:absolute;inset:0;margin:0;padding:0;list-style:none;overflow:clip;border-radius:inherit;pointer-events:none}
${NAV}>nav li{display:block;height:0;margin:0;padding:0}
${NAV}>nav [hidden],${NAV}>[data-accessory][hidden]{display:none!important}
${NAV}[data-scroll]>nav{overflow-x:clip;overflow-y:auto}
${NAV}[data-scroll]>nav ul{position:static;overflow:visible}
${LINKS},${NAV}>nav>a{position:absolute;left:calc(var(--vk-lx,0px) - var(--vk-x,0px));top:calc(var(--vk-ly,0px) - var(--vk-y,0px));
 width:var(--vk-lw,0px);height:var(--vk-lh,0px);box-sizing:border-box;margin:0;padding:0;border-radius:var(--vk-lr,0px);
 display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
 color:inherit;text-decoration:none;font-size:11px;line-height:12px;font-weight:500;white-space:nowrap;
 pointer-events:auto;outline:none;-webkit-user-drag:none;touch-action:manipulation}
${LINKS}::before{content:'';position:absolute;inset:calc(var(--vk-slop-y,0)*-1px) calc(var(--vk-slop-x,0)*-1px)}
${LINKS}>svg{width:var(--vk-nav-icon);height:var(--vk-nav-icon);flex:none}
${LINKS}:focus-visible,${NAV}>nav>button:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
${LINKS}[data-lens-over]{background:color-mix(in srgb,currentColor 12%,transparent)}
@media (hover:hover){${LINKS}:hover{background:color-mix(in srgb,currentColor 7%,transparent)}}
${NAV}[data-form=sidebar]>nav a{flex-direction:row;justify-content:flex-start;gap:12px;padding-inline:12px;font-size:15px;line-height:20px}
${NAV}[data-form=sidebar]>nav>a[data-search]{background:color-mix(in srgb,currentColor 8%,transparent)}
${NAV}[data-form=bar]>nav>a[data-search],${NAV}[data-minimized]>nav a{font-size:0;line-height:0;gap:0;padding-inline:0;justify-content:center}
${LINKS} [data-badge]{position:absolute;top:4px;inset-inline-start:calc(50% + 6px);min-width:16px;height:16px;box-sizing:border-box;padding:0 4px;
 border-radius:8px;background:var(--vire-nav-badge,#e5484d);color:#fff;font-size:11px;line-height:16px;text-align:center}
${LINKS} [data-badge]:empty{min-width:8px;width:8px;height:8px;padding:0;top:8px}
${NAV}[data-form=sidebar]>nav [data-badge]{inset-inline-start:30px}
${NAV}[data-form=sidebar]>nav [data-badge]:not(:empty){inset-inline-start:auto;inset-inline-end:12px;top:calc(50% - 8px)}
${NAV}>nav>[data-vk-pill]{position:absolute;left:calc(var(--vk-px,0px) - var(--vk-x,0px));top:calc(var(--vk-py,0px) - var(--vk-y,0px));
 width:var(--vk-pw,0px);height:var(--vk-ph,0px);border-radius:var(--vk-pr,0px);box-sizing:border-box;pointer-events:none;
 background:color-mix(in srgb,currentColor 14%,transparent);opacity:var(--vk-pill-op,1)}
${NAV}>nav>button[data-vk-toggle]{appearance:none;-webkit-appearance:none;position:absolute;left:calc(var(--vk-lx,0px) - var(--vk-x,0px));top:calc(var(--vk-ly,0px) - var(--vk-y,0px));
 width:var(--vk-lw,0px);height:var(--vk-lh,0px);box-sizing:border-box;margin:0;padding:0;border:0;border-radius:50%;outline:none;
 display:grid;place-items:center;background:transparent;color:inherit;cursor:pointer;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
${NAV}>nav>button[data-vk-toggle][hidden]{display:none}
${NAV}>nav>button[data-vk-toggle]>svg{width:22px;height:22px}
@media (hover:hover){${NAV}>nav>button[data-vk-toggle]:hover{background:color-mix(in srgb,currentColor 8%,transparent)}}
${NAV}[data-moving]>nav>:is(ul,a,button){opacity:var(--vk-ink);filter:blur(calc((1 - var(--vk-ink))*6px))}
${NAV}[data-moving]>[data-accessory][data-moving]>*{opacity:var(--vk-ink);filter:blur(calc((1 - var(--vk-ink))*6px))}
${NAV}>[data-vk-lens]{position:absolute;left:var(--vk-x,0px);top:var(--vk-y,0px);width:var(--vk-w,0px);height:var(--vk-h,0px);box-sizing:border-box;
 border-radius:var(--vk-r,0px);display:none;align-items:center;justify-content:center;overflow:clip;pointer-events:none;color:inherit;
 font-size:11px;line-height:12px;font-weight:500;white-space:nowrap}
${NAV}[data-lens]>[data-vk-lens]{display:flex}
${NAV}>[data-vk-lens]>div{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
 transform:scale(calc(1 + .15*var(--vk-lift,0)));opacity:var(--vk-lift,0)}
${NAV}>[data-vk-lens]>div>svg{width:var(--vk-nav-icon);height:var(--vk-nav-icon);flex:none}
${NAV}>[data-vk-lens][data-form=sidebar]>div{flex-direction:row;gap:12px;font-size:15px;line-height:20px}
${NAV}>[data-vk-lens][data-dragging]>div{opacity:0}
${NAV}[data-minimized]>[data-vk-lens]>div,${NAV}[data-form=bar][data-minimized]>[data-vk-lens]>div{font-size:0}
${NAV}>[data-vk-scrim]{position:absolute;inset:0;pointer-events:auto;background:color-mix(in srgb,CanvasText 28%,transparent)}

${NAV}[data-surface=glass]>nav,${NAV}[data-surface=glass]>[data-accessory],${NAV}[data-surface=glass]>[data-vk-lens],${NAV}[data-surface=glass]${CIRCLE}{color:var(--vireglass-ink-color,inherit);
 ${GLASS_BODY}}
${NAV}[data-frost][data-surface=glass]>nav,${NAV}[data-frost][data-surface=glass]>[data-accessory],${NAV}[data-frost][data-surface=glass]>[data-vk-lens],${NAV}[data-frost][data-surface=glass]${CIRCLE}{${FROST_INK}}
${NAV}[data-surface=plain]>:is(nav,[data-accessory]),${NAV}[data-surface=plain]${CIRCLE}{background:Canvas;${SHADOW}}
${NAV}[data-surface=plain]>[data-vk-lens]{background:color-mix(in srgb,currentColor 16%,transparent)}
${NAV}[data-surface=frosted]>:is(nav,[data-accessory]),${NAV}[data-surface=frosted]${CIRCLE}{background:color-mix(in srgb,Canvas 88%,currentColor);
 backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);${SHADOW}}
${NAV}[data-surface=frosted]>[data-vk-lens]{background:color-mix(in srgb,currentColor 18%,transparent)}
${NAV}[data-contrast]:is([data-surface=plain],[data-surface=frosted])>:is(nav,[data-accessory]),${NAV}[data-contrast]:is([data-surface=plain],[data-surface=frosted])${CIRCLE}{background:Canvas;box-shadow:inset 0 0 0 2px currentColor}
${NAV}[data-contrast][data-surface=glass]>:is(nav,[data-accessory]),${NAV}[data-contrast][data-surface=glass]${CIRCLE}{${CONTRAST_GLASS}}
${NAV}[data-contrast]>nav>[data-vk-pill]{box-shadow:inset 0 0 0 2px currentColor}

@supports not (color:oklab(from red l a b)){
${HOST}[data-frost][data-surface=glass]>button,${MENU}[data-frost][data-surface=glass]>[popover]{color:inherit;background:color-mix(in srgb,Canvas 82%,currentColor)}
}

${HOST}[data-contrast]:is([data-surface=plain],[data-surface=frosted])>button{box-shadow:inset 0 0 0 2px currentColor}
${HOST}[data-contrast][data-surface=frosted]>button{background:Canvas}
${HOST}[data-contrast][data-surface=glass]>button{${CONTRAST_GLASS}}
${MENU}[data-contrast]:is([data-surface=plain],[data-surface=frosted])>[popover]{background:Canvas;box-shadow:inset 0 0 0 2px currentColor}
${MENU}[data-contrast][data-surface=glass]>[popover]{${CONTRAST_GLASS}}

${HOST}[data-carried]>button{background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important;pointer-events:none}
${HOST}[data-carried]>button::after{visibility:hidden}

@media (forced-colors:active){
${BODY}{-webkit-text-fill-color:currentColor;text-shadow:none;color:ButtonText;background:ButtonFace;border:1px solid ButtonText;backdrop-filter:none;-webkit-backdrop-filter:none;transform:none}
${BODY}>svg{opacity:1;filter:none}
${HOST}[data-disabled]>button{-webkit-text-fill-color:currentColor;color:GrayText;border-color:GrayText}
${HOST}[data-focus]>button{outline-color:Highlight}
${BODIES}{color:CanvasText!important;background:Canvas!important;border:1px solid CanvasText;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${NAV}>[data-vk-lens]{display:none!important}
${NAV}>nav>[data-vk-pill]{background:Highlight;opacity:.4}
${NAV}>nav>:is(ul,a,button){filter:none!important;opacity:1!important}
${SURFACE}{color:CanvasText!important;background:Canvas!important;border:1px solid CanvasText;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${SURFACE}>*{filter:none!important;opacity:1!important}
${ITEM}{-webkit-text-fill-color:currentColor!important;color:CanvasText;background:Canvas}
${ITEM}:is(:focus,[data-vire-force-state=hover],[data-pressed]){color:HighlightText;background:Highlight}
${ITEM}:is(:disabled,[aria-disabled=true]){color:GrayText;background:Canvas}
${HOST}[data-carried]>button{opacity:var(--vk-carry)}
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

const HOST = ':is(vire-button,vire-icon-button)[data-vk]';
const BODY = `${HOST}>button`;
const MENU = 'vire-menu[data-vk]';
const SURFACE = `${MENU}>[popover]`;
const ITEM = `${SURFACE}>button`;

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
${ITEM}:disabled{cursor:default;--vk-fill:0;-webkit-text-fill-color:color-mix(in srgb,currentColor 40%,transparent)}
${ITEM}:disabled>svg{opacity:.4}
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

@supports not (color:oklab(from red l a b)){
${HOST}[data-frost][data-surface=glass]>button,${MENU}[data-frost][data-surface=glass]>[popover]{color:inherit;background:color-mix(in srgb,Canvas 82%,currentColor)}
}

${HOST}[data-contrast]:is([data-surface=plain],[data-surface=frosted])>button{box-shadow:inset 0 0 0 2px currentColor}
${HOST}[data-contrast][data-surface=frosted]>button{background:Canvas}
${HOST}[data-contrast][data-surface=glass]>button{${CONTRAST_GLASS}}
${MENU}[data-contrast]:is([data-surface=plain],[data-surface=frosted])>[popover]{background:Canvas;box-shadow:inset 0 0 0 2px currentColor}
${MENU}[data-contrast][data-surface=glass]>[popover]{${CONTRAST_GLASS}}

${HOST}[data-carried]>button{background:transparent!important}
${HOST}[data-carried]>button::after{visibility:hidden}

@media (forced-colors:active){
${BODY}{-webkit-text-fill-color:currentColor;text-shadow:none;color:ButtonText;background:ButtonFace;border:1px solid ButtonText;backdrop-filter:none;-webkit-backdrop-filter:none;transform:none}
${BODY}>svg{opacity:1;filter:none}
${HOST}[data-disabled]>button{-webkit-text-fill-color:currentColor;color:GrayText;border-color:GrayText}
${HOST}[data-focus]>button{outline-color:Highlight}
${SURFACE}{color:CanvasText!important;background:Canvas!important;border:1px solid CanvasText;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${SURFACE}>*{filter:none!important;opacity:1!important}
${ITEM}{-webkit-text-fill-color:currentColor!important;color:CanvasText;background:Canvas}
${ITEM}:is(:focus,[data-vire-force-state=hover],[data-pressed]){color:HighlightText;background:Highlight}
${ITEM}:disabled{color:GrayText;background:Canvas}
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

/**
 * Console screenshots (console-command@1 op `screenshot`): a small DOM-to-canvas capture, no library. The page is cloned
 * with what CSS can't see carried over (form values, scroll offsets of inner panes, canvases), wrapped with the page's
 * own stylesheets in an SVG foreignObject, drawn onto a canvas and encoded as PNG. The whole viewport is captured, or
 * the part one element covers (cloning the whole page keeps every ancestor selector working for that element).
 *
 * Limits of the approach: fonts and images loaded from URLs inside the clone may fall back (an SVG image loads nothing
 * from the network), and a browser that taints foreignObject canvases (Safari) cannot export the image; the error says so.
 * Password and secret inputs are never copied into the image.
 */
import { CONSOLE_SHOT_MAX_BYTES, CONSOLE_SHOT_MAX_WIDTH } from '@console/axf/core/engines/console-commands.mjs';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SKIP = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
/** The smallest scale tried when the PNG is over the byte limit. */
const MIN_SCALE = 0.35;

export interface Capture { blob: Blob; width: number; height: number; scale: number; capture: string }

/** The page's stylesheets as text (same-origin ones; a cross-origin sheet's rules can't be read). `:root` is the html element of the clone. */
function pageCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try { for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText); } catch { /* cross-origin sheet */ }
  }
  return out.join('\n').replace(/:root\b/g, 'html');
}

const secret = (el: HTMLInputElement) => el.type === 'password' || el.autocomplete === 'current-password' || el.autocomplete === 'new-password' || el.dataset.secret !== undefined;

/** Carry over what the clone loses: input values, checked boxes, selected options, canvases, inner scroll offsets. */
function carry(src: Element, dst: Element): void {
  if (src instanceof HTMLCanvasElement) {
    try {
      const img = document.createElement('img');
      img.src = src.toDataURL();
      for (const a of Array.from(src.attributes)) if (a.name !== 'width' && a.name !== 'height') img.setAttribute(a.name, a.value);
      img.width = src.clientWidth || src.width;
      img.height = src.clientHeight || src.height;
      dst.replaceWith(img);
    } catch { /* a tainted canvas stays blank */ }
    return;
  }
  if (src instanceof HTMLInputElement) {
    if (src.type === 'checkbox' || src.type === 'radio') { if (src.checked) dst.setAttribute('checked', ''); else dst.removeAttribute('checked'); }
    else dst.setAttribute('value', secret(src) ? (src.value ? '••••••••' : '') : src.value);
  } else if (src instanceof HTMLTextAreaElement) dst.textContent = src.value;
  else if (src instanceof HTMLSelectElement) {
    Array.from(src.options).forEach((o, i) => { const d = (dst as HTMLSelectElement).options[i]; if (d) { if (o.selected) d.setAttribute('selected', ''); else d.removeAttribute('selected'); } });
  }
  const srcKids = Array.from(src.children);
  const dstKids = Array.from(dst.children);
  if ((src.scrollTop || src.scrollLeft) && dst instanceof HTMLElement) {
    dst.style.overflow = 'hidden';
    for (const k of dstKids) if (k instanceof HTMLElement) k.style.translate = `${-src.scrollLeft}px ${-src.scrollTop}px`;
  }
  srcKids.forEach((k, i) => {
    const d = dstKids[i];
    if (!d) return;
    if (SKIP.has(k.tagName) || k.tagName === 'IFRAME' || k.tagName === 'VIDEO') { if (SKIP.has(k.tagName)) d.remove(); else d.replaceWith(document.createElement('div')); return; }
    carry(k, d);
  });
}

/** The page as an XHTML string laid out at the viewport size. */
function pageMarkup(vw: number, vh: number): string {
  const html = document.createElementNS(XHTML, 'html');
  for (const a of Array.from(document.documentElement.attributes)) html.setAttribute(a.name, a.value);
  html.setAttribute('style', `${document.documentElement.getAttribute('style') ?? ''};width:${vw}px;height:${vh}px;overflow:hidden;margin:0`);
  const style = document.createElementNS(XHTML, 'style');
  style.textContent = pageCss();
  const body = document.body.cloneNode(true) as HTMLElement;
  carry(document.body, body);
  if (window.scrollX || window.scrollY) body.style.translate = `${-window.scrollX}px ${-window.scrollY}px`;
  html.append(style, body);
  return new XMLSerializer().serializeToString(html);
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('the browser could not draw the page'));
  img.src = src;
});

const toPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the browser returned no image'))), 'image/png'); } catch (e) {
    reject(new Error((e as Error)?.name === 'SecurityError' ? 'this browser blocks reading back a drawn page (Safari does); capture from Chrome or Firefox' : String((e as Error)?.message ?? e)));
  }
});

/**
 * Capture the viewport, or the part of it `el` covers, as a PNG at most CONSOLE_SHOT_MAX_WIDTH wide and
 * CONSOLE_SHOT_MAX_BYTES big (it is drawn smaller until it fits).
 */
export async function capturePage(el: Element | null, capture: string): Promise<Capture> {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  let x = 0, y = 0, w = vw, h = vh;
  if (el) {
    const r = el.getBoundingClientRect();
    x = Math.max(0, r.left); y = Math.max(0, r.top);
    w = Math.min(vw, r.right) - x; h = Math.min(vh, r.bottom) - y;
    if (w < 1 || h < 1) throw new Error(`${capture} is not on screen (scrolled away or hidden)`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"><foreignObject x="0" y="0" width="${vw}" height="${vh}">${pageMarkup(vw, vh)}</foreignObject></svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const bg = getComputedStyle(document.body).backgroundColor || getComputedStyle(document.documentElement).backgroundColor;
  let scale = Math.min(window.devicePixelRatio || 1, CONSOLE_SHOT_MAX_WIDTH / w);
  for (;;) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('this browser has no 2D canvas');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await toPng(canvas);
    if (blob.size <= CONSOLE_SHOT_MAX_BYTES) return { blob, width: canvas.width, height: canvas.height, scale: Math.round(scale * 100) / 100, capture };
    if (scale <= MIN_SCALE) throw new Error(`the screenshot stays over ${Math.round(CONSOLE_SHOT_MAX_BYTES / 1e6)} MB even small; capture one panel instead`);
    scale = Math.max(MIN_SCALE, scale * 0.7);
  }
}

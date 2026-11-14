/**
 * Colour picker (themed-controls@1 family `color`): the field is a swatch button + the hex value; the picker (popover
 * on a wide screen, bottom sheet on a phone) has the colour theme's swatches, the page's <datalist> colours, recent
 * colours, a saturation / brightness area with a hue strip, and a hex field. Dragging sends `input` to the original
 * like the browser's picker does; Done (or Enter) sends `change`; Cancel / Escape puts the colour back.
 * Keyboard: swatch lists move with the arrow keys; the area moves with the arrows (Shift = ×10); the hue strip too.
 */
import type { ElementFamily, Swap, SwapCtx } from '../host';
import { aria, h } from './dom';
import { openSurface, type OpenSurface } from './surface';

/* ---------------- colour maths ---------------- */

export interface Hsv { h: number; s: number; v: number }
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
export function normHex(s: string): string | null {
  const m = HEX.exec(s.trim());
  if (!m) return null;
  const x = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  return `#${x.toLowerCase()}`;
}
export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (hh * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
export function hsvToHex({ h: hh, s, v }: Hsv): string {
  const f = (n: number) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** A CSS colour (a theme token's computed value) → #rrggbb through the canvas parser; null when it isn't opaque. */
function cssToHex(css: string): string | null {
  const c = document.createElement('canvas').getContext('2d');
  if (!c || !css || !CSS.supports('color', css)) return null;
  c.fillStyle = css;
  return typeof c.fillStyle === 'string' && c.fillStyle.startsWith('#') ? c.fillStyle.toLowerCase() : null;
}

const THEME_TOKENS = ['accent', 'info', 'success', 'warning', 'danger', 'text', 'muted', 'border', 'surface', 'bg'];
function themeSwatches(): { hex: string; name: string }[] {
  const cs = getComputedStyle(document.documentElement);
  const out: { hex: string; name: string }[] = [];
  for (const t of THEME_TOKENS) {
    const hex = cssToHex(cs.getPropertyValue(`--fx-${t}`).trim());
    if (hex && !out.some((x) => x.hex === hex)) out.push({ hex, name: `Theme ${t}` });
  }
  return out;
}

const RECENT_KEY = 'axf.themedControls.recentColors';
const recentMax = () => { const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fx-tc-color-recent')); return Number.isFinite(n) ? n : 8; };
export function recentColors(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!normHex(x)) : []; } catch { return []; }
}
function remember(hex: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...recentColors().filter((x) => x !== hex)].slice(0, Math.max(0, recentMax())))); } catch { /* private mode */ }
}

/* ---------------- swatch list (listbox, roving focus) ---------------- */

function swatchList(label: string, items: { hex: string; name: string }[], selected: string, onPick: (hex: string) => void): HTMLElement | null {
  if (!items.length) return null;
  const list = h('div', { class: 'fx-tc-swatches', role: 'listbox', 'aria-label': label, 'aria-orientation': 'horizontal' });
  const opts = items.map((it) => {
    const o = h('span', { class: 'fx-tc-swatch', role: 'option', tabindex: '-1', 'aria-label': `${it.name} ${it.hex}`, 'aria-selected': it.hex === selected ? 'true' : 'false', 'data-hex': it.hex });
    o.style.setProperty('--tc-color', it.hex);
    o.addEventListener('click', () => onPick(it.hex));
    return o;
  });
  (opts.find((o) => o.getAttribute('aria-selected') === 'true') ?? opts[0])!.tabIndex = 0;
  list.append(...opts);
  list.addEventListener('keydown', (e) => {
    const i = opts.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const to: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: opts.length - 1 };
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(opts[i]!.dataset.hex!); return; }
    if (!(e.key in to)) return;
    e.preventDefault();
    const n = (to[e.key]! + opts.length) % opts.length;
    opts[i]!.tabIndex = -1;
    opts[n]!.tabIndex = 0;
    opts[n]!.focus();
  });
  return list;
}

/* ---------------- the family ---------------- */

export const colorFamily: ElementFamily = {
  family: 'color',
  selector: 'input[type="color"]',
  mount(ctx: SwapCtx): Swap {
    let p = ctx.props();
    const swatchBtn = h('button', { type: 'button', class: 'fx-iconbtn fx-tc-color__btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, h('span', { class: 'fx-tc-color__chip', 'aria-hidden': 'true' }));
    const hexField = h('input', { type: 'text', class: 'fx-input fx-tc-color__hex', autocomplete: 'off', spellcheck: 'false', maxlength: '7', 'aria-label': 'Hex colour' });
    const el = h('span', { class: 'fx-tc-color' }, swatchBtn, hexField);
    let surface: OpenSurface | null = null;
    let before = '';

    const label = () => (p.label && !String(p.label).startsWith('#') ? String(p.label) : ctx.labelText()) || 'Colour';
    const live = (hex: string) => { if (hex !== ctx.input.value) ctx.setValue(hex, false); };
    const commit = (hex: string) => { before = hex; ctx.setValue(hex, true); remember(hex); };

    const open = () => {
      if (surface || ctx.input.disabled || ctx.input.readOnly) return;
      before = ctx.input.value;
      let hsv = hexToHsv(before);
      const content = h('div', { class: 'fx-tc-picker fx-tc-colorpick' });
      const area = h('div', { class: 'fx-tc-colorpick__area', role: 'slider', tabindex: '0', 'aria-label': 'Saturation and brightness', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { class: 'fx-tc-colorpick__dot', 'aria-hidden': 'true' }));
      const hue = h('div', { class: 'fx-tc-colorpick__hue', role: 'slider', tabindex: '0', 'aria-label': 'Hue', 'aria-valuemin': '0', 'aria-valuemax': '360' }, h('span', { class: 'fx-tc-colorpick__hue-thumb', 'aria-hidden': 'true' }));
      const hex = h('input', { type: 'text', class: 'fx-input fx-tc-colorpick__hex', 'aria-label': 'Hex colour', maxlength: '7', spellcheck: 'false', autocomplete: 'off' });
      const preview = h('span', { class: 'fx-tc-colorpick__preview', 'aria-hidden': 'true' });
      const draw = () => {
        const cur = hsvToHex(hsv);
        content.style.setProperty('--tc-hue', hsvToHex({ h: hsv.h, s: 1, v: 1 }));
        content.style.setProperty('--tc-color', cur);
        content.style.setProperty('--tc-s', String(hsv.s));
        content.style.setProperty('--tc-v', String(hsv.v));
        content.style.setProperty('--tc-h', String(hsv.h / 360));
        aria(area, { 'aria-valuenow': String(Math.round(hsv.s * 100)), 'aria-valuetext': `saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%` });
        aria(hue, { 'aria-valuenow': String(Math.round(hsv.h)), 'aria-valuetext': `hue ${Math.round(hsv.h)} degrees` });
        if (document.activeElement !== hex) hex.value = cur;
        content.querySelectorAll<HTMLElement>('.fx-tc-swatch').forEach((s) => s.setAttribute('aria-selected', s.dataset.hex === cur ? 'true' : 'false'));
      };
      const set = (next: Hsv, send = true) => { hsv = next; draw(); if (send) live(hsvToHex(hsv)); };
      const pickHex = (x: string) => { set(hexToHsv(x)); };
      const drag = (target: HTMLElement, at: (r: DOMRect, e: PointerEvent) => void) => {
        target.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          target.setPointerCapture?.(e.pointerId);
          target.focus();
          at(target.getBoundingClientRect(), e);
          const move = (ev: PointerEvent) => at(target.getBoundingClientRect(), ev);
          const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
          target.addEventListener('pointermove', move);
          target.addEventListener('pointerup', up);
        });
      };
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      drag(area, (r, e) => set({ ...hsv, s: clamp((e.clientX - r.left) / (r.width || 1)), v: 1 - clamp((e.clientY - r.top) / (r.height || 1)) }));
      drag(hue, (r, e) => set({ ...hsv, h: clamp((e.clientX - r.left) / (r.width || 1)) * 359.99 }));
      area.addEventListener('keydown', (e) => {
        const d = e.shiftKey ? 0.1 : 0.01;
        const k: Record<string, Hsv> = { ArrowLeft: { ...hsv, s: clamp(hsv.s - d) }, ArrowRight: { ...hsv, s: clamp(hsv.s + d) }, ArrowUp: { ...hsv, v: clamp(hsv.v + d) }, ArrowDown: { ...hsv, v: clamp(hsv.v - d) } };
        if (e.key === 'Enter') { e.preventDefault(); done(); return; }
        if (!k[e.key]) return;
        e.preventDefault();
        set(k[e.key]!);
      });
      hue.addEventListener('keydown', (e) => {
        const d = e.shiftKey ? 10 : 1;
        const k: Record<string, number> = { ArrowLeft: hsv.h - d, ArrowDown: hsv.h - d, ArrowRight: hsv.h + d, ArrowUp: hsv.h + d, Home: 0, End: 359.99 };
        if (e.key === 'Enter') { e.preventDefault(); done(); return; }
        if (!(e.key in k)) return;
        e.preventDefault();
        set({ ...hsv, h: (k[e.key]! + 360) % 360 });
      });
      hex.addEventListener('input', () => { const x = normHex(hex.value); hex.toggleAttribute('aria-invalid', !x); if (x) set(hexToHsv(x)); });
      hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } });

      const cur = hsvToHex(hsv);
      const listIds = String(p.list ?? '');
      const dl = listIds ? document.getElementById(listIds) : null;
      const pageColours = dl instanceof HTMLDataListElement ? Array.from(dl.options).map((o) => normHex(o.value)).filter((x): x is string => !!x).map((x, i) => ({ hex: x, name: dl.options[i]?.label || 'Suggested' })) : [];
      const themeOn = getComputedStyle(document.documentElement).getPropertyValue('--fx-tc-color-theme-swatches').trim() !== '0';
      const groups = [
        swatchList('Suggested colours', pageColours, cur, pickHex),
        themeOn ? swatchList('Theme colours', themeSwatches(), cur, pickHex) : null,
        swatchList('Recent colours', recentColors().map((x) => ({ hex: x, name: 'Recent' })), cur, pickHex),
      ].filter((x): x is HTMLElement => !!x);
      const cancel = h('button', { type: 'button', class: 'fx-btn fx-btn--ghost' });
      cancel.textContent = 'Cancel';
      const ok = h('button', { type: 'button', class: 'fx-btn fx-btn--primary' });
      ok.textContent = 'Done';
      const done = () => { commit(hsvToHex(hsv)); surface?.close('done'); };
      cancel.addEventListener('click', () => surface?.close('escape'));
      ok.addEventListener('click', done);
      content.append(area, hue, h('div', { class: 'fx-tc-colorpick__row' }, preview, hex), ...groups, h('div', { class: 'fx-tc-picker__foot' }, cancel, ok));
      draw();
      swatchBtn.setAttribute('aria-expanded', 'true');
      surface = openSurface({
        surface: ctx.surface(), anchor: el, label: `${label()}: pick a colour`, content, family: 'color',
        initialFocus: () => area,
        onClose: (why) => {
          surface = null;
          swatchBtn.setAttribute('aria-expanded', 'false');
          // Cancel, Escape, a tap outside or a swipe put the colour back (Done and the API commit first)
          if (why !== 'done' && why !== 'api' && ctx.input.value !== before) ctx.setValue(before, false);
        },
      });
    };

    swatchBtn.addEventListener('click', () => (surface ? surface.close('escape') : open()));
    hexField.addEventListener('change', () => { const x = normHex(hexField.value); if (x) commit(x); else hexField.setAttribute('aria-invalid', 'true'); });
    hexField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const x = normHex(hexField.value); if (x) commit(x); } });

    return {
      el,
      focusEl: () => swatchBtn,
      sync(next) {
        p = next;
        const v = String(p.value);
        el.style.setProperty('--tc-color', v);
        if (document.activeElement !== hexField) { hexField.value = v; hexField.removeAttribute('aria-invalid'); }
        swatchBtn.setAttribute('aria-label', `${label()}: ${v}, pick a colour`);
        swatchBtn.disabled = hexField.disabled = !!p.disabled;
        hexField.readOnly = !!p.readOnly;
        aria(hexField, { 'aria-label': `${label()} hex`, 'aria-describedby': p.describedBy ? String(p.describedBy) : null, 'aria-invalid': p.invalid ? 'true' : null });
        el.toggleAttribute('data-disabled', !!p.disabled);
        el.toggleAttribute('data-invalid', !!p.invalid);
      },
      destroy() { surface?.close('api'); },
      state: () => ({ value: ctx.input.value, open: !!surface, surface: surface?.surface ?? null, recent: recentColors() }),
      set(v) {
        const s = String(v ?? '').trim();
        const x = normHex(s) ?? (s ? cssToHex(getComputedStyle(document.documentElement).getPropertyValue(`--fx-${s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).trim() || s) : null);
        if (!x) throw new Error(`"${s}" is not a colour (#rrggbb, a theme colour name or a CSS colour name)`);
        commit(x);
      },
      open,
      close: () => surface?.close('api'),
    };
  },
};

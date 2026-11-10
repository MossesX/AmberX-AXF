/**
 * The applier: inline-override@1 records → CSS on the very elements they address, in this console, live.
 *
 * Every element whose path (inline-edit-tokens@1, `addressOf`) has records gets a mark `data-axf-inline-at="<n>"` and
 * one generated stylesheet says what each mark looks like. A record at `item` scope styles that element; at `parent`
 * scope it styles the parent element, and what CSS inherits (text colour, font, letter case) reaches everything under it.
 * Values are always asset tokens (`--fx-*` colours, radii, shadows, density gaps), so a theme swap still restyles an
 * edited element. Hover / click / icon tokens get their own selectors (`:hover`, `:active`, `.fx-icon`).
 *
 * A preview layer sits on top of the saved records: the edit dialog writes there on every keystroke (live preview)
 * and clears it when the save has landed or the dialog closes. Scans only the roots that have records, re-runs on DOM
 * changes (debounced) and whenever the records change (CHANGED_EVENT, a 15 s poll, window focus).
 */
import { addressOf, ELEMENT_ROOTS, EL_ROOT_ATTR, parsePath } from '../../../framework/index.mjs';
import { CHANGED_EVENT, listOverrides, type OverrideItem, type TokenValue } from './api';

const MARK = 'data-axf-inline-at';
const STYLE_ID = 'axp-inline-edit-applied';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const color = (t: string) => (t === 'transparent' ? 'transparent' : `var(--fx-${kebab(t)})`);
const GAP: Record<string, string> = { none: '0', xs: 'var(--fx-dens-gap-xs)', sm: 'var(--fx-dens-gap-sm)', md: 'var(--fx-dens-gap-md)', lg: 'var(--fx-dens-gap-lg)', xl: 'var(--fx-dens-gap-xl)' };
const RADIUS: Record<string, string> = { none: '0', sm: 'var(--fx-radius-sm)', md: 'var(--fx-radius-md)', lg: 'var(--fx-radius-lg)', pill: '999px' };
const SHADOW: Record<string, string> = { none: 'none', sm: 'var(--fx-shadow-sm)', md: 'var(--fx-shadow-md)', lg: 'var(--fx-shadow-lg)' };
const FONT: Record<string, string> = { display: 'var(--fx-font-display)', mono: 'var(--fx-font-mono)', serif: 'var(--fx-font-display)', rounded: 'var(--fx-font)', system: 'var(--fx-font)' };
const LINE: Record<string, string> = { tight: 'var(--fx-type-line-tight)', relaxed: 'var(--fx-type-line-normal)', loose: 'var(--fx-type-line-normal)' };
const LETTER: Record<string, string> = { tight: '-0.02em', normal: 'normal', wide: '0.04em', wider: '0.1em' };
const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', spread: 'space-between' };

export interface Decls { self: string[]; hover: string[]; active: string[]; icon: string[] }

/** The declarations one token value compiles to ('theme' and the token's own default = nothing: the theme decides). */
export function declsFor(token: string, v: TokenValue, out: Decls): void {
  if (v === null || v === 'theme' || v === 'default') return;
  const s = String(v);
  const n = Number(v);
  switch (token) {
    case 'fontSize': if (Number.isFinite(n)) out.self.push(`font-size:calc(1em * ${n / 100})`); break; // theme-ok: the user's own percentage of the inherited size
    case 'fontWeight': out.self.push(`font-weight:${s}`); break;
    case 'fontFamily': if (FONT[s]) out.self.push(`font-family:${FONT[s]}`); break;
    case 'letterSpacing': out.self.push(`letter-spacing:${LETTER[s] ?? 'normal'}`); break;
    case 'textTransform': out.self.push(`text-transform:${s}`); break;
    case 'italic': out.self.push(`font-style:${v === true ? 'italic' : 'normal'}`); break;
    case 'lineHeight': if (LINE[s]) out.self.push(`line-height:${LINE[s]}`); break;
    case 'textAlign': out.self.push(`text-align:${s}`); break;
    case 'textColor': out.self.push(`color:${color(s)}`); break;
    case 'background': out.self.push(`background:${color(s)}`); break;
    case 'borderColor': out.self.push(`border-color:${color(s)}`); break;
    case 'opacity': if (Number.isFinite(n)) out.self.push(`opacity:${n / 100}`); break; // theme-ok: the user's own opacity choice
    case 'alignment': if (ALIGN[s]) out.self.push(`justify-content:${ALIGN[s]}`); break;
    case 'padding': if (GAP[s]) out.self.push(`padding:${GAP[s]}`); break;
    case 'itemPadding': if (GAP[s]) out.self.push(`padding:${GAP[s]}`); break;
    case 'gap': if (GAP[s]) out.self.push(`gap:${GAP[s]}`); break;
    case 'radius': if (RADIUS[s]) out.self.push(`border-radius:${RADIUS[s]}`); break;
    case 'borderWidth': out.self.push(`border-width:calc(var(--fx-border-w) * ${Number(s) || 0})`, s === '0' ? 'border-style:none' : 'border-style:solid'); break;
    case 'shadow': if (SHADOW[s]) out.self.push(`box-shadow:${SHADOW[s]}`); break;
    case 'cursor': out.self.push(`cursor:${s}`); break;
    case 'iconColor': out.icon.push(`color:${color(s)}`); break;
    case 'iconSize': if (Number.isFinite(n)) out.icon.push(`width:calc(1em * ${(n / 100) * 1.15})`, `height:calc(1em * ${(n / 100) * 1.15})`); break; // theme-ok: icon box from the user's percentage
    case 'showIcons': if (v === false) out.icon.push('display:none'); break;
    case 'hoverColor': out.hover.push(`color:${color(s)}`); break;
    case 'hover':
      if (s === 'none') out.hover.push('background:inherit', 'box-shadow:none', 'transform:none');
      else if (s === 'underline') out.hover.push('text-decoration:underline');
      else if (s === 'dim') out.hover.push('opacity:var(--fx-opacity-muted)');
      else if (s === 'lift') out.hover.push('box-shadow:var(--fx-shadow-md)');
      else if (s === 'tint' || s === 'highlight') out.hover.push('background:var(--fx-accent-soft)');
      break;
    case 'clickColor': out.active.push(`background:${color(s)}`); break;
    case 'click': if (s === 'none') out.active.push('transform:none', 'filter:none'); break;
    case 'glass': if (v === true) out.self.push('backdrop-filter:blur(var(--fx-dens-gap-md))'); break;
    default:
      break; // chrome fields (field.*) and motion tokens are applied by their own engines
  }
}

/** One mark's CSS. */
export function cssFor(mark: string, values: Record<string, TokenValue>): string {
  const d: Decls = { self: [], hover: [], active: [], icon: [] };
  for (const [k, v] of Object.entries(values)) declsFor(k, v, d);
  const sel = `:root body [${MARK}="${mark}"]`;
  const rules: string[] = [];
  if (d.self.length) rules.push(`${sel}{${d.self.join(';')}}`);
  if (d.hover.length) rules.push(`${sel}:hover{${d.hover.join(';')}}`);
  if (d.active.length) rules.push(`${sel}:active{${d.active.join(';')}}`);
  if (d.icon.length) rules.push(`${sel} .fx-icon{${d.icon.join(';')}}`);
  return rules.join('\n');
}

/** The values in force at each path that has records: parent records first, the item's own last (nearest wins). */
export function valuesByPath(records: Pick<OverrideItem, 'path' | 'scope' | 'token' | 'value'>[]): Map<string, Record<string, TokenValue>> {
  const by = new Map<string, Record<string, TokenValue>>();
  const ordered = [...records].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'parent' ? -1 : 1));
  for (const r of ordered) {
    const cur = by.get(r.path) ?? {};
    cur[r.token] = r.value;
    by.set(r.path, cur);
  }
  return by;
}

/** Root elements in the document for one root text ("toolbar:app"). */
function rootElements(doc: Document, rootText: string): Element[] {
  const p = parsePath(rootText);
  if (!p) return [];
  const spec = ELEMENT_ROOTS[p.root.kind];
  const sel = [`[${EL_ROOT_ATTR}="${rootText}"]`, ...(spec ? spec.classes.map((c) => `.${c}`) : [])].join(',');
  return [...doc.querySelectorAll(sel)].filter((el) => { const a = addressOf(el); return a?.rootText === rootText && a.root && el === a.owners[0]; });
}

export interface Applier { refresh(): Promise<void>; preview(path: string, token: string, value: TokenValue | undefined): void; clearPreview(path?: string): void; stop(): void; marks(): number }

export function startApplier(doc: Document = document): Applier {
  let records: OverrideItem[] = [];
  const preview = new Map<string, Record<string, TokenValue | undefined>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) { style = doc.createElement('style'); style.id = STYLE_ID; doc.head.appendChild(style); }
  let count = 0;

  const apply = () => {
    const values = valuesByPath(records);
    for (const [path, v] of preview) {
      const cur = { ...(values.get(path) ?? {}) };
      for (const [k, x] of Object.entries(v)) { if (x === undefined) delete cur[k]; else cur[k] = x; }
      values.set(path, cur);
    }
    for (const el of doc.querySelectorAll(`[${MARK}]`)) el.removeAttribute(MARK);
    const roots = new Set([...values.keys()].map((p) => parsePath(p)?.rootText).filter((x): x is string => !!x));
    const marks = new Map<string, string>();
    [...values.keys()].forEach((p, i) => marks.set(p, `m${i}`));
    for (const rt of roots) {
      for (const rootEl of rootElements(doc, rt)) {
        if (marks.has(rt)) rootEl.setAttribute(MARK, marks.get(rt)!);
        for (const el of rootEl.querySelectorAll('*')) {
          const a = addressOf(el);
          if (!a || !a.own || a.element !== el) continue;
          const m = marks.get(a.path);
          if (m) el.setAttribute(MARK, m);
        }
      }
    }
    const css = [...values.entries()].map(([p, v]) => cssFor(marks.get(p)!, v)).filter(Boolean).join('\n');
    count = values.size;
    if (style!.textContent !== css) style!.textContent = css;
  };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(apply, 250); };
  const refresh = async () => {
    try { records = (await listOverrides({ root: '', q: '', filter: {} })).items; } catch { /* offline: keep what we had */ }
    apply();
  };
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
  mo?.observe(doc.body, { childList: true, subtree: true });
  const onChanged = () => void refresh();
  globalThis.addEventListener(CHANGED_EVENT, onChanged);
  globalThis.addEventListener('focus', onChanged);
  const poll = setInterval(() => { if (doc.visibilityState !== 'hidden') void refresh(); }, 15_000);
  void refresh();

  return {
    refresh,
    preview(path, token, value) { const cur = preview.get(path) ?? {}; cur[token] = value; preview.set(path, cur); apply(); },
    clearPreview(path) { if (path) preview.delete(path); else preview.clear(); apply(); },
    marks: () => count,
    stop() {
      mo?.disconnect(); clearInterval(poll); if (timer) clearTimeout(timer);
      globalThis.removeEventListener(CHANGED_EVENT, onChanged); globalThis.removeEventListener('focus', onChanged);
      for (const el of doc.querySelectorAll(`[${MARK}]`)) el.removeAttribute(MARK);
      style?.remove();
    },
  };
}

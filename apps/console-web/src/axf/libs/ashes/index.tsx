/**
 * AshesUI (ai.amberx.axf.ashes): a live UI inspector any AXF web app can install.
 *
 * Right-click / long-press anywhere → **AshesUI** (a check-mark toggle; setting `axf.ashes.on`). While it is on, the
 * pointer model is element-inspector@1 (core/engines/inspect.ts, the same engine as the Compose `ElementInspector`):
 * **left button only** (or the primary touch / pen; right-click still opens the menu). **Press and drag**: a small panel
 * follows the pointer and keeps showing the element under it, live: the framework component (and the asset type + active
 * asset that styles it), the **plugin or library it belongs to** (and the model that built it), size and position,
 * colours with their contrast grade, font, spacing, role, React components and handlers, a selector. A highlight box
 * (with margin / padding shading) marks the element. **Release** closes it. The press never reaches the page.
 *
 * **Double-click / double-tap** pins a panel on the element: it stays, updates live, moves by its head and resizes from its
 * corner (inside the window); × unpins, the search button opens the **inspector**, a draggable, resizable floating window (the framework
 * window manager, tab kind `ashes-inspector`): on the left a tree of every rendered element on screen with the picked
 * one selected, in focus and expanded to all its children; on the right a tab group with two tabs, **Grid** (every
 * parameter in a grouped grid, styles and attributes editable live) and **Tree** (the same parameters as a tree). Plus:
 * search + filters (framework components / plugin elements), pick mode, keyboard walking of the pinned element (↑ parent,
 * ↓ first child, ← → siblings, Enter inspects, Esc unpins), copy selector / JSON / HTML, counts per component and per
 * plugin, live edits listed with Revert all, the page re-read on every change (MutationObserver, throttled).
 *
 * The app tells AshesUI who its plugins are (`createAshesLibrary({ owners })`); without that, every installed library
 * (`rt.libraries`) is known by its `axf-<name>` class prefix. Pure rules in ./core.ts.
 */
import { createPortal } from 'react-dom';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, IconButton, Icon, ModelBadge, Note, Segmented, Switch, TextField, useAxfState, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import type { AxfRuntime } from '../../core/runtime';
import {
  componentOf, filterTree, ownersFrom, parameterRows, parameterTree, pathStep, pathTo, resolveOwner, shortLabel,
  STYLE_PROPS, tooltipRows, TOOLTIP_FIELDS, treeStats, type ElNode, type ElementSnap, type KnownOwner, type Owner, type ParamNode, type Row,
} from './core';
import { INSPECT_DEFAULTS, followPanel, inspectInit, inspectStep, type InspectConfig, type InspectEvent, type InspectOn, type InspectPoint, type InspectRect, type InspectState } from '../../core/engines/inspect';
import './ashes.css';

export * from './core';

export const ASHES_ID = 'ai.amberx.axf.ashes';
export const ASHES_TAB = 'ashes-inspector';
const KEY = {
  on: 'axf.ashes.on', fields: 'axf.ashes.fields', box: 'axf.ashes.box', boxModel: 'axf.ashes.boxModel', delay: 'axf.ashes.delay',
  offset: 'axf.ashes.offset', maxNodes: 'axf.ashes.maxNodes', touch: 'axf.ashes.touch', hidden: 'axf.ashes.hiddenNodes', tokens: 'axf.ashes.tokens',
} as const;

export interface AshesOptions {
  /** the app's plugins and libraries, for "belongs to" (default: rt.libraries by their axf-<name> prefix) */
  owners?: (rt: AxfRuntime) => KnownOwner[];
  /** an app's own resolver, asked first (e.g. a plugin that marks its root differently) */
  resolveOwner?: (el: Element) => Owner | null;
}

/* ------------------------------------------------------------------ element registry + shared store */

const keys = new WeakMap<Element, number>();
const els = new Map<number, WeakRef<Element>>();
let nextKey = 1;
function keyOf(el: Element): number {
  let k = keys.get(el);
  if (!k) { k = nextKey++; keys.set(el, k); els.set(k, new WeakRef(el)); }
  return k;
}
const elOf = (k: number | null | undefined): Element | null => (k ? els.get(k)?.deref() ?? null : null);

interface AshesState {
  /** the element the follow panel shows (or a tree row points at) */
  hover: number | null; selected: number | null; picking: boolean; tick: number; edits: { key: number; kind: 'style' | 'attr'; name: string; before: string | null }[];
  /** element-inspector@1: the follow panel's anchor (null = closed), the pinned panel and its element */
  follow: InspectPoint | null; pin: InspectRect | null; pinned: number | null;
}
let state: AshesState = { hover: null, selected: null, picking: false, tick: 0, edits: [], follow: null, pin: null, pinned: null };
const subs = new Set<() => void>();
const setState = (p: Partial<AshesState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const useAshes = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);

const isOurs = (el: Element | null) => !!el?.closest('[data-ashes]');

/* ------------------------------------------------------------------ snapshot */

const TOKEN_CACHE: { at: number; names: string[] } = { at: 0, names: [] };
/** Every --fx-* custom property the page defines (read from the root's inline style and stylesheets, cached 5 s). */
function tokenNames(): string[] {
  if (Date.now() - TOKEN_CACHE.at < 5000) return TOKEN_CACHE.names;
  const names = new Set<string>();
  const root = document.documentElement;
  for (let i = 0; i < root.style.length; i++) { const n = root.style.item(i); if (n.startsWith('--fx-')) names.add(n); }
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(rules ?? [])) {
      const st = (r as CSSStyleRule).style;
      if (!st) continue;
      for (let i = 0; i < st.length; i++) { const n = st.item(i); if (n.startsWith('--fx-')) names.add(n); }
    }
  }
  TOKEN_CACHE.at = Date.now(); TOKEN_CACHE.names = [...names].sort();
  return TOKEN_CACHE.names;
}

/** React's internal fiber on a DOM node (dev and prod builds both carry it): component names + handler props. */
function reactInfo(el: Element): { components: string[]; handlers: string[] } {
  const rec = el as unknown as Record<string, unknown>;
  const fk = Object.keys(rec).find((k) => k.startsWith('__reactFiber$'));
  const pk = Object.keys(rec).find((k) => k.startsWith('__reactProps$'));
  const handlers = pk ? Object.keys((rec[pk] as Record<string, unknown>) ?? {}).filter((k) => /^on[A-Z]/.test(k) && typeof (rec[pk] as Record<string, unknown>)[k] === 'function') : [];
  const components: string[] = [];
  let f = fk ? (rec[fk] as { return?: unknown; type?: unknown } | undefined) : undefined;
  for (let i = 0; f && i < 60 && components.length < 8; i++) {
    const t = f.type as { displayName?: string; name?: string } | string | undefined;
    const n = typeof t === 'function' || (t && typeof t === 'object') ? (t as { displayName?: string; name?: string }).displayName ?? (t as { name?: string }).name : undefined;
    if (n && /^[A-Z]/.test(n) && !components.includes(n)) components.push(n);
    f = f.return as typeof f;
  }
  return { components, handlers };
}

function opaqueBg(el: Element): string {
  for (let e: Element | null = el.parentElement; e; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
  }
  return getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)'; // theme-ok: reads page colours for contrast, styles nothing
}

function cssPath(el: Element): string[] {
  const out: string[] = [];
  for (let e: Element | null = el; e && e !== document.documentElement && out.length < 12; e = e.parentElement) {
    const same = e.parentElement ? Array.from(e.parentElement.children).filter((c) => c.tagName === e!.tagName) : [e];
    out.unshift(pathStep(e.tagName.toLowerCase(), e.id, Array.from(e.classList), same.indexOf(e) + 1, same.length));
    if (e.id) break;
  }
  return out;
}

export function snapshot(rt: AxfRuntime, el: Element, opts: AshesOptions, withTokens = true): ElementSnap {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const style: Record<string, string> = {};
  for (const p of STYLE_PROPS) { const v = cs.getPropertyValue(p); if (v) style[p] = v; }
  const inline: Record<string, string> = {};
  const he = el as HTMLElement;
  for (let i = 0; he.style && i < he.style.length; i++) { const n = he.style.item(i); inline[n] = he.style.getPropertyValue(n); }
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) if (a.name !== 'class' && a.name !== 'style' && a.name !== 'id') attrs[a.name] = a.value.slice(0, 300);
  attrs['--ashes-bg'] = opaqueBg(el);
  const tokens: Record<string, string> = {};
  if (withTokens) for (const n of tokenNames()) { const v = cs.getPropertyValue(n).trim(); if (v) tokens[n] = v; }
  const chain: string[][] = [], pluginAttrs: (string | null)[] = [];
  let depth = 0;
  for (let e: Element | null = el; e; e = e.parentElement) { chain.push(Array.from(e.classList)); pluginAttrs.push(e.getAttribute('data-axf-plugin')); depth++; }
  const react = reactInfo(el);
  const classes = Array.from(el.classList);
  const owner = opts.resolveOwner?.(el) ?? resolveOwner(chain, (opts.owners ?? defaultOwners)(rt), pluginAttrs);
  const comp = componentOf(classes);
  let asset: ElementSnap['asset'] = null;
  if (comp?.asset) {
    try {
      const a = rt.assetOrNull(comp.asset as never) as { id: string; name?: string; data?: Record<string, unknown> } | null;
      if (a) asset = { type: comp.asset, id: a.id, ...(a.name ? { name: a.name } : {}), ...(a.data ? { data: a.data } : {}) };
    } catch { /* not every type is active */ }
  }
  const focusable = (el as HTMLElement).tabIndex >= 0 || /^(a|button|input|select|textarea)$/i.test(el.tagName);
  return {
    tag: el.tagName.toLowerCase(), id: el.id, classes,
    role: el.getAttribute('role'), label: el.getAttribute('aria-label'), title: el.getAttribute('title'),
    text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 200),
    rect: { x: r.x, y: r.y, w: r.width, h: r.height }, attrs, style, inline, tokens,
    components: react.components, handlers: react.handlers, chain, pluginAttrs, depth: depth - 1, childCount: el.children.length,
    path: cssPath(el), asset, owner, ctxTarget: el.closest('[data-fx-ctx-target]')?.getAttribute('data-fx-ctx-target') ?? null,
    anchor: el.closest('[data-axf-anchor]')?.getAttribute('data-axf-anchor') ?? null,
    focusable, disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true', hidden: cs.display === 'none' || cs.visibility === 'hidden',
  };
}

const defaultOwners = (rt: AxfRuntime): KnownOwner[] => ownersFrom([], rt.libraries.map((l) => ({ id: l.id, label: l.label, version: l.version, ...(l.builtWith?.model ? { model: l.builtWith.model } : {}) })));

/** The tree of every rendered element on screen (visible, non-zero size), capped. */
function buildTree(rt: AxfRuntime, opts: AshesOptions, max: number, includeHidden: boolean): { tree: ElNode[]; count: number; capped: boolean } {
  const known = (opts.owners ?? defaultOwners)(rt);
  let count = 0, capped = false;
  const vw = innerWidth, vh = innerHeight;
  const walk = (el: Element, ownerChain: string[][], attrChain: (string | null)[]): ElNode[] => {
    const out: ElNode[] = [];
    for (const c of Array.from(el.children)) {
      if (count >= max) { capped = true; break; }
      if (isOurs(c) || /^(script|style|link|meta|template|noscript)$/i.test(c.tagName)) continue;
      const r = c.getBoundingClientRect();
      const offscreen = r.width === 0 || r.height === 0 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw;
      const chain = [Array.from(c.classList), ...ownerChain];
      const attrs = [c.getAttribute('data-axf-plugin'), ...attrChain];
      if (offscreen && !includeHidden) { out.push(...walk(c, chain, attrs)); continue; }
      count++;
      const comp = componentOf(Array.from(c.classList));
      const owner = opts.resolveOwner?.(c) ?? resolveOwner(chain.slice(0, 40), known, attrs.slice(0, 40));
      const label = shortLabel({ tag: c.tagName.toLowerCase(), id: c.id, classes: Array.from(c.classList), role: c.getAttribute('role'), label: c.getAttribute('aria-label'), text: c.children.length ? '' : (c.textContent ?? '') });
      out.push({ key: keyOf(c), label, ...(comp ? { comp: comp.name } : {}), ...(owner ? { owner: owner.name, ownerKind: owner.kind } : {}), ...(offscreen ? { hidden: true } : {}), children: walk(c, chain, attrs) });
    }
    return out;
  };
  return { tree: walk(document.body, [], []), count, capped };
}

/* ------------------------------------------------------------------ highlight box + tooltip */

function Highlight({ el, boxModel, tone }: { el: Element; boxModel: boolean; tone: 'hover' | 'selected' }) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const m = { t: px(cs.marginTop), r: px(cs.marginRight), b: px(cs.marginBottom), l: px(cs.marginLeft) };
  const p = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };
  return (
    <div data-ashes className={`axf-ashes-hl axf-ashes-hl--${tone}`} style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
      {boxModel && <>
        <span className="axf-ashes-hl__margin" style={{ left: -m.l, top: -m.t, right: -m.r, bottom: -m.b }} />
        <span className="axf-ashes-hl__padding" style={{ borderLeftWidth: p.l, borderTopWidth: p.t, borderRightWidth: p.r, borderBottomWidth: p.b }} />
      </>}
      <span className="axf-ashes-hl__size">{Math.round(r.width)} × {Math.round(r.height)}</span>
    </div>
  );
}

/** The rows a panel shows: the fields switched on in settings, and always the size. */
function panelRows(rt: AxfRuntime, snap: ElementSnap): Row[] {
  const fields = (rt.settings.get(KEY.fields) as string[] | undefined) ?? [...TOOLTIP_FIELDS];
  return tooltipRows(snap, fields.includes('size') ? fields : [...fields, 'size']);
}

function PanelRows({ snap, rows }: { snap: ElementSnap; rows: Row[] }) {
  const bg = snap.style['background-color'], fg = snap.style['color'];
  return (
    <>
      {snap.owner && <div className="axf-ashes-tip__owner"><Icon name="package" size={11} /> {snap.owner.kind === 'plugin' ? 'Plugin' : 'Library'}: <strong>{snap.owner.name}</strong> <ModelBadge model={snap.owner.model} compact /></div>}
      <dl className="axf-ashes-tip__rows">
        {rows.filter((r) => r.key !== 'Belongs to' || !snap.owner).map((r) => (
          <Fragment key={r.key}>
            <dt>{r.key}</dt>
            <dd className={r.tone ? `is-${r.tone}` : ''}>
              {r.key === 'Colours' && <><span className="axf-ashes-swatch" style={{ background: fg }} /><span className="axf-ashes-swatch" style={{ background: bg }} /></>}
              {r.value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

/** The follow panel: open while the left button is held, beside the pointer (element-inspector@1 `followPanel`). */
function Tooltip({ snap, x, y }: { snap: ElementSnap; x: number; y: number }) {
  const rt = useRuntime();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: x + 16, y: y + 16 });
  const offset = Number(rt.settings.get(KEY.offset) ?? 16);
  useEffect(() => {
    const b = ref.current?.getBoundingClientRect();
    if (b) setPos(followPanel({ x, y }, { w: b.width, h: b.height }, { w: innerWidth, h: innerHeight }, { ...INSPECT_DEFAULTS, offset }));
  }, [x, y, snap, offset]);
  return (
    <div data-ashes ref={ref} className="axf-ashes-tip" style={{ left: pos.x, top: pos.y }} role="status" aria-live="off">
      <div className="axf-ashes-tip__head">
        <Icon name="eye" size={12} />
        <span className="axf-ashes-tip__title">{shortLabel(snap)}</span>
      </div>
      <PanelRows snap={snap} rows={panelRows(rt, snap)} />
      <div className="axf-ashes-tip__hint">Drag to look around · release closes · double-click pins</div>
    </div>
  );
}

/** The pinned panel (double click): stays on its element, live; drag by the head, resize from the corner. */
function PinPanel({ snap, rect }: { snap: ElementSnap | null; rect: InspectRect }) {
  const rt = useRuntime();
  return (
    <div data-ashes data-ashes-part="panel" className="axf-ashes-pin" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} role="dialog" aria-label="Pinned element">
      <div className="axf-ashes-pin__head" data-ashes-part="head">
        <Icon name="move" size={12} />
        <span className="axf-ashes-tip__title">{snap ? shortLabel(snap) : 'Element gone'}</span>
        <span data-ashes-part="panel" className="axf-ashes-pin__tools">
          <IconButton icon="search" label="Open in the inspector" size={12} onClick={() => openInspector(rt, elOf(state.pinned))} />
          <IconButton icon="x" label="Unpin" size={12} onClick={() => inspectDo({ type: 'unpin' })} />
        </span>
      </div>
      <div className="axf-ashes-pin__body">
        {snap ? <PanelRows snap={snap} rows={panelRows(rt, snap)} /> : <p className="fx-muted">The pinned element left the page.</p>}
      </div>
      <span className="axf-ashes-pin__resize" data-ashes-part="resize" aria-hidden />
    </div>
  );
}

/* element-inspector@1 state (core/engines/inspect.ts): one per page, driven by the live listener */
let insp: InspectState = inspectInit({ w: typeof innerWidth === 'number' ? innerWidth : 1024, h: typeof innerHeight === 'number' ? innerHeight : 768 });
let inspCfg: InspectConfig = INSPECT_DEFAULTS;
const hitAt = (p: { x: number; y: number }): Element | null => document.elementsFromPoint(p.x, p.y).find((e) => !isOurs(e)) ?? null;
/** Feed one event to the pointer model and publish what changed. */
function inspectDo(e: InspectEvent) {
  const r = inspectStep(insp, e, inspCfg);
  insp = r.state;
  const patch: Partial<AshesState> = {};
  if (r.look) { const el = hitAt(r.look); if (el) patch.hover = keyOf(el); }
  if (r.pinned) { const el = hitAt(r.pinned); patch.pinned = el ? keyOf(el) : null; }
  if (!insp.pin && state.pinned !== null) patch.pinned = null;
  if (insp.follow !== state.follow) patch.follow = insp.follow;
  if (insp.pin?.panel !== state.pin) patch.pin = insp.pin?.panel ?? null;
  if (!insp.follow && state.hover !== null && !('hover' in patch)) patch.hover = null;
  if (Object.keys(patch).length) setState(patch);
  return r;
}
function inspectReset() {
  insp = inspectInit({ w: innerWidth, h: innerHeight });
  setState({ hover: null, follow: null, pin: null, pinned: null, picking: false });
}

/** The live listener: mounted (portalled to the body) while AshesUI is on. Left press only (element-inspector@1). */
function AshesLive({ opts }: { opts: AshesOptions }) {
  const rt = useRuntime();
  useAxfState();
  const s = useAshes();
  const [snap, setSnap] = useState<ElementSnap | null>(null);
  const [pinSnap, setPinSnap] = useState<ElementSnap | null>(null);
  const raf = useRef(0);
  const delay = Number(rt.settings.get(KEY.delay) ?? 0);
  const touchMode = rt.settings.get(KEY.touch) !== false;
  inspCfg = { ...INSPECT_DEFAULTS, offset: Number(rt.settings.get(KEY.offset) ?? INSPECT_DEFAULTS.offset) };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let swallowClick = false;
    const skip = (e: PointerEvent) => e.pointerType === 'touch' && !touchMode;
    const partOf = (t: EventTarget | null): InspectOn | 'ours' => {
      const el = t instanceof Element ? t : null;
      if (!isOurs(el)) return 'page';
      const part = el!.closest('[data-ashes-part]')?.getAttribute('data-ashes-part');
      return part === 'head' || part === 'resize' || part === 'panel' ? part : 'ours';
    };
    const feed = (type: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent) => {
      const on = partOf(e.target);
      if (on === 'ours' && type === 'down') return null; // the inspector window, pick bar: theirs
      return inspectDo({ type, t: e.timeStamp, x: e.clientX, y: e.clientY, button: e.button, primary: e.isPrimary, on: on === 'ours' ? 'page' : on });
    };
    const down = (e: PointerEvent) => {
      if (skip(e)) return;
      if (state.picking && !isOurs(e.target as Element)) { e.preventDefault(); e.stopPropagation(); const el = hitAt({ x: e.clientX, y: e.clientY }); if (el) openInspector(rt, el); setState({ picking: false }); swallowClick = true; return; }
      const r = feed('down', e);
      if (!r) return;
      if (r.consume) { e.preventDefault(); e.stopPropagation(); getSelection()?.removeAllRanges(); swallowClick = true; }
      else if (insp.grab) e.preventDefault(); // dragging the pinned panel never selects text
    };
    const move = (e: PointerEvent) => {
      if (skip(e) || (!insp.pressed && !insp.grab)) return;
      if (insp.grab) { feed('move', e); return; }
      cancelAnimationFrame(raf.current);
      if (timer) clearTimeout(timer);
      const run = () => { raf.current = requestAnimationFrame(() => feed('move', e)); };
      if (delay > 0) timer = setTimeout(run, delay); else run();
    };
    const up = (e: PointerEvent) => { if (skip(e)) return; const r = feed('up', e); if (r?.consume) { e.preventDefault(); e.stopPropagation(); } };
    const cancel = (e: PointerEvent) => { if (!skip(e)) feed('cancel', e); };
    const click = (e: MouseEvent) => { if (swallowClick) { swallowClick = false; if (!isOurs(e.target as Element)) { e.preventDefault(); e.stopPropagation(); } } };
    const dbl = (e: MouseEvent) => { if (!isOurs(e.target as Element)) { e.preventDefault(); e.stopPropagation(); getSelection()?.removeAllRanges(); } };
    const resize = () => inspectDo({ type: 'viewport', w: innerWidth, h: innerHeight });
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      const cur = elOf(state.pinned);
      const go = (el: Element | null | undefined) => { if (el && !isOurs(el)) { e.preventDefault(); setState({ pinned: keyOf(el) }); } };
      if (e.key === 'Escape') { if (state.picking) setState({ picking: false }); else if (insp.pin) inspectDo({ type: 'unpin' }); else rt.settings.set(KEY.on, false); }
      else if (e.key === 'ArrowUp' && cur) go(cur.parentElement);
      else if (e.key === 'ArrowDown' && cur) go(cur.firstElementChild);
      else if (e.key === 'ArrowLeft' && cur) go(cur.previousElementSibling);
      else if (e.key === 'ArrowRight' && cur) go(cur.nextElementSibling);
      else if (e.key === 'Enter' && cur) { e.preventDefault(); openInspector(rt, cur); }
    };
    if (touchMode) document.documentElement.classList.add('axf-ashes-on'); // touch drags inspect instead of scrolling
    resize();
    addEventListener('pointerdown', down, { capture: true });
    addEventListener('pointermove', move, { capture: true, passive: true });
    addEventListener('pointerup', up, { capture: true });
    addEventListener('pointercancel', cancel, { capture: true });
    addEventListener('click', click, { capture: true });
    addEventListener('dblclick', dbl, { capture: true });
    addEventListener('keydown', key, { capture: true });
    addEventListener('resize', resize);
    return () => {
      document.documentElement.classList.remove('axf-ashes-on');
      removeEventListener('pointerdown', down, { capture: true });
      removeEventListener('pointermove', move, { capture: true });
      removeEventListener('pointerup', up, { capture: true });
      removeEventListener('pointercancel', cancel, { capture: true });
      removeEventListener('click', click, { capture: true });
      removeEventListener('dblclick', dbl, { capture: true });
      removeEventListener('keydown', key, { capture: true });
      removeEventListener('resize', resize);
      cancelAnimationFrame(raf.current); if (timer) clearTimeout(timer);
    };
  }, [rt, delay, touchMode]);

  // dynamic data: re-read the followed and the pinned element on every move, scroll, resize and page change
  useEffect(() => {
    const el = s.follow ? elOf(s.hover) : null;
    setSnap(el && el.isConnected ? snapshot(rt, el, opts, false) : null);
  }, [s.hover, s.follow, s.tick, rt, opts]);
  useEffect(() => {
    const el = s.pin ? elOf(s.pinned) : null;
    setPinSnap(el && el.isConnected ? snapshot(rt, el, opts, false) : null);
  }, [s.pinned, s.pin, s.tick, rt, opts]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (t) return; t = setTimeout(() => { t = null; setState({ tick: state.tick + 1 }); }, 250); };
    const mo = new MutationObserver(bump);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    addEventListener('scroll', bump, { capture: true, passive: true });
    addEventListener('resize', bump);
    return () => { mo.disconnect(); removeEventListener('scroll', bump, { capture: true }); removeEventListener('resize', bump); if (t) clearTimeout(t); };
  }, []);

  const hoverEl = elOf(s.hover);
  const pinEl = s.pin ? elOf(s.pinned) : null;
  const selEl = elOf(s.selected);
  const showBox = rt.settings.get(KEY.box) !== false;
  const boxModel = rt.settings.get(KEY.boxModel) !== false;
  return createPortal(
    <div data-ashes className="axf-ashes">
      {showBox && selEl && selEl !== hoverEl && selEl !== pinEl && selEl.isConnected && <Highlight el={selEl} boxModel={false} tone="selected" />}
      {showBox && pinEl && pinEl !== hoverEl && pinEl.isConnected && <Highlight el={pinEl} boxModel={false} tone="selected" />}
      {showBox && hoverEl && hoverEl.isConnected && <Highlight el={hoverEl} boxModel={boxModel} tone="hover" />}
      {s.pin && <PinPanel snap={pinSnap} rect={s.pin} />}
      {snap && s.follow && <Tooltip snap={snap} x={s.follow.x} y={s.follow.y} />}
      {s.picking && <div data-ashes className="axf-ashes-pickbar">Tap or click an element to inspect it · Esc cancels</div>}
    </div>,
    document.body,
  );
}
/** The inspector's tree-hover highlight works even while AshesUI's tooltip is off. */
function InspectorHighlight() {
  const s = useAshes();
  const el = elOf(s.selected);
  if (!el || !el.isConnected) return null;
  return createPortal(<div data-ashes className="axf-ashes"><Highlight el={el} boxModel={false} tone="selected" /></div>, document.body);
}

/* ------------------------------------------------------------------ inspector window */

let currentOpts: AshesOptions = {};

export function openInspector(rt: AxfRuntime, el: Element | null) {
  if (el) setState({ selected: keyOf(el) });
  const wm = rt.windows;
  const open = Object.values(wm.state.groups).find((g) => g.tabs.some((t) => t.kind === ASHES_TAB));
  if (open) { wm.activate(open.id, open.tabs.findIndex((t) => t.kind === ASHES_TAB)); wm.focus(open.windowId); return; }
  const w = Math.min(980, innerWidth - 24), h = Math.min(640, innerHeight - 48);
  wm.openFloating([{ id: `ashes-${Date.now().toString(36)}`, title: 'AshesUI inspector', kind: ASHES_TAB, icon: 'eye' }], 'AshesUI', 'floating', w, h);
}

function TreeView({ nodes, open, setOpen, selected, onPick, onHover }: { nodes: ElNode[]; open: Set<number>; setOpen: (k: number, v: boolean) => void; selected: number | null; onPick: (k: number) => void; onHover: (k: number | null) => void }) {
  return (
    <ul className="axf-ashes-tree" role="group">
      {nodes.map((n) => {
        const isOpen = open.has(n.key);
        return (
          <li key={n.key} role="treeitem" aria-expanded={n.children.length ? isOpen : undefined} aria-selected={selected === n.key}>
            <div className={`axf-ashes-tree__row ${selected === n.key ? 'is-on' : ''} ${n.hidden ? 'is-hidden' : ''}`} data-ashes-key={n.key}>
              {n.children.length ? <IconButton icon={isOpen ? 'chevron-down' : 'chevron-right'} label={isOpen ? 'Fold' : 'Unfold'} size={11} onClick={() => setOpen(n.key, !isOpen)} /> : <span className="axf-ashes-tree__leaf" />}
              <button type="button" data-fx-row className="axf-ashes-tree__label" onClick={() => onPick(n.key)} onMouseEnter={() => onHover(n.key)} onMouseLeave={() => onHover(null)}>
                <span className="axf-ashes-tree__text">{n.label}</span>
                {n.owner && <span className={`axf-ashes-tree__owner ${n.ownerKind === 'plugin' ? 'is-plugin' : ''}`}>{n.owner}</span>}
              </button>
            </div>
            {isOpen && n.children.length > 0 && <TreeView nodes={n.children} open={open} setOpen={setOpen} selected={selected} onPick={onPick} onHover={onHover} />}
          </li>
        );
      })}
    </ul>
  );
}

function ParamTree({ nodes, depth = 0 }: { nodes: ParamNode[]; depth?: number }) {
  const [open, setOpenState] = useState<Record<string, boolean>>({});
  return (
    <ul className="axf-ashes-ptree">
      {nodes.map((n) => {
        const isOpen = open[n.id] ?? depth < 1;
        return (
          <li key={n.id}>
            {n.row ? (
              <div className="axf-ashes-ptree__leaf"><span className="axf-ashes-ptree__k">{n.label}</span><span className={`axf-ashes-ptree__v ${n.row.tone ? `is-${n.row.tone}` : ''}`}>{n.value}</span></div>
            ) : (
              <>
                <button type="button" data-fx-row className="axf-ashes-ptree__branch" onClick={() => setOpenState({ ...open, [n.id]: !isOpen })} aria-expanded={isOpen}>
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} /> {n.label} <span className="fx-muted">({countLeaves(n)})</span>
                </button>
                {isOpen && <ParamTree nodes={n.children} depth={depth + 1} />}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
const countLeaves = (n: ParamNode): number => (n.row ? 1 : n.children.reduce((a, c) => a + countLeaves(c), 0));

function ParamGrid({ rows, onEdit, filter }: { rows: Row[]; onEdit: (r: Row, v: string) => void; filter: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.group} ${r.key} ${r.value}`.toLowerCase().includes(q)) : rows;
  const groups = [...new Set(shown.map((r) => r.group))];
  return (
    <div className="axf-ashes-grid" role="table" aria-label="Parameters">
      {groups.map((g) => {
        const isOpen = open[g] ?? !(g.startsWith('Theme tokens') || g.startsWith('Asset data'));
        const list = shown.filter((r) => r.group === g);
        return (
          <Fragment key={g}>
            <button type="button" data-fx-row className="axf-ashes-grid__group" onClick={() => setOpen({ ...open, [g]: !isOpen })} aria-expanded={isOpen}>
              <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} /> {g} <span className="fx-muted">({list.length})</span>
            </button>
            {isOpen && list.map((r) => (
              <div key={`${g}/${r.key}`} className="axf-ashes-grid__row" role="row">
                <span className="axf-ashes-grid__k" role="cell">{r.key}</span>
                <span className={`axf-ashes-grid__v ${r.tone ? `is-${r.tone}` : ''}`} role="cell">
                  {r.editable ? <EditCell row={r} onEdit={onEdit} /> : r.value}
                </span>
              </div>
            ))}
          </Fragment>
        );
      })}
      {!shown.length && <p className="fx-muted">Nothing matches.</p>}
    </div>
  );
}

function EditCell({ row, onEdit }: { row: Row; onEdit: (r: Row, v: string) => void }) {
  const [v, setV] = useState(row.value);
  useEffect(() => setV(row.value), [row.value]);
  return <input className="fx-input axf-ashes-edit" value={v} aria-label={`${row.key} value`} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onEdit(row, v); if (e.key === 'Escape') setV(row.value); }} onBlur={() => v !== row.value && onEdit(row, v)} />;
}

function Inspector() {
  const rt = useRuntime();
  useAxfState();
  const s = useAshes();
  const opts = currentOpts;
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'framework' | 'plugins'>('all');
  const [tab, setTab] = useState<'grid' | 'tree'>('grid');
  const [pfilter, setPfilter] = useState('');
  const [open, setOpenSet] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState(false);
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState(() => buildTree(rt, opts, Number(rt.settings.get(KEY.maxNodes) ?? 3000), rt.settings.get(KEY.hidden) === true));
  const [snapTick, setSnapTick] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);

  const reread = useCallback(() => setData(buildTree(rt, opts, Number(rt.settings.get(KEY.maxNodes) ?? 3000), rt.settings.get(KEY.hidden) === true)), [rt, opts]);
  useEffect(() => {
    if (paused) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const mo = new MutationObserver((recs) => {
      if (recs.every((r) => isOurs(r.target instanceof Element ? r.target : r.target.parentElement))) return;
      if (t) return; t = setTimeout(() => { t = null; reread(); setSnapTick((x) => x + 1); }, 400);
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    return () => { mo.disconnect(); if (t) clearTimeout(t); };
  }, [reread, paused]);

  // the selection: in focus, its path open and every child shown
  useEffect(() => {
    if (!s.selected) return;
    const path = pathTo(data.tree, s.selected);
    if (path) setOpenSet((o) => new Set([...o, ...path, s.selected!]));
    requestAnimationFrame(() => treeRef.current?.querySelector(`[data-ashes-key="${s.selected}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [s.selected, data]);

  const sel = elOf(s.selected);
  const snap = useMemo(() => (sel && sel.isConnected ? snapshot(rt, sel, opts, rt.settings.get(KEY.tokens) !== false) : null), [sel, snapTick, s.tick, rt, opts]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (snap ? parameterRows(snap) : []), [snap]);
  const ptree = useMemo(() => parameterTree(pfilter ? rows.filter((r) => `${r.group} ${r.key} ${r.value}`.toLowerCase().includes(pfilter.toLowerCase())) : rows), [rows, pfilter]);
  const shownTree = useMemo(() => filterTree(data.tree, q, only), [data, q, only]);
  const st = useMemo(() => treeStats(data.tree), [data]);
  const setOpen = (k: number, v: boolean) => setOpenSet((o) => { const n = new Set(o); if (v) n.add(k); else n.delete(k); return n; });
  const pick = (k: number) => setState({ selected: k });
  const hoverRow = (k: number | null) => { if (k) setState({ hover: k }); };

  const edit = (r: Row, v: string) => {
    const el = sel as HTMLElement | null;
    if (!el || !s.selected) return;
    if (r.editable === 'style') {
      const before = el.style.getPropertyValue(r.key) || null;
      el.style.setProperty(r.key, v);
      setState({ edits: [...state.edits, { key: s.selected, kind: 'style', name: r.key, before }] });
    } else if (r.editable === 'attr') {
      const name = r.key === 'Id' ? 'id' : r.key === 'Classes' ? 'class' : r.key;
      if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(name) || /^on/i.test(name)) { rt.toast('That attribute can’t be edited here.', 'warning', 'AshesUI'); return; }
      setState({ edits: [...state.edits, { key: s.selected, kind: 'attr', name, before: el.getAttribute(name) }] });
      el.setAttribute(name, v);
    }
    setSnapTick((x) => x + 1);
  };
  const revertAll = () => {
    for (const e of [...state.edits].reverse()) {
      const el = elOf(e.key) as HTMLElement | null;
      if (!el) continue;
      if (e.kind === 'style') { if (e.before === null) el.style.removeProperty(e.name); else el.style.setProperty(e.name, e.before); }
      else if (e.before === null) el.removeAttribute(e.name); else el.setAttribute(e.name, e.before);
    }
    setState({ edits: [] }); setSnapTick((x) => x + 1);
  };
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text).then(() => rt.toast(`${what} copied.`, 'success', 'AshesUI'), () => rt.toast('Copy failed.', 'warning', 'AshesUI')); };
  const walk = (dir: 'up' | 'down' | 'prev' | 'next') => {
    if (!sel) return;
    const n = dir === 'up' ? sel.parentElement : dir === 'down' ? sel.firstElementChild : dir === 'prev' ? sel.previousElementSibling : sel.nextElementSibling;
    if (n && !isOurs(n) && n !== document.documentElement) pick(keyOf(n));
  };

  return (
    <div className="axf-ashes-insp" data-ashes>
      <div className="axf-ashes-insp__bar">
        <Button size="sm" tone={s.picking ? 'primary' : 'neutral'} icon="search" onClick={() => { setState({ picking: !s.picking }); if (rt.settings.get(KEY.on) !== true) rt.settings.set(KEY.on, true); }}>{s.picking ? 'Picking…' : 'Pick'}</Button>
        <IconButton icon="arrow-left" label="Previous sibling" onClick={() => walk('prev')} />
        <IconButton icon="chevron-up" label="Parent" onClick={() => walk('up')} />
        <IconButton icon="chevron-down" label="First child" onClick={() => walk('down')} />
        <IconButton icon="arrow-right" label="Next sibling" onClick={() => walk('next')} />
        <IconButton icon="refresh" label="Read the page again" onClick={reread} />
        <Button size="sm" tone={paused ? 'primary' : 'ghost'} icon={paused ? 'play' : 'pause'} onClick={() => setPaused(!paused)}>{paused ? 'Live off' : 'Live'}</Button>
        <Button size="sm" tone={stats ? 'primary' : 'ghost'} icon="chart" onClick={() => setStats(!stats)}>Counts</Button>
        <span className="axf-ashes-grow" />
        {snap && <>
          <Button size="sm" tone="ghost" icon="copy" onClick={() => copy(snap.path.join(' > '), 'Selector')}>Selector</Button>
          <Button size="sm" tone="ghost" icon="code" onClick={() => copy(JSON.stringify(Object.fromEntries(rows.map((r) => [`${r.group} / ${r.key}`, r.value])), null, 2), 'Parameters')}>JSON</Button>
          <Button size="sm" tone="ghost" icon="file" onClick={() => copy((sel as Element).outerHTML.slice(0, 20000), 'HTML')}>HTML</Button>
        </>}
        {s.edits.length > 0 && <Button size="sm" tone="danger" icon="undo" onClick={revertAll}>Revert {s.edits.length} edit{s.edits.length === 1 ? '' : 's'}</Button>}
      </div>
      <div className="axf-ashes-insp__body">
        <div className="axf-ashes-insp__left" ref={treeRef}>
          <TextField label="Find in the page" value={q} onChange={setQ} placeholder="Component, class, text or plugin" />
          <Segmented size="sm" label="Show" value={only} onChange={setOnly} options={[{ value: 'all', label: 'All' }, { value: 'framework', label: 'Components' }, { value: 'plugins', label: 'Plugins' }]} />
          <p className="fx-muted axf-ashes-insp__count">{data.count} elements on screen{data.capped ? ' (capped; raise the limit in settings)' : ''}</p>
          {stats && <Stats stats={st} />}
          <div className="axf-ashes-insp__tree" role="tree" aria-label="Rendered elements">
            <TreeView nodes={shownTree} open={q || only !== 'all' ? new Set([...open, ...allKeys(shownTree)]) : open} setOpen={setOpen} selected={s.selected} onPick={pick} onHover={hoverRow} />
          </div>
        </div>
        <div className="axf-ashes-insp__right">
          {!snap && <Note tone="info">Pick an element in the tree, or pin one on the page (double-click while AshesUI is on) and open it here.</Note>}
          {snap && <>
            <header className="axf-ashes-insp__head">
              <strong>{shortLabel(snap)}</strong>
              {snap.owner && <Chip tone={snap.owner.kind === 'plugin' ? 'warning' : 'accent'}>{snap.owner.kind}: {snap.owner.name}</Chip>}
              {snap.owner?.model && <ModelBadge model={snap.owner.model} compact />}
              {snap.asset && <Chip>{snap.asset.type} / {snap.asset.id}</Chip>}
            </header>
            <p className="fx-muted axf-ashes-insp__path">{snap.path.join(' › ')}</p>
            <div className="fx-tabs" role="tablist" aria-label="Parameters as">
              <button type="button" role="tab" className={`fx-tab ${tab === 'grid' ? 'is-active' : ''}`} aria-selected={tab === 'grid'} onClick={() => setTab('grid')}><Icon name="grid" size={13} /> Grid</button>
              <button type="button" role="tab" className={`fx-tab ${tab === 'tree' ? 'is-active' : ''}`} aria-selected={tab === 'tree'} onClick={() => setTab('tree')}><Icon name="list" size={13} /> Tree</button>
            </div>
            <TextField label="Filter parameters" value={pfilter} onChange={setPfilter} placeholder="e.g. color, padding, --fx-accent" />
            <div className="axf-ashes-insp__params" role="tabpanel">
              {tab === 'grid' ? <ParamGrid rows={rows} onEdit={edit} filter={pfilter} /> : <ParamTree nodes={ptree} />}
            </div>
          </>}
        </div>
      </div>
      <InspectorHighlight />
    </div>
  );
}
const allKeys = (nodes: ElNode[]): number[] => nodes.flatMap((n) => [n.key, ...allKeys(n.children)]);

function Stats({ stats }: { stats: ReturnType<typeof treeStats> }) {
  const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return (
    <div className="axf-ashes-stats">
      <h4>Components</h4>
      <ul>{top(stats.components).map(([k, v]) => <li key={k}><span>{k}</span><span>{v}</span></li>)}</ul>
      <h4>Plugins and libraries</h4>
      <ul>{top(stats.owners).map(([k, v]) => <li key={k}><span>{k}</span><span>{v}</span></li>)}{!Object.keys(stats.owners).length && <li className="fx-muted">none on screen</li>}</ul>
    </div>
  );
}

/* ------------------------------------------------------------------ settings panel + the library */

function OverviewPanel() {
  const rt = useRuntime();
  useAxfState();
  const on = rt.settings.get(KEY.on) === true;
  return (
    <div className="fx-stack">
      <Switch label="AshesUI is on" hint="Also in the right-click / long-press menu everywhere (AshesUI ✓)." checked={on} onChange={(v) => rt.settings.set(KEY.on, v)} />
      <p className="fx-muted" style={{ margin: 0 }}>While it's on, press and drag with the left button (or a finger): a small window follows with what's under it, and closes when you let go. Double-click (or double-tap) pins it on that element: drag it by its top, resize it from its corner, open the full inspector from it. Keys: arrows walk the pinned element, Enter inspects, Esc unpins, then turns AshesUI off.</p>
      <div className="fx-row fx-row--wrap"><Button icon="eye" onClick={() => openInspector(rt, null)}>Open the inspector</Button></div>
    </div>
  );
}

export function createAshesLibrary(opts: AshesOptions = {}): AxfWebLibrary {
  currentOpts = opts;
  return {
    id: ASHES_ID,
    label: 'AshesUI',
    version: '0.1.0',
    builtWith: { model: 'opus', builtAt: '2026-10-23' },
    register(rt) {
      rt.actions.register('ashes.toggle', () => rt.settings.set(KEY.on, rt.settings.get(KEY.on) !== true), { label: 'AshesUI on / off' });
      rt.actions.register('ashes.inspect', () => openInspector(rt, elOf(state.pinned ?? state.hover)), { label: 'AshesUI inspector' });
      rt.actions.register('ashes.pick', () => { rt.settings.set(KEY.on, true); setState({ picking: true }); }, { label: 'AshesUI: pick an element' });
      rt.actions.register('ashes.unpin', () => inspectDo({ type: 'unpin' }), { label: 'AshesUI: unpin the pinned panel' });
      // on every right-click / long-press menu, whatever the target
      rt.contextExtras.set('*:ashes', () => [{ id: 'ashes', label: 'AshesUI', icon: 'eye', action: 'ashes.toggle', checked: `setting:${KEY.on}` }]);
      rt.settings.onChange(KEY.on, (v) => { if (v !== true) inspectReset(); });
    },
    tabs: { [ASHES_TAB]: () => <Inspector /> },
    slots: { 'app.frame.top': [{ id: 'ashes.live', order: 999, render: () => <AshesMount opts={opts} /> }] },
    appMenu: [{ id: 'ashes.menu', menu: 'view', menuLabel: 'View', items: [{ id: 'ashes', label: 'AshesUI', icon: 'eye', action: 'ashes.toggle', checked: `setting:${KEY.on}` }, { id: 'ashes-inspector', label: 'AshesUI inspector', icon: 'search', action: 'ashes.inspect' }] }],
    settingsTabs: [{ id: 'ashes', label: 'AshesUI', icon: 'eye', order: 7, parent: 'plugins' }],
    settings: [
      { id: 'ashes.tooltip', label: 'Tooltip', icon: 'info', tab: 'ashes', order: 10, settings: [
        { key: KEY.on, label: 'AshesUI on', kind: 'toggle', default: false },
        { key: KEY.fields, label: 'Show in the tooltip', kind: 'multi_choice', default: [...TOOLTIP_FIELDS], options: TOOLTIP_FIELDS.map((f) => ({ value: f, label: f[0]!.toUpperCase() + f.slice(1) })) },
        { key: KEY.offset, label: 'Distance from the pointer', kind: 'slider', default: 16, min: 4, max: 48, step: 2 },
        { key: KEY.delay, label: 'Wait before updating (ms)', kind: 'slider', default: 0, min: 0, max: 400, step: 20 },
        { key: KEY.touch, label: 'Follow touches too (phones)', kind: 'toggle', default: true },
      ] },
      { id: 'ashes.highlight', label: 'Highlight', icon: 'layers', tab: 'ashes', order: 20, settings: [
        { key: KEY.box, label: 'Outline the element', kind: 'toggle', default: true },
        { key: KEY.boxModel, label: 'Shade margin and padding', kind: 'toggle', default: true },
      ] },
      { id: 'ashes.inspector', label: 'Inspector', icon: 'search', tab: 'ashes', order: 30, settings: [
        { key: KEY.maxNodes, label: 'Most elements in the tree', kind: 'number', default: 3000, min: 200, max: 20000, step: 100 },
        { key: KEY.hidden, label: 'Include elements off screen', kind: 'toggle', default: false },
        { key: KEY.tokens, label: 'Read theme tokens', kind: 'toggle', default: true },
      ] },
    ],
    settingsPanels: [{ id: 'ashes.overview', tab: 'ashes', title: 'AshesUI', icon: 'eye', order: 5, render: () => <OverviewPanel /> }],
  };
}

function AshesMount({ opts }: { opts: AshesOptions }) {
  const rt = useRuntime();
  useAxfState();
  return rt.settings.get(KEY.on) === true ? <AshesLive opts={opts} /> : null;
}

export const library: AxfWebLibrary = createAshesLibrary();
export type { ReactNode };

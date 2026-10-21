/**
 * Live search (toolbar asset `data.search.live`). Reads the runtime's search index (core/engines/search.ts),
 * which this file feeds with views, dialogs and the words on pages, and installs the focuser that brings a
 * picked result onto the screen: navigate, open, scroll into view, flash.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { SEARCH_KIND_LABELS, type AxfRuntime, type SearchEntry, type SearchHit, type ToolbarSearch } from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import type { ViewMap } from '../AppShell';
import type { DialogMap } from './Overlays';
import { Icon } from './Icon';

/* ---------------- words on pages ---------------- */

/** Elements whose text is worth finding. Mark a subtree `data-axf-search="off"` to keep it out. */
const TEXT_SELECTOR = 'h1, h2, h3, h4, h5, label, button, th, legend, summary, .fx-eyebrow, [data-axf-search="on"]';
type TextHit = { tag: string; text: string };
/** view id → text found on it (kept for the session, refreshed each time the view is shown). */
const pageText = new Map<string, Map<string, TextHit>>();

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Index the text of the view on screen. */
export function scanPage(view: string, root: ParentNode | null = globalThis.document?.querySelector('.fx-main')): void {
  if (!root) return;
  const found = new Map<string, TextHit>();
  root.querySelectorAll<HTMLElement>(TEXT_SELECTOR).forEach((el) => {
    if (el.closest('[data-axf-search="off"]')) return;
    const text = clean(el.innerText || el.textContent || el.getAttribute('aria-label'));
    if (text.length < 2 || text.length > 90) return;
    const tag = el.tagName.toLowerCase();
    found.set(`${tag}:${text.toLowerCase()}`, { tag, text });
  });
  if (found.size) pageText.set(view, found);
}

function findText(tag: string, text: string): HTMLElement | null {
  const want = text.toLowerCase();
  const root = globalThis.document?.querySelector('.fx-main');
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>(tag)) {
    if (clean(el.innerText || el.textContent || el.getAttribute('aria-label')).toLowerCase() === want) return el;
  }
  return null;
}

/* ---------------- focus + flash ---------------- */

const cssEscape = (s: string) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

/** Wait for an element (views and data load asynchronously), then scroll it into view and flash it. */
export function flashWhenReady(find: () => Element | null, timeoutMs = 3000): void {
  const started = Date.now();
  const tick = () => {
    const el = find() as HTMLElement | null;
    if (el) {
      const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.hasAttribute('data-reduced-motion');
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      el.classList.remove('fx-search-flash');
      void el.offsetWidth; // restart the animation
      el.classList.add('fx-search-flash');
      setTimeout(() => el.classList.remove('fx-search-flash'), 1900);
      const target = el.matches('input, select, textarea, button, [tabindex]') ? el : el.querySelector<HTMLElement>('input, select, textarea, button');
      target?.focus({ preventScroll: true });
      return;
    }
    if (Date.now() - started < timeoutMs) setTimeout(tick, 90);
  };
  setTimeout(tick, 30);
}

const byAnchor = (anchor: string) => () => document.querySelector(`[data-axf-anchor="${cssEscape(anchor)}"]`);

/**
 * Feed the index with this shell's views, dialogs and page text, and install the focuser. AppShell calls it.
 */
export function useSearchHost(views: ViewMap, dialogs: DialogMap): void {
  const rt = useRuntime();
  const state = useAxfState();
  const viewsRef = useRef(views);
  const dialogsRef = useRef(dialogs);
  viewsRef.current = views;
  dialogsRef.current = dialogs;

  useEffect(() => {
    const offViews = rt.search.add('axf.views', () => Object.entries(viewsRef.current).map(([id, v]) => ({
      id: `view:${id}`, kind: 'view', label: v.title, detail: 'Page', icon: v.icon ?? 'layout', keywords: [id, ...(v.keywords ?? [])], focus: { kind: 'view', view: id },
    })));
    const offDialogs = rt.search.add('axf.dialogs', () => Object.entries(dialogsRef.current)
      .filter(([, d]) => d.searchable !== false)
      .map(([id, d]) => ({ id: `dialog:${id}`, kind: 'dialog', label: d.title, detail: 'Dialog', icon: d.icon ?? 'box', keywords: [id], focus: { kind: 'dialog', id } })));
    const offText = rt.search.add('axf.text', () => {
      const out: SearchEntry[] = [];
      for (const [view, hits] of pageText) {
        const title = viewsRef.current[view]?.title;
        if (!title) continue;
        for (const h of hits.values()) {
          if (h.text.toLowerCase() === title.toLowerCase()) continue; // the view result already covers it
          out.push({ id: `text:${view}:${h.tag}:${h.text.toLowerCase()}`, kind: 'text', label: h.text, detail: title, icon: 'type', focus: { kind: 'text', view, tag: h.tag, text: h.text } });
        }
      }
      return out;
    });
    rt.search.setFocuser((entry) => focusEntry(rt, entry, viewsRef.current));
    return () => { offViews(); offDialogs(); offText(); rt.search.setFocuser(null); };
  }, [rt]);

  // Index each view's words once it has rendered (and again once its data has likely arrived).
  useEffect(() => {
    const view = state.view;
    const a = setTimeout(() => scanPage(view), 120);
    const b = setTimeout(() => scanPage(view), 1500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [state.view]);
}

function focusEntry(rt: AxfRuntime, entry: SearchEntry, views: ViewMap): boolean {
  const f = entry.focus as { kind: string } & Record<string, string>;
  switch (f.kind) {
    case 'view':
      rt.navigate(f.view!);
      flashWhenReady(() => document.querySelector('.fx-main h1, .fx-main h2'), 1200);
      return true;
    case 'action':
      return rt.dispatch(f.spec!);
    case 'setting':
      rt.dispatch(`settings.open:${f.tab}`);
      flashWhenReady(f.anchor ? byAnchor(f.anchor) : () => document.querySelector('.axf-settings__tab.is-active'));
      return true;
    case 'dialog':
      rt.openDialog(f.id!);
      return true;
    case 'asset':
      if (views.assets) {
        rt.navigate('assets');
        flashWhenReady(() => document.querySelector(`[data-fx-ctx-target="asset-card"][data-fx-ctx-payload="${cssEscape(`${f.type}:${f.id}`)}"]`));
        return true;
      }
      return false; // runtime fallback: swap it in
    case 'window':
      rt.windows.restore(f.id!);
      return true;
    case 'text':
      if (rt.getState().view !== f.view) rt.navigate(f.view!);
      flashWhenReady(() => findText(f.tag!, f.text!));
      return true;
    default:
      return false;
  }
}

/* ---------------- the search box ---------------- */

/** The toolbar's live search: results update on every keystroke; Enter or a click focuses the pick. */
export function LiveSearch({ config }: { config: ToolbarSearch }) {
  const rt = useRuntime();
  const state = useAxfState();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const limit = config.maxResults ?? 12;

  // `rev` changes with every runtime change (swaps, role, settings contributions…), so results stay current.
  const hits: SearchHit[] = useMemo(() => {
    if (!q.trim()) return [];
    scanPage(rt.getState().view);
    return rt.search.query(q, { limit, kinds: config.kinds });
  }, [rt, q, limit, config.kinds, state.rev]);

  useEffect(() => { setActive(0); }, [q]);

  // The list is portalled to <body> with fixed coordinates so no toolbar region (overflow, glass backdrop) clips it.
  const [pos, setPos] = useState<CSSProperties>({});
  const showList = open && q.trim().length > 0;
  useLayoutEffect(() => {
    if (!showList) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, 340), vw - 16);
      const left = Math.max(8, Math.min(r.right - width, vw - width - 8));
      const below = vh - r.bottom;
      const up = below < 240 && r.top > below;
      const maxHeight = Math.min(440, (up ? r.top : below) - 12);
      setPos(up ? { left, width, bottom: vh - r.top + 4, maxHeight } : { left, width, top: r.bottom + 4, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [showList, hits.length]);

  // Close on outside click; Ctrl/Cmd+K or "/" focuses the box.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !document.getElementById(listId)?.contains(t)) setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (config.shortcut === false) return;
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); };
  }, [config.shortcut]);

  const pick = (h: SearchHit | undefined) => {
    if (!h) return;
    if (h.locked) {
      rt.toast(`"${h.label}" needs ${h.requires}.`, 'warning', 'Locked');
      return;
    }
    setOpen(false);
    setQ('');
    input.current?.blur();
    rt.search.focus(h);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape') { if (q) setQ(''); else { setOpen(false); input.current?.blur(); } }
  };

  return (
    <div className="fx-search fx-search--live" ref={box} role="search" data-axf-search="off">
      <Icon name="search" size={14} />
      <input
        ref={input}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={config.placeholder ?? 'Search pages, actions, settings…'}
        aria-label="Search everything"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
      />
      {q && <button type="button" className="fx-search__clear" aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus(); }}><Icon name="x" size={12} /></button>}
      {showList && createPortal(
        <div className="fx-search__results fx-popover" id={listId} role="listbox" aria-label="Search results" style={pos} data-axf-search="off">
          {hits.length === 0 && <div className="fx-search__empty">Nothing matches “{q.trim()}”.</div>}
          {hits.map((h, i) => (
            <div
              key={h.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={h.locked || undefined}
              className={`fx-search__hit ${i === active ? 'is-active' : ''} ${h.locked ? 'is-locked' : ''}`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              <Icon name={h.locked ? 'lock' : h.icon ?? 'search'} size={14} />
              <span className="fx-search__text">
                <span className="fx-search__label">{h.label}</span>
                {h.detail && <span className="fx-search__detail">{h.detail}</span>}
              </span>
              <span className="fx-search__kind">{SEARCH_KIND_LABELS[h.kind] ?? h.kind}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

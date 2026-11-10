/**
 * The search bar widget (renderer of the `search-bar` asset type while this plugin is on).
 *
 * Views (asset data `view`): `bar` (box + scope switch), `compact` (narrow box), `icon` (a button; the box opens in the
 * drop-down). Scope switch: globe = everything, gear = settings only (asset data `scope` is the start value; the
 * switch is remembered per placed bar). Results update on every key. Drop-down: categories on the left, a tree of
 * matches on the right; click / Enter goes to it; right-click / → opens the quick menu with that setting's options,
 * picked straight from the list with a small check mark in place, no confirm.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AxfRuntime, SearchEntry } from '@console/axf/core';
import { Icon, usePortalRoot, useRuntime, useAxfState, type WidgetRenderProps } from '@console/axf/react';
import { MODES, applyRanking, flatten, groupHits, matchEntries, pickValue, quickOptions, submenuSide, type Group, type Hit, type Mode, type Quick, type Scope, type TreeNode } from './match.mjs';
import { aiOn, api, dropInstance, saveConfig, upsertInstance, useSearchState } from './store';

const MODE_SHORT: Record<Mode, string> = { words: 'Words', prefix: 'Starts', exact: 'Exact', regex: '.*' };
const MODE_TITLES: Record<Mode, string> = { words: 'Words in any order, anywhere', prefix: 'Words that start with what you type', exact: 'The exact phrase', regex: 'Regular expression' };

export interface BarData { placeholder?: string; width?: string; shortcut?: boolean; view?: string; scope?: string }

let shortcutOwner: string | null = null;

/* ---------------- quick menu model: what right-click offers for one result ---------------- */

export interface QuickRow { id: string; label: string; key?: string; quick?: Quick; children?: QuickRow[] }

/** Settable rows for a result: a setting → its options; a group → each of its settings; a settings tab → its groups. */
export function quickRows(rt: AxfRuntime, e: Pick<SearchEntry, 'id'>): QuickRow[] {
  const s = rt.settings;
  const row = (key: string, label: string): QuickRow | null => {
    const spec = s.spec(key);
    const quick = quickOptions(spec as never, s.get(key));
    return quick ? { id: `setting:${key}`, label, key, quick } : null;
  };
  const groupRows = (gid: string): QuickRow[] => {
    for (const t of s.listTabs()) {
      const g = s.groupsIn(t.id).find((x) => x.id === gid);
      if (g) return g.settings.filter((x) => x.kind !== 'section').map((x) => row(x.key, x.label)).filter((x): x is QuickRow => !!x);
    }
    return [];
  };
  const [kind, ...rest] = e.id.split(':');
  const ref = rest.join(':');
  if (kind === 'setting') { const r = row(ref, s.spec(ref)?.label ?? ref); return r?.quick ? [r] : []; }
  if (kind === 'settings-group') return groupRows(ref);
  if (kind === 'settings-tab') {
    return s.groupsIn(ref).map((g) => ({ id: `settings-group:${g.id}`, label: g.label, children: groupRows(g.id) })).filter((g) => g.children.length);
  }
  return [];
}

/** Set a setting from the quick menu or the API. Returns the new value, or undefined when it can't be set here. */
export function quickSet(rt: AxfRuntime, key: string, item: { value: string | boolean }): unknown {
  const spec = rt.settings.spec(key);
  if (!spec) return undefined;
  if (spec.requires && rt.gate(spec.requires) !== 'allow') return undefined;
  const next = pickValue(spec as never, rt.settings.get(key), item as never);
  rt.settings.set(key, next as never);
  return next;
}

/* ---------------- the widget ---------------- */

export function SearchBarView({ data, id, host }: WidgetRenderProps<BarData>) {
  const rt = useRuntime();
  const axf = useAxfState();
  const store = useSearchState();
  const uid = useId().replace(/:/g, '');
  const key = `${host ?? 'free'}:${id}:${uid}`;
  const view = data?.view === 'compact' || data?.view === 'icon' ? data.view : 'bar';
  const scopeKey = `search-bar.scope.${host ?? 'free'}.${id}`;
  const saved = rt.settings.get(scopeKey);
  const scope: Scope = saved === 'settings' || saved === 'everything' ? saved : data?.scope === 'settings' ? 'settings' : 'everything';
  const setScope = (s: Scope) => rt.settings.set(scopeKey, s);

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<string>('all');
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState<{ hit: Hit; rect: DOMRect } | null>(null);
  const [aiIds, setAiIds] = useState<string[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dropId = `axp-sb-${uid}`;
  const portalRoot = usePortalRoot();

  // Matching: the plugin's own logic on every key (rt.search = every page, plugin, setting, action, asset, window…).
  const { hits, error } = useMemo(() => {
    if (!q.trim()) return { hits: [] as Hit[], error: '' };
    const entries = rt.search.entries().filter((e) => rt.gate(e.requires) !== 'hide').map((e) => ({ ...e, locked: rt.gate(e.requires) === 'disable' }));
    return matchEntries(entries, q, store.options, scope);
  }, [q, scope, store.options, rt, axf.rev]);
  const ranked = useMemo(() => applyRanking(hits, aiIds), [hits, aiIds]);
  const groups: Group[] = useMemo(() => groupHits(ranked, store.options), [ranked, store.options]);
  const shown = cat === 'all' ? groups : groups.filter((g) => g.id === cat);
  const flat = useMemo(() => shown.flatMap((g) => flatten(g.root)), [shown]);
  useEffect(() => { setActive(0); setMenu(null); }, [q, cat, scope]);
  useEffect(() => { if (cat !== 'all' && !groups.some((g) => g.id === cat)) setCat('all'); }, [groups, cat]);

  // AI ranking only while an Ollama connection + AI assistance are both on (else: nothing is sent anywhere).
  const ai = aiOn(store);
  useEffect(() => {
    setAiIds(null);
    if (!ai || !q.trim() || hits.length < 2) return undefined;
    const t = setTimeout(() => {
      const candidates = hits.slice(0, 40).map((h) => ({ id: h.id, label: h.label, detail: h.detail ?? '' }));
      api.post<{ ids: string[] }>('ai/rank', { q, candidates }).then((r) => setAiIds(r.ids), () => setAiIds(null));
    }, 350);
    return () => clearTimeout(t);
  }, [ai, q, hits]);

  // Register with the store so actions / voice / the API can drive this bar.
  const showRef = useRef<(query?: string) => void>(() => undefined);
  showRef.current = (query?: string) => {
    if (typeof query === 'string') setQ(query);
    setOpen(true);
    setTimeout(() => input.current?.focus(), 0);
  };
  const countsKey = JSON.stringify(Object.fromEntries(groups.map((g) => [g.id, g.count])));
  useEffect(() => {
    upsertInstance({ key, id, host: host ?? 'free', view, scope, query: q, open, results: hits.length, categories: JSON.parse(countsKey) as Record<string, number>,
      show: (x) => showRef.current(x), setScope, close: () => setOpen(false) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, view, scope, q, open, hits.length, countsKey]);
  useEffect(() => () => dropInstance(key), [key]);

  // Ctrl/Cmd+K or "/" focuses the first bar that asks for the shortcut.
  useEffect(() => {
    if (data?.shortcut === false || shortcutOwner) return undefined;
    shortcutOwner = key;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        showRef.current();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (shortcutOwner === key) shortcutOwner = null; };
  }, [data?.shortcut, key]);

  // Close on a click outside the box, the drop-down and the quick menu.
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (box.current?.contains(t) || t.closest?.(`[data-axp-sb="${uid}"]`)) return;
      setOpen(false); setMenu(null);
    };
    window.addEventListener('pointerdown', down);
    return () => window.removeEventListener('pointerdown', down);
  }, [open, uid]);

  // The drop-down is portalled with fixed coordinates so no toolbar or banner clips it.
  const [pos, setPos] = useState<CSSProperties>({});
  const showDrop = open && (q.trim().length > 0 || view === 'icon');
  useLayoutEffect(() => {
    if (!showDrop) return undefined;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const unit = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = Math.min(Math.max(r.width, unit * 40), vw - unit);
      const left = Math.max(unit / 2, Math.min(r.left, vw - width - unit / 2));
      const below = vh - r.bottom;
      const up = below < unit * 16 && r.top > below;
      const maxHeight = Math.min(unit * 30, (up ? r.top : below) - unit);
      setPos(up ? { left, width, bottom: vh - r.top + 4, maxHeight } : { left, width, top: r.bottom + 4, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [showDrop, groups.length]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    if (h.locked) { rt.toast(`"${h.label}" needs ${h.requires}.`, 'warning', 'Locked'); return; }
    setOpen(false); setMenu(null); setQ('');
    input.current?.blur();
    rt.search.focus(h);
  };
  const openMenu = (h: Hit, el: Element | null) => { if (el) setMenu({ hit: h, rect: el.getBoundingClientRect() }); };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const rowEl = () => document.getElementById(`${dropId}-${active}`);
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setMenu(null); setActive((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMenu(null); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
    else if ((e.key === 'ArrowRight' && input.current?.selectionStart === q.length) || e.key === 'ContextMenu') { if (flat[active]) { e.preventDefault(); openMenu(flat[active]!, rowEl()); } }
    else if (e.key === 'ArrowLeft' && menu) { e.preventDefault(); setMenu(null); }
    else if (e.key === 'Escape') { if (menu) setMenu(null); else if (q) setQ(''); else { setOpen(false); input.current?.blur(); } }
  };

  const globe = scope === 'everything';
  const scopeBtn = (
    <button type="button" className={`fx-toolbtn axp-search-bar__scope${globe ? '' : ' is-on'}`} aria-pressed={!globe}
      title={globe ? 'Searching everything (globe). Tap for settings only.' : 'Searching settings only (gear). Tap to search everything.'}
      aria-label={globe ? 'Scope: everything. Switch to settings only' : 'Scope: settings only. Switch to everything'}
      onClick={() => { setScope(globe ? 'settings' : 'everything'); input.current?.focus(); }}>
      <Icon name={globe ? 'globe' : 'settings'} size={14} />
    </button>
  );
  const field = (
    <input
      ref={input} className="axp-search-bar__input" value={q}
      onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)} onKeyDown={onKey}
      placeholder={data?.placeholder ?? (globe ? 'Search everything…' : 'Search settings…')}
      aria-label={globe ? 'Search everything' : 'Search settings'} role="combobox" aria-expanded={showDrop} aria-controls={dropId} aria-autocomplete="list"
      aria-activedescendant={showDrop && flat[active] ? `${dropId}-${active}` : undefined}
    />
  );
  let rowIndex = -1;
  const drawHit = (h: Hit) => {
    rowIndex += 1;
    const i = rowIndex;
    return (
      <div key={h.id} id={`${dropId}-${i}`} role="treeitem" aria-selected={i === active} aria-disabled={h.locked || undefined}
        className={`axp-search-bar__hit${i === active ? ' is-active' : ''}${h.locked ? ' is-locked' : ''}${menu?.hit.id === h.id ? ' is-menu' : ''}`}
        onPointerEnter={() => setActive(i)} onPointerDown={(e) => e.preventDefault()} onClick={() => go(h)}
        onContextMenu={(e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); setActive(i); openMenu(h, e.currentTarget); }}>
        <Icon name={h.locked ? 'lock' : h.icon ?? 'search'} size={14} />
        <span className="axp-search-bar__label">{h.label}</span>
        {quickRows(rt, h).length > 0 && <Icon name="chevron-right" size={12} />}
      </div>
    );
  };
  const drawNode = (n: TreeNode, depth: number): JSX.Element => (
    <div key={n.id} role="group" aria-label={n.label} className="axp-search-bar__node" data-depth={depth}>
      {depth > 0 && <div className="axp-search-bar__branch"><Icon name="chevron-down" size={12} /> {n.label}</div>}
      <div className="axp-search-bar__leaves">
        {n.hits.map(drawHit)}
        {n.children.map((c) => drawNode(c, depth + 1))}
      </div>
    </div>
  );

  return (
    <div ref={box} className={`axp-search-bar is-${view}`} role="search" data-axf-search="off" data-axp-scope={scope}>
      {view === 'icon' ? (
        <button type="button" className="fx-toolbtn" aria-label="Search" aria-expanded={showDrop} title="Search" onClick={() => (open ? setOpen(false) : showRef.current())}>
          <Icon name={globe ? 'search' : 'settings'} size={14} />
        </button>
      ) : (
        <>
          {scopeBtn}
          {field}
          {q && <button type="button" className="fx-toolbtn axp-search-bar__clear" aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus(); }}><Icon name="x" size={12} /></button>}
        </>
      )}
      {showDrop && createPortal(
        <div className="fx-popover axp-search-bar__drop" id={dropId} style={pos} data-axp-sb={uid} data-axf-search="off" aria-label="Search results">
          {view === 'icon' && <div className="axp-search-bar__head">{scopeBtn}{field}</div>}
          <div className="axp-search-bar__body">
            <div className="axp-search-bar__cats" role="listbox" aria-label="Categories">
              {[{ id: 'all', label: 'All', icon: 'list', count: hits.length }, ...groups].map((g) => (
                <button key={g.id} type="button" role="option" aria-selected={cat === g.id} data-fx-row className={`axp-search-bar__cat${cat === g.id ? ' is-on' : ''}`}
                  onPointerDown={(e) => e.preventDefault()} onClick={() => setCat(g.id)}>
                  <Icon name={g.icon} size={14} /><span className="axp-search-bar__catlabel">{g.label}</span><span className="axp-search-bar__count">{g.count}</span>
                </button>
              ))}
            </div>
            <div className="axp-search-bar__tree" role="tree" aria-label="Matches">
              {error && <p className="axp-search-bar__empty" role="alert">Regular expression: {error}</p>}
              {!error && q.trim() && !flat.length && <p className="axp-search-bar__empty">Nothing matches “{q.trim()}”{globe ? '' : ' in settings'}.</p>}
              {!q.trim() && <p className="axp-search-bar__empty">Type to search {globe ? 'everything' : 'settings'}.</p>}
              {shown.map((g) => (
                <div key={g.id} role="group" aria-label={g.label} className="axp-search-bar__group">
                  <div className="axp-search-bar__grouphead"><Icon name={g.icon} size={12} /> {g.label}</div>
                  {drawNode(g.root, 0)}
                </div>
              ))}
            </div>
          </div>
          <div className="axp-search-bar__foot">
            <span className="axp-search-bar__modes" role="group" aria-label="Matching">
              {MODES.map((m) => (
                <button key={m} type="button" className={`fx-chip${store.options.mode === m ? ' is-selected' : ''}`} aria-pressed={store.options.mode === m} title={MODE_TITLES[m]}
                  onPointerDown={(e) => e.preventDefault()} onClick={() => void saveConfig({ mode: m })}>{MODE_SHORT[m]}</button>
              ))}
              <button type="button" className={`fx-chip${store.options.caseSensitive ? ' is-selected' : ''}`} aria-pressed={store.options.caseSensitive} title="Case-sensitive"
                onPointerDown={(e) => e.preventDefault()} onClick={() => void saveConfig({ caseSensitive: !store.options.caseSensitive })}>Aa</button>
            </span>
            <span>{ai ? 'AI ranking (local Llama)' : 'Built-in matching'}</span>
            <span>Right-click or → for quick options</span>
          </div>
        </div>,
        portalRoot,
      )}
      {showDrop && menu && createPortal(
        <QuickMenu uid={uid} rows={quickRows(rt, menu.hit)} hit={menu.hit} anchor={menu.rect} onOpen={() => go(menu.hit)} onClose={() => setMenu(null)} />,
        portalRoot,
      )}
    </div>
  );
}

/* ---------------- the quick menu (right-click a result) ---------------- */

function QuickMenu({ uid, rows, hit, anchor, onOpen, onClose }: { uid: string; rows: QuickRow[]; hit: Hit; anchor: DOMRect; onOpen: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: anchor.right, top: anchor.top, visibility: 'hidden' });
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    const h = ref.current?.offsetHeight ?? 0;
    const side = submenuSide(anchor.right, anchor.left, w, window.innerWidth);
    const top = Math.max(4, Math.min(anchor.top, window.innerHeight - h - 4));
    setStyle({ left: side === 'right' ? anchor.right + 2 : anchor.left - w - 2, top, visibility: 'visible' });
  }, [anchor, rows.length]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')?.focus(); }, []);
  return (
    <div ref={ref} className="fx-popover axp-search-bar__menu" role="menu" aria-label={`Quick options: ${hit.label}`} style={style} data-axp-sb={uid}
      onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'ArrowLeft') { e.preventDefault(); onClose(); } }}>
      <button type="button" role="menuitem" className="fx-menu__item axp-search-bar__mi" onClick={onOpen}><Icon name="external" size={12} /> Go to it</button>
      {rows.length === 0 && <p className="axp-search-bar__empty">No quick options here.</p>}
      {rows.map((r) => <QuickRowView key={r.id} uid={uid} row={r} />)}
    </div>
  );
}

function QuickRowView({ uid, row }: { uid: string; row: QuickRow }) {
  const rt = useRuntime();
  useAxfState();
  const [sub, setSub] = useState<DOMRect | null>(null);
  const [tick, setTick] = useState('');
  if (row.children) {
    return (
      <div className="axp-search-bar__mrow" onPointerEnter={(e) => setSub(e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setSub(null)}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={!!sub} className="fx-menu__item axp-search-bar__mi"
          onClick={(e) => setSub(sub ? null : (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect())}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); setSub((e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()); } }}>
          {row.label}<Icon name="chevron-right" size={12} />
        </button>
        {sub && createPortal(<SubMenu uid={uid} rows={row.children} anchor={sub} label={row.label} onClose={() => setSub(null)} />, document.body)}
      </div>
    );
  }
  const spec = row.key ? rt.settings.spec(row.key) : undefined;
  const live = spec ? quickOptions(spec as never, rt.settings.get(row.key!)) : row.quick;
  return (
    <div className="axp-search-bar__mgroup" role="group" aria-label={row.label}>
      <div className="axp-search-bar__mlabel">{row.label}{tick && <span className="axp-search-bar__tick" role="status"><Icon name="check" size={12} /> {tick}</span>}</div>
      {live?.items.map((it) => (
        <button key={String(it.value)} type="button" role={live.multi ? 'menuitemcheckbox' : 'menuitemradio'} aria-checked={it.checked} className={`fx-menu__item axp-search-bar__mi${it.checked ? ' is-checked' : ''}`}
          onClick={() => {
            if (!row.key) return;
            if (quickSet(rt, row.key, it) === undefined) { rt.toast(`"${row.label}" can't be changed here.`, 'warning', 'Locked'); return; }
            setTick(it.label);
            setTimeout(() => setTick(''), 1600);
          }}>
          <Icon name={it.checked ? 'check' : 'minus'} size={12} /> {it.label}
        </button>
      ))}
    </div>
  );
}

function SubMenu({ uid, rows, anchor, label, onClose }: { uid: string; rows: QuickRow[]; anchor: DOMRect; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', left: anchor.right, top: anchor.top });
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    const h = ref.current?.offsetHeight ?? 0;
    const side = submenuSide(anchor.right, anchor.left, w, window.innerWidth);
    setStyle({ left: side === 'right' ? anchor.right : anchor.left - w, top: Math.max(4, Math.min(anchor.top, window.innerHeight - h - 4)), visibility: 'visible' });
  }, [anchor]);
  return (
    <div ref={ref} className="fx-popover axp-search-bar__menu" role="menu" aria-label={label} style={style} data-axp-sb={uid}
      onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'ArrowLeft') { e.preventDefault(); onClose(); } }}>
      {rows.map((r) => <QuickRowView key={r.id} uid={uid} row={r} />)}
    </div>
  );
}

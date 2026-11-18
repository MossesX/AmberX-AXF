/**
 * The console's command palette (Ctrl+K / Cmd+K, the banner's Search button on a phone, the `console.control.search`
 * action, the deep links `view:command-palette` / `#/command-palette/<words>` / `?axf-cmd=search&q=<words>`): one ranked
 * fuzzy search over every console-control target (screens, tabs, settings, buttons, plugins, plugin commands), the plans
 * of Plan Studio 2.0 and everything else the console has loaded (src/control/search.ts). Enter runs the pick through the
 * console-control executor: a function or button is pressed (with its argument), anything else is opened and focused.
 * A destructive press asks first; approve / deny and owner-only settings are never listed (palette-core.mjs). The last
 * picks are listed first and shown on an empty field.
 *
 * API: the same search is the `search` verb (REST /api/console-control/search, MCP console_control_search, axf console
 * search, voice "find <words>" / "search for <words>"); the palette's open state is the `dialog` field of
 * console_control_state, its look the setting `console.palette.look` (a dialog asset, src/assets/dialog/command-palette*).
 * Look: framework controls only (TextField, TabGroup, Button); layout in console.css (.cc-palette*), tokens only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, TabGroup, TextField, controlRegistry, useRuntime, type TabDef } from '../axf/react';
import type { AxfRuntime } from '../axf/core';
import type { ConsoleControlKind } from '../axf/core/engines/console-control';
import { executeControl, describeAnswer } from './executor';
import { consoleSearch, type ConsoleSearchHit } from './search';
import { inventory } from './inventory';
import { PALETTE_LOOK_KEY, PALETTE_RECENT_KEY, destructive, listable, paletteLook, pushRecent, verbFor, withRecentFirst, type PaletteHit, type PaletteMeta } from './palette-core.mjs';

export const PALETTE_DIALOG = 'console-control.search';
const LIMIT = 40;
const BANNER_ID = 'console.command-palette';
/** The palette's own address (deep links view:command-palette, #/command-palette/<words>, console_open, REST open). */
export const PALETTE_VIEW = 'command-palette';

type Filter = 'all' | 'places' | 'settings' | 'buttons' | 'plugins' | 'loaded';
const FILTER_KINDS: Record<Filter, ConsoleControlKind[] | null> = {
  all: null, places: ['view', 'tab', 'subtab', 'panel'], settings: ['setting'], buttons: ['button', 'function'], plugins: ['plugin'], loaded: ['grid', 'row', 'step'],
};
const FILTERS: TabDef<Filter>[] = [
  { value: 'all', label: 'All' }, { value: 'places', label: 'Screens & tabs' }, { value: 'settings', label: 'Settings' },
  { value: 'buttons', label: 'Commands' }, { value: 'plugins', label: 'Plugins' }, { value: 'loaded', label: 'Plans & rows' },
];
const KIND_ICON: Partial<Record<ConsoleControlKind, string>> = { view: 'layout', tab: 'layers', subtab: 'layers', setting: 'settings', button: 'zap', function: 'zap', plugin: 'package', row: 'list', step: 'check', grid: 'grid', panel: 'box' };

/** What the inventory says about an address (person-only, owner-raise, locked, destructive). */
let metaIndex: Map<string, PaletteMeta> | null = null;
function metaOf(address: string): PaletteMeta | null {
  if (!metaIndex) {
    metaIndex = new Map();
    const inv = inventory as unknown as Record<string, Array<{ address?: string } & PaletteMeta> | undefined>;
    for (const key of ['settings', 'functions', 'buttons']) for (const t of inv[key] ?? []) if (t?.address) metaIndex.set(t.address, t);
  }
  return metaIndex.get(address) ?? null;
}

const readRecent = (): PaletteHit[] => { try { const v = JSON.parse(globalThis.localStorage?.getItem(PALETTE_RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeRecent = (l: PaletteHit[]) => { try { globalThis.localStorage?.setItem(PALETTE_RECENT_KEY, JSON.stringify(l)); } catch { /* private mode */ } };

/** Search for the palette: the console-control ranking, never a decision or an owner-only setting, recent picks first. */
export function paletteSearch(rt: AxfRuntime, q: string, kinds?: ConsoleControlKind[], limit = LIMIT): (ConsoleSearchHit & { recent?: boolean })[] {
  const recent = readRecent();
  if (!q.trim()) return recent.filter((h) => listable(h, metaOf(h.address)) && (!kinds || kinds.includes(h.kind as ConsoleControlKind))).map((h) => ({ ...(h as ConsoleSearchHit), score: 0, source: 'loaded' as const, recent: true }));
  const hits = consoleSearch(rt, { q, limit: limit * 2, ...(kinds ? { kinds } : {}) }).filter((h) => listable(h, metaOf(h.address)));
  return withRecentFirst(hits, recent).slice(0, limit);
}

/** Run a pick: press functions and buttons (a destructive one only after a confirm), open and focus everything else. */
export async function pickHit(rt: AxfRuntime, hit: ConsoleSearchHit): Promise<string> {
  if (!listable(hit, metaOf(hit.address))) { rt.toast(`${hit.label} needs your own tap on its screen.`, 'warning', 'Command palette'); return 'refused'; }
  const verb = verbFor(hit);
  const danger = verb === 'press' && destructive(hit, metaOf(hit.address));
  if (danger && !globalThis.confirm?.(`${hit.label}: this deletes or resets something. Run it?`)) return 'cancelled';
  writeRecent(pushRecent(readRecent(), hit));
  const a = await executeControl(rt, verb === 'press'
    ? { verb: 'press', address: hit.address, ...(hit.value !== undefined ? { value: hit.value } : {}), ...(danger ? { confirm: true } : {}), by: 'palette' }
    : { verb: 'focus', address: hit.address, options: { expand: true }, by: 'palette' });
  if (!a.ok) rt.toast(describeAnswer(a), 'warning', 'Command palette');
  return describeAnswer(a);
}

export function SearchPalette({ initial = '', close }: { initial?: string; close: () => void }) {
  const rt = useRuntime();
  const [q, setQ] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const hits = useMemo(() => { try { return paletteSearch(rt, q, FILTER_KINDS[filter] ?? undefined); } catch { return []; } }, [rt, q, filter]);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [q, filter]);
  // the look: one of the palette's dialog assets (variant modal / sheet / drawer, header) as data attributes
  const look = paletteLook(rt.settings.get(PALETTE_LOOK_KEY));
  const asset = (rt.registry.get('dialog', look)?.data ?? {}) as { variant?: string; header?: string };
  // the field keeps the keyboard: a screen that mounts under the palette (an autofocus field) must not take it
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grab = () => { const input = box.current?.querySelector('input'); if (input && document.activeElement !== input) input.focus(); };
    const timers = [0, 120, 400].map((ms) => setTimeout(grab, ms));
    return () => timers.forEach(clearTimeout);
  }, []);
  useEffect(() => { box.current?.querySelector(`[data-axf-palette-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const pick = (h: ConsoleSearchHit | undefined) => { if (!h) return; close(); void pickHit(rt, h); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setActive(Math.max(0, hits.length - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]); }
  };
  return (
    <div ref={box} className="cc-palette" data-axf-palette-look={look} data-variant={asset.variant ?? 'modal'} data-header={asset.header ?? 'plain'} onKeyDown={onKey}>
      <TextField label="Search the console" value={q} onChange={setQ} placeholder="Screens, commands, settings, plugins, plans…" autoFocus name="console-control-search" />
      <TabGroup id="console-control.search.filter" label="What to search" value={filter} onChange={setFilter} tabs={FILTERS} size="sm" />
      <div className="cc-palette__hits" role="listbox" aria-label="Search results">
        {!q.trim() && hits.length ? <p className="cc-palette__section">Recent</p> : null}
        {!q.trim() && !hits.length ? <p className="cc-palette__empty">Type to search every screen, command, setting, plugin and plan. ↑ ↓ to move, Enter to run.</p> : null}
        {q.trim() && !hits.length ? <p className="cc-palette__empty">Nothing found.</p> : null}
        {hits.map((h, i) => (
          <Button key={`${h.address}|${h.value ?? ''}`} tone={i === active ? 'primary' : 'ghost'} size="sm" icon={h.icon ?? KIND_ICON[h.kind] ?? 'search'}
            className="cc-palette__hit" role="option" aria-selected={i === active} data-axf-palette-index={i} onMouseEnter={() => setActive(i)} onClick={() => pick(h)} title={h.address}>
            <span className="cc-palette__label">{h.label}</span>
            {h.detail ? <span className="cc-palette__detail">{h.detail}</span> : null}
            {h.recent && q.trim() ? <Icon name="clock" size={12} /> : null}
            {h.onScreen ? <Icon name="eye" size={12} /> : null}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Open the palette with words (or empty). */
export function openPalette(rt: AxfRuntime, q = ''): void { rt.openDialog(PALETTE_DIALOG, q ? { q } : undefined); }

/** The banner's Search button (phones have no Ctrl+K): an action-button asset of the console, attached on the right. */
const BANNER_ASSET = {
  $axf: 'asset@1', type: 'action-button', id: BANNER_ID, name: 'Command palette', version: '1.0.0', author: 'AmberX AXF console',
  description: 'Opens the command palette (Ctrl+K): search and run any screen, command, setting, plugin or plan.', tags: ['command-palette', 'search'],
  data: { icon: 'search', label: 'Search', action: 'console.control.search', show: 'icon', tone: 'neutral', tooltip: 'Search and run anything (Ctrl+K)' },
} as const;

/**
 * Ctrl+K (Cmd+K) opens it, before anything else on the page sees the key (one palette, no second search); the
 * `console.control.search:<words>` action opens it with the words; `?axf-cmd=search&q=<words>` once on load; the
 * banner carries its Search button. Returns a remover.
 */
export function installSearchPalette(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
    e.preventDefault(); e.stopPropagation();
    if (rt.getState().dialog?.id === PALETTE_DIALOG) return;
    openPalette(rt);
  };
  const onSearch = (e: Event) => { const q = (e as CustomEvent<{ q?: string }>).detail?.q ?? ''; e.preventDefault(); openPalette(rt, q); };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('axf:console-control.search', onSearch);
  try { rt.registry.register(BANNER_ASSET, 'app', BANNER_ID); } catch { /* registered already */ }
  // console-control@1: the palette is a target of its own (open = the palette, empty), so the executor, the search and
  // the deep-link resolver reach it like a screen; it is a dialog, so its state is console_control_state's `dialog`
  const offTarget = controlRegistry(rt).register({
    address: `view:${PALETTE_VIEW}`, kind: 'view', label: 'Command palette', icon: 'search', keywords: ['command palette', 'palette', 'search', 'ctrl k', 'run'],
    open: () => openPalette(rt), invoke: () => openPalette(rt), element: () => document.querySelector('.cc-palette'),
  });
  const offBanner = rt.attachToBanner({ type: 'action-button', id: BANNER_ID, at: 'right', order: 5, origin: BANNER_ID, widget: { label: 'Command palette', icon: 'search', priority: 6, aliases: ['search', 'command palette', 'ctrl k'] } });
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get('axf-cmd') === 'search') {
      const q = u.searchParams.get('q') ?? '';
      u.searchParams.delete('axf-cmd'); u.searchParams.delete('q');
      window.history.replaceState(window.history.state, '', u.toString());
      setTimeout(() => openPalette(rt, q), 300);
    }
  } catch { /* no URL here */ }
  return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('axf:console-control.search', onSearch); offBanner(); offTarget(); };
}

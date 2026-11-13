/**
 * The console-control search palette (Ctrl+K, the `console.control.search` action, or the deep link
 * `?axf-cmd=search&q=<words>`): one ranked search over screens, tabs, settings, buttons, plugins, help and everything the
 * console has loaded (src/control/search.ts). Picking a hit pulls it into focus through the executor (a button or an
 * action is pressed; a destructive one only after its own confirm on screen).
 *
 * API: the same search is the `search` verb (REST /api/console-control/search, MCP console_control_search, axf console
 * search, voice "find <words>"); the palette's open state is the `dialog` field of console_control_state.
 * Look: framework controls only (TextField, TabGroup, Button); layout in console.css (.cc-palette*), tokens only.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, TabGroup, TextField, useRuntime, type TabDef } from '../axf/react';
import type { AxfRuntime } from '../axf/core';
import type { ConsoleControlKind } from '../axf/core/engines/console-control';
import { executeControl, describeAnswer } from './executor';
import { consoleSearch, type ConsoleSearchHit } from './search';

export const PALETTE_DIALOG = 'console-control.search';
const LIMIT = 40;

type Filter = 'all' | 'places' | 'settings' | 'buttons' | 'plugins' | 'loaded';
const FILTER_KINDS: Record<Filter, ConsoleControlKind[] | null> = {
  all: null, places: ['view', 'tab', 'subtab', 'panel'], settings: ['setting'], buttons: ['button', 'function'], plugins: ['plugin'], loaded: ['grid', 'row', 'step'],
};
const FILTERS: TabDef<Filter>[] = [
  { value: 'all', label: 'All' }, { value: 'places', label: 'Screens & tabs' }, { value: 'settings', label: 'Settings' },
  { value: 'buttons', label: 'Buttons' }, { value: 'plugins', label: 'Plugins' }, { value: 'loaded', label: 'Rows & steps' },
];
const KIND_ICON: Partial<Record<ConsoleControlKind, string>> = { view: 'layout', tab: 'layers', subtab: 'layers', setting: 'settings', button: 'zap', function: 'zap', plugin: 'package', row: 'list', step: 'check', grid: 'grid', panel: 'box' };

/** Pull a hit into focus: press buttons and actions (with their argument), focus everything else. */
export async function pickHit(rt: AxfRuntime, hit: ConsoleSearchHit): Promise<string> {
  const press = hit.kind === 'function' || hit.kind === 'button';
  const a = await executeControl(rt, press ? { verb: 'press', address: hit.address, ...(hit.value !== undefined ? { value: hit.value } : {}), by: 'palette' } : { verb: 'focus', address: hit.address, options: { expand: true }, by: 'palette' });
  if (!a.ok) rt.toast(describeAnswer(a), 'warning', 'Search');
  return describeAnswer(a);
}

export function SearchPalette({ initial = '', close }: { initial?: string; close: () => void }) {
  const rt = useRuntime();
  const [q, setQ] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const hits = useMemo(() => {
    if (!q.trim()) return [];
    try { return consoleSearch(rt, { q, limit: LIMIT, ...(FILTER_KINDS[filter] ? { kinds: FILTER_KINDS[filter]! } : {}) }); } catch { return []; }
  }, [rt, q, filter]);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [q, filter]);
  const pick = (h: ConsoleSearchHit | undefined) => { if (!h) return; close(); void pickHit(rt, h); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]); }
  };
  return (
    <div className="cc-palette" onKeyDown={onKey}>
      <TextField label="Search the console" value={q} onChange={setQ} placeholder="Screens, settings, buttons, plugins, rows, steps…" autoFocus name="console-control-search" />
      <TabGroup id="console-control.search.filter" label="What to search" value={filter} onChange={setFilter} tabs={FILTERS} size="sm" />
      <div className="cc-palette__hits" role="listbox" aria-label="Search results">
        {q.trim() && !hits.length ? <p className="cc-palette__empty">Nothing found.</p> : null}
        {hits.map((h, i) => (
          <Button key={`${h.address}|${h.value ?? ''}`} tone={i === active ? 'primary' : 'ghost'} size="sm" icon={h.icon ?? KIND_ICON[h.kind] ?? 'search'}
            className="cc-palette__hit" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(h)} title={h.address}>
            <span className="cc-palette__label">{h.label}</span>
            {h.detail ? <span className="cc-palette__detail">{h.detail}</span> : null}
            {h.onScreen ? <Icon name="eye" size={12} /> : null}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Open the palette with words (or empty). */
export function openPalette(rt: AxfRuntime, q = ''): void { rt.openDialog(PALETTE_DIALOG, q ? { q } : undefined); }

/**
 * Ctrl+K (Cmd+K) opens it; `console.control.search:<words>` opens it with the words (the action's event); the deep link
 * `?axf-cmd=search&q=<words>` opens it once on load. Returns a remover.
 */
export function installSearchPalette(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(rt); }
  };
  const onSearch = (e: Event) => { const q = (e as CustomEvent<{ q?: string }>).detail?.q ?? ''; e.preventDefault(); openPalette(rt, q); };
  window.addEventListener('keydown', onKey);
  window.addEventListener('axf:console-control.search', onSearch);
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get('axf-cmd') === 'search') {
      const q = u.searchParams.get('q') ?? '';
      u.searchParams.delete('axf-cmd'); u.searchParams.delete('q');
      window.history.replaceState(window.history.state, '', u.toString());
      setTimeout(() => openPalette(rt, q), 300);
    }
  } catch { /* no URL here */ }
  return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('axf:console-control.search', onSearch); };
}

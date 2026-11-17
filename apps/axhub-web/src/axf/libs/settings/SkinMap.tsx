/**
 * Skin map (build flagship-professional-skin-covering-2, Nov 17 2026; Brett: "Show me where the data sets go, the
 * layouts, every single thing."): Settings → Appearance → Skin map lists every slot of skin-map@1 grouped by surface,
 * with what it controls, the tokens it writes, the components that read them, where its data and layout live, and what
 * the skin in force sets there. Tapping a row opens that asset.
 *
 * The document is the generated snapshot (framework/schemas/skin-map.json, baked into every app at src/axf/schemas),
 * loaded on demand so it never weighs on the first paint; the skin values come from rt.skinList() (each skin's
 * `extends` folded) through skinMapFor (core/engines/skin-map.mjs), so the view works the same in the console, axHub
 * web and AmberX with no server.
 *
 * API parity: deep link `settings.open:skin-map` (console-control
 * `view:settings/tab:settings.tabs=appearance/subtab:settings.subtabs=skin-map`), rows `grid:skin-map/row:<slot>`; actions `skin.map` (open) and `skin.map.slot:<slot>` (open on one row, say what the skin sets);
 * REST `GET /api/plugins/theme-manager/skin-map[/<slot>]?skin=` (MCP through plugin-commands); CLI
 * `node framework/cli/skins.mjs map [<skin>] [--slot <s>]`.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../core/runtime';
import { Button, Chip, Note, TabGroup, TextField, useRuntime } from '../../react';
import { DataGrid } from '../datagrid';
import { skinMapFor, skinMapRowValue } from '../../core/engines/skin-map.mjs';

/** The Appearance sub-tab id (settings.open:skin-map). */
export const SKIN_MAP_TAB = 'skin-map';
/**
 * Console-control addresses (spec/CONSOLE-CONTROL.md). The sub-tab registers itself through the TabGroup, every slot
 * row through the DataGrid (`grid:skin-map/row:<slot>`; `row:<slot>` alone resolves on the open screen); the dataset
 * and layout tables are drawn by hand, so their rows carry data-axf-target themselves.
 */
export const SKIN_MAP_TARGET = 'view:settings/tab:settings.tabs=appearance/subtab:settings.subtabs=skin-map';
export const SKIN_MAP_GRID = 'skin-map';
export const skinMapRowTarget = (slot: string) => `grid:${SKIN_MAP_GRID}/row:${slot}`;
export const skinMapTableRowTarget = (table: 'datasets' | 'layouts', id: string) => `grid:${SKIN_MAP_GRID}-${table}/row:${id}`;
export const SKIN_MAP_ACTIONS = { open: 'skin.map', slot: 'skin.map.slot' } as const;

type MapDoc = { slots: MapRow[]; datasets: Record<string, unknown>[]; layouts: Record<string, unknown>[]; summary: Record<string, number> };
export type MapRow = {
  slot: string; kind: string; type?: string; label: string; via?: string; controls: string[]; tokens: string[]; settings: string[];
  components: string[]; attributes?: string[]; lives: Record<string, unknown> | null; value?: unknown; filled?: boolean;
};

/* ---------------- the document, loaded once on demand ---------------- */

let doc: MapDoc | null = null;
let loading: Promise<MapDoc> | null = null;
const docListeners = new Set<() => void>();
export function loadSkinMap(): Promise<MapDoc> {
  if (doc) return Promise.resolve(doc);
  loading ??= import('../../schemas/skin-map.json').then((m) => { doc = (m.default ?? m) as unknown as MapDoc; docListeners.forEach((l) => l()); return doc; });
  return loading;
}
export function useSkinMapDoc(): MapDoc | null {
  const d = useSyncExternalStore((l) => { docListeners.add(l); return () => { docListeners.delete(l); }; }, () => doc, () => doc);
  useEffect(() => { void loadSkinMap(); }, []);
  return d;
}

/* ---------------- the row the view opens on (skin.map.slot) ---------------- */

let focus = '';
const focusListeners = new Set<() => void>();
export function setSkinMapFocus(slot: string) { focus = slot; focusListeners.forEach((l) => l()); }
export function useSkinMapFocus(): string {
  return useSyncExternalStore((l) => { focusListeners.add(l); return () => { focusListeners.delete(l); }; }, () => focus, () => focus);
}

/** The skin in force here and its folded data (null = no skin). */
export function skinInForceData(rt: AxfRuntime): { id: string; data: unknown } | null {
  const id = rt.skinInForce().id;
  if (!id) return null;
  const e = rt.skinList().find((s) => s.id === id);
  return e ? { id, data: e.data } : null;
}

/** The map read through the skin in force (or `skinId`), one slot or all. */
export function useSkinMap(rt: AxfRuntime, skinId = '') {
  const d = useSkinMapDoc();
  const [, bump] = useState(0);
  useEffect(() => rt.settings.subscribe(() => bump((n) => n + 1)), [rt]);
  return useMemo(() => {
    if (!d) return null;
    const pick = skinId ? rt.skinList().find((s) => s.id === skinId) : null;
    const at = pick ? { id: pick.id, data: pick.data } : skinInForceData(rt);
    return skinMapFor(d, at?.id ?? '', at?.data ?? null) as unknown as MapDoc & { skin: { id: string; filled: number; rows: number } | null };
  }, [d, rt, skinId, rt.settings.getRevision()]);
}

/* ---------------- actions (voice, MCP console actions, Ctrl+K) ---------------- */

export function registerSkinMapActions(rt: AxfRuntime) {
  rt.actions.register(SKIN_MAP_ACTIONS.open, () => { setSkinMapFocus(''); rt.dispatch(`settings.open:${SKIN_MAP_TAB}`); }, { label: 'Open the skin map (Settings → Appearance → Skin map)' });
  rt.actions.register(SKIN_MAP_ACTIONS.slot, ([slot]) => {
    if (!slot) { rt.toast('skin.map.slot needs a slot (toolbar, parts.toolbar, motion, colorTheme…).', 'warning', 'Skin map'); return; }
    setSkinMapFocus(slot);
    rt.dispatch(`settings.open:${SKIN_MAP_TAB}`);
    void loadSkinMap().then((d) => {
      const row = d.slots.find((r) => r.slot === slot || r.type === slot || r.slot === `assets.${slot}`);
      if (!row) { rt.toast(`No slot "${slot}" in the skin map.`, 'warning', 'Skin map'); return; }
      const at = skinInForceData(rt);
      const v = at ? skinMapRowValue(row, at.data) : null;
      const shown = v === null ? 'not set by the skin' : typeof v === 'string' ? v : 'set';
      rt.toast(`${row.label}: ${shown}. Controls ${row.controls.join(', ') || 'nothing drawn'}; ${row.tokens.length} tokens, ${row.settings.length} settings.`, 'info', 'Skin map');
    });
  }, { label: 'Open the skin map on one slot and say what the skin sets there', params: true });
}

/* ---------------- the view ---------------- */

/** Surfaces the rows are grouped by (an open list: a row whose type no surface names lands in Other). */
export const SKIN_MAP_SURFACES: { id: string; label: string; icon: string; types?: string[]; kinds?: string[]; slots?: string[] }[] = [
  { id: 'look', label: 'Colours, type and style', icon: 'palette', types: ['color-theme', 'style-theme', 'typography', 'density', 'sizing'], slots: ['extras.spacing', 'extras.settings'] },
  { id: 'layout', label: 'Layouts', icon: 'layout', types: ['layout', 'dock-layout', 'xlayout', 'nav-style'] },
  { id: 'chrome', label: 'Menus and chrome', icon: 'menu', types: ['app-menu', 'nav-menu', 'context-menu', 'toolbar', 'tab-group', 'banner', 'settings'], kinds: ['chrome', 'settings'], slots: ['extras.hidden'] },
  { id: 'controls', label: 'Controls and widgets', icon: 'grid', types: ['dialog', 'popup', 'container', 'button', 'slider', 'gauge', 'meter', 'clock', 'search-bar', 'action-button', 'logo', 'label', 'status', 'counter', 'progress', 'avatar', 'link', 'theme-switch', 'spacer', 'divider', 'badge'], kinds: ['dialog'] },
  { id: 'behaviour', label: 'Motion, behaviour and hooks', icon: 'zap', types: ['behavior-theme'], kinds: ['motion', 'behavior', 'hooks'] },
  { id: 'data', label: 'Grids and data', icon: 'list', kinds: ['grid'] },
  { id: 'brand', label: 'Brand and icons', icon: 'sparkles', types: ['branding', 'logo-mark', 'animated-logo', 'icon-pack', 'agent-card'] },
  { id: 'content', label: 'Help and learning', icon: 'help', types: ['demonstration', 'book', 'clip', 'docs', 'help', 'card', 'job-type'] },
];
const OTHER = { id: 'other', label: 'Other', icon: 'box' };
export function skinMapSurface(r: MapRow): string {
  for (const s of SKIN_MAP_SURFACES) {
    if (s.slots?.includes(r.slot)) return s.id;
    if (r.kind !== 'parts' && s.kinds?.includes(r.kind)) return s.id;
    if (r.type && s.types?.includes(r.type)) return s.id;
  }
  return OTHER.id;
}

const shownValue = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === 'object' ? '…' : String(x)}`).join(' · '));
const livesText = (l: MapRow['lives']): string => {
  if (!l) return '';
  const pick = (l.pick as { field?: string } | undefined)?.field;
  return [typeof l.repo === 'string' ? l.repo : '', typeof l.hub === 'string' ? l.hub : '', typeof l.field === 'string' ? `${l.document ?? ''} ${l.field}` : '', pick ? `pick: app-look@1 ${pick}` : ''].filter(Boolean).join(' · ');
};

/** Open what a row stands for: the asset the skin names there, else the skin itself. */
export function openSkinMapRow(rt: AxfRuntime, r: MapRow, skinId: string) {
  const v = r.value;
  const type = r.kind === 'reference' && r.via && r.via !== 'iconPack' ? r.via : r.slot === 'iconPack' ? 'icon-pack' : r.type;
  if (typeof v === 'string' && type && r.kind !== 'extras') { rt.dispatch(`asset.json:${type}:${v}`); return; }
  if (skinId) rt.dispatch(`asset.json:skin:${skinId}`);
}

export function SkinMapView() {
  const rt = useRuntime();
  const [surface, setSurface] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const focused = useSkinMapFocus();
  const map = useSkinMap(rt);
  useEffect(() => { if (focused) { setSurface('all'); setExpanded((e) => (e.includes(focused) ? e : [...e, focused])); } }, [focused]);
  if (!map) return <Note>Loading the skin map…</Note>;
  const skinId = map.skin?.id ?? '';
  const q = query.trim().toLowerCase();
  const hit = (r: MapRow) => !q || [r.slot, r.label, r.type ?? '', ...r.tokens, ...r.settings, ...r.components].some((x) => x.toLowerCase().includes(q));
  const rows = map.slots.filter(hit);
  const bySurface = new Map<string, MapRow[]>();
  for (const r of rows) { const s = skinMapSurface(r); bySurface.set(s, [...(bySurface.get(s) ?? []), r]); }
  const surfaces = [...SKIN_MAP_SURFACES, OTHER].filter((s) => bySurface.has(s.id));
  const tabs = [
    { value: 'all', label: 'All slots', icon: 'layers', badge: rows.length },
    ...surfaces.map((s) => ({ value: s.id, label: s.label, icon: s.icon, badge: bySurface.get(s.id)!.length })),
    { value: 'datasets', label: 'Datasets', icon: 'database', badge: map.datasets.length },
    { value: 'layouts', label: 'Layout types', icon: 'layout', badge: map.layouts.length },
  ];
  const groups = (surface === 'all' ? surfaces : surfaces.filter((s) => s.id === surface)).map((s) => ({ id: s.id, title: s.label, icon: s.icon, rows: bySurface.get(s.id)!, groups: [], counts: `${bySurface.get(s.id)!.filter((r) => r.filled).length} / ${bySurface.get(s.id)!.length} set` }));
  const columns = [
    { id: 'slot', label: 'Slot', width: 'minmax(calc(var(--fx-space) * 22), 2fr)', fixed: true, sortable: true, sortValue: (r: MapRow) => r.slot, render: (r: MapRow) => <span className="axf-skinmap__slot"><strong>{r.label}</strong><span className="fx-mono fx-muted">{r.slot}</span></span> },
    { id: 'value', label: skinId ? `Set by ${skinId}` : 'Set by the skin', width: 'minmax(calc(var(--fx-space) * 18), 2fr)', render: (r: MapRow) => (r.filled ? <span className="axf-skinmap__value">{shownValue(r.value)}</span> : <span className="fx-muted">level below</span>) },
    { id: 'controls', label: 'Controls', width: 'minmax(calc(var(--fx-space) * 12), 1fr)', render: (r: MapRow) => <span className="fx-row fx-row--wrap fx-row--tight">{r.controls.map((c) => <Chip key={c}>{c}</Chip>)}</span> },
    { id: 'tokens', label: 'Tokens', width: 'calc(var(--fx-space) * 9)', align: 'end' as const, sortable: true, sortValue: (r: MapRow) => r.tokens.length, render: (r: MapRow) => <span className="fx-mono">{r.tokens.length}</span> },
    { id: 'readers', label: 'Read by', width: 'minmax(calc(var(--fx-space) * 18), 2fr)', render: (r: MapRow) => <span className="fx-muted axf-skinmap__clip">{r.components.slice(0, 3).join(', ')}</span> },
    { id: 'lives', label: 'Lives in', width: 'minmax(calc(var(--fx-space) * 22), 3fr)', render: (r: MapRow) => <span className="fx-mono fx-muted axf-skinmap__clip">{livesText(r.lives)}</span> },
  ];
  const detail = (r: MapRow) => (
    <div className="axf-skinmap__detail">
      {r.tokens.length > 0 && <div><div className="fx-eyebrow">Tokens it writes</div><div className="fx-mono axf-skinmap__list">{r.tokens.join('  ')}</div></div>}
      {r.settings.length > 0 && <div><div className="fx-eyebrow">Settings keys</div><div className="fx-mono axf-skinmap__list">{r.settings.join('  ')}</div></div>}
      {(r.attributes?.length ?? 0) > 0 && <div><div className="fx-eyebrow">Attributes</div><div className="fx-mono axf-skinmap__list">{r.attributes!.join('  ')}</div></div>}
      <div><div className="fx-eyebrow">Read by</div><div className="axf-skinmap__list">{r.components.join(', ') || 'nothing drawn'}</div></div>
      {r.lives && <div><div className="fx-eyebrow">Where it lives</div><pre className="fx-code axf-skinmap__lives">{JSON.stringify(r.lives, null, 2)}</pre></div>}
      {r.filled && <div><div className="fx-eyebrow">What the skin sets</div><pre className="fx-code axf-skinmap__lives">{JSON.stringify(r.value, null, 2)}</pre></div>}
      <div className="fx-row"><Button size="sm" icon="external" onClick={() => openSkinMapRow(rt, r, skinId)}>Open {typeof r.value === 'string' && r.kind !== 'extras' ? r.value : skinId || 'asset'}</Button></div>
    </div>
  );
  const table = (name: 'datasets' | 'layouts', head: string[], body: string[][]) => (
    <div className="axf-skinmap__table" role="table">
      <div role="row" className="axf-skinmap__tr axf-skinmap__th">{head.map((h) => <span role="columnheader" key={h}>{h}</span>)}</div>
      {body.map((cells, i) => <div role="row" key={i} className="axf-skinmap__tr" data-axf-target={skinMapTableRowTarget(name, cells[0] ?? '')}>{cells.map((c, j) => <span role="cell" key={j} className={j ? 'fx-mono fx-muted axf-skinmap__clip' : ''}>{c}</span>)}</div>)}
    </div>
  );
  return (
    <div className="axf-skinmap">
      <div className="axf-skinmap__bar">
        <span className="axf-skinmap__sum">{skinId ? <>Skin <strong>{skinId}</strong>: {map.skin!.filled} of {map.skin!.rows} slots set</> : <>No skin in force: every slot shows what it controls</>} · {map.summary.tokens} tokens · {map.summary.settings} settings keys</span>
        <TextField label="Find" className="axf-skinmap__find" name="skin-map-find" value={query} onChange={setQuery} placeholder="Find a slot, token, key or component" />
      </div>
      <TabGroup id="settings.skin-map.surfaces" label="Skin map surfaces" size="sm" value={surface} onChange={setSurface} tabs={tabs} />
      {surface === 'datasets' ? table('datasets', ['Dataset', 'Contract', 'Hub', 'Data store', 'Repo'], map.datasets.map((d) => [String(d.id), String(d.contract ?? ''), String(d.hub ?? '-'), String(d.dataStore ?? '-'), String(d.repo ?? '')]))
        : surface === 'layouts' ? table('layouts', ['Layout type', 'Assets', 'Pick', 'Engine', 'Repo'], map.layouts.map((l) => [String(l.type), String((l.ids as string[] | undefined)?.length ?? 0), String((l.pick as { field?: string } | undefined)?.field ?? ''), String(l.engine ?? ''), String(l.repo ?? '')]))
        : <DataGrid<MapRow> id={SKIN_MAP_GRID} label="Skin map" groups={groups} columns={columns} rowId={(r) => r.slot} rowLabel={(r) => r.label} hidden={[]}
            expanded={expanded} onToggleExpand={(id) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))} renderDetail={detail}
            selected={focused || null} rowTone={(r) => (r.filled ? 'success' : 'muted')} onRowClick={(r) => openSkinMapRow(rt, r, skinId)}
            empty={<Note>No slot matches "{query}".</Note>} />}
    </div>
  );
}

export const SKIN_MAP_CSS = `
.axf-skinmap{display:flex;flex-direction:column;gap:var(--fx-dens-gap-md);min-width:0}
.axf-skinmap__bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--fx-dens-gap-md)}
.axf-skinmap__find{flex:0 1 calc(var(--fx-font-size) * 22);min-width:0}
.axf-skinmap__sum{font-size:var(--fx-type-scale-sm);color:var(--fx-muted)}
.axf-skinmap__slot{display:flex;flex-direction:column;min-width:0}
.axf-skinmap__slot .fx-mono{font-size:var(--fx-type-scale-xs)}
.axf-skinmap__value,.axf-skinmap__clip{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fx-type-scale-sm)}
.axf-skinmap__detail{display:flex;flex-direction:column;gap:var(--fx-dens-gap-sm);padding:var(--fx-dens-pad-row) var(--fx-dens-pad-cell)}
.axf-skinmap__list{font-size:var(--fx-type-scale-xs);overflow-wrap:anywhere}
.axf-skinmap__lives{margin:0;font-size:var(--fx-type-scale-xs);max-height:calc(var(--fx-font-size) * 16);overflow:auto}
.axf-skinmap__table{display:flex;flex-direction:column;border:var(--fx-border-w) solid var(--fx-border);border-radius:var(--fx-radius-md);overflow:hidden}
.axf-skinmap__tr{display:grid;grid-template-columns:minmax(calc(var(--fx-space) * 18),1.4fr) repeat(4,minmax(0,1fr));gap:var(--fx-dens-gap-md);padding:var(--fx-dens-pad-row) var(--fx-dens-pad-cell);border-top:var(--fx-border-w) solid var(--fx-border);font-size:var(--fx-type-scale-sm);min-width:0}
.axf-skinmap__th{border-top:0;background:var(--fx-surface2);font-weight:600}
`;

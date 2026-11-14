/**
 * The UI Directory page: every UI row of every app (ui-directory@1) as a grouped tree, app → plugin / shell → screen →
 * tabs, dialogs and panels. Search, app / kind / status / token-family filters, expand and collapse. Each row opens its
 * UI (console-control `open` on its address, else its deep link) or its settings interface, and unfolds to the four
 * doors that reach it without the UI (MCP, REST, CLI, voice).
 *
 * The page state (query, filters, open groups) lives in a small store so the plugin's actions and the console API can
 * read and set it without the UI (see index.tsx).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, IconButton, SelectField, TextField, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { pluginFetch } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { executeControl } from '@console/control/executor';
import * as ud from '../../../../../framework/core/ui-directory.mjs';
import type { Directory, Row, TreeNode } from '../../../../../framework/core/ui-directory.mjs';
import './ui-directory.css';

export const FOLDER = 'ui-directory';
export const VIEW = 'ui-directory';
/** The app this console is: its rows open here; other apps' rows show how to reach them there. */
export const HERE = 'console-web';

// ------------------------------------------------------------------ page state (readable and settable without the UI)

export interface DirState { q: string; app: string; kind: string; status: string; family: string; open: string[]; all: boolean }
const EMPTY: DirState = { q: '', app: '', kind: '', status: '', family: '', open: [], all: false };
let state: DirState = { ...EMPTY };
const subs = new Set<() => void>();
export const dirState = {
  get: () => state,
  set(patch: Partial<DirState>) { state = { ...state, ...patch }; subs.forEach((f) => f()); },
  reset() { state = { ...EMPTY }; subs.forEach((f) => f()); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
const useDirState = () => useSyncExternalStore(dirState.subscribe, dirState.get, dirState.get);

// ------------------------------------------------------------------ data

let cache: Directory | null = null;
export async function loadDirectory(force = false): Promise<Directory> {
  if (cache && !force) return cache;
  const r = await pluginFetch(FOLDER, 'directory');
  if (!r.ok) throw new Error(`The directory did not load (${r.status}).`);
  cache = (await r.json()) as Directory;
  return cache;
}

/** Open a row's UI in this console: console-control `open` on its address, else its deep link. */
export async function openRow(rt: AxfRuntime, row: Row): Promise<{ ok: boolean; message: string }> {
  if (row.app !== HERE) return { ok: false, message: `${row.name} lives in ${row.app}; open it there (${ud.reachOf(row)?.cli ?? 'no deep link'}).` };
  if (row.address && !row.address.startsWith('plugin:')) {
    const a = await executeControl(rt, { verb: 'open', address: row.address, by: 'ui-directory' });
    if (a.ok) return { ok: true, message: `Opened ${row.name}.` };
  }
  const link = row.deepLink;
  if (!link) return { ok: false, message: `${row.name} has no deep link.` };
  if (link.tool === 'console_dialog') rt.openDialog(link.target);
  else if (link.tool === 'console_settings') rt.dispatch(`settings.open:${link.target}`);
  else if (link.target.startsWith('plugin:')) return { ok: false, message: `${row.name} has no screen of its own.` };
  else rt.navigate(link.target.split(' ')[0]!);
  return { ok: true, message: `Opened ${row.name}.` };
}

/** Open a row's settings interface (its own settings link, else its plugin's settings tab). */
export async function openSettings(rt: AxfRuntime, rows: Row[], row: Row) {
  const s = ud.settingsOf(rows, row.id);
  return s ? openRow(rt, s) : { ok: false, message: `${row.name} has no settings interface.` };
}

/** The rows the filters keep, plus the app and plugin rows that name their groups. */
export function visibleRows(rows: Row[], f: DirState): Row[] {
  const active = !!(f.q || f.app || f.kind || f.status || f.family);
  if (!active) return rows;
  const hit = ud.filterRows(rows, { q: f.q, app: f.app, kind: f.kind, status: f.status, family: f.family });
  const keep = new Set(hit.map((r) => r.id));
  const groups = new Set(hit.map((r) => `${r.app}/${r.plugin}`));
  const apps = new Set(hit.map((r) => r.app));
  for (const r of rows) {
    if (r.kind === 'app' && apps.has(r.app)) keep.add(r.id);
    if (r.kind === 'plugin' && groups.has(`${r.app}/${r.plugin}`)) keep.add(r.id);
  }
  return rows.filter((r) => keep.has(r.id));
}

const count = (n: TreeNode): number => n.children.reduce((s, c) => s + 1 + count(c), 0);
const ids = (nodes: TreeNode[], out: string[] = []) => { for (const n of nodes) { if (n.children.length) { out.push(n.id); ids(n.children, out); } } return out; };
const options = (rec: Record<string, number> | undefined, label: (k: string) => string = (k) => k) =>
  Object.entries(rec ?? {}).sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => ({ value: k, label: `${label(k)} (${n})` }));

// ------------------------------------------------------------------ the page

export function UiDirectoryPage() {
  const rt = useRuntime();
  const f = useDirState();
  const [dir, setDir] = useState<Directory | null>(cache);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');

  const load = async (force = false) => {
    try { setDir(await loadDirectory(force)); setError(''); } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => dir?.rows ?? [], [dir]);
  const shown = useMemo(() => visibleRows(rows, f), [rows, f]);
  const nodes = useMemo(() => ud.tree(shown), [shown]);
  const filtering = !!(f.q || f.app || f.kind || f.status || f.family);
  const hits = filtering ? shown.filter((r) => ud.filterRows([r], { q: f.q, app: f.app, kind: f.kind, status: f.status, family: f.family }).length).length : rows.length;
  const isOpen = (id: string) => f.all || filtering || f.open.includes(id);
  const toggle = (id: string) => {
    if (f.all || filtering) { const every = ids(nodes).filter((x) => x !== id); dirState.set({ all: false, open: every }); return; }
    dirState.set({ open: f.open.includes(id) ? f.open.filter((x) => x !== id) : [...f.open, id] });
  };

  const rebuild = async () => {
    setBusy(true);
    try {
      const r = await pluginFetch(FOLDER, 'rebuild', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'directory page' }) });
      const j = (await r.json()) as { wrote?: boolean; total?: number; diff?: { added?: number; removed?: number } };
      rt.toast(j.wrote ? `Rebuilt: ${j.total} rows (+${j.diff?.added ?? 0}, -${j.diff?.removed ?? 0}).` : `Up to date: ${j.total} rows.`, 'info', 'UI Directory');
      await load(true);
    } catch { rt.toast('The rebuild did not run.', 'warning', 'UI Directory'); } finally { setBusy(false); }
  };

  const open = async (row: Row) => { const r = await openRow(rt, row); if (!r.ok) rt.toast(r.message, 'warning', 'UI Directory'); };
  const settings = async (row: Row) => { const r = await openSettings(rt, rows, row); if (!r.ok) rt.toast(r.message, 'warning', 'UI Directory'); };

  const head = (
    <header className="axp-uidir__head">
      <h2 className="axp-uidir__title"><Icon name="layers" size={18} /> UI Directory</h2>
      {dir ? <span className="axp-uidir__sum fx-muted">{filtering ? `${hits} of ${dir.total}` : dir.total} UIs · {Object.keys(dir.counts.apps).length} apps · built {new Date(dir.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> : null}
    </header>
  );

  if (error && !dir) return <div className="fx-stack axp-uidir">{head}<EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => void load(true) }}>{error}</EmptyState></div>;
  if (!dir) return <div className="fx-stack axp-uidir">{head}<LoadingSkeleton rows={8} label="Loading every UI" /></div>;

  return (
    <div className="fx-stack axp-uidir" data-axf-target="ui-directory.page">
      {head}
      <div className="axp-uidir__tools" role="toolbar" aria-label="Search and filter the UI directory">
        <TextField className="axp-uidir__search" type="search" label="Search" placeholder="Find a screen, tab, dialog or setting…" value={f.q} onChange={(q) => dirState.set({ q })} />
        <SelectField className="axp-uidir__sel" label="App" empty="Every app" value={f.app} onChange={(app) => dirState.set({ app })} options={options(dir.counts.apps)} />
        <SelectField className="axp-uidir__sel" label="Kind" empty="Every kind" value={f.kind} onChange={(kind) => dirState.set({ kind })} options={options(dir.counts.kinds, (k) => ud.KIND_LABEL[k as Row['kind']] ?? k)} />
        <SelectField className="axp-uidir__sel" label="Status" empty="Any status" value={f.status} onChange={(status) => dirState.set({ status })} options={options(dir.counts.statuses, (k) => ud.STATUS_LABEL[k as Row['status']] ?? k)} />
        <SelectField className="axp-uidir__sel" label="Tokens" empty="Any tokens" value={f.family} onChange={(family) => dirState.set({ family })} options={ud.TOKEN_FAMILIES.map((t) => ({ value: t, label: t }))} />
        <span className="axp-uidir__fold">
          <IconButton icon="chevron-down" label="Expand all" title="Open every group" onClick={() => dirState.set({ all: true })} />
          <IconButton icon="chevron-up" label="Collapse all" title="Close every group" onClick={() => dirState.set({ all: false, open: [] })} />
          {filtering ? <IconButton icon="x" label="Clear filters" onClick={() => dirState.set({ q: '', app: '', kind: '', status: '', family: '' })} /> : null}
          <Button size="sm" icon="refresh" busy={busy} onClick={() => void rebuild()}>Rebuild</Button>
        </span>
      </div>
      {nodes.length ? (
        <ul className="axp-uidir__tree" role="tree" aria-label="Every UI, by app">
          {nodes.map((n) => <Node key={n.id} n={n} depth={0} isOpen={isOpen} toggle={toggle} info={info} setInfo={setInfo} open={open} settings={settings} rows={rows} />)}
        </ul>
      ) : <EmptyState icon="search" compact action={{ label: 'Clear filters', icon: 'x', onClick: () => dirState.set({ q: '', app: '', kind: '', status: '', family: '' }) }}>No UI matches.</EmptyState>}
    </div>
  );
}

interface NodeProps {
  n: TreeNode; depth: number; rows: Row[]; info: string; setInfo: (id: string) => void;
  isOpen: (id: string) => boolean; toggle: (id: string) => void; open: (r: Row) => void; settings: (r: Row) => void;
}

function Node({ n, depth, rows, info, setInfo, isOpen, toggle, open, settings }: NodeProps) {
  const row = n.row;
  const kids = n.children.length;
  const expanded = kids > 0 && isOpen(n.id);
  const here = row?.app === HERE;
  const canOpen = !!row && here && !!(row.deepLink || row.address) && row.kind !== 'app';
  const settingsRow = row && here ? ud.settingsOf(rows, row.id) : null;
  const showInfo = info === n.id && !!row;
  const label = row?.kind === 'app' ? `${n.name}` : n.name;
  return (
    <li className={`axp-uidir__node is-${n.kind}`} role="treeitem" aria-expanded={kids ? expanded : undefined} aria-level={depth + 1}>
      <div className="axp-uidir__line" style={{ ['--axp-uidir-depth' as string]: depth }}>
        <button type="button" data-fx-row data-axf-target={`ui-directory.row.${n.id.replace(/[^a-z0-9._-]+/gi, '-')}`} className="axp-uidir__main" onClick={() => (kids ? toggle(n.id) : row ? setInfo(showInfo ? '' : n.id) : undefined)} aria-label={kids ? `${expanded ? 'Close' : 'Open'} ${label}` : `About ${label}`}>
          <span className="axp-uidir__chev">{kids ? <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} /> : null}</span>
          <Icon name={row?.icon || KIND_ICON[n.kind] || 'box'} size={14} />
          <span className="axp-uidir__name">{label}</span>
          <span className="axp-uidir__kind fx-muted">{ud.KIND_LABEL[n.kind] ?? n.kind}{kids ? ` · ${count(n)}` : ''}</span>
          {row && row.status !== 'live' ? <Chip tone={row.status === 'off' ? undefined : 'warning'}>{ud.STATUS_LABEL[row.status]}</Chip> : null}
        </button>
        <span className="axp-uidir__acts">
          {row && row.kind !== 'app' ? <IconButton icon="info" label={`How to reach ${label}`} aria-pressed={showInfo} onClick={() => setInfo(showInfo ? '' : n.id)} /> : null}
          {settingsRow && settingsRow.id !== row?.id ? <IconButton icon="settings" label={`Settings of ${label}`} title={`Settings: ${settingsRow.name}`} onClick={() => row && settings(row)} /> : null}
          {canOpen ? <IconButton icon="external" label={`Open ${label}`} onClick={() => row && open(row)} /> : null}
        </span>
      </div>
      {showInfo && row ? <Reach row={row} depth={depth} /> : null}
      {expanded ? <ul role="group" className="axp-uidir__kids">{n.children.map((c) => <Node key={c.id} n={c} depth={depth + 1} rows={rows} info={info} setInfo={setInfo} isOpen={isOpen} toggle={toggle} open={open} settings={settings} />)}</ul> : null}
    </li>
  );
}

const KIND_ICON: Record<string, string> = { app: 'monitor', screen: 'layout', tab: 'list', dialog: 'maximize', 'settings-tab': 'settings', 'settings-panel': 'sliders', plugin: 'package', banner: 'bell', window: 'restore', element: 'box' };

/** The row's facts and the four doors to it without the UI. */
function Reach({ row, depth }: { row: Row; depth: number }) {
  const rt = useRuntime();
  const reach = ud.reachOf(row);
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => rt.toast('Copied.', 'success', 'UI Directory'), () => rt.toast(text, 'info', 'UI Directory'));
  const lines: [string, string][] = [
    ['Id', row.id],
    ...(row.address ? [['Address', row.address] as [string, string]] : []),
    ...(row.file ? [['File', row.file] as [string, string]] : []),
    ...(row.tokens.length ? [['Tokens', row.tokens.join(', ')] as [string, string]] : []),
    ...(reach ? [
      ['MCP', `${reach.mcp.tool} ${reach.mcp.target}`],
      ['REST', `${reach.rest.method} ${reach.rest.path} ${JSON.stringify(reach.rest.body)}`],
      ['CLI', reach.cli],
      ['Voice', `“${reach.voice}”`],
    ] as [string, string][] : []),
  ];
  return (
    <dl className="axp-uidir__reach fx-small" style={{ ['--axp-uidir-depth' as string]: depth }}>
      {row.detail ? <p className="axp-uidir__detail fx-muted">{row.detail}</p> : null}
      {lines.map(([k, v]) => (
        <div key={k} className="axp-uidir__fact">
          <dt className="fx-muted">{k}</dt>
          <dd className="axp-uidir__val">{v}</dd>
          <IconButton icon="copy" label={`Copy ${k}`} size={12} onClick={() => copy(v)} />
        </div>
      ))}
    </dl>
  );
}

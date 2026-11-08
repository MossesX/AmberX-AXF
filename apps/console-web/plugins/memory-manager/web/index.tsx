/**
 * Memory Manager: a Markdown browser and editor for every .md file Brett works with (Project, Claude, Repo and the Notes
 * Vault), built on the dock engine (dock@1): each file is a dock tab, so tabs float, split, resize and drop on any tab
 * header or into a split. The toolbar switches between four views (Browse, Read, Write, IDE) that change how the
 * column, the tabs and the panes render. Commands: every server route plus the actions below are plugin commands
 * (REST, MCP, `axf memory-manager …`), so Amber can open and edit docs by voice.
 */
import { useEffect } from 'react';
import { DockHost, IconButton, Note, Segmented, useRuntime, useIsPhone } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { Column } from './Column';
import { ChainPane, DocPane, OutlinePane, RefsPane } from './Doc';
import { appMenu } from './menu';
import { MemorySettings, applyFilterText, buildChunks, deleteFile, loadMemory, moveFile, searchInside, setPanel, setSettingText, showDetails, type Panel } from './memory';
import { VIEWS, idFromLoose, viewOf, type ViewId } from './model';
import { FOLDER, K, VIEW_ID, activeDocId, bindRuntime, loadListing, openDoc, saveDoc, setEditable, setSidePanes, setView, studio, useStudio } from './state';
import './memory-manager.css';

const ID = 'ai.amberx.axf.console.memory-manager';
const VERSION = '0.1.0';

/** Deep links (`#/memory-manager?…`): `memory=<id or path>` opens a file, `memory-context=` its context view, `memory-panel=memory|files|chunks|start` picks the column panel, `memory-file=<path>` shows who reads and writes it. */
function openFromUrl() {
  const read = (k: string) => new URLSearchParams(location.search).get(k) ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get(k);
  const doc = read('memory'), ctx = read('memory-context'), panel = read('memory-panel'), file = read('memory-file');
  if (panel) setPanel(panel as Panel);
  if (file) showDetails(file);
  if (doc) openDoc(idFromLoose(doc));
  if (ctx) openDoc(idFromLoose(ctx), 'tab', 'mm-chain');
}

function StudioView() {
  const rt = useRuntime();
  const view = useStudio((s) => s.view);
  const phone = useIsPhone();
  const v = viewOf(view);
  useEffect(() => { void loadListing(); openFromUrl(); }, []);
  useEffect(() => { setSidePanes(v.side && !phone); }, [v.side, phone]);
  const column = phone ? 'drawer' : v.column;
  return (
    <div className="fx-stack axp-memory-manager" data-view={view} data-column={column}>
      <header className="fx-pagehead axp-memory-manager__head">
        <div className="axp-memory-manager__label"><p className="fx-eyebrow">Claude memory</p><h1>Memory Manager</h1><p className="fx-muted axp-memory-manager__hint">Every memory file, what reads and writes it, and the chunks sessions load. Files open as tabs you can split, float and edit safely. {v.hint}</p></div>
        <div className="axp-memory-manager__acts">
          <Segmented label="View" size="sm" value={view} onChange={(x) => setView(x as ViewId)} options={VIEWS.map((x) => ({ value: x.id, label: x.label, icon: x.icon }))} />
          <IconButton icon="layout" label="Pane layouts" onClick={() => rt.openDialog('dock-layout', { arg: rt.windows.mainWindowId })} />
          <IconButton icon="refresh" label="Reload the file list" onClick={() => void loadListing()} />
        </div>
      </header>
      <div className="axp-memory-manager__cols">
        {column !== 'hidden' && (phone ? <details className="axp-memory-manager__drawer"><summary className="fx-small">Memory, files and chunks</summary><Column /></details> : <Column />)}
        <DockHost className="axp-memory-manager__dock" empty={<div className="fx-empty axp-memory-manager__empty"><p>Pick a file on the left to open it here.</p><p className="fx-small fx-muted">Drag a tab onto another tab header to group it, or onto a pane's edge to split.</p></div>} />
      </div>
    </div>
  );
}

function SettingsPanel() {
  return (
    <div className="fx-stack">
      <p className="fx-muted">Memory Manager opens every Markdown file by scope: <strong>Project</strong> (each project manifest's files), <strong>Claude</strong> (the hub's Claude files of every project; saved with the hub's history), <strong>Repo</strong> (every .md in this checkout) and <strong>Notes</strong> (the Notes Vault, when the Notes plugin is on). Saves are conflict-safe and every save keeps the text it replaced (Version history).</p>
      <Note tone="info">Repo files are saved in the console's checkout: commit them from a session (or the Snapshots plugin) to keep them.</Note>
    </div>
  );
}

const arg = (args: string[], payload?: string) => (args.length ? args.join(':') : payload ?? '').trim();
const needArg = (rt: { toast: (m: string, t?: 'info' | 'warning' | 'danger' | 'success') => void }, s: string) => { if (!s) rt.toast('Say which file, e.g. CLAUDE.md or notes/plans/x.md.', 'warning'); return !!s; };

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Memory Manager',
  version: VERSION,
  appMenu,
  builtWith: { model: 'opus', builtAt: '2026-11-08' },
  register(rt) {
    bindRuntime(rt);
    const go = () => rt.navigate(VIEW_ID);
    rt.actions.register('memory-manager.show', () => go(), { label: 'Open Memory Manager' });
    rt.actions.register('memory-manager.open', (args, ctx) => { const s = arg(args, ctx.payload); if (!needArg(rt, s)) return; go(); openDoc(idFromLoose(s)); }, { label: 'Open a Markdown file in Memory Manager', params: true });
    rt.actions.register('memory-manager.edit', (args, ctx) => { const s = arg(args, ctx.payload); if (!needArg(rt, s)) return; const id = idFromLoose(s); setEditable(id, true); go(); openDoc(id); }, { label: 'Open a Markdown file to edit', params: true });
    rt.actions.register('memory-manager.open-right', (args, ctx) => { const s = arg(args, ctx.payload); if (s) openDoc(idFromLoose(s), 'right'); }, { label: 'Open in a vertical split', params: true });
    rt.actions.register('memory-manager.open-below', (args, ctx) => { const s = arg(args, ctx.payload); if (s) openDoc(idFromLoose(s), 'bottom'); }, { label: 'Open in a horizontal split', params: true });
    rt.actions.register('memory-manager.context', (args, ctx) => { const s = arg(args, ctx.payload); if (!needArg(rt, s)) return; go(); openDoc(idFromLoose(s), 'tab', 'mm-chain'); }, { label: 'Open the context view of a file', params: true });
    rt.actions.register('memory-manager.toggle-edit', (args, ctx) => { const s = arg(args, ctx.payload); const id = s ? idFromLoose(s) : activeDocId(); if (id) setEditable(id, !studio().editable[id]); }, { label: 'Switch editing on or off for a file', params: true });
    rt.actions.register('memory-manager.save', () => { const id = activeDocId(); if (id) void saveDoc(id); }, { label: 'Save the open Markdown file' });
    rt.actions.register('memory-manager.view', (args) => { const v = viewOf(args[0]); setView(v.id); go(); }, { label: 'Switch the Memory Manager view (browse, read, write, ide)', params: true });
    const words = (args: string[], ctx: { payload?: string }) => arg(args, ctx.payload);
    rt.actions.register('memory-manager.memory', (args, ctx) => { go(); setPanel('memory'); const s = words(args, ctx); if (s) applyFilterText(s); else void loadMemory(); }, { label: 'Show the memory list (optional filter)', params: true });
    rt.actions.register('memory-manager.files', () => { go(); setPanel('files'); }, { label: 'Show the Markdown files' });
    rt.actions.register('memory-manager.rescan', () => { go(); setPanel('memory'); void loadMemory(true); }, { label: 'Refresh the memory scan' });
    rt.actions.register('memory-manager.search', (args, ctx) => { go(); void searchInside(words(args, ctx)); }, { label: 'Search inside memory files', params: true });
    rt.actions.register('memory-manager.filter', (args, ctx) => { go(); setPanel('memory'); applyFilterText(words(args, ctx)); }, { label: 'Filter the memory list (category:, kind:, root:, writer:, loaded, clear)', params: true });
    rt.actions.register('memory-manager.details', (args, ctx) => { const s = words(args, ctx); if (!needArg(rt, s)) return; go(); showDetails(s); }, { label: 'Show who reads and writes a memory file', params: true });
    rt.actions.register('memory-manager.move', (args, ctx) => { const [from, to] = args.length >= 2 ? [args[0]!, args.slice(1).join(':')] : (ctx.payload ?? '').split(/\s+/); if (!from || !to) { rt.toast('Say what to move and where, e.g. _claude/plans/a.md _claude/plans/b.md.', 'warning'); return; } if (window.confirm(`Move ${from} to ${to}?`)) void moveFile(idFromLoose(from), to); }, { label: 'Move a memory file', params: true });
    rt.actions.register('memory-manager.delete', (args, ctx) => { const s = words(args, ctx); if (!needArg(rt, s)) return; void deleteFile(idFromLoose(s)); }, { label: 'Delete a memory file (asks first; kept as a version)', params: true });
    rt.actions.register('memory-manager.history', (args, ctx) => { const s = words(args, ctx); if (!needArg(rt, s)) return; go(); openDoc(idFromLoose(s)); }, { label: 'Version history of a memory file', params: true });
    rt.actions.register('memory-manager.chunks', () => { go(); setPanel('chunks'); }, { label: 'Show the memory chunks' });
    rt.actions.register('memory-manager.build-chunks', () => void buildChunks(), { label: 'Rebuild the memory chunks' });
    rt.actions.register('memory-manager.load', () => { go(); setPanel('start'); }, { label: 'What a session loads at start' });
    rt.actions.register('memory-manager.setting', (args, ctx) => void setSettingText(args.length ? args.join(' ') : ctx.payload ?? ''), { label: 'Change a Memory Manager setting (key value)', params: true });
    rt.actions.register('memory-manager.settings', () => rt.dispatch(`settings.open:${FOLDER}`), { label: 'Open Memory Manager settings' });
    rt.actions.register('memory-manager.notes', () => { go(); void loadListing(); }, { label: 'Open the Notes Vault in Memory Manager' });
  },
  views: { [VIEW_ID]: { title: 'Memory Manager', icon: 'file', render: () => <StudioView /> } },
  tabs: {
    'mm-doc': (t) => <DocPane id={t.payload ?? ''} />,
    'mm-chain': (t) => <ChainPane id={t.payload ?? ''} />,
    'mm-outline': () => <OutlinePane />,
    'mm-refs': () => <RefsPane />,
  },
  nav: { label: 'Plugins', items: [{ id: 'memory-manager', label: 'Memory Manager', icon: 'file', view: 'memory-manager' }] }, // literal ids: scripts/menu-reach.mts reads this line
  contextMenu: [{
    id: 'memory-manager.file', target: 'memory-manager-file', items: [
      { id: 'memory-manager.ctx.open', label: 'Open', icon: 'file', action: 'memory-manager.open' },
      { id: 'memory-manager.ctx.right', label: 'Open in vertical split', icon: 'layout', action: 'memory-manager.open-right' },
      { id: 'memory-manager.ctx.below', label: 'Open in horizontal split', icon: 'layout', action: 'memory-manager.open-below' },
      { id: 'memory-manager.ctx.edit', label: 'Edit / lock', icon: 'edit', action: 'memory-manager.toggle-edit' },
      { id: 'memory-manager.ctx.context', label: 'Context view', icon: 'chart', action: 'memory-manager.context' },
    ],
  }],
  settingsTabs: [{ id: FOLDER, label: 'Memory Manager', icon: 'file', order: 92, parent: 'plugins' }],
  settings: [
    {
      id: 'memory-manager.behaviour', label: 'Memory Manager', icon: 'file', tab: FOLDER, order: 10, settings: [
        { key: K.view, label: 'View', kind: 'choice', default: 'browse', scope: 'user', options: VIEWS.map((x) => ({ value: x.id, label: x.label })), description: 'How the column, tabs and panes render.' },
        { key: K.split, label: 'Split direction for references', kind: 'choice', default: 'side', scope: 'user', options: [{ value: 'side', label: 'Vertical (side by side)' }, { value: 'stacked', label: 'Horizontal (stacked)' }], description: 'Where a referenced file opens when you click its name.' },
        { key: K.autosave, label: 'Autosave', kind: 'toggle', default: true, scope: 'user', description: 'Save editable files a moment after you stop typing (never over someone else\'s newer save).' },
        { key: K.autosaveSeconds, label: 'Autosave after (seconds)', kind: 'number', default: 3, min: 1, max: 60, step: 1, scope: 'user' },
        { key: K.depth, label: 'Context view depth', kind: 'number', default: 3, min: 1, max: 6, step: 1, scope: 'user', description: 'How many levels of references the context view follows.' },
      ],
    },
  ],
  settingsPanels: [
    { id: 'memory-manager.memory', tab: FOLDER, title: 'Memory scan, list, safety and chunks', icon: 'layers', order: 15, render: () => <MemorySettings /> },
    { id: 'memory-manager.where', tab: FOLDER, title: 'What it opens', icon: 'folder', order: 20, render: () => <SettingsPanel /> },
    { id: 'memory-manager.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  opens: 'main',
};


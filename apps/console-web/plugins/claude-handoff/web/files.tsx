/**
 * Files the plugin makes or edits (dialog `claude-handoff.files`, from the right-click menu, Tools and the settings tab).
 * Picking one opens it in the plugin's file window: one floating window with a tab group (window manager tab kind
 * `handoff-file`). A file already open in a tab isn't opened twice: its tab is brought to the front and its window
 * focused. The server lists the files and reads only files from that list (by id, never a path).
 */
import { useEffect, useMemo, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon, Markdown, Note, TextField, useAxfState, useRuntime } from '@console/axf/react';
import { lookDocText } from './look';
import { api } from './store';

export const FILE_TAB_KIND = 'handoff-file';
export const FILES_DIALOG = 'claude-handoff.files';

export interface PluginFile {
  id: string; section: 'kit' | 'data' | 'docs' | 'hub' | 'machine'; label: string; path: string;
  made: 'makes' | 'edits'; by: string; exists: boolean; bytes: number; modifiedAt: number | null; remote?: boolean;
}
interface ReadReply extends PluginFile { text: string | null; truncated?: boolean; missing?: boolean }

export const SECTIONS: { id: PluginFile['section']; label: string; icon: string; note: string }[] = [
  { id: 'kit', label: 'Handoff kit', icon: 'package', note: 'Generated into _claude/handoff/ and pushed to GitHub' },
  { id: 'data', label: 'Plugin data', icon: 'save', note: 'Its own folder on the console server' },
  { id: 'hub', label: 'On axHub', icon: 'cloud', note: 'The installer look document on the hub’s data server' },
  { id: 'docs', label: 'Docs it edits', icon: 'file', note: 'One marked line each' },
  { id: 'machine', label: 'This machine', icon: 'monitor', note: 'Only when you run its hook installer or collect here' },
];

const tabIdFor = (f: { id: string }) => `handoff-file-${f.id}`;
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '');

/** Open a file in the file window: focus its tab if it's open, else add a tab (new window when none is open). */
export function openFile(rt: AxfRuntime, f: PluginFile): void {
  const wm = rt.windows;
  const tabId = tabIdFor(f);
  const inGroup = wm.groupOf(tabId);
  if (inGroup) {
    const g = wm.state.groups[inGroup]!;
    wm.activate(inGroup, g.tabs.findIndex((t) => t.id === tabId));
    const win = wm.state.windows.find((w) => w.id === g.windowId);
    if (win?.minimized) wm.restore(win.id); else if (win) wm.focus(win.id);
    return;
  }
  const tab = { id: tabId, title: f.label, kind: FILE_TAB_KIND, payload: JSON.stringify(f), icon: 'file' };
  const group = Object.values(wm.state.groups).find((g) => g.tabs.some((t) => t.kind === FILE_TAB_KIND));
  if (group) {
    wm.addTab(group.id, tab);
    const win = wm.state.windows.find((w) => w.id === group.windowId);
    if (win?.minimized) wm.restore(win.id); else if (win) wm.focus(win.id);
  } else {
    wm.openFloating([tab], 'Claude handoff files', 'floating', Math.min(860, innerWidth - 32), Math.min(560, innerHeight - 120));
  }
}

export function FilesDialog() {
  const rt = useRuntime();
  useAxfState();
  const [files, setFiles] = useState<PluginFile[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const load = () => api.call<{ files: PluginFile[] }>('files').then((r) => { setFiles(r.files); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const openIds = useMemo(() => new Set(Object.values(rt.windows.state.groups).flatMap((g) => g.tabs.filter((t) => t.kind === FILE_TAB_KIND).map((t) => t.id))), [rt.windows.state]);
  if (err) return <Note tone="danger">{err}</Note>;
  if (!files) return <p className="axp-claude-handoff__meta">Loading…</p>;
  const shown = files.filter((f) => !q || `${f.label} ${f.path} ${f.by}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="axp-claude-handoff-files">
      <div className="axp-claude-handoff-files__bar">
        <TextField label="" placeholder="Find a file" value={q} onChange={setQ} />
        <Button tone="ghost" icon="refresh" size="sm" onClick={() => void load()}>Refresh</Button>
      </div>
      <p className="axp-claude-handoff__meta">{files.length} files this plugin makes or edits. Tap one to open it in a tab of the file window; a file already open there just comes to the front.</p>
      {SECTIONS.map((sec) => {
        const list = shown.filter((f) => f.section === sec.id);
        if (!list.length) return null;
        return (
          <section key={sec.id} className="axp-claude-handoff-files__section">
            <header className="axp-claude-handoff-files__head"><Icon name={sec.icon} size={15} /><strong>{sec.label}</strong><span className="axp-claude-handoff__meta">{sec.note}</span></header>
            <ul className="axp-claude-handoff-files__list">
              {list.map((f) => (
                <li key={f.id}>
                  <button type="button" data-fx-row className={`axp-claude-handoff-files__row${openIds.has(tabIdFor(f)) ? ' is-open' : ''}${f.exists || f.remote ? '' : ' is-missing'}`} onClick={() => { rt.closeDialog(); openFile(rt, f); }} title={f.by}>
                    <Icon name="file" size={14} />
                    <span className="axp-claude-handoff-files__text">
                      <span className="axp-claude-handoff-files__name">{f.label}</span>
                      <span className="axp-claude-handoff-files__path">{f.path}</span>
                      <span className="axp-claude-handoff-files__by">{f.by}</span>
                    </span>
                    <span className="axp-claude-handoff-files__side">
                      <Chip tone={f.made === 'edits' ? 'warning' : undefined}>{f.made}</Chip>
                      {openIds.has(tabIdFor(f)) && <Chip tone="accent">open</Chip>}
                      <span className="axp-claude-handoff__meta">{f.remote ? 'on axHub' : f.exists ? kb(f.bytes) : 'not made yet'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** One file in a tab of the file window. */
export function FileTab({ tab }: { tab: { payload?: string } }) {
  const rt = useRuntime();
  const f = useMemo(() => { try { return JSON.parse(tab.payload ?? '{}') as PluginFile; } catch { return null; } }, [tab.payload]);
  const [data, setData] = useState<ReadReply | null>(null);
  const [err, setErr] = useState('');
  const [raw, setRaw] = useState(false);
  const load = async () => {
    if (!f) return;
    try {
      const r = await api.call<ReadReply>(`files/read?id=${f.id}`);
      if (r.remote) r.text = await lookDocText();
      setData(r); setErr('');
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, [f?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <Note tone="danger">This tab lost its file.</Note>;
  const isMd = f.path.endsWith('.md');
  const text = data?.text ?? '';
  return (
    <div className="axp-claude-handoff-filetab">
      <div className="axp-claude-handoff-filetab__bar">
        <span className="axp-claude-handoff-files__path">{f.path}</span>
        {data && !data.remote && <span className="axp-claude-handoff__meta">{data.exists ? `${kb(data.bytes)} · ${when(data.modifiedAt)}` : ''}</span>}
        {isMd && <Button tone="ghost" size="sm" icon="code" onClick={() => setRaw(!raw)}>{raw ? 'Formatted' : 'Raw'}</Button>}
        <Button tone="ghost" size="sm" icon="copy" disabled={!text} onClick={() => { void navigator.clipboard?.writeText(text).then(() => rt.toast('Copied', 'success', 'Claude handoff'), () => undefined); }}>Copy</Button>
        <Button tone="ghost" size="sm" icon="refresh" onClick={() => void load()}>Reload</Button>
      </div>
      <p className="axp-claude-handoff__meta">{f.made === 'edits' ? 'Edited by' : 'Made by'}: {f.by}</p>
      {err && <Note tone="danger">{err}</Note>}
      {data?.missing && <Note>This file hasn’t been made yet.</Note>}
      {data?.truncated && <Note tone="warning">Showing the first 400 KB.</Note>}
      {data && text && (isMd && !raw
        ? <div className="axp-claude-handoff-filetab__doc"><Markdown text={text.replace(/<!--[\s\S]*?-->\n?/g, '')} /></div>
        : <pre className="axp-claude-handoff-filetab__pre">{text}</pre>)}
    </div>
  );
}

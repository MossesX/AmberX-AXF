/**
 * Notes: the console's Notes screen is AmberX's own notes and to-do manager, not a second one. It frames AmberX's Notes
 * page as an embed@1 view page (`?axf-embed=console&axf-embed-page=view:notes`: that one page, no AmberX chrome; its
 * dialogs and toasts still work), so the Inbox, Lists, Notes, Pinned and Search tabs, the item editor, list manager and
 * export are AmberX's, on the one amberx.items / amberx.lists store on axHub that every device reads.
 *
 * Deep links (console_open / console_show `notes` with `focus`, or the action):
 *   action `notes.focus:<focus>`   `item:<id>` | `list:<id>` | `search:<text>` | `add` | inbox | lists | notes | pinned | search
 *   action `notes.open`            the screen as it was
 * The focus rides on the frame's address as `?notes=<focus>`; AmberX's notes plugin reads it on load (ui.ts parseFocus).
 * Reading and changing notes without the UI is control@1 (amberx.items, amberx.lists): REST /api/control, MCP amberx_*,
 * CLI `axf note | todo | task | list`, and AmberX voice.
 */
import { useSyncExternalStore } from 'react';
import { Button, Note, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { embedUrlFull } from '@console/axf/core';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './amberx-notes.css';

const FOLDER = 'amberx-notes';
const VIEW = 'notes';
const URL_KEY = 'amberx-notes.url';
const DEFAULT_URL = 'https://amberx.amberxai.com';

/** The focus the frame opens on, plus a counter so asking for the same focus again reloads it. */
let state = { focus: '', n: 0 };
const subs = new Set<() => void>();
function setFocus(focus: string) { state = { focus: focus.trim().slice(0, 300), n: state.n + 1 }; subs.forEach((f) => f()); }
const useFocus = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);

/** AmberX's address from the setting: https only, no credentials; anything else falls back to the default. */
export function amberxBase(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_URL;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password) return DEFAULT_URL;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return DEFAULT_URL; }
}

/** The frame address: AmberX's Notes page on its own, marked as embedded in the console, with the focus. */
export function notesFrameUrl(base: string, focus: string): string {
  const url = focus ? `${base}/?notes=${encodeURIComponent(focus)}` : `${base}/`;
  return embedUrlFull(url, 'console', { page: `view:${VIEW}` });
}

function NotesScreen() {
  const rt = useRuntime();
  const base = useSyncExternalStore((f) => rt.settings.subscribe(f), () => amberxBase(rt.settings.get(URL_KEY)), () => DEFAULT_URL);
  const { focus, n } = useFocus();
  const src = notesFrameUrl(base, focus);
  return (
    <div className="axp-amberx-notes">
      <div className="axp-amberx-notes__bar" role="toolbar" aria-label="Notes">
        <Button icon="refresh" onClick={() => setFocus(focus)}>Reload</Button>
        <Button icon="external" onClick={() => window.open(focus ? `${base}/?notes=${encodeURIComponent(focus)}` : `${base}/`, '_blank', 'noopener')}>Open in AmberX</Button>
      </div>
      <iframe key={n} className="axp-amberx-notes__frame" title="AmberX notes" src={src} allow="microphone; clipboard-write" referrerPolicy="strict-origin-when-cross-origin" />
    </div>
  );
}

function SettingsNote() {
  return <Note tone="info">Notes are AmberX's: this screen shows AmberX's Notes page, and every note, to-do, task and list lives in AmberX's store on axHub (amberx.items, amberx.lists). Without the screen: <code>axf note | todo | task | list</code>, REST <code>/api/control</code>, MCP <code>amberx_*</code>, or ask AmberX.</Note>;
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.amberx-notes',
  label: 'Notes',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-12' },
  appMenu,
  views: { [VIEW]: { title: 'Notes', icon: 'file', keywords: ['notes', 'note', 'todo', 'todos', 'task', 'list', 'inbox', 'amberx'], render: () => <NotesScreen /> } },
  nav: { label: 'Console', items: [{ id: VIEW, label: 'Notes', icon: 'file', view: VIEW }] },
  settingsTabs: [{ id: FOLDER, label: 'Notes', icon: 'file', order: 90, parent: 'plugins', description: "AmberX's address; install and uninstall" }],
  settings: [{ id: 'amberx-notes.where', label: 'Notes', icon: 'file', tab: FOLDER, settings: [
    { key: URL_KEY, label: 'AmberX address', kind: 'text', default: DEFAULT_URL, description: "Where AmberX's Notes page is served (https). The notes themselves are on axHub." },
    { key: 'amberx-notes.open', label: 'Open Notes', kind: 'link', target: VIEW },
  ] }],
  settingsPanels: [
    { id: 'amberx-notes.about', tab: FOLDER, title: 'Where notes live', icon: 'folder', order: 10, render: () => <SettingsNote /> },
    { id: 'amberx-notes.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    rt.actions.register('notes.open', () => rt.navigate(VIEW), { label: 'Open notes' });
    rt.actions.register('notes.focus', (args) => {
      setFocus(args.map((a) => { try { return decodeURIComponent(a); } catch { return a; } }).join(':'));
      rt.navigate(VIEW);
    }, { label: 'Open a note, list or tab in Notes', params: true });
  },
};

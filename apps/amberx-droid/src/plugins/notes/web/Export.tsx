/**
 * Export (dialog `notes.export`, props `{ id? }` = the list to start on): Markdown or JSON (amberx-notes@1) of
 * everything or one list with its sub-lists, copied to the clipboard or downloaded. Shared Voice notes are included.
 */
import { useMemo, useState } from 'react';
import { Button, SelectField, Segmented, useRuntime } from '../../../axf/react';
import { descendants, toJson, toMarkdown, type Store } from './core';
import { useNotes } from './store';
import { listOptions } from './NotesView';

/** The store cut down to one list and everything under it (for JSON of one list). */
export function subStore(s: Store, id: string): Store {
  const ids = new Set([id, ...descendants(s, id)]);
  const lists = Object.fromEntries(Object.entries(s.lists).filter(([k]) => ids.has(k)));
  const items = Object.fromEntries(Object.entries(s.items).filter(([, i]) => ids.has(i.list)));
  return { lists, items };
}

export function exportText(s: Store, format: 'md' | 'json', id?: string): string {
  if (format === 'md') return toMarkdown(s, id || undefined);
  return toJson(id ? subStore(s, id) : s);
}

export function Export({ start, close }: { start?: string; close: () => void }) {
  const rt = useRuntime();
  const n = useNotes();
  const s = n.view;
  const [id, setId] = useState(start && s.lists[start] ? start : '');
  const [format, setFormat] = useState<'md' | 'json'>('md');
  const out = useMemo(() => exportText(s, format, id), [s, format, id]);
  const name = `amberx-notes${id ? `-${(s.lists[id]?.name ?? id).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}.${format === 'md' ? 'md' : 'json'}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(out); rt.toast('Copied.', 'success', 'Notes'); } catch { rt.toast("The clipboard isn't available here: use Download.", 'warning', 'Notes'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([out], { type: format === 'md' ? 'text/markdown' : 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div className="fx-stack">
      <p className="fx-muted">Copy or download everything, or one list with its sub-lists, as Markdown or JSON.</p>
      <div className="axp-notes-bar">
        <SelectField label="What" value={id} onChange={setId} options={[{ value: '', label: 'Everything' }, ...listOptions(s, false)]} className="axp-notes-grow" />
        <Segmented label="Format" value={format} onChange={setFormat} options={[{ value: 'md', label: 'Markdown' }, { value: 'json', label: 'JSON' }]} />
      </div>
      <pre className="fx-code axp-notes-scroll">{out.length > 20_000 ? `${out.slice(0, 20_000)}\n…` : out}</pre>
      <div className="axp-notes-bar">
        <Button tone="ghost" onClick={close}>Close</Button>
        <Button icon="download" onClick={download}>Download {name}</Button>
        <Button tone="primary" icon="copy" onClick={() => void copy()}>Copy</Button>
      </div>
    </div>
  );
}

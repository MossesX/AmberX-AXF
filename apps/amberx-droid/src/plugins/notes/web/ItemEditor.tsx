/**
 * Item editor (dialog `notes.item`, props `{ id }`): title, text, tags, kind, list; tasks also status, priority, due
 * and checklist. Shared Voice notes are read-only: "Copy into a list" (adoptShared) instead. With the AI connected,
 * Summarize fills title, summary and tags for review before Save.
 */
import { useState } from 'react';
import { Button, Checkbox, Container, IconButton, Markdown, Note, SelectField, Segmented, TextField, useRuntime } from '../../../axf/react';
import { useAiStatus, summarize } from '../../ai/web/client';
import { PRIORITY_LABEL, SYS, isShared, pathOf, removeItems, tagList, updateItem, type Item, type ItemKind, type Priority, type Status } from './core';
import { adoptShared, useNotes } from './store';
import { listOptions, tryDo } from './NotesView';

export function ItemEditor({ id, close }: { id: string; close: () => void }) {
  const n = useNotes();
  const it = n.view.items[id];
  if (!it) return <Note tone="warning">That note is gone (deleted here or on another device).</Note>;
  return isShared(id) ? <SharedItem it={it} close={close} /> : <EditItem it={it} close={close} />;
}

function SharedItem({ it, close }: { it: Item; close: () => void }) {
  const rt = useRuntime();
  const n = useNotes();
  const [to, setTo] = useState<string>(SYS.inbox);
  return (
    <div className="fx-stack">
      <Note tone="info">A shared Voice note ({pathOf(n.view, it.list)}{it.device ? `, from ${it.device}` : ''}). It's read-only here: copy it into one of your lists to edit it.</Note>
      <h3>{it.title}</h3>
      <Markdown text={it.text} />
      <div className="axp-notes-bar">
        <SelectField label="Copy into" value={to} options={listOptions(n.own)} onChange={setTo} className="axp-notes-grow" />
        <Button tone="primary" icon="copy" onClick={() => { adoptShared([it.id], to); rt.toast(`Copied into ${n.own.lists[to]?.name}.`, 'success', 'Notes'); close(); }}>Copy into a list</Button>
      </div>
    </div>
  );
}

function EditItem({ it, close }: { it: Item; close: () => void }) {
  const rt = useRuntime();
  const n = useNotes();
  const ai = useAiStatus();
  const [title, setTitle] = useState(it.title);
  const [text, setText] = useState(it.text);
  const [summary, setSummary] = useState(it.summary);
  const [tags, setTags] = useState(it.tags.join(', '));
  const [kind, setKind] = useState<ItemKind>(it.kind);
  const [list, setList] = useState(it.list);
  const [status, setStatus] = useState<Status>(it.status);
  const [priority, setPriority] = useState<Priority>(it.priority);
  const [due, setDue] = useState(it.due.slice(0, 10));
  const [checklist, setChecklist] = useState(it.checklist);
  const [newBox, setNewBox] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');

  const save = () => {
    const done = tryDo(rt, (s) => updateItem(s, it.id, { title, text, summary, tags: tagList(tags), kind, list, status, priority, due, checklist }));
    if (done) close();
  };
  const runSummary = async () => {
    setBusy(true); setAiNote('');
    const r = await summarize(`${title}\n\n${text}`);
    setBusy(false);
    if (!r) { setAiNote("The AI didn't answer; nothing changed."); return; }
    if (r.title) setTitle(r.title);
    setSummary(r.summary);
    if (r.tags.length) setTags(tagList([...tagList(tags), ...r.tags]).join(', '));
    setAiNote('Filled in by the AI: check it, then Save (or Cancel to keep what was there).');
  };

  return (
    <div className="fx-stack axp-notes-editor">
      <TextField label="Title" value={title} onChange={setTitle} />
      <TextField label="Text" value={text} onChange={setText} rows={8} />
      <div className="axp-notes-bar">
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'note', label: 'Note' }, { value: 'todo', label: 'Todo' }, { value: 'task', label: 'Task' }]} />
        <SelectField label="List" value={list} options={listOptions(n.own)} onChange={setList} className="axp-notes-grow" />
      </div>
      <TextField label="Tags" value={tags} onChange={setTags} placeholder="comma separated, e.g. work, idea" />
      {kind !== 'note' && (
        <div className="axp-notes-bar">
          <SelectField label="Status" value={status} onChange={(v) => setStatus(v as Status)} options={[{ value: 'open', label: 'Open' }, { value: 'doing', label: 'Doing' }, { value: 'done', label: 'Done' }]} />
          <SelectField label="Priority" value={String(priority)} onChange={(v) => setPriority(Number(v) as Priority)} options={PRIORITY_LABEL.map((l, i) => ({ value: String(i), label: l }))} />
          <TextField label="Due" type="date" value={due} onChange={setDue} />
        </div>
      )}
      {(kind === 'task' || checklist.length > 0) && (
        <Container title="Checklist" icon="check">
          <div className="fx-stack">
            {checklist.map((c, i) => (
              <div key={c.id} className="axp-notes-bar">
                <Checkbox label={c.text} checked={c.done} onChange={(v) => setChecklist(checklist.map((x, j) => (j === i ? { ...x, done: v } : x)))} className="axp-notes-grow" />
                <IconButton icon="x" label={`Remove ${c.text}`} onClick={() => setChecklist(checklist.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div className="axp-notes-bar">
              <TextField label="Add to the checklist" value={newBox} onChange={setNewBox} className="axp-notes-grow" />
              <Button size="sm" icon="plus" disabled={!newBox.trim()} onClick={() => { setChecklist([...checklist, { id: `c${Date.now().toString(36)}`, text: newBox.trim(), done: false }]); setNewBox(''); }}>Add</Button>
            </div>
          </div>
        </Container>
      )}
      {(summary || ai.ok) && <TextField label="Summary" value={summary} onChange={setSummary} rows={3} />}
      {aiNote && <Note tone="info">{aiNote}</Note>}
      {it.transcript && it.transcript !== text && <p className="fx-small fx-muted">Heard: “{it.transcript.slice(0, 300)}”</p>}
      <p className="fx-small fx-muted">
        {it.source === 'voice' ? 'Said' : 'Added'} {new Date(it.createdAt).toLocaleString()}{it.device ? ` on ${it.device}` : ''}
        {it.updatedAt !== it.createdAt ? ` · changed ${new Date(it.updatedAt).toLocaleString()}` : ''}
      </p>
      <div className="axp-notes-bar">
        <Button tone="danger" icon="trash" confirm={`Delete “${it.title}”?`} onClick={() => { if (tryDo(rt, (s) => removeItems(s, [it.id]), 'Deleted.') !== undefined) close(); }}>Delete</Button>
        <span className="axp-notes-grow" />
        <Button tone="ghost" onClick={close}>Cancel</Button>
        {ai.ok && <Button icon="sparkles" busy={busy} onClick={() => void runSummary()}>Summarize</Button>}
        <Button tone="primary" icon="save" onClick={save}>Save</Button>
      </div>
    </div>
  );
}

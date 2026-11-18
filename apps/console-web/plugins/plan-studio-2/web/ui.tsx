/**
 * Plan Studio 2.0 page: four sections (Tree, Editor, Say, Trash) laid out by layout.tsx (nav menu, tabs, IDE panes); one tree, nested to any depth, every row dragged (lib-dnd) and right-clicked (context target
 * `axp-plan-studio-2-item`, payload = item id), an editor for the selected item, a Trash tab (undo), a command box and a
 * mic that both go through the server's `say`. Framework controls and tokens only; phone first (the editor drops under
 * the tree on a narrow screen).
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Button, Checkbox, Chip, Icon, IconButton, Note, SelectField, SkinScope, Switch, TextField, useAxfState, useRuntime } from '@console/axf/react';
import { DragLayer, registerZone, startDrag, type DropPos } from '@console/axf/libs/dnd';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as tc from './tree-core.mjs';
import type { Item, Kind, Link, State } from './tree-core.mjs';
import { CTX_TARGET, DIALOGS, DND_ZONE, ID, KEYS, TREE_GRID, VIEW, rowAddress, LINK_ICON, LINK_LABEL, TOP, addItem, deleteItem, download, editItem, exportText, linkAction, linkItem, moveItem, requestFocus, reload, sayCommand, select, sendToBuild, setCollapsed, tookFocus, undoDelete, unlinkItem, useTree, type BuildPreview, type OpResult } from './api';
import * as lc from './layout-core.mjs';
import { LayoutSwitcher, SectionLayout, showSection, type SectionDef } from './layout';
import { canListen, isEnd, listenOnce, micLease, speakOut } from './voice';

const B = 'axp-plan-studio-2';
const setting = (rt: ReturnType<typeof useRuntime>, k: string, d: string) => { try { const v = rt.settings.get(k); return typeof v === 'string' && v ? v : d; } catch { return d; } };
const flag = (rt: ReturnType<typeof useRuntime>, k: string, d: boolean) => { try { const v = rt.settings.get(k); return typeof v === 'boolean' ? v : d; } catch { return d; } };
const kindOptions = tc.KINDS.map((k) => ({ value: k, label: tc.KIND_LABEL[k] }));
const opt = (xs: readonly string[], none: string) => xs.map((x) => ({ value: x, label: x || none }));

/* ---------------------------------------------------------------- the page */

export function PlanStudio2Page() {
  const rt = useRuntime();
  useAxfState();
  const { state, error, selected, focus, busy, store, onHub } = useTree();
  const [q, setQ] = useState('');
  const showDone = flag(rt, KEYS.showDone, true);
  const listRef = useRef<HTMLUListElement>(null);

  // a deep link (plan-studio-2.focus:<id or words>): select it, open its ancestors, scroll to it
  useEffect(() => {
    if (!focus || !state) return;
    const it = tc.resolve(state, focus);
    tookFocus();
    if (!it) { rt.toast(`Nothing in Plan Studio 2.0 matches "${focus}".`, 'warning', 'Plan Studio 2.0'); return; }
    const shut = tc.ancestors(state, it.id).filter((a) => a.collapsed).map((a) => a.id);
    if (shut.length) setCollapsed(shut, false);
    select(it.id); showSection(rt, 'tree');
    setTimeout(() => listRef.current?.querySelector<HTMLElement>(`[data-axf-drop-id="${it.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }, [focus, state, rt]);

  // drops: before / after a row (same parent as the row), inside a row (its last child), or onto the top-level strip
  useEffect(() => registerZone(DND_ZONE, {
    accepts: (d, target) => { const s = state; if (!s || d.kind !== `${DND_ZONE}:item` || d.id === target) return false; return target === TOP || !tc.ancestors(s, target).some((a) => a.id === d.id); },
    positions: (_d, target) => (target === TOP ? ['inside'] : ['before', 'inside', 'after']),
    drop: (d, target, pos: DropPos) => {
      const s = state; if (!s) return;
      if (target === TOP) { void moveItem(d.id, null); return; }
      const t = tc.byId(s, target); if (!t) return;
      if (pos === 'inside') { void moveItem(d.id, t.id); if (t.collapsed) setCollapsed([t.id], false); return; }
      const sibs = tc.children(s, t.parent).filter((x) => x.id !== d.id);
      const at = sibs.findIndex((x) => x.id === t.id);
      void moveItem(d.id, t.parent, pos === 'before' ? at : at + 1);
    },
  }), [state]);

  const rows = useMemo(() => {
    if (!state) return [];
    if (q.trim()) { const ids = new Set(tc.find(state, q, { limit: 500 }).map((h) => h.id)); return state.items.filter((i) => ids.has(i.id)).map((item) => ({ item, depth: 0, kids: tc.children(state, item.id).length, path: tc.pathOf(state, item.id) })); }
    return tc.flatten(state).filter((r) => showDone || !(tc.CHECKABLE.has(r.item.kind) && r.item.done)).map((r) => ({ ...r, path: '' }));
  }, [state, q, showDone]);
  const total = state ? tc.progress(state, null) : { done: 0, total: 0, minutes: 0 };
  const current = state && selected ? tc.byId(state, selected) : null;
  const newPlan = () => rt.openDialog(DIALOGS.item, { parent: null, kind: 'plan' });

  const treeNode = (
    <div className={`${B}__main fx-stack`}>
      <div className={`${B}__tools`} role="toolbar" aria-label="Tree tools">
        <TextField label="Find" value={q} onChange={setQ} type="search" placeholder="Find a plan, step or note…" className={`${B}__find`} />
        <Switch label="Show done" checked={showDone} onChange={(v) => rt.settings.set(KEYS.showDone, v)} />
      </div>
      {!state ? <LoadingSkeleton rows={4} label="Loading the tree" /> : !state.items.length ? (
        <EmptyState icon="branch" action={{ label: 'New plan', icon: 'plus', onClick: newPlan }}>Nothing here yet. Plan Studio 2.0 starts empty and nothing is synced into it: start a plan, or say “new plan” followed by its name.</EmptyState>
      ) : !rows.length ? <EmptyState icon="search" compact>Nothing matches “{q}”.</EmptyState> : (
        <ul className={`${B}__tree`} ref={listRef} role="tree" aria-label="Plan tree" data-axf-scope={TREE_GRID}>
          {rows.map((r) => <Row key={r.item.id} item={r.item} depth={r.depth} kids={r.kids} path={r.path} state={state} selected={selected === r.item.id} />)}
        </ul>
      )}
      {state && state.items.length > 0 && !q && <div className={`${B}__topdrop`} data-axf-drop={DND_ZONE} data-axf-drop-id={TOP}><Icon name="move" size={14} /> Drop here for the top level</div>}
      <p className={`${B}__hint fx-muted`}>Store: {store || '…'}{onHub ? ' (hub shared data)' : ''}. CLI: <code>node apps/console-web/plugins/plan-studio-2/tree.mjs</code>. Every action here is also an MCP tool, a REST command and a voice command.</p>
    </div>
  );
  const node: Record<string, ReactNode> = {
    tree: treeNode,
    editor: current && state ? <Editor item={current} state={state} /> : <EmptyState icon="edit" compact>Pick a row to edit it here.</EmptyState>,
    say: <CommandBox />,
    trash: <TrashTab state={state} />,
  };
  const badge: Record<string, string | undefined> = { tree: state ? String(state.items.length) : undefined, trash: state?.trash.length ? String(state.trash.length) : undefined };
  const sections: SectionDef[] = lc.SECTIONS.map((x) => ({ ...x, badge: badge[x.id], node: node[x.id] }));

  return (
    <SkinScope kind="plugin" id={ID} className={`${B} fx-stack fx-stack--lg`} attrs={{ 'data-axf-scope': `view:${VIEW}`, 'data-axf-view': VIEW }}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Builds · {state ? `${state.items.length} items · ${total.done}/${total.total} steps done${total.minutes ? ` · ${total.minutes} min planned` : ''}` : 'loading'}{state?.trash.length ? ` · ${state.trash.length} in the trash` : ''}</p>
          <h1>Plan Studio 2.0</h1>
          <p className="fx-muted">Plans, sections, steps, notes and lists nested as deep as you like. Right-click or long-press any row for everything you can do to it, drag the grip to move it, or just say it.</p>
        </div>
        <div className={`${B}__actions`} role="toolbar" aria-label="Plan Studio 2.0 actions">
          <Button tone="primary" icon="plus" onClick={newPlan}>New plan</Button>
          <IconButton icon="undo" label="Undo delete" disabled={!state?.trash.length || busy} onClick={() => void undoDelete().then((r) => rt.toast(r.say ?? 'Undone.', 'success', 'Plan Studio 2.0'))} />
          <IconButton icon="chevron-down" label="Expand all" data-axf-target="button:expand-all" disabled={!state} onClick={() => setCollapsed(null, false)} />
          <IconButton icon="chevron-up" label="Collapse all" data-axf-target="button:collapse-all" disabled={!state} onClick={() => setCollapsed(null, true)} />
          <IconButton icon="download" label="Export all as Markdown" disabled={!state?.items.length} onClick={() => void exportText(null, 'md').then((t) => download('plan-studio-2.md', t))} />
          <IconButton icon="refresh" label="Reload" onClick={() => void reload()} />
          <LayoutSwitcher />
        </div>
      </header>
      {error && <Note tone="danger">{error}</Note>}
      <SectionLayout sections={sections} />
      <DragLayer />
    </SkinScope>
  );
}

/* ---------------------------------------------------------------- rows */

function Row({ item, depth, kids, path, state, selected }: { item: Item; depth: number; kids: number; path: string; state: State; selected: boolean }) {
  const rt = useRuntime();
  const prog = kids ? tc.progress(state, item.id) : null;
  const open = () => select(item.id);
  const ctx = (e: { clientX: number; clientY: number; currentTarget: Element }) => { const r = e.currentTarget.getBoundingClientRect(); rt.openContext(e.clientX || r.left, e.clientY || r.bottom, CTX_TARGET, item.id); };
  const done = tc.CHECKABLE.has(item.kind) && item.done;
  return (
    <li className={`${B}__row${selected ? ' is-selected' : ''}${done ? ' is-done' : ''}`} style={{ ['--axp-ps2-depth' as string]: depth }} role="treeitem" aria-selected={selected} aria-expanded={kids ? !item.collapsed : undefined}
      data-fx-ctx-target={CTX_TARGET} data-fx-ctx-payload={item.id} data-axf-drop={DND_ZONE} data-axf-drop-id={item.id} data-axf-target={`row:${item.id}`}>
      <span className={`${B}__grip axf-dnd-grip`} title="Drag to move" onPointerDown={(e: RPointerEvent) => startDrag(e, { kind: `${DND_ZONE}:item`, id: item.id, label: item.title, icon: tc.KIND_ICON[item.kind], trashable: true, onTrash: () => void deleteItem(item.id).then((r) => rt.toast(r.say ?? 'Deleted.', 'info', 'Plan Studio 2.0')) })}><Icon name="grip" size={14} /></span>
      {kids ? <IconButton icon={item.collapsed ? 'chevron-right' : 'chevron-down'} label={item.collapsed ? `Expand ${item.title}` : `Collapse ${item.title}`} className={`${B}__fold`} onClick={() => setCollapsed([item.id], !item.collapsed)} /> : <span className={`${B}__fold is-leaf`} />}
      {tc.CHECKABLE.has(item.kind) ? <Checkbox label="" title={item.done ? 'Done' : 'Not done'} checked={item.done} onChange={(v) => void editItem(item.id, { done: v })} /> : <Icon name={tc.KIND_ICON[item.kind]} size={14} className={`${B}__kind`} />}
      <button type="button" data-fx-row className={`${B}__title`} data-axf-target={`${rowAddress(item.id)}/button:select`} onClick={open} onDoubleClick={() => rt.openDialog(DIALOGS.item, { id: item.id })} title={path || `${tc.KIND_LABEL[item.kind]}: ${item.title}`}>
        <span className={`${B}__text`}>{item.title}</span>
        {path && <span className={`${B}__path fx-muted`}>{path}</span>}
      </button>
      <span className={`${B}__meta`}>
        {item.priority && <Chip tone={item.priority === 'P0' ? 'danger' : item.priority === 'P1' ? 'warning' : undefined}>{item.priority}</Chip>}
        {item.status && item.status !== 'draft' && <Chip tone={item.status === 'active' ? 'accent' : item.status === 'done' ? 'success' : undefined}>{item.status}</Chip>}
        {item.model && <span className={`${B}__n`}>{item.model}</span>}
        {item.minutes > 0 && <span className={`${B}__n`}>{item.minutes} min</span>}
        {prog && prog.total > 0 && <span className={`${B}__n`} title="Steps done">{prog.done}/{prog.total}</span>}
        {item.links.length > 0 && <span className={`${B}__n`} title={item.links.map((l) => `${LINK_LABEL[l.type]}: ${l.label || l.ref}`).join('\n')}><Icon name="external" size={12} /> {item.links.length}</span>}
      </span>
      <IconButton icon="plus" label={`New inside ${item.title}`} className={`${B}__act`} onClick={() => rt.openDialog(DIALOGS.item, { parent: item.id, kind: tc.CHILD_KIND[item.kind] })} />
      <IconButton icon="more" label={`More for ${item.title}`} className={`${B}__act`} onClick={ctx} />
    </li>
  );
}

/* ---------------------------------------------------------------- the editor (the selected row) */

function Editor({ item, state }: { item: Item; state: State }) {
  const rt = useRuntime();
  const [draft, setDraft] = useState(item);
  useEffect(() => setDraft(item), [item]);
  const dirty = JSON.stringify({ ...draft, updatedAt: '' }) !== JSON.stringify({ ...item, updatedAt: '' });
  const save = () => void editItem(item.id, { title: draft.title, body: draft.body, status: draft.status, priority: draft.priority, model: draft.model, minutes: draft.minutes, kind: draft.kind, tags: draft.tags }).then((r) => rt.toast(r.say ?? 'Saved.', 'success', 'Plan Studio 2.0'));
  const path = tc.ancestors(state, item.id);
  const openLink = (l: Link) => {
    if (l.type === 'url') { window.open(l.ref, '_blank', 'noopener'); return; }
    const spec = linkAction(l);
    if (!spec || !rt.dispatch(spec)) rt.toast(`${LINK_LABEL[l.type]} ${l.ref}: its plugin is not installed here.`, 'warning', 'Plan Studio 2.0');
  };
  return (
    <section className={`${B}__editor fx-card`} data-fx-ctx-target={CTX_TARGET} data-fx-ctx-payload={item.id}>
      <p className="fx-eyebrow">{path.length ? path.map((a) => a.title).join(' › ') : 'Top level'} · {tc.KIND_LABEL[item.kind]}</p>
      <div className={`${B}__editrow`} role="toolbar" aria-label="Item actions">
        <Button size="sm" icon="plus" onClick={() => rt.openDialog(DIALOGS.item, { parent: item.id, kind: tc.CHILD_KIND[item.kind] })}>New inside</Button>
        <Button size="sm" icon="move" onClick={() => rt.openDialog(DIALOGS.move, { id: item.id })}>Move to…</Button>
        <Button size="sm" icon="external" onClick={() => rt.openDialog(DIALOGS.link, { id: item.id })}>Link…</Button>
        <Button size="sm" icon="rocket" onClick={() => rt.openDialog(DIALOGS.build, { id: item.id })}>Send to build…</Button>
        <Button size="sm" icon="trash" tone="danger" undoable onClick={() => void deleteItem(item.id).then((r) => rt.toast(r.say ?? 'Deleted.', 'info', 'Plan Studio 2.0'))}>Delete</Button>
      </div>
      <TextField label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
      <TextField label="Notes" value={draft.body} onChange={(v) => setDraft({ ...draft, body: v })} rows={5} placeholder="What it is, why, how far it got…" />
      <div className={`${B}__fields`}>
        <SelectField label="Kind" value={draft.kind} options={kindOptions} onChange={(v) => setDraft({ ...draft, kind: v as Kind })} />
        <SelectField label="Status" value={draft.status} options={opt(tc.STATUSES, 'none')} onChange={(v) => setDraft({ ...draft, status: v as Item['status'] })} empty="none" />
        <SelectField label="Priority" value={draft.priority} options={opt(tc.PRIORITIES, 'none')} onChange={(v) => setDraft({ ...draft, priority: v })} />
        <SelectField label="Model" value={draft.model} options={opt(tc.MODELS, 'any')} onChange={(v) => setDraft({ ...draft, model: v })} />
        <TextField label="Minutes" type="number" value={draft.minutes ? String(draft.minutes) : ''} onChange={(v) => setDraft({ ...draft, minutes: Number(v) || 0 })} />
        <TextField label="Tags" value={draft.tags.join(', ')} onChange={(v) => setDraft({ ...draft, tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="comma, separated" />
      </div>
      {item.links.length > 0 && (
        <ul className={`${B}__links`} aria-label="Links">
          {item.links.map((l) => (
            <li key={`${l.type}:${l.ref}`}>
              <Button size="sm" tone="quiet" icon={LINK_ICON[l.type]} onClick={() => openLink(l)}>{LINK_LABEL[l.type]}: {l.label || l.ref}</Button>
              <IconButton icon="x" label={`Remove link ${l.label || l.ref}`} onClick={() => void unlinkItem(item.id, l)} />
            </li>
          ))}
        </ul>
      )}
      <div className={`${B}__editrow`}>
        <Button tone="primary" icon="save" disabled={!dirty} onClick={save}>Save</Button>
        <Button tone="quiet" disabled={!dirty} onClick={() => setDraft(item)}>Discard</Button>
        <span className={`${B}__n fx-muted`}>Changed {new Date(item.updatedAt).toLocaleString()}{item.by ? ` by ${item.by}` : ''}</span>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the trash */

function TrashTab({ state }: { state: State | null }) {
  const rt = useRuntime();
  if (!state) return <LoadingSkeleton rows={2} label="Loading the trash" />;
  if (!state.trash.length) return <EmptyState icon="trash">The trash is empty. Deleted items wait here (the last {tc.TRASH_MAX}) until you bring them back.</EmptyState>;
  return (
    <ul className={`${B}__trash`} aria-label="Deleted items">
      {[...state.trash].reverse().map((t) => (
        <li key={t.id}>
          <Icon name="trash" size={14} />
          <span className={`${B}__text`}>{t.title}</span>
          <span className={`${B}__n fx-muted`}>{t.items.length} item{t.items.length === 1 ? '' : 's'} · {new Date(t.at).toLocaleString()}{t.by ? ` · ${t.by}` : ''}</span>
          <Button size="sm" icon="undo" onClick={() => void undoDelete(t.id).then((r) => rt.toast(r.say ?? 'Restored.', 'success', 'Plan Studio 2.0'))}>Restore</Button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- the command box + mic (both → the server's `say`) */

function CommandBox() {
  const rt = useRuntime();
  const [text, setText] = useState('');
  const [log, setLog] = useState<{ heard: string; said: string; ok: boolean }[]>([]);
  const [listening, setListening] = useState(false);
  const stop = useRef(false);
  const lang = setting(rt, KEYS.voiceLang, 'en-US');
  const agentVoice = setting(rt, KEYS.voiceOut, 'auto') === 'auto' && rt.libraries.some((l) => (l.provides ?? []).includes('axf.agent-voice@1'));
  const run = async (heard: string, speak: boolean) => {
    const h = heard.trim(); if (!h) return;
    let r: OpResult;
    try { r = await sayCommand(h); } catch (e) { r = { ok: false, say: (e as Error).message }; }
    const said = r.say ?? (r.ok ? 'Done.' : 'That did not work.');
    setLog((l) => [{ heard: h, said, ok: r.ok }, ...l].slice(0, 8));
    if (r.focus) requestFocus(r.focus.replace(/^plan-studio-2\.focus:/, ''));
    else if (r.item?.id) select(r.item.id);
    if (speak) await speakOut(said, { agentVoice, lang });
  };
  const talk = async () => {
    if (listening) { stop.current = true; return; }
    const lease = micLease();
    if (!lease.take('plan-studio-2')) { rt.toast(`${lease.holder()} is using the microphone.`, 'warning', 'Plan Studio 2.0'); return; }
    lease.release('plan-studio-2');
    setListening(true); stop.current = false;
    let silence = 0;
    try {
      while (!stop.current && silence < 2) {
        if (!lease.take('plan-studio-2')) break;
        let heard = '';
        try { heard = await listenOnce(lang); } catch (e) { rt.toast((e as Error).message, 'warning', 'Plan Studio 2.0'); break; } finally { lease.release('plan-studio-2'); }
        if (!heard) { silence += 1; continue; }
        if (isEnd(heard)) { await speakOut('Okay.', { agentVoice, lang }); break; }
        silence = 0;
        await run(heard, true);
      }
    } finally { setListening(false); }
  };
  return (
    <div className={`${B}__cmd`}>
      <div className={`${B}__cmdrow`} role="toolbar" aria-label="Say a command">
        <TextField label="Say it" value={text} onChange={setText} placeholder="new plan Launch · add a step Deploy to Launch · rename Deploy to Ship · move Ship into Launch · delete Ship · undo" className={`${B}__cmdin`} />
        <Button icon="play" onClick={() => { void run(text, false); setText(''); }} disabled={!text.trim()}>Run</Button>
        {canListen() && <Button icon={listening ? 'pause' : 'mic'} tone={listening ? 'danger' : 'neutral'} onClick={() => void talk()}>{listening ? 'Stop' : 'Talk'}</Button>}
      </div>
      {log.length > 0 && (
        <ul className={`${B}__log`} aria-label="Commands so far">
          {log.map((e, i) => <li key={i} className={e.ok ? '' : 'is-error'}><span className="is-heard">{e.heard}</span><span>{e.said}</span></li>)}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- dialogs */

/** New (props.parent, props.kind) or edit (props.id). */
export function ItemDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const { state } = useTree();
  const editing = typeof props.id === 'string' ? tc.byId(state ?? tc.emptyState(), props.id) : null;
  const parentId = editing ? editing.parent : typeof props.parent === 'string' ? props.parent : null;
  const parent = parentId && state ? tc.byId(state, parentId) : null;
  const [kind, setKind] = useState<Kind>(editing?.kind ?? (tc.KINDS.includes(props.kind as Kind) ? (props.kind as Kind) : parent ? tc.CHILD_KIND[parent.kind] : 'plan'));
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [priority, setPriority] = useState(editing?.priority ?? '');
  const [model, setModel] = useState(editing?.model ?? (kind === 'step' ? setting(rt, KEYS.defaultModel, '') : ''));
  const [minutes, setMinutes] = useState(editing?.minutes ? String(editing.minutes) : '');
  const [err, setErr] = useState('');
  const save = async () => {
    if (!title.trim()) { setErr('Give it a name.'); return; }
    try {
      const patch = { title, body, priority, model, minutes: Number(minutes) || 0, kind };
      const r = editing ? await editItem(editing.id, patch) : await addItem({ parent: parentId, ...patch });
      if (!r.ok) throw new Error(r.error || 'not saved');
      if (r.item?.id) select(r.item.id);
      rt.toast(r.say ?? 'Saved.', 'success', 'Plan Studio 2.0'); close();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className={`${B}__dialog fx-stack`}>
      <p className="fx-muted">{editing ? `Editing ${tc.KIND_LABEL[editing.kind].toLowerCase()} “${editing.title}”.` : parent ? `New inside “${parent.title}”.` : 'New at the top level.'}</p>
      <SelectField label="Kind" value={kind} options={kindOptions} onChange={(v) => setKind(v as Kind)} />
      <TextField label="Title" value={title} onChange={setTitle} autoFocus required placeholder={`A ${tc.KIND_LABEL[kind].toLowerCase()} name`} />
      <TextField label="Notes" value={body} onChange={setBody} rows={4} />
      <div className={`${B}__fields`}>
        <SelectField label="Priority" value={priority} options={opt(tc.PRIORITIES, 'none')} onChange={setPriority} />
        <SelectField label="Model" value={model} options={opt(tc.MODELS, 'any')} onChange={setModel} />
        <TextField label="Minutes" type="number" value={minutes} onChange={setMinutes} />
      </div>
      {err && <Note tone="danger">{err}</Note>}
      <div className={`${B}__editrow`}>
        <Button tone="primary" icon="save" onClick={() => void save()}>{editing ? 'Save' : 'Add'}</Button>
        <Button tone="quiet" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

export function MoveDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const { state } = useTree();
  const it = state && typeof props.id === 'string' ? tc.byId(state, props.id) : null;
  const [to, setTo] = useState<string>(it?.parent ?? '');
  if (!state || !it) return <Note tone="warning">That item is gone.</Note>;
  const under = new Set([it.id, ...tc.descendants(state, it.id).map((d) => d.id)]);
  const options = state.items.filter((x) => !under.has(x.id)).map((x) => ({ value: x.id, label: `${'· '.repeat(tc.depthOf(state, x.id))}${x.title} (${tc.KIND_LABEL[x.kind]})` }));
  return (
    <div className={`${B}__dialog fx-stack`}>
      <p className="fx-muted">Move “{it.title}” and everything under it.</p>
      <SelectField label="Into" value={to} options={options} onChange={setTo} empty="Top level" />
      <div className={`${B}__editrow`}>
        <Button tone="primary" icon="move" onClick={() => void moveItem(it.id, to || null).then((r) => { rt.toast(r.say ?? 'Moved.', 'success', 'Plan Studio 2.0'); close(); })}>Move</Button>
        <Button tone="quiet" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

export function LinkDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const { state } = useTree();
  const it = state && typeof props.id === 'string' ? tc.byId(state, props.id) : null;
  const [type, setType] = useState<tc.LinkType>('todo');
  const [ref, setRef] = useState('');
  const [label, setLabel] = useState('');
  if (!state || !it) return <Note tone="warning">That item is gone.</Note>;
  const hint: Record<tc.LinkType, string> = { todo: 'The to-do entry id from the Todo manager.', build: 'A build id (profile:id or id) from the Build orchestrator.', note: 'A note path from Notes.', shipped: 'A build or feature id from Shipped features.', plan: 'Another Plan Studio 2.0 item id.', url: 'Any https:// address.' };
  return (
    <div className={`${B}__dialog fx-stack`}>
      <p className="fx-muted">Link “{it.title}” to something else. Links are explicit: nothing is synced either way.</p>
      <SelectField label="Link to" value={type} options={tc.LINK_TYPES.map((t) => ({ value: t, label: LINK_LABEL[t] }))} onChange={(v) => setType(v as tc.LinkType)} />
      <TextField label="Reference" value={ref} onChange={setRef} hint={hint[type]} mono required autoFocus />
      <TextField label="Label" value={label} onChange={setLabel} placeholder="Shown instead of the reference" />
      <div className={`${B}__editrow`}>
        <Button tone="primary" icon="external" disabled={!ref.trim()} onClick={() => void linkItem(it.id, { type, ref, label }).then((r) => { rt.toast(r.say ?? 'Linked.', 'success', 'Plan Studio 2.0'); close(); })}>Add link</Button>
        <Button tone="quiet" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

export function BuildDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const { state } = useTree();
  const it = state && typeof props.id === 'string' ? tc.byId(state, props.id) : null;
  const [preview, setPreview] = useState<BuildPreview | null>(null);
  const [err, setErr] = useState('');
  const [buildId, setBuildId] = useState('');
  useEffect(() => { if (it) void sendToBuild(it.id, { preview: true }).then((r) => { if ('preview' in r && r.preview) setPreview(r as BuildPreview); else setErr((r as OpResult).error || 'no preview'); }, (e: Error) => setErr(e.message)); }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!state || !it) return <Note tone="warning">That item is gone.</Note>;
  const send = () => void sendToBuild(it.id, { buildId: buildId.trim() || undefined }).then((r) => {
    const o = r as OpResult;
    if (!o.ok) { setErr(o.error || 'not sent'); return; }
    rt.toast(o.say ?? 'Sent.', 'success', 'Plan Studio 2.0'); close();
    if (o.build) rt.dispatch(`build-orchestrator.open:${o.build.id}`);
  }, (e: Error) => setErr(e.message));
  return (
    <div className={`${B}__dialog fx-stack`}>
      <p className="fx-muted">“{it.title}” becomes a pending build in the Build orchestrator. Its open steps (any depth) become the build's steps; the item gets a link back to the build.</p>
      {err && <Note tone="danger">{err}</Note>}
      {preview && (
        <>
          <p className={`${B}__n`}>{preview.change.steps.length} steps · {preview.minutes} min · profile {preview.build.profile}</p>
          <ol className={`${B}__steps`}>{preview.change.steps.map((s, i) => <li key={i}>{s.text} <span className="fx-muted">{s.model}{s.estimate ? `, ${s.estimate}` : ''}</span></li>)}</ol>
          <TextField label="Build id" value={buildId} onChange={setBuildId} placeholder={preview.build.id} mono hint="Lower-case letters, digits and dashes; made from the title when empty." />
        </>
      )}
      <div className={`${B}__editrow`}>
        <Button tone="primary" icon="rocket" disabled={!preview} onClick={send}>Send to the orchestrator</Button>
        <Button tone="quiet" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

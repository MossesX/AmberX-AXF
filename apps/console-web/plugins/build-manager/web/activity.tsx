/*
 * Build manager — Activity: everything that happened to what's still to build (queue-log@1). Every add, removal, move,
 * status, model, estimate, step and note on the pending list, the build queue and the plan, with who did it, from
 * where, why, and the prompt that caused it. Server: GET /api/plugins/build-manager/queue-log, POST …/queue-log/why.
 * Theme tokens only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { describe, KIND_LABEL, OP_GROUPS, OP_LABEL, type FlatEvent, type LogKind, type LogView } from '@console/axf/plan/queue-log-core.mjs';

const api = pluginApi('build-manager', 'The build manager plugin');

const OP_ICON: Record<string, string> = {
  added: 'plus', removed: 'trash', moved: 'shuffle', status: 'star', completed: 'check-circle', reopened: 'refresh', rework: 'alert', 'rework-cleared': 'check',
  model: 'sliders', title: 'edit', detail: 'edit', estimate: 'clock', priority: 'star', wave: 'layers', effort: 'zap', parent: 'branch', deps: 'branch',
  'step-added': 'plus', 'step-removed': 'minus', 'step-done': 'check', 'step-undone': 'x', 'step-edited': 'edit', 'note-added': 'type', dirty: 'alert',
};
const OP_TONE: Record<string, string> = { added: 'ok', completed: 'ok', 'step-done': 'ok', removed: 'danger', rework: 'warn', dirty: 'warn', moved: 'accent' };
const GROUP_LABEL: Record<string, string> = { structure: 'Added · removed · moved', state: 'Status', fields: 'Fields', steps: 'Steps', notes: 'Notes' };
const DAYS = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [3650, 'All time']] as const;
const KINDS: LogKind[] = ['pending', 'queue', 'plan'];

const time = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };
const dayLabel = (iso: string) => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return ''; const t = new Date(); const y = new Date(t.getTime() - 86400_000); return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' }); };
const val = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? Object.entries(v as Record<string, unknown>).filter(([, x]) => x).map(([k, x]) => `${k} ${String(x)}`).join(' · ') : String(v));

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return <button type="button" className={`axp-build-manager__chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onClick} title={title}>{children}</button>;
}

interface Batch { id: string; at: string; by?: string; surface?: string; source?: string; reason?: string; prompt?: string; changeId?: string; wop?: string; events: FlatEvent[] }
function batches(events: FlatEvent[]): Batch[] {
  const out: Batch[] = [];
  const idx = new Map<string, Batch>();
  for (const e of events) {
    let b = idx.get(e.batch);
    if (!b) { b = { id: e.batch, at: e.at, by: e.by, surface: e.surface, source: e.source, reason: e.reason, prompt: e.prompt, changeId: e.changeId, wop: e.wop, events: [] }; idx.set(e.batch, b); out.push(b); }
    b.events.push(e);
  }
  return out;
}

function EventLine({ e, onItem }: { e: FlatEvent; onItem: (id: string, kind: LogKind) => void }) {
  const [open, setOpen] = useState(false);
  const more = e.op === 'removed' || e.op === 'added' || e.op === 'detail' || e.op === 'step-edited' || e.op === 'title';
  return (
    <li className={`axp-build-manager__ev is-${OP_TONE[e.op] ?? 'plain'}`}>
      <span className="axp-build-manager__ev-icon" aria-hidden><Icon name={OP_ICON[e.op] ?? 'more'} size={12} /></span>
      <span className="axp-build-manager__ev-main">
        <span className="axp-build-manager__ev-line">
          <span className="axp-build-manager__badge is-muted">{KIND_LABEL[e.kind]}</span>
          <span className="axp-build-manager__badge">{OP_LABEL[e.op] ?? e.op}</span>
          {e.op === 'moved' && <span className="axp-build-manager__move" title={`Moved from position ${String(e.from)} to ${String(e.to)}`}>#{String(e.from)} <Icon name={Number(e.to) < Number(e.from) ? 'chevron-up' : 'chevron-down'} size={11} /> #{String(e.to)}</span>}
          {e.id ? <button type="button" className="axp-build-manager__ev-item" onClick={() => onItem(e.id, e.kind)} title="Everything that happened to this item">{describe(e)}</button> : <span>{describe(e)}</span>}
          {more && <button type="button" className="fx-iconbtn axp-build-manager__ev-more" aria-expanded={open} aria-label="Details" onClick={() => setOpen(!open)}><Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} /></button>}
        </span>
        {open && (
          <span className="axp-build-manager__ev-detail">
            {(e.op === 'removed' || e.op === 'added') && e.snapshot && Object.entries(e.snapshot).filter(([k, v]) => v && !['detail', 'order'].includes(k) && (!Array.isArray(v) || v.length)).map(([k, v]) => (
              <span key={k}><strong>{k === 'detailText' ? 'details' : k}</strong> {Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? (x as { text?: string }).text : String(x))).join(' · ') : String(v)}</span>
            ))}
            {(e.op === 'detail' || e.op === 'step-edited' || e.op === 'title') && <><span><strong>Before</strong> {val(e.from)}</span><span><strong>After</strong> {val(e.to)}</span></>}
          </span>
        )}
      </span>
    </li>
  );
}

function BatchCard({ b, onItem, onWhy, onChange }: { b: Batch; onItem: (id: string, kind: LogKind) => void; onWhy: (id: string, reason: string) => Promise<void>; onChange: (id: string) => void }) {
  const rt = useRuntime();
  const [showPrompt, setShowPrompt] = useState(false);
  const [editing, setEditing] = useState(false);
  const [why, setWhy] = useState(b.source === 'outside' ? '' : b.reason ?? '');
  const [saving, setSaving] = useState(false);
  const outside = b.source === 'outside';
  const save = async () => { if (!why.trim()) return; setSaving(true); try { await onWhy(b.id, why.trim()); setEditing(false); } catch (e) { rt.toast((e as Error).message, 'warning'); } setSaving(false); };
  return (
    <li className={`axp-build-manager__batch${outside ? ' is-outside' : ''}`}>
      <div className="axp-build-manager__batch-head">
        <span className="axp-build-manager__batch-time">{time(b.at)}</span>
        <span className={`axp-build-manager__badge${outside ? ' is-warn' : ''}`} title={outside ? 'Changed outside the console, CLI and MCP: an axHub direct write, a git sync or a hand edit' : `Through ${b.surface ?? 'a tool'}`}>
          <Icon name={outside ? 'alert' : b.surface === 'mcp' ? 'sliders' : b.surface === 'console' ? 'monitor' : /claude/.test(b.surface ?? '') ? 'sparkles' : 'terminal'} size={11} />{outside ? 'outside the tools' : b.surface ?? 'tool'}
        </span>
        {b.by && !outside && <span className="axp-build-manager__badge is-muted"><Icon name="user" size={11} />{b.by}</span>}
        {b.wop && !outside && <span className="axp-build-manager__badge is-muted" title="The operation that made the change">{b.wop}</span>}
        <span className="axp-build-manager__badge is-muted">{b.events.length} change{b.events.length === 1 ? '' : 's'}</span>
        {b.changeId && <button type="button" className="axp-build-manager__act" onClick={() => onChange(b.changeId!)} title="The build entry (Codebase changes) this was part of"><Icon name="list" size={11} />{b.changeId.slice(4, 12)}…</button>}
      </div>
      <div className="axp-build-manager__why">
        <Icon name="help" size={12} />
        {editing ? (
          <span className="axp-build-manager__why-edit">
            <input className="fx-input" value={why} maxLength={400} onChange={(e) => setWhy(e.target.value)} placeholder="Why was this changed?" aria-label="Why" onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false); }} autoFocus />
            <Button tone="primary" icon="check" disabled={saving || !why.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button>
          </span>
        ) : (
          <span className="axp-build-manager__why-text">
            {outside ? <em>Who and why unknown: changed outside the tools.</em> : b.reason ? <>{b.reason}</> : <em>No reason given.</em>}
            <button type="button" className="axp-build-manager__act" onClick={() => { setWhy(outside ? '' : b.reason ?? ''); setEditing(true); }}><Icon name="edit" size={11} />{b.reason && !outside ? 'Edit why' : 'Add why'}</button>
          </span>
        )}
      </div>
      {b.prompt && (
        <div className="axp-build-manager__prompt">
          <button type="button" className="axp-build-manager__act" aria-expanded={showPrompt} onClick={() => setShowPrompt(!showPrompt)}><Icon name="type" size={11} />{showPrompt ? 'Hide the prompt' : 'The prompt that caused it'}</button>
          {showPrompt && <blockquote>{b.prompt}</blockquote>}
        </div>
      )}
      <ul className="axp-build-manager__evs">{b.events.map((e) => <EventLine key={e.key} e={e} onItem={onItem} />)}</ul>
    </li>
  );
}

function ItemHistory({ item, kind, onClose }: { item: string; kind: LogKind; onClose: () => void }) {
  const [v, setV] = useState<LogView | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setV(null); api.call<LogView>(`queue-log?days=3650&limit=1&item=${encodeURIComponent(item)}&kind=${kind}`).then(setV).catch((e: Error) => setErr(e.message)); }, [item, kind]);
  const hist = v?.item ?? [];
  const title = hist.at(-1)?.title || item;
  return (
    <section className="axp-build-manager__history" aria-label={`History of ${title}`}>
      <div className="axp-build-manager__tracker-head">
        <Icon name="clock" size={14} /><strong>{title}</strong>
        <span className="axp-build-manager__badge is-muted">{KIND_LABEL[kind]}</span>
        <button type="button" className="fx-iconbtn" aria-label="Close the history" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      {err && <p className="fx-small axp-build-manager__error">{err}</p>}
      {!v && !err ? <p className="fx-small fx-muted">Loading…</p> : !hist.length ? <p className="fx-small fx-muted">Nothing logged for this item yet.</p> : (
        <ol className="axp-build-manager__hist">
          {hist.map((e) => (
            <li key={e.key}>
              <span className="axp-build-manager__hist-when">{dayLabel(e.at)} {time(e.at)}</span>
              <span className="axp-build-manager__hist-what"><Icon name={OP_ICON[e.op] ?? 'more'} size={11} /> {describe(e)}</span>
              <span className="fx-small fx-muted">{e.source === 'outside' ? 'outside the tools' : `${e.by ?? '?'} · ${e.surface ?? ''}`}{e.reason && e.source !== 'outside' ? ` · why: ${e.reason}` : ''}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ActivityView({ query, onCount }: { query: string; onCount?: (n: number) => void }) {
  const rt = useRuntime();
  const [days, setDays] = useState<number>(30);
  const [kinds, setKinds] = useState<LogKind[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [source, setSource] = useState('');
  const [who, setWho] = useState('');
  const [limit, setLimit] = useState(300);
  const [v, setV] = useState<LogView | null>(null);
  const [err, setErr] = useState('');
  const [item, setItem] = useState<{ id: string; kind: LogKind } | null>(null);
  const seq = useRef(0);
  const load = () => {
    const n = ++seq.current;
    const p = new URLSearchParams({ days: String(days), limit: String(limit) });
    if (kinds.length) p.set('kinds', kinds.join(','));
    if (groups.length) p.set('groups', groups.join(','));
    if (source) p.set('source', source);
    if (who.trim()) p.set('who', who.trim().slice(0, 100));
    if (query.trim()) p.set('q', query.trim().slice(0, 200));
    api.call<LogView>(`queue-log?${p}`).then((r) => { if (n === seq.current) { setV(r); setErr(''); onCount?.(r.totals.total); } }).catch((e: Error) => { if (n === seq.current) setErr(e.message); });
  };
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [days, kinds.join(), groups.join(), source, who, query, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = <T,>(list: T[], x: T, set: (v: T[]) => void) => set(list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const bs = useMemo(() => batches(v?.events ?? []), [v]);
  const byDay = useMemo(() => { const m = new Map<string, Batch[]>(); for (const b of bs) { const d = dayLabel(b.at); m.set(d, [...(m.get(d) ?? []), b]); } return [...m.entries()]; }, [bs]);
  const s = v?.summary;
  const why = async (id: string, reason: string) => { await api.post('queue-log/why', { id, reason }); load(); };
  const openChange = (id: string) => (rt.actions.get('codebase-changes.open') ? rt.dispatch(`codebase-changes.open:${id}`) : rt.toast(`Change entry ${id}`, 'info'));
  return (
    <section className="axp-build-manager__activity" aria-label="Activity">
      <div className="axp-build-manager__totals" role="list" aria-label="Activity totals">
        <div role="listitem" className="axp-build-manager__total is-all"><span className="axp-build-manager__total-label">Changes</span><strong>{s?.total ?? '…'}</strong><span className="fx-small fx-muted">{s ? `${s.batches} writes` : ''}</span></div>
        <div role="listitem" className="axp-build-manager__total"><span className="axp-build-manager__total-label">Moves</span><strong>{s?.ops.moved ?? 0}</strong><span className="fx-small fx-muted">{(s?.ops.added ?? 0)} added · {(s?.ops.removed ?? 0)} removed</span></div>
        <div role="listitem" className="axp-build-manager__total"><span className="axp-build-manager__total-label">Steps</span><strong>{(s?.ops['step-done'] ?? 0)}</strong><span className="fx-small fx-muted">done · {(s?.ops['step-added'] ?? 0)} added</span></div>
        <div role="listitem" className="axp-build-manager__total"><span className="axp-build-manager__total-label">Outside the tools</span><strong>{s?.sources.outside ?? 0}</strong><span className="fx-small fx-muted">who/why unknown</span></div>
      </div>
      <div className="axp-build-manager__filters is-wrap" role="group" aria-label="Filter the activity">
        <span className="axp-build-manager__chips" role="group" aria-label="Lists">{KINDS.map((k) => <Chip key={k} on={kinds.includes(k)} onClick={() => toggle(kinds, k, setKinds)}>{KIND_LABEL[k]}{s?.kinds[k] ? ` ${s.kinds[k]}` : ''}</Chip>)}</span>
        <span className="axp-build-manager__chips" role="group" aria-label="Kinds of change">{Object.keys(OP_GROUPS).map((g) => <Chip key={g} on={groups.includes(g)} onClick={() => toggle(groups, g, setGroups)}>{GROUP_LABEL[g]}</Chip>)}</span>
        <label className="axp-build-manager__field"><span>When</span><select className="fx-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{DAYS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label>
        <label className="axp-build-manager__field"><span>Made</span><select className="fx-input" value={source} onChange={(e) => setSource(e.target.value)}><option value="">Anywhere</option><option value="tool">With the tools</option><option value="outside">Outside the tools</option></select></label>
        <label className="axp-build-manager__field"><span>Who / where</span><input className="fx-input" value={who} onChange={(e) => setWho(e.target.value)} placeholder="console, mcp, Claude Code…" list="axp-bm-who" /></label>
        <datalist id="axp-bm-who">{Object.keys(v?.totals.by ?? {}).map((w) => <option key={w} value={w} />)}</datalist>
      </div>
      {item && <ItemHistory item={item.id} kind={item.kind} onClose={() => setItem(null)} />}
      {err && <p className="fx-small axp-build-manager__error" role="alert">{err}</p>}
      {!v && !err ? <div className="fx-empty">Loading the activity…</div>
        : !bs.length ? <div className="fx-empty">{v?.totals.total ? 'Nothing matches these filters.' : 'No activity logged yet. Every change to the pending list, the build queue and the plan shows here from now on.'}</div>
          : byDay.map(([day, list]) => (
            <div key={day} className="axp-build-manager__day">
              <h3 className="axp-build-manager__day-head">{day}</h3>
              <ul className="axp-build-manager__batches">{list.map((b) => <BatchCard key={b.id} b={b} onItem={(id, kind) => setItem({ id, kind })} onWhy={why} onChange={openChange} />)}</ul>
            </div>
          ))}
      {v && v.more > 0 && <Button icon="chevron-down" onClick={() => setLimit(limit + 300)}>Show {Math.min(300, v.more)} more ({v.more} left)</Button>}
    </section>
  );
}

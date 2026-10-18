import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, Container, Icon, useRuntime, useWindowManager } from '../axf/react';
import * as api from '../api';
import type { PlanFeature, PlanStatus, PortId } from '../api';
import { PreviewPane } from './Boilerplates';
import { ElementPreview } from './Explorer';
import { useStore } from '../store';

/* ------------------------------------------------------------------ */
/* plan store: one shared copy for the view, floating windows, dialogs */
/* ------------------------------------------------------------------ */

const EDITS_KEY = 'plan-edits';
type Listener = () => void;
interface PlanSnapshot { features: PlanFeature[]; loaded: boolean; error: string }
interface PlanStore extends PlanSnapshot { listeners: Set<Listener>; snapshot: PlanSnapshot; emit(): void; set(p: Partial<PlanSnapshot>): void }
const store: PlanStore = {
  features: [], loaded: false, error: '', listeners: new Set<Listener>(),
  emit() { this.listeners.forEach((l) => l()); },
  snapshot: { features: [], loaded: false, error: '' },
  set(p) { Object.assign(this, p); this.snapshot = { features: this.features, loaded: this.loaded, error: this.error }; this.emit(); },
};
const localEdits = (): Record<string, PlanFeature | null> => api.readLocal(EDITS_KEY, {});

export async function loadPlanStore(force = false) {
  if (store.loaded && !force) return;
  try {
    const plan = await api.loadPlan();
    const edits = localEdits();
    const merged = plan.features.filter((f) => edits[f.id] !== null).map((f) => edits[f.id] ?? f);
    for (const [id, f] of Object.entries(edits)) if (f && !plan.features.some((x) => x.id === id)) merged.push(f);
    store.set({ features: merged, loaded: true, error: '' });
  } catch (e) { store.set({ loaded: true, error: String(e) }); }
}

/** Save to the repo through the API, or keep it in this browser (exportable) when the API is offline. */
async function saveFeature(f: PlanFeature, note: string, log: (t: string, l?: 'ok' | 'warn' | 'error') => void) {
  const stamped: PlanFeature = { ...f, edited: true, history: [...f.history, { at: new Date().toISOString(), text: note }].slice(-100) };
  store.set({ features: store.features.some((x) => x.id === f.id) ? store.features.map((x) => (x.id === f.id ? stamped : x)) : [...store.features, stamped] });
  if (api.isBackendUp()) {
    const r = await api.savePlanFeature(f, note);
    if (r.ok) log(`${f.id}: ${note}`, 'ok'); else log(`${f.id}: ${r.error}`, 'error');
  } else {
    api.writeLocal(EDITS_KEY, { ...localEdits(), [f.id]: stamped });
    log(`${f.id}: ${note} (saved in this browser — export the plan or connect the API to keep it in the repo)`, 'warn');
  }
}
/** Status changes from the build queue when the API is offline: applied to this browser's copy of the plan. */
export function applyLocalStatuses(changes: { id: string; status: string; note: string }[]) {
  if (!changes.length) return;
  const at = new Date().toISOString();
  const edits = localEdits();
  const features = store.features.map((f) => {
    const c = changes.find((x) => x.id === f.id);
    if (!c || f.status === c.status) return f;
    const n: PlanFeature = { ...f, status: c.status as PlanStatus, edited: true, history: [...f.history, { at, text: c.note }].slice(-100) };
    edits[f.id] = n;
    return n;
  });
  api.writeLocal(EDITS_KEY, edits);
  store.set({ features });
}
export const planFeatures = () => store.features;

async function removeFeature(id: string, log: (t: string, l?: 'ok' | 'warn' | 'error') => void) {
  store.set({ features: store.features.filter((x) => x.id !== id) });
  if (api.isBackendUp()) { const r = await api.deletePlanFeature(id); log(r.ok ? `${id} deleted` : `${id}: ${r.error}`, r.ok ? 'ok' : 'error'); }
  else { api.writeLocal(EDITS_KEY, { ...localEdits(), [id]: null }); log(`${id} deleted in this browser`, 'warn'); }
}
export function usePlan() {
  const s = useSyncExternalStore((l) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; }, () => store.snapshot, () => store.snapshot);
  useEffect(() => { loadPlanStore(); }, []);
  return s;
}
function usePlanLog() { const rt = useRuntime(); return (t: string, l: 'ok' | 'warn' | 'error' | 'info' = 'info') => rt.terminal.log('plan', t, l); }

/* ------------------------------------------------------------------ */
/* analysis: blockers, dependents, automatic warnings                   */
/* ------------------------------------------------------------------ */

const DONE: PlanStatus[] = ['built'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const EFFORTS = ['S', 'M', 'L', 'XL'];

interface Analysis { byId: Map<string, PlanFeature>; dependents: Map<string, string[]>; auto: Map<string, { level: 'info' | 'warn' | 'error'; text: string }[]>; blocked: Set<string>; children: Map<string, string[]> }
function analyse(features: PlanFeature[]): Analysis {
  const byId = new Map(features.map((f) => [f.id, f]));
  const dependents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const f of features) {
    for (const d of f.dependsOn) dependents.set(d, [...(dependents.get(d) ?? []), f.id]);
    const parent = f.epic ?? (f.kind === 'task' ? f.parent : undefined);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), f.id]);
  }
  const auto = new Map<string, { level: 'info' | 'warn' | 'error'; text: string }[]>();
  const blocked = new Set<string>();
  for (const f of features) {
    const w: { level: 'info' | 'warn' | 'error'; text: string }[] = [];
    for (const d of f.dependsOn) {
      const dep = byId.get(d);
      if (!dep) w.push({ level: 'error', text: `Depends on "${d}", which is not in the plan` });
      else if (!DONE.includes(dep.status) && f.status !== 'dropped') { w.push({ level: f.status === 'built' ? 'warn' : 'info', text: `Waits on ${dep.title} (${dep.status})` }); if (f.status !== 'built') blocked.add(f.id); }
    }
    const ports = Object.entries(f.ports ?? {});
    if (ports.some(([, p]) => p?.status === 'built') && ports.some(([, p]) => p?.status === 'planned' || p?.status === 'placeholder'))
      w.push({ level: 'info', text: `Port gap: ${ports.filter(([, p]) => p?.status !== 'built').map(([k, p]) => `${k} ${p?.status}`).join(', ')}` });
    if (f.status === 'built' && f.acceptance.some((a) => !a.done)) w.push({ level: 'warn', text: `Marked built with ${f.acceptance.filter((a) => !a.done).length} open acceptance item(s)` });
    if ((f.priority === 'P0' || f.priority === 'P1') && f.wave === 1 && f.status === 'planned') w.push({ level: 'warn', text: `${f.priority}, wave 1, not started` });
    if (f.status === 'placeholder' && f.priority === 'P0') w.push({ level: 'warn', text: 'P0 feature is still a placeholder' });
    auto.set(f.id, w);
  }
  return { byId, dependents, auto, blocked, children };
}
const warnCount = (f: PlanFeature, a: Analysis) => f.warnings.length + (a.auto.get(f.id)?.filter((w) => w.level !== 'info').length ?? 0);
const progressOf = (ids: string[], a: Analysis) => { const fs = ids.map((i) => a.byId.get(i)).filter((x): x is PlanFeature => !!x); return fs.length ? Math.round((fs.filter((f) => f.status === 'built').length / fs.length) * 100) : null; };

/* ------------------------------------------------------------------ */
/* the view                                                             */
/* ------------------------------------------------------------------ */

type ViewMode = 'list' | 'board' | 'epics';
interface Filters { q: string; area: string; statuses: Set<PlanStatus>; port: '' | PortId; portStatus: string; priority: string; wave: string; kind: string; warnings: boolean; blocked: boolean }
const EMPTY: Filters = { q: '', area: '', statuses: new Set(), port: '', portStatus: '', priority: '', wave: '', kind: 'epic', warnings: false, blocked: false };

export function Plan() {
  const { features, loaded, error } = usePlan();
  const rt = useRuntime();
  const log = usePlanLog();
  const a = useMemo(() => analyse(features), [features]);
  const [mode, setMode] = useState<ViewMode>(() => api.readLocal('plan-mode', 'epics'));
  const [f, setF] = useState<Filters>(EMPTY);
  const [sel, setSel] = useState<string | null>(() => api.readLocal('plan-sel', 'x.console.plan'));
  useEffect(() => api.writeLocal('plan-mode', mode), [mode]);
  useEffect(() => api.writeLocal('plan-sel', sel), [sel]);
  const areas = useMemo(() => [...new Set(features.map((x) => x.area))], [features]);
  const visible = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    // While searching, every feature is searched (titles, ids, summaries, tags, capabilities), whatever kind filter is set.
    const searching = q.length > 0;
    return features.filter((x) =>
      (!q || x.title.toLowerCase().includes(q) || x.id.toLowerCase().includes(q) || x.summary.toLowerCase().includes(q) || x.tags.some((t) => t.includes(q)) || x.capabilities.some((c) => c.toLowerCase().includes(q))) &&
      (!f.area || x.area === f.area) && (!f.statuses.size || f.statuses.has(x.status)) &&
      (!f.port || (x.ports[f.port] && (!f.portStatus || x.ports[f.port]!.status === f.portStatus))) &&
      (!f.priority || x.priority === f.priority) && (!f.wave || String(x.wave) === f.wave) && (!f.kind || searching || x.kind === f.kind) &&
      (!f.warnings || warnCount(x, a) > 0) && (!f.blocked || a.blocked.has(x.id)));
  }, [features, f, a]);
  const counts = useMemo(() => Object.fromEntries(api.PLAN_STATUSES.map((s) => [s, features.filter((x) => x.status === s).length])), [features]);
  const total = Math.max(1, features.length);
  const current = sel ? a.byId.get(sel) ?? null : null;
  const exportPlan = () => {
    const json = JSON.stringify({ $axf: 'plan@1', generatedAt: new Date().toISOString(), features }, null, 1);
    navigator.clipboard?.writeText(json).then(() => rt.toast(`plan.json copied (${features.length} features).`, 'success'), () => rt.toast('Clipboard not available.', 'warning'));
  };
  const toggleStatus = (s: PlanStatus) => setF((p) => { const n = new Set(p.statuses); if (n.has(s)) n.delete(s); else n.add(s); return { ...p, statuses: n }; });

  return (
    <div className="pl">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">{features.length} features · {features.filter((x) => x.kind === 'epic').length} epics · {a.blocked.size} waiting on dependencies · {features.filter((x) => warnCount(x, a) > 0).length} with warnings · {api.isBackendUp() ? 'saving to the repo' : 'saving in this browser'}</p>
          <h1>Plan</h1>
          <p className="fx-muted">Every feature of the framework: what it does, which ports have it, what it depends on, how it's verified, screenshots, live previews, warnings and recommendations. Edits save to <code>framework/plan/plan.json</code> through the API.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="plus" onClick={() => rt.openDialog('plan-add')}>Add feature</Button>
          <Button icon="copy" onClick={exportPlan}>Export</Button>
          <Button icon="refresh" onClick={() => loadPlanStore(true).then(() => log('plan reloaded'))}>Reload</Button>
        </div>
      </header>

      <div className="pl-bar" role="img" aria-label="Features by status">
        {api.PLAN_STATUSES.map((s) => counts[s] ? <button key={s} className={`pl-bar__seg is-${s} ${f.statuses.has(s) ? 'is-on' : ''}`} style={{ flexGrow: counts[s] }} title={`${s}: ${counts[s]} (${Math.round((counts[s]! / total) * 100)}%)`} onClick={() => toggleStatus(s)}><span>{s} {counts[s]}</span></button> : null)}
      </div>

      <div className="pl-tools">
        <div className="fx-search" style={{ flex: '1 1 220px', minWidth: 0 }}><Icon name="search" /><input id="plan-q" placeholder="Search features, capabilities, tags…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <select id="plan-kind" className="fx-input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">All kinds</option><option value="epic">Epics</option><option value="feature">Features</option><option value="task">Tasks</option></select>
        <select id="plan-area" className="fx-input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}><option value="">All areas</option>{areas.map((x) => <option key={x}>{x}</option>)}</select>
        <select id="plan-port" className="fx-input" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value as '' | PortId })}><option value="">Any port</option>{api.PORTS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        {f.port && <select id="plan-portstatus" className="fx-input" value={f.portStatus} onChange={(e) => setF({ ...f, portStatus: e.target.value })}><option value="">any status</option>{api.PLAN_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>}
        <select id="plan-prio" className="fx-input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
        <select id="plan-wave" className="fx-input" value={f.wave} onChange={(e) => setF({ ...f, wave: e.target.value })}><option value="">Any wave</option>{[1, 2, 3].map((w) => <option key={w} value={w}>Wave {w}</option>)}</select>
        <button className={`fx-chip ${f.warnings ? 'is-selected' : ''}`} onClick={() => setF({ ...f, warnings: !f.warnings })}><Icon name="alert" /> Warnings</button>
        <button className={`fx-chip ${f.blocked ? 'is-selected' : ''}`} onClick={() => setF({ ...f, blocked: !f.blocked })}><Icon name="lock" /> Waiting</button>
        {(f !== EMPTY) && <button className="fx-chip" onClick={() => setF(EMPTY)}>Reset</button>}
        <span className="fx-grow" />
        {(['epics', 'list', 'board'] as ViewMode[]).map((m) => <button key={m} className={`fx-chip ${mode === m ? 'is-selected' : ''}`} onClick={() => setMode(m)}>{m === 'epics' ? 'Epics' : m === 'list' ? 'List' : 'Board'}</button>)}
      </div>

      {!loaded ? <div className="fx-empty">Loading the plan…</div> : error ? <div className="fx-empty">Couldn't load the plan: {error}. Run <code>node framework/cli/plan.mjs</code>, then <code>npm run sync</code>.</div> : (
        <div className="pl-main">
          <div className="pl-results">
            <p className="fx-muted fx-small" style={{ margin: '0 0 calc(var(--fx-space) * 0.75)' }}>{visible.length} shown{f.q.trim() ? ` matching “${f.q.trim()}” in every feature` : ''}</p>
            {visible.length === 0 ? <div className="fx-empty">No feature matches these filters.</div>
              : mode === 'board' ? <Board features={visible} a={a} sel={sel} onSel={setSel} />
              : mode === 'epics' && !f.q.trim() ? <EpicList features={visible} a={a} sel={sel} onSel={setSel} />
              : <GroupedList features={visible} a={a} sel={sel} onSel={setSel} />}
          </div>
          <aside className="pl-detail">{current ? <FeatureDetail key={current.id} feature={current} a={a} onSelect={setSel} /> : <div className="fx-empty">Select a feature to see and edit its details.</div>}</aside>
        </div>)}
    </div>
  );
}

function Row({ x, a, sel, onSel }: { x: PlanFeature; a: Analysis; sel: string | null; onSel: (id: string) => void }) {
  const w = warnCount(x, a);
  return (
    <button className={`pl-row ${sel === x.id ? 'is-selected' : ''}`} onClick={() => onSel(x.id)}>
      <span className={`pl-dot is-${x.status}`} title={x.status} />
      <span className="pl-row__main"><span className="pl-row__title">{x.title}</span><span className="fx-muted fx-small fx-mono">{x.id}{x.kind !== 'feature' ? ` · ${x.kind}` : ''}</span></span>
      <span className="pl-ports">{api.PORTS.map((p) => <span key={p} className={`pl-port is-${x.ports[p]?.status ?? 'none'}`} title={`${p}: ${x.ports[p]?.status ?? 'not applicable'}`}>{p[0]!.toUpperCase()}</span>)}</span>
      <ModelChip model={x.model} reason={x.modelReason} />
      <span className="pl-prio">{x.priority}</span>
      {a.blocked.has(x.id) && <span title="Waits on a dependency"><Icon name="lock" size={14} /></span>}
      {w > 0 && <span className="pl-warn" title={`${w} warning(s)`}><Icon name="alert" size={14} />{w}</span>}
    </button>
  );
}

/** Suggested build model (top three only). */
export function ModelChip({ model, reason, long }: { model?: string; reason?: string; long?: boolean }) {
  const m = model ?? 'opus';
  return <span className={`bm-model is-${m}`} title={`Build with ${api.modelLabel(m)}${reason ? ` — ${reason}` : ''}`}>{long ? api.modelLabel(m) : api.modelLabel(m).split(' ')[0]}</span>;
}

function GroupedList({ features, a, sel, onSel }: { features: PlanFeature[]; a: Analysis; sel: string | null; onSel: (id: string) => void }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => { const m = new Map<string, PlanFeature[]>(); for (const x of features) { const k = x.group ? `${x.area} › ${x.group}` : x.area; m.set(k, [...(m.get(k) ?? []), x]); } return [...m.entries()]; }, [features]);
  return <div className="pl-groups">{groups.map(([g, xs]) => (
    <section key={g} className="pl-group">
      <button className="pl-group__head" onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; })}>
        <Icon name={closed.has(g) ? 'chevron-right' : 'chevron-down'} /> <span className="fx-grow" style={{ textAlign: 'left' }}>{g}</span>
        <span className="fx-badge">{xs.filter((x) => x.status === 'built').length}/{xs.length} built</span>
      </button>
      {!closed.has(g) && xs.map((x) => <Row key={x.id} x={x} a={a} sel={sel} onSel={onSel} />)}
    </section>))}</div>;
}

function EpicList({ features, a, sel, onSel }: { features: PlanFeature[]; a: Analysis; sel: string | null; onSel: (id: string) => void }) {
  const byArea = useMemo(() => { const m = new Map<string, PlanFeature[]>(); for (const x of features) m.set(x.area, [...(m.get(x.area) ?? []), x]); return [...m.entries()]; }, [features]);
  return <div className="pl-groups">{byArea.map(([area, xs]) => (
    <section key={area} className="pl-group">
      <div className="pl-group__head is-static"><span className="fx-grow">{area}</span><span className="fx-badge">{xs.filter((x) => x.status === 'built').length}/{xs.length} built</span></div>
      {xs.map((x) => { const kids = a.children.get(x.id) ?? []; const pr = progressOf(kids, a); return (
        <div key={x.id}>
          <Row x={x} a={a} sel={sel} onSel={onSel} />
          {kids.length > 0 && <div className="pl-kids"><div className="pl-meter"><span style={{ width: `${pr ?? 0}%` }} /></div><span className="fx-muted fx-small">{kids.length} linked catalog feature(s) · {pr}% built</span></div>}
        </div>); })}
    </section>))}</div>;
}

function Board({ features, a, sel, onSel }: { features: PlanFeature[]; a: Analysis; sel: string | null; onSel: (id: string) => void }) {
  const log = usePlanLog();
  const [drag, setDrag] = useState<string | null>(null);
  const cols = api.PLAN_STATUSES.filter((s) => s !== 'dropped' || features.some((x) => x.status === 'dropped'));
  return (
    <div className="pl-board">{cols.map((s) => { const xs = features.filter((x) => x.status === s); return (
      <div key={s} className={`pl-col ${drag ? 'is-target' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={() => { const x = drag ? a.byId.get(drag) : null; setDrag(null); if (x && x.status !== s) saveFeature({ ...x, status: s }, `Status ${x.status} → ${s}`, (t, l) => log(t, l)); }}>
        <div className="pl-col__head"><span className={`pl-dot is-${s}`} /> {s} <span className="fx-badge">{xs.length}</span></div>
        {xs.slice(0, 200).map((x) => (
          <div key={x.id} className={`pl-card ${sel === x.id ? 'is-selected' : ''}`} draggable onDragStart={() => setDrag(x.id)} onClick={() => onSel(x.id)}>
            <div className="pl-row__title">{x.title}</div>
            <div className="fx-row fx-row--wrap" style={{ gap: 'calc(var(--fx-space) * 0.5)' }}><ModelChip model={x.model} reason={x.modelReason} /><span className="pl-prio">{x.priority}</span><span className="fx-muted fx-small">{x.area}</span>{warnCount(x, a) > 0 && <span className="pl-warn"><Icon name="alert" size={12} />{warnCount(x, a)}</span>}</div>
          </div>))}
        {xs.length > 200 && <p className="fx-muted fx-small">+{xs.length - 200} more — filter to narrow</p>}
      </div>); })}</div>
  );
}

/* ------------------------------------------------------------------ */
/* feature detail (also rendered in floating windows)                   */
/* ------------------------------------------------------------------ */

function Section({ title, icon, count, children, actions }: { title: string; icon: string; count?: number; children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="pl-sec">
      <div className="pl-sec__head"><button className="pl-sec__toggle" onClick={() => setOpen(!open)}><Icon name={open ? 'chevron-down' : 'chevron-right'} /> <Icon name={icon} /> {title}{count != null && <span className="fx-badge">{count}</span>}</button><span className="fx-grow" />{open && actions}</div>
      {open && <div className="pl-sec__body">{children}</div>}
    </section>
  );
}

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="pl-list">
      {items.map((t, i) => <div key={i} className="pl-list__item"><span className="fx-grow">{t}</span><button className="fx-iconbtn" aria-label="Remove" onClick={() => onChange(items.filter((_, k) => k !== i))}><Icon name="x" size={14} /></button></div>)}
      <form className="pl-list__add" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onChange([...items, draft.trim()]); setDraft(''); } }}><input className="fx-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} /><button className="fx-iconbtn" type="submit" aria-label="Add"><Icon name="plus" size={14} /></button></form>
    </div>
  );
}

export function FeatureDetail({ feature, a, onSelect }: { feature: PlanFeature; a?: Analysis; onSelect?: (id: string) => void }) {
  const rt = useRuntime();
  const wm = useWindowManager();
  const log = usePlanLog();
  const s = useStore();
  const all = usePlan().features;
  const an = a ?? analyse(all);
  const [d, setD] = useState<PlanFeature>(feature);
  const [dirty, setDirty] = useState(false);
  const [depQ, setDepQ] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  useEffect(() => { setD(feature); setDirty(false); }, [feature]);
  const patch = (p: Partial<PlanFeature>) => { setD((x) => ({ ...x, ...p })); setDirty(true); };
  const save = (note = 'Edited in the console') => { saveFeature(d, note, (t, l) => log(t, l)); setDirty(false); };
  const go = (id: string) => (onSelect ? onSelect(id) : rt.navigate('plan'));
  const auto = an.auto.get(d.id) ?? [];
  const dependents = an.dependents.get(d.id) ?? [];
  const kids = an.children.get(d.id) ?? [];
  const depMatches = depQ.trim() ? all.filter((x) => x.id !== d.id && !d.dependsOn.includes(x.id) && (x.title.toLowerCase().includes(depQ.toLowerCase()) || x.id.includes(depQ))).slice(0, 8) : [];
  const addShot = async (file: File) => {
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
    let src = dataUrl;
    if (api.isBackendUp()) { const r = await api.uploadPlanMedia(d.id, dataUrl); if (r.ok && typeof r.src === 'string') src = r.src; else { log(`upload failed: ${r.error}`, 'error'); return; } }
    else if (dataUrl.length > 1_500_000) { rt.toast('That image is too big to keep in the browser — connect the API to upload it.', 'warning'); return; }
    patch({ screenshots: [...d.screenshots, { src, caption: file.name.replace(/\.[^.]+$/, '') }] });
  };
  return (
    <div className="pl-d">
      <div className="pl-d__head">
        <input className="pl-d__title" value={d.title} onChange={(e) => patch({ title: e.target.value })} aria-label="Title" />
        <div className="fx-row fx-row--wrap" style={{ gap: 'calc(var(--fx-space) * 0.75)' }}>
          <span className="fx-mono fx-small fx-muted">{d.id}</span><Chip>{d.kind}</Chip><Chip>{d.source}</Chip>
          {d.epic && <button className="fx-chip" onClick={() => go(d.epic!)}>epic: {an.byId.get(d.epic)?.title ?? d.epic}</button>}
          {d.parent && <button className="fx-chip" onClick={() => go(d.parent!)}>parent: {an.byId.get(d.parent)?.title ?? d.parent}</button>}
        </div>
        <div className="pl-fields">
          <label>Status<select className="fx-input" value={d.status} onChange={(e) => patch({ status: e.target.value as PlanStatus })}>{api.PLAN_STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Priority<select className="fx-input" value={d.priority} onChange={(e) => patch({ priority: e.target.value })}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Wave<select className="fx-input" value={d.wave} onChange={(e) => patch({ wave: Number(e.target.value) })}>{[1, 2, 3].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label>Effort<select className="fx-input" value={d.effort} onChange={(e) => patch({ effort: e.target.value })}><option value="">—</option>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Area<input className="fx-input" value={d.area} onChange={(e) => patch({ area: e.target.value })} /></label>
          <label title={api.MODELS.map((m) => `${m.label}: ${m.when}`).join('\n')}>Build with<select className="fx-input" value={d.model ?? 'opus'} onChange={(e) => patch({ model: e.target.value as api.ModelId, modelReason: 'Picked in the console', modelEdited: true })}>{api.MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        </div>
        {d.modelReason && <p className="fx-small fx-muted" style={{ margin: 0 }}><ModelChip model={d.model} long /> {d.modelReason}</p>}
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="save" disabled={!dirty} onClick={() => save()}>{dirty ? 'Save' : 'Saved'}</Button>
          {dirty && <Button icon="undo" onClick={() => { setD(feature); setDirty(false); }}>Discard</Button>}
          <Button icon="external" onClick={() => wm.openFloating([{ id: `plan-${d.id}-${Date.now().toString(36)}`, title: d.title, kind: 'plan-feature', payload: d.id, icon: 'layers' }], d.title, 'floating', 460, 620)}>Open in window</Button>
          {d.source === 'user' && <Button tone="danger" icon="trash" onClick={() => removeFeature(d.id, (t, l) => log(t, l))}>Delete</Button>}
        </div>
      </div>

      <Section title="Summary" icon="file"><textarea className="fx-input" rows={4} value={d.summary} onChange={(e) => patch({ summary: e.target.value })} placeholder="What this feature does and why it matters" /></Section>

      <Section title="Warnings" icon="alert" count={d.warnings.length + auto.length}>
        {auto.map((w, i) => <div key={`a${i}`} className={`pl-note is-${w.level}`}><Icon name={w.level === 'info' ? 'info' : 'alert'} size={14} /><span className="fx-grow">{w.text}</span><span className="fx-muted fx-small">auto</span></div>)}
        {d.warnings.map((w, i) => <div key={i} className={`pl-note is-${w.level}`}><Icon name={w.level === 'info' ? 'info' : 'alert'} size={14} /><span className="fx-grow">{w.text}</span>
          <select className="fx-input pl-mini" value={w.level} onChange={(e) => patch({ warnings: d.warnings.map((x, k) => (k === i ? { ...x, level: e.target.value as 'info' | 'warn' | 'error' } : x)) })}><option>info</option><option>warn</option><option>error</option></select>
          <button className="fx-iconbtn" aria-label="Remove warning" onClick={() => patch({ warnings: d.warnings.filter((_, k) => k !== i) })}><Icon name="x" size={14} /></button></div>)}
        <ListEditor items={[]} onChange={(v) => patch({ warnings: [...d.warnings, ...v.map((text) => ({ level: 'warn' as const, text }))] })} placeholder="Add a warning…" />
      </Section>

      <Section title="Recommendations" icon="sparkles" count={d.recommendations.length}><ListEditor items={d.recommendations} onChange={(v) => patch({ recommendations: v })} placeholder="Add a recommendation…" /></Section>

      <Section title="Capabilities" icon="zap" count={d.capabilities.length}><ListEditor items={d.capabilities} onChange={(v) => patch({ capabilities: v })} placeholder="What it can do…" /></Section>

      <Section title="Ports" icon="layers">
        <table className="fx-table pl-ports-table"><tbody>{api.PORTS.map((p) => { const v = d.ports[p]; return (
          <tr key={p}><th>{p}</th>
            <td><select className="fx-input pl-mini" value={v?.status ?? ''} onChange={(e) => { const ports = { ...d.ports }; if (!e.target.value) delete ports[p]; else ports[p] = { status: e.target.value, where: v?.where ?? '' }; patch({ ports }); }}><option value="">n/a</option>{api.PLAN_STATUSES.map((x) => <option key={x}>{x}</option>)}</select></td>
            <td><input className="fx-input fx-mono" value={v?.where ?? ''} disabled={!v} placeholder="module / path" onChange={(e) => patch({ ports: { ...d.ports, [p]: { status: v?.status ?? 'planned', where: e.target.value } } })} /></td></tr>); })}</tbody></table>
      </Section>

      <Section title="Dependencies" icon="branch" count={d.dependsOn.length + dependents.length}>
        <p className="fx-eyebrow">Needs</p>
        {d.dependsOn.length === 0 && <p className="fx-muted fx-small">Nothing.</p>}
        {d.dependsOn.map((id) => { const x = an.byId.get(id); return <div key={id} className="pl-dep"><span className={`pl-dot is-${x?.status ?? 'missing'}`} /><button className="pl-link" onClick={() => go(id)}>{x?.title ?? id}</button><span className="fx-muted fx-small">{x?.status ?? 'not in plan'}</span><button className="fx-iconbtn" aria-label="Remove dependency" onClick={() => patch({ dependsOn: d.dependsOn.filter((y) => y !== id) })}><Icon name="x" size={14} /></button></div>; })}
        <input className="fx-input" placeholder="Add a dependency — search the plan…" value={depQ} onChange={(e) => setDepQ(e.target.value)} />
        {depMatches.map((x) => <button key={x.id} className="pl-dep pl-dep--add" onClick={() => { patch({ dependsOn: [...d.dependsOn, x.id] }); setDepQ(''); }}><Icon name="plus" size={14} /> {x.title} <span className="fx-muted fx-small fx-mono">{x.id}</span></button>)}
        <p className="fx-eyebrow" style={{ marginTop: 'calc(var(--fx-space) * 1.25)' }}>Needed by</p>
        {dependents.length === 0 ? <p className="fx-muted fx-small">Nothing depends on this yet.</p> : dependents.map((id) => { const x = an.byId.get(id); return <div key={id} className="pl-dep"><span className={`pl-dot is-${x?.status}`} /><button className="pl-link" onClick={() => go(id)}>{x?.title ?? id}</button><span className="fx-muted fx-small">{x?.status}</span></div>; })}
        {kids.length > 0 && <><p className="fx-eyebrow" style={{ marginTop: 'calc(var(--fx-space) * 1.25)' }}>Linked catalog features ({progressOf(kids, an)}% built)</p>{kids.slice(0, 40).map((id) => { const x = an.byId.get(id); return <div key={id} className="pl-dep"><span className={`pl-dot is-${x?.status}`} /><button className="pl-link" onClick={() => go(id)}>{x?.title ?? id}</button><span className="fx-muted fx-small">{x?.status}</span></div>; })}</>}
      </Section>

      <Section title="Acceptance" icon="check-circle" count={d.acceptance.length}>
        {d.acceptance.map((c, i) => <label key={i} className="pl-check"><input type="checkbox" checked={c.done} onChange={(e) => patch({ acceptance: d.acceptance.map((x, k) => (k === i ? { ...x, done: e.target.checked } : x)) })} /><span className={`fx-grow ${c.done ? 'is-done' : ''}`}>{c.text}</span><button className="fx-iconbtn" aria-label="Remove" onClick={(e) => { e.preventDefault(); patch({ acceptance: d.acceptance.filter((_, k) => k !== i) }); }}><Icon name="x" size={14} /></button></label>)}
        <ListEditor items={[]} onChange={(v) => patch({ acceptance: [...d.acceptance, ...v.map((text) => ({ text, done: false }))] })} placeholder="Add a check that proves it's done…" />
      </Section>

      <Section title="Screenshots" icon="monitor" count={d.screenshots.length} actions={<label className="fx-btn fx-btn--neutral pl-upload"><Icon name="upload" size={14} /> Add<input type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) addShot(file); e.target.value = ''; }} /></label>}>
        {d.screenshots.length === 0 ? <p className="fx-muted fx-small">No screenshots yet. Add one, or paste an image here.</p> : (
          <div className="pl-shots">{d.screenshots.map((sh, i) => (
            <figure key={i} className="pl-shot">
              <button className="pl-shot__img" onClick={() => setShot(api.planMediaUrl(sh.src))} aria-label={`Open ${sh.caption}`}><img src={api.planMediaUrl(sh.src)} alt={sh.caption} loading="lazy" /></button>
              <figcaption><input className="fx-input pl-mini" value={sh.caption} onChange={(e) => patch({ screenshots: d.screenshots.map((x, k) => (k === i ? { ...x, caption: e.target.value } : x)) })} /><button className="fx-iconbtn" aria-label="Remove screenshot" onClick={() => patch({ screenshots: d.screenshots.filter((_, k) => k !== i) })}><Icon name="x" size={14} /></button></figcaption>
            </figure>))}</div>)}
        <div className="pl-paste" tabIndex={0} onPaste={(e) => { const file = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (file) { e.preventDefault(); addShot(file); } }}>Paste an image here</div>
        {shot && <div className="pl-lightbox" onClick={() => setShot(null)}><img src={shot} alt="" /></div>}
      </Section>

      <Section title="Previews" icon="eye" count={d.previews.length}>
        {d.previews.map((p, i) => (
          <div key={i} className="pl-preview">
            <div className="fx-row"><span className="fx-grow"><strong>{p.label || p.ref}</strong> <span className="fx-muted fx-small">{p.kind}: {p.ref}</span></span><button className="fx-iconbtn" aria-label="Remove preview" onClick={() => patch({ previews: d.previews.filter((_, k) => k !== i) })}><Icon name="x" size={14} /></button></div>
            {p.kind === 'element' ? <ElementPreview kind={p.ref} />
              : p.kind === 'boilerplate' ? (s.boilerplates.find((b) => b.id === p.ref) ? <PreviewPane b={s.boilerplates.find((b) => b.id === p.ref)!} /> : <p className="fx-muted">No boilerplate {p.ref}</p>)
              : p.kind === 'route' ? <Button icon="external" onClick={() => rt.navigate(p.ref)}>Open {p.ref} in the console</Button>
              : p.kind === 'image' ? <img src={api.planMediaUrl(p.ref)} alt={p.label} style={{ maxWidth: '100%', borderRadius: 'calc(var(--fx-radius-md) * 4 / 5)' }} />
              : <a className="fx-btn fx-btn--neutral" href={p.ref} target="_blank" rel="noopener">Open ↗</a>}
          </div>))}
        <AddPreview onAdd={(p) => patch({ previews: [...d.previews, p] })} />
      </Section>

      <Section title="Modules & files" icon="package" count={d.modules.length + d.files.length}>
        <p className="fx-eyebrow">Modules</p><ListEditor items={d.modules} onChange={(v) => patch({ modules: v })} placeholder="lib-… / axf-…" />
        <p className="fx-eyebrow">Files</p><ListEditor items={d.files} onChange={(v) => patch({ files: v })} placeholder="path in the repo" />
      </Section>

      <Section title="Links" icon="external" count={d.links.length}>
        {d.links.map((l, i) => <div key={i} className="pl-list__item"><a className="fx-grow" href={l.url} target="_blank" rel="noopener">{l.label}</a><button className="fx-iconbtn" aria-label="Remove link" onClick={() => patch({ links: d.links.filter((_, k) => k !== i) })}><Icon name="x" size={14} /></button></div>)}
        <ListEditor items={[]} onChange={(v) => patch({ links: [...d.links, ...v.map((t) => { const [label, url] = t.includes('|') ? t.split('|').map((x) => x.trim()) : [t, t]; return { label: label!, url: url! }; })] })} placeholder="Label | https://…" />
      </Section>

      <Section title="Notes & tags" icon="edit">
        <textarea className="fx-input" rows={3} value={d.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Notes" />
        <ListEditor items={d.tags} onChange={(v) => patch({ tags: v })} placeholder="Add a tag…" />
      </Section>

      <Section title="History" icon="clock" count={d.history.length}>
        <ol className="pl-history">{[...d.history].reverse().map((h, i) => <li key={i}><span className="fx-mono fx-small fx-muted">{h.at.slice(0, 16).replace('T', ' ')}</span> {h.text}</li>)}</ol>
      </Section>
    </div>
  );
}

function AddPreview({ onAdd }: { onAdd: (p: PlanFeature['previews'][number]) => void }) {
  const [kind, setKind] = useState<PlanFeature['previews'][number]['kind']>('element');
  const [ref, setRef] = useState('');
  const hint = { element: 'Component kind, e.g. BUTTON, SLIDER, CARD', boilerplate: 'Boilerplate id, e.g. notes', route: 'Console view, e.g. libraries', url: 'https://…', image: 'media/… or https://…' }[kind];
  return (
    <form className="pl-list__add" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) { onAdd({ kind, ref: kind === 'element' ? ref.trim().toUpperCase() : ref.trim(), label: '' }); setRef(''); } }}>
      <select className="fx-input pl-mini" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="element">element</option><option value="boilerplate">boilerplate</option><option value="route">route</option><option value="url">url</option><option value="image">image</option></select>
      <input className="fx-input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={hint} />
      <button className="fx-iconbtn" type="submit" aria-label="Add preview"><Icon name="plus" size={14} /></button>
    </form>
  );
}

/** Dialog `plan-add`. */
export function AddFeatureDialog({ close }: { close: () => void }) {
  const log = usePlanLog();
  const rt = useRuntime();
  const { features } = usePlan();
  const areas = [...new Set(features.map((x) => x.area))];
  const [title, setTitle] = useState('');
  const [area, setArea] = useState(areas[0] ?? 'Kernel & engines');
  const [kind, setKind] = useState<PlanFeature['kind']>('feature');
  const [priority, setPriority] = useState('P2');
  const [summary, setSummary] = useState('');
  const id = `u.${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
  const exists = features.some((x) => x.id === id);
  const add = () => {
    const f: PlanFeature = { id, title: title.trim(), area, kind, status: 'planned', priority, wave: 2, effort: '', summary, ports: {}, capabilities: [], dependsOn: [], catalog: [], modules: [], files: [], acceptance: [], warnings: [], recommendations: [], previews: [], screenshots: [], links: [], tags: [], notes: '', source: 'user', history: [] };
    saveFeature(f, 'Added to the plan', (t, l) => log(t, l));
    api.writeLocal('plan-sel', id); rt.navigate('plan'); close();
  };
  return (
    <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); if (title.trim() && !exists) add(); }}>
      <label className="fx-field">Title<input id="plan-add-title" className="fx-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Offline sync for documents" /></label>
      <p className="fx-mono fx-small fx-muted" style={{ margin: 0 }}>id: {title ? id : '—'}{exists ? ' (already in the plan)' : ''}</p>
      <label className="fx-field">Area<input id="plan-add-area" className="fx-input" list="plan-areas" value={area} onChange={(e) => setArea(e.target.value)} /><datalist id="plan-areas">{areas.map((x) => <option key={x} value={x} />)}</datalist></label>
      <div className="fx-row fx-row--wrap">{(['epic', 'feature', 'task'] as const).map((k) => <button type="button" key={k} className={`fx-chip ${kind === k ? 'is-selected' : ''}`} onClick={() => setKind(k)}>{k}</button>)}<span className="fx-grow" />{PRIORITIES.map((p) => <button type="button" key={p} className={`fx-chip ${priority === p ? 'is-selected' : ''}`} onClick={() => setPriority(p)}>{p}</button>)}</div>
      <label className="fx-field">Summary<textarea id="plan-add-summary" className="fx-input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
      <div className="fx-row fx-row--end"><Button type="button" onClick={close}>Cancel</Button><Button tone="primary" icon="plus" type="submit" disabled={!title.trim() || exists}>Add to plan</Button></div>
    </form>
  );
}

/** Tab renderer for `plan-feature` (floating windows). */
export function PlanFeatureTab({ id }: { id: string }) {
  const { features } = usePlan();
  const f = features.find((x) => x.id === id);
  return f ? <FeatureDetail feature={f} /> : <div className="fx-empty">Loading {id}…</div>;
}

/** Home card: plan progress at a glance. */
export function PlanSummaryCard() {
  const { features } = usePlan();
  const rt = useRuntime();
  const epics = features.filter((f) => f.kind === 'epic');
  const a = useMemo(() => analyse(features), [features]);
  return (
    <Container title="Plan" icon="layers" actions={<Button icon="external" onClick={() => rt.navigate('plan')}>Open</Button>}>
      <table className="fx-table"><tbody>
        <tr><th>Epics</th><td>{epics.filter((e) => e.status === 'built').length}/{epics.length} built</td></tr>
        <tr><th>All features</th><td>{features.filter((e) => e.status === 'built').length}/{features.length} built</td></tr>
        <tr><th>Waiting on dependencies</th><td>{a.blocked.size}</td></tr>
        <tr><th>Need attention</th><td>{features.filter((f) => f.warnings.some((w) => w.level === 'error')).map((f) => <Chip key={f.id} tone="danger">{f.title}</Chip>)}</td></tr>
      </tbody></table>
    </Container>
  );
}

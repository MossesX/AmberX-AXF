import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Icon, IconButton, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as core from './review-core.mjs';
import type { Decision, Item, Kind } from './review-core.mjs';
import { FOLDER, GROUP_BYS, KEYS, VIEWS, type GroupBy, type ViewId } from './keys';
import { ShotBrowser } from './shots';
import { CompareView, GalleryView, GridView, GroupsView, TreeView } from './views';
import './ui-review.css';

/*
 * UI Review: every UI a build makes waits here for Brett's approval. A strip of sections (one per kind, with waiting
 * counts), search + status / app / sort, five remembered views, multi-select in all of them and one bulk bar
 * (Approve / Ask changes / Reject). Design packs are a section; their Pick flow (3 picks) stays.
 */

const api = pluginApi(FOLDER, 'UI Review', { unavailable: 'The UI Review plugin is switched off or its server part is not running.' });
const REPO = 'MossesX/AmberX-AXF';
type Loaded = { items: Item[]; overlay: Record<string, Partial<Item>>; packs: { packs?: unknown[] }; picks: { picked: string[] }; kinds: { base: Partial<Kind>[]; extra: Partial<Kind>[] } };
const setting = <T,>(rt: ReturnType<typeof useRuntime>, k: string, d: T): T => { try { return (rt.settings.get(k) as T) ?? d; } catch { return d; } };
const save = (rt: ReturnType<typeof useRuntime>, k: string, v: unknown) => { try { rt.settings.set(k, v as Parameters<typeof rt.settings.set>[1]); } catch { /* not saved */ } };

/** What every view needs: the selection, which rows are open, and the decision + pick actions. */
export interface Review {
  kinds: Kind[]; sel: string[]; setSel: (s: string[]) => void; open: string[]; toggleOpen: (id: string) => void;
  decide: (ids: string[], d: Decision, comment?: string) => Promise<void>; picked: string[]; togglePick: (packId: string) => void; device: string;
}
const Ctx = createContext<Review | null>(null);
export const useReview = () => useContext(Ctx)!;

export function StatusChip({ status }: { status: string }) {
  const s = core.statusInfo(status);
  return <span className={`fx-chip fx-chip--${s.tone} axp-ui-review__status`}><Icon name={s.icon} size={12} />{s.label}</span>;
}

/** The checkbox every view puts in front of an item. */
export function Pick({ id, label }: { id: string; label: string }) {
  const r = useReview();
  return <span className="axp-ui-review__check" onClick={(e) => e.stopPropagation()}><Checkbox label={<span className="axp-ui-review__sr">Select {label}</span>} checked={r.sel.includes(id)} onChange={() => r.setSel(core.toggleId(r.sel, id))} /></span>;
}
/** A tri-state checkbox for a group of items (tree nodes, sub-grid heads). */
export function GroupPick({ ids, label }: { ids: string[]; label: string }) {
  const r = useReview(); const st = core.groupChecked(r.sel, ids);
  return <span className="axp-ui-review__check" onClick={(e) => e.stopPropagation()}><Checkbox label={<span className="axp-ui-review__sr">Select all in {label}</span>} checked={st === 'all'} indeterminate={st === 'some'} onChange={(on) => r.setSel(core.setGroup(r.sel, ids, on))} /></span>;
}

/** One line of meta: kind · app · build · PR · shots. */
export function Meta({ it, kind = true }: { it: Item; kind?: boolean }) {
  const r = useReview();
  const k = r.kinds.find((x) => x.id === it.kind);
  return (
    <span className="axp-ui-review__meta fx-small fx-muted">
      {[kind && (k?.label ?? it.kind), it.app, it.build, it.pr ? `#${it.pr}` : '', `${it.shots.length} shot${it.shots.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
    </span>
  );
}

const when = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

/** An item opened: its screenshots, details, the decision buttons, his comment and the history. */
export function Detail({ it }: { it: Item }) {
  const r = useReview();
  const [comment, setComment] = useState(it.comment ?? '');
  useEffect(() => setComment(it.comment ?? ''), [it.id, it.comment]);
  const shots = r.device ? it.shots.filter((s) => s.device === r.device) : it.shots;
  const repo = typeof it.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(it.repo) ? it.repo : REPO;
  const packId = it.pack?.id;
  const on = !!packId && r.picked.includes(packId);
  return (
    <div className="axp-ui-review__detail">
      <ShotBrowser shots={shots.length ? shots : it.shots} title={it.title} />
      <div className="axp-ui-review__facts">
        <dl className="axp-ui-review__dl">
          {it.app && <><dt>App</dt><dd>{it.app}</dd></>}
          {it.build && <><dt>Build</dt><dd>{it.build}</dd></>}
          {it.branch && <><dt>Branch</dt><dd className="fx-mono">{it.branch}</dd></>}
          {it.pr && <><dt>PR</dt><dd><a className="fx-link" href={`https://github.com/${repo}/pull/${it.pr}`} target="_blank" rel="noreferrer">#{it.pr}</a></dd></>}
          {it.pack && <><dt>Look</dt><dd><span className="axp-ui-review__sw" aria-hidden="true">{it.pack.swatches.map((c, i) => <i key={i} style={{ background: c }} />)}</span> {it.pack.scheme === 'dark' ? 'Dark' : 'Light'} · {it.pack.font}px · {it.pack.radius}px</dd></>}
          <dt>Status</dt><dd><StatusChip status={it.status} /></dd>
        </dl>
        {it.notes && <p className="axp-ui-review__notes">{it.notes}</p>}
        <textarea className="fx-input axp-ui-review__comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Your comment (what to change, why)…" aria-label="Your comment" />
        <div className="axp-ui-review__acts">
          {packId && <Button size="sm" tone={on ? 'primary' : 'neutral'} icon={on ? 'check' : 'plus'} onClick={() => r.togglePick(packId)} aria-pressed={on}>{on ? 'Picked' : 'Pick'}</Button>}
          <Button size="sm" tone="primary" icon="check" onClick={() => void r.decide([it.id], 'approve', comment)} disabled={it.status === 'approved' && comment === it.comment}>Approve</Button>
          <Button size="sm" icon="edit" onClick={() => void r.decide([it.id], 'changes', comment)}>Ask changes</Button>
          <Button size="sm" tone="danger" icon="x" onClick={() => void r.decide([it.id], 'reject', comment)}>Reject</Button>
          {it.status !== 'waiting' && <Button size="sm" tone="ghost" icon="undo" onClick={() => void r.decide([it.id], 'reopen', comment)}>Reopen</Button>}
        </div>
        {it.history.length > 0 && (
          <details className="axp-ui-review__history">
            <summary className="fx-small fx-muted">History ({it.history.length})</summary>
            <ol>{[...it.history].reverse().map((h, k) => <li key={k} className="fx-small"><span className="fx-muted">{when(h.at)}</span> · {h.by} · {core.statusInfo(h.status).label}{h.comment ? <> — <q>{h.comment}</q></> : null}</li>)}</ol>
          </details>
        )}
      </div>
    </div>
  );
}

/** The bulk bar: shows while anything is selected, in every view. */
function BulkBar({ n, onClear }: { n: number; onClear: () => void }) {
  const r = useReview();
  const [comment, setComment] = useState('');
  const run = async (d: Decision) => { await r.decide(r.sel, d, comment); setComment(''); };
  return (
    <div className="axp-ui-review__bulk" role="toolbar" aria-label={`${n} selected`}>
      <span className="axp-ui-review__bulkn"><b>{n}</b> selected</span>
      <input className="fx-input axp-ui-review__bulkc" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" aria-label="Comment for the selected items" />
      <Button size="sm" tone="primary" icon="check" onClick={() => void run('approve')}>Approve</Button>
      <Button size="sm" icon="edit" onClick={() => void run('changes')}>Ask changes</Button>
      <Button size="sm" tone="danger" icon="x" onClick={() => void run('reject')}>Reject</Button>
      <IconButton icon="x-circle" label="Clear the selection" onClick={onClear} />
    </div>
  );
}

export function UiReviewPage({ section }: { section?: string }) {
  const rt = useRuntime();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [kind, setKindRaw] = useState<string>(() => section ?? setting(rt, KEYS.section, ''));
  const [view, setViewRaw] = useState<ViewId>(() => setting(rt, KEYS.view, 'grid') as ViewId);
  const [sort, setSortRaw] = useState<string>(() => setting(rt, KEYS.sort, 'waiting'));
  const [groupBy, setGroupByRaw] = useState<GroupBy>(() => setting(rt, KEYS.groupBy, 'kind') as GroupBy);
  const [status, setStatusRaw] = useState<string>(() => setting(rt, KEYS.status, ''));
  const [device, setDeviceRaw] = useState<string>(() => setting(rt, KEYS.device, ''));
  const [app, setApp] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const remember = <T,>(k: string, f: (v: T) => void) => (v: T) => { f(v); save(rt, k, v); };
  const setKind = remember(KEYS.section, setKindRaw), setView = remember(KEYS.view, setViewRaw), setSort = remember(KEYS.sort, setSortRaw);
  const setGroupBy = remember(KEYS.groupBy, setGroupByRaw), setStatus = remember(KEYS.status, setStatusRaw), setDevice = remember(KEYS.device, setDeviceRaw);
  useEffect(() => { if (section) setKindRaw(section); }, [section]);

  const load = async () => {
    try { setData(await api.call<Loaded>('items')); setError(''); }
    catch (e) { setError((e as Error).message); setData((d) => d ?? { items: [], overlay: {}, packs: { packs: [] }, picks: { picked: [] }, kinds: { base: [], extra: [] } }); }
  };
  useEffect(() => { void load(); }, []);

  const all = useMemo(() => (data ? [...data.items.map((x) => core.normItem(x).item), ...core.packItems(data.packs, data.overlay)] : []), [data]);
  const kinds = useMemo(() => (data ? core.mergeKinds(data.kinds.base, data.kinds.extra, all) : []), [data, all]);
  const counts = useMemo(() => core.counts(all), [all]);
  const appList = useMemo(() => core.apps(all), [all]);
  const rows = useMemo(() => core.sortItems(core.filterItems(all, { kind, status, app, q }), sort), [all, kind, status, app, q, sort]);
  const picked = data?.picks.picked ?? [];

  const decide = async (ids: string[], d: Decision, comment = '') => {
    if (!ids.length) return;
    try {
      const r = await api.post<{ changed: string[] }>('decide', { ids, decision: d, comment });
      rt.terminal.log('ui-review', `${d}: ${r.changed.length} item(s)`, 'ok');
      rt.toast(`${core.statusInfo(core.DECISIONS[d]).label}: ${r.changed.length} item${r.changed.length === 1 ? '' : 's'}`, 'success');
      setSel((s) => s.filter((x) => !r.changed.includes(x)));
      await load();
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  const togglePick = async (id: string) => {
    const r = core.togglePick(picked, id);
    if (r.error) { rt.toast(r.error, 'warning'); return; }
    setData((d) => (d ? { ...d, picks: { ...d.picks, picked: r.picked } } : d));
    try { await api.put('picks', { picked: r.picked }); rt.terminal.log('ui-review', `design-pack picks: ${r.picked.join(', ') || 'none'}`, 'ok'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  const toggleOpen = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const ctx: Review = { kinds, sel, setSel, open, toggleOpen, decide, picked, togglePick, device };

  if (!data) return <LoadingSkeleton rows={6} label="Loading UI Review" />;
  const c = counts[''] ?? { total: 0, waiting: 0 };
  const visibleIds = rows.map((x) => x.id);
  const allState = core.groupChecked(sel, visibleIds);
  const showPicks = kind === core.DESIGN_KIND || (!kind && rows.some((x) => x.kind === core.DESIGN_KIND));

  return (
    <Ctx.Provider value={ctx}>
      <div className="fx-stack axp-ui-review">
        <header className="fx-pagehead">
          <div>
            <p className="fx-eyebrow">Approvals · {c.waiting} waiting · {c.total} in all</p>
            <h1>UI Review</h1>
            <p className="fx-muted">Every UI a build makes waits here for your OK, sorted by kind.</p>
          </div>
          <div className="axp-ui-review__headacts">
            {showPicks && (
              <span className="axp-ui-review__picks" aria-label={`${picked.length} of ${core.MAX_PICKS} design packs picked`}>
                <span className="fx-small fx-muted">{picked.length}/{core.MAX_PICKS} picked</span>
                <span className="axp-ui-review__dots">{Array.from({ length: core.MAX_PICKS }, (_, i) => <i key={i} className={i < picked.length ? 'is-on' : ''} />)}</span>
              </span>
            )}
            <IconButton icon="refresh" label="Reload" onClick={() => void load()} />
          </div>
        </header>
        {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}

        <nav className="axp-ui-review__sections" aria-label="Sections">
          <button type="button" className={`fx-chip ${!kind ? 'fx-chip--accent' : ''}`} aria-pressed={!kind} onClick={() => setKind('')}>All <span className="axp-ui-review__n">{c.waiting}/{c.total}</span></button>
          {kinds.map((k) => { const n = counts[k.id] ?? { waiting: 0, total: 0 }; return (
            <button type="button" key={k.id} className={`fx-chip ${kind === k.id ? 'fx-chip--accent' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)} title={k.desc}>
              <Icon name={k.icon} size={12} />{k.label} <span className="axp-ui-review__n">{n.waiting}/{n.total}</span>
            </button>
          ); })}
        </nav>

        <div className="axp-ui-review__bar" role="toolbar" aria-label="Filter and view">
          <input className="fx-input axp-ui-review__search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: title, app, branch, #PR…" aria-label="Search" />
          <select className="fx-input axp-ui-review__sel" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Every status</option><option value="open">Not approved</option>
            {core.STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {appList.length > 1 && <select className="fx-input axp-ui-review__sel" value={app} onChange={(e) => setApp(e.target.value)} aria-label="App"><option value="">Every app</option>{appList.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
          <select className="fx-input axp-ui-review__sel" value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Screens"><option value="">Phone + desktop</option><option value="phone">Phone shots</option><option value="desktop">Desktop shots</option></select>
          <select className="fx-input axp-ui-review__sel" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Order">{core.SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <select className="fx-input axp-ui-review__sel axp-ui-review__viewsel" value={view} onChange={(e) => setView(e.target.value as ViewId)} aria-label="View">{VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label} view</option>)}</select>
          {view === 'groups' && <select className="fx-input axp-ui-review__sel" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label="Group by">{GROUP_BYS.map((g) => <option key={g.id} value={g.id}>By {g.label.toLowerCase()}</option>)}</select>}
        </div>

        <div className="axp-ui-review__countline fx-small fx-muted">
          <Checkbox label={`${rows.length} shown${sel.length ? ` · ${sel.length} selected` : ''}`} checked={allState === 'all' && rows.length > 0} indeterminate={allState === 'some'} onChange={(on) => setSel(core.setGroup(sel, visibleIds, on))} disabled={!rows.length} />
        </div>

        {rows.length === 0 ? (
          <EmptyState icon="eye">{all.length ? 'Nothing matches. Clear the search or pick another section.' : 'Nothing to review yet. Builds submit their screenshots with review.mjs.'}</EmptyState>
        ) : view === 'tree' ? <TreeView items={rows} />
          : view === 'groups' ? <GroupsView items={rows} by={groupBy} />
          : view === 'gallery' ? <GalleryView items={rows} />
          : view === 'compare' ? <CompareView items={rows} />
          : <GridView items={rows} />}

        {sel.length > 0 && <BulkBar n={sel.length} onClear={() => setSel([])} />}
      </div>
    </Ctx.Provider>
  );
}

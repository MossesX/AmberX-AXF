import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Button, Checkbox, Chip, Icon, IconButton, Markdown, Segmented, useRuntime } from '@console/axf/react';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as pc from './plan-core.mjs';
import type { CatNode, Filter, Plan, SavedView } from './plan-core.mjs';
import { call, fmtDay, KEYS, putPlan, reload, savePlan, setPart, statusInfo, useBusy, useStudio } from './api';
import { CommandBox, VoicePanel } from './ai';
import { PlanEditor } from './editor';
import { CatalogTab } from './catalog';
import { canListen } from './voice';
import './plan-studio.css';

/*
 * Plan Studio page: Plans · Catalog · Categories. Plans show as a collapsible tree (multi-select), a grid whose rows
 * open into panes, sub-grids grouped by category / status / project / tag / priority, a board by status (drag a card
 * to change it), a roadmap by target month, or a reader. Search covers every field; filters, sort, saved views,
 * counts and bulk actions sit above. Phone first: one column, sideways-scrolling toolbars.
 */

type Tab = 'plans' | 'catalog' | 'categories';
type Layout = 'tree' | 'grid' | 'groups' | 'board' | 'roadmap' | 'reader';
const LAYOUTS: { value: Layout; label: string; icon: string }[] = [
  { value: 'tree', label: 'Tree', icon: 'folder' }, { value: 'grid', label: 'Grid', icon: 'list' }, { value: 'groups', label: 'Sub-grids', icon: 'grid' },
  { value: 'board', label: 'Board', icon: 'layout' }, { value: 'roadmap', label: 'Roadmap', icon: 'chart' }, { value: 'reader', label: 'Reader', icon: 'file' },
];
const setting = (rt: ReturnType<typeof useRuntime>, k: string, d: string) => { try { const v = rt.settings.get(k); return typeof v === 'string' && v ? v : d; } catch { return d; } };

/** A plan to open when the page shows (quick capture, "Plan this", a search hit). */
let pendingOpen: { id?: string; plan?: Plan } | null = null;
const openers = new Set<() => void>();
export function openPlan(o: { id?: string; plan?: Plan }) { pendingOpen = o; openers.forEach((f) => f()); }

export function Head({ count }: { count?: number }) {
  return (
    <header className="fx-pagehead axp-plan-studio__head">
      <div>
        <p className="fx-eyebrow">Builds · plans{count ? ` · ${count}` : ''}</p>
        <h1>Plan Studio</h1>
        <p className="fx-muted">Every plan in one place: write it, file it, find it, and turn it into a build when it's ready.</p>
      </div>
    </header>
  );
}

export function PlanStudioPage() {
  const { state, error } = useStudio();
  const [tab, setTab] = useState<Tab>('plans');
  const [open, setOpen] = useState<{ plan: Plan; isNew: boolean } | null>(null);
  const [voice, setVoice] = useState(false);

  // open what quick capture / Plan this asked for
  useEffect(() => {
    const take = () => {
      if (!pendingOpen || !state) return;
      const o = pendingOpen; pendingOpen = null;
      if (o.plan) { setOpen({ plan: o.plan, isNew: !state.plans.some((p) => p.id === o.plan!.id) }); setTab('plans'); }
      else if (o.id) { const p = state.plans.find((x) => x.id === o.id); if (p) { setOpen({ plan: p, isNew: false }); setTab('plans'); } }
    };
    openers.add(take); take();
    return () => { openers.delete(take); };
  }, [state]);

  if (!state) return <div className="fx-stack axp-plan-studio"><Head />{error ? <EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => void reload() }}>{error}</EmptyState> : <LoadingSkeleton rows={8} label="Loading plans" />}</div>;
  const openId = (id: string) => { const p = state.plans.find((x) => x.id === id); if (p) setOpen({ plan: p, isNew: false }); };

  if (open) return <div className="fx-stack axp-plan-studio"><PlanEditor key={open.plan.id} initial={open.plan} isNew={open.isNew} onClose={() => setOpen(null)} onOpen={openId} /></div>;

  return (
    <div className="fx-stack axp-plan-studio">
      <Head count={state.plans.length} />
      <div className="axp-plan-studio__topbar">
        <div className="fx-tabs" role="tablist" aria-label="Plan Studio">
          {([['plans', 'Plans', 'list', state.plans.length], ['catalog', 'Catalog', 'package', null], ['categories', 'Categories', 'folder', state.categories.paths.length]] as const).map(([id, label, icon, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`fx-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}><Icon name={icon} size={12} />{label}{n !== null && <span className="axp-plan-studio__n">{n}</span>}</button>
          ))}
        </div>
        <span className="axp-plan-studio__grow" />
        {canListen() && <Button size="sm" icon="mic" onClick={() => setVoice(true)}>Talk</Button>}
        <NewPlanButton onNew={(p) => setOpen({ plan: p, isNew: true })} />
      </div>
      {voice && <VoicePanel plan={null} onClose={() => setVoice(false)} onOpen={openId} />}
      {tab === 'plans' && <PlansTab onOpen={(p) => setOpen({ plan: p, isNew: false })} />}
      {tab === 'catalog' && <CatalogTab onPlan={(p) => setOpen({ plan: p, isNew: !state.plans.some((x) => x.id === p.id) })} />}
      {tab === 'categories' && <CategoriesTab />}
      {!state.onHub && <p className="fx-muted axp-plan-studio__hint"><Icon name="info" size={11} /> Plans are kept in {state.store} on this machine. On the console server they live in the hub's shared data, where claude.ai and VPS sessions read and write them.</p>}

    </div>
  );
}

export function NewPlanButton({ onNew }: { onNew: (p: Plan) => void }) {
  const { state } = useStudio();
  const [menu, setMenu] = useState(false);
  const all = state?.templates.all ?? pc.BUILT_IN_TEMPLATES;
  return (
    <span className="axp-plan-studio__new">
      <Button size="sm" tone="primary" icon="plus" onClick={() => onNew(pc.normalize({ title: '', status: 'draft' }))}>New plan</Button>
      <IconButton icon="chevron-down" label="New from a template" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      {menu && (
        <div className="fx-menu axp-plan-studio__menu" role="menu">
          {all.map((t) => <button key={t.id} type="button" role="menuitem" className="fx-menu__item" onClick={() => { setMenu(false); onNew(pc.fromTemplate(t, { title: '' })); }}><Icon name={t.icon} size={12} /> {t.label}{!t.builtIn && <span className="fx-muted"> · yours</span>}</button>)}
        </div>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- Plans tab */

function PlansTab({ onOpen }: { onOpen: (p: Plan) => void }) {
  const rt = useRuntime();
  const { state } = useStudio();
  const [layout, setLayout] = useState<Layout>(() => setting(rt, KEYS.layout, 'grid') as Layout);
  const [sort, setSort] = useState(() => setting(rt, KEYS.sort, 'priority'));
  const [group, setGroup] = useState(() => setting(rt, KEYS.group, 'category'));
  const [f, setF] = useState<Filter>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { busy, error, run } = useBusy();
  const plans = state?.plans ?? [];
  const shown = useMemo(() => pc.sortPlans(pc.filterPlans(plans, f), sort), [plans, f, sort]);
  const c = useMemo(() => pc.counts(shown), [shown]);
  const all = useMemo(() => pc.counts(plans), [plans]);
  const tags = useMemo(() => [...new Set(plans.flatMap((p) => p.tags))].sort(), [plans]);
  const filtering = !!(f.q || f.statuses?.length || f.priorities?.length || f.categories?.length || f.tags?.length);
  const toggle = (k: keyof Filter, v: string) => setF((x) => { const cur = (x[k] as string[] | undefined) ?? []; return { ...x, [k]: cur.includes(v) ? cur.filter((y) => y !== v) : [...cur, v] }; });
  const pick = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doBulk = (change: Record<string, unknown>) => run(async () => { await call('bulk', { ids: [...sel], change }); await reload(); rt.toast(`${sel.size} plans changed`, 'success'); });
  const views = state?.views.items ?? [];
  const useView = (v: SavedView) => { setLayout(v.layout as Layout); setF(v.filter); setSort(v.sort); if (v.group) setGroup(v.group); };
  const saveView = () => run(async () => { const label = window.prompt('Name this view'); if (!label) return; const r = await call<{ views: { items: SavedView[] } }>('view-save', { view: { label, layout, filter: f, sort, group } }); setPart({ views: r.views }); });
  const exportSel = (format: 'md' | 'json') => run(async () => {
    const r = await call<{ text: string }>('export', { ids: sel.size ? [...sel] : [], format });
    const blob = new Blob([r.text], { type: format === 'md' ? 'text/markdown' : 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `plans.${format}`; a.click(); URL.revokeObjectURL(a.href);
  });
  const importFile = (file: File | undefined) => file && run(async () => { const text = await file.text(); const r = await call<{ imported: string[] }>('import', { text }); await reload(); rt.toast(`Imported ${r.imported.length} plan${r.imported.length === 1 ? '' : 's'} (parked unless they say)`, 'success'); });

  return (
    <div className="fx-stack axp-plan-studio__plans">
      <CommandBox plan={null} onOpen={(id) => { const p = state?.plans.find((x) => x.id === id); if (p) onOpen(p); }} />
      <div className="axp-plan-studio__strip" aria-label="Counts">
        <span><b>{c.plans}</b>{filtering ? ` of ${all.plans}` : ''} plans</span>
        {pc.STATUSES.filter((s) => all.statuses[s.id]).map((s) => <span key={s.id}><b>{c.statuses[s.id] ?? 0}</b> {s.label.toLowerCase()}</span>)}
        <span><b>{pc.fmtMinutes(c.left) || '0 min'}</b> left</span><span><b>{pc.fmtCost(c.cost) || '$0'}</b> est.</span>
      </div>
      <div className="axp-plan-studio__tools" role="toolbar" aria-label="View, filter and sort">
        <label className="fx-search axp-plan-studio__search"><Icon name="search" size={13} /><input type="search" value={f.q ?? ''} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search every field…" aria-label="Search plans" /></label>
        <Segmented size="sm" label="Layout" value={layout} onChange={setLayout} options={LAYOUTS.map((l) => ({ value: l.value, label: l.label }))} />
        <label className="fx-search axp-plan-studio__sel"><Icon name="list" size={12} /><select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>{pc.SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        {layout === 'groups' && <label className="fx-search axp-plan-studio__sel"><Icon name="layers" size={12} /><select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value)}>{pc.GROUPS.map((g) => <option key={g.id} value={g.id}>By {g.label.toLowerCase()}</option>)}</select></label>}
        {views.length > 0 && <label className="fx-search axp-plan-studio__sel"><Icon name="eye" size={12} /><select aria-label="Saved views" value="" onChange={(e) => { const v = views.find((x) => x.id === e.target.value); if (v) useView(v); }}><option value="">Saved views…</option>{views.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>}
        <IconButton icon="save" label="Save this view" onClick={saveView} />
        <IconButton icon="download" label="Export (selected, or all) as Markdown" onClick={() => exportSel('md')} />
        <IconButton icon="code" label="Export as JSON" onClick={() => exportSel('json')} />
        <label className="fx-iconbtn" title="Import Markdown or JSON plans"><Icon name="upload" size={14} /><input type="file" hidden accept=".md,.markdown,.json,.txt" onChange={(e) => importFile(e.target.files?.[0])} aria-label="Import plans" /></label>
        {filtering && <IconButton icon="x" label="Clear filters" onClick={() => setF({})} />}
      </div>
      <div className="axp-plan-studio__chips" role="group" aria-label="Filters">
        {pc.STATUSES.filter((s) => all.statuses[s.id]).map((s) => <Button key={s.id} size="sm" tone={f.statuses?.includes(s.id) ? 'primary' : 'quiet'} icon={s.icon} aria-pressed={!!f.statuses?.includes(s.id)} onClick={() => toggle('statuses', s.id)}>{s.label} <span className="axp-plan-studio__n">{all.statuses[s.id]}</span></Button>)}
        {pc.PRIORITIES.filter((p) => all.priorities[p]).map((p) => <Button key={p} size="sm" tone={f.priorities?.includes(p) ? 'primary' : 'quiet'} aria-pressed={!!f.priorities?.includes(p)} onClick={() => toggle('priorities', p)}>{p}</Button>)}
        {tags.slice(0, 20).map((t) => <Button key={t} size="sm" tone={f.tags?.includes(t) ? 'primary' : 'quiet'} aria-pressed={!!f.tags?.includes(t)} onClick={() => toggle('tags', t)}>#{t}</Button>)}
        {f.categories?.map((cat) => <Button key={cat} size="sm" tone="primary" icon="x" onClick={() => toggle('categories', cat)}>{cat}</Button>)}
      </div>
      {sel.size > 0 && (
        <div className="axp-plan-studio__bulk" role="toolbar" aria-label="Bulk actions">
          <b>{sel.size} selected</b>
          <label className="fx-search axp-plan-studio__sel"><select aria-label="Set status" value="" onChange={(e) => e.target.value && doBulk({ status: e.target.value })}><option value="">Status…</option>{pc.STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="fx-search axp-plan-studio__sel"><select aria-label="Set priority" value="" onChange={(e) => e.target.value && doBulk({ priority: e.target.value })}><option value="">Priority…</option>{pc.PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="fx-search axp-plan-studio__sel"><select aria-label="Move to category" value="" onChange={(e) => e.target.value && doBulk({ category: e.target.value === '-' ? '' : e.target.value })}><option value="">Category…</option><option value="-">Uncategorized</option>{(state?.categories.paths ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <Button size="sm" icon="plus" onClick={() => { const t = window.prompt('Tag to add'); if (t) doBulk({ addTag: t }); }}>Tag</Button>
          <Button size="sm" tone="quiet" icon="x" onClick={() => setSel(new Set())}>Clear</Button>
          {busy && <span className="fx-muted">Working…</span>}
        </div>
      )}
      {error && <p className="fx-error" role="alert">{error}</p>}
      {shown.length === 0 ? (
        <EmptyState icon={filtering ? 'search' : 'file'} action={filtering ? { label: 'Clear filters', icon: 'x', onClick: () => setF({}) } : undefined}>{filtering ? 'No plans match.' : 'No plans yet. Tap New plan, or tell the box above: "new plan: …".'}</EmptyState>
      ) : layout === 'tree' ? <TreeView plans={shown} sel={sel} pick={pick} onOpen={onOpen} onCategory={(cat) => setF({ ...f, categories: [cat] })} />
        : layout === 'board' ? <Board plans={shown} onOpen={onOpen} />
        : layout === 'roadmap' ? <Roadmap plans={shown} onOpen={onOpen} />
        : layout === 'reader' ? <Reader plans={shown} onOpen={onOpen} />
        : layout === 'groups' ? <div className="fx-stack">{pc.groupPlans(shown, group).map((g) => <SubGrid key={g.id} title={g.label} plans={g.plans} sel={sel} pick={pick} onOpen={onOpen} />)}</div>
        : <Grid plans={shown} sel={sel} pick={pick} onOpen={onOpen} />}
    </div>
  );
}

function Row({ p, sel, pick, onOpen }: { p: Plan; sel: Set<string>; pick: (id: string) => void; onOpen: (p: Plan) => void }) {
  const [open, setOpen] = useState(false);
  const st = statusInfo(p.status);
  const t = pc.totals(p);
  return (
    <li className={`axp-plan-studio__row${open ? ' is-open' : ''}`}>
      <div className="axp-plan-studio__rline">
        <input type="checkbox" className="fx-check" checked={sel.has(p.id)} onChange={() => pick(p.id)} aria-label={`Select ${p.title}`} />
        <button type="button" data-fx-row className="axp-plan-studio__rmain" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
          <span className={`axp-plan-studio__prio is-${p.priority.toLowerCase()}`}>{p.priority}</span>
          <span className="axp-plan-studio__rtitle">{p.title}</span>
          <span className="axp-plan-studio__rmeta">{p.category && <span className="fx-muted">{p.category}</span>}{t.steps > 0 && <span>{t.done}/{t.steps}</span>}{p.effort.left > 0 && <span>{pc.fmtMinutes(p.effort.left)}</span>}{p.targetDate && <span>{fmtDay(p.targetDate)}</span>}</span>
        </button>
        <Chip tone={st.tone || undefined}>{st.label}</Chip>
        <IconButton icon="edit" label={`Open ${p.title}`} onClick={() => onOpen(p)} />
      </div>
      {open && (
        <div className="axp-plan-studio__pane">
          {p.summary && <p>{p.summary}</p>}
          {p.goal && <p><b>Goal:</b> {p.goal}</p>}
          {p.steps.length > 0 && <ol className="axp-plan-studio__psteps">{p.steps.slice(0, 12).map((s) => <li key={s.id} className={s.done ? 'is-done' : ''}>{s.text} <span className="fx-muted">({s.model}{s.minutes ? `, ${pc.fmtMinutes(s.minutes)}` : ''})</span></li>)}{p.steps.length > 12 && <li className="fx-muted">…{p.steps.length - 12} more</li>}</ol>}
          <p className="fx-muted axp-plan-studio__hint">{[p.tags.map((x) => `#${x}`).join(' '), p.profile && `profile ${p.profile}`, p.build && `build ${p.build.id} · ${p.build.progress ?? 0}%`, pc.fmtCost(p.cost.usd) && `${pc.fmtCost(p.cost.usd)} est.`, `changed ${fmtDay(p.updatedAt)}`].filter(Boolean).join(' · ')}</p>
          <div className="fx-row"><Button size="sm" tone="primary" icon="edit" onClick={() => onOpen(p)}>Open</Button></div>
        </div>
      )}
    </li>
  );
}

function Grid({ plans, sel, pick, onOpen }: { plans: Plan[]; sel: Set<string>; pick: (id: string) => void; onOpen: (p: Plan) => void }) {
  const allOn = plans.every((p) => sel.has(p.id));
  return (
    <div className="axp-plan-studio__grid">
      <div className="axp-plan-studio__ghead"><Checkbox label={`${plans.length} plans`} checked={allOn && plans.length > 0} indeterminate={!allOn && plans.some((p) => sel.has(p.id))} onChange={(v) => plans.forEach((p) => { if (v !== sel.has(p.id)) pick(p.id); })} /></div>
      <ul>{plans.map((p) => <Row key={p.id} p={p} sel={sel} pick={pick} onOpen={onOpen} />)}</ul>
    </div>
  );
}
function SubGrid({ title, plans, ...rest }: { title: string; plans: Plan[]; sel: Set<string>; pick: (id: string) => void; onOpen: (p: Plan) => void }) {
  const [open, setOpen] = useState(true);
  const c = pc.counts(plans);
  return (
    <section className="axp-plan-studio__sub">
      <button type="button" data-fx-row className="axp-plan-studio__subh" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} /><b>{title}</b><span className="axp-plan-studio__n">{plans.length}</span>
        <span className="axp-plan-studio__grow" /><span className="fx-muted axp-plan-studio__n">{pc.fmtMinutes(c.left)}</span>
      </button>
      {open && <Grid plans={plans} {...rest} />}
    </section>
  );
}

function TreeView({ plans, sel, pick, onOpen, onCategory }: { plans: Plan[]; sel: Set<string>; pick: (id: string) => void; onOpen: (p: Plan) => void; onCategory: (c: string) => void }) {
  const { state } = useStudio();
  const tree = useMemo(() => pc.categoryTree(state?.categories.paths ?? [], plans), [state, plans]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const none = plans.filter((p) => !p.category);
  const node = (n: CatNode, depth: number) => {
    if (!n.total && !n.children.some((x) => x.total)) return null;
    const here = plans.filter((p) => p.category === n.path);
    const ids = plans.filter((p) => p.category === n.path || p.category.startsWith(n.path + pc.SEP)).map((p) => p.id);
    const on = ids.length > 0 && ids.every((id) => sel.has(id));
    const shut = closed.has(n.path);
    return (
      <li key={n.path} className="axp-plan-studio__tnode" style={{ ['--axp-ps-depth' as string]: depth }}>
        <div className="axp-plan-studio__tline">
          <input type="checkbox" className="fx-check" checked={on} ref={(el) => { if (el) el.indeterminate = !on && ids.some((id) => sel.has(id)); }} onChange={() => ids.forEach((id) => { if (on === sel.has(id)) pick(id); })} aria-label={`Select every plan in ${n.path}`} />
          <button type="button" data-fx-row className="axp-plan-studio__tname" aria-expanded={!shut} onClick={() => setClosed((s) => { const x = new Set(s); if (x.has(n.path)) x.delete(n.path); else x.add(n.path); return x; })}>
            <Icon name={shut ? 'chevron-right' : 'chevron-down'} size={11} /><Icon name="folder" size={12} />{n.name}<span className="axp-plan-studio__n">{n.total}</span>
          </button>
          <IconButton icon="search" label={`Only ${n.path}`} onClick={() => onCategory(n.path)} />
        </div>
        {!shut && (
          <ul>
            {n.children.map((x) => node(x, depth + 1))}
            {here.map((p) => <TreeLeaf key={p.id} p={p} sel={sel} pick={pick} onOpen={onOpen} />)}
          </ul>
        )}
      </li>
    );
  };
  return (
    <ul className="axp-plan-studio__tree" role="tree">
      {tree.map((n) => node(n, 0))}
      {none.length > 0 && <li className="axp-plan-studio__tnode"><div className="axp-plan-studio__tline"><span className="axp-plan-studio__tname"><Icon name="folder" size={12} />Uncategorized<span className="axp-plan-studio__n">{none.length}</span></span></div><ul>{none.map((p) => <TreeLeaf key={p.id} p={p} sel={sel} pick={pick} onOpen={onOpen} />)}</ul></li>}
    </ul>
  );
}
function TreeLeaf({ p, sel, pick, onOpen }: { p: Plan; sel: Set<string>; pick: (id: string) => void; onOpen: (p: Plan) => void }) {
  const st = statusInfo(p.status);
  return (
    <li className="axp-plan-studio__tleaf" role="treeitem" aria-selected={sel.has(p.id)}>
      <input type="checkbox" className="fx-check" checked={sel.has(p.id)} onChange={() => pick(p.id)} aria-label={`Select ${p.title}`} />
      <button type="button" data-fx-row className="axp-plan-studio__tname" onClick={() => onOpen(p)}><span className={`axp-plan-studio__prio is-${p.priority.toLowerCase()}`}>{p.priority}</span>{p.title}</button>
      <Chip tone={st.tone || undefined}>{st.label}</Chip>
    </li>
  );
}

function Board({ plans, onOpen }: { plans: Plan[]; onOpen: (p: Plan) => void }) {
  const rt = useRuntime();
  const [over, setOver] = useState('');
  const drop = async (e: DragEvent, status: string) => {
    e.preventDefault(); setOver('');
    const id = e.dataTransfer.getData('text/plain');
    const p = plans.find((x) => x.id === id);
    if (!p || p.status === status) return;
    const prev = p;
    putPlan({ ...p, status: status as Plan['status'] });
    try { await savePlan({ ...p, status: status as Plan['status'] }, { note: `Moved to ${status} on the board` }); } catch (err) { putPlan(prev); rt.toast((err as Error).message, 'danger'); }
  };
  return (
    <div className="axp-plan-studio__board" role="list" aria-label="Board by status">
      {pc.STATUSES.map((s) => {
        const col = plans.filter((p) => p.status === s.id);
        return (
          <section key={s.id} role="listitem" className={`axp-plan-studio__col${over === s.id ? ' is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver('')} onDrop={(e) => void drop(e, s.id)} aria-label={s.label}>
            <h3><Icon name={s.icon} size={12} />{s.label}<span className="axp-plan-studio__n">{col.length}</span></h3>
            {col.map((p) => (
              <button key={p.id} type="button" data-fx-row draggable className="axp-plan-studio__card" onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)} onClick={() => onOpen(p)}>
                <span className={`axp-plan-studio__prio is-${p.priority.toLowerCase()}`}>{p.priority}</span>
                <span className="axp-plan-studio__ctitle">{p.title}</span>
                <span className="fx-muted axp-plan-studio__n">{[p.category, pc.fmtMinutes(p.effort.left)].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Roadmap({ plans, onOpen }: { plans: Plan[]; onOpen: (p: Plan) => void }) {
  const lanes = pc.roadmap(plans);
  const label = (m: string) => { if (!m) return 'No target date'; const d = new Date(`${m}-01T12:00:00`); return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
  return (
    <ol className="axp-plan-studio__road">
      {lanes.map((l) => (
        <li key={l.month || 'none'}>
          <h3><Icon name="clock" size={12} />{label(l.month)}<span className="axp-plan-studio__n">{l.plans.length}</span></h3>
          <ul>{l.plans.map((p) => {
            const t = pc.totals(p);
            return (
              <li key={p.id}><button type="button" data-fx-row className="axp-plan-studio__rmain" onClick={() => onOpen(p)}>
                <span className="axp-plan-studio__rdate">{p.targetDate ? fmtDay(p.targetDate) : '—'}</span>
                <span className="axp-plan-studio__rtitle">{p.title}</span>
                <span className="axp-plan-studio__bar" aria-label={`${t.progress}% done`}><span style={{ width: `${t.progress}%` }} /></span>
                <Chip tone={statusInfo(p.status).tone || undefined}>{statusInfo(p.status).label}</Chip>
              </button></li>
            );
          })}</ul>
        </li>
      ))}
    </ol>
  );
}

function Reader({ plans, onOpen }: { plans: Plan[]; onOpen: (p: Plan) => void }) {
  const [i, setI] = useState(0);
  const p = plans[Math.min(i, plans.length - 1)]!;
  return (
    <article className="axp-plan-studio__reader">
      <div className="fx-row">
        <IconButton icon="chevron-left" label="Previous plan" disabled={i === 0} onClick={() => setI(i - 1)} />
        <span className="fx-muted axp-plan-studio__n">{Math.min(i, plans.length - 1) + 1} / {plans.length}</span>
        <IconButton icon="chevron-right" label="Next plan" disabled={i >= plans.length - 1} onClick={() => setI(i + 1)} />
        <span className="axp-plan-studio__grow" />
        <Button size="sm" icon="edit" onClick={() => onOpen(p)}>Edit</Button>
      </div>
      <Markdown text={pc.toMarkdown(p).replace(/<!--[\s\S]*?-->/g, '')} />
    </article>
  );
}

/* ---------------------------------------------------------------- Categories editor */

function CategoriesTab() {
  const { state } = useStudio();
  const { busy, error, run } = useBusy();
  const [sel, setSel] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const tree = pc.categoryTree(state?.categories.paths ?? [], state?.plans ?? []);
  const paths = state?.categories.paths ?? [];
  const op = (change: Record<string, unknown>) => run(async () => { const r = await call<{ categories: { paths: string[] }; log: string[] }>('category', { change }); setLog(r.log); await reload(); });
  const flat = (ns: CatNode[], d = 0): { n: CatNode; d: number }[] => ns.flatMap((n) => [{ n, d }, ...flat(n.children, d + 1)]);
  return (
    <div className="fx-stack axp-plan-studio__cats">
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Categories">
        <Button size="sm" icon="plus" disabled={busy} onClick={() => { const name = window.prompt(sel ? `New category inside ${sel}` : 'New top-level category'); if (name) op({ op: 'add', parent: sel, name }); }}>Add{sel ? ' inside' : ''}</Button>
        <Button size="sm" icon="edit" disabled={!sel || busy} onClick={() => { const name = window.prompt('New name', pc.leafName(sel)); if (name) op({ op: 'rename', path: sel, name }); }}>Rename</Button>
        <Button size="sm" icon="move" disabled={!sel || busy} onClick={() => { const into = window.prompt(`Move ${sel} into (empty = top level)`, pc.parentPath(sel)); if (into !== null) op({ op: 'move', path: sel, into }); }}>Move</Button>
        <Button size="sm" icon="shuffle" disabled={!sel || busy} onClick={() => { const into = window.prompt(`Merge ${sel} into`, ''); if (into) op({ op: 'merge', path: sel, into }); }}>Merge</Button>
        <Button size="sm" tone="danger" icon="trash" disabled={!sel || busy} confirm={`Remove ${sel}? Only an empty category can go.`} onClick={() => op({ op: 'remove', path: sel })}>Remove</Button>
      </div>
      {error && <p className="fx-error" role="alert">{error}</p>}
      {log.length > 0 && <p className="fx-muted" role="status">{log.join('; ')}</p>}
      {paths.length === 0 ? <EmptyState icon="folder">No categories yet.</EmptyState> : (
        <ul className="axp-plan-studio__catlist" role="listbox" aria-label="Categories">
          {flat(tree).map(({ n, d }) => (
            <li key={n.path} role="option" aria-selected={sel === n.path} style={{ ['--axp-ps-depth' as string]: d }}>
              <button type="button" data-fx-row className={`axp-plan-studio__tname${sel === n.path ? ' is-on' : ''}`} onClick={() => setSel(sel === n.path ? '' : n.path)}><Icon name="folder" size={12} />{n.name}<span className="axp-plan-studio__n">{n.count} here · {n.total} in all</span></button>
            </li>
          ))}
        </ul>
      )}
      <p className="fx-muted axp-plan-studio__hint">Plans move with their category when you rename, move or merge it.</p>
    </div>
  );
}



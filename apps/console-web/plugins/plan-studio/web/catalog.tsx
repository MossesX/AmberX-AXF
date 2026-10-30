import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Icon, IconButton, Segmented, useRuntime } from '@console/axf/react';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as pc from './plan-core.mjs';
import type { CatalogEntry, CatalogFeature, FeatureState, Plan } from './plan-core.mjs';
import { call, catalog, putPlan, useStudio } from './api';

/*
 * The Catalog: every console plugin, app, framework library and module, and axHub, found automatically, each with
 * its features checked off as have / partial / planned / idea (read from plugin.json, the tracker and the feature
 * matrices; plans add what they plan). Tree with checkboxes, expandable grid, sub-grids by kind, coverage matrix.
 * "Plan this" makes a pre-filled plan; "Add to a plan" marks a feature planned on an existing plan.
 */

type Layout = 'tree' | 'grid' | 'groups' | 'matrix';
const STATE_TONE: Record<FeatureState, 'success' | 'warning' | 'accent' | undefined> = { have: 'success', partial: 'warning', planned: 'accent', idea: undefined };
const STATE_ICON: Record<FeatureState, string> = { have: 'check-circle', partial: 'minus', planned: 'clock', idea: 'sparkles' };

export function CatalogTab({ onPlan }: { onPlan: (p: Plan) => void }) {
  const rt = useRuntime();
  const { state } = useStudio();
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [err, setErr] = useState('');
  const [layout, setLayout] = useState<Layout>('grid');
  const [q, setQ] = useState('');
  const [kinds, setKinds] = useState<string[]>([]);
  const [gaps, setGaps] = useState(false);
  const [planned, setPlanned] = useState(false);
  const [showGone, setShowGone] = useState(false);
  const [target, setTarget] = useState<{ e: CatalogEntry; f: CatalogFeature } | null>(null);
  const load = () => { setErr(''); catalog().then(setEntries).catch((e) => setErr((e as Error).message)); };
  useEffect(load, [state?.plans.length]);

  const shown = useMemo(() => pc.filterCatalog(entries ?? [], { q, kinds, gaps, planned }).filter((e) => showGone || e.status !== 'gone'), [entries, q, kinds, gaps, planned, showGone]);
  const tot = useMemo(() => shown.reduce((m, e) => { for (const k of pc.FEATURE_STATES) m[k] += e.counts[k] ?? 0; m.total += e.total; return m; }, { have: 0, partial: 0, planned: 0, idea: 0, total: 0 }), [shown]);
  if (err) return <EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: load }}>{err}</EmptyState>;
  if (!entries) return <LoadingSkeleton rows={8} label="Finding every plugin, app and library" />;

  const planThis = async (e: CatalogEntry, f: CatalogFeature) => { const r = await call<{ plan: Plan }>('plan-feature', { entry: e.key, feature: f.id, title: f.title }); onPlan(r.plan); };
  const addTo = async (planId: string) => {
    if (!target) return;
    const r = await call<{ ok: boolean; plan: Plan }>('feature', { plan: planId, entry: target.e.key, feature: target.f.id, title: target.f.title, state: 'planned' });
    if (r.plan) putPlan(r.plan);
    rt.toast(`${target.f.title} is planned on ${r.plan?.title ?? planId}`, 'success'); setTarget(null); load();
  };
  const props = { onPlanThis: planThis, onAddTo: (e: CatalogEntry, f: CatalogFeature) => setTarget({ e, f }), onOpenPlan: (id: string) => { const p = state?.plans.find((x) => x.id === id); if (p) onPlan(p); } };

  return (
    <div className="fx-stack axp-plan-studio__catalog">
      <div className="axp-plan-studio__strip" aria-label="Coverage">
        <span><b>{shown.length}</b> entries</span><span><b>{tot.total}</b> features</span>
        {pc.FEATURE_STATES.map((s) => <span key={s}><b>{tot[s]}</b> {s}</span>)}
        <span><b>{tot.total ? Math.round(((tot.have + tot.partial / 2) / tot.total) * 100) : 0}%</b> covered</span>
      </div>
      <div className="axp-plan-studio__tools" role="toolbar" aria-label="Catalog view and filters">
        <label className="fx-search axp-plan-studio__search"><Icon name="search" size={13} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plugins, apps, features…" aria-label="Search the catalog" /></label>
        <Segmented size="sm" label="Layout" value={layout} onChange={setLayout} options={[{ value: 'tree', label: 'Tree' }, { value: 'grid', label: 'Grid' }, { value: 'groups', label: 'Sub-grids' }, { value: 'matrix', label: 'Coverage' }]} />
        <IconButton icon="refresh" label="Look again (new plugins and apps appear by themselves)" onClick={load} />
      </div>
      <div className="axp-plan-studio__chips" role="group" aria-label="Filters">
        {pc.CATALOG_KINDS.map((k) => { const n = entries.filter((e) => e.kind === k.id && e.status !== 'gone').length; return n ? <Button key={k.id} size="sm" icon={k.icon} tone={kinds.includes(k.id) ? 'primary' : 'quiet'} aria-pressed={kinds.includes(k.id)} onClick={() => setKinds((x) => (x.includes(k.id) ? x.filter((y) => y !== k.id) : [...x, k.id]))}>{k.label} <span className="axp-plan-studio__n">{n}</span></Button> : null; })}
        <Button size="sm" icon="alert" tone={gaps ? 'primary' : 'quiet'} aria-pressed={gaps} onClick={() => setGaps(!gaps)}>Gaps</Button>
        <Button size="sm" icon="clock" tone={planned ? 'primary' : 'quiet'} aria-pressed={planned} onClick={() => setPlanned(!planned)}>Planned</Button>
        {entries.some((e) => e.status === 'gone') && <Button size="sm" icon="x-circle" tone={showGone ? 'primary' : 'quiet'} aria-pressed={showGone} onClick={() => setShowGone(!showGone)}>Gone</Button>}
      </div>
      {target && (
        <div className="axp-plan-studio__diff" role="dialog" aria-label="Add to a plan">
          <p className="axp-plan-studio__difftitle">Plan “{target.f.title}” ({target.e.name}) on:</p>
          <ul className="axp-plan-studio__pick">{(state?.plans ?? []).filter((p) => !['done', 'dropped'].includes(p.status)).map((p) => <li key={p.id}><button type="button" className="fx-btn fx-btn--quiet fx-btn--sm" onClick={() => void addTo(p.id)}>{p.title}</button></li>)}</ul>
          <div className="fx-row"><Button size="sm" icon="plus" onClick={() => { void planThis(target.e, target.f); setTarget(null); }}>A new plan instead</Button><Button size="sm" tone="quiet" icon="x" onClick={() => setTarget(null)}>Cancel</Button></div>
        </div>
      )}
      {shown.length === 0 ? <EmptyState icon="search">Nothing matches.</EmptyState>
        : layout === 'matrix' ? <Coverage entries={shown} />
        : layout === 'groups' ? pc.CATALOG_KINDS.map((k) => { const es = shown.filter((e) => e.kind === k.id); return es.length ? <section key={k.id} className="axp-plan-studio__sub"><h3 className="axp-plan-studio__subh"><Icon name={k.icon} size={12} /><b>{k.label}</b><span className="axp-plan-studio__n">{es.length}</span></h3><ul className="axp-plan-studio__grid">{es.map((e) => <EntryRow key={e.key} e={e} {...props} />)}</ul></section> : null; })
        : layout === 'tree' ? <ul className="axp-plan-studio__tree">{pc.CATALOG_KINDS.map((k) => { const es = shown.filter((e) => e.kind === k.id); return es.length ? <KindNode key={k.id} label={k.label} icon={k.icon} entries={es} {...props} /> : null; })}</ul>
        : <ul className="axp-plan-studio__grid">{shown.map((e) => <EntryRow key={e.key} e={e} {...props} />)}</ul>}
    </div>
  );
}

type RowProps = { onPlanThis: (e: CatalogEntry, f: CatalogFeature) => void; onAddTo: (e: CatalogEntry, f: CatalogFeature) => void; onOpenPlan: (id: string) => void };

function KindNode({ label, icon, entries, ...rest }: { label: string; icon: string; entries: CatalogEntry[] } & RowProps) {
  const [open, setOpen] = useState(true);
  return (
    <li className="axp-plan-studio__tnode">
      <button type="button" data-fx-row className="axp-plan-studio__tname" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} /><Icon name={icon} size={12} />{label}<span className="axp-plan-studio__n">{entries.length}</span></button>
      {open && <ul>{entries.map((e) => <EntryRow key={e.key} e={e} tree {...rest} />)}</ul>}
    </li>
  );
}

function EntryRow({ e, tree, onPlanThis, onAddTo, onOpenPlan }: { e: CatalogEntry; tree?: boolean } & RowProps) {
  const [open, setOpen] = useState(false);
  const [fs, setFs] = useState<'all' | FeatureState>('all');
  const feats = e.features.filter((f) => fs === 'all' || f.state === fs);
  return (
    <li className={`axp-plan-studio__row${open ? ' is-open' : ''}${e.status === 'gone' ? ' is-gone' : ''}`}>
      <div className="axp-plan-studio__rline">
        <button type="button" data-fx-row className="axp-plan-studio__rmain" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
          {!tree && <Icon name={pc.CATALOG_KINDS.find((k) => k.id === e.kind)?.icon ?? 'box'} size={12} />}
          <span className="axp-plan-studio__rtitle">{e.name}{e.kind === 'app' && <span className="fx-muted"> · {e.id}</span>}</span>
          <span className="axp-plan-studio__rmeta">{e.version && <span>v{e.version}</span>}<span>{e.counts.have}/{e.total}</span>{e.counts.planned > 0 && <span>{e.counts.planned} planned</span>}</span>
          <span className="axp-plan-studio__bar" aria-label={`${e.progress}% have`}><span style={{ width: `${e.progress}%` }} /></span>
        </button>
        {e.status !== 'built' && <Chip tone={e.status === 'gone' ? 'danger' : 'accent'}>{e.status}</Chip>}
      </div>
      {open && (
        <div className="axp-plan-studio__pane">
          {e.description && <p className="axp-plan-studio__desc">{e.description}</p>}
          <p className="fx-muted axp-plan-studio__hint">{[e.kind, e.key, e.folder].filter(Boolean).join(' · ')}{e.plans.length > 0 && <> · plans: {e.plans.map((id) => <button key={id} type="button" className="fx-btn fx-btn--quiet fx-btn--sm" onClick={() => onOpenPlan(id)}>{id}</button>)}</>}</p>
          {e.links.length > 0 && <p className="axp-plan-studio__hint">{e.links.map((l, i) => (/^https?:/.test(l.ref) ? <a key={i} href={l.ref} target="_blank" rel="noreferrer">{l.label || l.ref}</a> : <span key={i} className="fx-mono">{l.label}: {l.ref} </span>))}</p>}
          {e.total > 0 && <Segmented size="sm" label="Features" value={fs} onChange={setFs} options={[{ value: 'all', label: `All ${e.total}` }, ...pc.FEATURE_STATES.filter((s) => e.counts[s]).map((s) => ({ value: s, label: `${s} ${e.counts[s]}` }))]} />}
          <ul className="axp-plan-studio__feats">
            {feats.slice(0, 120).map((f) => (
              <li key={f.id}>
                <input type="checkbox" className="fx-check" checked={f.state === 'have'} readOnly aria-label={`${f.title}: ${f.state}`} />
                <span className="axp-plan-studio__ftitle">{f.title}</span>
                <Chip tone={STATE_TONE[f.state]}><Icon name={STATE_ICON[f.state]} size={10} /> {f.state}</Chip>
                {f.plan ? <button type="button" className="fx-btn fx-btn--quiet fx-btn--sm" onClick={() => onOpenPlan(f.plan!)} title={f.planTitle}>{f.build ? 'build' : 'plan'}</button>
                  : f.state !== 'have' && <span className="axp-plan-studio__fact"><Button size="sm" tone="quiet" icon="plus" onClick={() => onPlanThis(e, f)}>Plan this</Button><IconButton icon="layers" label="Add to a plan" onClick={() => onAddTo(e, f)} /></span>}
              </li>
            ))}
            {feats.length > 120 && <li className="fx-muted">…{feats.length - 120} more (filter above)</li>}
          </ul>
          <div className="fx-row"><Button size="sm" icon="plus" onClick={() => onAddTo(e, { id: '', title: window.prompt(`New feature for ${e.name}`) || '', state: 'idea', source: 'plan' })}>Add a planned feature</Button></div>
        </div>
      )}
    </li>
  );
}

function Coverage({ entries }: { entries: CatalogEntry[] }) {
  return (
    <div className="axp-plan-studio__matrix" role="table" aria-label="Coverage">
      <div role="row" className="axp-plan-studio__mrow is-head"><span role="columnheader">Entry</span>{pc.FEATURE_STATES.map((s) => <span key={s} role="columnheader">{s}</span>)}<span role="columnheader">%</span></div>
      {entries.map((e) => (
        <div role="row" key={e.key} className="axp-plan-studio__mrow">
          <span role="cell" className="axp-plan-studio__rtitle">{e.name}</span>
          {pc.FEATURE_STATES.map((s) => <span role="cell" key={s} className={`axp-plan-studio__mcell is-${s}${e.counts[s] ? '' : ' is-zero'}`}>{e.counts[s] || ''}</span>)}
          <span role="cell" className="axp-plan-studio__n">{e.total ? `${e.progress}%` : '–'}</span>
        </div>
      ))}
    </div>
  );
}

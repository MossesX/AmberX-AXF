import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Container, Icon, ModelBadge, Segmented, SelectField, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import * as fm from './fm-core.mjs';
import { clearFocus, FOLDER, KEYS, useFocus, VIEW } from './focus';
import './feature-matrix.css';

/*
 * Feature matrix page (feature-matrix@1). One dataset of every build's matrix, shown as a grid of expandable rows
 * (row = build: profile, date added, time cost of the kept items, kept / skipped, needs apply, last applied; newest
 * first). A row opens to its matrix: groups of items, tick = keep, untick = skip, add an item, edit inline, totals with
 * the Fable / Opus split, the history drawer, and Apply (lit while version > appliedVersion) with its what-changed
 * report. Nothing is ever deleted. Every rule is the framework's (framework/plan/feature-matrix-core.mjs).
 */

const api = pluginApi(FOLDER, 'Feature matrix', { unavailable: 'The feature matrix is switched off or its server part is not running.' });
type Report = { matrix: string; version: number; keptMinutes: number; skippedMinutes: number; targets: string[]; perTarget: Record<string, number>; changes: { target: string; id: string; path: string; from: unknown; to: unknown }[]; summary: string; at: string };
type StateRes = { ok: boolean; error?: string; active: string; profiles: { id: string; name: string }[]; files: Record<string, string>; state: fm.State; rows: fm.Row[]; reports: Report[] };
type ActRes = { ok: boolean; error?: string; matrix?: fm.Matrix; log?: string[]; report?: Report };
type Act = (path: 'act' | 'seed' | 'apply' | 'import', body: Record<string, unknown>) => Promise<ActRes | null>;

const fmtDate = (v: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const mins = (n: number) => fm.formatMinutes(n) || '0 min';
const KIND_LABEL: Record<string, string> = { orchestrator: 'Orchestrator', pending: 'Pending', queue: 'Build queue', plan: 'Plan', change: 'Change log' };
const setting = (rt: ReturnType<typeof useRuntime>, k: string, d: unknown) => { try { return rt.settings.get(k) ?? d; } catch { return d; } };

/** The Builds pages' toolbar button (slot builds.toolbar). */
export function OpenMatrixButton() {
  const rt = useRuntime();
  return <Button icon="check-circle" onClick={() => rt.navigate(VIEW)} title="Every build's keep / skip feature list">Feature matrix</Button>;
}

export function FeatureMatrixPage() {
  const rt = useRuntime();
  const log = (t: string, l: 'info' | 'ok' | 'warn' | 'error' = 'info') => rt.terminal.log('feature-matrix', t, l);
  const [data, setData] = useState<StateRes | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastReport, setLastReport] = useState<Report | null>(null);
  const focus = useFocus();

  const load = async () => {
    try { const r = await api.call<StateRes>('state'); if (!r.ok) throw new Error(r.error); setData(r); setError(''); }
    catch (e) { setError((e as Error).message); setData((d) => d ?? { ok: false, active: 'main-framework', profiles: [], files: {}, state: fm.emptyState() as fm.State, rows: [], reports: [] }); }
  };
  useEffect(() => { void load(); }, []);

  const act: Act = async (path, body) => {
    setBusy(true);
    try {
      const r = await api.post<ActRes>(path, body);
      if (!r.ok) { log(r.error ?? 'failed', 'error'); rt.toast(r.error ?? 'Change failed', 'danger'); return null; }
      for (const l of r.log ?? []) log(l, 'ok');
      if (r.report) setLastReport(r.report);
      await load();
      return r;
    } catch (e) { log((e as Error).message, 'error'); rt.toast((e as Error).message, 'danger'); return null; }
    finally { setBusy(false); }
  };

  if (!data) return <LoadingSkeleton rows={4} label="Loading the feature matrices" />;
  const dirty = data.rows.filter((r) => r.dirty).length;
  return (
    <div className="fx-stack fx-stack--lg axp-feature-matrix">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Builds · {data.rows.length} matrices{dirty ? ` · ${dirty} need apply` : ''}{data.state.updatedAt ? ` · updated ${fmtTime(data.state.updatedAt)}` : ''}</p>
          <h1>Feature matrix</h1>
          <p className="fx-muted">Every build's features in one list: tick to keep, untick to skip; nothing is ever deleted, and Apply pushes the result to every table the build lives in.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" disabled={busy} onClick={() => load().then(() => log('reloaded', 'ok'))}>Reload</Button>
          <Button icon="download" disabled={busy} title="The draft matrix and a matrix for every open build of the active profile (only adds)" onClick={() => act('import', { profile: data.active })}>Import open builds</Button>
        </div>
      </header>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <MatricesGrid data={data} busy={busy} act={act} focus={focus} lastReport={lastReport} />
    </div>
  );
}

type Show = 'all' | 'dirty' | 'applied';
function MatricesGrid({ data, busy, act, focus, lastReport }: { data: StateRes; busy: boolean; act: Act; focus: ReturnType<typeof useFocus>; lastReport: Report | null }) {
  const rt = useRuntime();
  const [open, setOpen] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<GridSort>(() => ({ col: String(setting(rt, KEYS.sort, 'updated')) === 'added' ? 'added' : 'updated', dir: -1 }));
  const [show, setShow] = useState<Show>('all');
  const [profile, setProfile] = useState<string>('');
  const byId = useMemo(() => new Map(data.state.matrices.map((m) => [m.id, m])), [data]);
  // A grid's row hook asked for a matrix: open its row (the active profile when the hook didn't say)
  const wanted = focus ? (focus.id || (focus.ref ? fm.matrixId(focus.ref, focus.profile || data.active) : '')) : '';
  useEffect(() => {
    if (!wanted) return;
    if (byId.has(wanted)) {
      setOpen((o) => (o.includes(wanted) ? o : [...o, wanted]));
      requestAnimationFrame(() => document.getElementById(`axp-fm-${wanted.replace(/[^a-z0-9-]/gi, '-')}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  }, [wanted, byId]);

  const rows = data.rows.filter((r) => (show === 'dirty' ? r.dirty : show === 'applied' ? !r.dirty : true) && (!profile || r.profile === profile));
  const groups: GridGroup<fm.Row>[] = [{ id: 'all', title: profile ? (data.profiles.find((p) => p.id === profile)?.name ?? profile) : 'All matrices', icon: 'list', rows, groups: [], fixed: true, summary: `${rows.length} · ${mins(rows.reduce((t, r) => t + r.keptMinutes, 0))} kept` }];
  const cols: GridColumn<fm.Row>[] = [
    { id: 'title', label: 'Build', width: 'minmax(calc(var(--fx-font-size) * 16), calc(var(--fx-font-size) * 25))', fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(), render: (r) => <span className="axp-feature-matrix__title" id={`axp-fm-${r.id.replace(/[^a-z0-9-]/gi, '-')}`}><b>{r.title}</b><span className="fx-small fx-muted fx-mono"> {KIND_LABEL[r.ref.kind]} · {r.ref.id}</span></span> },
    { id: 'profile', label: 'Profile', width: 'calc(var(--fx-font-size) * 8)', sortable: true, sortValue: (r) => r.profile, render: (r) => <span className="fx-small">{data.profiles.find((p) => p.id === r.profile)?.name ?? r.profile}</span> },
    { id: 'added', label: 'Date added', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (r) => r.addedAt, render: (r) => <span className="fx-small" title={fmtTime(r.addedAt)}>{fmtDate(r.addedAt)}</span> },
    { id: 'cost', label: 'Time cost', width: 'calc(var(--fx-font-size) * 5)', align: 'end', sortable: true, sortValue: (r) => r.keptMinutes, render: (r) => <span className="fx-small" title={`Fable ${mins(r.byModel.Fable.keptMinutes)} · Opus ${mins(r.byModel.Opus.keptMinutes)}`}>{mins(r.keptMinutes)}</span> },
    { id: 'kept', label: 'Kept / skipped', width: 'calc(var(--fx-font-size) * 9)', sortable: true, sortValue: (r) => r.kept, render: (r) => <span className="fx-small">{r.kept} kept · {r.skipped} skipped</span> },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (r) => (r.dirty ? 1 : 0), render: (r) => r.dirty ? <Chip tone="warning">Needs apply</Chip> : r.appliedVersion > 0 ? <Chip tone="success">Applied</Chip> : <Chip>New</Chip> },
    { id: 'updated', label: 'Last applied', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (r) => r.updatedAt, render: (r) => <span className="fx-small" title={`Last change ${fmtTime(r.updatedAt)}`}>{r.appliedAt ? fmtDate(r.appliedAt) : '—'}</span> },
  ];
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const missing = wanted && !byId.has(wanted) && focus?.ref ? focus : null;
  return (
    <>
      <div className="fx-row fx-row--wrap axp-feature-matrix__bar" role="toolbar" aria-label="Show">
        <Segmented size="sm" label="Show" value={show} onChange={setShow} options={[{ value: 'all', label: 'All' }, { value: 'dirty', label: 'Needs apply' }, { value: 'applied', label: 'Applied' }]} />
        {data.profiles.length > 1 && <Segmented size="sm" label="Profile" value={profile || 'any'} onChange={(v) => setProfile(v === 'any' ? '' : v)} options={[{ value: 'any', label: 'Every profile' }, ...data.profiles.map((p) => ({ value: p.id, label: p.name }))]} />}
      </div>
      {missing && (
        <div className="pl-note axp-feature-matrix__missing">
          <Icon name="info" size={14} />
          <span className="fx-grow">{KIND_LABEL[missing.ref!.kind]} entry <b className="fx-mono">{missing.ref!.id}</b> has no feature matrix yet.</span>
          <Button tone="primary" icon="plus" disabled={busy} onClick={async () => { const r = await act('seed', { ref: missing.ref, profile: missing.profile || data.active }); if (r?.matrix) { setOpen((o) => [...o, r.matrix!.id]); clearFocus(); } }}>Make its matrix</Button>
          <Button onClick={clearFocus}>Dismiss</Button>
        </div>
      )}
      {rows.length === 0 ? <EmptyState icon="list" action={{ label: 'Import open builds', icon: 'download', onClick: () => void act('import', { profile: data.active }) }}>{show !== 'all' || profile ? 'No matrices match.' : 'No feature matrices yet.'}</EmptyState> : (
        <DataGrid<fm.Row> id="feature-matrices" label="Feature matrices" groups={groups} columns={cols} rowId={(r) => r.id} rowLabel={(r) => r.title}
          hidden={hidden} onToggleColumn={(c) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))} onShowAll={() => setHidden([])}
          sort={sort} onSort={(c) => setSort((s) => (!c ? null : s?.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: -1 }))}
          expanded={open} onToggleExpand={toggle} onRowClick={(r) => toggle(r.id)}
          rowTone={(r) => (r.dirty ? 'warning' : r.appliedVersion > 0 ? 'success' : 'muted')}
          rowCtx={(r) => ({ target: 'axf-feature-matrix', payload: r.id })}
          renderDetail={(r) => { const m = byId.get(r.id); return m ? <MatrixView m={m} busy={busy} act={act} report={lastReport?.matrix === m.id ? lastReport : data.reports.find((x) => x.matrix === m.id) ?? null} /> : null; }} />
      )}
    </>
  );
}

type Draft = { name: string; why: string; group: string; minutes: string; model: fm.Model };
const blank = (group = ''): Draft => ({ name: '', why: '', group, minutes: '', model: 'Opus' });

/** One matrix: totals, Apply, groups of items (tick = keep), add an item, edit inline, history. */
export function MatrixView({ m, busy, act, report }: { m: fm.Matrix; busy: boolean; act: Act; report: Report | null }) {
  const rt = useRuntime();
  const t = fm.totals(m);
  const [adding, setAdding] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ id: string; d: Draft } | null>(null);
  const [historyOpen, setHistoryOpen] = useState<boolean>(() => setting(rt, KEYS.history, false) === true);
  const [showReport, setShowReport] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const groups = useMemo(() => {
    const out: { label: string; items: fm.Item[] }[] = [];
    for (const it of m.items) { let g = out.find((x) => x.label === it.group); if (!g) { g = { label: it.group, items: [] }; out.push(g); } g.items.push(it); }
    return out;
  }, [m]);
  const change = (c: Record<string, unknown>) => act('act', { ...c, matrix: m.id, by: 'console' });
  const setState = (it: fm.Item, keep: boolean) => change({ action: keep ? 'keep' : 'skip', item: it.id });
  const setGroup = (g: { items: fm.Item[] }, keep: boolean) => { const todo = g.items.filter((it) => fm.isKept(it) !== keep); void (async () => { for (const it of todo) if (!(await setState(it, keep))) break; })(); };
  const save = async () => {
    if (adding && adding.name.trim()) { if (await change({ action: 'add-item', item: { name: adding.name.trim(), why: adding.why, group: adding.group, minutes: adding.minutes, model: adding.model, source: { kind: 'manual' } } })) setAdding(null); }
  };
  const saveEdit = async () => {
    if (!editing) return; const d = editing.d;
    if (await change({ action: 'edit-item', item: editing.id, data: { name: d.name, why: d.why, group: d.group, minutes: Number(d.minutes) || 0, model: d.model } })) setEditing(null);
  };
  const apply = async () => { const r = await act('apply', { matrix: m.id }); if (r?.report) { setShowReport(true); rt.toast(r.report.summary, 'success'); } };
  const groupNames = groups.map((g) => g.label).filter(Boolean);
  return (
    <div className="fx-stack axp-feature-matrix__matrix" data-fx-ctx-target="axf-feature-matrix" data-fx-ctx-payload={m.id}>
      <div className="axp-feature-matrix__totals" role="list" aria-label="Totals">
        <span role="listitem"><b>{t.kept}</b> kept · {mins(t.keptMinutes)}</span>
        <span role="listitem" className="fx-muted">{t.skipped} skipped · {mins(t.skippedMinutes)}</span>
        {fm.MODELS.map((md) => <span role="listitem" key={md}><ModelBadge model={md} compact /> {mins(t.byModel[md].keptMinutes)}</span>)}
        <span className="fx-grow" />
        <span className="fx-small fx-muted">v{m.version}{m.appliedVersion ? ` · applied v${m.appliedVersion} ${fmtDate(m.appliedAt)}` : ' · never applied'}</span>
        <Button tone={t.dirty ? 'primary' : 'neutral'} icon="check" disabled={busy || !t.dirty} onClick={apply} title={t.dirty ? 'Push totals, skips and estimates to every table this build lives in' : 'Nothing changed since the last Apply'}>Apply</Button>
      </div>
      {renaming != null ? (
        <div className="fx-row fx-row--wrap">
          <TextField label="Title" value={renaming} onChange={setRenaming} className="fx-grow" />
          <Button tone="primary" icon="save" disabled={busy || !renaming.trim()} onClick={async () => { if (await change({ action: 'rename', title: renaming })) setRenaming(null); }}>Save</Button>
          <Button onClick={() => setRenaming(null)}>Cancel</Button>
        </div>
      ) : null}
      {groups.length === 0 && <EmptyState icon="list" compact>No items yet. Add the first one below.</EmptyState>}
      {groups.map((g) => {
        const keptN = g.items.filter(fm.isKept).length;
        const gm = g.items.filter(fm.isKept).reduce((s, it) => s + it.minutes, 0);
        return (
          <Container key={g.label || '—'} collapsible title={<span>{g.label || 'Ungrouped'} <span className="fx-muted fx-small">· {keptN}/{g.items.length} kept · {mins(gm)}</span></span>} icon="folder"
            actions={<span className="fx-row"><Button size="sm" tone="quiet" disabled={busy || keptN === g.items.length} onClick={() => setGroup(g, true)}>Keep all</Button><Button size="sm" tone="quiet" disabled={busy || keptN === 0} onClick={() => setGroup(g, false)}>Skip all</Button></span>}>
            <div className="axp-feature-matrix__items" role="list">
              {g.items.map((it) => editing?.id === it.id ? (
                <ItemForm key={it.id} d={editing.d} groups={groupNames} busy={busy} onChange={(d) => setEditing({ id: it.id, d })} onSave={saveEdit} onCancel={() => setEditing(null)} label="Save" />
              ) : (
                <div key={it.id} role="listitem" className={`axp-feature-matrix__item ${fm.isKept(it) ? '' : 'is-skip'}`}>
                  <Checkbox label={<span><span className="axp-feature-matrix__name">{it.name}</span>{it.why ? <span className="fx-small fx-muted"> — {it.why}</span> : null}</span>} checked={fm.isKept(it)} disabled={busy} onChange={(v) => setState(it, v)} />
                  <span className="axp-feature-matrix__meta">
                    <span className="fx-small">{it.minutes ? mins(it.minutes) : '—'}</span>
                    <ModelBadge model={it.model} compact />
                    {it.history.some((h) => h.action === 'done') && <Chip tone="success">done</Chip>}
                    {!fm.isKept(it) && <Chip>skip</Chip>}
                    <Button size="sm" tone="quiet" icon="edit" aria-label={`Edit ${it.name}`} onClick={() => setEditing({ id: it.id, d: { name: it.name, why: it.why, group: it.group, minutes: String(it.minutes || ''), model: it.model } })}>Edit</Button>
                  </span>
                </div>
              ))}
            </div>
          </Container>
        );
      })}
      {adding ? <ItemForm d={adding} groups={groupNames} busy={busy} onChange={setAdding} onSave={save} onCancel={() => setAdding(null)} label="Add item" /> : null}
      <div className="fx-row fx-row--wrap">
        {!adding && <Button icon="plus" onClick={() => setAdding(blank(groupNames[groupNames.length - 1] ?? ''))}>Add item</Button>}
        <Button icon="file" onClick={() => setRenaming(m.title)}>Rename</Button>
        <Button icon="clock" aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>{historyOpen ? 'Hide history' : `History (${m.history.length})`}</Button>
        {report && <Button icon="list" aria-expanded={showReport} onClick={() => setShowReport((o) => !o)}>{showReport ? 'Hide last Apply' : 'Last Apply'}</Button>}
      </div>
      {showReport && report && <ApplyReport r={report} />}
      {historyOpen && (
        <div className="pd-thread axp-feature-matrix__history" role="list" aria-label="History">
          {[...m.history].reverse().map((h, i) => (
            <div key={i} role="listitem" className="pd-entry"><time dateTime={h.at}>{fmtTime(h.at)}</time><p>{h.action}{h.item ? <> · <span className="fx-mono">{h.item}</span></> : null}{h.from != null || h.to != null ? <span className="fx-muted"> {h.from ?? ''}{h.from != null && h.to != null ? ' → ' : ''}{h.to ?? ''}</span> : null}{h.by ? <span className="fx-muted"> · {h.by}</span> : null}</p></div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemForm({ d, groups, busy, onChange, onSave, onCancel, label }: { d: Draft; groups: string[]; busy: boolean; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; label: string }) {
  return (
    <div className="fx-stack axp-feature-matrix__form" role="group" aria-label={label}>
      <TextField label="Feature" value={d.name} onChange={(name) => onChange({ ...d, name })} autoFocus />
      <TextField label="Why" value={d.why} onChange={(why) => onChange({ ...d, why })} />
      <div className="axp-feature-matrix__two">
        <TextField label={groups.length ? `Group (${groups.slice(0, 3).join(', ')}${groups.length > 3 ? '…' : ''})` : 'Group'} value={d.group} onChange={(group) => onChange({ ...d, group })} />
        <TextField label="Minutes" value={d.minutes} onChange={(minutes) => onChange({ ...d, minutes: minutes.replace(/[^0-9]/g, '') })} />
        <SelectField label="Model" value={d.model} options={fm.MODELS.map((x) => ({ value: x, label: x }))} onChange={(v) => onChange({ ...d, model: v as fm.Model })} />
      </div>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="save" disabled={busy || !d.name.trim()} onClick={onSave}>{label}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

const TARGET_LABEL: Record<string, string> = { build: 'Orchestrator', pending: 'Pending list', queue: 'Build queue', change: 'Change log', feature: 'Plan' };
function ApplyReport({ r }: { r: Report }) {
  return (
    <div className="pd-thread axp-feature-matrix__report" aria-label="What Apply changed">
      <h3>What changed · {fmtTime(r.at)}</h3>
      <p className="fx-small">{r.summary}</p>
      {r.targets.length === 0 && <p className="fx-small fx-muted">This build isn't in any table yet, so there was nothing to update.</p>}
      {r.changes.length > 0 && (
        <ul className="fx-small axp-feature-matrix__changes">
          {r.changes.slice(0, 200).map((c, i) => <li key={i}><b>{TARGET_LABEL[c.target] ?? c.target}</b> <span className="fx-mono">{c.id} · {c.path}</span> <span className="fx-muted">{JSON.stringify(c.from)} → {JSON.stringify(c.to)}</span></li>)}
        </ul>
      )}
      {r.changes.length > 200 && <p className="fx-small fx-muted">…and {r.changes.length - 200} more.</p>}
    </div>
  );
}

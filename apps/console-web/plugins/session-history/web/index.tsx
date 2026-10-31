/**
 * Session browser console plugin (ai.amberx.axf.console.session-history).
 *
 * Every Claude Code session, headless run and agent-swarm run in one live grid (polled every few seconds with the
 * store's stamp, so an unchanged store costs one tiny request). Rows collapse like every other grid; sort by any
 * column, search, filter by kind, status and model. The run store is the server part (server/runs.py).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, IconButton, ModelBadge, Segmented } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { facets, totals, fmtDuration, fmtTokens, fmtUsd, fmtWhen, KIND_LABEL, nextSort, STATUS_LABEL, statusTone, view, type Filter, type Kind, type Run, type Sort, type SortKey } from './core';
import { RunDetail } from './detail';
import { SourcesPanel } from './settings';
import { appMenu } from './menu';
import './session-history.css';

export const FOLDER = 'session-history';
const ID = 'ai.amberx.axf.console.session-history';
const VIEW = 'session-history';
const POLL_MS = 3000;

/** The live list: polls `runs?since=<stamp>` while the page is visible; the server answers "unchanged" cheaply. */
function useRuns(): { runs: Run[] | null; error: string; live: boolean; setLive: (v: boolean) => void; reload: () => void } {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const stamp = useRef('');
  const tick = useRef(0);
  const load = async () => {
    const n = ++tick.current;
    try {
      const r = await pluginFetch(FOLDER, `runs${stamp.current ? `?since=${encodeURIComponent(stamp.current)}` : ''}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { stamp: string; changed: boolean; runs?: Run[] };
      if (n !== tick.current) return;
      stamp.current = j.stamp;
      if (j.changed && j.runs) setRuns(j.runs);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRuns((x) => x ?? []);
    }
  };
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (live && document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [live]);
  return { runs, error, live, setLive, reload: () => { stamp.current = ''; void load(); } };
}

const COLS: { key: SortKey; label: string; wide?: boolean; num?: boolean }[] = [
  { key: 'title', label: 'Run' },
  { key: 'agent', label: 'Agent', wide: true },
  { key: 'build', label: 'Build', wide: true },
  { key: 'job', label: 'Job', wide: true },
  { key: 'model', label: 'Model', wide: true },
  { key: 'status', label: 'Status' },
  { key: 'tokens', label: 'Tokens', wide: true, num: true },
  { key: 'usd', label: 'Cost', num: true },
  { key: 'duration', label: 'Duration', wide: true, num: true },
  { key: 'started', label: 'Started', wide: true },
];

export function costTitle(r: Run): string {
  if (r.costFrom === 'result') return 'Exact total from the run’s result (Anthropic usage)';
  if (r.costFrom === 'report') return 'Total from the agent-run report';
  if (r.costFrom === 'usage') return 'Sum of every turn’s token usage at model-pricing@1 prices';
  return 'No usage recorded';
}

function BrowserView() {
  const { runs, error, live, reload, setLive } = useRuns();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [status, setStatus] = useState('all');
  const [model, setModel] = useState('all');
  const [sort, setSort] = useState<Sort>({ key: 'started', dir: -1 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(200);
  const filter: Filter = { q, kind, status, model };
  const rows = useMemo(() => (runs ? view(runs, filter, sort) : []), [runs, q, kind, status, model, sort]);
  const fac = useMemo(() => facets(runs ?? []), [runs]);
  const running = useMemo(() => (runs ?? []).filter((r) => r.status === 'running').length, [runs]);
  const sum = useMemo(() => totals(rows), [rows]);
  const toggle = (id: string) => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  return (
    <div className="fx-stack axp-session-history">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Builds{runs ? ` · ${rows.length} of ${runs.length} runs · ${running} running` : ' · loading…'}</p>
          <h1>Session browser</h1>
          <p className="fx-muted axp-session-history__lede">Every Claude session and agent run, live.</p>
        </div>
        <div className="axp-session-history__headbtns">
          <IconButton icon={live ? 'pause' : 'play'} label={live ? 'Pause live updates' : 'Resume live updates'} onClick={() => setLive(!live)} />
          <IconButton icon="refresh" label="Reload" onClick={reload} />
        </div>
      </header>
      <div className="axp-session-history__bar" role="toolbar" aria-label="Filter runs">
        <input className="fx-input axp-session-history__search" type="search" placeholder="Search title, agent, build, branch, model…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <Segmented label="Kind" size="sm" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'session', label: 'Sessions' }, { value: 'headless', label: 'Headless' }, { value: 'agent', label: 'Agents' }]} />
        <select className="fx-input axp-session-history__pick" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">Any status</option>{fac.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
        </select>
        <select className="fx-input axp-session-history__pick" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
          <option value="all">Any model</option>{fac.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <IconButton icon="chevron-up" label="Collapse all" onClick={() => setOpen(new Set())} disabled={!open.size} />
      </div>
      {error ? <p className="fx-small fx-muted">Couldn’t reach the run store ({error}); showing the last list.</p> : null}
      {!runs ? <p className="fx-empty">Loading…</p> : !rows.length ? <p className="fx-empty">{runs.length ? 'Nothing matches.' : 'No runs found yet. Check the folders in Settings → Plugins → Session browser.'}</p> : null}
      {rows.length ? (
        <div className="fx-tablewrap axp-session-history__table"><table className="fx-table">
          <thead><tr>
            <th aria-label="Expand" />
            {COLS.map((c) => (
              <th key={c.key} className={`${c.wide ? 'axp-session-history__wide' : ''}${c.num ? ' axp-session-history__num' : ''}`} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="axp-session-history__sort" onClick={() => setSort((s) => nextSort(s, c.key))}>{c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const isOpen = open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr data-fx-row onClick={() => toggle(r.id)} aria-expanded={isOpen} data-axp-status={r.status}>
                    <td><IconButton icon={isOpen ? 'chevron-down' : 'chevron-right'} label={isOpen ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(r.id); }} /></td>
                    <td className="axp-session-history__name">
                      <strong title={r.title}>{r.title}</strong>
                      <span className="fx-small fx-muted axp-session-history__meta">{KIND_LABEL[r.kind as Kind] ?? r.kind}{r.agent ? ` · ${r.agent}` : ''}{r.build ? ` · ${r.build}` : ''} · {fmtWhen(r.startedAt)} · {fmtTokens(r.tokensTotal)} tok · {fmtDuration(r.durationMs)}</span>
                    </td>
                    <td className="axp-session-history__wide fx-small">{r.agent || <span className="fx-muted">{KIND_LABEL[r.kind as Kind] ?? r.kind}</span>}</td>
                    <td className="axp-session-history__wide fx-small">{r.build || <span className="fx-muted">—</span>}</td>
                    <td className="axp-session-history__wide fx-small">{r.job || <span className="fx-muted">—</span>}</td>
                    <td className="axp-session-history__wide">{r.model ? <ModelBadge model={r.model} compact /> : <span className="fx-muted fx-small">—</span>}</td>
                    <td><Chip tone={statusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</Chip></td>
                    <td className="axp-session-history__wide axp-session-history__num fx-small" title={`${r.tokensTotal.toLocaleString()} tokens`}>{fmtTokens(r.tokensTotal)}</td>
                    <td className="axp-session-history__num fx-small" title={costTitle(r)}>{fmtUsd(r.usd)}</td>
                    <td className="axp-session-history__wide axp-session-history__num fx-small">{fmtDuration(r.durationMs)}</td>
                    <td className="axp-session-history__wide fx-small" style={{ whiteSpace: 'nowrap' }}>{fmtWhen(r.startedAt)}</td>
                  </tr>
                  {isOpen ? (
                    <tr><td className="axp-session-history__wide" /><td colSpan={COLS.length} className="axp-session-history__detail"><RunDetail run={r} /></td></tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table></div>
      ) : null}
      {rows.length ? (
        <footer className="axp-session-history__totals" aria-label="Totals of the shown runs">
          <div className="axp-session-history__total">
            <strong>Total</strong>
            <span className="fx-small">{sum.runs} runs{sum.running ? ` · ${sum.running} running` : ''} · {fmtTokens(sum.tokens)} tokens</span>
            <strong className="axp-session-history__num" title={sum.unpriced ? `${sum.unpriced} runs have no usage recorded` : 'Sum of every shown run’s cost'}>{fmtUsd(sum.usd)}{sum.unpriced ? ' +?' : ''}</strong>
          </div>
          {sum.byModel.map((m) => (
            <div key={m.model} className="axp-session-history__total fx-small">
              <span>{m.model === 'unknown' ? <span className="fx-muted">unknown model</span> : <ModelBadge model={m.model} compact />}</span>
              <span className="fx-muted">{m.runs} runs · {m.turns} turns · {fmtTokens(m.tokens)} tokens</span>
              <span className="axp-session-history__num">{fmtUsd(m.usd)}</span>
            </div>
          ))}
        </footer>
      ) : null}
      {rows.length > limit ? <Button size="sm" onClick={() => setLimit((l) => l + 200)}>Show more ({rows.length - limit} left)</Button> : null}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Session browser',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('session-history.open', () => rt.navigate(VIEW), { label: 'Open the session browser' });
  },
  views: { [VIEW]: { title: 'Session browser', icon: 'terminal', keywords: ['sessions', 'runs', 'agents', 'headless', 'history', 'tokens', 'cost', 'swarm'], render: () => <BrowserView /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Session browser', icon: 'terminal', view: VIEW }] },
  contextMenu: [{ id: 'session-history.default', target: 'default', order: 94, items: [{ id: 'session-history', label: 'Session browser', icon: 'terminal', action: 'session-history.open' }] }],
  settingsTabs: [{ id: 'session-history', label: 'Session browser', icon: 'terminal', parent: 'plugins', order: 46, description: 'Every Claude session and agent run, live.' }],
  settingsPanels: [
    { id: 'session-history.sources', tab: 'session-history', title: 'Where runs are read from', icon: 'folder', order: 10, render: () => <SourcesPanel /> },
    { id: 'session-history.lifecycle', tab: 'session-history', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

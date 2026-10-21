/*
 * Build manager — Sessions: the session archive (session-archive@1). Every Claude session on Brett's projects (Claude
 * Code on the VPS, in containers, in the cloud; claude.ai chats), with what ran it (host, container, app, device, how
 * he got there), every prompt with its tokens and cost, the files, change entries and features each prompt touched,
 * and the cost record: what each build cost from those prompts. Server: GET …/sessions, …/sessions/<id>, …/costs.
 * Theme tokens only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import type { Aggregate, CostRecordResult, SessionPrompt, SessionRecord, SessionSummary } from '@console/axf/plan/session-archive-core.mjs';
import { money } from './history.mjs';

const api = pluginApi('build-manager', 'The build manager plugin');

interface ListReply { sessions: SessionSummary[]; more: number; aggregate: Aggregate; totals: Aggregate['totals'] }
const DAYS = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All time']] as const;
const GROUPS = [['project', 'Project'], ['surface', 'Where it ran'], ['app', 'App / device'], ['model', 'Model'], ['source', 'Source'], ['day', 'Day']] as const;
const SURFACE_ICON: Record<string, string> = { 'claude-ai': 'smartphone', 'claude-code-cloud': 'cloud', 'vps-claude-code': 'terminal', 'claude-code': 'terminal', headless: 'box', ide: 'code', desktop: 'monitor' };

const KV_LABEL: Record<string, string> = { host: 'Host', container: 'Container', app: 'App', appVersion: 'Version', entrypoint: 'Entry point', surface: 'Where it ran', device: 'Device', via: 'How he got there', os: 'System', cwd: 'Folder', repo: 'Repo', branch: 'Branch', url: 'Link' };
const num = (n: number | undefined) => (n == null ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const when = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
const cost = (v: number | undefined, est?: boolean) => `${est ? '~' : ''}${money(v ?? 0)}`;
const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2');

function Badge({ icon, children, tone, title }: { icon?: string; children: React.ReactNode; tone?: string; title?: string }) {
  return <span className={`axp-build-manager__badge${tone ? ` is-${tone}` : ''}`} title={title}>{icon && <Icon name={icon} size={11} />}{children}</span>;
}

function PromptRow({ p, onChange, onFeature }: { p: SessionPrompt; onChange: (id: string) => void; onFeature: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const tools = Object.entries(p.tools ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <li className={`axp-build-manager__p${p.kind !== 'prompt' ? ' is-aux' : ''}`}>
      <button type="button" className="axp-build-manager__p-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="axp-build-manager__p-n">{p.i}</span>
        <span className="axp-build-manager__p-text">{p.kind !== 'prompt' && <Badge tone="muted">{p.kind}</Badge>}{p.text}</span>
        <span className="axp-build-manager__p-cost" title={p.costEstimated ? 'Estimated from the text' : 'From the token counts'}>{cost(p.costUsd, p.costEstimated)}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
      </button>
      {open && (
        <div className="axp-build-manager__p-body">
          <div className="axp-build-manager__chips">
            <Badge icon="clock">{new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {p.seconds >= 60 ? `${Math.round(p.seconds / 60)} min` : `${p.seconds}s`}</Badge>
            {p.model && <Badge icon="sliders">{shortModel(p.model)}</Badge>}
            <Badge title="Input tokens (new)">in {num(p.tokens.input)}</Badge>
            <Badge title="Output tokens (thinking included)">out {num(p.tokens.output)}{p.tokens.thinking ? ` (${num(p.tokens.thinking)} thinking)` : ''}</Badge>
            <Badge tone="muted" title="Cache reads / writes">cache {num(p.tokens.cacheRead)} / {num(p.tokens.cacheWrite)}</Badge>
            {p.commands > 0 && <Badge icon="terminal">{p.commands} commands</Badge>}
            {p.costNote && <Badge tone="warn" title={p.costNote}>part unpriced</Badge>}
          </div>
          {tools.length > 0 && <p className="fx-small fx-muted axp-build-manager__p-line"><strong>Tools</strong> {tools.slice(0, 12).map(([n, c]) => `${n.replace(/^mcp__/, '').replace(/__/g, ' · ')} ×${c}`).join(', ')}</p>}
          {p.files.length > 0 && <p className="fx-small axp-build-manager__p-line"><strong>Files changed</strong> {p.files.slice(0, 30).map((f) => <code key={f}>{f}</code>)}{p.files.length > 30 ? ` +${p.files.length - 30}` : ''}</p>}
          {(p.changeIds.length > 0 || p.features.length > 0) && (
            <div className="axp-build-manager__chips">
              {p.changeIds.map((c) => <button key={c} type="button" className="axp-build-manager__act" onClick={() => onChange(c)}><Icon name="list" size={11} />{c}</button>)}
              {p.features.map((f) => <button key={f} type="button" className="axp-build-manager__act" onClick={() => onFeature(f)}><Icon name="layers" size={11} />{f}</button>)}
            </div>
          )}
          {p.output && <blockquote className="axp-build-manager__p-out"><strong>Reply</strong> {p.output}</blockquote>}
        </div>
      )}
    </li>
  );
}

function SessionDetail({ id, onChange, onFeature }: { id: string; onChange: (id: string) => void; onFeature: (key: string) => void }) {
  const [r, setR] = useState<SessionRecord | null>(null);
  const [err, setErr] = useState('');
  const [aux, setAux] = useState(false);
  useEffect(() => { api.call<{ session: SessionRecord }>(`sessions/${encodeURIComponent(id)}`).then((x) => setR(x.session)).catch((e: Error) => setErr(e.message)); }, [id]);
  if (err) return <p className="fx-small axp-build-manager__error">{err}</p>;
  if (!r) return <p className="fx-small fx-muted">Loading the session…</p>;
  const sys = Object.entries(r.system).filter(([, v]) => v);
  const t = r.totals;
  const prompts = aux ? r.prompts : r.prompts.filter((p) => p.kind === 'prompt' || p.kind === 'start');
  return (
    <div className="axp-build-manager__s-body">
      <dl className="axp-build-manager__kv">
        {sys.map(([k, v]) => <div key={k}><dt>{KV_LABEL[k] ?? k}</dt><dd>{k === 'url' ? <a href={String(v)} target="_blank" rel="noopener noreferrer">{String(v)}</a> : String(v)}</dd></div>)}
        <div><dt>User</dt><dd>{r.user}</dd></div>
        <div><dt>Models</dt><dd>{r.models.map(shortModel).join(', ') || '—'}</dd></div>
        <div><dt>Tokens</dt><dd>in {num(t.input)} · out {num(t.output)} · cache {num(t.cacheRead)} / {num(t.cacheWrite)}</dd></div>
        <div><dt>Cost</dt><dd>{cost(t.costUsd, t.costEstimated)}{t.reportedUsd != null ? ` (Claude Code reported ${money(t.reportedUsd)})` : ''} · {r.costSource}</dd></div>
        <div><dt>Tools</dt><dd>{t.toolCalls} calls · {t.commands} commands · {t.filesTouched} files · {r.subagents} subagent lines</dd></div>
      </dl>
      {r.notes?.length > 0 && <p className="fx-small fx-muted">{r.notes.join(' ')}</p>}
      <div className="axp-build-manager__chips">
        <Badge icon="type">{t.prompts} prompts</Badge>
        {r.prompts.length > t.prompts && <button type="button" className="axp-build-manager__act" onClick={() => setAux(!aux)}>{aux ? 'Prompts only' : `Show background turns too (${r.prompts.length - t.prompts})`}</button>}
      </div>
      <ol className="axp-build-manager__ps">{prompts.map((p) => <PromptRow key={p.i} p={p} onChange={onChange} onFeature={onFeature} />)}</ol>
    </div>
  );
}

function CostsView({ project, onChange }: { project: string; onChange: (id: string) => void }) {
  const [c, setC] = useState<CostRecordResult | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string>('');
  useEffect(() => { setC(null); api.call<CostRecordResult>(`costs${project ? `?project=${encodeURIComponent(project)}` : ''}`).then(setC).catch((e: Error) => setErr(e.message)); }, [project]);
  if (err) return <p className="fx-small axp-build-manager__error">{err}</p>;
  if (!c) return <div className="fx-empty">Working out the costs…</div>;
  return (
    <section aria-label="Cost record">
      <p className="fx-small fx-muted">Each prompt's cost goes to the build entries it worked on (else the last one its session named), and each entry's to its build. {money(c.totals.linkedUsd)} of {money(c.totals.costUsd)} is linked to a build{c.totals.fromLogUsd ? ` (${money(c.totals.fromLogUsd)} from build-log entries no archived session covers)` : ''}{c.totals.estimatedUsd ? `; ${money(c.totals.estimatedUsd)} is estimated from chat text` : ''}.</p>
      <ul className="axp-build-manager__list">
        {c.builds.map((b) => (
          <li key={b.build} className="axp-build-manager__row">
            <button type="button" className="axp-build-manager__head" aria-expanded={open === b.build} onClick={() => setOpen(open === b.build ? '' : b.build)}>
              <span className="axp-build-manager__title-line"><span className="axp-build-manager__title">{b.title || b.build}</span></span>
              <span className="axp-build-manager__chips">
                <Badge icon="zap" tone={b.costEstimatedUsd >= b.costUsd && b.costUsd ? undefined : 'ok'}>{money(b.costUsd)}</Badge>
                {b.estimateUsd != null && <Badge tone={b.overUsd != null && b.overUsd > 0 ? 'warn' : 'ok'} title="Against the estimate on its build entries">est {money(b.estimateUsd)} ({b.overUsd != null && b.overUsd > 0 ? '+' : ''}{money(b.overUsd)})</Badge>}
                <Badge tone="muted">{b.prompts} prompts · {b.sessions.length} sessions</Badge>
                {b.build !== '(not linked)' && <Badge tone="muted">{b.build}</Badge>}
                {b.fromLog > 0 && <Badge tone="muted" title="No archived session worked on it: the build log's own actual cost, else its estimate">from the build log</Badge>}
              </span>
            </button>
            {open === b.build && (
              <ul className="axp-build-manager__steps">
                {c.changes.filter((x) => b.changes.includes(x.change)).map((x) => (
                  <li key={x.change} className="axp-build-manager__step">
                    <span className="axp-build-manager__step-text">{x.title}</span>
                    <span className="axp-build-manager__chips">
                      <Badge icon="zap">{money(x.costUsd)}</Badge>
                      <Badge tone="muted">in {num(x.tokens.input)} · out {num(x.tokens.output)} · cache {num(x.tokens.cacheRead)}</Badge>
                      {x.change.startsWith('chg-') && <button type="button" className="axp-build-manager__act" onClick={() => onChange(x.change)}><Icon name="list" size={11} />Entry</button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SessionsView({ query, onCount }: { query: string; onCount?: (n: number) => void }) {
  const rt = useRuntime();
  const [mode, setMode] = useState<'sessions' | 'costs'>('sessions');
  const [project, setProject] = useState('');
  const [surface, setSurface] = useState('');
  const [model, setModel] = useState('');
  const [days, setDays] = useState<number>(0);
  const [feature, setFeature] = useState('');
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>('project');
  const [limit, setLimit] = useState(100);
  const [v, setV] = useState<ListReply | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState('');
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const p = new URLSearchParams({ limit: String(limit) });
    if (project) p.set('project', project); if (surface) p.set('surface', surface); if (model) p.set('model', model); if (feature) p.set('feature', feature);
    if (days) p.set('since', new Date(Date.now() - days * 86400_000).toISOString());
    if (query.trim()) p.set('q', query.trim().slice(0, 200));
    const t = setTimeout(() => api.call<ListReply>(`sessions?${p}`).then((r) => { if (n === seq.current) { setV(r); setErr(''); onCount?.(r.totals.sessions); } }).catch((e: Error) => { if (n === seq.current) setErr(e.message); }), 200);
    return () => clearTimeout(t);
  }, [project, surface, model, days, feature, query, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = v?.aggregate;
  const groupRows = useMemo(() => Object.entries(a?.groups[group] ?? {}).sort((x, y) => (group === 'day' ? (x[0] < y[0] ? 1 : -1) : y[1].costUsd - x[1].costUsd)).slice(0, 12), [a, group]);
  const projects = Object.keys(v?.aggregate.groups.project ?? {});
  const openChange = (id: string) => (rt.actions.get('codebase-changes.open') ? rt.dispatch(`codebase-changes.open:${id}`) : rt.toast(id, 'info'));
  return (
    <section className="axp-build-manager__sessions" aria-label="Sessions">
      <div className="axp-build-manager__totals" role="list" aria-label="Session totals">
        <div role="listitem" className="axp-build-manager__total is-all"><span className="axp-build-manager__total-label">Sessions</span><strong>{a?.totals.sessions ?? '…'}</strong><span className="fx-small fx-muted">{a ? `${a.totals.prompts} prompts` : ''}</span></div>
        <div role="listitem" className="axp-build-manager__total"><span className="axp-build-manager__total-label">Cost</span><strong>{a ? money(a.totals.costUsd) : '…'}</strong><span className="fx-small fx-muted">{a?.totals.estimatedUsd ? `${money(a.totals.estimatedUsd)} estimated` : 'from token counts'}</span></div>
        <div role="listitem" className="axp-build-manager__total"><span className="axp-build-manager__total-label">Tokens in</span><strong>{num(a?.totals.input)}</strong><span className="fx-small fx-muted">new input</span></div>
        <div role="listitem" className="axp-build-manager__total"><span className="axp-build-manager__total-label">Tokens out</span><strong>{num(a?.totals.output)}</strong><span className="fx-small fx-muted">replies + thinking</span></div>
      </div>
      <div className="axp-build-manager__tabs is-sub" role="tablist" aria-label="Sessions or costs">
        {(['sessions', 'costs'] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} className={`axp-build-manager__tab${mode === m ? ' is-on' : ''}`} onClick={() => setMode(m)}><Icon name={m === 'sessions' ? 'list' : 'zap'} size={12} />{m === 'sessions' ? 'Sessions' : 'Cost by build'}</button>)}
      </div>
      <div className="axp-build-manager__filters is-wrap" role="group" aria-label="Filter the sessions">
        <label className="axp-build-manager__field"><span>Project</span><select className="fx-input" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All</option>{['amberx-axf', 'axhub', 'build-pilot', 'other', ...projects].filter((x, i, l) => l.indexOf(x) === i).map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        {mode === 'sessions' && <>
          <label className="axp-build-manager__field"><span>Where</span><select className="fx-input" value={surface} onChange={(e) => setSurface(e.target.value)}><option value="">Anywhere</option>{Object.keys(v?.totals ? a?.groups.surface ?? {} : {}).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label className="axp-build-manager__field"><span>Model</span><select className="fx-input" value={model} onChange={(e) => setModel(e.target.value)}><option value="">All</option><option value="fable">Fable</option><option value="opus">Opus</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option></select></label>
          <label className="axp-build-manager__field"><span>When</span><select className="fx-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{DAYS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label>
          <label className="axp-build-manager__field"><span>Totals by</span><select className="fx-input" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>{GROUPS.map(([g, l]) => <option key={g} value={g}>{l}</option>)}</select></label>
          {feature && <button type="button" className="axp-build-manager__act" onClick={() => setFeature('')}><Icon name="x" size={11} />feature {feature}</button>}
        </>}
      </div>
      {err && <p className="fx-small axp-build-manager__error" role="alert">{err}</p>}
      {mode === 'costs' ? <CostsView project={project} onChange={openChange} /> : <>
        {groupRows.length > 0 && (
          <ul className="axp-build-manager__groups" aria-label={`Totals by ${group}`}>
            {groupRows.map(([k, g]) => <li key={k}><span className="axp-build-manager__group-k">{group === 'model' ? shortModel(k) : k}</span><span className="fx-small fx-muted">{g.sessions} sessions · {g.prompts} prompts</span><strong>{money(g.costUsd)}</strong></li>)}
          </ul>
        )}
        {!v && !err ? <div className="fx-empty">Loading the archive…</div>
          : !v?.sessions.length ? <div className="fx-empty">{v?.totals.sessions ? 'No session matches.' : 'No sessions archived yet. New Claude Code sessions are added by the archive hook; past ones by the backfill.'}</div>
            : (
              <ul className="axp-build-manager__list" aria-label={`${v.sessions.length} sessions`}>
                {v.sessions.map((s) => (
                  <li key={s.id} className="axp-build-manager__row">
                    <button type="button" className="axp-build-manager__head" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? '' : s.id)}>
                      <span className="axp-build-manager__title-line"><Icon name={SURFACE_ICON[s.system.surface] ?? 'terminal'} size={13} /><span className="axp-build-manager__title">{s.title}</span></span>
                      <span className="axp-build-manager__chips">
                        <Badge tone="muted">{when(s.startedAt)}</Badge>
                        <Badge>{s.project}</Badge>
                        <Badge icon="zap" tone={s.totals.costEstimated ? undefined : 'ok'} title={s.totals.costEstimated ? 'Estimated from the chat text' : 'From token counts'}>{cost(s.totals.costUsd, s.totals.costEstimated)}</Badge>
                        <Badge icon="type">{s.totals.prompts}</Badge>
                        {s.minutes > 0 && <Badge icon="clock">{mins(s.minutes)}</Badge>}
                        {s.models.filter((m) => !/haiku/.test(m)).slice(0, 2).map((m) => <Badge key={m} icon="sliders">{shortModel(m)}</Badge>)}
                      </span>
                      <span className="axp-build-manager__chips">
                        <Badge tone="muted" icon={SURFACE_ICON[s.system.surface] ?? 'terminal'}>{s.system.app}</Badge>
                        {s.system.host && s.system.host !== 'claude.ai' && <Badge tone="muted" icon="box">{s.system.host}{s.system.container && s.system.container !== s.system.host ? ` · ${s.system.container}` : ''}</Badge>}
                        {s.system.device && <Badge tone="muted" icon="smartphone">{s.system.device}</Badge>}
                        {s.system.via && <Badge tone="muted">{s.system.via}</Badge>}
                        {s.changeIds.length > 0 && <Badge tone="muted" icon="list">{s.changeIds.length} builds</Badge>}
                        {s.features.length > 0 && <Badge tone="muted" icon="layers">{s.features.length} features</Badge>}
                      </span>
                    </button>
                    {open === s.id && <SessionDetail id={s.id} onChange={openChange} onFeature={(f) => { setFeature(f); setOpen(''); }} />}
                  </li>
                ))}
              </ul>
            )}
        {v && v.more > 0 && <Button icon="chevron-down" onClick={() => setLimit(limit + 100)}>Show {Math.min(100, v.more)} more</Button>}
      </>}
    </section>
  );
}

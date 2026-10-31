/** The expanded row of the session browser: what the run is, what it built (from its real commits and edits). */
import { useEffect, useState, type ReactNode } from 'react';
import { Chip } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { KillButton, Watch } from './watch';
import { ContextTab, ConversationTab, ToolsTab, type Tab } from './tabs';
import { fmtDuration, fmtTokens, fmtUsd, fmtWhen, KIND_LABEL, type Kind, type Run } from './core';

const FOLDER = 'session-history';
const safeUrl = (u: unknown): string | null => (typeof u === 'string' && /^https:\/\/github\.com\//.test(u) ? u : null);

export interface DidFile { path: string; added?: number | null; removed?: number | null; before?: string[]; after?: string[]; edits?: number; url?: string }
export interface DidLine { kind: 'commit' | 'uncommitted' | 'report'; item: string; wrong?: string; sha?: string; branch?: string; at?: string | null; url?: string | null; files: DidFile[]; before?: string; after?: string; turns?: [number, number] | null; fromGit?: boolean; usd?: number | null }
export interface Did {
  summary: string; lines: DidLine[]; links: { repo?: string | null; branch?: string | null; prs?: string[] };
  changes: { id: string; title?: string; state?: string; createdAt?: string }[]; checkin: { id: string; location?: string; project?: string } | null;
}

/** GET a JSON route of this plugin, kept while the row stays open. */
export function useJson<T>(path: string | null): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!path) return;
    let live = true;
    setData(null); setError('');
    pluginFetch(FOLDER, path).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<T>; })
      .then((j) => live && setData(j), (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [path]);
  return { data, error };
}

export function Line({ k, children }: { k: string; children: ReactNode }) {
  return <div className="axp-session-history__line"><span className="fx-small fx-muted axp-session-history__k">{k}</span><span className="fx-grow">{children}</span></div>;
}

export function RunFacts({ run: r }: { run: Run }) {
  const t = r.tokens ?? {};
  return (
    <div className="fx-stack axp-session-history__facts">
      <Line k="Id"><span className="fx-mono fx-small">{r.id}</span> <span className="fx-small fx-muted">· {KIND_LABEL[r.kind as Kind] ?? r.kind}</span></Line>
      {r.cwd ? <Line k="Where"><span className="fx-mono fx-small">{r.cwd}</span>{r.branch ? <span className="fx-small fx-muted"> · {r.branch}</span> : null}</Line> : null}
      <Line k="When"><span className="fx-small">{fmtWhen(r.startedAt)} → {fmtWhen(r.lastAt)} · {fmtDuration(r.durationMs)} · {r.turns} turns · {r.tools} tool calls</span></Line>
      <Line k="Tokens"><span className="fx-small">{fmtTokens(t.input)} in · {fmtTokens(t.output)} out · {fmtTokens(t.cacheRead)} cache read · {fmtTokens((t.cacheWrite ?? 0) + (t.cacheWrite1h ?? 0))} cache write</span></Line>
      <Line k="Cost"><span className="fx-small">{fmtUsd(r.usd)}{r.costFrom === 'result' ? ' (exact, from the run’s result)' : r.costFrom === 'usage' ? ' (from every turn’s usage)' : r.costFrom === 'report' ? ' (from the agent report)' : ''}</span></Line>
      {r.budget ? <Line k="Budget"><span className="fx-small">{[r.budget.usd != null ? fmtUsd(r.budget.usd) : '', r.budget.tokens != null ? `${fmtTokens(r.budget.tokens)} tokens` : '', r.budget.turns != null ? `${r.budget.turns} turns` : ''].filter(Boolean).join(' · ')}</span></Line> : null}
    </div>
  );
}

function Side({ label, lines }: { label: string; lines?: string[] }) {
  if (!lines?.length) return <div className="axp-session-history__side"><span className="fx-small fx-muted">{label}: nothing</span></div>;
  return <div className="axp-session-history__side"><span className="fx-small fx-muted">{label}</span><pre className="fx-mono fx-small axp-session-history__pre">{lines.join('\n')}</pre></div>;
}

function FileRow({ f }: { f: DidFile }) {
  const [open, setOpen] = useState(false);
  const url = safeUrl(f.url);
  const has = !!(f.before?.length || f.after?.length);
  return (
    <li className="axp-session-history__file">
      <button type="button" className="axp-session-history__filebtn" onClick={() => setOpen(!open)} disabled={!has} aria-expanded={open}>
        <span className="fx-mono fx-small">{has ? (open ? '▾ ' : '▸ ') : ''}{f.path}</span>
        <span className="fx-small fx-muted"> {f.added != null ? `+${f.added}` : ''}{f.removed != null ? ` −${f.removed}` : ''}{f.edits ? ` · ${f.edits} edit${f.edits > 1 ? 's' : ''}` : ''}</span>
      </button>
      {url ? <a className="fx-small" href={url} target="_blank" rel="noreferrer"> open</a> : null}
      {open ? <div className="axp-session-history__ba"><Side label="Before" lines={f.before} /><Side label="After" lines={f.after} /></div> : null}
    </li>
  );
}

export function DidLineView({ l, price }: { l: DidLine; price?: ReactNode }) {
  const url = safeUrl(l.url);
  return (
    <li className="axp-session-history__did">
      <div className="axp-session-history__didhead">
        <Chip tone={l.kind === 'commit' ? 'success' : l.kind === 'uncommitted' ? 'warning' : 'accent'}>{l.kind === 'commit' ? 'commit' : l.kind === 'uncommitted' ? 'not committed' : 'reported'}</Chip>
        <strong className="fx-grow">{l.item}</strong>
        {price}
      </div>
      {l.wrong ? <p className="fx-small axp-session-history__wrong"><span className="fx-muted">What was wrong / why: </span>{l.wrong}</p> : null}
      {l.kind === 'report' && (l.before || l.after) ? <div className="axp-session-history__ba"><Side label="Before" lines={l.before ? [l.before] : []} /><Side label="After" lines={l.after ? [l.after] : []} /></div> : null}
      {l.sha || l.at ? <p className="fx-small fx-muted">{l.sha ? <span className="fx-mono">{url ? <a href={url} target="_blank" rel="noreferrer">{l.sha.slice(0, 10)}</a> : l.sha.slice(0, 10)}</span> : null}{l.at ? ` · ${fmtWhen(l.at)}` : ''}{l.kind === 'commit' && !l.fromGit ? ' · checkout gone: from the run’s own edits' : ''}</p> : null}
      {l.files.length ? <ul className="axp-session-history__files">{l.files.map((f, i) => <FileRow key={`${f.path}:${i}`} f={f} />)}</ul> : null}
    </li>
  );
}

export function WhatItDid({ run, did }: { run: Run; did: Did }) {
  const prs = (did.links.prs ?? []).map(safeUrl).filter(Boolean) as string[];
  const branch = safeUrl(did.links.branch);
  return (
    <div className="fx-stack">
      {did.summary ? <div className="axp-session-history__summary fx-small">{did.summary}</div> : <p className="fx-small fx-muted">No summary: the run hasn’t said what it did{run.status === 'running' ? ' yet' : ''}.</p>}
      {did.lines.length ? <ol className="axp-session-history__didlist">{did.lines.map((l, i) => <DidLineView key={`${l.sha ?? l.kind}:${i}`} l={l} />)}</ol> : <p className="fx-small fx-muted">No commits or file edits.</p>}
      {prs.length || branch ? <Line k="Links"><span className="fx-small">{prs.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="axp-session-history__link">PR #{u.split('/').pop()}</a>)}{branch ? <a href={branch} target="_blank" rel="noreferrer" className="axp-session-history__link">branch {run.branch}</a> : null}</span></Line> : null}
      {did.changes.length ? <Line k="Changes log"><span className="fx-small">{did.changes.map((c) => <span key={c.id} className="axp-session-history__link">{c.title || c.id} <Chip>{c.state ?? 'open'}</Chip></span>)}</span></Line> : null}
      {did.checkin ? <Line k="Check-in"><span className="fx-small">{did.checkin.location ?? '?'}{did.checkin.project ? ` · ${did.checkin.project}` : ''} <span className="fx-mono fx-muted">{did.checkin.id}</span></span></Line> : null}
    </div>
  );
}

type DetailTab = 'did' | 'watch' | Tab;

export function RunDetail({ run }: { run: Run }) {
  const [tab, setTab] = useState<DetailTab>(run.status === 'running' && run.kind !== 'session' ? 'watch' : 'did');
  const version = `${run.lastAt ?? ''}:${run.status}`;
  const { data, error } = useJson<Did>(tab === 'did' ? `runs/${encodeURIComponent(run.id)}/did?v=${encodeURIComponent(version)}` : null);
  const tabs: { id: DetailTab; label: string }[] = [
    ...(run.status === 'running' ? [{ id: 'watch' as const, label: 'Watch live' }] : []),
    { id: 'did', label: 'What it did' }, { id: 'context', label: 'Context' }, { id: 'tools', label: `Tools (${run.tools})` },
    ...(run.kind === 'session' ? [{ id: 'conversation' as const, label: 'Conversation' }] : []),
  ];
  return (
    <div className="fx-stack">
      <RunFacts run={run} />
      {tab !== 'watch' ? <KillButton run={run} status={run.status} /> : null}
      <div className="fx-tabs" role="tablist" aria-label="Run detail">
        {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`fx-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'did' ? (error ? <p className="fx-small fx-muted">Couldn’t read what it did ({error}).</p> : !data ? <p className="fx-small fx-muted">Reading its commits and edits…</p> : <WhatItDid run={run} did={data} />) : null}
      {tab === 'watch' ? <Watch run={run} /> : null}
      {tab === 'context' ? <ContextTab runId={run.id} version={version} /> : null}
      {tab === 'tools' ? <ToolsTab runId={run.id} version={version} /> : null}
      {tab === 'conversation' ? <ConversationTab runId={run.id} version={version} /> : null}
    </div>
  );
}

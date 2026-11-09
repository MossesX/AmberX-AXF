import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './fix-log.css';

/** The folder name under plugins/: the server routes live at /api/plugins/fix-log/. */
const FOLDER = 'fix-log';
type Outcome = 'found' | 'trying' | 'failed' | 'fixed';
const OUTCOMES: Outcome[] = ['found', 'trying', 'failed', 'fixed'];
const LABEL: Record<Outcome, string> = { found: 'Needs fixing', trying: 'Trying', failed: 'Failed', fixed: 'Fixed' };
const TONE: Record<Outcome, 'accent' | 'warning' | 'danger' | 'success'> = { found: 'warning', trying: 'accent', failed: 'danger', fixed: 'success' };

interface Entry { id: string; at: string; outcome: Outcome; text: string; detail: string; session: string; agent: string; build: string; issue: string; notified: boolean; muted?: boolean }
interface Summary { entries: number; today: Record<Outcome, number>; openIssues: number; fixedIssues: number; sessions: string[]; builds: string[] }
interface Settings { notify: Record<Outcome, boolean>; perSessionPer10Min: number; keep: number }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `HTTP ${r.status}`);
  return j as T;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function FixLogView() {
  const [outcome, setOutcome] = useState('');
  const [session, setSession] = useState('');
  const [build, setBuild] = useState('');
  const [q, setQ] = useState('');
  const [issue, setIssue] = useState('');
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sum, setSum] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (outcome) p.set('outcome', outcome);
    if (session) p.set('session', session);
    if (build) p.set('build', build);
    if (issue) p.set('issue', issue);
    if (q.trim()) p.set('q', q.trim());
    p.set('limit', '300');
    Promise.all([call<{ total: number; entries: Entry[] }>(`entries?${p}`), call<Summary>('summary')]).then(([e, s]) => {
      setRows(e.entries); setTotal(e.total); setSum(s); setError('');
    }, (e: Error) => setError(e.message));
  }, [outcome, session, build, issue, q]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const clear = () => { setOutcome(''); setSession(''); setBuild(''); setQ(''); setIssue(''); };
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>Fix log</h1></div></header>
      <p className="fx-small fx-muted">What Claude sessions found, tried, failed and fixed. Each line also went to your phone as an FYI. Nothing here needs an answer.</p>
      {error && <Note tone="danger">Fix log unavailable: {error}</Note>}
      {sum && (
        <div className="axp-fixlog__counts" aria-label="Today">
          {OUTCOMES.map((o) => <Chip key={o} tone={TONE[o]}>{LABEL[o]} today: {sum.today[o]}</Chip>)}
          <Chip>Open fixes: {sum.openIssues}</Chip>
          <Chip>Fixed: {sum.fixedIssues}</Chip>
        </div>
      )}
      <Container title="Filters" icon="search">
        <div className="axp-fixlog__filters" role="toolbar" aria-label="Fix log filters">
          <SelectField label="Outcome" value={outcome} empty="All" options={[...OUTCOMES.map((o) => ({ value: o, label: LABEL[o] })), { value: 'found,trying,failed', label: 'Not fixed yet' }]} onChange={setOutcome} />
          <SelectField label="Session" value={session} empty="All" options={(sum?.sessions ?? []).map((s) => ({ value: s, label: s }))} onChange={setSession} />
          <SelectField label="Build" value={build} empty="All" options={(sum?.builds ?? []).map((s) => ({ value: s, label: s }))} onChange={setBuild} />
          <TextField label="Search" type="search" value={q} onChange={setQ} placeholder="text, detail, session" />
          <Button icon="x" onClick={clear}>Clear</Button>
          <Button icon="refresh" onClick={load}>Refresh</Button>
        </div>
        {issue && <p className="fx-small">Showing one fix: <span className="fx-mono">{issue}</span> <Button size="sm" icon="x" onClick={() => setIssue('')}>Show all</Button></p>}
      </Container>
      <Container title={`Lines (${total})`} icon="list">
        {rows === null ? <p className="fx-small fx-muted">Loading…</p> : rows.length === 0 ? <p className="fx-small fx-muted">Nothing logged{outcome || session || build || q || issue ? ' for these filters' : ' yet'}.</p> : (
          <ul className="axp-fixlog__list">
            {rows.map((e) => (
              <li key={e.id} className="axp-fixlog__row" data-fx-help={`fix-log-${e.outcome}`}>
                <Chip tone={TONE[e.outcome]}>{LABEL[e.outcome]}</Chip>
                <span className="axp-fixlog__main">
                  <b>{e.text}</b>
                  {e.detail && <p className="fx-small axp-fixlog__detail">{e.detail}</p>}
                  <span className="fx-small fx-muted">{[e.build, e.session, e.agent].filter(Boolean).join(' · ')}{e.notified ? ' · sent to phone' : e.muted ? ' · not sent (flood limit)' : ' · not sent'}</span>
                </span>
                <span className="fx-small fx-muted axp-fixlog__when">{when(e.at)}</span>
                <Button size="sm" icon="layers" onClick={() => setIssue(e.issue)}>Whole fix</Button>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </div>
  );
}

function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { call<Settings>('settings').then(setS, (e: Error) => setError(e.message)); }, []);
  const save = (patch: Partial<Settings>) => call<Settings>('settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then(setS, (e: Error) => setError(e.message));
  if (error) return <Note tone="danger">Settings unavailable: {error}</Note>;
  if (!s) return <p className="fx-small fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Every line is always logged. These choose which ones also ring the bell and your phone. Channels and quiet hours are in Notifications (type “Fix log”).</p>
      {OUTCOMES.map((o) => (
        <Switch key={o} label={`Notify: ${LABEL[o]}`} checked={s.notify[o]} onChange={(v) => void save({ notify: { ...s.notify, [o]: v } })} />
      ))}
      <SelectField label="Flood limit (notifications per session per 10 minutes)" value={String(s.perSessionPer10Min)} options={[5, 10, 20, 50, 100].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => void save({ perSessionPer10Min: Number(v) })} />
      <SelectField label="Lines kept" value={String(s.keep)} options={[1000, 5000, 20000, 50000].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => void save({ keep: Number(v) })} />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.fix-log',
  label: 'Fix log',
  version: '0.1.0',
  appMenu,
  views: { 'fix-log': { title: 'Fix log', icon: 'hammer', render: () => <FixLogView /> } },
  nav: { label: 'Plugins', items: [{ id: 'fix-log', label: 'Fix log', icon: 'hammer', view: 'fix-log' }] },
  settingsTabs: [{ id: FOLDER, label: 'Fix log', icon: 'hammer', order: 48, parent: 'plugins' }],
  settingsPanels: [
    { id: 'fix-log.settings', tab: FOLDER, title: 'Notifications', icon: 'bell', order: 10, render: () => <SettingsPanel /> },
    { id: 'fix-log.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

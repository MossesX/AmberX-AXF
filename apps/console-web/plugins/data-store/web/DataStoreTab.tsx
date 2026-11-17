/**
 * Settings → Plugins → Data store: where the console's data lives (axf-data) and how each namespace moves onto it.
 *
 * Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
 * builds keep running. That's what I need."
 *
 * Framework controls and tokens only. Every control has a data-axf-target address (console-control@1), and every action
 * is also a REST route (/api/plugins/data-store/…), a plugin command (MCP), `axf data …` and a voice action.
 */
import { useEffect, useState } from 'react';
import { PageToolbar, Button, Chip, Container, Icon, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'data-store';
export const api = pluginApi(FOLDER, 'Data store', { unavailable: 'The Data store plugin is switched off or its server part is not running.' });

type Mode = 'local' | 'shadow' | 'cutover' | 'rollback';
export interface NsRow { ns: string; mode: Mode; since: string; drift: number; lastDriftAt: string; cursor: number; next: string; nextReason: string; keys?: number | null }
export interface Backup { file?: string; at?: string; bytes?: number; verify?: { ok: boolean; problems?: string[]; at?: string } }
export interface State {
  configured: boolean; reachable: boolean; error?: string; mode: Mode;
  health?: { cursor: number; volume?: { freeBytes: number; totalBytes: number } } | null;
  backup?: { last: Backup | null; kept: { file: string; bytes: number }[]; job: { state: string; ok?: boolean; error?: string } } | null;
  namespaces: NsRow[];
}
interface DriftEntry { at: string; op: string; kind: string; key: string; error?: string }

const MODE_TONE: Record<Mode, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { local: undefined, shadow: 'accent', cutover: 'success', rollback: 'warning' };
const MODE_LABEL: Record<Mode, string> = { local: 'Local', shadow: 'Shadow', cutover: 'On axf-data', rollback: 'Rolling back' };
const mb = (n?: number) => (n == null ? '?' : `${(n / 1048576).toFixed(1)} MB`);
const ago = (iso?: string) => { if (!iso) return ''; const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

export function useDataStore() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const load = async (fresh = false) => { try { setS(await api.call<State>(`state${fresh ? '?fresh=1' : ''}`)); setErr(''); } catch (e) { setErr((e as Error).message); } };
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15000); return () => clearInterval(t); }, []);
  return { s, err, load };
}

/** The status block: reachable, mode per namespace with keys on axf-data, drift and the next step. */
export function StatusPanel({ s }: { s: State }) {
  return (
    <div className="fx-stack" data-axf-target="panel:data-store.status">
      <p className="fx-small">
        <Icon name={s.reachable ? 'check' : 'alert'} size={14} />{' '}
        {!s.configured ? 'axf-data is not connected to this console yet (run deploy/install-data.sh, then re-install the console).' : s.reachable ? `axf-data is up · change cursor ${s.health?.cursor ?? '?'} · ${mb(s.health?.volume?.freeBytes)} free on its volume` : `axf-data does not answer${s.error ? `: ${s.error}` : ''}`}
      </p>
      <div className="fx-tablewrap">
        <table className="fx-table" aria-label="Namespaces">
          <thead><tr><th>Namespace</th><th>Mode</th><th>Keys on axf-data</th><th>Drift</th><th>Next</th></tr></thead>
          <tbody>
            {s.namespaces.map((n) => (
              <tr key={n.ns} data-axf-target={`row:data-store-ns-${n.ns.replace('/', '-')}`}>
                <td className="fx-mono">{n.ns}</td>
                <td><Chip tone={MODE_TONE[n.mode]}>{MODE_LABEL[n.mode]}</Chip>{n.since ? <span className="fx-small fx-muted"> {ago(n.since)}</span> : null}</td>
                <td>{n.keys ?? '—'}</td>
                <td>{n.drift ? <Chip tone="warning">{n.drift}</Chip> : '0'}</td>
                <td className="fx-small">{n.next}{n.nextReason ? <span className="fx-muted"> · {n.nextReason}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Last backup and its verify result, with Backup now / Verify. */
export function BackupPanel({ s, reload }: { s: State; reload: () => Promise<void> }) {
  const rt = useRuntime();
  const last = s.backup?.last;
  const job = s.backup?.job;
  const run = async (what: 'backup' | 'verify') => {
    try { await api.post(what, {}); rt.toast(what === 'backup' ? 'Backup started on axf-data' : 'Verify started', 'success'); setTimeout(() => void reload(), 2500); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  return (
    <div className="fx-stack" data-axf-target="panel:data-store.backups">
      {last ? (
        <p className="fx-small">
          <Icon name={last.verify?.ok ? 'check' : 'alert'} size={14} /> Last backup {last.file} · {ago(last.at)} · {mb(last.bytes)} · {last.verify?.ok ? 'verified against the live store' : `verify failed: ${(last.verify?.problems ?? []).slice(0, 2).join('; ') || 'no result'}`}
        </p>
      ) : <p className="fx-small fx-muted">No backup yet. Backups run daily at 03:17 UTC (14 days plus weekly copies).</p>}
      {job && job.state !== 'idle' ? <p className="fx-small fx-muted">Job: {job.state}{job.ok === false && job.error ? ` · ${job.error}` : ''}</p> : null}
      <PageToolbar view="data-store" />
      <div className="fx-toolbar" role="toolbar" aria-label="Data store backups" data-axf-toolbar="data-store.backups">
        <Button icon="download" disabled={!s.reachable} onClick={() => void run('backup')} id="data-store-backup">Backup now</Button>
        <Button icon="check" disabled={!s.reachable || !last} onClick={() => void run('verify')} id="data-store-verify">Verify</Button>
      </div>
    </div>
  );
}

/** Move one namespace: Shadow / Cut over / Roll back / Back to local, each guarded by data-mode.mjs and confirmed here. */
export function ModePanel({ s, reload }: { s: State; reload: () => Promise<void> }) {
  const rt = useRuntime();
  const [ns, setNs] = useState(s.namespaces[0]?.ns ?? 'settings');
  const [windowMin, setWindowMin] = useState('30');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState('');
  const row = s.namespaces.find((n) => n.ns === ns);
  const go = async (to: Mode) => {
    setBusy(to);
    try { await api.post('mode', { ns, to, window: Number(windowMin) || 0, acceptDrift: accept }); rt.toast(`${ns} → ${MODE_LABEL[to]}`, 'success'); await reload(); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(''); }
  };
  const mode = row?.mode ?? 'local';
  return (
    <div className="fx-stack" data-axf-target="panel:data-store.mode">
      <Note tone="info" icon="info">Staged: a namespace goes to Shadow first (writes land in both places, differences are logged), then Cut over once shadow has had no drift for the window. Roll back replays axf-data's changes onto the local copy.</Note>
      <div className="fx-row fx-row--wrap">
        <SelectField label="Namespace" value={ns} options={s.namespaces.map((n) => ({ value: n.ns, label: `${n.ns} (${MODE_LABEL[n.mode]})` }))} onChange={setNs} />
        <TextField label="Quiet window (minutes)" value={windowMin} onChange={setWindowMin} type="number" />
        <Switch label="Accept the logged drift" checked={accept} onChange={setAccept} hint="Only after reading the drift log below" />
      </div>
      <div className="fx-toolbar" role="toolbar" aria-label="Data store mode" data-axf-toolbar="data-store.mode">
        <Button icon="copy" busy={busy === 'shadow'} disabled={!s.reachable || mode !== 'local'} confirm={`Start shadow for ${ns}? Writes go to the local files and to axf-data.`} onClick={() => void go('shadow')} id="data-store-shadow">Shadow</Button>
        <Button icon="upload" tone="primary" busy={busy === 'cutover'} disabled={!s.reachable || mode !== 'shadow'} confirm={`Cut ${ns} over to axf-data? The local copy becomes a read-only backup.`} onClick={() => void go('cutover')} id="data-store-cutover">Cut over</Button>
        <Button icon="undo" tone="danger" busy={busy === 'rollback'} disabled={!s.reachable || (mode !== 'cutover' && mode !== 'rollback')} confirm={`Roll ${ns} back to the local files? Writes wait while axf-data's changes are replayed.`} onClick={() => void go('rollback')} id="data-store-rollback">Roll back</Button>
        <Button icon="x" busy={busy === 'local'} disabled={mode !== 'shadow'} confirm={`Stop shadowing ${ns}?`} onClick={() => void go('local')} id="data-store-local">Back to local</Button>
      </div>
      {row?.nextReason ? <p className="fx-small fx-muted">Next for {ns}: {row.next} · {row.nextReason}</p> : null}
      <DriftLog ns={ns} />
    </div>
  );
}

function DriftLog({ ns }: { ns: string }) {
  const [rows, setRows] = useState<DriftEntry[] | null>(null);
  useEffect(() => { let on = true; api.call<{ entries: DriftEntry[] }>(`drift?ns=${encodeURIComponent(ns)}&tail=20`).then((r) => { if (on) setRows(r.entries); }, () => { if (on) setRows([]); }); return () => { on = false; }; }, [ns]);
  if (!rows) return <p className="fx-small fx-muted">Loading the drift log…</p>;
  if (!rows.length) return <p className="fx-small fx-muted" data-axf-target="list:data-store-drift">No drift logged for {ns}.</p>;
  return (
    <details data-axf-target="list:data-store-drift">
      <summary className="fx-small">Drift log for {ns} ({rows.length})</summary>
      <ul className="fx-stack fx-small">
        {rows.map((d, i) => <li key={`${d.at}-${i}`}><span className="fx-mono">{d.at}</span> {d.op} · {d.kind} · <span className="fx-mono">{d.key}</span>{d.error ? <span className="fx-muted"> · {d.error}</span> : null}</li>)}
      </ul>
    </details>
  );
}

// ── the three options (UI Review choices, settings assets in ../assets/settings): panels (default), rows, stages ──
export const VIEW_KEY = 'axf.data-store.view';
export type View = 'panels' | 'rows' | 'stages';
export function currentView(): View { try { const v = globalThis.localStorage?.getItem(VIEW_KEY); return v === 'rows' || v === 'stages' ? v : 'panels'; } catch { return 'panels'; } }

const NEXT_ACTION: Record<Mode, { to: Mode; label: string; icon: string; tone?: 'primary' | 'danger' } | null> = {
  local: { to: 'shadow', label: 'Shadow', icon: 'copy' }, shadow: { to: 'cutover', label: 'Cut over', icon: 'upload', tone: 'primary' },
  cutover: { to: 'rollback', label: 'Roll back', icon: 'undo', tone: 'danger' }, rollback: { to: 'rollback', label: 'Finish roll back', icon: 'undo', tone: 'danger' },
};

/** Option "rows": one row per namespace, its next action on the row. */
export function RowsView({ s, reload }: { s: State; reload: () => Promise<void> }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState('');
  const go = async (ns: string, to: Mode) => {
    setBusy(ns);
    try { await api.post('mode', { ns, to }); rt.toast(`${ns} → ${MODE_LABEL[to]}`, 'success'); await reload(); } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(''); }
  };
  return (
    <ul className="fx-stack" data-axf-target="list:data-store-rows">
      {s.namespaces.map((n) => {
        const a = NEXT_ACTION[n.mode];
        return (
          <li key={n.ns} className="fx-row fx-row--wrap" data-axf-target={`row:data-store-ns-${n.ns.replace('/', '-')}`}>
            <span className="fx-mono">{n.ns}</span>
            <Chip tone={MODE_TONE[n.mode]}>{MODE_LABEL[n.mode]}</Chip>
            <span className="fx-small fx-muted">{n.keys ?? '—'} keys · drift {n.drift}{n.nextReason ? ` · ${n.nextReason}` : ''}</span>
            {a ? <Button size="sm" icon={a.icon} tone={a.tone ?? 'neutral'} busy={busy === n.ns} disabled={!s.reachable || (n.next === 'wait')} confirm={`${a.label}: ${n.ns}?`} onClick={() => void go(n.ns, a.to)} id={`data-store-${n.ns.replace('/', '-')}-${a.to}`}>{a.label}</Button> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Option "stages": Local → Shadow → On axf-data as a pipeline, namespaces under each stage. */
export function StagesView({ s }: { s: State }) {
  const stages: { mode: Mode; title: string }[] = [{ mode: 'local', title: 'Local' }, { mode: 'shadow', title: 'Shadow' }, { mode: 'cutover', title: 'On axf-data' }];
  return (
    <div className="fx-row fx-row--wrap" data-axf-target="list:data-store-stages">
      {stages.map((st, i) => {
        const here = s.namespaces.filter((n) => n.mode === st.mode || (st.mode === 'cutover' && n.mode === 'rollback'));
        return (
          <section key={st.mode} className="fx-stack" aria-label={st.title}>
            <p className="fx-small"><b>{i + 1}. {st.title}</b> <span className="fx-muted">({here.length})</span></p>
            {here.length ? here.map((n) => <span key={n.ns} className="fx-small"><Chip tone={MODE_TONE[n.mode]}>{n.ns}</Chip> {n.keys ?? ''}{n.drift ? ` · drift ${n.drift}` : ''}</span>) : <span className="fx-small fx-muted">none</span>}
          </section>
        );
      })}
    </div>
  );
}

/** The whole sub-tab in the chosen option (one panel per block, so each keeps its own title and help). */
export function DataStoreTab() {
  const { s, err, load } = useDataStore();
  if (err) return <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {err}</p>;
  if (!s) return <p className="fx-small fx-muted">Loading…</p>;
  return (
    <div className="fx-stack fx-stack--lg">
      <Container title="Where the data is" icon="layers"><StatusPanel s={s} /></Container>
      <Container title="Backups" icon="save"><BackupPanel s={s} reload={() => load(true)} /></Container>
      <Container title="Move a namespace" icon="shuffle"><ModePanel s={s} reload={() => load(true)} /></Container>
    </div>
  );
}

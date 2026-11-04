/**
 * Maintenance console plugin (ai.amberx.axf.console.maintenance): server health and safe clean-up for the VPS.
 *
 * - Page `maintenance` (Plugins → Maintenance, Console → Server health and clean-up): disk, memory, swap and load, the
 *   biggest space users, Docker, build worktrees, then the clean-up jobs. Preview first (what goes and how much space),
 *   then Send for approval: the run is ONE held call on axHub; nothing is removed until Brett approves it there.
 * - Settings → Plugins → Maintenance: the framework's settings interface (schema → generated controls). Values are kept
 *   on the console server (the nightly clean-up and the alerts run there), so this device's copy is synced both ways.
 * - Home: the "Server disk" card suggestion (card@1, from the `summary` read).
 * - Systems check: the "Server health" row with Auto fix (registered by the server part on axf.health@1).
 *
 * No AI anywhere: plain reads of what the host engine measured.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Checkbox, Chip, Container, Gauge, Icon, Note, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './maintenance.css';

const FOLDER = 'maintenance';
const POLL_MS = 30_000;
const api = pluginApi(FOLDER, 'Maintenance', { unavailable: 'The Maintenance plugin is switched off or its server part is not running.' });

type JobId = 'worktrees' | 'docker' | 'logs' | 'tmp' | 'created';
interface Item { id: string; job: JobId; ref: string; size: number | null; why: string; approx?: boolean }
interface Kept { path: string; name?: string; size?: number; state?: string; why: string }
interface Job { id: JobId; label: string; safe: boolean; icon: string; what: string; count?: number | null; bytes?: number | null; error?: string | null }
interface Pct { pct: number | null; usedGb?: number | null; freeGb?: number | null; totalGb?: number | null }
interface Summary { level: string; swapFull: boolean; hostPart: boolean; stale: boolean; disk: Pct; memory: Pct; swap: Pct; load: Record<string, number | null>; reclaimableGb: number | null; safeReclaimableGb: number | null; at?: string }
interface Run { id: string; at: string; by: string; kind: string; jobs: JobId[]; count: number; bytes: number; state: 'waiting' | 'done' | 'partial' | 'failed' | 'dropped'; hub: { error?: string; held?: boolean; job?: string }; result?: { done: number; skipped: number; failed: number; freed: number; diskAfter?: { pct: number } } }
interface Status { summary: Summary; hostPart: boolean; stale: boolean; note?: string; lastRun: Run | null; hub: boolean }
interface Snapshot { biggest: { kind: string; label: string; path: string; size: number; reclaimable?: number }[]; builds: { count: number; size: number; items: { name: string; path: string; size: number; state: string; why: string }[] }; docker: { available: boolean; images?: { count: number; size: number; reclaimable: number }; volumes?: { count: number; size: number }; buildCache?: { size: number; reclaimable: number }; containers?: { count: number; active: number } }; ageS?: number | null }
interface PreviewJob { label: string; safe: boolean; what: string; items: Item[]; kept: Kept[]; count: number; bytes: number; error?: string | null }
interface Preview { jobs: Record<string, PreviewJob>; count: number; bytes: number; at?: string; stale?: boolean }

export function human(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n; let i = 0;
  while (Math.abs(v) >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return i < 2 ? `${Math.round(v)} ${u[i]}` : `${v.toFixed(1)} ${u[i]}`;
}
const ago = (iso?: string) => {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const LEVEL_TONE: Record<string, 'success' | 'warning' | 'danger' | undefined> = { ok: 'success', warning: 'warning', error: 'danger', critical: 'danger' };
const RUN_TONE: Record<Run['state'], 'success' | 'warning' | 'danger' | 'accent' | undefined> = { waiting: 'accent', done: 'success', partial: 'warning', failed: 'danger', dropped: undefined };
const RUN_LABEL: Record<Run['state'], string> = { waiting: 'Waiting for approval', done: 'Done', partial: 'Done with skips', failed: 'Not sent', dropped: 'Denied or expired' };

/* ---------------- one shared poll of status ---------------- */

let st: { status: Status | null; error: string } = { status: null, error: '' };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
async function loadStatus(): Promise<void> {
  try { st = { status: await api.call<Status>('status'), error: '' }; } catch (e) { st = { ...st, error: (e as Error).message }; }
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) { void loadStatus(); timer = setInterval(() => { if (document.visibilityState === 'visible') void loadStatus(); }, POLL_MS); }
  return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
const snap = () => st;
const useStatus = () => useSyncExternalStore(subscribe, snap);

/* ---------------- the page ---------------- */

function Gauges({ s }: { s: Summary }) {
  const load = s.load ?? {};
  return (
    <>
      <div className="axp-maintenance__gauges">
        <Gauge label="Disk" value={s.disk.pct ?? 0} max={100} unit="%" />
        <Gauge label="Memory" value={s.memory.pct ?? 0} max={100} unit="%" />
        <Gauge label="Swap" value={s.swap.pct ?? 0} max={100} unit="%" />
        <Gauge label={`Load (${load.cpus ?? '?'} CPUs)`} value={Number(load['1'] ?? 0)} max={Number(load.cpus ?? 1)} />
      </div>
      <p className="fx-small fx-muted axp-maintenance__meta">
        Disk {s.disk.usedGb ?? '?'} of {s.disk.totalGb ?? '?'} GB ({s.disk.freeGb ?? '?'} GB free) · memory {s.memory.usedGb ?? '?'} of {s.memory.totalGb ?? '?'} GB · swap {s.swap.usedGb ?? 0} of {s.swap.totalGb ?? 0} GB · load {load['1'] ?? '?'} / {load['5'] ?? '?'} / {load['15'] ?? '?'}
        {s.safeReclaimableGb ? ` · safe clean-up frees about ${s.safeReclaimableGb} GB` : ''}
      </p>
    </>
  );
}

function SpaceUsers({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) return <p className="fx-small fx-muted">Loading…</p>;
  const d = snapshot.docker;
  return (
    <>
      {snapshot.biggest.length ? (
        <ul className="axp-maintenance__list" aria-label="Biggest space users">
          {snapshot.biggest.map((b) => (
            <li key={b.path} className="axp-maintenance__row">
              <span className="axp-maintenance__name"><b>{b.label}</b><span className="fx-small fx-muted fx-mono">{b.path}</span></span>
              {b.reclaimable ? <Chip tone="warning">{human(b.reclaimable)} reclaimable</Chip> : null}
              <span className="axp-maintenance__size">{human(b.size)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="fx-small fx-muted">No measurements from the host yet.</p>}
      {d.available && (
        <p className="fx-small fx-muted axp-maintenance__meta">
          Docker: {d.images?.count ?? 0} images ({human(d.images?.size)}), {d.containers?.active ?? 0}/{d.containers?.count ?? 0} containers running, {d.volumes?.count ?? 0} volumes ({human(d.volumes?.size)}, never cleaned), build cache {human(d.buildCache?.size)}.
        </p>
      )}
    </>
  );
}

function Worktrees({ snapshot }: { snapshot: Snapshot | null }) {
  const items = snapshot?.builds.items ?? [];
  if (!items.length) return <p className="fx-small fx-muted">No build worktrees measured.</p>;
  return (
    <ul className="axp-maintenance__list" aria-label="Build worktrees">
      {items.map((w) => (
        <li key={w.path} className="axp-maintenance__row">
          <span className="axp-maintenance__name"><b>{w.name}</b><span className="fx-small fx-muted">{w.why}</span></span>
          <Chip tone={w.state === 'removable' ? 'warning' : w.state === 'active' ? 'accent' : undefined}>{w.state}</Chip>
          <span className="axp-maintenance__size">{human(w.size)}</span>
        </li>
      ))}
    </ul>
  );
}

function CleanUp({ status, onSent }: { status: Status | null; onSent: () => void }) {
  const rt = useRuntime();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [picked, setPicked] = useState<Set<JobId>>(new Set(['docker', 'logs', 'tmp', 'created']));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { api.call<{ jobs: Job[] }>('jobs').then((j) => setJobs(j.jobs), () => setJobs([])); }, [status?.summary.at]);
  const toggle = (id: JobId, on: boolean) => { const n = new Set(picked); if (on) n.add(id); else n.delete(id); setPicked(n); setPreview(null); };
  const doPreview = async () => {
    setBusy('preview');
    try { setPreview(await api.post<Preview>('preview', { jobs: [...picked] })); } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(''); }
  };
  const send = async () => {
    setBusy('run');
    try {
      const r = await api.post<Run>('run', { jobs: [...picked] });
      rt.toast(`Sent to axHub: approve it there to free about ${human(r.bytes)}`, 'success');
      setPreview(null); onSent();
    } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(''); }
  };
  if (!status?.hostPart) return <Note tone="info">Clean-up needs the host part, which measures and removes on the VPS itself. It installs with the next <span className="fx-mono">deploy/install-console.sh</span> run.</Note>;
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Preview first, then send it for approval. Each run is one held call on axHub: nothing is removed until you approve it there. Running containers, volumes and app data are never touched.</p>
      <div>
        {jobs.map((j) => (
          <div key={j.id} className="axp-maintenance__job">
            <div className="axp-maintenance__jobhead">
              <Checkbox label={<span><Icon name={j.icon} size={14} /> {j.label}</span>} checked={picked.has(j.id)} onChange={(v) => toggle(j.id, v)} />
              {j.safe ? <Chip tone="success">Safe</Chip> : <Chip tone="warning">Check first</Chip>}
              <span className="axp-maintenance__size">{j.count ?? 0} · {human(j.bytes)}</span>
            </div>
            <span className="fx-small fx-muted">{j.what}</span>
            {j.error && <span className="fx-small" role="alert"><Icon name="alert" size={14} /> {j.error}</span>}
          </div>
        ))}
      </div>
      <div className="axp-maintenance__acts">
        <Button icon="eye" disabled={!picked.size || !!busy} busy={busy === 'preview'} onClick={() => void doPreview()}>Preview</Button>
        <Button icon="trash" tone="danger" disabled={!preview || !preview.count || !!busy} busy={busy === 'run'} onClick={() => void send()}>Send for approval</Button>
      </div>
      {preview && (
        <div className="axp-maintenance__preview">
          <p className="fx-small" style={{ margin: 0 }}><b>{preview.count} item{preview.count === 1 ? '' : 's'}, about {human(preview.bytes)}</b> <span className="fx-muted">· measured {ago(preview.at)}; the VPS checks each one again before removing it</span></p>
          {preview.stale && <Note tone="warning">This preview is old: the host part hasn't reported for a while, so more items may be skipped.</Note>}
          {Object.entries(preview.jobs).map(([id, pj]) => (
            <details key={id} open={pj.count > 0 && pj.count <= 12}>
              <summary className="fx-small">{pj.label}: {pj.count} · {human(pj.bytes)}{pj.kept.length ? ` · ${pj.kept.length} kept` : ''}</summary>
              <ul className="axp-maintenance__list">
                {pj.items.slice(0, 60).map((i) => (
                  <li key={i.id} className="axp-maintenance__row">
                    <span className="axp-maintenance__name"><span className="fx-mono fx-small">{i.ref}</span><span className="fx-small fx-muted">{i.why}</span></span>
                    <span className="axp-maintenance__size">{i.approx ? 'up to ' : ''}{human(i.size)}</span>
                  </li>
                ))}
                {pj.items.length > 60 && <li className="fx-small fx-muted">…and {pj.items.length - 60} more</li>}
                {pj.kept.map((k) => (
                  <li key={`kept-${k.path}`} className="axp-maintenance__row">
                    <span className="axp-maintenance__name"><span className="fx-mono fx-small">{k.path}</span><span className="fx-small fx-muted">kept: {k.why}</span></span>
                    <Chip>{k.state ?? 'kept'}</Chip>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function Runs({ tick }: { tick: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => { api.call<{ runs: Run[] }>('runs').then((r) => setRuns(r.runs), () => setRuns([])); }, [tick]);
  if (!runs.length) return <p className="fx-small fx-muted">No clean-up runs yet.</p>;
  return (
    <ul className="axp-maintenance__list" aria-label="Clean-up runs">
      {runs.map((r) => (
        <li key={r.id} className="axp-maintenance__row">
          <span className="axp-maintenance__name">
            <b>{r.jobs.join(', ')} · {r.count} items · {human(r.bytes)}</b>
            <span className="fx-small fx-muted">{r.kind} by {r.by} · {ago(r.at)}{r.result ? ` · freed ${human(r.result.freed)}, ${r.result.done} removed, ${r.result.skipped} skipped, ${r.result.failed} failed${r.result.diskAfter ? `, disk now ${r.result.diskAfter.pct}%` : ''}` : ''}{r.hub.error ? ` · ${r.hub.error}` : ''}</span>
          </span>
          <Chip tone={RUN_TONE[r.state]}>{RUN_LABEL[r.state]}</Chip>
        </li>
      ))}
    </ul>
  );
}

function MaintenanceView() {
  const { status, error } = useStatus();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.call<Snapshot>('snapshot').then(setSnapshot, () => setSnapshot(null)); }, [status?.summary.at, tick]);
  const s = status?.summary;
  const refresh = () => { void api.post('check', {}).finally(() => { void loadStatus(); setTick((t) => t + 1); }); };
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Plugin · VPS</p><h1>Maintenance</h1><p className="fx-muted" style={{ margin: 0 }}>Server health and safe clean-up.{s?.at ? ` Measured ${ago(s.at)}.` : ''}</p></div>
        <Button icon="refresh" onClick={refresh}>Check now</Button>
      </header>
      {error && <Note tone="danger">{error}</Note>}
      {status?.note && <Note tone="info">{status.note}</Note>}
      {status?.stale && <Note tone="warning">The host part hasn't reported for over 30 minutes. Disk, memory and swap are live; the rest is from the last report.</Note>}
      {s && s.level !== 'ok' && s.level !== 'unknown' && <Note tone={s.level === 'warning' ? 'warning' : 'danger'}>The disk is {s.disk.pct}% full. Preview a clean-up below, or use Auto fix on Server health in the systems check.</Note>}
      {s?.swapFull && <Note tone="warning">Swap has been nearly full for a while: builds and containers slow down. Lower the agent cap or stop idle containers.</Note>}
      <Container title={<span>Server {s && <Chip tone={LEVEL_TONE[s.level]}>{s.level}</Chip>}</span>} icon="monitor">
        {s ? <Gauges s={s} /> : <p className="fx-small fx-muted">Loading…</p>}
      </Container>
      <Container title="Biggest space users" icon="chart"><SpaceUsers snapshot={snapshot} /></Container>
      <Container title={`Build worktrees${snapshot ? ` · ${snapshot.builds.count} · ${human(snapshot.builds.size)}` : ''}`} icon="branch" collapsible defaultOpen={false}><Worktrees snapshot={snapshot} /></Container>
      <Container title="Clean-up" icon="trash"><CleanUp status={status} onSent={() => { void loadStatus(); setTick((t) => t + 1); }} /></Container>
      <Container title="Runs" icon="clock"><Runs tick={tick} /></Container>
    </div>
  );
}

/* ---------------- settings: the framework's settings interface, kept on the server ---------------- */

const K = {
  nightly: 'axf.maintenance.nightly',
  nightlyHour: 'axf.maintenance.nightlyHour',
  nightlyJobs: 'axf.maintenance.nightlyJobs',
  diskWarnPct: 'axf.maintenance.diskWarnPct',
  diskHighPct: 'axf.maintenance.diskHighPct',
  diskCriticalPct: 'axf.maintenance.diskCriticalPct',
  swapFullPct: 'axf.maintenance.swapFullPct',
  swapMinutes: 'axf.maintenance.swapMinutes',
  logDays: 'axf.maintenance.logDays',
  journalDays: 'axf.maintenance.journalDays',
  tmpDays: 'axf.maintenance.tmpDays',
  worktreeIdleHours: 'axf.maintenance.worktreeIdleHours',
  createdHours: 'axf.maintenance.createdHours',
  buildCacheHours: 'axf.maintenance.buildCacheHours',
} as const;
type ServerKey = keyof typeof K;
const BY_KEY = Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k])) as Record<string, ServerKey>;
const SAFE_OPTIONS = [
  { value: 'docker', label: 'Dangling Docker images and build cache' },
  { value: 'logs', label: 'Old logs' },
  { value: 'tmp', label: '/tmp leftovers' },
  { value: 'created', label: 'Containers stuck in Created' },
];
const num = (key: string, label: string, def: number, min: number, max: number, description: string) => ({ key, label, kind: 'number' as const, default: def, min, max, step: 1, description, scope: 'app' as const });

function StatusPanel() {
  const { status, error } = useStatus();
  if (error) return <Note tone="danger">{error}</Note>;
  if (!status) return <p className="fx-small fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <p className="fx-small" style={{ margin: 0 }}>Host part: <b>{status.hostPart ? (status.stale ? 'silent for over 30 min' : 'reporting') : 'not installed'}</b> · axHub: <b>{status.hub ? 'connected' : 'not connected (runs go through the systems check)'}</b></p>
      {status.lastRun && <p className="fx-small fx-muted" style={{ margin: 0 }}>Last run: {RUN_LABEL[status.lastRun.state]}, {ago(status.lastRun.at)} ({status.lastRun.jobs.join(', ')}).</p>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.maintenance',
  label: 'Maintenance',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-04' },
  appMenu,
  views: { maintenance: { title: 'Maintenance', icon: 'monitor', render: () => <MaintenanceView /> } },
  nav: { label: 'Plugins', items: [{ id: 'maintenance', label: 'Maintenance', icon: 'monitor', view: 'maintenance' }] },
  settingsTabs: [{ id: FOLDER, label: 'Maintenance', icon: 'monitor', order: 47, parent: 'plugins' }],
  settings: [
    {
      id: 'maintenance.nightly', label: 'Nightly auto-clean', icon: 'clock', tab: FOLDER, order: 10,
      description: 'Each night the console sends the safe clean-up to axHub as a held call, so it still waits for your approval there. Off by default.',
      settings: [
        { key: K.nightly, label: 'Clean up every night', kind: 'toggle', default: false, scope: 'app' },
        num(K.nightlyHour, 'Hour', 3, 0, 23, 'Hour of the day on the console server clock (0–23).'),
        { key: K.nightlyJobs, label: 'Jobs', kind: 'multi_choice', default: SAFE_OPTIONS.map((o) => o.value), options: SAFE_OPTIONS, scope: 'app', description: 'Only the safe jobs can run at night; build worktrees always need a look first.' },
      ],
    },
    {
      id: 'maintenance.alerts', label: 'Alerts', icon: 'bell', tab: FOLDER, order: 20,
      description: 'Shown in the console and pushed to your phone (error and critical). One alert per level change.',
      settings: [
        num(K.diskWarnPct, 'Disk warning at (%)', 80, 50, 99, 'Bell only.'),
        num(K.diskHighPct, 'Disk high at (%)', 85, 50, 99, 'Bell and phone.'),
        num(K.diskCriticalPct, 'Disk critical at (%)', 90, 50, 99, 'Bell and phone, critical.'),
        num(K.swapFullPct, 'Swap nearly full at (%)', 90, 50, 100, 'Swap at or above this counts as nearly full.'),
        num(K.swapMinutes, 'Swap full for (minutes)', 15, 1, 1440, 'How long swap must stay nearly full before it alerts.'),
      ],
    },
    {
      id: 'maintenance.rules', label: 'What counts as old', icon: 'sliders', tab: FOLDER, order: 30,
      settings: [
        num(K.logDays, 'Logs older than (days)', 14, 1, 365, 'Rotated logs in /var/log and old build logs.'),
        num(K.journalDays, 'Keep the system journal for (days)', 14, 1, 365, 'journalctl --vacuum-time.'),
        num(K.tmpDays, '/tmp untouched for (days)', 7, 1, 365, 'Entries in /tmp and /var/tmp.'),
        num(K.worktreeIdleHours, 'Worktree idle for (hours)', 24, 1, 2160, 'A finished build worktree must be idle this long.'),
        num(K.createdHours, 'Stuck in Created for (hours)', 1, 1, 720, 'Containers created but never started.'),
        num(K.buildCacheHours, 'Build cache unused for (hours)', 24, 1, 2160, 'docker builder prune --filter until=…'),
      ],
    },
  ],
  settingsPanels: [
    { id: 'maintenance.status', tab: FOLDER, title: 'Status', icon: 'monitor', order: 5, render: () => <StatusPanel /> },
    { id: 'maintenance.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    // The server holds the values (the nightly run and the alerts happen there): pull them into this device's settings,
    // then send every change made in the settings interface back. `syncing` keeps the pull from echoing.
    let syncing = false;
    api.call<{ settings: Record<string, unknown> }>('settings').then(({ settings }) => {
      syncing = true;
      try {
        for (const [k, key] of Object.entries(K)) {
          const v = settings[k];
          if (v !== undefined && JSON.stringify(rt.settings.get(key)) !== JSON.stringify(v)) rt.settings.set(key, v as never);
        }
      } finally { syncing = false; }
    }, () => { /* server part off: the settings interface still shows the defaults */ });
    rt.settings.onAnyChange((key, value) => {
      const k = BY_KEY[key];
      if (syncing || !k || value === null) return;
      void api.put('settings', { [k]: value }).catch((e: Error) => rt.toast(`Maintenance settings not saved: ${e.message}`, 'danger'));
    });
  },
};

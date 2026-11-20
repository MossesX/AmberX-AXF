/**
 * Build watchdog (build-watchdog@1) in the console. Brett, Nov 13 2026: "if anything stops working, the server/orchestrator
 * fixes it automatically with no one asking … Never wait for Brett to notice."
 *
 * - WatchdogSettingsPanel: Settings → Plugins → Build orchestrator → Watchdog (a settings panel, so the settings level
 *   toolbar shows or hides it like any other). On/off, interval, stale heartbeat minutes, max retries, retry on another
 *   account, FYI per fix or batched. Saved server-side (PUT watchdog/settings → build-watchdog-settings.json in the shared
 *   pipeline folder), so the host's cron pass reads the same values; the same keys are on the CLI (`watchdog.mjs set`),
 *   MCP and voice.
 * - WatchdogTab: Build orchestrator → Watchdog (a TabGroup tab; deep link #/build-orchestrator/watchdog[?build=<id>]):
 *   the last pass and its age, every build marked running with what the host's probe saw (pid, tmux, heartbeat, exit),
 *   recent fixes (cause → action, attempt, told the phone), builds it gave up on (Requeue), and a Run now toolbar.
 *   Everything here is also GET watchdog/status · POST watchdog/run · POST watchdog/requeue (REST), the watchdog_* MCP
 *   commands, `axf watchdog …` and the voice actions watchdog.run / watchdog.status.
 *   Three layouts (UI Review choice set build-watchdog-panel-lay-mwk6tob9, assets/container/build-watchdog-panel-lay-mwk6tob9-*.json):
 *   stacked (sections one under the other), cards (running builds as cards), split (running beside the fixes on
 *   desktop). The picked one is the default; the Layout control switches per browser (orch-watchdog-layout).
 * - RecoveriesList: a build's own recoveries[] (GET builds/<id>/recoveries) in its expanded detail.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Note, Segmented, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import * as consoleApi from '@console/api';
import { pluginApi } from '@console/plugins';
const FOLDER = 'build-orchestrator'; // = ui.tsx FOLDER (not imported: ui.tsx imports this file)

export interface WatchdogSettings { enabled: boolean; intervalMin: number; staleMin: number; graceMin: number; maxRetries: number; retryOtherAccount: boolean; fyi: 'batch' | 'each'; cooldownMin: number }

export const watchdogApi = pluginApi(FOLDER, 'Build watchdog', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

const NUMBERS: { key: 'intervalMin' | 'staleMin' | 'maxRetries'; label: string; hint: string; min: number; max: number }[] = [
  { key: 'intervalMin', label: 'Interval (minutes)', hint: 'How often a pass runs (the cron ticks every minute and skips until this is due).', min: 1, max: 60 },
  { key: 'staleMin', label: 'Stale heartbeat (minutes)', hint: 'No log or meter output for this long while marked running = hung or dead.', min: 1, max: 240 },
  { key: 'maxRetries', label: 'Max retries', hint: 'Crashes and kills retried this many times since the last ticked step; then Pending with a banner item.', min: 0, max: 10 },
];

function NumberRow({ label, hint, value, min, max, onSave }: { label: string; hint: string; value: number; min: number; max: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const n = Number(v);
  const bad = v === '' || !Number.isInteger(n) || n < min || n > max;
  return (
    <div className="oc-wd-num">
      <TextField label={label} type="number" value={v} onChange={setV} hint={hint} error={bad ? `${min}–${max}` : undefined} />
      <Button size="sm" disabled={bad || n === value} onClick={() => onSave(n)}>Save</Button>
    </div>
  );
}

export function WatchdogSettingsPanel() {
  const [s, setS] = useState<WatchdogSettings | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void watchdogApi.call<{ settings: WatchdogSettings }>('recovery-watchdog/settings').then((r) => setS(r.settings)).catch((e: Error) => setErr(e.message)); }, []);
  const save = async (patch: Partial<WatchdogSettings>) => {
    setErr('');
    try { setS((await watchdogApi.put<{ settings: WatchdogSettings }>('recovery-watchdog/settings', patch)).settings); } catch (e) { setErr((e as Error).message); }
  };
  if (!s) return err ? <Note tone="danger">{err}</Note> : <p className="fx-small fx-muted">Loading…</p>;
  return (
    <div className="fx-stack oc-wd-settings">
      <Switch label="Watchdog on" checked={s.enabled} onChange={(v) => void save({ enabled: v })}
        hint="Builds marked running with no live session (killed, failed, hung, tmux gone) are reset, requeued and retried, idle slots filled, and the phone gets an FYI per fix." />
      {NUMBERS.map((f) => <NumberRow key={f.key} label={f.label} hint={f.hint} value={s[f.key]} min={f.min} max={f.max} onSave={(v) => void save({ [f.key]: v })} />)}
      <Switch label="Retry on another account" checked={s.retryOtherAccount} onChange={(v) => void save({ retryOtherAccount: v })}
        hint="A usage limit or a dead login moves the retry to the next worker account; off = retry on whichever account the dispatcher picks." />
      <SelectField label="Phone FYI" value={s.fyi} onChange={(v) => void save({ fyi: v === 'each' ? 'each' : 'batch' })}
        options={[{ value: 'batch', label: 'Batched: one push per pass' }, { value: 'each', label: 'One push per fix' }]}
        hint="A give-up is always its own alert." />
      {err && <Note tone="danger">{err}</Note>}
    </div>
  );
}

/* ---------------- the Watchdog tab ---------------- */

export interface Recovery { at: string; buildId: string; title?: string; step: string; cause: string; exit: number | null; action: string; attempt: number; account: string; notified: string; note: string }
interface ScanRow { id: string; title: string; status: string; account: string; session: string; launchedAt: string; cause: string; stuck: boolean; action: string; attempt: number; note: string; probe: { pid: boolean | null; tmux: boolean | null; lastSeenAt: string; exit: number | null; exitKind: string; limit: string } }
interface Gave { id: string; title: string; at: string; cause: string; attempt: number; note: string }
export interface WatchdogStatus { settings: WatchdogSettings; cron: { installed: boolean }; lastPass: string; ageMin: number | null; stale: boolean; passes: number; lastScan: { at: string; builds: ScanRow[] } | null; recent: Recovery[]; gaveUp: Gave[]; request: { at: string; by: string } | null }

const ago = (iso: string) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return 'never'; const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const ACTION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'accent' | undefined> = { retry: 'accent', 'kill-retry': 'warning', 'retry-other-account': 'accent', requeue: 'success', 'give-up': 'danger', tick: 'success' };
const signal = (v: boolean | null, label: string) => <Chip tone={v === true ? 'success' : v === false ? 'danger' : undefined}>{label} {v === true ? 'alive' : v === false ? 'gone' : '?'}</Chip>;

/** One recovery as a line: cause → action, attempt, told the phone. */
export function RecoveryLine({ r, showBuild = true }: { r: Recovery; showBuild?: boolean }) {
  return (
    <li className="oc-wd-row">
      <span className="oc-wd-row__main">
        {showBuild && <b>{r.title || r.buildId || 'Idle slots'}</b>}
        <span className="fx-small">{r.cause}{r.exit != null ? ` (exit ${r.exit})` : ''} → <Chip tone={ACTION_TONE[r.action]}>{r.action}</Chip>{r.attempt ? ` attempt ${r.attempt}` : ''}{r.step ? ` · step ${r.step}` : ''}</span>
        {r.note && <span className="fx-small fx-muted">{r.note}</span>}
      </span>
      <span className="oc-wd-row__side fx-small fx-muted">{ago(r.at)}{r.notified ? <> · <Icon name="bell" size={12} /> told the phone</> : ' · not sent yet'}</span>
    </li>
  );
}

export const WATCHDOG_LAYOUTS = ['stacked', 'cards', 'split'] as const;
export type WatchdogLayout = (typeof WATCHDOG_LAYOUTS)[number];
const LAYOUT_LABEL: Record<WatchdogLayout, string> = { stacked: 'Stacked', cards: 'Cards', split: 'Split' };
/** The default until Brett picks one in UI Review (then the pick is written here). */
export const DEFAULT_WATCHDOG_LAYOUT: WatchdogLayout = 'stacked';

export function WatchdogTab({ focus = '' }: { focus?: string }) {
  const rt = useRuntime();
  const [layout, setLayout] = useState<WatchdogLayout>(() => { const v = consoleApi.readLocal<string>('orch-watchdog-layout', DEFAULT_WATCHDOG_LAYOUT); return (WATCHDOG_LAYOUTS as readonly string[]).includes(v) ? v as WatchdogLayout : DEFAULT_WATCHDOG_LAYOUT; });
  useEffect(() => { consoleApi.writeLocal('orch-watchdog-layout', layout); }, [layout]);
  const [s, setS] = useState<WatchdogStatus | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => watchdogApi.call<WatchdogStatus>('recovery-watchdog/status').then((r) => { setS(r); setErr(''); }).catch((e: Error) => setErr(e.message));
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 20_000); return () => window.clearInterval(t); }, []);
  const runNow = async () => {
    setBusy(true);
    try {
      const r = await watchdogApi.post<{ requested?: boolean; fixes?: Recovery[]; at?: string }>('recovery-watchdog/run', {});
      rt.toast(r.requested ? 'Asked the VPS for a watchdog pass: it runs within a minute.' : `Watchdog pass done: ${r.fixes?.length ?? 0} fixed.`, 'success');
      await load();
    } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  const requeue = async (ids: string[]) => {
    setBusy(true);
    try { const r = await watchdogApi.post<{ requeued: string[] }>('recovery-watchdog/requeue', { builds: ids }); rt.toast(`Back in the Queue: ${r.requeued.join(', ') || 'nothing'}`, 'success'); await load(); }
    catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  if (!s) return err ? <Note tone="danger">{err}</Note> : <div className="fx-empty">Loading the watchdog…</div>;
  const rows = s.lastScan?.builds ?? [];
  const recent = focus ? s.recent.filter((r) => r.buildId === focus) : s.recent;
  return (
    <section className="fx-stack oc-wd" data-layout={layout} aria-label="Build watchdog">
      <div className="fx-toolbar oc-wd-bar" role="toolbar" aria-label="Watchdog actions">
        <Button tone="primary" icon="play" disabled={busy} onClick={() => void runNow()}>Run now</Button>
        <Button icon="refresh" disabled={busy} onClick={() => void load()}>Refresh</Button>
        <Segmented label="Layout" value={layout} onChange={(v) => setLayout(v as WatchdogLayout)} options={WATCHDOG_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABEL[l] }))} />
        <span className="fx-small fx-muted" aria-live="polite">
          {s.settings.enabled ? 'On' : 'Off'} · last pass {s.lastPass ? ago(s.lastPass) : 'never'} · every {s.settings.intervalMin} min · {s.passes} passes{s.request ? ` · a pass was asked for ${ago(s.request.at)}` : ''}
        </span>
      </div>
      {s.stale && <Note tone="danger">The watchdog hasn't run {s.ageMin != null ? `for ${s.ageMin} min` : 'yet'}. The systems check's Build watchdog item reinstalls its cron and runs a pass.</Note>}
      {!s.settings.enabled && <Note tone="warning">The watchdog is off (Settings → Plugins → Build orchestrator → Watchdog).</Note>}
      {s.gaveUp.length > 0 && (
        <div className="fx-stack">
          <h3 className="oc-wd-head">Gave up ({s.gaveUp.length})</h3>
          <ul className="oc-wd-list">
            {s.gaveUp.map((g) => (
              <li key={g.id} className="oc-wd-row">
                <span className="oc-wd-row__main"><b>{g.title || g.id}</b><span className="fx-small fx-muted">{g.note}</span></span>
                <Button size="sm" icon="undo" disabled={busy} onClick={() => void requeue([g.id])}>Requeue</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="fx-stack oc-wd-running">
        <h3 className="oc-wd-head">Marked running ({rows.length}){s.lastScan ? <span className="fx-small fx-muted"> · probed {ago(s.lastScan.at)}</span> : null}</h3>
        {rows.length ? (
          <ul className="oc-wd-list">
            {rows.map((r) => (
              <li key={r.id} className={`oc-wd-row${r.id === focus ? ' is-focus' : ''}`}>
                <span className="oc-wd-row__main">
                  <b>{r.title || r.id}</b>
                  <span className="oc-wd-chips">{signal(r.probe.pid, 'pid')}{signal(r.probe.tmux, 'tmux')}<Chip>heartbeat {r.probe.lastSeenAt ? ago(r.probe.lastSeenAt) : 'none'}</Chip>{r.probe.exit != null && <Chip tone="danger">exit {r.probe.exit}</Chip>}</span>
                  <span className="fx-small fx-muted">{r.stuck ? `${r.cause} → ${r.action}${r.attempt ? ` (attempt ${r.attempt})` : ''}: ` : ''}{r.note}</span>
                </span>
                <span className="oc-wd-row__side fx-small fx-muted">{r.account || '—'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="fx-small fx-muted">Nothing marked running at the last pass.</p>}
      </div>
      <div className="fx-stack oc-wd-fixes">
        <h3 className="oc-wd-head">Recent fixes{focus ? ` for ${focus}` : ''} ({recent.length})</h3>
        {recent.length ? <ul className="oc-wd-list">{recent.map((r) => <RecoveryLine key={`${r.buildId}-${r.at}`} r={r} />)}</ul> : <p className="fx-small fx-muted">No fixes yet.</p>}
      </div>
    </section>
  );
}

/** A build's recoveries (its expanded detail): every time the watchdog reset, requeued or retried it. */
export function RecoveriesList({ id }: { id: string }) {
  const [list, setList] = useState<Recovery[] | null>(null);
  useEffect(() => { void watchdogApi.call<{ recoveries: Recovery[] }>(`builds/${encodeURIComponent(id)}/recoveries`).then((r) => setList(r.recoveries)).catch(() => setList([])); }, [id]);
  if (!list || !list.length) return null;
  return (
    <div className="fx-stack oc-wd-recoveries">
      <h4 className="oc-wd-head">Recoveries ({list.length})</h4>
      <ul className="oc-wd-list">{[...list].reverse().map((r) => <RecoveryLine key={r.at} r={r} showBuild={false} />)}</ul>
    </div>
  );
}

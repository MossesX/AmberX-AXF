/**
 * Settings → Plugins → Build orchestrator → Watchdog: the VPS stale-row watchdog (stale-row@1). Brett, Nov 16 2026:
 * "I want a server fucking watchdog on the VPS to do that." Three sub-tabs (framework TabGroup, id
 * build-orchestrator.watchdog.tabs): Settings (on/off, interval, dry run only, which lists, notify), Last runs (Run now,
 * Dry run, what each run found and did) and Cleanups log (every row it completed or removed, with why).
 *
 * The same thing through every other door: REST /api/plugins/build-orchestrator/watchdog, MCP watchdog-* commands,
 * `axf watchdog …`, voice orchestrator.watchdog.*; console-control targets setting:orchestrator.watchdog.<key> and
 * panel:build-orchestrator.watchdog (console_show opens it here).
 */
import { useCallback, useEffect, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Section, Switch, TabGroup, TextField, controlRegistry, useRuntime } from '@console/axf/react';
import {
  WATCHDOG_TABS, dryRun, isWatchdogTab, loadLog, loadStatus, onWatchdogTab, runLine, runNow, saveSettings, showWatchdogTab, watchdogTab,
  type LogRecord, type WatchdogRun, type WatchdogSettings, type WatchdogStatus, type WatchdogTab,
} from './watchdogApi';

const T = 'Stale-row watchdog';
const TABLE_KEYS = [
  { key: 'tables.builds', label: 'Pending, Queue and Building' },
  { key: 'tables.merge-queue', label: 'Merge queue' },
  { key: 'tables.ui-review', label: 'UI Review' },
] as const;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '');

// ---------------------------------------------------------------- console-control targets (registered at start)
let cache: WatchdogSettings | null = null;
const SETTING_KEYS: { key: keyof WatchdogSettings; label: string; parse: (v: unknown) => unknown }[] = [
  { key: 'enabled', label: 'Watchdog: on', parse: (v) => v === true || ['on', 'true', '1', 'yes'].includes(String(v).toLowerCase()) },
  { key: 'intervalMin', label: 'Watchdog: run every (minutes)', parse: (v) => Number(v) },
  { key: 'dryRun', label: 'Watchdog: dry run only', parse: (v) => v === true || ['on', 'true', '1', 'yes'].includes(String(v).toLowerCase()) },
  { key: 'tables.builds', label: 'Watchdog: watch Pending, Queue and Building', parse: (v) => v === true || ['on', 'true', '1', 'yes'].includes(String(v).toLowerCase()) },
  { key: 'tables.merge-queue', label: 'Watchdog: watch the merge queue', parse: (v) => v === true || ['on', 'true', '1', 'yes'].includes(String(v).toLowerCase()) },
  { key: 'tables.ui-review', label: 'Watchdog: watch UI Review', parse: (v) => v === true || ['on', 'true', '1', 'yes'].includes(String(v).toLowerCase()) },
  { key: 'notify', label: 'Watchdog: tell AmberX what was cleaned', parse: (v) => v === true || ['on', 'true', '1', 'yes'].includes(String(v).toLowerCase()) },
];

export function registerWatchdogTargets(rt: AxfRuntime): void {
  const reg = controlRegistry(rt);
  const open = (tab: WatchdogTab = 'settings') => { rt.dispatch('settings.open:build-orchestrator'); showWatchdogTab(tab); };
  reg.register({ address: 'panel:build-orchestrator.watchdog', kind: 'panel', label: 'Stale-row watchdog', keywords: ['watchdog', 'stale', 'cleanup', 'cleanups', 'vps'], open: () => open(),
    get: () => watchdogTab(), set: (v: unknown) => { const t = String(v); if (isWatchdogTab(t)) open(t); return watchdogTab(); } });
  for (const k of SETTING_KEYS) {
    reg.register({
      address: `setting:orchestrator.watchdog.${k.key}`, kind: 'setting', label: k.label, keywords: ['watchdog', 'stale rows', k.key],
      get: () => cache?.[k.key] ?? null,
      set: async (v: unknown) => { cache = (await saveSettings({ [k.key]: k.parse(v) } as Partial<WatchdogSettings>)).settings; return cache[k.key]; },
      open: () => open('settings'),
    });
  }
  void loadStatus(0).then((s) => { cache = s.settings; }, () => { /* the server part may be off: the targets answer null */ });
}

// ---------------------------------------------------------------- the card

export function WatchdogPanel() {
  const rt = useRuntime();
  const [tab, setTab] = useState<WatchdogTab>(watchdogTab());
  const [status, setStatus] = useState<WatchdogStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'run' | 'dry' | 'save'>('');
  const [plan, setPlan] = useState<WatchdogRun | null>(null);
  useEffect(() => onWatchdogTab(setTab), []);
  const reload = useCallback(() => loadStatus(100).then((s) => { setStatus(s); cache = s.settings; setError(''); }, (e: Error) => setError(e.message)), []);
  useEffect(() => { void reload(); }, [reload]);

  const set = async (patch: Partial<WatchdogSettings>) => {
    setBusy('save');
    try { const r = await saveSettings(patch); cache = r.settings; setStatus((s) => (s ? { ...s, settings: r.settings } : s)); }
    catch (e) { rt.toast((e as Error).message, 'danger', T); } finally { setBusy(''); }
  };
  const run = async (dry: boolean) => {
    setBusy(dry ? 'dry' : 'run');
    try { const r = dry ? await dryRun() : await runNow(); rt.toast(runLine(r), r.ok ? 'success' : 'danger', T); if (dry) setPlan(r); await reload(); }
    catch (e) { rt.toast((e as Error).message, 'danger', T); } finally { setBusy(''); }
  };

  if (!status && !error) return <p className="axp-build-orchestrator__wd-muted">Loading…</p>;
  if (!status) return <p className="axp-build-orchestrator__wd-err" role="alert">{error}</p>;
  const s = status.settings;
  return (
    <div className="axp-build-orchestrator__wd">
      <p className="axp-build-orchestrator__wd-muted">
        {s.enabled ? `On, every ${s.intervalMin} min on the VPS` : 'Off'}{s.dryRun ? ' · dry run only' : ''}
        {status.last ? ` · last run ${when(status.last.at)}: ${runLine(status.last)}` : ' · no run yet'}
      </p>
      <div role="toolbar" aria-label="Watchdog actions" className="axp-build-orchestrator__wd-bar">
        <Button id="build-orchestrator-watchdog-run" tone="primary" icon="play" busy={busy === 'run'} disabled={!!busy} onClick={() => void run(false)}>Run now</Button>
        <Button id="build-orchestrator-watchdog-dry-run" icon="eye" busy={busy === 'dry'} disabled={!!busy} onClick={() => void run(true)}>Dry run</Button>
        <Button id="build-orchestrator-watchdog-refresh" tone="ghost" icon="refresh" disabled={!!busy} onClick={() => void reload()}>Refresh</Button>
      </div>
      <TabGroup<WatchdogTab> id="build-orchestrator.watchdog.tabs" label="Watchdog" value={tab} onChange={(t) => { setTab(t); showWatchdogTab(t); }}
        tabs={WATCHDOG_TABS.map((t) => ({ value: t.id, label: t.label }))}>
        {tab === 'settings' && (
          <div className="axp-build-orchestrator__wd-fields">
            <Switch label="Watchdog on" checked={s.enabled} disabled={busy === 'save'} onChange={(v) => void set({ enabled: v })} hint="Every few minutes the VPS takes rows off the builds lists once their PR merged or closed." />
            <IntervalField value={s.intervalMin} disabled={busy === 'save'} onSave={(n) => void set({ intervalMin: n })} />
            <Switch label="Dry run only" checked={s.dryRun} disabled={busy === 'save'} onChange={(v) => void set({ dryRun: v })} hint="Decide and record the plan, change nothing." />
            <Section title="Lists it watches">
              {TABLE_KEYS.map((t) => <Switch key={t.key} label={t.label} checked={s[t.key]} disabled={busy === 'save'} onChange={(v) => void set({ [t.key]: v } as Partial<WatchdogSettings>)} />)}
            </Section>
            <Switch label="Tell the phone what was cleaned" checked={s.notify} disabled={busy === 'save'} onChange={(v) => void set({ notify: v })} hint="One FYI per run that cleaned something (Notifications panel: Watchdog cleaned stale rows)." />
          </div>
        )}
        {tab === 'runs' && (
          <div className="axp-build-orchestrator__wd-list">
            {plan && <RunCard run={plan} title="Dry run: what it would do now" />}
            {status.runs.length ? status.runs.map((r) => <RunCard key={`${r.at}-${r.by}`} run={r} />) : <p className="axp-build-orchestrator__wd-muted">No run yet.</p>}
          </div>
        )}
        {tab === 'log' && <CleanupsLog first={status.log} />}
      </TabGroup>
    </div>
  );
}

function IntervalField({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const n = Number(v); const ok = Number.isInteger(n) && n >= 1 && n <= 120;
  return (
    <div className="axp-build-orchestrator__wd-inline">
      <TextField label="Run every (minutes)" type="number" value={v} onChange={setV} hint="1 to 120. Cron fires every 5 minutes; a longer interval skips the ticks in between." />
      <Button id="build-orchestrator-watchdog-interval-save" disabled={disabled || !ok || n === value} onClick={() => onSave(n)}>Save</Button>
    </div>
  );
}

function RunCard({ run, title }: { run: WatchdogRun; title?: string }) {
  const changes = run.changes ?? [];
  return (
    <Section title={title ?? `${when(run.at)} · ${run.dry ? 'dry run' : 'run'} by ${run.by ?? 'watchdog'}`}>
      <p className={run.ok ? 'axp-build-orchestrator__wd-muted' : 'axp-build-orchestrator__wd-err'}>
        {runLine(run)}{run.durationMs ? ` · ${Math.round(run.durationMs / 100) / 10} s` : ''}{run.facts?.github ? ` · GitHub ${run.facts.github.requests} calls, ${run.facts.github.notModified} unchanged` : ''}
      </p>
      {(run.facts?.errors ?? []).map((e) => <p key={e} className="axp-build-orchestrator__wd-err">{e}</p>)}
      {changes.length > 0 && (
        <ul className="axp-build-orchestrator__wd-rows">
          {changes.map((c) => (
            <li key={`${c.table}:${c.id}`} className={c.applied ? 'is-done' : 'is-skipped'}>
              <span>{c.line}</span>{!c.applied && c.why ? <span className="axp-build-orchestrator__wd-muted"> · {c.why}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function CleanupsLog({ first }: { first: LogRecord[] }) {
  const rt = useRuntime();
  const [records, setRecords] = useState<LogRecord[]>(first);
  const [build, setBuild] = useState('');
  const search = () => void loadLog({ limit: 500, build: build.trim() }).then((r) => setRecords(r.records), (e: Error) => rt.toast(e.message, 'danger', T));
  return (
    <div className="axp-build-orchestrator__wd-list">
      <div className="axp-build-orchestrator__wd-inline">
        <TextField label="Build" value={build} onChange={setBuild} placeholder="any build" />
        <Button id="build-orchestrator-watchdog-log-search" icon="search" onClick={search}>Show</Button>
      </div>
      {records.length ? (
        <ul className="axp-build-orchestrator__wd-rows">
          {records.map((r) => (
            <li key={r.id} className={`is-${r.action}`}>
              <span className="axp-build-orchestrator__wd-muted">{when(r.at)}</span>{' '}
              <span>{r.kind} {r.rowId} → {r.action}: {r.reason}</span>
              {r.evidence.length ? <span className="axp-build-orchestrator__wd-muted"> ({r.evidence.join('; ')})</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="axp-build-orchestrator__wd-muted">Nothing cleaned yet.</p>}
    </div>
  );
}

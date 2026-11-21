/**
 * Settings → Plugins → Build orchestrator → Watchdog: the one build watchdog (build-watchdogs@1) and every watch it runs
 * (build sessions, stuck statuses, left-over rows). Three sub-tabs (framework TabGroup, id build-orchestrator.watchdogs.tabs):
 * Caught (what each watch caught and did, newest first, filtered by watch or build), Watches (each watch: what it does,
 * on/off, last run, Run now) and Settings (the master switch, alerts, and every watch's thresholds, drawn from the
 * schema the server sends, so a new watch or setting shows up here with no change to this file).
 *
 * The same thing through every other door: REST /api/plugins/build-orchestrator/watchdogs, MCP watchdogs-* commands,
 * `axf watchdog …`, voice watchdogs.*; console-control targets panel:build-orchestrator.watchdogs and
 * setting:orchestrator.watchdogs.<key>; deep link build-orchestrator.focus:watchdog[?build=<id>].
 */
import { useCallback, useEffect, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Section, Segmented, Switch, TabGroup, TextField, controlRegistry, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import { FOLDER } from './ui';

const T = 'Build watchdog';

export type Catch = { at: string; watch: string; build: string; title: string; status: string; cause: string; action: string; rung: string; attempt: number; minutes: number; ok: boolean; gaveUp: boolean; notified: string; note: string };
export type WatchState = { id: string; label: string; what?: string; hostOnly?: boolean; available: boolean; error?: string; enabled: boolean; intervalMin?: number; lastRun?: string; lastError?: string; lastCatch?: string; caught?: number; watching?: number; runs?: number };
export type WatchdogsStatus = { enabled: boolean; alerts: string; lastPass: string; ageMin: number | null; stale: boolean; passes: number; host: boolean; cron: { installed: boolean; current: boolean } | null; watches: WatchState[]; caught: Catch[]; gaveUp: Catch[]; request: { at: string; by: string } | null };
export type Spec = { type: 'boolean' | 'integer' | 'choice'; title: string; min?: number; max?: number; options?: string[]; default: boolean | number | string; watch: string };
export type Value = boolean | number | string;
export type WatchdogsSettings = { values: Record<string, Value>; schema: Record<string, Spec>; unavailable: Record<string, string> };
export type Pass = { requested?: boolean; ran?: { id: string; caught: number; errors: string[] }[]; catches?: Catch[] };

export const watchdogsApi = pluginApi(FOLDER, T, { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
export const loadWatchdogs = () => watchdogsApi.call<WatchdogsStatus>('watchdogs');
export const loadWatchdogsSettings = () => watchdogsApi.call<WatchdogsSettings>('watchdogs/settings');
export const saveWatchdogsSettings = (patch: Record<string, Value>) => watchdogsApi.put<WatchdogsSettings>('watchdogs/settings', patch);
export const runWatchdogs = (o: { watch?: string; build?: string } = {}) => watchdogsApi.post<Pass>('watchdogs/run', o);
export const scanWatchdogs = (watch = '') => watchdogsApi.call<{ source: string; note?: string; items: Catch[] }>(`watchdogs/scan${watch ? `?watch=${encodeURIComponent(watch)}` : ''}`);
export const loadCaught = (q: { watch?: string; build?: string; limit?: number } = {}) =>
  watchdogsApi.call<{ caught: Catch[] }>(`watchdogs/caught?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()}`);

/** One line for a pass (toasts, voice). */
export function passLine(r: Pass): string {
  if (r.requested) return 'Asked the VPS for a watchdog pass: it runs within a minute.';
  const errors = (r.ran ?? []).flatMap((x) => x.errors);
  return `Watchdog pass done: ${r.catches?.length ?? 0} caught${errors.length ? `, ${errors.length} error${errors.length === 1 ? '' : 's'} (${errors[0]})` : ''}.`;
}
/** One line for the status (toasts, voice). */
export function statusLine(s: WatchdogsStatus): string {
  const on = s.watches.filter((w) => w.enabled).map((w) => w.label);
  return `Watchdog ${s.enabled ? 'on' : 'off'}${s.stale ? ' but not running' : ''}: last pass ${s.ageMin != null ? `${s.ageMin} min ago` : 'never'}, watching ${on.join(', ') || 'nothing'}, ${s.caught.length} caught lately${s.gaveUp.length ? `, gave up on ${s.gaveUp.length}` : ''}.`;
}
const truthy = (v: unknown) => v === true || ['on', 'true', '1', 'yes'].includes(String(v).toLowerCase());
/** A spoken or typed value as the setting's type. */
export const parseValue = (spec: Spec | undefined, v: unknown): Value => (spec?.type === 'boolean' ? truthy(v) : spec?.type === 'integer' ? Number(v) : String(v));

// ---------------------------------------------------------------- the open sub-tab (switchable from actions)
export const WATCHDOGS_TABS = [{ id: 'caught', label: 'Caught' }, { id: 'watches', label: 'Watches' }, { id: 'settings', label: 'Settings' }] as const;
export type WatchdogsTab = (typeof WATCHDOGS_TABS)[number]['id'];
let current: WatchdogsTab = 'caught';
const listeners = new Set<(t: WatchdogsTab) => void>();
export const isWatchdogsTab = (s: string): s is WatchdogsTab => WATCHDOGS_TABS.some((t) => t.id === s);
export function showWatchdogsTab(t: WatchdogsTab): void { current = t; for (const l of listeners) l(t); }

// ---------------------------------------------------------------- voice / console actions and console-control targets
let cache: WatchdogsSettings | null = null;

export function registerWatchdogs(rt: AxfRuntime): void {
  const fail = (e: Error) => rt.toast(e.message, 'danger', T);
  const open = (tab = '') => { rt.dispatch('settings.open:build-orchestrator'); showWatchdogsTab(isWatchdogsTab(tab) ? tab : 'caught'); };
  rt.actions.register('watchdogs.open', ([tab = '']) => open(decodeURIComponent(tab)), { label: 'Open the build watchdog (caught, watches, settings)', params: true, effect: 'navigate' });
  rt.actions.register('watchdogs.status', () => { void loadWatchdogs().then((s) => rt.toast(statusLine(s), s.stale ? 'warning' : 'info', T), fail); }, { label: 'Build watchdog: is it running and what did it catch', effect: 'read' });
  rt.actions.register('watchdogs.run', ([watch = '', build = '']) => {
    void runWatchdogs({ watch: decodeURIComponent(watch) || undefined, build: decodeURIComponent(build) || undefined }).then((r) => rt.toast(passLine(r), 'success', T), fail);
  }, { label: 'Build watchdog: run a pass now (optionally one watch, one build)', params: true, effect: 'write' });
  rt.actions.register('watchdogs.scan', ([watch = '']) => {
    void scanWatchdogs(decodeURIComponent(watch)).then((r) => rt.toast(r.note ?? `Dry run: ${r.items.length} to catch${r.items.length ? ` (${r.items.slice(0, 3).map((c) => `${c.build || c.watch}: ${c.action}`).join(', ')})` : ''}.`, 'info', T), fail);
  }, { label: 'Build watchdog: what would it catch now (dry run)', params: true, effect: 'read' });
  rt.actions.register('watchdogs.set', ([key = '', value = '']) => {
    const k = decodeURIComponent(key); const v = decodeURIComponent(value);
    if (!k || !v) { rt.toast('Say a setting and a value, for example watchdogs.set:stale.limit.fixing:45.', 'warning', T); return; }
    void (cache ? Promise.resolve(cache) : loadWatchdogsSettings()).then((s) => saveWatchdogsSettings({ [k]: parseValue(s.schema[k], v) })).then((s) => { cache = s; rt.toast(`${k} is ${String(s.values[k])}.`, 'success', T); }, fail);
  }, { label: 'Build watchdog: change a setting', params: true, effect: 'write' });

  const reg = controlRegistry(rt);
  reg.register({ address: 'panel:build-orchestrator.watchdogs', kind: 'panel', label: 'Build watchdog', keywords: ['watchdog', 'watchdogs', 'stuck', 'stale', 'caught', 'sessions', 'vps'], open: () => open(),
    get: () => current, set: (v: unknown) => { const t = String(v); if (isWatchdogsTab(t)) open(t); return current; } });
  // every setting the server lists becomes a target, so a setting a later watch adds is reachable with no change here
  void loadWatchdogsSettings().then((s) => {
    cache = s;
    for (const [key, spec] of Object.entries(s.schema)) {
      reg.register({ address: `setting:orchestrator.watchdogs.${key}`, kind: 'setting', label: `Watchdog: ${spec.title}`, keywords: ['watchdog', spec.watch, key].filter(Boolean),
        get: () => cache?.values[key] ?? null,
        set: async (v: unknown) => { cache = await saveWatchdogsSettings({ [key]: parseValue(spec, v) }); return cache.values[key]; },
        open: () => open('settings') });
    }
  }, () => { /* the server part may be off: only the panel target answers */ });
}

// ---------------------------------------------------------------- the panel

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : 'never');

export function WatchdogsPanel() {
  const rt = useRuntime();
  const [tab, setTab] = useState<WatchdogsTab>(current);
  const [status, setStatus] = useState<WatchdogsStatus | null>(null);
  const [settings, setSettings] = useState<WatchdogsSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState<{ note?: string; items: Catch[] } | null>(null);
  useEffect(() => { listeners.add(setTab); return () => { listeners.delete(setTab); }; }, []);
  const reload = useCallback(() => Promise.all([loadWatchdogs(), loadWatchdogsSettings()]).then(([s, c]) => { setStatus(s); setSettings(c); cache = c; setError(''); }, (e: Error) => setError(e.message)), []);
  useEffect(() => { void reload(); }, [reload]);

  const save = async (patch: Record<string, Value>) => {
    setBusy('save');
    try { const c = await saveWatchdogsSettings(patch); setSettings(c); cache = c; void loadWatchdogs().then(setStatus, () => { /* the next reload shows it */ }); }
    catch (e) { rt.toast((e as Error).message, 'danger', T); } finally { setBusy(''); }
  };
  const run = async (watch = '') => {
    setBusy(`run:${watch}`);
    try { const r = await runWatchdogs(watch ? { watch } : {}); rt.toast(passLine(r), 'success', T); await reload(); }
    catch (e) { rt.toast((e as Error).message, 'danger', T); } finally { setBusy(''); }
  };
  const dry = async (watch = '') => {
    setBusy(`dry:${watch}`);
    try { const r = await scanWatchdogs(watch); setPlan(r); setTab('caught'); showWatchdogsTab('caught'); }
    catch (e) { rt.toast((e as Error).message, 'danger', T); } finally { setBusy(''); }
  };

  if (!status && !error) return <p className="axp-build-orchestrator__wd-muted">Loading…</p>;
  if (!status || !settings) return <p className="axp-build-orchestrator__wd-err" role="alert">{error || 'The watchdog did not answer.'}</p>;
  return (
    <div className="axp-build-orchestrator__wd">
      <p className={status.stale ? 'axp-build-orchestrator__wd-err' : 'axp-build-orchestrator__wd-muted'} role={status.stale ? 'alert' : undefined}>
        {status.enabled ? (status.stale ? 'On, but the VPS has not run it' : 'On') : 'Off'} · last pass {status.ageMin != null ? `${status.ageMin} min ago` : 'never'}
        {status.request ? ` · a pass was asked for ${when(status.request.at)}` : ''}{status.gaveUp.length ? ` · gave up on ${status.gaveUp.length}` : ''}
      </p>
      <div role="toolbar" aria-label="Watchdog actions" className="axp-build-orchestrator__wd-bar">
        <Button id="build-orchestrator-watchdogs-run" tone="primary" icon="play" busy={busy === 'run:'} disabled={!!busy} onClick={() => void run()}>Run now</Button>
        <Button id="build-orchestrator-watchdogs-dry-run" icon="eye" busy={busy === 'dry:'} disabled={!!busy} onClick={() => void dry()}>Dry run</Button>
        <Button id="build-orchestrator-watchdogs-refresh" tone="ghost" icon="refresh" disabled={!!busy} onClick={() => void reload()}>Refresh</Button>
      </div>
      <TabGroup<WatchdogsTab> id="build-orchestrator.watchdogs.tabs" label="Build watchdog" value={tab} onChange={(t) => { setTab(t); showWatchdogsTab(t); }}
        tabs={WATCHDOGS_TABS.map((t) => ({ value: t.id, label: t.label }))}>
        {tab === 'caught' && <CaughtList first={status.caught} watches={status.watches} plan={plan} onClearPlan={() => setPlan(null)} />}
        {tab === 'watches' && (
          <div className="axp-build-orchestrator__wd-list">
            {status.watches.map((w) => (
              <Section key={w.id} title={w.label}>
                {w.available ? (
                  <>
                    <p className="axp-build-orchestrator__wd-muted">{w.what}</p>
                    <Switch label={`${w.label}: on`} checked={settings.values[`${w.id}.enabled`] !== false} disabled={busy === 'save'} onChange={(v) => void save({ [`${w.id}.enabled`]: v })}
                      hint={status.enabled ? undefined : 'The watchdog itself is off (Settings tab): no watch runs.'} />
                    <div className="oc-wd-chips">
                      <Chip tone={w.enabled ? 'success' : undefined}>{w.enabled ? `every ${w.intervalMin ?? 1} min` : 'off'}</Chip>
                      <Chip>last run {when(w.lastRun)}</Chip>
                      <Chip>{w.watching ?? 0} watched</Chip>
                      <Chip tone={w.caught ? 'accent' : undefined}>{w.caught ?? 0} caught</Chip>
                      {w.hostOnly && <Chip>runs on the VPS</Chip>}
                    </div>
                    {w.lastError && <p className="axp-build-orchestrator__wd-err" role="alert">Last error: {w.lastError}</p>}
                    <div className="axp-build-orchestrator__wd-bar">
                      <Button id={`build-orchestrator-watchdogs-run-${w.id}`} icon="play" busy={busy === `run:${w.id}`} disabled={!!busy} onClick={() => void run(w.id)}>Run this watch</Button>
                      <Button id={`build-orchestrator-watchdogs-dry-${w.id}`} tone="ghost" icon="eye" busy={busy === `dry:${w.id}`} disabled={!!busy} onClick={() => void dry(w.id)}>Dry run</Button>
                    </div>
                  </>
                ) : <p className="axp-build-orchestrator__wd-err" role="alert">This watch could not load: {w.error}</p>}
              </Section>
            ))}
          </div>
        )}
        {tab === 'settings' && (
          <div className="axp-build-orchestrator__wd-fields">
            <Section title="Watchdog">
              {Object.entries(settings.schema).filter(([, s]) => !s.watch).map(([k, s]) => <SettingField key={k} id={k} spec={s} value={settings.values[k] ?? s.default} disabled={busy === 'save'} onSave={(v) => void save({ [k]: v })} />)}
            </Section>
            {status.watches.filter((w) => w.available).map((w) => (
              <Section key={w.id} title={w.label}>
                {Object.entries(settings.schema).filter(([, s]) => s.watch === w.id).map(([k, s]) => <SettingField key={k} id={k} spec={s} value={settings.values[k] ?? s.default} disabled={busy === 'save'} onSave={(v) => void save({ [k]: v })} />)}
              </Section>
            ))}
            {Object.entries(settings.unavailable).map(([id, why]) => <p key={id} className="axp-build-orchestrator__wd-err">{id}: its settings could not be read ({why})</p>)}
          </div>
        )}
      </TabGroup>
    </div>
  );
}

/** One setting drawn from its schema entry: a switch, a number with Save, or a choice. */
function SettingField({ id, spec, value, disabled, onSave }: { id: string; spec: Spec; value: Value; disabled: boolean; onSave: (v: Value) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  if (spec.type === 'boolean') return <Switch label={spec.title} checked={value === true} disabled={disabled} onChange={(on) => onSave(on)} />;
  if (spec.type === 'choice') {
    return (
      <div className="axp-build-orchestrator__wd-inline">
        <span className="axp-build-orchestrator__wd-muted">{spec.title}</span>
        <Segmented<string> label={spec.title} size="sm" value={String(value)} disabled={disabled} options={(spec.options ?? []).map((o) => ({ value: o, label: o }))} onChange={(o) => onSave(o)} />
      </div>
    );
  }
  const n = Number(v); const ok = Number.isInteger(n) && n >= (spec.min ?? -Infinity) && n <= (spec.max ?? Infinity);
  return (
    <div className="axp-build-orchestrator__wd-inline">
      <TextField label={spec.title} type="number" value={v} onChange={setV} hint={`${spec.min ?? 0} to ${spec.max ?? ''}. Default ${String(spec.default)}.`} />
      <Button id={`build-orchestrator-watchdogs-save-${id.replace(/[^a-z0-9]+/gi, '-')}`} disabled={disabled || !ok || n === value} onClick={() => onSave(n)}>Save</Button>
    </div>
  );
}

function CatchRows({ items, planned }: { items: Catch[]; planned?: boolean }) {
  return (
    <ul className="axp-build-orchestrator__wd-rows">
      {items.map((c, i) => (
        <li key={`${c.at}-${c.watch}-${c.build}-${i}`} className={planned ? 'is-skipped' : c.ok === false ? 'is-remove' : c.gaveUp ? 'is-remove' : 'is-done'}>
          <strong>{c.title || c.build || c.watch}</strong>{' '}
          <Chip>{c.watch}</Chip>{' '}
          {c.gaveUp && <Chip tone="danger">gave up</Chip>}{!planned && c.ok === false && <Chip tone="warning">not done</Chip>}
          <div>{c.status ? `${c.status}: ` : ''}{c.cause} → {c.action}{c.rung ? ` (${c.rung})` : ''}{c.attempt ? ` · attempt ${c.attempt}` : ''}</div>
          {c.note && <div className="axp-build-orchestrator__wd-muted">{c.note}</div>}
          {!planned && <div className="axp-build-orchestrator__wd-muted">{when(c.at)}{c.notified ? ' · phone told' : ''}{c.build ? ` · ${c.build}` : ''}</div>}
        </li>
      ))}
    </ul>
  );
}

function CaughtList({ first, watches, plan, onClearPlan }: { first: Catch[]; watches: WatchState[]; plan: { note?: string; items: Catch[] } | null; onClearPlan: () => void }) {
  const focus = consoleApi.readLocal<string>('orch-watchdog-build', '');
  const [watch, setWatch] = useState('');
  const [build, setBuild] = useState(focus);
  const [items, setItems] = useState<Catch[]>(first);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!watch && !build) { setItems(first); return; }
    let live = true;
    loadCaught({ watch, build, limit: 200 }).then((r) => { if (live) { setItems(r.caught); setError(''); } }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [watch, build, first]);
  return (
    <div className="axp-build-orchestrator__wd-list">
      {plan && (
        <Section title="Dry run: what it would do now">
          {plan.note && <p className="axp-build-orchestrator__wd-muted">{plan.note}</p>}
          {plan.items.length ? <CatchRows items={plan.items} planned /> : !plan.note && <p className="axp-build-orchestrator__wd-muted">Nothing to catch right now.</p>}
          <Button id="build-orchestrator-watchdogs-plan-close" tone="ghost" onClick={onClearPlan}>Close</Button>
        </Section>
      )}
      <div className="axp-build-orchestrator__wd-inline">
        <Segmented<string> label="Watch" size="sm" value={watch} onChange={setWatch} options={[{ value: '', label: 'All' }, ...watches.map((w) => ({ value: w.id, label: w.label }))]} />
        {build && <span className="axp-build-orchestrator__wd-muted">Only {build}</span>}
        {build && <Button id="build-orchestrator-watchdogs-build-clear" tone="ghost" icon="x" onClick={() => { consoleApi.writeLocal('orch-watchdog-build', ''); setBuild(''); }}>Show all builds</Button>}
      </div>
      {error && <p className="axp-build-orchestrator__wd-err" role="alert">{error}</p>}
      {items.length ? <CatchRows items={items} /> : <p className="axp-build-orchestrator__wd-muted">Nothing caught{watch || build ? ' for this filter' : ' yet'}.</p>}
    </div>
  );
}

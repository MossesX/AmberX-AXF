/**
 * VPS Settings console plugin (ai.amberx.axf.console.vps-settings): view and change the settings the VPS itself enforces
 * (vps-settings@1, framework/cli/vps-settings.mjs). Brett, Nov 9 2026: "I need a rule on the VPS that refuses any job that
 * doesn't come from the orchestrator. ... Now how would I manage that setting? I need a console plugin to manage the VPS
 * settings."
 *
 * Settings → Plugins → VPS Settings (deep link settings:vps-settings):
 * - Launch rules: Only the orchestrator starts builds (on/off), Phone notice on a refused job, notice spacing, log size.
 *   Switching the rule off is Brett's own click (the server answers 403 to a session, MCP or voice).
 * - Refused jobs: the refused-jobs log, newest first (refused, or allowed only because the rule was off), with Refresh
 *   and Clear.
 * Every action here is also a REST route, so the plugin-commands registry exposes it to MCP, the CLI and voice.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './vps.css';

const FOLDER = 'vps-settings';
type Value = boolean | number;
interface Setting { key: string; type: 'bool' | 'int'; default: Value; min?: number; max?: number; group: string; label: string; hint: string; value: Value; changed: { at: string; by: string } | null }
interface Refusal { id: string; at: string; outcome: 'refused' | 'allowed-off' | 'cleared'; build: string; name: string; launcher: string; by: string; why: string; notified: string }
interface State { settings: Setting[]; values: Record<string, Value>; refused: Refusal[]; counts: { refused24h: number; shown: number } }

const api = pluginApi(FOLDER, 'VPS Settings', { unavailable: 'The VPS Settings plugin is switched off or its server part is not running.' });

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const OUTCOME: Record<Refusal['outcome'], { label: string; tone?: 'danger' | 'warning' }> = {
  refused: { label: 'Refused', tone: 'danger' }, 'allowed-off': { label: 'Allowed (rule off)', tone: 'warning' }, cleared: { label: 'Log cleared' },
};

function useVpsState() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const reload = () => api.call<State>('state').then((x) => { setS(x); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void reload(); const f = () => { if (document.visibilityState === 'visible') void reload(); }; window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, []);
  return { s, err, reload };
}

function NumberSetting({ s, onSave }: { s: Setting; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(s.value));
  useEffect(() => { setV(String(s.value)); }, [s.value]);
  const n = Number(v);
  const bad = v === '' || !Number.isInteger(n) || n < (s.min ?? 0) || n > (s.max ?? 1e9);
  return (
    <div className="axp-vps__num">
      <TextField label={s.label} type="number" value={v} onChange={setV} hint={s.hint} error={bad ? `${s.min}–${s.max}` : undefined} />
      <Button size="sm" disabled={bad || n === s.value} onClick={() => onSave(n)}>Save</Button>
    </div>
  );
}

function RulesPanel() {
  const rt = useRuntime();
  const { s, err, reload } = useVpsState();
  const save = async (patch: Record<string, Value>) => {
    try { await api.put('settings', patch); await reload(); rt.toast('Saved: the next launch on the VPS uses it', 'success'); } catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (err) return <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {err}</p>;
  if (!s) return <p className="fx-small fx-muted">Loading…</p>;
  const changed = (x: Setting) => (x.changed ? ` Last changed by ${x.changed.by}, ${when(x.changed.at)}.` : '');
  return (
    <div className="fx-stack axp-vps">
      <p className="fx-small fx-muted axp-vps__lead">Rules the VPS enforces on every launch, read fresh each time: nothing to restart.</p>
      {!s.values.orchestratorOnly && (
        <p className="fx-small axp-vps__warn" role="alert"><Icon name="alert" size={14} /> The orchestrator-only rule is off: any build launch starts on the VPS. Refusals it would have made are logged as "Allowed (rule off)".</p>
      )}
      {s.settings.map((x) => (x.type === 'bool'
        ? <Switch key={x.key} label={x.label} checked={x.value === true} hint={`${x.hint}${changed(x)}`} onChange={(on) => void save({ [x.key]: on })} />
        : <NumberSetting key={x.key} s={x} onSave={(v) => void save({ [x.key]: v })} />))}
    </div>
  );
}

function RefusedPanel() {
  const rt = useRuntime();
  const { s, err, reload } = useVpsState();
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    try { await api.post('refused/clear', {}); await reload(); rt.toast('Refused-jobs log cleared', 'success'); } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  if (err) return <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {err}</p>;
  if (!s) return <p className="fx-small fx-muted">Loading…</p>;
  const rows = s.refused.filter((r) => r.outcome !== 'cleared');
  return (
    <div className="fx-stack axp-vps">
      <div className="axp-vps__bar" role="toolbar" aria-label="Refused jobs">
        <span className="fx-small fx-muted">{s.counts.refused24h} refused in the last 24 h</span>
        <Button size="sm" icon="refresh" onClick={() => void reload()}>Refresh</Button>
        <Button size="sm" icon="trash" tone="quiet" disabled={busy || !rows.length} onClick={() => void clear()}>Clear log</Button>
      </div>
      {rows.length ? (
        <ul className="axp-vps__list" aria-label="Refused jobs, newest first">
          {rows.map((r) => (
            <li key={r.id} className="axp-vps__row">
              <span className="axp-vps__head">
                <Chip tone={OUTCOME[r.outcome]?.tone}>{OUTCOME[r.outcome]?.label ?? r.outcome}</Chip>
                <b className="fx-mono">{r.build || r.name}</b>
                <span className="fx-small fx-muted">{when(r.at)}{r.launcher ? ` · via ${r.launcher}` : ''}{r.by ? ` · ${r.by}` : ''}{r.notified ? ` · phone: ${r.notified}` : ''}</span>
              </span>
              <span className="fx-small axp-vps__why">{r.why}</span>
            </li>
          ))}
        </ul>
      ) : <p className="fx-small fx-muted">No refused jobs: every build launch came from the orchestrator.</p>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.vps-settings',
  label: 'VPS Settings',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-10' },
  appMenu,
  settingsTabs: [{ id: FOLDER, label: 'VPS Settings', icon: 'shield', order: 47, parent: 'plugins' }],
  settingsPanels: [
    { id: 'vps-settings.rules', tab: FOLDER, title: 'Launch rules', icon: 'shield', order: 10, render: () => <RulesPanel /> },
    { id: 'vps-settings.refused', tab: FOLDER, title: 'Refused jobs', icon: 'list', order: 20, render: () => <RefusedPanel /> },
    { id: 'vps-settings.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

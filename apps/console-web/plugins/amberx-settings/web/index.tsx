/**
 * AmberX settings console plugin (ai.amberx.axf.console.amberx-settings; Nov 12 2026, Opus, build
 * move-amberx-web-app-into-the-console-amberx-andr s10).
 *
 * Settings → Plugins → AmberX: the AmberX app's settings (voice, the axHub watch, links, quiet) as the hub's
 * hub-settings@1 document holds them for every phone. Every control is a route of this plugin's server
 * (GET settings, PUT settings/{key}, POST settings/{key}/reset), so MCP (amberx-settings_*), the CLI
 * (`axf amberx-settings …`) and voice change the same values. The watch's auto-approve switches change only from a
 * signed-in browser (the server refuses a token).
 *
 * Deep link: settings tab `amberx` (console_settings("amberx")); one setting: amberx-settings.focus:<key>.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './amberx-settings.css';

const ID = 'ai.amberx.axf.console.amberx-settings';
const FOLDER = 'amberx-settings';
const TAB = 'amberx';
const FOCUS_EVENT = 'amberx-settings:focus';

interface Setting { key: string; label: string; kind: 'toggle' | 'number' | 'choice' | 'text'; default: unknown; value: unknown; overridden: boolean; group?: string; options?: string[]; min?: number; max?: number; step?: number; sensitive?: boolean }

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  const r = await pluginFetch(FOLDER, path, init);
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

function Row({ s, onSet, onReset, focused }: { s: Setting; onSet: (key: string, v: unknown) => void; onReset: (key: string) => void; focused: boolean }) {
  const [text, setText] = useState(String(s.value ?? ''));
  useEffect(() => setText(String(s.value ?? '')), [s.value]);
  const control = s.kind === 'toggle' ? <Switch label={s.label} checked={s.value === true} onChange={(v) => onSet(s.key, v)} />
    : s.kind === 'choice' ? <SelectField label={s.label} value={String(s.value)} onChange={(v) => onSet(s.key, v)} options={(s.options ?? []).map((o) => ({ value: o, label: o }))} />
    : (
      <span className="axp-amberx-settings__edit">
        <TextField label={s.label} type={s.kind === 'number' ? 'number' : 'text'} value={text} onChange={setText} hint={s.kind === 'number' ? `${s.min} to ${s.max}` : undefined} />
        <Button size="sm" disabled={text === String(s.value ?? '')} onClick={() => onSet(s.key, s.kind === 'number' ? Number(text) : text)}>Save</Button>
      </span>
    );
  return (
    <div className={`axp-amberx-settings__row${focused ? ' is-focused' : ''}`} data-setting={s.key}>
      {control}
      <span className="axp-amberx-settings__meta">
        <code>{s.key}</code>
        {s.sensitive && <Chip tone="warning">Your browser only</Chip>}
        {s.overridden && <Button size="sm" tone="ghost" onClick={() => onReset(s.key)}>Default</Button>}
      </span>
    </div>
  );
}

export function AmberxSettingsPanel() {
  const rt = useRuntime();
  const [rows, setRows] = useState<Setting[]>([]);
  const [meta, setMeta] = useState<{ updatedAt?: string; updatedBy?: string; live?: boolean }>({});
  const [focus, setFocus] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await call('settings');
    if (r.status !== 200) { setErr(r.json.detail || `The console answered ${r.status}.`); return; }
    setRows(r.json.settings ?? []); setMeta(r.json); setErr('');
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = (e: Event) => setFocus(decodeURIComponent(String((e as CustomEvent).detail ?? '')));
    window.addEventListener(FOCUS_EVENT, on);
    const w = window as { __amberxSettingsFocus?: string };
    if (w.__amberxSettingsFocus) { setFocus(w.__amberxSettingsFocus); w.__amberxSettingsFocus = undefined; }
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, []);
  useEffect(() => { if (focus) document.querySelector(`[data-setting="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'center' }); }, [focus, rows]);
  const done = (r: { status: number; json: any }, ok: string) => {
    if (r.status !== 200) { rt.toast(r.json.detail || 'Not saved.', 'danger', 'AmberX settings'); return; }
    rt.toast(ok, 'success', 'AmberX settings'); void load();
  };
  const onSet = async (key: string, value: unknown) => done(await call(`settings/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) }), 'Saved for every phone.');
  const onReset = async (key: string) => done(await call(`settings/${encodeURIComponent(key)}/reset`, { method: 'POST' }), 'Back to the default.');
  const groups = [...new Set(rows.map((r) => r.group ?? 'Other'))];
  return (
    <div className="axp-amberx-settings" data-help="amberx">
      <p className="fx-muted">AmberX's settings for every phone, kept on axHub; each phone follows on its next settings refresh.{meta.updatedAt ? ` Last change ${new Date(meta.updatedAt).toLocaleString()} by ${meta.updatedBy || 'unknown'}.` : ''}</p>
      {meta.live === false && <Note tone="warning">axHub's projects aren't mounted on this console: changes are kept here and don't reach the phones.</Note>}
      {err && <Note tone="warning">{err}</Note>}
      {groups.map((g) => (
        <section key={g} className="axp-amberx-settings__group">
          <h3>{g}</h3>
          {rows.filter((r) => (r.group ?? 'Other') === g).map((s) => <Row key={s.key} s={s} onSet={(k, v) => void onSet(k, v)} onReset={(k) => void onReset(k)} focused={focus === s.key} />)}
        </section>
      ))}
    </div>
  );
}

type VoiceRegistry = { register: (module: string, commands: { id: string; phrases: string[]; action: string; reply?: string; owner?: string }[]) => () => void };

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'AmberX settings',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-12' },
  appMenu,
  settingsTabs: [{ id: TAB, label: 'AmberX', icon: 'smartphone', order: 90, parent: 'plugins', description: "The AmberX app's settings for every phone: voice, the axHub watch, links, quiet" }],
  settingsPanels: [
    { id: 'amberx-settings.all', tab: TAB, title: 'AmberX on every phone', icon: 'smartphone', order: 10, render: () => <AmberxSettingsPanel /> },
    { id: 'amberx-settings.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    rt.actions.register('amberx-settings.open', () => rt.dispatch(`settings.open:${TAB}`), { label: 'AmberX settings', effect: 'navigate' });
    rt.actions.register('amberx-settings.focus', ([key]) => {
      (window as { __amberxSettingsFocus?: string }).__amberxSettingsFocus = key ?? '';
      rt.dispatch(`settings.open:${TAB}`);
      setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: key ?? '' })), 50);
    }, { label: 'AmberX settings: one setting (its key, e.g. voice.lang)', params: true, effect: 'navigate' });
    // the backend switch (s13): which site the phone app opens on its next start
    const backend = (value: 'console' | 'amberx-web') => void pluginFetch(FOLDER, 'settings/backend', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) })
      .then((r) => rt.toast(r.ok ? `The phone app opens ${value === 'console' ? 'the console' : 'the old AmberX web app'} from its next start.` : `Not switched (${r.status}).`, r.ok ? 'success' : 'danger', 'AmberX settings'));
    rt.actions.register('amberx-settings.backend-console', () => backend('console'), { label: 'Phone app: open the console' });
    rt.actions.register('amberx-settings.backend-amberx-web', () => backend('amberx-web'), { label: 'Phone app: open the old AmberX web app' });
    (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice?.register(ID, [
      { id: 'amberx-settings.backend-console', phrases: ['switch the phone to the console', 'use the console backend'], action: 'amberx-settings.backend-console', owner: 'Settings' },
      { id: 'amberx-settings.backend-amberx-web', phrases: ['switch the phone back to amberx', 'use the old amberx backend'], action: 'amberx-settings.backend-amberx-web', owner: 'Settings' },
      { id: 'amberx-settings.open', phrases: ['open amberx settings', 'phone settings'], action: 'amberx-settings.open', owner: 'Settings' },
    ]);
  },
};

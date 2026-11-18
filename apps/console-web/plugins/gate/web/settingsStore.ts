/**
 * The plugin's server-side settings, cached for the console-control targets (`setting:gate.<key>`, registered at start
 * so voice and remote callers reach them without the settings tab open). One write path: PUT settings.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { gateCall, isTab, type GateSettings } from './api';
import { autoLanderPath, type AutoLanderSettings } from './autoLanderState';

let cache: GateSettings | null = null;
export async function loadSettings(): Promise<GateSettings> { cache = (await gateCall<{ settings: GateSettings }>('settings')).settings; return cache; }
export async function saveSettings(patch: Partial<GateSettings>): Promise<GateSettings> { cache = (await gateCall<{ settings: GateSettings }>('settings', 'PUT', patch)).settings; return cache; }

const KEYS: { key: keyof GateSettings; label: string; parse: (v: unknown) => unknown }[] = [
  { key: 'refreshSec', label: 'Gate: refresh every (seconds)', parse: (v) => Number(v) },
  { key: 'historySize', label: 'Gate: history size', parse: (v) => Number(v) },
  { key: 'defaultTab', label: 'Gate: tab it opens on', parse: (v) => (isTab(v) ? v : String(v)) },
  { key: 'heldAlertMin', label: 'Gate: held PR alert after (minutes)', parse: (v) => Number(v) },
];

// the server auto-lander's settings (deploy/auto-lander, POST auto-lander/settings): the same call as MCP, CLI and voice
let alCache: AutoLanderSettings | null = null;
export async function loadAutoLanderSettings(): Promise<AutoLanderSettings> { alCache = (await gateCall<{ settings: AutoLanderSettings }>(autoLanderPath('settings'))).settings; return alCache; }
export async function saveAutoLanderSettings(patch: Partial<Record<keyof AutoLanderSettings, unknown>>): Promise<AutoLanderSettings> { alCache = (await gateCall<{ settings: AutoLanderSettings }>(autoLanderPath('settings'), 'POST', patch)).settings; return alCache; }
const onOff = (v: unknown) => v === true || v === 'on' || v === 'true' || v === '1';
const AL_KEYS: { key: keyof AutoLanderSettings; label: string; parse: (v: unknown) => unknown }[] = [
  { key: 'enabled', label: 'Auto-lander: fix and land by itself', parse: onOff },
  { key: 'maxAttempts', label: 'Auto-lander: tries before it asks for a hand', parse: (v) => Number(v) },
  { key: 'backoffBaseMin', label: 'Auto-lander: first wait (minutes)', parse: (v) => Number(v) },
  { key: 'backoffFactor', label: 'Auto-lander: wait grows by', parse: (v) => Number(v) },
  { key: 'backoffMaxMin', label: 'Auto-lander: longest wait (minutes)', parse: (v) => Number(v) },
  { key: 'attemptTimeoutMin', label: 'Auto-lander: a try times out after (minutes)', parse: (v) => Number(v) },
  { key: 'pushOnEscalation', label: 'Auto-lander: push when it gives up', parse: onOff },
];

export function registerSettingTargets(rt: AxfRuntime): void {
  const reg = controlRegistry(rt);
  for (const k of KEYS) {
    reg.register({
      address: `setting:gate.${k.key}`, kind: 'setting', label: k.label, keywords: ['gate', 'settings', k.key],
      get: () => cache?.[k.key] ?? null,
      set: async (v: unknown) => (await saveSettings({ [k.key]: k.parse(v) } as Partial<GateSettings>))[k.key],
      open: () => { rt.dispatch('settings.open:gate'); },
    });
  }
  void loadSettings().catch(() => { /* the server part may be off: the targets answer null */ });
  // control@1 / console-control@1 entries for the server auto-lander's settings, after the plugin's own
  for (const k of AL_KEYS) {
    reg.register({
      address: `setting:gate.autoLander.${k.key}`, kind: 'setting', label: k.label, keywords: ['gate', 'auto-lander', 'server', 'settings', k.key],
      get: () => alCache?.[k.key] ?? null,
      set: async (v: unknown) => (await saveAutoLanderSettings({ [k.key]: k.parse(v) }))[k.key],
      open: () => { rt.dispatch('settings.open:gate'); },
    });
  }
  void loadAutoLanderSettings().catch(() => { /* the auto-lander may not be installed: the targets answer null */ });
  rt.actions.register('gate.setting', ([key = '', value = '']) => {
    const k = KEYS.find((x) => x.key === key);
    if (!k) { rt.toast(`Gate settings are ${KEYS.map((x) => x.key).join(', ')}.`, 'warning', 'Gate'); return; }
    void saveSettings({ [k.key]: k.parse(value) } as Partial<GateSettings>).then((s) => rt.toast(`${k.label}: ${String(s[k.key])}.`, 'success', 'Gate'), (e: Error) => rt.toast(e.message, 'danger', 'Gate'));
  }, { label: 'Change a Gate & rules setting', params: true, effect: 'write' });
}

/**
 * The plugin's server-side settings, cached for the console-control targets (`setting:gate.<key>`, registered at start
 * so voice and remote callers reach them without the settings tab open). One write path: PUT settings. Values go as
 * sent; the server checks and types them.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { gateCall, type GateSettings } from './api';
import { autoLanderPath, type AutoLanderSettings } from './autoLanderState';

let cache: GateSettings | null = null;
export async function loadSettings(): Promise<GateSettings> { cache = (await gateCall<{ settings: GateSettings }>('settings')).settings; return cache; }
export async function saveSettings(patch: Partial<Record<keyof GateSettings, unknown>>): Promise<GateSettings> { cache = (await gateCall<{ settings: GateSettings }>('settings', 'PUT', patch)).settings; return cache; }

const KEYS: { key: keyof GateSettings; label: string }[] = [
  { key: 'refreshSec', label: 'Gate: refresh every (seconds)' },
  { key: 'historySize', label: 'Gate: history size' },
  { key: 'defaultTab', label: 'Gate: tab it opens on' },
];

// the lander's settings (deploy/lander/run.mjs, POST auto-lander/settings): the same call as MCP, CLI and voice
let alCache: AutoLanderSettings | null = null;
export async function loadAutoLanderSettings(): Promise<AutoLanderSettings> { alCache = (await gateCall<{ settings: AutoLanderSettings }>(autoLanderPath('settings'))).settings; return alCache; }
export async function saveAutoLanderSettings(patch: Partial<Record<keyof AutoLanderSettings, unknown>>): Promise<AutoLanderSettings> { alCache = (await gateCall<{ settings: AutoLanderSettings }>(autoLanderPath('settings'), 'POST', patch)).settings; return alCache; }
const AL_KEYS: { key: keyof AutoLanderSettings; label: string }[] = [
  { key: 'enabled', label: 'Lander: land by itself' },
  { key: 'sizeCapLines', label: 'Lander: lines one PR may carry (size cap)' },
  { key: 'flakyReruns', label: 'Lander: re-runs of a red CI before it counts' },
  { key: 'backoffBaseMin', label: 'Lander: first wait (minutes)' },
  { key: 'backoffFactor', label: 'Lander: wait grows by' },
  { key: 'backoffMaxMin', label: 'Lander: longest wait (minutes)' },
  { key: 'ciNoneKickMin', label: 'Lander: start CI again after (minutes)' },
  { key: 'ciTimeoutMin', label: 'Lander: CI times out after (minutes)' },
  { key: 'fixTimeoutMin', label: 'Lander: a fix session times out after (minutes)' },
  { key: 'notifyAfterAttempts', label: 'Lander: post every attempt from' },
  { key: 'workflow', label: 'Lander: CI workflow' },
  { key: 'mergeMethod', label: 'Lander: merge method' },
];

export function registerSettingTargets(rt: AxfRuntime): void {
  const reg = controlRegistry(rt);
  for (const k of KEYS) {
    reg.register({
      address: `setting:gate.${k.key}`, kind: 'setting', label: k.label, keywords: ['gate', 'settings', k.key],
      get: () => cache?.[k.key] ?? null,
      set: async (v: unknown) => (await saveSettings({ [k.key]: v }))[k.key],
      open: () => { rt.dispatch('settings.open:gate'); },
    });
  }
  void loadSettings().catch(() => { /* the server part may be off: the targets answer null */ });
  // control@1 / console-control@1 entries for the server auto-lander's settings, after the plugin's own
  for (const k of AL_KEYS) {
    reg.register({
      address: `setting:gate.autoLander.${k.key}`, kind: 'setting', label: k.label, keywords: ['gate', 'auto-lander', 'server', 'settings', k.key],
      get: () => alCache?.[k.key] ?? null,
      set: async (v: unknown) => (await saveAutoLanderSettings({ [k.key]: v }))[k.key],
      open: () => { rt.dispatch('settings.open:gate'); },
    });
  }
  void loadAutoLanderSettings().catch(() => { /* the auto-lander may not be installed: the targets answer null */ });
  rt.actions.register('gate.setting', ([key = '', value = '']) => {
    const k = KEYS.find((x) => x.key === key);
    if (!k) { rt.toast(`Gate settings are ${KEYS.map((x) => x.key).join(', ')}.`, 'warning', 'Gate'); return; }
    void saveSettings({ [k.key]: value }).then((s) => rt.toast(`${k.label}: ${String(s[k.key])}.`, 'success', 'Gate'), (e: Error) => rt.toast(e.message, 'danger', 'Gate'));
  }, { label: 'Change a Gate & rules setting', params: true, effect: 'write' });
}

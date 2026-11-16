/**
 * The plugin's server-side settings, cached for the console-control targets (`setting:gate.<key>`, registered at start
 * so voice and remote callers reach them without the settings tab open). One write path: PUT settings.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { gateCall, isTab, type GateSettings } from './api';

let cache: GateSettings | null = null;
export async function loadSettings(): Promise<GateSettings> { cache = (await gateCall<{ settings: GateSettings }>('settings')).settings; return cache; }
export async function saveSettings(patch: Partial<GateSettings>): Promise<GateSettings> { cache = (await gateCall<{ settings: GateSettings }>('settings', 'PUT', patch)).settings; return cache; }

const KEYS: { key: keyof GateSettings; label: string; parse: (v: unknown) => unknown }[] = [
  { key: 'refreshSec', label: 'Gate: refresh every (seconds)', parse: (v) => Number(v) },
  { key: 'historySize', label: 'Gate: history size', parse: (v) => Number(v) },
  { key: 'defaultTab', label: 'Gate: tab it opens on', parse: (v) => (isTab(v) ? v : String(v)) },
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
  rt.actions.register('gate.setting', ([key = '', value = '']) => {
    const k = KEYS.find((x) => x.key === key);
    if (!k) { rt.toast(`Gate settings are ${KEYS.map((x) => x.key).join(', ')}.`, 'warning', 'Gate'); return; }
    void saveSettings({ [k.key]: k.parse(value) } as Partial<GateSettings>).then((s) => rt.toast(`${k.label}: ${String(s[k.key])}.`, 'success', 'Gate'), (e: Error) => rt.toast(e.message, 'danger', 'Gate'));
  }, { label: 'Change a Gate & rules setting', params: true, effect: 'write' });
}

/**
 * The Hub plugin's registered settings (Settings → Plugins → Hub; control@1 `console.pluginsettings` / `settings.set`):
 * the settings the route table lists, as a settings group on the library, so the settings interface, console-control
 * and voice reach them the same way. The veto countdown is the one that writes to the hub: a change posts
 * `passes/veto-countdown` (a confirm action; the console runs the two-step handshake itself for an in-page change) and
 * the Passes read keeps the field on the hub's value.
 */
import type { AxfRuntime, SettingsGroup, SettingSpec } from '@console/axf/core';
import { settingsOf, type HubConsoleTable } from '@console/axf/core/hub-console.mjs';
import { runAction } from './data';

export const VETO_SETTING = 'axf.hub.veto.countdownSeconds';
export const NO_WAIT_SETTING = 'axf.hub.veto.noWait';

/** The table's settings as settings specs (json-shaped ones are remembered state the screens keep; they are not fields). */
export function hubSettingsGroups(table: HubConsoleTable): SettingsGroup[] {
  const specs: SettingSpec[] = [];
  for (const s of settingsOf(table)) {
    if (s.kind === 'json') continue;
    const base = { key: s.key, label: s.label, description: s.personOnly ? `Owner-only; set in Claude settings (${s.ownedBy ?? 'its owner'}). Shown here read-only.` : s.who === 'confirm' ? 'Changing it writes to axHub (a confirm): every tool held for a veto gets the new countdown.' : undefined, scope: 'app' as const };
    if (s.kind === 'number') specs.push({ ...base, kind: 'number', default: s.default as number, min: s.min, max: s.max, ...(s.personOnly ? { requires: 'owner' } : {}) });
    else if (s.kind === 'toggle') specs.push({ ...base, kind: 'toggle', default: s.default as boolean, ...(s.personOnly ? { requires: 'owner' } : {}) });
    else if (s.kind === 'choice') specs.push({ ...base, kind: 'choice', default: s.default as string, options: (s.options ?? []).map((o) => ({ value: o, label: o || 'Any' })) });
    else specs.push({ ...base, kind: 'text', default: String(s.default ?? '') });
  }
  return [{ id: 'hub.settings', label: 'Hub', icon: 'shield', tab: table.settingsSubtab, order: 10, description: 'What the axHub web app used to keep, now here. The veto countdown is written to axHub when it changes.', settings: specs }];
}

let fromHub = false;
/** The Passes read tells the setting the hub's value without writing it back. */
export function vetoFromHub(rt: AxfRuntime, seconds: number): void {
  if (!Number.isFinite(seconds) || rt.settings.get(VETO_SETTING) === seconds) return;
  fromHub = true;
  try { rt.settings.set(VETO_SETTING, seconds); } finally { fromHub = false; }
}

/** Wires the countdown setting to the hub: a change in the settings UI (or settings.set by command) writes the policy table. */
export function wireHubSettings(rt: AxfRuntime): () => void {
  return rt.settings.onChange(VETO_SETTING, (v) => {
    if (fromHub) return;
    const seconds = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(seconds)) return;
    void (async () => {
      let r = await runAction('passes', 'veto-countdown', { seconds });
      if (r.code === 'confirmation_required' && typeof r.confirm === 'string') r = await runAction('passes', 'veto-countdown', { seconds, confirm: r.confirm });
      rt.toast(r.ok ? `Veto countdown ${seconds} s on every held tool.` : r.message || 'The countdown was not changed on axHub.', r.ok ? 'success' : 'danger', 'Hub');
    })();
  });
}

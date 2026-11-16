/**
 * `plugin.settings.*` console actions (plugin-settings@1): every plugin's Settings → Plugins sub-tab by voice, search,
 * menus, MCP console_action and control@1 (`console.actions run plugin.settings.open:<plugin>`). AmberX voice says
 * "open Brand library settings" → the sub-tab's control target (src/control/inventory.json), or runs these directly.
 *
 *   plugin.settings.open:<plugin>                 open its sub-tab (console control `open`, the gear's own command)
 *   plugin.settings.get:<plugin>                  its state: on / off, version, option values (GET …/settings/<folder>)
 *   plugin.settings.set:<plugin>:<key>:<value>    set one of its own options (PUT …/settings/<folder>; owner-only refused)
 *
 * <plugin> is its folder, manifest id or name (case-insensitive). The REST routes are the Plugin Manager's
 * (its settings routes), so REST, MCP, the CLI (`axf plugin-settings …`) and voice answer the same.
 */
import type { AxfRuntime } from '../axf/core';
import { settingsAddress } from '../axf/core/plugin-settings.mjs';
import { executeControl, describeAnswer } from '../control/executor';
import { bundledPlugins, pluginFetch, pluginProviding, type BundledPlugin } from '../plugins';
import { pluginTabId } from '../settings/pluginTabs';

export const PLUGIN_SETTINGS_ACTIONS = {
  open: { label: 'Open a plugin\'s settings (Settings → Plugins → <plugin>)', effect: 'navigate' },
  get: { label: 'Read a plugin\'s settings: on / off, version, its options', effect: 'read' },
  set: { label: 'Set one of a plugin\'s own options (plugin:key:value)', effect: 'write' },
} as const;
type Verb = keyof typeof PLUGIN_SETTINGS_ACTIONS;

/** A plugin by folder, manifest id or name. */
export function findPlugin(ref: string, all: readonly BundledPlugin[] = bundledPlugins): BundledPlugin | null {
  const r = ref.trim().toLowerCase();
  if (!r) return null;
  return all.find((p) => p.folder === r || p.manifest.id.toLowerCase() === r || p.manifest.name.toLowerCase() === r)
    ?? all.find((p) => p.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === r.replace(/[^a-z0-9]+/g, '-')) ?? null;
}

/** plugin.settings.set's arguments → { plugin, key, value } (the value is after the last colon; keys may hold colons). */
export function setArgs(args: string[]): { plugin: string; key: string; value: string } | null {
  const [plugin = '', ...rest] = args;
  const text = rest.join(':');
  const i = text.lastIndexOf(':');
  if (!plugin || i <= 0) return null;
  return { plugin, key: text.slice(0, i), value: text.slice(i + 1) };
}

const fetchJson = async (folder: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const host = pluginProviding('service:axf.plugin-settings@1'); // the Plugin Manager, by capability
  if (!host) return { ok: false, message: 'The Plugin Manager is not installed, so plugin settings can\'t be read here.' };
  const r = await pluginFetch(host, `settings/${folder}`, init);
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return r.ok ? j : { ok: false, message: String(j.detail ?? r.statusText) };
};

export function installPluginSettingsActions(rt: AxfRuntime): () => void {
  const run = async (verb: Verb, args: string[]): Promise<unknown> => {
    const p = findPlugin(args[0] ?? '');
    if (!p) { rt.toast(`No plugin "${args[0] ?? ''}".`, 'warning', 'Plugin settings'); return false; }
    const tab = pluginTabId(p);
    if (verb === 'open') {
      const a = await executeControl(rt, { verb: 'open', address: settingsAddress(tab), by: 'action' });
      if (!a.ok) rt.dispatch(`settings.open:${tab}`);
      return a;
    }
    if (verb === 'get') {
      const j = await fetchJson(p.folder);
      if (j.ok === false) { rt.toast(String(j.message), 'warning', p.manifest.name); return j; }
      const opts = (j.optionSpecs as { key: string; value?: unknown }[] | undefined) ?? [];
      rt.toast(`${p.manifest.name} is ${j.enabled ? 'on' : 'off'}${opts.length ? ` · ${opts.length} option${opts.length > 1 ? 's' : ''}` : ''}.`, 'info', 'Plugin settings');
      return j;
    }
    const s = setArgs(args);
    if (!s) { rt.toast('plugin.settings.set needs plugin:key:value', 'warning', 'Plugin settings'); return false; }
    const j = await fetchJson(p.folder, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ options: { [s.key]: s.value } }) });
    const r = (j.results as Record<string, { ok?: boolean; message?: string }> | undefined)?.[s.key];
    const ok = j.ok !== false && r?.ok !== false;
    rt.toast(ok ? `${p.manifest.name}: ${s.key} = ${s.value}` : String(r?.message ?? j.message ?? 'refused'), ok ? 'success' : 'warning', 'Plugin settings');
    return j;
  };
  const offs = (Object.keys(PLUGIN_SETTINGS_ACTIONS) as Verb[]).map((verb) => rt.actions.register(`plugin.settings.${verb}`, (args) => {
    void run(verb, args).then((a) => { if (verb === 'open' && a && typeof a === 'object' && 'ok' in a && !(a as { ok: boolean }).ok) rt.toast(describeAnswer(a as Parameters<typeof describeAnswer>[0]), 'warning', 'Plugin settings'); });
    return true;
  }, { label: PLUGIN_SETTINGS_ACTIONS[verb].label, params: true }));
  return () => offs.forEach((off) => off());
}

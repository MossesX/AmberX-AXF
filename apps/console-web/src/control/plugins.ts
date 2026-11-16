/**
 * Plugins as console-control@1 targets (framework/spec/CONSOLE-CONTROL.md): `plugin:<manifest id>` for every installed
 * plugin, with its UI (`view:…`) and its settings sub-tab. `plugin.enable` / `plugin.disable` (and `set` true / false)
 * go through the server (POST /api/console-control/plugins/<id>/enable|disable), so a command from the open console and
 * one from REST, MCP, the CLI or voice take the same path: core plugins refuse, a plugin another one needs refuses,
 * and the answer names who needs it. The plugin list reloads after a change (PLUGINS_CHANGED).
 */
import type { AxfRuntime } from '../axf/core';
import { ConsoleControlError, CONSOLE_CONTROL_WIRE } from '../axf/core/engines/console-control';
import { controlRegistry, type ControlTargetDef } from '../axf/react';
import { post } from '../api';
import { fetchPluginStatus, PLUGINS_CHANGED, type PluginStatus } from '../plugins';
import { inventory } from './inventory';

export interface InventoryPlugin {
  address: string; id: string; label: string; folder: string; version?: string; detail?: string; keywords?: string[]; aliases?: string[];
  core?: boolean; enabledByDefault?: boolean; view?: string; settingsTab?: string; provides?: string[]; requires?: string[]; optional?: string[];
}

export const inventoryPlugins = (): InventoryPlugin[] => ((inventory as unknown as { plugins?: InventoryPlugin[] }).plugins ?? []);

/** Turn a plugin on or off through the server's console-control route. Returns the answer envelope's extra fields. */
export async function togglePlugin(id: string, enabled: boolean, opts: { force?: boolean; by?: string } = {}): Promise<Record<string, unknown>> {
  const r = await post(`console-control/plugins/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, { by: opts.by ?? 'console', ...(opts.force ? { force: true } : {}) });
  if (!r.ok) {
    const code = String((r as { code?: string }).code ?? CONSOLE_CONTROL_WIRE.UNAVAILABLE);
    throw new ConsoleControlError(code as never, String((r as { message?: string }).message ?? r.error ?? 'the plugin could not be switched'), { ...(r as Record<string, unknown>) });
  }
  globalThis.dispatchEvent(new Event(PLUGINS_CHANGED));
  return r;
}

function pluginDef(rt: AxfRuntime, p: InventoryPlugin, status: () => PluginStatus[] | null): ControlTargetDef {
  const enabled = () => { const s = status()?.find((x) => x.folder === p.folder); return s ? s.enabled : p.enabledByDefault !== false; };
  return {
    address: p.address, kind: 'plugin', label: p.label, detail: p.detail, icon: 'package', keywords: [...(p.keywords ?? []), ...(p.aliases ?? [])],
    can: ['open', 'state', 'focus', 'set', 'plugin.enable', 'plugin.disable'],
    get: enabled,
    set: async (v) => {
      const on = v === true || (typeof v === 'string' && /^(on|true|yes|1|enable|enabled)$/i.test(v)) || (v === 'toggle' && !enabled());
      await togglePlugin(p.id, on);
      return undefined;
    },
    open: () => {
      if (p.view && enabled()) rt.navigate(p.view.slice(5));
      else if (p.settingsTab) rt.dispatch(`settings.open:${decodeURIComponent(p.settingsTab.split('=').pop() ?? '')}`);
      else rt.dispatch('settings.open:plugins');
    },
    element: () => document.querySelector(`[data-axf-plugin-card="${CSS.escape(p.folder)}"]`) ?? document.querySelector(`[data-axf-plugin="${CSS.escape(p.id)}"]`),
    state: () => ({ id: p.id, version: p.version, enabled: enabled(), ...(p.core ? { core: true } : {}), ...(p.view ? { view: p.view } : {}), ...(p.settingsTab ? { settingsTab: p.settingsTab } : {}) }),
  };
}

/** Register every plugin; the enabled state follows the server's plugin list. */
export function installPluginTargets(rt: AxfRuntime): () => void {
  let status: PluginStatus[] | null = null;
  const reload = async () => { status = await fetchPluginStatus(); };
  void reload();
  globalThis.addEventListener(PLUGINS_CHANGED, reload);
  const reg = controlRegistry(rt);
  const offs = inventoryPlugins().map((p) => reg.register(pluginDef(rt, p, () => status)));
  return () => { globalThis.removeEventListener(PLUGINS_CHANGED, reload); offs.forEach((off) => off()); };
}

/** Throws when a plugin address names nothing (the executor's short-form helper). */
export function pluginByRef(ref: string): InventoryPlugin {
  const r = ref.replace(/^.*\//, '').replace(/^plugin:/, '').toLowerCase();
  const p = inventoryPlugins().find((x) => x.id.toLowerCase() === r || (x.aliases ?? []).some((a) => a.toLowerCase() === r));
  if (!p) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_FOUND, `no plugin ${ref}`, { nearest: [] });
  return p;
}

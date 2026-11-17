/**
 * Page toolbars as console-control@1 targets (page-toolbar@1; framework/spec/CONSOLE-CONTROL.md → Page toolbars). Every
 * <PageToolbar> on screen announces itself under its settings id (framework/react/pageToolbar.ts, registerLiveToolbar);
 * this registers `toolbar:<id>` (open, state, list, focus) and `toolbar:<id>/button:<b>` (press, state, focus) for each,
 * so REST, MCP, the CLI and voice reach the same buttons the person taps, through the same engine (invokeToolbarButton):
 * disabled and hidden buttons refuse with the engine's reason, a destructive one needs confirm.
 *
 * It also installs the console's plugin command runner for `command:<plugin>/<cmd>` buttons: the same control@1 call
 * REST / MCP / CLI make (`plugins.commands` act run through POST /api/control), so a toolbar button and an API call
 * cannot disagree.
 */
import type { AxfRuntime } from '../axf/core';
import { toolbarButtonState, toolbarState, type ResolvedToolbarButton } from '../axf/core/engines/toolbar-actions';
import { controlRegistry, liveToolbars, onLiveToolbars, setToolbarCommandRunner, type ControlTargetDef, type PageToolbarHook } from '../axf/react';
import { post } from '../api';

/** The console's plugin command runner: one control@1 act on plugins.commands (a read command goes to plugins.reads). */
export async function runPluginCommand(plugin: string, command: string, input: Record<string, unknown>, opts: { confirm?: boolean | string } = {}): Promise<unknown> {
  const body = { $axf: 'control@1', op: 'act', target: 'plugins.commands', path: `${plugin}/${command}`, action: 'run', input, by: 'console', ...(opts.confirm ? { confirm: opts.confirm } : {}) };
  const r = await post('control', body);
  if (!r.ok) throw new Error(String((r as { message?: string }).message ?? r.error ?? `${plugin}/${command} failed`));
  return r;
}

function toolbarDefs(id: string, hook: PageToolbarHook, view: string | null): ControlTargetDef[] {
  const t = hook.toolbar;
  if (!t) return [];
  const el = () => document.querySelector(`[role="toolbar"][data-axf-toolbar="${CSS.escape(id)}"]`);
  const bar: ControlTargetDef = {
    address: t.address, kind: 'toolbar', label: t.label, detail: `Toolbar · ${t.asset}`, icon: 'sliders',
    keywords: [id, t.asset, t.label, ...(view ? [view] : []), 'toolbar'],
    can: ['open', 'state', 'list', 'focus'],
    element: el,
    state: () => toolbarState(t) as unknown as Record<string, unknown>,
  };
  const buttons = t.groups.flatMap((g) => g.buttons).map((b: ResolvedToolbarButton): ControlTargetDef => ({
    address: b.address, kind: 'button', label: b.label, detail: `${t.label} toolbar${b.reason ? ` · ${b.reason}` : ''}`, icon: b.icon,
    keywords: [b.id, b.label, t.label, id, ...(b.ref ? [b.ref.id] : [])],
    can: ['open', 'state', 'press', 'focus'],
    destructive: b.destructive,
    requires: b.requires ?? undefined,
    element: () => el()?.querySelector(`[data-axf-toolbar-button="${CSS.escape(b.id)}"]`) ?? el(),
    isDisabled: () => !b.enabled,
    invoke: async () => {
      const live = hook.toolbar ? hook : null;
      const out = await (live ?? hook).press(b.id);
      if (!out.ok) throw new Error(out.message);
      return out.result ?? null;
    },
    state: () => toolbarButtonState(b, t.more.some((m) => m.key === b.key)) as unknown as Record<string, unknown>,
  }));
  return [bar, ...buttons];
}

/** Register every live page toolbar and its buttons; re-registers as toolbars mount, unmount or re-resolve. */
export function installToolbarTargets(rt: AxfRuntime): () => void {
  const reg = controlRegistry(rt);
  let offs: (() => void)[] = [];
  const sync = () => {
    for (const off of offs) off();
    offs = [];
    for (const { id, hook, view } of liveToolbars()) for (const def of toolbarDefs(id, hook, view)) offs.push(reg.register(def));
  };
  setToolbarCommandRunner((plugin, command, input, opts) => runPluginCommand(plugin, command, input, opts));
  sync();
  const off = onLiveToolbars(sync);
  // a toolbar re-resolves on page state, settings and runtime changes without re-announcing: follow the runtime's revision
  const unsub = rt.subscribe(() => sync());
  return () => { off(); unsub(); for (const o of offs) o(); setToolbarCommandRunner(null); };
}

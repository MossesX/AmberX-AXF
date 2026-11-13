/**
 * The console's console-control@1 executor (framework/spec/CONSOLE-CONTROL.md): runs one command (open, state, press,
 * set, scroll, focus, search, list, plugin.enable, plugin.disable) through the target registry and answers with the
 * result plus a live state snapshot: the screen, its active tabs, the scroll of the main pane, the focused target and
 * any open dialog.
 *
 * Commands reach it over the console-command@1 relay (the console-commands plugin's stream: op `control`), so REST,
 * MCP, the CLI and voice all land here the same way. In the page it is `executeControl(rt, cmd)` and
 * `window.axfConsoleControl(cmd)` (the e2e tests and the devtools console).
 *
 * What the registry does not know yet (a tab of a screen that is not open, a row of a grid on another screen) is
 * reached by opening the screen the static inventory names for the address, then asking again.
 */
import type { AxfRuntime } from '../axf/core';
import {
  CONSOLE_CONTROL_FRAME, CONSOLE_CONTROL_WIRE, consoleControlFailure, normalizeConsoleControl, parseAddress,
  type ConsoleControlResult, type ScrollState,
} from '../axf/core/engines/console-control';
import { controlRegistry } from '../axf/react';
import { inventoryViewLabel, inventoryViewOf } from './inventory';
import { loadedItemFor } from './search';

/** The live state that comes back with every answer. */
export interface ControlStateSnapshot {
  screen: string;
  screenLabel: string;
  /** active tab of each tab row rendered on the screen: row address → tab value */
  tabs: Record<string, string>;
  scroll?: ScrollState;
  /** the address the last open / focus brought forward (null after the screen changed) */
  focused: string | null;
  /** the focused row or step, when the focused target is one */
  focusedRow: string | null;
  dialog?: string;
  targets: number;
  at: string;
}

export type ControlAnswer = ConsoleControlResult & { state: ControlStateSnapshot };

let focused: { address: string; view: string } | null = null;

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The screen, its tabs, its scroll and what is focused, read now. */
export function controlState(rt: AxfRuntime): ControlStateSnapshot {
  const snap = controlRegistry(rt).snapshot();
  const s = rt.getState();
  const tabs: Record<string, string> = {};
  for (const t of snap.targets) {
    if ((t.kind !== 'tab' && t.kind !== 'subtab') || t.virtual || t.value === undefined || typeof t.value !== 'string') continue;
    const leaf = t.address.slice(t.address.lastIndexOf('/') + 1);
    if (leaf.includes('=')) continue; // a single tab, not its row
    if (t.address.startsWith('view:') && !t.address.startsWith(`view:${s.view}/`)) continue;
    tabs[t.address] = t.value;
  }
  const f = focused && focused.view === s.view ? focused.address : null;
  let focusedRow: string | null = null;
  if (f) { try { const p = parseAddress(f); const leaf = p[p.length - 1]!; if (leaf.kind === 'row' || leaf.kind === 'step') focusedRow = f; } catch { /* keep null */ } }
  return {
    screen: s.view, screenLabel: inventoryViewLabel(s.view), tabs, ...(snap.scroll ? { scroll: snap.scroll } : {}),
    focused: f, focusedRow, ...(s.dialog ? { dialog: s.dialog.id } : {}), targets: snap.targets.length, at: new Date().toISOString(),
  };
}

/** The verbs that can open the address's screen first when it is not rendered. */
const OPENS_SCREEN = new Set(['open', 'focus', 'press', 'set', 'state', 'scroll', 'plugin.enable', 'plugin.disable']);

/**
 * Run one console-control@1 command. Never throws: a failure is an envelope (with `state` too, so the caller sees where
 * the console is).
 */
export async function executeControl(rt: AxfRuntime, raw: unknown): Promise<ControlAnswer> {
  const reg = controlRegistry(rt);
  let cmd: ReturnType<typeof normalizeConsoleControl>;
  try { cmd = normalizeConsoleControl(raw); } catch {
    const r = await reg.run(raw); // the registry's own envelope for an invalid command
    return { ...r, state: controlState(rt) } as ControlAnswer;
  }
  let res = await reg.run(cmd);
  // loaded but not rendered (a build on another tab, a folded group): the item opens itself, then ask again
  if (!res.ok && res.code === CONSOLE_CONTROL_WIRE.NOT_FOUND && cmd.address && OPENS_SCREEN.has(cmd.verb)) {
    const item = loadedItemFor(cmd.address);
    if (item?.open) {
      try { await item.open(); } catch { /* the retry answers */ }
      for (const ms of [150, 400, 900]) { await nextFrame(); await wait(ms); res = await reg.run(cmd); if (res.ok || res.code !== CONSOLE_CONTROL_WIRE.NOT_FOUND) break; }
    }
  }
  // not rendered yet: open the screen the inventory names, let it render, ask again (once)
  if (!res.ok && res.code === CONSOLE_CONTROL_WIRE.NOT_FOUND && cmd.address && OPENS_SCREEN.has(cmd.verb)) {
    const view = inventoryViewOf(cmd.address);
    if (view && view !== rt.getState().view) {
      rt.navigate(view);
      await nextFrame(); await nextFrame(); await wait(150);
      res = await reg.run(cmd);
      if (!res.ok && res.code === CONSOLE_CONTROL_WIRE.NOT_FOUND) { await wait(400); res = await reg.run(cmd); }
    }
  }
  if (res.ok && (cmd.verb === 'focus' || cmd.verb === 'open') && typeof res.address === 'string') {
    focused = { address: String((res as { focused?: string; opened?: string }).focused ?? (res as { opened?: string }).opened ?? res.address), view: rt.getState().view };
  }
  return { ...res, state: controlState(rt) } as ControlAnswer;
}

/** A short line for a toast or a spoken answer. */
export function describeAnswer(a: ControlAnswer): string {
  if (!a.ok) return a.message;
  const r = a as unknown as Record<string, unknown>;
  switch (a.verb) {
    case 'open': return `opened ${String(r.opened ?? a.address ?? '')}`;
    case 'focus': return `focused ${String(r.focused ?? a.address ?? '')}`;
    case 'press': return `pressed ${String(r.pressed ?? a.address ?? '')}`;
    case 'set': return `set ${a.address ?? ''} to ${JSON.stringify(r.value)}`;
    case 'scroll': { const s = r.scroll as ScrollState | undefined; return s ? `scrolled to ${Math.round(s.fraction * 100)}%` : 'scrolled'; }
    case 'search': return `${(r.hits as unknown[] | undefined)?.length ?? 0} hits`;
    case 'plugin.enable': case 'plugin.disable': return `${String(r.plugin ?? a.address)} ${r.enabled ? 'on' : 'off'}`;
    default: return `${a.verb} ${a.address ?? ''}`.trim();
  }
}

/** Expose the executor on the page (tests, devtools). Returns a remover. */
export function installControlExecutor(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window as unknown as { axfConsoleControl?: (cmd: unknown) => Promise<ControlAnswer>; axfConsoleControlState?: () => ControlStateSnapshot };
  w.axfConsoleControl = (cmd) => executeControl(rt, cmd);
  w.axfConsoleControlState = () => controlState(rt);
  const off = rt.subscribe(() => { if (focused && focused.view !== rt.getState().view) focused = null; });
  return () => { off(); delete w.axfConsoleControl; delete w.axfConsoleControlState; };
}

/** A failure envelope with state, for a relay message that could not be run at all. */
export function controlFailureWithState(rt: AxfRuntime, code: string, message: string): ControlAnswer {
  return { ...consoleControlFailure(code, message), $axf: CONSOLE_CONTROL_FRAME, state: controlState(rt) } as ControlAnswer;
}
